// Reads one S3 object as several byte ranges at the same time (2026-11-04). A single S3 connection is the bottleneck for large files: a 15.5 MB
// petition took 89 s in one GET and 41 s as 8 parallel 2 MB ranges on the same line. A 500-page petition is several times that size.
//
//   const buffer = await getObjectInParts({ send, Bucket, Key, makeGet, partBytes, concurrency });
//
// How: the FIRST request asks for the first part only; its Content-Range says the object's total size (no extra HEAD round trip). A file that
// fits in one part is done after that one request, exactly as before. The other parts are fetched `concurrency` at a time, each pinned to the
// first answer's ETag (If-Match), so a file replaced halfway can never be stitched from two versions. The parts are checked (every length, the
// total) and joined in order - the bytes are identical to one whole GET.
// Never worse than before: anything unexpected (no Content-Range, an empty file, a changed file, a failed part, a size mismatch) falls back to
// ONE whole GET, i.e. the old behaviour. Only "not found" is passed straight through, as before.
//
//   S3_PARALLEL_PART_MB         size of one part (default 4; 0 = off: one whole GET, the old behaviour)
//   S3_PARALLEL_CONCURRENCY     parts in flight per file (default 8, 1-16)
const MB = 1024 * 1024;

function settings(env = process.env) {
  const partMb = Number(env.S3_PARALLEL_PART_MB ?? 4);
  const concurrency = Number.parseInt(env.S3_PARALLEL_CONCURRENCY ?? 8, 10);
  return {
    partBytes: Number.isFinite(partMb) && partMb > 0 ? Math.max(1, Math.round(Math.min(partMb, 64) * MB)) : 0,
    concurrency: Number.isFinite(concurrency) ? Math.min(16, Math.max(1, concurrency)) : 8,
  };
}

/** "bytes 0-4194303/16252928" -> 16252928; anything else -> null */
function totalFromContentRange(value) {
  const match = /^bytes\s+\d+-\d+\/(\d+)$/i.exec(String(value || "").trim());
  return match ? Number(match[1]) : null;
}

async function bodyToBuffer(body) {
  if (body && typeof body.transformToByteArray === "function") return Buffer.from(await body.transformToByteArray());
  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const isNotFound = (error) => error?.name === "NoSuchKey" || error?.name === "NotFound" || error?.$metadata?.httpStatusCode === 404;

/**
 * send(command) -> S3 response; makeGet(input) -> a GetObjectCommand. Resolves with the whole object.
 * onFallback(reason) (optional) is told when the parallel read was abandoned for one whole GET.
 */
async function getObjectInParts({ send, Bucket, Key, makeGet, partBytes, concurrency, onFallback = null, readBody = bodyToBuffer }) {
  const whole = async () => readBody((await send(makeGet({ Bucket, Key }))).Body);
  if (!partBytes) return whole();

  let first;
  try {
    first = await send(makeGet({ Bucket, Key, Range: `bytes=0-${partBytes - 1}` }));
  } catch (error) {
    if (isNotFound(error)) throw error;
    onFallback?.(`first part failed: ${error?.name || error?.message || error}`);
    return whole();
  }
  const total = totalFromContentRange(first.ContentRange);
  const head = await readBody(first.Body);
  if (total === null) return head; // the server ignored the range and sent the whole object (or an S3 look-alike without ranges)
  if (head.length >= total) return head.length === total ? head : whole(); // the file fits in one part: done, as before
  if (head.length !== Math.min(partBytes, total)) {
    onFallback?.("first part has an unexpected length");
    return whole();
  }

  const ranges = [];
  for (let start = partBytes; start < total; start += partBytes) ranges.push({ start, end: Math.min(total, start + partBytes) - 1 });
  const parts = new Array(ranges.length);
  try {
    let next = 0;
    const worker = async () => {
      while (next < ranges.length) {
        const index = next;
        next += 1;
        const { start, end } = ranges[index];
        const response = await send(makeGet({ Bucket, Key, Range: `bytes=${start}-${end}`, ...(first.ETag ? { IfMatch: first.ETag } : {}) }));
        const bytes = await readBody(response.Body);
        if (bytes.length !== end - start + 1) throw new Error(`part ${index + 2} has ${bytes.length} bytes, expected ${end - start + 1}`);
        parts[index] = bytes;
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, ranges.length) }, worker));
  } catch (error) {
    if (isNotFound(error)) throw error; // deleted while reading: the same answer a whole GET would give
    onFallback?.(`a part failed: ${error?.name || error?.message || error}`);
    return whole();
  }
  const joined = head.length + parts.reduce((sum, part) => sum + (part ? part.length : 0), 0);
  if (joined !== total || parts.some((part) => !part)) {
    onFallback?.("joined size differs from the object size");
    return whole();
  }
  return Buffer.concat([head, ...parts], total);
}

module.exports = { getObjectInParts, settings, totalFromContentRange };

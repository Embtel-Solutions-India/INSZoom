// The "PDF" was not a PDF (HTML error page, junk before %PDF-). Trim the junk when the bytes are at hand, else download again, else resolve the link again.
const { depStrategy, NOT_PROVIDED } = require("./_helpers");

const HEADER = Buffer.from("%PDF-");

module.exports = {
  id: "notAPdf",
  description: "the downloaded file is not a PDF",
  matches: (diagnosis) => diagnosis.cause === "not_a_pdf",
  strategies: [
    {
      id: "trim_leading_junk",
      description: "cut everything before the %PDF- header (within the first 1024 bytes)",
      safe: true,
      async run(ctx) {
        const buffer = ctx?.deps?.inputBuffer;
        if (!Buffer.isBuffer(buffer)) return { ok: false, evidence: `${NOT_PROVIDED} (inputBuffer)` };
        const at = buffer.subarray(0, 1024).indexOf(HEADER);
        if (at <= 0) return { ok: false, evidence: at === 0 ? "the file already starts with %PDF-" : "no %PDF- header in the first 1024 bytes" };
        const trimmed = buffer.subarray(at);
        if (typeof ctx.deps.useBuffer === "function") await ctx.deps.useBuffer(trimmed);
        return { ok: true, evidence: `trimmed ${at} bytes before the PDF header`, retry: true, buffer: trimmed };
      },
      async verify(_ctx, run) { return Boolean(run?.ok && Buffer.isBuffer(run.buffer) && run.buffer.subarray(0, 5).equals(HEADER)); },
    },
    depStrategy({ id: "redownload_once", description: "download the file again (cache-busting) and re-check the header", depName: "redownload" }),
    depStrategy({ id: "resolve_pdf_link_again", description: "find the PDF link on the official page again and take the alternate link", depName: "reresolvePdfLink" }),
  ],
};

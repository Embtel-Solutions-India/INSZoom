// Chunked file upload for chat attachments (any size up to MAX_ATTACHMENT_BYTES).
// Talks to Backend/src/modules/chunked-uploads: POST /chunked-uploads (init) ->
// PUT /chunked-uploads/:id/chunks/:n (raw bytes, one ~5 MB piece per request) ->
// POST /chunked-uploads/:id/complete. The returned uploadId is then sent with the
// message (`uploadIds`) and the backend attaches the assembled file to it.
// Small files skip all this and ride along as ordinary multipart attachments.
//
// Kept identical in Attorney, Admin and Immiglance Client (each passes its own
// axios-style `api` whose baseURL already ends in /api).

export const MAX_ATTACHMENT_BYTES = 400 * 1024 * 1024
export const CHUNKED_THRESHOLD_BYTES = 4 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_MESSAGE = 5

const CHUNK_RETRY_DELAYS_MS = [1000, 3000, 8000, 15000]
const PARALLEL_CHUNKS = 3

export const isChunkedFile = (file) => file.size > CHUNKED_THRESHOLD_BYTES

export function formatFileSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// Returns an error message if the file can't be attached, otherwise ''.
export function attachmentProblem(file) {
  if (!file.size) return `"${file.name}" is empty.`
  if (file.size > MAX_ATTACHMENT_BYTES) return `"${file.name}" is ${formatFileSize(file.size)} - files can be up to ${formatFileSize(MAX_ATTACHMENT_BYTES)}.`
  return ''
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(abortError()) }, { once: true })
  })

function abortError() {
  const error = new Error('Upload cancelled')
  error.name = 'AbortError'
  error.cancelled = true
  return error
}

const isRetryable = (error) => {
  if (error?.cancelled) return false
  const status = error?.response?.status
  return !status || status >= 500 || status === 408 || status === 429
}

async function withRetry(task, signal) {
  for (let attempt = 0; ; attempt += 1) {
    if (signal?.aborted) throw abortError()
    try {
      return await task()
    } catch (error) {
      if (signal?.aborted || error?.code === 'ERR_CANCELED') throw abortError()
      if (attempt >= CHUNK_RETRY_DELAYS_MS.length || !isRetryable(error)) throw error
      await sleep(CHUNK_RETRY_DELAYS_MS[attempt], signal)
    }
  }
}

// Uploads `file` in chunks and resolves { uploadId, fileName, fileSize }.
//  onProgress(fraction 0..1)  - bytes confirmed by the server / total
//  signal                     - AbortSignal; aborting also tells the server to drop the partial upload
//  resumeUploadId             - an earlier uploadId for the same file: chunks the server already has are skipped
export async function uploadFileInChunks(api, file, { onProgress, signal, resumeUploadId } = {}) {
  const problem = attachmentProblem(file)
  if (problem) throw Object.assign(new Error(problem), { userMessage: problem })

  let uploadId = resumeUploadId || null
  let chunkBytes
  let totalChunks
  const done = new Set()

  if (uploadId) {
    try {
      const { data } = await api.get(`/chunked-uploads/${uploadId}`, { signal })
      if (data.status === 'ready') return { uploadId, fileName: file.name, fileSize: file.size }
      chunkBytes = data.chunkBytes
      totalChunks = data.totalChunks
      data.receivedChunks.forEach((index) => done.add(index))
    } catch (error) {
      if (error?.response?.status !== 404) throw error
      uploadId = null // expired on the server: start over
    }
  }
  if (!uploadId) {
    const { data } = await withRetry(() => api.post('/chunked-uploads', { fileName: file.name, fileSize: file.size, mimeType: file.type || 'application/octet-stream' }, { signal }), signal)
    uploadId = data.uploadId
    chunkBytes = data.chunkBytes
    totalChunks = data.totalChunks
  }

  const sizeOf = (index) => Math.min(chunkBytes, file.size - index * chunkBytes)
  let confirmed = [...done].reduce((sum, index) => sum + sizeOf(index), 0)
  const report = () => onProgress?.(Math.min(1, confirmed / file.size))
  report()

  const sendChunk = async (index) => {
    const body = file.slice(index * chunkBytes, index * chunkBytes + sizeOf(index))
    await withRetry(
      () => api.put(`/chunked-uploads/${uploadId}/chunks/${index}`, body, { signal, headers: { 'Content-Type': 'application/octet-stream' }, transformRequest: [(data) => data], timeout: 0 }),
      signal
    )
    confirmed += sizeOf(index)
    report()
  }

  const sendAll = async (indexes) => {
    const queue = [...indexes]
    const worker = async () => {
      while (queue.length) {
        if (signal?.aborted) throw abortError()
        await sendChunk(queue.shift())
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL_CHUNKS, queue.length) }, worker))
  }

  try {
    await sendAll(Array.from({ length: totalChunks }, (_, index) => index).filter((index) => !done.has(index)))
    try {
      await withRetry(() => api.post(`/chunked-uploads/${uploadId}/complete`, {}, { signal, timeout: 0 }), signal)
    } catch (error) {
      // The server names any chunk it never received; send just those and finish.
      const missing = error?.response?.data?.missingChunks
      if (error?.response?.status !== 409 || !missing?.length) throw error
      confirmed -= missing.reduce((sum, index) => sum + sizeOf(index), 0)
      await sendAll(missing)
      await withRetry(() => api.post(`/chunked-uploads/${uploadId}/complete`, {}, { signal, timeout: 0 }), signal)
    }
  } catch (error) {
    if (error?.cancelled || signal?.aborted) api.delete(`/chunked-uploads/${uploadId}`).catch(() => {})
    throw error
  }
  onProgress?.(1)
  return { uploadId, fileName: file.name, fileSize: file.size }
}

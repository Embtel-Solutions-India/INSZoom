// Shared attachment plumbing for the two chat surfaces (Messaging.jsx and
// CaseFeedbackChat.jsx): picking/validating files, deciding how a file is
// previewed, and pushing big files through the chunked-upload API ahead of the
// message request. The chunk protocol itself lives in ./chunkedUpload.js (kept
// identical across the portals).
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  attachmentProblem,
  isChunkedFile,
  uploadFileInChunks
} from './chunkedUpload'

// Browsers render these natively inside an <img>; anything else gets a file chip.
const THUMBNAIL_MIME = /^image\/(jpeg|jpg|png|gif|webp|avif|bmp|svg\+xml)$/i
export const THUMBNAIL_MAX_BYTES = 25 * 1024 * 1024
// Above this a preview isn't fetched automatically (the file is downloaded on demand instead).
export const PREVIEW_MAX_BYTES = 100 * 1024 * 1024

const EXTENSION_KIND = {
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', avif: 'image', bmp: 'image', svg: 'image',
  pdf: 'pdf',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', ogv: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', aac: 'audio', oga: 'audio'
}

export function attachmentKind(mimeType, name) {
  const mime = (mimeType || '').toLowerCase()
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('image/')) return THUMBNAIL_MIME.test(mime) ? 'image' : 'other'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  const ext = (name || '').split('.').pop()?.toLowerCase()
  return EXTENSION_KIND[ext] || 'other'
}

export const sizeOfAttachment = (attachment) => attachment?.size ?? attachment?.fileSize ?? 0

export const canThumbnail = (attachment) => (
  attachmentKind(attachment.mimeType, attachment.originalName) === 'image' &&
  (attachment.__localUrl || !sizeOfAttachment(attachment) || sizeOfAttachment(attachment) <= THUMBNAIL_MAX_BYTES)
)

// Small files first (they ride in the message request itself), big ones after
// (uploaded in chunks beforehand) - the same order the server stores them in.
export const orderForSending = (files) => [
  ...files.filter((file) => !isChunkedFile(file)),
  ...files.filter((file) => isChunkedFile(file))
]

// Applies the per-file rules (not empty, <= 400 MB) and the per-message cap to a
// newly picked batch. Returns the files that may be added plus a notice for the
// ones that may not ('' when everything was accepted).
export function acceptNewFiles(existing, picked) {
  const problems = []
  const accepted = []
  let skippedForLimit = 0
  for (const file of picked) {
    const problem = attachmentProblem(file)
    if (problem) { problems.push(problem); continue }
    if (existing.length + accepted.length >= MAX_ATTACHMENTS_PER_MESSAGE) { skippedForLimit += 1; continue }
    accepted.push(file)
  }
  if (skippedForLimit) {
    problems.push(`A message can have up to ${MAX_ATTACHMENTS_PER_MESSAGE} attachments - ${skippedForLimit} ${skippedForLimit === 1 ? 'file was' : 'files were'} not added.`)
  }
  return { accepted, notice: problems.join(' ') }
}

export const isCanceledError = (error) => (
  error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError' || error?.name === 'AbortError' || error?.cancelled === true
)

// Worth retrying: the request never got an answer (offline / timeout) or the server hit an error. A 4xx is final.
export const isRetryableError = (error) => (
  !isCanceledError(error) &&
  error?.retryable !== false &&
  !error?.userMessage &&
  (!error?.response || error.response.status >= 500 || error.response.status === 408 || error.response.status === 429)
)

export const sendErrorMessage = (error, fallback) => (
  error?.userMessage || error?.response?.data?.message || error?.message || fallback
)

// Uploads every big file (in order) and resolves the uploadIds to send with the
// message. `store` is a plain object the caller keeps for the life of the message
// ({ [fileIndex]: { uploadId, ready } }): a retry skips finished files and resumes
// a half-sent one. onFileProgress(fileIndex, fraction 0..1).
export async function uploadChunkedFiles({ api, files, store, signal, onFileProgress }) {
  const uploadIds = []
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    if (!isChunkedFile(file)) continue
    const record = store[index] || (store[index] = {})
    if (record.ready) {
      onFileProgress?.(index, 1)
      uploadIds.push(record.uploadId)
      continue
    }
    // Remember the id the server hands out on init, so a later retry can resume instead of restarting.
    const trackingApi = {
      get: (...args) => api.get(...args),
      put: (...args) => api.put(...args),
      delete: (...args) => api.delete(...args),
      post: async (url, ...rest) => {
        const response = await api.post(url, ...rest)
        if (url === '/chunked-uploads' && response?.data?.uploadId) record.uploadId = response.data.uploadId
        return response
      }
    }
    try {
      const result = await uploadFileInChunks(trackingApi, file, {
        signal,
        resumeUploadId: record.uploadId,
        onProgress: (fraction) => onFileProgress?.(index, fraction)
      })
      record.uploadId = result.uploadId
      record.ready = true
      uploadIds.push(result.uploadId)
    } catch (error) {
      if (isCanceledError(error)) delete store[index] // the server dropped the partial upload
      throw error
    }
  }
  return uploadIds
}

// Best-effort cleanup of uploads that finished but whose message never got sent (cancelled / discarded).
export function discardStagedUploads(api, store) {
  Object.values(store || {}).forEach((record) => {
    if (record?.uploadId) api.delete(`/chunked-uploads/${record.uploadId}`).catch(() => {})
  })
}

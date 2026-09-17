import { describe, expect, it } from 'vitest'
import { rehydrateBlobErrorBody } from './api'

// Regression coverage for the bug where a 401 during a PDF fetch
// (uscisFormsApi.templatePdf, formGenerationApi.preview/download - all
// requested with responseType: 'blob') forced a hard logout instead of a
// silent token refresh: axios decodes an errored blob request's body as a
// Blob, so error.response.data.code was always undefined even when the
// backend really did send {code: 'TOKEN_EXPIRED'}.
describe('rehydrateBlobErrorBody', () => {
  it('parses a JSON-typed Blob error body back into the object axios would have given a JSON request', async () => {
    const body = { success: false, message: 'Access token expired', code: 'TOKEN_EXPIRED' }
    const error = { response: { data: new Blob([JSON.stringify(body)], { type: 'application/json' }) } }

    await rehydrateBlobErrorBody(error)

    expect(error.response.data).toEqual(body)
  })

  it('leaves a non-JSON blob (a real PDF error page, if that ever happened) untouched', async () => {
    const blob = new Blob(['%PDF-1.4 not json'], { type: 'application/pdf' })
    const error = { response: { data: blob } }

    await rehydrateBlobErrorBody(error)

    expect(error.response.data).toBe(blob)
  })

  it('is a no-op when the error body was never a Blob (a plain JSON request)', async () => {
    const data = { success: false, message: 'Not found' }
    const error = { response: { data } }

    await rehydrateBlobErrorBody(error)

    expect(error.response.data).toBe(data)
  })

  it('is a no-op when there is no response at all (network error)', async () => {
    const error = { message: 'Network Error' }

    await expect(rehydrateBlobErrorBody(error)).resolves.toBeUndefined()
  })
})

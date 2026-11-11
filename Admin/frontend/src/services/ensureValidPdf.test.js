import { describe, it, expect } from 'vitest'
import { ensureValidPdf } from './api'

const blob = (text, type = 'application/pdf') => new Blob([text], { type })
const pdfBody = `%PDF-1.7\n${'x'.repeat(200)}`

describe('ensureValidPdf (both download buttons use it)', () => {
  it('lets a real PDF through unchanged', async () => {
    const response = { data: blob(pdfBody), headers: {} }
    await expect(ensureValidPdf(response)).resolves.toBe(response)
  })

  it('rejects an empty body, a too-small body, an error page and JSON that answered 200 - with the message the callers already show', async () => {
    for (const data of [blob(''), blob('%PDF-'), blob(`<html>${'x'.repeat(300)}</html>`, 'text/html'), blob(JSON.stringify({ message: 'x'.repeat(300) }), 'application/json'), undefined]) {
      await expect(ensureValidPdf({ data, status: 200 })).rejects.toMatchObject({ response: { data: { message: expect.stringMatching(/did not finish correctly/) } } })
    }
  })

  it('accepts an ArrayBuffer PDF too', async () => {
    const bytes = new TextEncoder().encode(pdfBody)
    const response = { data: bytes.buffer }
    await expect(ensureValidPdf(response)).resolves.toBe(response)
  })
})

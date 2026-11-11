import { describe, it, expect, vi } from 'vitest'
import { downloadOfficialForm, officialFormFileName } from './officialFormDownload'

const fakeDom = () => {
  const link = { click: vi.fn(), remove: vi.fn() }
  const doc = { createElement: vi.fn(() => link), body: { appendChild: vi.fn() } }
  const urlApi = { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }
  return { link, doc, urlApi }
}

describe('downloadOfficialForm (the forms-list Download = the opened form\'s Download Official Form)', () => {
  it('calls the same download-form endpoint, names the file <form>_<case id>_<date>.pdf and starts the download', async () => {
    const { link, doc, urlApi } = fakeDom()
    const api = { downloadForm: vi.fn().mockResolvedValue({ data: new Blob(['%PDF-']) }) }
    const result = await downloadOfficialForm({ caseFormId: 'f1', formCode: 'I-907', caseId: 'c9' }, { api, readWarnings: () => [], document: doc, urlApi })
    expect(api.downloadForm).toHaveBeenCalledWith('f1')
    expect(link.download).toMatch(/^I-907_c9_\d{4}-\d{2}-\d{2}\.pdf$/)
    expect(link.click).toHaveBeenCalledTimes(1)
    expect(urlApi.revokeObjectURL).not.toHaveBeenCalled() // not revoked at once (that can cut a large file off); it waits 60 s like the opened form
    expect(result).toEqual({ warnings: [], notice: '' })
  })

  it('returns the same wording as the opened form when there are fields to double-check', async () => {
    const { doc, urlApi } = fakeDom()
    const api = { downloadForm: vi.fn().mockResolvedValue({ data: new Blob(['%PDF-']) }) }
    const { notice } = await downloadOfficialForm({ caseFormId: 'f1', formCode: 'I-129', caseId: 'c1' }, { api, readWarnings: () => ['Line8e_State: matched to the form\'s choice "TX"'], document: doc, urlApi })
    expect(notice).toBe('Form downloaded. Please double-check these fields on the PDF: Line8e_State: matched to the form\'s choice "TX"')
  })

  it('lets the server error through for the caller to show, and starts no download', async () => {
    const { link, doc, urlApi } = fakeDom()
    const api = { downloadForm: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { response: { data: { message: 'nope' } } })) }
    await expect(downloadOfficialForm({ caseFormId: 'f1', formCode: 'I-129', caseId: 'c1' }, { api, readWarnings: () => [], document: doc, urlApi })).rejects.toMatchObject({ response: { data: { message: 'nope' } } })
    expect(link.click).not.toHaveBeenCalled()
  })

  it('file name falls back safely', () => {
    expect(officialFormFileName({ formCode: '', caseId: '', date: new Date('2026-11-11T10:00:00Z') })).toBe('uscis-form__2026-11-11.pdf')
  })
})

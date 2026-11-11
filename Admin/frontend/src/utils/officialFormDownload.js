import { formGenerationApi, readFormWarnings } from '../services/api'

// ONE way to download a case form's official PDF, the way the "Download Official Form" button inside an opened form does it: the same endpoint (download-form: the file is built
// from the form's current values, with the data-completeness safeguards), the same file name (<form>_<case id>_<date>.pdf), the same warning wording. The forms list uses this, so
// the two buttons cannot drift apart. (The opened form saves its own pending edits first - a list has none.)
export const OFFICIAL_DOWNLOAD_FAILED = 'Unable to download the official form. Please try again.'

export const officialFormFileName = ({ formCode, caseId, date = new Date() }) => `${formCode || 'uscis-form'}_${caseId || ''}_${date.toISOString().slice(0, 10)}.pdf`

// Downloads the form and returns { warnings, notice } (notice = the sentence to show the user, '' when there is nothing to double-check). Throws with the server's message on failure.
export async function downloadOfficialForm({ caseFormId, formCode, caseId }, { api = formGenerationApi, readWarnings = readFormWarnings, document: doc = document, urlApi = URL } = {}) {
  const response = await api.downloadForm(caseFormId)
  const url = urlApi.createObjectURL(response.data)
  const link = doc.createElement('a')
  link.href = url
  link.download = officialFormFileName({ formCode, caseId })
  doc.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => urlApi.revokeObjectURL(url), 60000)
  const warnings = readWarnings(response)
  return { warnings, notice: warnings.length ? `Form downloaded. Please double-check these fields on the PDF: ${warnings.join('; ')}` : '' }
}

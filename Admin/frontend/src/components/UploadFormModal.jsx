import { useState } from 'react'
import { formGovernanceApi } from '../services/api'
import { X, Upload, AlertTriangle } from 'lucide-react'

const readErrorMessage = (error, fallback) => {
  const message = error?.response?.data?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

const DISPOSITION_LABEL = {
  new_form: 'This is a form code the system has never seen before.',
  new_version: 'This will be published as a new edition/version of this form (the current one stays in service until you activate the new one).',
  same_edition_different_file: 'A template with this exact form code + edition already exists, but the file differs.',
  exact_duplicate: 'This exact file (byte-for-byte) is already registered — nothing new will be created.',
}

// Shared by both "Upload Form" (Form Governance page, any form code) and
// "Replace Form" (a form's own detail page, formCode locked to that form) -
// same two-step analyze→publish pipeline either way. lockedFormCode, when
// set, pre-fills and disables the form-code input (a replacement must stay
// the same form code so existing VisaFormMapping associations, which
// resolve by formCode string, keep applying automatically).
const UploadFormModal = ({ lockedFormCode, onClose, onPublished }) => {
  const [file, setFile] = useState(null)
  const [formCode, setFormCode] = useState(lockedFormCode || '')
  const [analyzing, setAnalyzing] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [analysis, setAnalysis] = useState(null)
  const [error, setError] = useState(null)

  const handleAnalyze = async () => {
    if (!file) { setError('Choose a PDF file first.'); return }
    setAnalyzing(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('pdf', file)
      if (formCode) formData.append('formType', formCode)
      const response = await formGovernanceApi.analyzeFormPdf(formData)
      const result = response.data.analysis || response.data.data
      setAnalysis(result)
      if (!lockedFormCode && result?.detected?.formCode) setFormCode(result.detected.formCode)
    } catch (err) {
      setError(readErrorMessage(err, 'This PDF could not be analyzed.'))
    } finally {
      setAnalyzing(false)
    }
  }

  const handlePublish = async () => {
    if (!file || !analysis) return
    setPublishing(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('pdf', file)
      formData.append('expectedSha256', analysis.sha256 || '')
      if (formCode) formData.append('formType', formCode)
      const response = await formGovernanceApi.uploadFormPdf(formData)
      onPublished({
        template: response.data.template,
        duplicate: response.data.duplicate,
        comparisonReport: response.data.comparisonReport,
        fieldCount: response.data.fieldCount,
      })
    } catch (err) {
      setError(readErrorMessage(err, 'This PDF could not be published.'))
    } finally {
      setPublishing(false)
    }
  }

  const disposition = analysis?.registry?.disposition
  const isExactDuplicate = disposition === 'exact_duplicate'
  const formCodeMismatch = lockedFormCode && analysis?.detected?.formCode && analysis.detected.formCode.toUpperCase() !== lockedFormCode.toUpperCase()

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <Upload className="w-5 h-5" /> {lockedFormCode ? `Replace ${lockedFormCode}` : 'Upload a Form'}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 space-y-4">
          {!lockedFormCode && (
            <p className="text-sm text-muted-foreground">
              Upload a real USCIS PDF directly. It's automatically normalized (qpdf), validated, and scanned for
              fillable fields — the same processing an on-demand uscis.gov fetch gets. Once published as a draft,
              you'll be taken to its mapping/case-type page to finish setting it up.
            </p>
          )}
          {lockedFormCode && (
            <p className="text-sm text-muted-foreground">
              Upload the new PDF for this form (e.g. a new USCIS edition). It goes through the same automatic
              processing, and every case type already mapped to {lockedFormCode} keeps working — nothing needs to
              be re-mapped.
            </p>
          )}

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">PDF file</label>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => { setFile(e.target.files?.[0] || null); setAnalysis(null); setError(null) }}
              className="w-full text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Form code</label>
            <input
              type="text"
              value={formCode}
              onChange={(e) => setFormCode(e.target.value)}
              disabled={Boolean(lockedFormCode)}
              placeholder="e.g. I-131"
              className="w-full border rounded px-3 py-2 text-sm disabled:bg-muted"
            />
          </div>

          {error && <p className="text-red-700 text-sm">{error}</p>}

          {!analysis && (
            <button onClick={handleAnalyze} disabled={!file || analyzing} className="btn-primary w-full disabled:opacity-50">
              {analyzing ? 'Analyzing…' : 'Analyze PDF'}
            </button>
          )}

          {analysis && (
            <div className="space-y-3 border-t pt-3">
              <div className="text-sm">
                <div><span className="text-muted-foreground">Detected form:</span> {analysis.detected?.formCode || 'Unknown'} — {analysis.detected?.title || 'no title detected'}</div>
                <div><span className="text-muted-foreground">Fillable fields found:</span> {analysis.pdf?.fieldCount ?? 0}</div>
              </div>

              <div className={`text-sm p-3 rounded ${isExactDuplicate ? 'bg-gray-100 text-gray-700' : 'bg-amber-50 text-amber-800'}`}>
                {DISPOSITION_LABEL[disposition] || 'Ready to publish.'}
              </div>

              {formCodeMismatch && (
                <div className="text-sm p-3 rounded bg-red-50 text-red-700 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  This PDF looks like {analysis.detected.formCode}, not {lockedFormCode} — double check you picked the right file before publishing.
                </div>
              )}

              {!analysis.pdf?.fillable && (
                <div className="text-sm p-3 rounded bg-red-50 text-red-700 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  No fillable fields were found in this PDF — it can't be used for autofill.
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => setAnalysis(null)} className="btn-secondary flex-1">Re-analyze</button>
                <button
                  onClick={handlePublish}
                  disabled={isExactDuplicate || !analysis.pdf?.fillable || publishing}
                  className="btn-primary flex-1 disabled:opacity-50"
                >
                  {publishing ? 'Publishing…' : lockedFormCode ? 'Publish replacement' : 'Publish'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default UploadFormModal

import { useEffect, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import api from '../services/api'
import { casesApi } from '../services/api'

// Case-Manager-facing EB-1A criterion review — the staff counterpart to
// Immiglance/Client's Eb1aCriteriaChecklist.jsx (read-only there). This is
// the ONLY place a criterion can be marked QUALIFIED/NOT_APPLICABLE/
// COMPARABLE_EVIDENCE_* — never derived automatically from upload count, per
// the business's explicit requirement. See Backend's
// eb1aChecklist.service.js for the shared status vocabulary.
const CRITERION_STATUSES = [
  'NOT_STARTED', 'IN_PROGRESS', 'EVIDENCE_UPLOADED', 'READY_FOR_REVIEW',
  'QUALIFIED', 'NOT_APPLICABLE', 'COMPARABLE_EVIDENCE_REVIEW',
  'COMPARABLE_EVIDENCE_ACCEPTED', 'COMPARABLE_EVIDENCE_REJECTED', 'REVIEW_REQUIRED',
]
const FINAL_MERITS_STATUSES = ['NOT_STARTED', 'IN_REVIEW', 'SUPPORTED', 'NEEDS_MORE_EVIDENCE', 'NOT_SUPPORTED', 'ATTORNEY_REVIEW']

function humanize(value) {
  return String(value || '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())
}

function EvidenceUpload({ caseId, item, onUploaded }) {
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const upload = async (files) => {
    setUploading(true)
    setError('')
    try {
      for (const file of files) {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('caseId', caseId)
        formData.append('documentType', item.documentType)
        formData.append('category', 'evidence')
        formData.append('legacySource', 'INSZoom')
        await api.post('/documents', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
      }
      onUploaded?.()
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to upload document.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
        {item.description && <p className="truncate text-xs text-muted-foreground">{item.description}</p>}
      </div>
      <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} className="btn-secondary inline-flex shrink-0 items-center gap-1.5 text-xs disabled:opacity-50">
        <Upload className="h-3.5 w-3.5" /> {uploading ? 'Uploading…' : 'Upload'}
      </button>
      <input ref={inputRef} type="file" multiple className="hidden" onChange={(event) => { const files = Array.from(event.target.files || []); if (files.length) upload(files); event.target.value = '' }} />
      {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
    </div>
  )
}

function CriterionRow({ caseId, criterion, onChanged }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState(criterion.completionStatus)
  const [notes, setNotes] = useState(criterion.notes || '')
  const [comparable, setComparable] = useState(criterion.comparableEvidenceDescription || '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setStatus(criterion.completionStatus)
    setNotes(criterion.notes || '')
    setComparable(criterion.comparableEvidenceDescription || '')
  }, [criterion.completionStatus, criterion.notes, criterion.comparableEvidenceDescription])

  const save = async () => {
    setSaving(true)
    try {
      await casesApi.updateEb1aCriterion(caseId, criterion.criterionId, { status, notes, comparableEvidenceDescription: comparable })
      onChanged?.()
    } finally {
      setSaving(false)
    }
  }

  const isQualified = criterion.completionStatus === 'QUALIFIED' || criterion.completionStatus === 'COMPARABLE_EVIDENCE_ACCEPTED'

  return (
    <div className="rounded-xl border border-border bg-card">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Criterion {criterion.criterionNumber}</p>
          <p className="truncate text-sm font-semibold text-foreground">{criterion.criterionTitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-xs text-muted-foreground">{criterion.uploadedDocumentsCount} doc(s)</span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${isQualified ? 'bg-blue-100 text-blue-800' : 'bg-muted text-muted-foreground'}`}>{humanize(criterion.completionStatus)}</span>
        </div>
      </button>

      {open && (
        <div className="space-y-4 border-t border-border p-4">
          <p className="text-sm text-muted-foreground">{criterion.criterionDescription}</p>

          <div className="space-y-2">
            {criterion.evidenceRequirements.map((item) => (
              <EvidenceUpload key={item.documentType} caseId={caseId} item={item} onUploaded={onChanged} />
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-semibold text-foreground">Criterion status (manual — never auto-set from uploads)</span>
              <select value={status} onChange={(event) => setStatus(event.target.value)} className="input-field text-sm">
                {CRITERION_STATUSES.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-semibold text-foreground">Comparable evidence description</span>
              <input value={comparable} onChange={(event) => setComparable(event.target.value)} className="input-field text-sm" placeholder="Only if this criterion doesn't readily apply" />
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold text-foreground">Reviewer notes</span>
            <textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} className="input-field text-sm" />
          </label>
          <div className="flex justify-end">
            <button type="button" onClick={save} disabled={saving} className="btn-primary text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Save criterion'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Eb1aCriteriaPanel({ caseId }) {
  const [view, setView] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [finalMeritsStatus, setFinalMeritsStatus] = useState('NOT_STARTED')
  const [finalMeritsNotes, setFinalMeritsNotes] = useState('')
  const [savingFinalMerits, setSavingFinalMerits] = useState(false)

  const load = () => {
    if (!caseId) return
    setLoading(true)
    setError('')
    casesApi.getEb1aCriteria(caseId)
      .then((response) => {
        setView(response.data)
        setFinalMeritsStatus(response.data.finalMerits?.status || 'NOT_STARTED')
        setFinalMeritsNotes(response.data.finalMerits?.notes || '')
      })
      .catch((err) => setError(err.response?.data?.message || 'Unable to load the EB-1A criteria checklist.'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [caseId])

  const saveFinalMerits = async () => {
    setSavingFinalMerits(true)
    try {
      await casesApi.updateEb1aFinalMerits(caseId, { status: finalMeritsStatus, notes: finalMeritsNotes })
      load()
    } finally {
      setSavingFinalMerits(false)
    }
  }

  if (loading) return <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Loading EB-1A criteria…</div>
  if (error || !view) return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error || 'Unable to load.'}</div>

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-foreground">EB-1A Extraordinary Ability — {view.qualifyingCriteriaCount} / {view.totalCriteria} Criteria Qualified</h3>
            <p className="mt-1 text-sm text-muted-foreground">Minimum threshold: {view.minimumCriteria} criteria. "3 qualified" is only the evidentiary threshold — it is never case approval; use Final Merits below for the overall verdict.</p>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${view.minimumThresholdReached ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'}`}>
            {view.minimumThresholdReached ? 'Minimum threshold reached' : 'Below minimum threshold'}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {view.criteria.map((criterion) => (
          <CriterionRow key={criterion.criterionId} caseId={caseId} criterion={criterion} onChanged={load} />
        ))}
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold text-foreground">Final Merits Review</h3>
        <p className="mt-1 text-sm text-muted-foreground">Separate from the evidentiary threshold — the attorney's overall assessment of the case.</p>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_2fr_auto] md:items-end">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold text-foreground">Status</span>
            <select value={finalMeritsStatus} onChange={(event) => setFinalMeritsStatus(event.target.value)} className="input-field text-sm">
              {FINAL_MERITS_STATUSES.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold text-foreground">Notes</span>
            <input value={finalMeritsNotes} onChange={(event) => setFinalMeritsNotes(event.target.value)} className="input-field text-sm" />
          </label>
          <button type="button" onClick={saveFinalMerits} disabled={savingFinalMerits} className="btn-primary text-sm disabled:opacity-50">{savingFinalMerits ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

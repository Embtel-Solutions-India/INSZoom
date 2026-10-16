import { useState, useEffect, useCallback } from 'react'
import { ClipboardCheck, Download, RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { goldenSetApi } from '../services/api'

// Phase 2: the golden set review, as a section of the Form Governance page. The reviewer reads each form box in plain language and answers Right / Wrong / Not sure.
// Everyone with a staff role can look; only the named reviewer (the API says who, and whether YOU are) can answer or sign off.
export const READ_ROLES = ['super_admin', 'admin', 'team_lead']
const PAGE = 20

const STATUS_FILTERS = [{ key: 'unanswered', label: 'Not answered yet' }, { key: 'unsure', label: 'Marked Not sure' }, { key: 'wrong', label: 'Marked Wrong' }, { key: 'right', label: 'Marked Right' }, { key: '', label: 'All boxes' }]
const BOX_KIND_TEXT = { text: 'text box', date: 'date box', checkbox: 'tick box', radio: 'option button', dropdown: 'drop-down list' }

const errorMessage = (error, fallback) => {
  const message = error?.response?.data?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

const Badge = ({ tone = 'gray', children }) => {
  const tones = { green: 'bg-green-100 text-green-800', amber: 'bg-amber-100 text-amber-800', red: 'bg-red-100 text-red-800', gray: 'bg-gray-100 text-gray-700', blue: 'bg-primary/10 text-primary' }
  return <span className={`px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${tones[tone] || tones.gray}`}>{children}</span>
}

const VERDICT = { right: { label: 'Right', tone: 'green' }, wrong: { label: 'Wrong', tone: 'red' }, unsure: { label: 'Not sure', tone: 'amber' } }

const Line = ({ label, children }) => (children ? <div className="text-sm"><span className="text-muted-foreground">{label}: </span><span className="text-foreground">{children}</span></div> : null)

export function EntryCard({ entry, canReview, onSave, saving }) {
  const current = entry.review
  const [wrongOpen, setWrongOpen] = useState(current?.verdict === 'wrong')
  const [correction, setCorrection] = useState(current?.correction || '')
  const [note, setNote] = useState(current?.note || '')
  const [localError, setLocalError] = useState('')

  const answer = (verdict) => onSave(entry, { verdict, correction: verdict === 'wrong' ? correction : '', note })
  const saveWrong = () => {
    if (correction.trim().length < 3) { setLocalError('Please say what this box should be filled with.'); return }
    setLocalError('')
    answer('wrong')
  }

  return (
    <div className="rounded-xl border border-border p-4 space-y-3" data-testid="golden-entry">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-foreground">Form {entry.formCode} <span className="font-normal text-muted-foreground">- {entry.where}</span></div>
        <div className="flex gap-2">{entry.heldOut && <Badge tone="blue">held-out form</Badge>}{current && <Badge tone={VERDICT[current.verdict].tone}>{VERDICT[current.verdict].label}</Badge>}</div>
      </div>

      <div className="space-y-1">
        <Line label="The box on the form is">{`"${entry.boxLabel}" (${BOX_KIND_TEXT[entry.boxKind] || entry.boxKind})`}</Line>
        <Line label="This box is about">{entry.belongsTo}</Line>
        <Line label="We fill it with">{entry.fillsWith}</Line>
        <Line label="How it is written">{entry.writtenAs}</Line>
        <Line label="Only when">{entry.onlyWhen}</Line>
        <Line label="If that is empty we use">{entry.ifEmpty}</Line>
        {entry.appearsTimes > 1 && <Line label="Appears on the form">{`${entry.appearsTimes} times (checked once)`}</Line>}
      </div>

      <div className="rounded-lg bg-muted/50 p-3 text-sm">
        <span className="text-muted-foreground">Example - sample client data </span><strong>{entry.example?.clientData}</strong><span className="text-muted-foreground"> → the box would show </span><strong>{entry.example?.boxShows}</strong>
      </div>

      {canReview ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2" role="group" aria-label={`Your answer for ${entry.ref}`}>
            <button type="button" disabled={saving} onClick={() => { setWrongOpen(false); answer('right') }} aria-pressed={current?.verdict === 'right'} className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${current?.verdict === 'right' ? 'bg-green-600 text-white border-green-600' : 'border-green-600 text-green-700 hover:bg-green-50'}`}>Right</button>
            <button type="button" disabled={saving} onClick={() => setWrongOpen(true)} aria-pressed={current?.verdict === 'wrong' || wrongOpen} className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${current?.verdict === 'wrong' ? 'bg-red-600 text-white border-red-600' : 'border-red-600 text-red-700 hover:bg-red-50'}`}>Wrong</button>
            <button type="button" disabled={saving} onClick={() => { setWrongOpen(false); answer('unsure') }} aria-pressed={current?.verdict === 'unsure'} className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${current?.verdict === 'unsure' ? 'bg-amber-500 text-white border-amber-500' : 'border-amber-500 text-amber-700 hover:bg-amber-50'}`}>Not sure</button>
          </div>
          {wrongOpen && (
            <div className="space-y-2">
              <label className="block text-sm text-foreground">What should this box be filled with instead?
                <textarea className="input-field w-full mt-1" rows={2} value={correction} onChange={(event) => setCorrection(event.target.value)} placeholder="For example: the employer's last name, not the worker's" />
              </label>
              <label className="block text-sm text-foreground">Notes (optional)
                <input className="input-field w-full mt-1" value={note} onChange={(event) => setNote(event.target.value)} />
              </label>
              {localError && <p role="alert" className="text-sm text-red-600">{localError}</p>}
              <button type="button" className="btn-primary text-sm" disabled={saving} onClick={saveWrong}>Save "Wrong"</button>
            </div>
          )}
          {current?.verdict === 'wrong' && !wrongOpen && current.correction && <p className="text-sm text-muted-foreground">You said it should be: {current.correction}</p>}
        </div>
      ) : current?.verdict === 'wrong' && current.correction ? <p className="text-sm text-muted-foreground">Reviewer says it should be: {current.correction}</p> : null}
    </div>
  )
}

const GoldenSetReviewSection = () => {
  const { user } = useAuth()
  const allowed = READ_ROLES.includes(user?.role)
  const [summary, setSummary] = useState(null)
  const [list, setList] = useState({ total: 0, entries: [] })
  const [formCode, setFormCode] = useState('')
  const [status, setStatus] = useState('unanswered')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [signing, setSigning] = useState(false)
  const [notice, setNotice] = useState('')

  const loadSummary = useCallback(async () => {
    const response = await goldenSetApi.summary()
    setSummary(response.data.data)
  }, [])

  const loadEntries = useCallback(async () => {
    const response = await goldenSetApi.entries({ formCode: formCode || undefined, status: status || undefined, search: search || undefined, offset, limit: PAGE })
    setList(response.data.data)
  }, [formCode, status, search, offset])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      await Promise.all([loadSummary(), loadEntries()])
      setError('')
    } catch (err) {
      setError(errorMessage(err, 'Could not load the golden set.'))
    } finally {
      setLoading(false)
    }
  }, [loadSummary, loadEntries])

  useEffect(() => { if (allowed) load() }, [allowed, load])

  const save = async (entry, payload) => {
    setSaving(true)
    setNotice('')
    try {
      await goldenSetApi.review(entry.id, payload)
      await Promise.all([loadSummary(), loadEntries()])
    } catch (err) {
      setNotice(errorMessage(err, 'Could not save your answer. Please try again.'))
    } finally {
      setSaving(false)
    }
  }

  const signOff = async () => {
    setSigning(true)
    setNotice('')
    try {
      await goldenSetApi.signOff()
      setConfirm(false)
      setNotice('Signed off. Thank you - the golden set is now recorded as reviewed.')
      await loadSummary()
    } catch (err) {
      setNotice(errorMessage(err, 'Could not sign off.'))
    } finally {
      setSigning(false)
    }
  }

  const download = async () => {
    try {
      const response = await goldenSetApi.exportCsv()
      const url = URL.createObjectURL(new Blob([response.data], { type: 'text/csv' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'golden-set-review.csv'
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setNotice(errorMessage(err, 'Could not download the spreadsheet.'))
    }
  }

  if (!allowed) return null

  const canReview = Boolean(summary?.you?.canReview)
  const percent = summary?.total ? Math.round((summary.answered / summary.total) * 100) : 0
  const pages = Math.max(1, Math.ceil((list.total || 0) / PAGE))
  const page = Math.floor(offset / PAGE) + 1

  return (
    <div className="card space-y-4" data-testid="golden-set-review">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2"><ClipboardCheck className="w-5 h-5" /> Golden Set Review</h2>
          <p className="text-sm text-muted-foreground mt-1">An answer key: for each form box below, what it is filled with. A reviewer checks every one against the official USCIS form. Nothing here changes how any form is filled today.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button type="button" onClick={download} className="btn-secondary text-sm flex items-center gap-1"><Download className="w-4 h-4" /> Spreadsheet</button>
          <button type="button" onClick={load} className="btn-secondary text-sm flex items-center gap-1" disabled={loading}><RefreshCw className="w-4 h-4" /> Refresh</button>
        </div>
      </div>

      {summary && (
        <div className="space-y-3" data-testid="golden-summary">
          {!canReview && <p className="text-sm rounded-lg bg-amber-50 text-amber-800 p-3" data-testid="not-reviewer">You can look at this, but only <strong>{(summary.reviewers || []).join(' / ')}</strong> can answer and sign off.</p>}
          <div>
            <div className="flex items-baseline justify-between text-sm"><span>Answered</span><strong>{summary.answered} of {summary.total} ({percent}%)</strong></div>
            <div className="h-2 rounded-full bg-muted mt-1" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><div className="h-2 rounded-full bg-primary-600" style={{ width: `${percent}%` }} /></div>
            <p className="text-xs text-muted-foreground mt-1">Right: {summary.counts.right} · Wrong: {summary.counts.wrong} · Not sure: {summary.counts.unsure} · Not answered: {summary.counts.unanswered}</p>
          </div>

          {summary.signOff && <p className="text-sm" data-testid="signed-off"><Badge tone={summary.signOff.upToDate ? 'green' : 'amber'}>{summary.signOff.upToDate ? 'Signed off' : 'Sign-off out of date'}</Badge> by {summary.signOff.reviewerEmail} on {new Date(summary.signOff.signedAt).toLocaleString()}{summary.signOff.upToDate ? '' : ' - the list changed since, so it needs a new review and sign-off.'}</p>}

          <div className="flex flex-wrap gap-2">
            {summary.perForm.map((form) => (
              <button key={form.formCode} type="button" onClick={() => { setFormCode(formCode === form.formCode ? '' : form.formCode); setOffset(0) }} aria-pressed={formCode === form.formCode}
                className={`px-2 py-1 rounded-lg border text-xs ${formCode === form.formCode ? 'border-primary-600 bg-primary-600 text-white' : 'border-border text-foreground hover:bg-muted'}`} title={form.formName}>
                {form.formCode} <strong>{form.answered}/{form.total}</strong>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex flex-wrap" role="group" aria-label="Filter by answer">
          {STATUS_FILTERS.map((item, index) => (
            <button key={item.key || 'all'} type="button" onClick={() => { setStatus(item.key); setOffset(0) }} aria-pressed={status === item.key}
              className={`border px-3 py-1.5 text-xs font-semibold ${index === 0 ? 'rounded-l-lg' : '-ml-px'} ${index === STATUS_FILTERS.length - 1 ? 'rounded-r-lg' : ''} ${status === item.key ? 'border-primary-600 bg-primary-600 text-white' : 'border-border bg-card text-muted-foreground hover:text-foreground'}`}>
              {item.label}
            </button>
          ))}
        </div>
        <input className="input-field flex-1 min-w-[180px]" placeholder="Search a box or a word..." value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0) }} aria-label="Search the golden set" />
      </div>

      {notice && <p role="status" className="text-sm text-foreground">{notice}</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : list.entries.length === 0 ? <p className="text-sm text-muted-foreground py-4 text-center">Nothing to show here.</p> : (
        <div className="space-y-3">
          {list.entries.map((entry) => <EntryCard key={`${entry.id}-${entry.review?.verdict || 'none'}-${entry.review?.reviewedAt || ''}`} entry={entry} canReview={canReview} onSave={save} saving={saving} />)}
          <div className="flex items-center justify-between text-sm">
            <button type="button" className="btn-secondary text-xs" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
            <span className="text-muted-foreground">Page {page} of {pages} · {list.total} box(es)</span>
            <button type="button" className="btn-secondary text-xs" disabled={offset + PAGE >= list.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
          </div>
        </div>
      )}

      {summary && canReview && (
        <div className="rounded-xl border border-border p-4 space-y-2" data-testid="sign-off-panel">
          <h3 className="font-semibold text-foreground">Sign off</h3>
          {summary.blockers.length > 0 ? (
            <ul className="text-sm text-muted-foreground list-disc pl-5">{summary.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
          ) : (
            <>
              <label className="flex items-start gap-2 text-sm text-foreground"><input type="checkbox" className="mt-1" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} /> I have checked every answer in this golden set against the official USCIS form and confirm that the answers marked Right are correct.</label>
              <button type="button" className="btn-primary text-sm" disabled={!confirm || signing} onClick={signOff}>{signing ? 'Signing...' : 'Sign off the golden set'}</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default GoldenSetReviewSection

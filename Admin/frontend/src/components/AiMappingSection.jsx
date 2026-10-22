import { useCallback, useEffect, useState } from 'react'
import { aiMappingApi } from '../services/api'
import { Badge, unwrap, errorMessage, plainPath, words } from './governanceShared'

// Phase 5 view of the AI mapping engine (Phase 4), read-only: which mode it is in, whether the accuracy gate is open, how many suggestions each form has per tier, and the
// stored suggestions themselves. The mode is a server setting; nothing on this screen changes a mapping.
const MODE_TEXT = {
  off: { label: 'Off', tone: 'gray', text: 'The AI makes no suggestions.' },
  shadow: { label: 'Suggesting only', tone: 'amber', text: 'The AI makes suggestions that are stored for review. Nothing is applied to any form.' },
  on: { label: 'On', tone: 'blue', text: 'The AI is switched on. It still applies nothing to a form until the accuracy gate is open.' },
}
const TIER_TEXT = { auto_use: { label: 'Safe to use', tone: 'green' }, needs_review: { label: 'Needs a look', tone: 'amber' }, rejected: { label: 'Turned down', tone: 'red' } }

const gateInfo = (gate) => {
  if (!gate) return { open: false, label: 'Closed', tone: 'gray', text: 'Not reported yet, so it is treated as closed: the AI cannot change any form.' }
  if (gate.open === true) return { open: true, label: 'Open', tone: 'green', text: 'The accuracy checks have passed, so safe suggestions may be applied.' }
  return { open: false, label: 'Closed', tone: 'amber', text: 'The accuracy checks have not all passed yet, so the AI cannot change any form.' }
}

const AiMappingSection = ({ forms = [] }) => {
  const [status, setStatus] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [formCode, setFormCode] = useState('')
  const [tier, setTier] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [statusResponse, rows] = await Promise.all([
        aiMappingApi.status(),
        aiMappingApi.suggestions({ formCode: formCode || undefined, tier: tier || undefined, limit: 100 }),
      ])
      setStatus(unwrap(statusResponse))
      const list = unwrap(rows)
      setSuggestions(Array.isArray(list) ? list : list?.items || [])
      setError('')
    } catch (err) {
      setError(errorMessage(err, 'Could not load the AI mapping status.'))
    } finally {
      setLoading(false)
    }
  }, [formCode, tier])
  useEffect(() => { load() }, [load])

  const mode = MODE_TEXT[status?.mode] || { label: status?.mode ? words(status.mode) : 'Not known', tone: 'gray', text: '' }
  const gate = gateInfo(status?.gate)
  const perForm = Object.entries(status?.forms || {}).sort(([a], [b]) => a.localeCompare(b))
  const formCodes = [...new Set([...(forms || []).map((row) => row.formCode), ...perForm.map(([code]) => code)].filter(Boolean))].sort()

  return (
    <div className="space-y-4" data-testid="ai-mapping">
      {error && <div role="alert" className="text-sm rounded-lg border border-red-300 text-red-700 px-3 py-2">{error}</div>}
      {loading && !status ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

      {status && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-3 space-y-1" data-testid="ai-mode">
              <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-foreground">AI mapping</span><Badge tone={mode.tone}>{mode.label}</Badge></div>
              <p className="text-xs text-muted-foreground">{mode.text}</p>
            </div>
            <div className="rounded-lg border border-border p-3 space-y-1" data-testid="ai-gate">
              <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-foreground">Accuracy gate</span><Badge tone={gate.tone}>{gate.label}</Badge></div>
              <p className="text-xs text-muted-foreground">{gate.text}</p>
              {status?.mode === 'on' && !gate.open && <p className="text-xs text-amber-800">The mode is on, but nothing is applied to any form until the gate opens.</p>}
            </div>
          </div>

          <section className="space-y-2" data-testid="ai-counts">
            <h3 className="text-sm font-semibold text-foreground">Suggestions per form</h3>
            {perForm.length === 0 ? <p className="text-sm text-muted-foreground">No suggestions have been made yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3">Form</th><th className="py-1 pr-3">Safe to use</th><th className="py-1 pr-3">Needs a look</th><th className="py-1 pr-3">Turned down</th><th className="py-1">Applied</th></tr></thead>
                  <tbody>
                    {perForm.map(([code, row]) => (
                      <tr key={code} className="border-t border-border/60">
                        <td className="py-1.5 pr-3 font-medium">{code}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{row.auto_use ?? 0}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{row.needs_review ?? 0}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{row.rejected ?? 0}</td>
                        <td className="py-1.5 tabular-nums">{row.applied ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="space-y-2" data-testid="ai-suggestions">
            <h3 className="text-sm font-semibold text-foreground">Stored suggestions <span className="text-muted-foreground font-normal">(read-only)</span></h3>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-muted-foreground">Form<select className="input text-sm block" aria-label="Suggestion form" value={formCode} onChange={(event) => setFormCode(event.target.value)}><option value="">All forms</option>{formCodes.map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
              <label className="text-xs text-muted-foreground">Result<select className="input text-sm block" aria-label="Suggestion result" value={tier} onChange={(event) => setTier(event.target.value)}><option value="">All</option>{Object.entries(TIER_TEXT).map(([key, info]) => <option key={key} value={key}>{info.label}</option>)}</select></label>
            </div>
            {suggestions.length === 0 ? <p className="text-sm text-muted-foreground">No suggestions to show.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3">Form</th><th className="py-1 pr-3">Box</th><th className="py-1 pr-3">Suggested source</th><th className="py-1 pr-3">Result</th><th className="py-1">Why</th></tr></thead>
                  <tbody>
                    {suggestions.map((row, index) => {
                      const info = TIER_TEXT[row.tier] || { label: words(row.tier), tone: 'gray' }
                      return (
                        <tr key={`${row.formCode}-${row.targetFieldId}-${index}`} className="border-t border-border/60 align-top">
                          <td className="py-1.5 pr-3 font-medium">{row.formCode}</td>
                          <td className="py-1.5 pr-3">{words(String(row.targetFieldId || row.targetPdfField || '').split('.').pop())}</td>
                          <td className="py-1.5 pr-3">{row.candidate?.path ? plainPath(row.candidate.path) : 'nothing fits'}</td>
                          <td className="py-1.5 pr-3"><Badge tone={info.tone}>{info.label}</Badge></td>
                          <td className="py-1.5 text-muted-foreground">{(row.reasons || []).length ? row.reasons.map(words).join('; ') : '-'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

export default AiMappingSection

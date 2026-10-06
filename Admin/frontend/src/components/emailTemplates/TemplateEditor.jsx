import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BellRing, ArrowLeft, Save, Power, PowerOff, Copy, Archive, Send, AlertTriangle, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { emailTemplatesApi } from '../../services/api'
import RichTextEditor from './RichTextEditor'
import { VariableInput } from './VariableSuggest'
import VariablePicker from './VariablePicker'
import RecipientsEditor from './RecipientsEditor'
import EmailPreview from './EmailPreview'

const STATUS_BADGE = {
  draft: ['Draft', 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'],
  active: ['Active', 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300'],
  inactive: ['Inactive', 'bg-secondary text-muted-foreground'],
  archived: ['Archived', 'bg-secondary text-muted-foreground'],
}
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/
const TOKEN_RE = /\[([a-z][a-z_]*\.[a-z][a-z_]*)\]/g

const editable = (form) => ({
  name: form.name, description: form.description, category: form.category, subject: form.subject,
  heading: form.heading, body: form.body, triggerKey: form.triggerKey || null, recipients: form.recipients, sendEmail: form.sendEmail !== false,
})

function Section({ title, description, children }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}
const Field = ({ label, htmlFor, children, hint }) => (
  <div>
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
    {children}
    {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
  </div>
)

export default function TemplateEditor({ initial, meta, onBack, onChanged }) {
  const [form, setForm] = useState(initial)
  const [baseline, setBaseline] = useState(() => JSON.stringify(editable(initial)))
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState(null)
  const [testOpen, setTestOpen] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [activeField, setActiveField] = useState('body')
  const subjectRef = useRef(null)
  const headingRef = useRef(null)
  const bodyRef = useRef(null)

  const dirty = JSON.stringify(editable(form)) !== baseline
  const isNew = !form.id
  const trigger = useMemo(() => meta.triggers.find((t) => t.key === form.triggerKey) || null, [meta, form.triggerKey])
  const knownVariables = useMemo(() => new Map(meta.variables.map((v) => [v.key, v])), [meta])
  // What type-ahead / Insert variable may offer: only variables this trigger can supply.
  const suggestable = useMemo(
    () => meta.variables.filter((v) => !trigger || v.group === 'System' || trigger.groups.includes(v.group)),
    [meta, trigger],
  )
  const isEmailVariable = (value) => { const m = /^\[([a-z][a-z_]*\.[a-z][a-z_]*)\]$/.exec(String(value || '').trim()); return Boolean(m && knownVariables.get(m[1])?.email) }

  // Highlight misspelled / unavailable variables as the admin types - same
  // rules the server enforces on save (emailVariables.registry.js).
  const tokenIssues = useMemo(() => {
    const unknown = []
    const unavailable = []
    const text = [form.subject, form.heading, form.body].join('\n')
    for (const [, key] of text.matchAll(TOKEN_RE)) {
      const variable = knownVariables.get(key)
      if (!variable) { if (!unknown.includes(key)) unknown.push(key) }
      else if (trigger && variable.group !== 'System' && !trigger.groups.includes(variable.group) && !unavailable.includes(key)) unavailable.push(key)
    }
    return { unknown, unavailable }
  }, [form.subject, form.heading, form.body, knownVariables, trigger])
  const hasIssues = tokenIssues.unknown.length + tokenIssues.unavailable.length > 0
  const subjectHasIssue = [...tokenIssues.unknown, ...tokenIssues.unavailable].some((key) => form.subject.includes(`[${key}]`))
  const headingHasIssue = [...tokenIssues.unknown, ...tokenIssues.unavailable].some((key) => form.heading.includes(`[${key}]`))

  const toastTimer = useRef(null)
  const notify = useCallback((type, message) => {
    setToast({ type, message })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 5000)
  }, [])
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  // Warn on tab close / reload with unsaved edits.
  useEffect(() => {
    if (!dirty) return undefined
    const handler = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const set = (patch) => setForm((current) => ({ ...current, ...patch }))

  const insertVariable = (token) => {
    if (activeField === 'body') { bodyRef.current?.insertText(token); return }
    const input = activeField === 'subject' ? subjectRef.current : headingRef.current
    if (!input) return
    const value = input.value
    const start = input.selectionStart ?? value.length
    const end = input.selectionEnd ?? value.length
    const next = value.slice(0, start) + token + value.slice(end)
    set({ [activeField]: next })
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(start + token.length, start + token.length) })
  }

  const loadBuiltIn = useCallback(async (triggerKey, { confirmReplace }) => {
    if (confirmReplace && !window.confirm('Replace the current subject, heading and body with the built-in wording for this trigger?')) return
    setBusy('defaults')
    try {
      const res = await emailTemplatesApi.defaults(triggerKey)
      const d = res.data.data
      setForm((current) => ({
        ...current, subject: d.subject, heading: d.heading, body: d.body,
        name: current.name || d.name, description: current.description || d.description,
        category: current.category || d.category,
        recipients: (current.recipients.to.length + current.recipients.cc.length + current.recipients.bcc.length) ? current.recipients : d.recipients,
      }))
    } catch (err) {
      notify('error', err.response?.data?.message || 'Could not load the built-in wording')
    } finally {
      setBusy('')
    }
  }, [notify])

  const onTriggerChange = (key) => {
    set({ triggerKey: key || null })
    const untouched = !form.subject.trim() && !form.body.trim()
    if (key && untouched) loadBuiltIn(key, { confirmReplace: false })
  }

  const validateLocally = () => {
    if (!form.name.trim()) return 'Give the template a name'
    if (!form.subject.trim()) return 'Subject is required'
    if (!form.body.trim()) return 'The email body is empty'
    if (hasIssues) return 'Fix the highlighted variables before saving'
    const badCustom = [...form.recipients.to, ...form.recipients.cc, ...form.recipients.bcc].find((r) => r.type === 'custom' && !EMAIL_RE.test(r.value || '') && !isEmailVariable(r.value))
    return badCustom ? `Invalid custom email: ${badCustom.value || '(empty)'}` : null
  }

  // Returns the persisted template, or null on failure (toast already shown).
  const persist = async () => {
    const problem = validateLocally()
    if (problem) { notify('error', problem); return null }
    const payload = editable(form)
    try {
      const res = form.id ? await emailTemplatesApi.update(form.id, payload) : await emailTemplatesApi.create(payload)
      const saved = res.data.data
      const next = { ...form, id: saved._id, status: saved.status }
      setForm(next)
      setBaseline(JSON.stringify(editable(next)))
      onChanged?.()
      return saved
    } catch (err) {
      notify('error', err.response?.data?.message || 'Could not save the template')
      return null
    }
  }

  const run = async (name, fn) => { setBusy(name); try { await fn() } finally { setBusy('') } }

  const save = () => run('save', async () => {
    const saved = await persist()
    if (saved) notify('success', form.status === 'active' ? 'Saved - the next email sent will use these changes' : 'Draft saved - not live until you click Activate')
  })

  const activate = () => run('activate', async () => {
    const saved = (dirty || isNew) ? await persist() : { _id: form.id }
    if (!saved) return
    try {
      await emailTemplatesApi.activate(saved._id)
      setForm((current) => ({ ...current, id: saved._id, status: 'active' }))
      onChanged?.()
      notify('success', 'Live - every email sent from now on uses this version')
    } catch (err) {
      notify('error', err.response?.data?.message || 'Could not activate the template')
    }
  })

  const deactivate = () => run('deactivate', async () => {
    if (!window.confirm('Deactivate this template? The built-in version of this email will be sent instead.')) return
    try {
      await emailTemplatesApi.deactivate(form.id)
      set({ status: 'inactive' })
      onChanged?.()
      notify('success', 'Deactivated — the built-in email is being sent again')
    } catch (err) {
      notify('error', err.response?.data?.message || 'Could not deactivate the template')
    }
  })

  const duplicate = () => run('duplicate', async () => {
    if (dirty) { notify('error', 'Save your changes before duplicating'); return }
    try {
      const res = await emailTemplatesApi.duplicate(form.id)
      onChanged?.()
      onBack({ openId: res.data.data._id })
    } catch (err) {
      notify('error', err.response?.data?.message || 'Could not duplicate the template')
    }
  })

  const archive = () => run('archive', async () => {
    if (!window.confirm('Archive this template? If it is active, the built-in email will be sent again. This can be restored by an administrator.')) return
    try {
      await emailTemplatesApi.archive(form.id)
      onChanged?.()
      onBack({ force: true })
    } catch (err) {
      notify('error', err.response?.data?.message || 'Could not archive the template')
    }
  })

  const sendTest = () => run('test', async () => {
    if (!EMAIL_RE.test(testTo.trim())) { notify('error', 'Enter a valid test email address'); return }
    try {
      const res = await emailTemplatesApi.sendTest({ to: testTo.trim(), subject: form.subject, heading: form.heading, body: form.body, triggerKey: form.triggerKey })
      notify('success', res.data.message || 'Test email sent')
      setTestOpen(false)
    } catch (err) {
      notify('error', err.response?.data?.message || 'Could not send the test email')
    }
  })

  const handleBack = () => {
    if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) return
    onBack({ force: true })
  }

  const [badgeLabel, badgeClass] = STATUS_BADGE[form.status] || STATUS_BADGE.draft
  const groupedTriggers = useMemo(() => {
    const map = new Map()
    meta.triggers.filter((t) => !t.locked && t.available !== false).forEach((t) => { map.set(t.category, [...(map.get(t.category) || []), t]) })
    return [...map.entries()]
  }, [meta])

  return (
    // On desktop the editor fills the viewport under the app header: the left
    // half scrolls on its own while the preview stays put. (position:sticky
    // can't work here - the layout's <main> is an overflow container that
    // doesn't itself scroll.)
    <div className="space-y-4 lg:flex lg:h-[calc(100vh-7.5rem)] lg:flex-col">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 lg:shrink-0">
        <button onClick={handleBack} className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Templates
        </button>
        <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h2 className="truncate text-base font-semibold text-foreground">{form.name || 'Untitled template'}</h2>
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeClass}`}>{isNew ? 'New' : badgeLabel}</span>
          {dirty && <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-amber-600"><span className="h-2 w-2 rounded-full bg-amber-500" /> Unsaved changes</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <button onClick={() => setTestOpen((o) => !o)} className="btn-secondary flex items-center gap-1.5 text-sm"><Send className="h-4 w-4" /> Send test</button>
            {testOpen && (
              <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-border bg-popover p-4 shadow-lg">
                <p className="text-sm font-medium text-foreground">Send a test email</p>
                <p className="mt-1 text-xs text-muted-foreground">Sent only to this address, with sample data. It never goes to real case contacts.</p>
                <input
                  autoFocus type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') sendTest() }}
                  placeholder="you@example.com" className="input-field mt-3"
                />
                <div className="mt-3 flex justify-end gap-2">
                  <button onClick={() => setTestOpen(false)} className="btn-secondary text-xs">Cancel</button>
                  <button onClick={sendTest} disabled={busy === 'test'} className="btn-primary flex items-center gap-1.5 text-xs">
                    {busy === 'test' && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Send test
                  </button>
                </div>
              </div>
            )}
          </div>
          {!isNew && <button onClick={duplicate} disabled={!!busy} className="btn-secondary flex items-center gap-1.5 text-sm"><Copy className="h-4 w-4" /> Duplicate</button>}
          {!isNew && form.status !== 'archived' && <button onClick={archive} disabled={!!busy} className="btn-secondary flex items-center gap-1.5 text-sm text-destructive"><Archive className="h-4 w-4" /> Archive</button>}
          <button onClick={save} disabled={!!busy || (!dirty && !isNew)} className="btn-secondary flex items-center gap-1.5 text-sm disabled:opacity-50">
            {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {form.status === 'active' ? 'Save changes' : 'Save draft'}
          </button>
          {form.status === 'active' ? (
            <button onClick={deactivate} disabled={!!busy} className="btn-secondary flex items-center gap-1.5 text-sm"><PowerOff className="h-4 w-4" /> Deactivate</button>
          ) : (
            <button onClick={activate} disabled={!!busy || form.status === 'archived'} className="btn-primary flex items-center gap-1.5 text-sm">
              {busy === 'activate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />} Activate
            </button>
          )}
        </div>
      </div>

      {form.status !== 'active' && form.status !== 'archived' && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 lg:shrink-0">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {form.status === 'inactive'
              ? 'This template is inactive, so the built-in version of this email is being sent.'
              : 'This is a draft - customers still receive the built-in version of this email.'}
            {' '}Click <strong>Activate</strong> to make every future email use this version.
          </span>
        </div>
      )}

      {toast && (
        <div role="status" className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm lg:shrink-0 ${toast.type === 'success' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {toast.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />} {toast.message}
        </div>
      )}

      {/* Two halves: editor | live preview */}
      <div className="grid grid-cols-1 gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-2">
        <div className="min-w-0 space-y-4 lg:h-full lg:overflow-y-auto lg:pr-2">
          <Section title="Basic information">
            <Field label="Template name" htmlFor="tpl-name">
              <input id="tpl-name" value={form.name} onChange={(e) => set({ name: e.target.value })} className="input-field" placeholder="e.g. RFE Received Notification" />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Category" htmlFor="tpl-category">
                <select id="tpl-category" value={form.category} onChange={(e) => set({ category: e.target.value })} className="input-field">
                  {[...new Set([form.category, ...meta.categories])].filter(Boolean).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <div className="flex h-[2.6rem] items-center"><span className={`rounded-full px-3 py-1 text-xs font-medium ${badgeClass}`}>{isNew ? 'Not saved yet' : badgeLabel}</span></div>
              </Field>
            </div>
            <Field label="Description (optional)" htmlFor="tpl-desc">
              <input id="tpl-desc" value={form.description} onChange={(e) => set({ description: e.target.value })} className="input-field" placeholder="What is this email for?" />
            </Field>
          </Section>

          <Section title="When is this email sent?" description="Pick the event that sends it. Only emails the application already sends are listed.">
            <Field label="Trigger" htmlFor="tpl-trigger">
              <select id="tpl-trigger" value={form.triggerKey || ''} onChange={(e) => onTriggerChange(e.target.value)} disabled={form.status === 'active'} className="input-field disabled:opacity-60">
                <option value="">Select a trigger…</option>
                {groupedTriggers.map(([category, items]) => (
                  <optgroup key={category} label={category}>
                    {items.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </Field>
            {trigger && <p className="text-xs text-muted-foreground">{trigger.description}</p>}
            {trigger?.builtIn === false && (
              <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                <BellRing className="mt-0.5 h-4 w-4 shrink-0" />
                <span>When this happens the person also gets an in-app notification and a browser push notification (<strong>{trigger.push?.title}</strong>) — that is sent automatically. The email below is only sent once this template is <strong>activated</strong>.</span>
              </div>
            )}
            {form.status === 'active' && <p className="text-xs text-muted-foreground">Deactivate this template to change its trigger.</p>}
            {trigger?.sendRule && (
              <div className="space-y-2 rounded-lg border border-border bg-secondary/30 p-3 text-xs">
                <p><span className="font-semibold text-foreground">Sent when:</span> <span className="text-muted-foreground">{trigger.sendRule.when}</span></p>
                <p><span className="font-semibold text-foreground">Not sent when:</span> <span className="text-muted-foreground">{trigger.sendRule.unless}</span></p>
                <p className="text-muted-foreground">
                  {trigger.emailAuto
                    ? 'This email is sent automatically. Activating your template changes its wording; the switch below turns it off.'
                    : 'This event always sends the in-app and push alert; the email is only sent once you activate a template.'}
                  {' '}It is never sent to the person who performed the action, to accounts that cannot log in yet, to placeholder addresses, or twice for the same case within a few minutes.
                </p>
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input type="checkbox" checked={form.sendEmail !== false} onChange={(e) => set({ sendEmail: e.target.checked })} />
                  Send this email{form.sendEmail === false ? ' (currently OFF — only the alerts are sent)' : ''}
                </label>
              </div>
            )}
          </Section>

          <Section title="Email content">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <VariablePicker
                variables={meta.variables} groups={meta.variableGroups} allowedGroups={trigger?.groups || null}
                onPick={insertVariable} targetLabel={activeField}
              />
              <p className="text-xs text-muted-foreground">Type <code className="rounded bg-secondary px-1">[</code> in any field to pick a variable, e.g. <code className="rounded bg-secondary px-1">[client.name]</code>. They are filled in when the email is sent.</p>
            </div>
            <Field label="Subject" htmlFor="tpl-subject">
              <VariableInput
                id="tpl-subject" ref={subjectRef} value={form.subject} onChange={(value) => set({ subject: value })} variables={suggestable}
                onFocus={() => setActiveField('subject')}
                className={`input-field ${subjectHasIssue ? '!border-destructive !ring-1 !ring-destructive' : ''}`} placeholder="Action required for your immigration case"
              />
            </Field>
            <Field label="Heading" htmlFor="tpl-heading" hint="Large title at the top of the email.">
              <VariableInput
                id="tpl-heading" ref={headingRef} value={form.heading} onChange={(value) => set({ heading: value })} variables={suggestable}
                onFocus={() => setActiveField('heading')}
                className={`input-field ${headingHasIssue ? '!border-destructive !ring-1 !ring-destructive' : ''}`}
              />
            </Field>
            <Field label="Body">
              <RichTextEditor ref={bodyRef} variables={suggestable} linkPresets={meta.linkPresets || []} value={form.body} onChange={(html) => set({ body: html })} onFocus={() => setActiveField('body')} />
            </Field>
            {hasIssues && (
              <div role="alert" className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1">
                  {tokenIssues.unknown.length > 0 && <p>Unknown variable{tokenIssues.unknown.length > 1 ? 's' : ''}: {tokenIssues.unknown.map((k) => <code key={k} className="mx-0.5 rounded bg-red-100 px-1">[{k}]</code>)} — check the spelling or use Insert variable.</p>}
                  {tokenIssues.unavailable.length > 0 && <p>Not available for this trigger: {tokenIssues.unavailable.map((k) => <code key={k} className="mx-0.5 rounded bg-red-100 px-1">[{k}]</code>)}</p>}
                </div>
              </div>
            )}
          </Section>

          <Section title="Recipients" description="Who receives this email. Roles are looked up from the actual case when the email is sent.">
            <RecipientsEditor recipients={form.recipients} recipientTypes={meta.recipientTypes} variables={meta.variables} toLocked={trigger?.builtIn === false ? `Always the ${((meta.audiences || []).find((a) => a.key === trigger.audience) || {}).label || 'audience'} on the case — it is decided by the event.` : null} onChange={(recipients) => set({ recipients })} />
          </Section>
        </div>

        <div className="min-w-0 lg:h-full">
          <EmailPreview
            meta={meta} subject={form.subject} heading={form.heading} body={form.body}
            triggerKey={form.triggerKey} recipients={form.recipients}
          />
        </div>
      </div>
    </div>
  )
}

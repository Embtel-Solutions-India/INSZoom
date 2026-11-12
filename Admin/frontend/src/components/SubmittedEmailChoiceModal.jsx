import { useState } from 'react'
import { Mail } from 'lucide-react'
import { ghlApi } from '../services/api'

// Shown in the middle of the screen when a case is moved to Submitted (FedEx), from the Pipeline or from the case page. The client is NOT e-mailed automatically:
// the case manager decides here. Nothing is pre-selected, so the choice is always a deliberate one. "Send" e-mails the client that their case is complete;
// "Don't inform" sends nothing. Works the same for every case type (single person, family, an employer's employee).
const REASONS = {
  already_sent: 'This client has already received the case-completion e-mail, so it was not sent again.',
  no_client_login: 'This case has no client login to e-mail, so nothing was sent.',
  employer_matter: 'This is an employer matter, so nothing was sent. Move the employee cases instead.',
  not_at_submitted: 'The case is no longer at Submitted (FedEx), so nothing was sent.',
}

export default function SubmittedEmailChoiceModal({ caseId, caseNumber, label = '', method = 'fedex', onDone }) {
  const online = method === 'online'
  const [choice, setChoice] = useState('') // 'send' | 'skip'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notSent, setNotSent] = useState(null) // { text, retry }: why nothing went out (shown before moving on)

  const confirm = async (event) => {
    event?.preventDefault()
    if (busy || !choice) return
    setBusy(true)
    setError('')
    try {
      const response = await ghlApi.submittedNotice(caseId, choice === 'send', online ? 'online' : undefined)
      const result = response.data || {}
      if (choice === 'send' && !result.sent) {
        setNotSent({ text: REASONS[result.reason] || 'The e-mail could not be sent. You can try again now.', retry: !REASONS[result.reason] })
        setBusy(false)
        return
      }
      onDone()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save your choice. Please try again.')
      setBusy(false)
    }
  }

  const options = [
    { value: 'send', title: 'Send the client an e-mail', text: online
        ? 'Tell the client that their case is complete and has been submitted online. If the USCIS receipt number was entered, it is included in the same e-mail.'
        : 'Tell the client that their case is complete and has been submitted. If a FedEx tracking number was entered, it is included in the same e-mail.' },
    { value: 'skip', title: "Don't inform the client", text: 'No e-mail will be sent to the client about this.' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/45 px-4 py-6" role="presentation">
      <form onSubmit={confirm} role="dialog" aria-modal="true" aria-labelledby="submitted-email-title" className="w-full max-w-md rounded-2xl bg-card p-6 shadow-2xl" data-testid="submitted-email-modal">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <Mail className="h-8 w-8" aria-hidden="true" />
        </div>
        <h2 id="submitted-email-title" className="text-center text-xl font-bold text-foreground">Tell the client their case is complete?</h2>
        <p className="mt-2 text-center text-sm leading-6 text-muted-foreground">
          <span className="font-semibold text-foreground">{caseNumber}{label ? ` · ${label}` : ''}</span> has moved to Submitted{online ? ' (online)' : ' (FedEx)'}.
          Choose whether the client should get an e-mail about it.
        </p>

        {notSent ? (
          <>
            <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm leading-5 text-amber-900" role="status">{notSent.text}</div>
            <div className="mt-6 flex gap-3">
              {notSent.retry && <button type="button" onClick={() => setNotSent(null)} className="btn-secondary flex-1 justify-center">Try again</button>}
              <button type="button" onClick={onDone} className="btn-primary flex-1 justify-center">Continue</button>
            </div>
          </>
        ) : (
          <>
            <div className="mt-5 space-y-2.5" role="radiogroup" aria-label="Inform the client">
              {options.map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors ${choice === option.value ? 'border-blue-500 bg-blue-50' : 'border-border hover:bg-muted/40'} ${busy ? 'opacity-60' : ''}`}
                >
                  <input
                    type="radio"
                    name="submitted-email-choice"
                    value={option.value}
                    checked={choice === option.value}
                    onChange={() => { setChoice(option.value); if (error) setError('') }}
                    disabled={busy}
                    className="mt-1 h-4 w-4 accent-blue-600"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-foreground">{option.title}</span>
                    <span className="block text-xs leading-5 text-muted-foreground">{option.text}</span>
                  </span>
                </label>
              ))}
            </div>
            {error && <p role="alert" className="mt-3 text-sm font-medium text-rose-600">{error}</p>}
            <div className="mt-6">
              <button type="submit" disabled={busy || !choice} className="btn-primary w-full justify-center disabled:opacity-50">{busy ? 'Saving…' : 'Confirm'}</button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}

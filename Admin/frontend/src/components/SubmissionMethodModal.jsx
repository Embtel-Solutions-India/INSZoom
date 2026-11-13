import { useState } from 'react'
import { Globe, Send, Truck } from 'lucide-react'

// The first question when a case is moved to Submitted (Pipeline drag or Update Stage): how was it submitted? "Online" continues with the USCIS receipt number,
// "FedEx" continues with the original FedEx tracking number + amount popup. Nothing is pre-selected, so the answer is always deliberate; Continue stays disabled until one is chosen.
const OPTIONS = [
  { value: 'online', title: 'Online', text: 'Submitted through the USCIS online system. You will be asked for the USCIS receipt number next.', Icon: Globe },
  { value: 'fedex', title: 'FedEx', text: 'Shipped to USCIS by FedEx. You will be asked for the FedEx tracking number next.', Icon: Truck },
]

export default function SubmissionMethodModal({ caseNumber, label = '', onContinue }) {
  const [choice, setChoice] = useState('')

  const submit = (event) => {
    event?.preventDefault()
    if (choice) onContinue(choice)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/45 px-4 py-6" role="presentation">
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="submission-method-title" className="w-full max-w-md rounded-2xl bg-card p-6 shadow-2xl" data-testid="submission-method-modal">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <Send className="h-8 w-8" aria-hidden="true" />
        </div>
        <h2 id="submission-method-title" className="text-center text-xl font-bold text-foreground">How did you submit the case?</h2>
        <p className="mt-2 text-center text-sm leading-6 text-muted-foreground">
          <span className="font-semibold text-foreground">{caseNumber}{label ? ` · ${label}` : ''}</span> has moved to Submitted.
          Choose how the case was submitted.
        </p>
        <div className="mt-5 space-y-2.5" role="radiogroup" aria-label="How the case was submitted">
          {OPTIONS.map(({ value, title, text, Icon }) => (
            <label
              key={value}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors ${choice === value ? 'border-blue-500 bg-blue-50' : 'border-border hover:bg-muted/40'}`}
            >
              <input
                type="radio"
                name="submission-method"
                value={value}
                checked={choice === value}
                onChange={() => setChoice(value)}
                className="mt-1 h-4 w-4 accent-blue-600"
              />
              <span className="flex-1">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><Icon className="h-4 w-4 text-blue-600" aria-hidden="true" />{title}</span>
                <span className="block text-xs leading-5 text-muted-foreground">{text}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-6">
          <button type="submit" disabled={!choice} className="btn-primary w-full justify-center disabled:opacity-50">Continue</button>
        </div>
      </form>
    </div>
  )
}

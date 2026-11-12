import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import FedexNumberModal from '../components/FedexNumberModal'
import ReceiptNumberModal from '../components/ReceiptNumberModal'
import SubmissionMethodModal from '../components/SubmissionMethodModal'
import SubmittedEmailChoiceModal from '../components/SubmittedEmailChoiceModal'

// One place that follows up a move to Submitted (FedEx). Anything that moves a case there - the Pipeline board, the case page - calls
// ask({ caseId, caseNumber, label, askClientEmail: true }): the internal team is first asked for the case's FedEx number (it can be left for later), then whether the
// client should be e-mailed that the case is complete (the client is never e-mailed automatically). The number is asked FIRST so that, when the team does send the
// e-mail, the FedEx number is already on file and goes inside that same e-mail; a number added later is e-mailed separately by the server. A call without
// askClientEmail (the "Add FedEx number" button) is only the FedEx number. Several moves in a row are queued and asked one after the other; the same case is never queued twice. Without a provider (tests, other
// screens) ask() does nothing.
const FedexPromptContext = createContext({ ask: () => {} })

export function FedexPromptProvider({ children }) {
  const [queue, setQueue] = useState([])
  const ask = useCallback((item) => {
    if (!item?.caseId) return
    setQueue((current) => (current.some((entry) => entry.caseId === item.caseId) ? current : [...current, { ...item, key: `${item.caseId}-${Date.now()}`, method: '', numberAsked: false, askClientEmail: Boolean(item.askClientEmail) }]))
  }, [])
  const value = useMemo(() => ({ ask }), [ask])
  const current = queue[0]
  return (
    <FedexPromptContext.Provider value={value}>
      {children}
      {/* a move into Submitted first asks HOW it was submitted (online / FedEx); "Add FedEx number" (no askClientEmail) goes straight to the FedEx popup as before */}
      {current && current.askClientEmail && !current.method && (
        <SubmissionMethodModal
          key={`${current.key}-method`}
          caseNumber={current.caseNumber}
          label={current.label}
          onContinue={(method) => setQueue((entries) => entries.map((entry, index) => (index === 0 ? { ...entry, method } : entry)))}
        />
      )}
      {current && current.method === 'online' && !current.numberAsked && (
        <ReceiptNumberModal
          key={`${current.key}-receipt`}
          caseId={current.caseId}
          caseNumber={current.caseNumber}
          label={current.label}
          onClose={() => setQueue((entries) => entries.map((entry, index) => (index === 0 ? { ...entry, numberAsked: true } : entry)))}
        />
      )}
      {current && current.method !== 'online' && (!current.askClientEmail || current.method === 'fedex') && !current.numberAsked && (
        <FedexNumberModal
          key={current.key}
          caseId={current.caseId}
          caseNumber={current.caseNumber}
          label={current.label}
          onClose={() => setQueue((entries) => (current.askClientEmail ? entries.map((entry, index) => (index === 0 ? { ...entry, numberAsked: true } : entry)) : entries.slice(1)))}
        />
      )}
      {current && current.numberAsked && (
        <SubmittedEmailChoiceModal
          key={`${current.key}-email`}
          caseId={current.caseId}
          caseNumber={current.caseNumber}
          label={current.label}
          method={current.method === 'online' ? 'online' : 'fedex'}
          onDone={() => setQueue((entries) => entries.slice(1))}
        />
      )}
    </FedexPromptContext.Provider>
  )
}

export const useFedexPrompt = () => useContext(FedexPromptContext)

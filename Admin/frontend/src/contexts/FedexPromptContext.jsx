import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import FedexNumberModal from '../components/FedexNumberModal'
import SubmittedEmailChoiceModal from '../components/SubmittedEmailChoiceModal'

// One place that follows up a move to Submitted (FedEx). Anything that moves a case there - the Pipeline board, the case page - calls
// ask({ caseId, caseNumber, label, askClientEmail: true }): the internal team is first asked whether the client should be e-mailed that the case is complete
// (the client is never e-mailed automatically), then for the case's FedEx number. A call without askClientEmail (the "Add FedEx number" button) goes straight
// to the FedEx number. Several moves in a row are queued and asked one after the other; the same case is never queued twice. Without a provider (tests, other
// screens) ask() does nothing.
const FedexPromptContext = createContext({ ask: () => {} })

export function FedexPromptProvider({ children }) {
  const [queue, setQueue] = useState([])
  const ask = useCallback((item) => {
    if (!item?.caseId) return
    setQueue((current) => (current.some((entry) => entry.caseId === item.caseId) ? current : [...current, { ...item, key: `${item.caseId}-${Date.now()}`, emailAsked: !item.askClientEmail }]))
  }, [])
  const value = useMemo(() => ({ ask }), [ask])
  const current = queue[0]
  return (
    <FedexPromptContext.Provider value={value}>
      {children}
      {current && !current.emailAsked && (
        <SubmittedEmailChoiceModal
          key={`${current.key}-email`}
          caseId={current.caseId}
          caseNumber={current.caseNumber}
          label={current.label}
          onDone={() => setQueue((entries) => entries.map((entry, index) => (index === 0 ? { ...entry, emailAsked: true } : entry)))}
        />
      )}
      {current && current.emailAsked && <FedexNumberModal key={current.key} caseId={current.caseId} caseNumber={current.caseNumber} label={current.label} onClose={() => setQueue((entries) => entries.slice(1))} />}
    </FedexPromptContext.Provider>
  )
}

export const useFedexPrompt = () => useContext(FedexPromptContext)

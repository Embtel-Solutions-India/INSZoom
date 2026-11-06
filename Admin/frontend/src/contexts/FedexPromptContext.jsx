import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import FedexNumberModal from '../components/FedexNumberModal'

// One place that asks the internal team for a case's FedEx number. Anything that moves a case to Submitted (FedEx) - the Pipeline board, the case page - calls ask({ caseId, caseNumber, label }).
// Several moves in a row are queued and asked one after the other; the same case is never queued twice. Without a provider (tests, other screens) ask() does nothing.
const FedexPromptContext = createContext({ ask: () => {} })

export function FedexPromptProvider({ children }) {
  const [queue, setQueue] = useState([])
  const ask = useCallback((item) => {
    if (!item?.caseId) return
    setQueue((current) => (current.some((entry) => entry.caseId === item.caseId) ? current : [...current, { ...item, key: `${item.caseId}-${Date.now()}` }]))
  }, [])
  const value = useMemo(() => ({ ask }), [ask])
  const current = queue[0]
  return (
    <FedexPromptContext.Provider value={value}>
      {children}
      {current && <FedexNumberModal key={current.key} caseId={current.caseId} caseNumber={current.caseNumber} label={current.label} onClose={() => setQueue((entries) => entries.slice(1))} />}
    </FedexPromptContext.Provider>
  )
}

export const useFedexPrompt = () => useContext(FedexPromptContext)

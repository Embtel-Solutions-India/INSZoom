import { useState, useCallback, useEffect, useRef } from 'react'
import { petitionApi } from '../../services/api'
import exhibitLabelFor from './exhibitLabel'

// Fetch + optimistic mutations for a single PetitionPackage version.
// Letter edits and exhibit reorders update local state immediately, then
// debounce/persist to the server; a 409 (locked / concurrent update) never
// silently overwrites — it surfaces as `conflict` for the viewer to show a
// "reload to see the latest" banner.
export default function usePetitionPackage(packageId) {
  const [pkg, setPkg] = useState(null)
  const [validation, setValidation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saveStates, setSaveStates] = useState({})
  const [conflict, setConflict] = useState(false)
  const saveTimers = useRef({})
  const pkgRef = useRef(null)
  pkgRef.current = pkg

  const load = useCallback(async () => {
    if (!packageId) return
    setLoading(true)
    setError('')
    try {
      const res = await petitionApi.getPackage(packageId)
      setPkg(res.data.data)
      setValidation(res.data.data.validation)
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load petition package')
    } finally {
      setLoading(false)
    }
  }, [packageId])

  useEffect(() => { load() }, [load])

  const refreshValidation = useCallback(async () => {
    if (!packageId) return
    try {
      const res = await petitionApi.getValidation(packageId)
      setValidation(res.data.data)
    } catch {
      // non-fatal — the right rail just keeps showing the last-known state
    }
  }, [packageId])

  // Debounced (~800ms) letter autosave — updates local state instantly so
  // the editor never feels laggy, persists after the pause.
  //
  // BUG (fixed): a slow save round trip (observed: 5+ seconds on this dev
  // machine, but network latency can do this in production too) used to
  // come back well after the user had kept typing — the optimistic update
  // above had already moved `contentHtml` forward, un-saved, past what this
  // request sent. Blindly `setPkg(res.data.data)`-ing the response
  // overwrote that newer content with the stale value the server echoed
  // back, and LetterSheet's external-content-sync effect then force-reset
  // the live editor to match it — wiping everything typed during the wait.
  // Fix: apply the server response for every OTHER field (outputs,
  // validation, documentIds, etc. — genuinely new server-side state) but
  // keep the section's CURRENT client-side contentHtml, whatever it now is.
  // The next debounce cycle always re-sends the latest typed content, so
  // nothing is lost — this only skips reflecting a beat-late echo.
  const saveLetter = useCallback((sectionKey, html) => {
    setPkg((current) => current ? { ...current, sections: current.sections.map((s) => (s.key === sectionKey ? { ...s, contentHtml: html } : s)) } : current)
    setSaveStates((s) => ({ ...s, [sectionKey]: 'saving' }))
    clearTimeout(saveTimers.current[sectionKey])
    saveTimers.current[sectionKey] = setTimeout(async () => {
      try {
        const res = await petitionApi.saveLetter(packageId, sectionKey, html)
        setPkg((current) => {
          const serverPkg = res.data.data
          const localSection = current?.sections.find((s) => s.key === sectionKey)
          return {
            ...serverPkg,
            sections: serverPkg.sections.map((s) => (s.key === sectionKey ? { ...s, contentHtml: localSection?.contentHtml ?? s.contentHtml } : s)),
          }
        })
        setSaveStates((s) => ({ ...s, [sectionKey]: 'saved' }))
        refreshValidation()
      } catch (e) {
        if (e.response?.status === 409) setConflict(true)
        setSaveStates((s) => ({ ...s, [sectionKey]: 'error' }))
      }
    }, 800)
  }, [packageId, refreshValidation])

  // Optimistic exhibit reorder — relabels A/B/C locally immediately (using
  // the SAME labeling scheme the backend uses), reverts on failure.
  const reorderExhibits = useCallback(async (newOrderKeys) => {
    const previous = pkgRef.current
    setPkg((current) => {
      if (!current) return current
      const byKey = new Map(current.exhibitIndex.map((e) => [e.key, e]))
      const reordered = newOrderKeys.map((key, i) => {
        const entry = byKey.get(key)
        return entry ? { ...entry, label: exhibitLabelFor(i) } : null
      }).filter(Boolean)
      return { ...current, exhibitIndex: reordered, exhibitOrder: newOrderKeys }
    })
    try {
      const res = await petitionApi.reorderExhibits(packageId, newOrderKeys)
      setPkg(res.data.data)
      refreshValidation()
    } catch (e) {
      setPkg(previous)
      if (e.response?.status === 409) setConflict(true)
      throw e
    }
  }, [packageId, refreshValidation])

  // Structural, unlike saveLetter/reorderExhibits — the backend re-assembles
  // the whole mailing PDF to materialize the new page, so this isn't
  // optimistic; `pageActionPending` lets the UI show a brief "assembling"
  // state instead of pretending the change is instant.
  const [pageActionPending, setPageActionPending] = useState(false)

  const insertPage = useCallback(async (insertAfterKey, type, title) => {
    setPageActionPending(true)
    try {
      const res = await petitionApi.insertPage(packageId, { type, title, insertAfterKey })
      setPkg(res.data.data)
      refreshValidation()
    } catch (e) {
      if (e.response?.status === 409) setConflict(true)
      throw e
    } finally {
      setPageActionPending(false)
    }
  }, [packageId, refreshValidation])

  const removePage = useCallback(async (sectionKey) => {
    setPageActionPending(true)
    try {
      const res = await petitionApi.removePage(packageId, sectionKey)
      setPkg(res.data.data)
      refreshValidation()
    } catch (e) {
      if (e.response?.status === 409) setConflict(true)
      throw e
    } finally {
      setPageActionPending(false)
    }
  }, [packageId, refreshValidation])

  return {
    package: pkg,
    validation,
    loading,
    error,
    saveStates,
    conflict,
    dismissConflict: () => setConflict(false),
    reload: load,
    saveLetter,
    reorderExhibits,
    insertPage,
    removePage,
    pageActionPending,
    refreshValidation,
    setPackage: setPkg,
  }
}

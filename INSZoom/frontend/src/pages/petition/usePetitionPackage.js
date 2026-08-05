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
  const saveLetter = useCallback((sectionKey, html) => {
    setPkg((current) => current ? { ...current, sections: current.sections.map((s) => (s.key === sectionKey ? { ...s, contentHtml: html } : s)) } : current)
    setSaveStates((s) => ({ ...s, [sectionKey]: 'saving' }))
    clearTimeout(saveTimers.current[sectionKey])
    saveTimers.current[sectionKey] = setTimeout(async () => {
      try {
        const res = await petitionApi.saveLetter(packageId, sectionKey, html)
        setPkg(res.data.data)
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
    refreshValidation,
    setPackage: setPkg,
  }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { petitionReviewApi } from '../../services/api'

// Copied from the Client Portal's petition viewer (Immiglance/Client/src/components/petition/usePetitionStream.js) so the petition opens the same way here; only the
// error shape differs (this app's HTTP client is axios: error.response.status).
//
// Opening a big petition: the server reads (and decrypts) the file, which can take a while for a PDF of hundreds of pages. The person never sees a timeout for that: we ask
// for a signed viewer link, then keep asking "is it ready?" (each answer waits up to ~12 s on the server) until it is, retrying quietly through any hiccup. The PDF is then
// loaded by the browser's own viewer straight from the stream, page 1 first. Only a petition that does not exist / may not be opened - or ten minutes of trying - ends in a message.
const GIVE_UP_AFTER_MS = 10 * 60 * 1000
const LINK_FRESH_MS = 45 * 60 * 1000 // links are valid for an hour
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const statusOf = (error) => error?.response?.status
const isFinal = (error) => [401, 403, 404].includes(statusOf(error))

const links = new Map() // documentId -> { promise, at }

/** One link per petition, shared by hover-prefetch and the viewer. */
export function getViewLink(documentId) {
  const cached = links.get(documentId)
  if (cached && Date.now() - cached.at < LINK_FRESH_MS) return cached.promise
  const promise = petitionReviewApi.viewLink(documentId).then((response) => response?.data?.data?.token || Promise.reject(new Error('No viewer link')))
  promise.catch(() => { if (links.get(documentId)?.promise === promise) links.delete(documentId) })
  links.set(documentId, { promise, at: Date.now() })
  return promise
}

/** Starts the server reading the file before anyone clicks (hovering "Open"): harmless, quiet, never throws. */
export function prefetchPetition(documentId) {
  getViewLink(documentId).then((token) => petitionReviewApi.ready(token)).catch(() => {})
}

/** Resolves with a token whose file is in memory on the server; keeps trying until `shouldStop()` or the deadline. */
export async function waitUntilReady(documentId, { shouldStop = () => false, onWaiting } = {}) {
  const deadline = Date.now() + GIVE_UP_AFTER_MS
  let delay = 800
  for (;;) {
    if (shouldStop()) return null
    try {
      const token = await getViewLink(documentId)
      const answer = await petitionReviewApi.ready(token)
      if (answer?.data?.data?.ready) return token
      onWaiting?.()
      delay = 300 // the server already made us wait; ask again at once
    } catch (error) {
      if (isFinal(error)) {
        if (statusOf(error) === 401) links.delete(documentId) // an expired link: ask for a fresh one
        else throw error
      }
      onWaiting?.()
      await pause(delay)
      delay = Math.min(delay * 1.6, 5000)
    }
    if (Date.now() > deadline) throw Object.assign(new Error('This is taking longer than usual.'), { gaveUp: true })
  }
}

export default function usePetitionStream(documentId) {
  const [state, setState] = useState({ status: 'preparing', url: '', error: '', waited: false })
  const [attempt, setAttempt] = useState(0)
  const stopped = useRef(false)

  useEffect(() => {
    stopped.current = false
    setState({ status: 'preparing', url: '', error: '', waited: false })
    waitUntilReady(documentId, { shouldStop: () => stopped.current, onWaiting: () => setState((current) => (current.waited ? current : { ...current, waited: true })) })
      .then((token) => {
        if (stopped.current || !token) return
        setState({ status: 'ready', url: petitionReviewApi.streamUrl(token), error: '', waited: false })
      })
      .catch((error) => {
        if (stopped.current) return
        setState({ status: 'error', url: '', waited: false, error: error?.gaveUp ? 'We could not finish opening this petition just yet.' : statusOf(error) === 404 ? 'This petition is no longer available.' : 'We could not open this petition.' })
      })
    return () => { stopped.current = true }
  }, [documentId, attempt])

  const retry = useCallback(() => { links.delete(documentId); setAttempt((value) => value + 1) }, [documentId])
  return { ...state, retry }
}

// PocHarness.jsx
// POC ONLY. Mounted exclusively via poc.html + pocMain.jsx (a Vite entry
// separate from index.html/main.jsx/App.jsx - nothing here touches any
// production route). Bootstraps just enough auth + template lookup for
// USCISNativeFormPOC.jsx to load the real stored I-129 PDF.
//
// Assumes the tester is ALREADY logged into the main app in this same
// browser (so the httpOnly refresh-token cookie exists) - it calls
// /auth/refresh on mount to mint an access token for this separate page load.
import { useEffect, useState } from 'react'
import api, { setAccessToken } from '../services/api'
import USCISNativeFormPOC from '../components/uscis/USCISNativeFormPOC'

export default function PocHarness() {
  const [status, setStatus] = useState('checking-auth')
  const [error, setError] = useState('')
  const [templateId, setTemplateId] = useState(new URLSearchParams(window.location.search).get('templateId') || '')

  useEffect(() => {
    let cancelled = false
    async function bootstrap() {
      try {
        const refreshResponse = await api.post('/auth/refresh', {}, { withCredentials: true })
        const token = refreshResponse.data?.accessToken
        if (!token) throw new Error('No accessToken in refresh response')
        setAccessToken(token)
        if (cancelled) return

        if (!templateId) {
          const registryResponse = await api.get('/uscis-forms/registry/active', { params: { formCode: 'I-129' } })
          const forms = registryResponse.data?.data || registryResponse.data?.forms || []
          const active = forms.find((f) => String(f.formCode).toUpperCase() === 'I-129') || forms[0]
          if (!active) throw new Error('No active I-129 template found via /uscis-forms/registry/active')
          if (!cancelled) setTemplateId(String(active._id))
        }
        if (!cancelled) setStatus('ready')
      } catch (err) {
        if (!cancelled) {
          setError(err?.response?.data?.message || err.message)
          setStatus('error')
        }
      }
    }
    bootstrap()
    return () => { cancelled = true }
  }, [templateId])

  if (status === 'checking-auth') return <div className="p-6 text-sm">Bootstrapping POC session (refreshing access token, resolving active I-129 template)…</div>
  if (status === 'error') {
    return (
      <div className="p-6 text-sm text-red-700">
        <p className="mb-2 font-semibold">POC bootstrap failed: {error}</p>
        <p>Log into the main app (http://localhost:3002) in this same browser first, then reload this page. If the I-129 template still isn't found, confirm it has been seeded (npm run seed:i129) and activated.</p>
      </div>
    )
  }
  return <USCISNativeFormPOC templateId={templateId} />
}

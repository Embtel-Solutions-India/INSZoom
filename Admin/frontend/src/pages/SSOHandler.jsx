import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

// Landing point for the Immiglance redirect (AuthGate.jsx's isStaff branch
// sends an authenticated staff member here with ?token=, exactly mirroring
// the Attorney portal's own SSOHandler). The token is never trusted
// client-side — it's handed to the backend via /auth/me, and only a 200 with
// an admin-portal-eligible role establishes the session. Added because the
// previous isStaff redirect was a bare cross-origin navigation with no
// credential at all, relying entirely on the refresh-token cookie being
// readable from this origin too — which isn't guaranteed, and was the
// reported cause of an already-authenticated staff member landing right
// back on this app's own /login after being sent here.
export default function SSOHandler() {
  const [params] = useSearchParams()
  const { loginWithToken } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  // useSearchParams() hands back a differently-identitied object on some
  // renders, which would otherwise re-fire this effect and call
  // loginWithToken() again mid-flight (observed here as a cascading
  // "Maximum update depth exceeded" once SocketProvider/NotificationProvider
  // react to the resulting flurry of auth-state changes) — this ref caps it
  // to exactly one attempt per mount regardless of how many times the effect
  // itself re-runs.
  const attempted = useRef(false)

  useEffect(() => {
    if (attempted.current) return
    attempted.current = true
    const token = params.get('token')
    if (!token) {
      navigate('/login', { replace: true })
      return
    }
    loginWithToken(token)
      .then(() => navigate('/dashboard', { replace: true }))
      .catch((err) => setError(err.message || 'This sign-in link is no longer valid.'))
  }, [params, loginWithToken, navigate])

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-6 text-center bg-background">
        <h1 className="text-xl font-bold text-foreground font-serif">Couldn&apos;t sign you in</h1>
        <p className="text-muted-foreground max-w-md text-sm">{error}</p>
        <button onClick={() => navigate('/login', { replace: true })} className="text-primary font-semibold text-sm hover:underline">
          Go to sign in
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  )
}

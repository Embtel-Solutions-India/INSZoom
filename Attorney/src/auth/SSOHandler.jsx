import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from './AuthContext'

// Landing point for the Immiglance redirect (AuthGate.jsx sends an
// authenticated attorney here with ?token=). The token is never verified
// client-side — it's handed to the backend via /auth/me, and only a 200 with
// role=attorney establishes the session.
export default function SSOHandler() {
  const [params] = useSearchParams()
  const { loginWithToken } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
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

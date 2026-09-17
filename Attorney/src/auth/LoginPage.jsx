import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from './AuthContext'
import BrandMark from '../components/BrandMark'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login, user, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  // Never show the login form to an already-authenticated attorney, not even
  // for a frame — while the session check is still in flight, render nothing
  // (RequireAttorney's own spinner covers the same window on every other
  // route; this page isn't wrapped by it, so it needs its own equivalent).
  // Only once we positively know there's no session does the form render.
  if (authLoading) {
    return <div className="min-h-screen bg-background" />
  }
  if (user) {
    return <Navigate to="/dashboard" replace />
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err.message === 'Access denied — this portal is for attorneys only.'
        ? err.message
        : err.response?.data?.message || 'Login failed. Check your email and password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md card">
        <div className="flex items-center gap-3 mb-6">
          <BrandMark size="w-10 h-10" />
          <div>
            <h1 className="text-lg font-bold text-foreground font-serif">Immiglance</h1>
            <p className="text-sm text-muted-foreground">Attorney Portal</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">Email</label>
            <input
              id="email" type="email" required value={email} autoComplete="username"
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">Password</label>
            <input
              id="password" type="password" required value={password} autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
            />
          </div>

          {error && <p role="alert" className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{error}</p>}

          <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Sign in
          </button>
        </form>
      </div>
    </div>
  )
}

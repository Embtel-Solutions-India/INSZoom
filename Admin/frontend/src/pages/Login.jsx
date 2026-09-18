import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Lock, User } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import BrandMark from '../components/BrandMark'

// Edge/IE inject their own native reveal-password icon on type="password"
// inputs (the ::-ms-reveal pseudo-element) - it renders next to our own
// Eye/EyeOff toggle button, doesn't match the app's theme, and duplicates
// the same control. Hidden here so only our themed toggle shows.
const HIDE_NATIVE_REVEAL_CSS = `
  input[type="password"]::-ms-reveal,
  input[type="password"]::-ms-clear {
    display: none;
  }
`

const Login = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login, user, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  // A valid shared session already exists (e.g. staff signed in via the
  // Immiglance client portal's "Team member" tab, which redirects here with
  // the same auth cookie already set) — never show the login form, not even
  // for a frame: while the session check is in flight render nothing, and
  // once it resolves to a logged-in user, redirect declaratively instead of
  // painting the form first and navigating away a tick later.
  if (authLoading) {
    return <div className="min-h-screen bg-background" />
  }
  if (user) {
    return <Navigate to="/dashboard" replace />
  }

  const attemptLogin = async (loginEmail, loginPassword) => {
    setError('')
    setLoading(true)

    const result = await login(loginEmail, loginPassword)

    if (result.success) {
      navigate('/dashboard')
    } else {
      setError(result.message)
    }

    setPassword('')
    setLoading(false)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    attemptLogin(email, password)
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-8">
      <style>{HIDE_NATIVE_REVEAL_CSS}</style>

      {/* Brand lockup sits outside the card, in its own block, so it never
          shifts when the card below resizes (an error banner appearing,
          etc.) — mirrors the same pattern the Immiglance client portal's
          Login/Signup pages use. */}
      <div className="flex items-center gap-3 mb-6">
        <BrandMark size="w-10 h-10" />
        <div>
          <h1 className="text-lg font-bold text-foreground font-serif">Immiglance</h1>
          <p className="text-sm text-muted-foreground">Internal CRM</p>
        </div>
      </div>

      <div className="w-full max-w-md card">
        <div className="mb-6">
          <h2 className="text-lg font-bold text-foreground font-serif">Login</h2>
          <p className="text-sm text-muted-foreground">For Immiglance team members</p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-foreground mb-1.5">Username</label>
            <div className="relative">
              <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="username"
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field pl-10"
                placeholder="Username"
                autoComplete="username"
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">Password</label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field pl-10 pr-10"
                placeholder="Password"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-primary focus:outline-none"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60">
            {loading ? 'Signing in…' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default Login

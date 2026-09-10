import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Lock, Shield, User } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import loginBackground from '../assets/admin-login-liberty.png'
import loginBackgroundWebp from '../assets/admin-login-liberty.webp'

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
  const { login } = useAuth()
  const navigate = useNavigate()

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
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <style>{HIDE_NATIVE_REVEAL_CSS}</style>
      <picture>
        <source srcSet={loginBackgroundWebp} type="image/webp" />
        <img
          src={loginBackground}
          alt=""
          width={1672}
          height={941}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      </picture>
      <div className="absolute inset-0 bg-primary/[0.14]" />
      <div className="absolute inset-0 bg-slate-900/10" />
      <div className="absolute inset-y-0 right-0 w-1/2 bg-gradient-to-l from-white/54 to-transparent" />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 78% 42% at 18% 100%, rgba(255,255,255,0.96) 0%, rgba(246,250,255,0.88) 34%, rgba(229,240,255,0.54) 58%, rgba(229,240,255,0.18) 74%, rgba(229,240,255,0) 92%)',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(0deg, rgba(255,255,255,0.88) 0%, rgba(248,251,255,0.72) 12%, rgba(236,246,255,0.42) 24%, rgba(236,246,255,0.16) 36%, rgba(236,246,255,0) 52%)',
        }}
      />

      <div className="relative z-10 flex min-h-screen flex-col px-5 py-8 sm:px-10 sm:py-10 lg:flex-row lg:px-14 xl:px-[72px]">
        <div className="flex justify-center pb-6 lg:flex-1 lg:flex-col lg:justify-end lg:pb-2 lg:pr-8">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
              <Shield className="h-7 w-7" />
            </div>
            <div>
              <p className="text-xl font-black uppercase tracking-[0.28em] text-foreground sm:text-2xl">IMMIGRATIA</p>
              <p className="mt-1 text-sm font-black uppercase tracking-[0.26em] text-primary">Admin Portal</p>
            </div>
          </div>
        </div>

        <section className="flex flex-1 items-center justify-center lg:justify-end lg:pr-8 xl:pr-14">
          <div className="w-full max-w-[464px] rounded-[18px] bg-card/90 px-6 pb-9 pt-9 shadow-[0_24px_70px_rgba(92,124,173,0.22)] ring-1 ring-card/85 backdrop-blur-md sm:px-10 sm:pb-11 sm:pt-11 lg:px-14">
            <div className="mb-8 flex flex-col items-center text-center">
              <div className="mb-7 grid h-[78px] w-[78px] place-items-center rounded-full bg-primary/10 text-primary">
                <Shield className="h-11 w-11" strokeWidth={2.4} />
              </div>
              <h1 className="text-2xl font-black leading-none text-foreground sm:text-[28px]">Welcome Back</h1>
              <p className="mt-5 text-base font-bold text-muted-foreground">Sign in to your admin account</p>
            </div>

            {error && (
              <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-400">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <label className="relative block">
                <User className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-[58px] w-full rounded-lg border border-input bg-card/90 pl-[52px] pr-5 text-base font-bold text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-ring/10"
                  placeholder="Username"
                  autoComplete="username"
                  required
                />
              </label>

              <label className="relative block">
                <Lock className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-[58px] w-full rounded-lg border border-input bg-card/90 pl-[52px] pr-[52px] text-base font-bold text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-ring/10"
                  placeholder="Password"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                  className="absolute right-5 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-primary focus:outline-none"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </label>

              <button
                type="submit"
                disabled={loading}
                className="mt-6 h-[58px] w-full rounded-lg bg-primary text-base font-black text-primary-foreground shadow-[0_12px_28px_rgba(37,99,235,0.28)] transition hover:bg-primary/90 focus:outline-none focus:ring-4 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Signing in...' : 'Login'}
              </button>
            </form>

            <div className="my-9 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

            <div className="flex flex-wrap items-center justify-center gap-2 text-sm font-bold text-muted-foreground sm:gap-3 sm:text-base">
              <Shield className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span>Secure</span>
              <span className="text-muted-foreground/60">&bull;</span>
              <span>Trusted</span>
              <span className="text-muted-foreground/60">&bull;</span>
              <span>Compliant</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

export default Login

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, Lock, Shield, User } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import loginBackground from '../assets/admin-login-liberty.png'
import loginBackgroundWebp from '../assets/admin-login-liberty.webp'

// Dev-only quick-login shortcuts for the seeded dummy accounts
// (Backend/src/seeds/seedUsers.js) — never shown in a production build.
const DEV_ACCOUNTS = [
  { label: 'Team Lead', email: 'teamlead@inszoom.com', password: 'TeamLead123' },
  { label: 'Case Manager', email: 'casemanager@inszoom.com', password: 'CaseManager123' },
  { label: 'Super Admin', email: 'superadmin@inszoom.com', password: 'SuperAdmin123' },
  { label: 'Admin', email: 'admin@inszoom.com', password: 'Admin123' },
]

const Login = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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

    setLoading(false)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    attemptLogin(email, password)
  }

  const handleQuickLogin = (account) => {
    setEmail(account.email)
    setPassword(account.password)
    attemptLogin(account.email, account.password)
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#eaf4ff] text-[#1f2c44]">
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
      <div className="absolute inset-0 bg-[#9abbe8]/22" />
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

      <div className="relative z-10 flex min-h-screen px-8 py-10 sm:px-14 lg:px-[72px]">
        <div className="flex flex-1 flex-col justify-end pb-2">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#2563eb] text-white shadow-lg shadow-blue-700/20">
              <Shield className="h-7 w-7" />
            </div>
            <div>
              <p className="text-2xl font-black uppercase tracking-[0.28em] text-[#1c2740]">INSZOOM</p>
              <p className="mt-1 text-sm font-black uppercase tracking-[0.26em] text-[#2563eb]">Admin Portal</p>
            </div>
          </div>
        </div>

        <section className="flex flex-1 items-center justify-center lg:justify-end lg:pr-8 xl:pr-14">
          <div className="w-full max-w-[464px] rounded-[18px] bg-white/90 px-14 pb-11 pt-11 shadow-[0_24px_70px_rgba(92,124,173,0.22)] ring-1 ring-white/85 backdrop-blur-md">
            <div className="mb-8 flex flex-col items-center text-center">
              <div className="mb-7 grid h-[78px] w-[78px] place-items-center rounded-full bg-[#dbeafe] text-[#2563eb]">
                <Shield className="h-11 w-11" strokeWidth={2.4} />
              </div>
              <h1 className="text-[28px] font-black leading-none text-[#273449]">Welcome Back</h1>
              <p className="mt-5 text-base font-bold text-[#8b98ad]">Sign in to your admin account</p>
            </div>

            {error && (
              <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <label className="relative block">
                <User className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#7f91b4]" />
                <input
                  type="text"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-[58px] w-full rounded-lg border border-[#dce3ee] bg-white/90 pl-[52px] pr-5 text-base font-bold text-[#273449] outline-none transition placeholder:text-[#8d99ae] focus:border-[#2563eb] focus:ring-4 focus:ring-blue-600/10"
                  placeholder="Username"
                  autoComplete="username"
                  required
                />
              </label>

              <label className="relative block">
                <Lock className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#7f91b4]" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-[58px] w-full rounded-lg border border-[#dce3ee] bg-white/90 pl-[52px] pr-[52px] text-base font-bold text-[#273449] outline-none transition placeholder:text-[#8d99ae] focus:border-[#2563eb] focus:ring-4 focus:ring-blue-600/10"
                  placeholder="Password"
                  autoComplete="current-password"
                  required
                />
                <Eye className="pointer-events-none absolute right-5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#9aa8bd]" />
              </label>

              <button
                type="submit"
                disabled={loading}
                className="mt-6 h-[58px] w-full rounded-lg bg-[#2563eb] text-base font-black text-white shadow-[0_12px_28px_rgba(37,99,235,0.28)] transition hover:bg-[#1d4ed8] focus:outline-none focus:ring-4 focus:ring-blue-600/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Signing in...' : 'Login'}
              </button>
            </form>

            {import.meta.env.DEV && (
              <div className="mt-7 border-t border-dashed border-[#d9e2f0] pt-6">
                <p className="mb-3 text-center text-[0.7rem] font-black uppercase tracking-[0.18em] text-[#9aa8bd]">Dev Quick Login</p>
                <div className="grid grid-cols-2 gap-2.5">
                  {DEV_ACCOUNTS.map((account) => (
                    <button
                      key={account.email}
                      type="button"
                      disabled={loading}
                      onClick={() => handleQuickLogin(account)}
                      className="rounded-lg border border-[#dce3ee] bg-white px-3 py-2.5 text-sm font-bold text-[#2563eb] transition hover:border-[#2563eb] hover:bg-[#eaf1ff] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {account.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="my-9 h-px bg-gradient-to-r from-transparent via-[#d9e2f0] to-transparent" />

            <div className="flex items-center justify-center gap-3 text-base font-bold text-[#8c9ab2]">
              <Shield className="h-5 w-5 text-[#8c9ab2]" />
              <span>Secure</span>
              <span className="text-[#b8c3d4]">&bull;</span>
              <span>Trusted</span>
              <span className="text-[#b8c3d4]">&bull;</span>
              <span>Compliant</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

export default Login

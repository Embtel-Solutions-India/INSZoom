// Small shared pieces of the Phase 5 governance screens: the roles, plain-language formatting, the badge and the response unwrapping. Every screen here is read-only except the
// Retry of a stuck job (super_admin / admin, through the existing pipeline API).
export const READ_ROLES = ['super_admin', 'admin', 'team_lead'] // the roles the governance, pipeline and AI-mapping APIs allow
export const RETRY_ROLES = ['super_admin', 'admin']
export const POLL_MS = 15000

/** The API answers { success, data }; tolerate a bare payload too. */
export const unwrap = (response) => {
  const body = response?.data
  return body && typeof body === 'object' && !Array.isArray(body) && 'data' in body ? body.data : body
}

export const errorMessage = (error, fallback) => {
  const message = error?.response?.data?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

export const when = (value) => (value ? new Date(value).toLocaleString() : '-')

/** "less than a minute", "5 minutes", "3 hours", "2 days" */
export const formatAge = (ms) => {
  const value = Number(ms)
  if (!Number.isFinite(value) || value < 0) return '-'
  const minutes = Math.floor(value / 60000)
  if (minutes < 1) return 'less than a minute'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}

/** "850 ms", "3.2 s", "2 min 5 s" */
export const formatDuration = (ms) => {
  const value = Number(ms)
  if (!Number.isFinite(value) || value < 0) return '-'
  if (value < 1000) return `${Math.round(value)} ms`
  if (value < 60000) return `${(value / 1000).toFixed(1)} s`
  return `${Math.floor(value / 60000)} min ${Math.round((value % 60000) / 1000)} s`
}

/** A canonical field path in plain words: petitioner.address.city -> "petitioner address city" (list rows and raw checklist answers lose their numbers / wrapper). */
export const plainPath = (path) => String(path || '').replace(/^raw\.questionnaireAnswers\./, '').replace(/\.value$/, '').split('.').filter((part) => part && !/^\d+$/.test(part)).map((part) => part.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')).join(' ').toLowerCase()

export const words = (code) => String(code || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim()

const TONES = { green: 'bg-green-100 text-green-800', amber: 'bg-amber-100 text-amber-800', red: 'bg-red-100 text-red-800', gray: 'bg-gray-100 text-gray-700', blue: 'bg-primary/10 text-primary' }
export const Badge = ({ tone = 'gray', children, title }) => (
  <span title={title} className={`px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${TONES[tone] || TONES.gray}`}>{children}</span>
)

export const Tile = ({ label, value, hint, tone }) => (
  <div className={`rounded-lg border p-3 ${tone === 'red' ? 'border-red-300' : tone === 'amber' ? 'border-amber-300' : 'border-border'}`} title={hint}>
    <div className="text-2xl font-semibold tabular-nums text-foreground">{value ?? '-'}</div>
    <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
  </div>
)

/** Plain label for a status state: ok / warning / blocked / unknown. */
export const STATUS_STATE = {
  ok: { label: 'All good', tone: 'green' },
  warning: { label: 'Needs a look', tone: 'amber' },
  blocked: { label: 'Needs a person', tone: 'red' },
  unknown: { label: 'Not known yet', tone: 'gray' },
}

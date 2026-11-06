import { useState, useEffect, useCallback } from 'react'
import { ResponsiveContainer, ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import api from '../services/api'
import { useOptionalSocket } from '../contexts/SocketContext'
import { FINANCE_COLORS } from '../utils/financeColors'

// What was PAID (QB Amount Paid) each day: this month (solid line, up to today) against last month on the same days (dashed line). No filters.
// Live from the database (US dollars, India time): refreshes when any case's figures change and every 30 seconds.
const usd = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(amount) || 0)
const short = (value) => `$${Math.round(Number(value) || 0).toLocaleString('en-US')}`
const COLORS = { current: FINANCE_COLORS.paid, previous: FINANCE_COLORS.previous }
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function RevenueTrendChart({ title = 'Paid per day', height = 220 }) {
  const socket = useOptionalSocket()
  const subscribe = socket?.subscribe
  const connected = Boolean(socket?.connected)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const response = await api.get('/analytics/payments/trend', { params: { granularity: 'day' } })
      setData(response.data)
      setError('')
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load the revenue graph.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!connected || !subscribe) return undefined
    return subscribe('payment:updated', load)
  }, [connected, subscribe, load])
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load() }, 30000)
    return () => clearInterval(timer)
  }, [load])

  const points = (data?.points || []).map((point) => ({ ...point, current: point.paid, previous: point.previousPaid }))
  const today = points[points.length - 1]
  const comparison = data?.comparison
  const hasData = points.some((point) => point.current || point.previous)
  const now = new Date()
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const thisName = MONTH_NAMES[now.getMonth()]
  const lastName = MONTH_NAMES[prevMonth.getMonth()]

  return (
    <div className="card">
      <h3 className="mb-1 text-sm font-semibold text-foreground">{title}</h3>

      {today && (
        <p className="mb-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Today ({today.label} {thisName}):</span> <span className="font-semibold text-foreground">{usd(today.current)}</span>
          {' · '}<span className="font-medium text-foreground">{today.label} {lastName}:</span> <span className="font-semibold text-foreground">{usd(today.previous)}</span>
          {comparison ? <>{' · '}<span className="font-medium text-foreground">{thisName} so far:</span> {usd(comparison.current.paid)}{' · '}<span className="font-medium text-foreground">{lastName}, same dates:</span> {usd(comparison.previous.paid)}</> : null}
        </p>
      )}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {loading && !data ? (
        <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>Loading…</div>
      ) : !hasData ? (
        <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>No payments recorded for this period yet</div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={points} margin={{ left: 0, right: 10, top: 6, bottom: 0 }}>
            {/* a soft shadow under each line: the line colour fading to nothing */}
            <defs>
              <linearGradient id="trendCurrentFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS.current} stopOpacity={0.22} />
                <stop offset="100%" stopColor={COLORS.current} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="trendPreviousFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS.previous} stopOpacity={0.12} />
                <stop offset="100%" stopColor={COLORS.previous} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} tickMargin={4} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={short} width={64} />
            <Tooltip
              formatter={(value, name) => [usd(value), name]}
              labelFormatter={(label) => `${label} ${thisName} (compared with ${label} ${lastName})`}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            {/* the legend text is one neutral colour; only the little line keys carry the series colour */}
            <Legend wrapperStyle={{ fontSize: 12 }} formatter={(value) => <span className="text-muted-foreground">{value}</span>} />
            <Area type="monotone" dataKey="previous" name={`${lastName} (last month)`} stroke={COLORS.previous} strokeWidth={2} strokeDasharray="6 4" fill="url(#trendPreviousFill)" dot={false} connectNulls />
            <Area type="monotone" dataKey="current" name={`${thisName} (this month)`} stroke={COLORS.current} strokeWidth={2.5} fill="url(#trendCurrentFill)" dot={{ r: 2.5, strokeWidth: 0, fill: COLORS.current }} activeDot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">Paid = QB Amount Paid · US dollars · India time</p>
    </div>
  )
}

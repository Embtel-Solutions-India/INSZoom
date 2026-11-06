import { useState, useEffect, useCallback } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import api from '../services/api'
import { useOptionalSocket } from '../contexts/SocketContext'
import { FINANCE_COLORS } from '../utils/financeColors'

// Monthly revenue as bars: for each of the last 12 months, the fees set (GoHighLevel Value) next to what was paid (QB Amount Paid). US dollars, India time.
// Live from the database: refreshes when any case's figures change and every 30 seconds.
const usd = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(amount) || 0)
const short = (value) => `$${Math.round(Number(value) || 0).toLocaleString('en-US')}`

export default function MonthlyRevenueBars({ title = 'Monthly revenue', height = 300 }) {
  const socket = useOptionalSocket()
  const [points, setPoints] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await api.get('/analytics/payments/trend', { params: { granularity: 'month' } })
      setPoints(response.data.points || [])
      setError('')
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load the monthly revenue.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!socket?.connected || !socket?.subscribe) return undefined
    return socket.subscribe('payment:updated', load)
  }, [socket?.connected, socket?.subscribe, load])
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load() }, 30000)
    return () => clearInterval(timer)
  }, [load])

  const hasData = points.some((point) => point.paid || point.total)
  return (
    <div className="card">
      <h3 className="text-lg font-semibold text-foreground mb-4">{title}</h3>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {loading ? (
        <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>Loading…</div>
      ) : !hasData ? (
        <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>No revenue data available</div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={points} margin={{ left: 0, right: 8, top: 6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={short} width={68} />
            <Tooltip formatter={(value, name) => [usd(value), name]} contentStyle={{ fontSize: 12, borderRadius: 8 }} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
            <Legend wrapperStyle={{ fontSize: 12 }} formatter={(value) => <span className="text-muted-foreground">{value}</span>} />
            <Bar dataKey="total" name="Total fees" fill={FINANCE_COLORS.total} radius={[4, 4, 0, 0]} />
            <Bar dataKey="paid" name="Paid" fill={FINANCE_COLORS.paid} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

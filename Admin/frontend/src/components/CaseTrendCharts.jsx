import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

// Analytics: "Cases Submitted" and "Active & On Hold Cases": a bar per month, counting only what happened IN that month.
// Data comes from GET /analytics/case-trends. Each card keeps its own state, so switching the filter redraws only that card.

const empty = (text) => <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">{text}</div>

export const CasesSubmittedChart = ({ months }) => {
  const data = useMemo(() => (months || []).map((item) => ({
    name: item.label,
    full: `${item.label} ${item.year}`,
    value: item.count,
  })), [months])
  const total = data.reduce((sum, item) => sum + item.value, 0)
  return (
    <div className="card">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="text-lg font-semibold text-foreground">Cases Submitted</h3>
        <span className="text-xs text-muted-foreground">Sent to Submitted, per month &middot; last 12 months &middot; {total} total</span>
      </div>
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" />
            <YAxis allowDecimals={false} />
            <Tooltip labelFormatter={(_, payload) => payload?.[0]?.payload?.full || ''} formatter={(value) => [value, 'Cases submitted']} />
            <Bar dataKey="value" fill="#10b981" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : empty('No data available')}
    </div>
  )
}

const SERIES = [
  { key: 'active', label: 'Active', color: '#10b981' },
  { key: 'onHold', label: 'On Hold', color: '#f59e0b' },
]

// Per month, not cumulative: cases that became active / went on hold IN that month.
export const MonthlyFlowChart = ({ months }) => {
  const data = useMemo(() => (months || []).map((item) => ({
    name: item.label,
    full: `${item.label} ${item.year}`,
    active: item.active,
    onHold: item.onHold,
  })), [months])
  return (
    <div className="card">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="text-lg font-semibold text-foreground">Active &amp; On Hold Cases</h3>
        <span className="text-xs text-muted-foreground">Per month &middot; last 12 months</span>
      </div>
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" />
            <YAxis allowDecimals={false} />
            <Tooltip labelFormatter={(_, payload) => payload?.[0]?.payload?.full || ''} />
            <Legend verticalAlign="top" height={28} />
            {SERIES.map((item) => (
              <Bar key={item.key} dataKey={item.key} name={item.label} fill={item.color} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      ) : empty('No data available')}
    </div>
  )
}

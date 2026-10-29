// Dashboard charts on Recharts, the same library and chart patterns the Admin dashboard uses
// (ResponsiveContainer + vertical BarChart / donut PieChart). Colours are the portal's theme tokens
// so light and dark mode both work.
import { useId } from 'react'
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'

export const SERIES = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))']
export const NEUTRAL = 'hsl(var(--muted-foreground) / 0.35)'
// Trend line colour: a vivid royal blue, chosen by the owner from a reference swatch.
const TREND = '#2D6BF4'

const pretty = (label) => String(label || 'unknown').replace(/_/g, ' ')
const TICK = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' }
const TOOLTIP = {
  contentStyle: {
    fontSize: 12,
    borderRadius: 8,
    background: 'hsl(var(--popover))',
    color: 'hsl(var(--popover-foreground))',
    border: '1px solid hsl(var(--border))',
  },
  cursor: { fill: 'hsl(var(--muted) / 0.6)' },
}

export function Panel({ title, subtitle, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </section>
  )
}

export function Empty({ children = 'No data yet.' }) {
  return <p className="py-8 text-center text-xs text-muted-foreground">{children}</p>
}

// Donut with the headline figure in the middle and a legend beside it.
export function Donut({ parts, centerValue, centerLabel }) {
  const total = parts.reduce((sum, p) => sum + p.value, 0)
  const data = total > 0 ? parts : [{ label: 'none', value: 1, color: 'hsl(var(--muted))' }]
  return (
    <div className="flex items-center gap-6">
      <div className="relative w-36 h-36 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius={48} outerRadius={66} paddingAngle={total > 0 ? 2 : 0} stroke="none">
              {data.map((entry) => <Cell key={entry.label} fill={entry.color} />)}
            </Pie>
            {total > 0 && <Tooltip {...TOOLTIP} />}
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-bold font-serif text-foreground">{centerValue}</span>
          <span className="text-[11px] text-muted-foreground">{centerLabel}</span>
        </div>
      </div>
      <ul className="space-y-2 text-sm min-w-0 flex-1">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: p.color }} />
            <span className="text-muted-foreground">{p.label}</span>
            <span className="ml-auto pl-3 font-semibold text-foreground tabular-nums">{p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Ranked horizontal bars (visa type, priority, task status), same shape as Admin's "cases by visa type".
export function BarList({ items, colorIndex = 0 }) {
  const data = items.map((i) => ({ name: pretty(i.label), value: i.value }))
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 30)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 8, top: 0, bottom: 0 }}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis dataKey="name" type="category" width={96} tick={TICK} axisLine={false} tickLine={false} />
        <Tooltip {...TOOLTIP} />
        <Bar dataKey="value" fill={SERIES[colorIndex % SERIES.length]} radius={[0, 4, 4, 0]} barSize={10} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// Trend line with a soft shadow (gradient fill) beneath it (cases assigned per month).
export function Columns({ items, name = 'Cases' }) {
  return (
    <ResponsiveContainer width="100%" height={190}>
      <AreaChart data={items} margin={{ left: -20, right: 16, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="attorneyTrendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TREND} stopOpacity={0.28} />
            <stop offset="100%" stopColor={TREND} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={TICK} axisLine={false} tickLine={false} />
        <Tooltip {...TOOLTIP} cursor={{ stroke: 'hsl(var(--border))' }} />
        <Area type="monotone" dataKey="value" name={name} stroke={TREND} strokeWidth={2} fill="url(#attorneyTrendFill)"
          dot={{ r: 3, fill: TREND, strokeWidth: 0 }} activeDot={{ r: 5, strokeWidth: 0 }} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// Case status as a donut plus a legend with counts.
// Status slices start at violet so this chart is not the same blue as Review progress.
const STATUS_ORDER = [3, 1, 2, 4, 0]

export function StatusDonut({ items }) {
  const total = items.reduce((s, i) => s + i.value, 0)
  if (!total) return <Empty />
  const parts = items.map((item, i) => ({ label: pretty(item.label), value: item.value, color: SERIES[STATUS_ORDER[i]] || NEUTRAL }))
  return <Donut parts={parts} centerValue={total} centerLabel="cases" />
}

// Tiny axis-less trend line for the top cards.
export function Sparkline({ values, color }) {
  const id = `spark${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const data = values.map((value, i) => ({ i, value }))
  return (
    <ResponsiveContainer width="100%" height={36}>
      <AreaChart data={data} margin={{ top: 6, right: 2, bottom: 2, left: 2 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={[0, (max) => Math.max(1, max) * 1.15]} />
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.75} fill={`url(#${id})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// "vs last week" wording from two real values. unit "pts" is for percentages.
export function weekDelta(current, previous, unit) {
  const diff = current - previous
  if (diff === 0) return { text: 'No change vs last week', direction: 0 }
  const sign = diff > 0 ? '+' : '−'
  const abs = Math.abs(diff)
  if (unit === 'pts') return { text: `${sign}${abs} pts vs last week`, direction: Math.sign(diff) }
  if (previous > 0) {
    const pct = Math.round((abs / previous) * 1000) / 10
    return { text: `${sign}${pct}% vs last week`, direction: Math.sign(diff) }
  }
  return { text: `${sign}${abs} vs last week`, direction: Math.sign(diff) }
}

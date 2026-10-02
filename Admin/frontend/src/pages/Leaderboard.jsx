import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../services/api'
import { Trophy, Award, RefreshCw } from 'lucide-react'

// Four live boards. Every figure is computed on the server from the same case,
// task and feedback data the dashboard reads - nothing here is a stored
// snapshot, and the page refreshes itself.
const BOARDS = [
  { key: 'case_managers', label: 'Case Managers', hint: 'Open and closed cases, tasks and overdue work per case manager.' },
  { key: 'team_leads', label: 'Team Leads', hint: 'Cases and tasks per team lead.' },
  { key: 'attorneys', label: 'Attorneys', hint: 'Cases being worked on, cases closed, and feedback given to the case team.' },
  { key: 'clients', label: 'Clients', hint: 'Which clients bring in the most cases.' },
]

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'this_week', label: 'This Week' },
  { key: 'this_month', label: 'This Month' },
  { key: 'all_time', label: 'All Time' },
]

const REFRESH_MS = 30000

// column: [header, row => value, optional text colour class]
const COLUMNS = {
  case_managers: (period) => [
    ['Open Cases', (r) => r.openCases],
    [period === 'all_time' ? 'Closed Cases' : 'Closed (Period)', (r) => r.closedCases, 'text-green-600'],
    ['Tasks Done', (r) => r.tasksCompleted],
    ['Overdue Tasks', (r) => r.overdueTasks, 'text-red-600'],
  ],
  team_leads: (period) => [
    ['Open Cases', (r) => r.openCases],
    [period === 'all_time' ? 'Closed Cases' : 'Closed (Period)', (r) => r.closedCases, 'text-green-600'],
    ['Tasks Done', (r) => r.tasksCompleted],
    ['Overdue Tasks', (r) => r.overdueTasks, 'text-red-600'],
  ],
  attorneys: (period) => [
    ['Working On', (r) => r.workingCases],
    [period === 'all_time' ? 'Closed Cases' : 'Closed (Period)', (r) => r.closedCases, 'text-green-600'],
    ['Cases With Feedback', (r) => r.feedbackCases],
    ['Feedback Messages', (r) => r.feedbackMessages],
    ['Feedback & Closed', (r) => r.feedbackAndClosed, 'text-green-600'],
  ],
  clients: (period) => [
    [period === 'all_time' ? 'Cases' : 'Cases (Period)', (r) => r.casesInPeriod],
    ['Total Cases', (r) => r.totalCases],
    ['Open', (r) => r.openCases],
    ['Closed', (r) => r.closedCases, 'text-green-600'],
    ['Last Case', (r) => (r.lastCaseAt ? new Date(r.lastCaseAt).toLocaleDateString() : '—')],
  ],
}

function RankCell({ rank }) {
  if (rank === 1) return <Trophy className="w-5 h-5 text-yellow-500" />
  if (rank === 2) return <Award className="w-5 h-5 text-muted-foreground" />
  if (rank === 3) return <Award className="w-5 h-5 text-amber-600" />
  return <span className="text-muted-foreground">{rank}</span>
}

const Leaderboard = () => {
  const [board, setBoard] = useState('case_managers')
  const [period, setPeriod] = useState('this_month')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)
  const hasLoadedOnce = useRef(false)

  const fetchLeaderboard = useCallback(async () => {
    try {
      if (!hasLoadedOnce.current) setLoading(true)
      const response = await api.get('/leaderboard', { params: { board, period } })
      setRows(response.data.rows || response.data.leaderboard || [])
      setUpdatedAt(response.data.generatedAt ? new Date(response.data.generatedAt) : new Date())
      setError('')
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load the leaderboard.')
    } finally {
      hasLoadedOnce.current = true
      setLoading(false)
    }
  }, [board, period])

  // Reload on tab/period change, then keep the board live.
  useEffect(() => {
    fetchLeaderboard()
    const timer = window.setInterval(fetchLeaderboard, REFRESH_MS)
    const onFocus = () => fetchLeaderboard()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [fetchLeaderboard])

  const active = BOARDS.find((b) => b.key === board)
  const columns = COLUMNS[board](period)
  const periodLabel = PERIODS.find((p) => p.key === period)?.label

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Leaderboard</h1>
        <p className="text-muted-foreground mt-1">Live rankings, calculated from the same case data as the dashboard.</p>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-1 rounded-lg border border-border p-1">
            {BOARDS.map((item) => (
              <button
                key={item.key}
                onClick={() => setBoard(item.key)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  board === item.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
              aria-label="Period"
            >
              {PERIODS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
            <button onClick={fetchLeaderboard} className="btn-secondary flex items-center gap-2 text-sm">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold text-foreground">{active.label} - {periodLabel}</h3>
            <p className="text-xs text-muted-foreground">{active.hint}</p>
          </div>
          {updatedAt && <span className="text-xs text-muted-foreground">Live · updated {updatedAt.toLocaleTimeString()}</span>}
        </div>

        {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        {loading ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">Loading leaderboard...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-muted">
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Rank</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Name</th>
                  {columns.map(([header]) => (
                    <th key={header} className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">{header}</th>
                  ))}
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Score</th>
                </tr>
              </thead>
              <tbody>
                {rows.length > 0 ? rows.map((row) => (
                  <tr key={row.id} className="border-b border-border hover:bg-muted">
                    <td className="whitespace-nowrap px-6 py-4"><RankCell rank={row.rank} /></td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <div className="font-medium text-foreground">{row.name}</div>
                      {row.email && <div className="text-xs text-muted-foreground">{row.email}</div>}
                    </td>
                    {columns.map(([header, value, tone]) => (
                      <td key={header} className={`whitespace-nowrap px-6 py-4 ${tone || ''}`}>{value(row)}</td>
                    ))}
                    <td className="whitespace-nowrap px-6 py-4 font-bold text-primary">{row.score}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={columns.length + 3} className="px-6 py-12 text-center text-muted-foreground">
                      No data available for this period
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default Leaderboard

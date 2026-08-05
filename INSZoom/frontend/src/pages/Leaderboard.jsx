import { useState, useEffect, useRef } from 'react'
import api from '../services/api'
import { Trophy, TrendingUp, Clock, CheckCircle, Award } from 'lucide-react'

const Leaderboard = () => {
  const [role, setRole] = useState('case_manager')
  const [period, setPeriod] = useState('this_month')
  const [leaderboard, setLeaderboard] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchLeaderboard()
  }, [role, period])

  // Only the very first load blocks the table — changing role/period
  // afterwards updates the rows in place.
  const hasLoadedOnce = useRef(false)

  const fetchLeaderboard = async () => {
    try {
      if (!hasLoadedOnce.current) setLoading(true)
      const response = await api.get('/leaderboard', { params: { role, period } })
      setLeaderboard(response.data.leaderboard)
    } catch (error) {
      console.error('Error fetching leaderboard:', error)
    } finally {
      hasLoadedOnce.current = true
      setLoading(false)
    }
  }

  const getRoleLabel = (r) => {
    const labels = {
      case_manager: 'Case Manager'
    }
    return labels[r] || r
  }

  const getColumns = () => {
    if (role === 'case_manager') {
      return ['Rank', 'Name', 'Active Cases', 'Closed Cases', 'Overdue Cases', 'Score']
    }
    return []
  }

  const renderRow = (item, index) => {
    const rankIcon = index === 0 ? <Trophy className="w-5 h-5 text-yellow-500" /> : 
                    index === 1 ? <Award className="w-5 h-5 text-gray-400" /> :
                    index === 2 ? <Award className="w-5 h-5 text-amber-600" /> :
                    <span className="text-gray-600">{item.rank}</span>

    if (role === 'case_manager') {
      return (
        <tr key={index} className="border-b hover:bg-gray-50">
          <td className="px-6 py-4 whitespace-nowrap">{rankIcon}</td>
          <td className="px-6 py-4 whitespace-nowrap font-medium">{item.name}</td>
          <td className="px-6 py-4 whitespace-nowrap">{item.activeCases}</td>
          <td className="px-6 py-4 whitespace-nowrap text-green-600">{item.closedCases}</td>
          <td className="px-6 py-4 whitespace-nowrap text-red-600">{item.overdueCases}</td>
          <td className="px-6 py-4 whitespace-nowrap font-bold text-blue-600">{item.score}</td>
        </tr>
      )
    }
    return null
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Leaderboard</h1>
        <p className="text-gray-600 mt-1">Track staff performance and rankings</p>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap gap-4 items-center">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="case_manager">Case Manager</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Period</label>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="today">Today</option>
              <option value="this_week">This Week</option>
              <option value="this_month">This Month</option>
            </select>
          </div>
          <button
            onClick={fetchLeaderboard}
            className="btn-primary mt-6"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Leaderboard Table */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">
            {getRoleLabel(role)} Leaderboard - {period.replace('_', ' ').toUpperCase()}
          </h3>
          <button
            onClick={() => api.post('/leaderboard/calculate', { period })}
            className="btn-secondary text-sm"
          >
            <TrendingUp className="w-4 h-4 inline mr-1" />
            Calculate Performance
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-600">Loading leaderboard...</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-gray-50">
                  {getColumns().map((col, index) => (
                    <th key={index} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leaderboard.length > 0 ? (
                  leaderboard.map((item, index) => renderRow(item, index))
                ) : (
                  <tr>
                    <td colSpan={getColumns().length} className="px-6 py-12 text-center text-gray-500">
                      No data available for this period
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Score Formula */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Score Formula</h3>
        <div className="text-sm text-gray-600 space-y-2">
          {role === 'case_manager' && (
            <p><strong>Case Manager:</strong> Closed Cases × 10 - Overdue Cases × 5</p>
          )}
        </div>
      </div>
    </div>
  )
}

export default Leaderboard

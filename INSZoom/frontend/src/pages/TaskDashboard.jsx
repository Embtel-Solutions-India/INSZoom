import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'
import {
  CheckCircle,
  Clock,
  AlertTriangle,
  TrendingUp,
  Calendar,
  Users,
  FileText,
  ArrowUpRight,
  Filter,
  Plus,
  Search
} from 'lucide-react'

const TaskDashboard = () => {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [recentTasks, setRecentTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const defaultStats = {
    statusCounts: {
      pending: 0,
      assigned: 0,
      in_progress: 0,
      waiting: 0,
      blocked: 0,
      completed: 0,
      cancelled: 0
    },
    priorityCounts: {
      low: 0,
      medium: 0,
      high: 0,
      urgent: 0
    },
    overdueCount: 0,
    upcomingCount: 0,
    total: 0
  }

  // Role helper
  const is = (roles) => roles.includes(user?.role)

  useEffect(() => {
    fetchTaskStats()
    fetchRecentTasks()
  }, [user?.role])

  const fetchTaskStats = async () => {
    try {
      const response = await api.get('/tasks/stats/dashboard')
      setStats({
        ...defaultStats,
        ...(response.data.stats || {}),
        statusCounts: { ...defaultStats.statusCounts, ...(response.data.stats?.statusCounts || {}) },
        priorityCounts: { ...defaultStats.priorityCounts, ...(response.data.stats?.priorityCounts || {}) }
      })
      setError(null)
    } catch (error) {
      console.error('Error fetching task stats:', error)
      setError('Failed to load task statistics')
      setStats(defaultStats)
    } finally {
      setLoading(false)
    }
  }

  const fetchRecentTasks = async () => {
    try {
      const response = await api.get('/tasks', {
        params: { limit: 5, sort: '-createdAt' }
      })
      setRecentTasks(response.data.tasks || response.data.items || response.data.data || [])
    } catch (error) {
      console.error('Error fetching recent tasks:', error)
    }
  }

  const getStatusColor = (status) => {
    const colors = {
      pending: 'bg-gray-100 text-gray-800',
      assigned: 'bg-blue-100 text-blue-800',
      in_progress: 'bg-yellow-100 text-yellow-800',
      waiting: 'bg-orange-100 text-orange-800',
      completed: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800'
    }
    return colors[status] || 'bg-gray-100 text-gray-800'
  }

  const getPriorityColor = (priority) => {
    const colors = {
      low: 'bg-gray-100 text-gray-800',
      medium: 'bg-blue-100 text-blue-800',
      high: 'bg-orange-100 text-orange-800',
      urgent: 'bg-red-100 text-red-800'
    }
    return colors[priority] || 'bg-gray-100 text-gray-800'
  }

  const formatStatus = (status) => {
    return String(status || '').split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
  }

  const StatCard = ({ title, value, icon: Icon, color, trend }) => (
    <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
          {trend && (
            <div className={`flex items-center text-sm mt-2 ${trend > 0 ? 'text-green-600' : 'text-red-600'}`}>
              <TrendingUp className="w-4 h-4 mr-1" />
              {Math.abs(trend)}% from last week
            </div>
          )}
        </div>
        <div className={`p-3 rounded-lg ${color}`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </div>
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Task Dashboard</h1>
          <p className="text-gray-600 mt-1">Overview of your task management</p>
        </div>
        {is(['super_admin', 'admin', 'team_lead', 'case_manager']) && (
          <button
            onClick={() => navigate('/tasks/create')}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Create Task
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {stats && (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCard
              title="Total Tasks"
              value={stats.total}
              icon={FileText}
              color="bg-blue-100 text-blue-600"
              trend={5}
            />
            <StatCard
              title="Overdue Tasks"
              value={stats.overdueCount}
              icon={AlertTriangle}
              color="bg-red-100 text-red-600"
              trend={-2}
            />
            <StatCard
              title="Upcoming Tasks"
              value={stats.upcomingCount}
              icon={Calendar}
              color="bg-blue-100 text-blue-600"
              trend={8}
            />
            <StatCard
              title="Completed Tasks"
              value={stats.statusCounts?.completed || 0}
              icon={CheckCircle}
              color="bg-green-100 text-green-600"
              trend={12}
            />
          </div>

          {/* Status Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Tasks by Status</h3>
              <div className="space-y-3">
                {Object.entries(stats.statusCounts || defaultStats.statusCounts).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(status)}`}>
                        {formatStatus(status)}
                      </span>
                    </div>
                    <span className="font-semibold text-gray-900">{count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Tasks by Priority</h3>
              <div className="space-y-3">
                {Object.entries(stats.priorityCounts || defaultStats.priorityCounts).map(([priority, count]) => (
                  <div key={priority} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${getPriorityColor(priority)}`}>
                        {priority.charAt(0).toUpperCase() + priority.slice(1)}
                      </span>
                    </div>
                    <span className="font-semibold text-gray-900">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <button
          onClick={() => navigate('/tasks/my-tasks')}
          className="bg-white rounded-xl shadow-sm p-4 border border-gray-100 hover:border-blue-500 transition-colors text-left"
        >
          <Users className="w-6 h-6 text-blue-600 mb-2" />
          <h3 className="font-semibold text-gray-900">My Tasks</h3>
          <p className="text-sm text-gray-600">View assigned tasks</p>
        </button>

        {is(['super_admin', 'admin', 'team_lead']) && (
          <button
            onClick={() => navigate('/tasks/team-tasks')}
            className="bg-white rounded-xl shadow-sm p-4 border border-gray-100 hover:border-blue-500 transition-colors text-left"
          >
            <Users className="w-6 h-6 text-blue-600 mb-2" />
            <h3 className="font-semibold text-gray-900">Team Tasks</h3>
            <p className="text-sm text-gray-600">View team tasks</p>
          </button>
        )}

        <button
          onClick={() => navigate('/tasks/calendar')}
          className="bg-white rounded-xl shadow-sm p-4 border border-gray-100 hover:border-blue-500 transition-colors text-left"
        >
          <Calendar className="w-6 h-6 text-purple-600 mb-2" />
          <h3 className="font-semibold text-gray-900">Task Calendar</h3>
          <p className="text-sm text-gray-600">View calendar view</p>
        </button>

        <button
          onClick={() => navigate('/tasks/all')}
          className="bg-white rounded-xl shadow-sm p-4 border border-gray-100 hover:border-blue-500 transition-colors text-left"
        >
          <FileText className="w-6 h-6 text-orange-600 mb-2" />
          <h3 className="font-semibold text-gray-900">All Tasks</h3>
          <p className="text-sm text-gray-600">View all tasks</p>
        </button>
      </div>

      {/* Recent Tasks */}
      {recentTasks.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Recent Tasks</h3>
            <button
              onClick={() => navigate('/tasks/all')}
              className="text-blue-600 hover:text-blue-700 flex items-center gap-1 text-sm font-medium"
            >
              View All <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-3">
            {recentTasks.map(task => (
              <div
                key={task._id}
                onClick={() => navigate(`/tasks/${task._id}`)}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <div className="flex-1">
                  <h4 className="font-medium text-gray-900">{task.title}</h4>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getPriorityColor(task.priority)}`}>
                      {task.priority}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(task.status)}`}>
                      {formatStatus(task.status)}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-600">
                    Due: {new Date(task.dueDate).toLocaleDateString()}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {task.assignedTo?.name}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default TaskDashboard

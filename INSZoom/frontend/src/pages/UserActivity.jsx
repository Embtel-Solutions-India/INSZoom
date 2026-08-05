import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import {
  Activity,
  ArrowLeft,
  Calendar,
  Clock,
  Filter,
  Search,
  FileText,
  User,
  Settings,
  Shield,
  Database
} from 'lucide-react'

const UserActivity = () => {
  const { user: currentUser } = useAuth()
  const navigate = useNavigate()
  const { id } = useParams()
  const [loading, setLoading] = useState(true)
  const [activities, setActivities] = useState([])
  const [userData, setUserData] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')

  useEffect(() => {
    fetchUser()
    fetchActivities()
  }, [id])

  const fetchUser = async () => {
    try {
      const response = await api.get(`/users/${id}`)
      setUserData(response.data.user)
    } catch (error) {
      console.error('Error fetching user:', error)
    }
  }

  const fetchActivities = async () => {
    try {
      const response = await api.get(`/audit-logs/user/${id}`)
      setActivities(response.data.logs || [])
    } catch (error) {
      console.error('Error fetching activities:', error)
    } finally {
      setLoading(false)
    }
  }

  const getActionIcon = (action) => {
    const icons = {
      create: FileText,
      update: Settings,
      delete: Database,
      login: User,
      logout: User,
      assign: Shield,
      view: Activity
    }
    const Icon = icons[action] || Activity
    return <Icon className="w-4 h-4" />
  }

  const getActionColor = (action) => {
    const colors = {
      create: 'bg-green-100 text-green-800',
      update: 'bg-blue-100 text-blue-800',
      delete: 'bg-red-100 text-red-800',
      login: 'bg-blue-100 text-blue-800',
      logout: 'bg-gray-100 text-gray-800',
      assign: 'bg-purple-100 text-purple-800',
      view: 'bg-cyan-100 text-cyan-800'
    }
    return colors[action] || 'bg-gray-100 text-gray-800'
  }

  const filteredActivities = activities.filter(activity => {
    const action = activity.action || ''
    const matchesSearch = activity.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         action?.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesAction = !actionFilter || action === actionFilter
    const matchesDate = !dateFilter || new Date(activity.createdAt).toDateString() === new Date(dateFilter).toDateString()
    return matchesSearch && matchesAction && matchesDate
  })

  if (loading) {
    return <div className="text-gray-600">Loading activity data...</div>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center text-white">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">User Activity</h1>
            <p className="text-gray-600">
              {userData?.name || 'User'} - Activity log and audit trail
            </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">Filters:</span>
          </div>
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Search activities..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          <div>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Actions</option>
              <option value="create">Create</option>
              <option value="update">Update</option>
              <option value="delete">Delete</option>
              <option value="login">Login</option>
              <option value="logout">Logout</option>
              <option value="assign">Assign</option>
              <option value="view">View</option>
            </select>
          </div>
          <div>
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Activity Timeline */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-900">Activity Timeline</h2>
          <span className="text-sm text-gray-600">
            {filteredActivities.length} activities
          </span>
        </div>

        {filteredActivities.length > 0 ? (
          <div className="space-y-4">
            {filteredActivities.map((activity, index) => (
              <div key={activity._id || index} className="flex gap-4 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${getActionColor(activity.action)}`}>
                  {getActionIcon(activity.action)}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-medium text-gray-900 capitalize">
                      {activity.action}
                    </h3>
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <Calendar className="w-4 h-4" />
                      {new Date(activity.createdAt).toLocaleDateString()}
                      <Clock className="w-4 h-4" />
                      {new Date(activity.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                  <p className="text-gray-600 text-sm">{activity.description}</p>
                  {activity.entityType && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-500">
                        Entity: {activity.entityType}
                      </span>
                      {activity.entityId && (
                        <span className="text-xs text-gray-400">
                          ID: {activity.entityId}
                        </span>
                      )}
                    </div>
                  )}
                  {activity.ipAddress && (
                    <div className="mt-2 text-xs text-gray-400">
                      IP: {activity.ipAddress}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-500">
            <Activity className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>No activity found</p>
          </div>
        )}
      </div>

      {/* User Info Summary */}
      {userData && (
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">User Information</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="text-xs text-gray-500">Name</label>
              <p className="font-medium text-gray-900">{userData.name}</p>
            </div>
            <div>
              <label className="text-xs text-gray-500">Email</label>
              <p className="font-medium text-gray-900">{userData.email}</p>
            </div>
            <div>
              <label className="text-xs text-gray-500">Role</label>
              <p className="font-medium text-gray-900 capitalize">{userData.role.replace('_', ' ')}</p>
            </div>
            <div>
              <label className="text-xs text-gray-500">Status</label>
              <p className={`font-medium ${userData.isActive ? 'text-green-600' : 'text-red-600'}`}>
                {userData.isActive ? 'Active' : 'Inactive'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default UserActivity

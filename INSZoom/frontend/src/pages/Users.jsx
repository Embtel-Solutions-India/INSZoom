import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { getRoleDisplayName, getAssignableRoles, canModifyUser, canCreateUserRole } from '../utils/permissions'
import InfoModal from '../components/InfoModal'
import {
  Users as UsersIcon,
  Search,
  Plus,
  Shield,
  Edit,
  Trash2,
  Filter,
  MoreVertical,
  Eye,
  Activity
} from 'lucide-react'

const Users = () => {
  const { user: currentUser } = useAuth()
  const navigate = useNavigate()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [selectedUser, setSelectedUser] = useState(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  // P12-S2: replaces window.alert() calls previously fired below.
  const [infoModal, setInfoModal] = useState(null)

  const assignableRoles = getAssignableRoles(currentUser)

  // Search/role/status filtering now happens server-side (the API already
  // supported it) instead of fetching every user and filtering in the
  // browser. Initial load fetches immediately; subsequent filter/search
  // changes are debounced so typing doesn't fire a request per keystroke.
  const isFirstRun = useRef(true)
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false
      fetchUsers()
      return
    }
    const handle = setTimeout(() => { fetchUsers() }, 300)
    return () => clearTimeout(handle)
  }, [searchTerm, roleFilter, statusFilter])

  const fetchUsers = async () => {
    try {
      const params = { limit: 200 }
      if (searchTerm) params.search = searchTerm
      if (roleFilter) params.role = roleFilter
      if (statusFilter) params.isActive = statusFilter === 'active'
      const response = await api.get('/users', { params })
      setUsers(response.data.users || [])
    } catch (error) {
      console.error('Error fetching users:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateUser = () => {
    if (!canCreateUserRole(currentUser, 'case_manager')) {
      setInfoModal({ message: 'You do not have permission to create users', variant: 'error' })
      return
    }
    navigate('/users/create')
  }

  const handleEditUser = (user) => {
    if (!canModifyUser(currentUser, user)) {
      setInfoModal({ message: 'You do not have permission to edit this user', variant: 'error' })
      return
    }
    navigate(`/users/${user._id}/edit`)
  }

  const handleDeleteUser = (user) => {
    if (!canModifyUser(currentUser, user)) {
      setInfoModal({ message: 'You do not have permission to delete this user', variant: 'error' })
      return
    }
    setSelectedUser(user)
    setShowDeleteConfirm(true)
  }

  const confirmDelete = async () => {
    try {
      await api.delete(`/users/${selectedUser._id}`)
      setShowDeleteConfirm(false)
      setSelectedUser(null)
      fetchUsers()
    } catch (error) {
      console.error('Error deleting user:', error)
      setInfoModal({ message: 'Failed to delete user', variant: 'error' })
    }
  }

  const handleViewPerformance = (userId) => {
    navigate(`/staff-profile/${userId}`)
  }

  const handleViewActivity = (userId) => {
    navigate(`/users/${userId}/activity`)
  }

  const getRoleBadge = (role) => {
    const colors = {
      super_admin: 'bg-red-100 text-red-800',
      admin: 'bg-amber-100 text-amber-800',
      team_lead: 'bg-purple-100 text-purple-800',
      sales_manager: 'bg-blue-100 text-blue-800',
      case_manager: 'bg-blue-100 text-blue-800',
      finance: 'bg-cyan-100 text-cyan-800',
      employer: 'bg-orange-100 text-orange-800',
      client: 'bg-gray-100 text-gray-800'
    }
    return colors[role] || 'bg-gray-100 text-gray-800'
  }

  if (loading) {
    return <div className="text-gray-600">Loading users...</div>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="text-gray-600 mt-1">Manage internal team members and permissions</p>
        </div>
        <button
          onClick={handleCreateUser}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add User
        </button>
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
                placeholder="Search users..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          <div>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Roles</option>
              {assignableRoles.map(role => (
                <option key={role} value={role}>{getRoleDisplayName(role)}</option>
              ))}
            </select>
          </div>
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
      </div>

      {/* Users Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Department</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length > 0 ? (
                users.map((user) => (
                  <tr key={user._id} className="border-b hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-white font-semibold">
                          {user.name?.charAt(0) || 'U'}
                        </div>
                        <div>
                          <div className="font-medium text-gray-900">{user.name}</div>
                          <div className="text-sm text-gray-500">{user.phone || 'No phone'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-600">{user.email}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${getRoleBadge(user.role)}`}>
                        {getRoleDisplayName(user.role)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-600">{user.department || 'N/A'}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${user.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {user.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleViewActivity(user._id)}
                          className="p-2 text-gray-600 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                          title="View Activity"
                        >
                          <Activity className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleViewPerformance(user._id)}
                          className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="View Performance"
                        >
                          <Activity className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleEditUser(user)}
                          className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Edit User"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteUser(user)}
                          className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete User"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    No users found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Delete User</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete <strong>{selectedUser?.name}</strong>? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="btn-primary flex-1 bg-red-600 hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {infoModal && (
        <InfoModal
          title={infoModal.title}
          message={infoModal.message}
          variant={infoModal.variant}
          onClose={() => setInfoModal(null)}
        />
      )}
    </div>
  )
}

export default Users

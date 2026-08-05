import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import api from '../services/api'
import { User, Mail, Briefcase, CheckCircle, AlertTriangle, TrendingUp, ArrowLeft } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

const StaffProfile = () => {
  const { userId } = useParams()
  const [staff, setStaff] = useState(null)
  const [performance, setPerformance] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStaffProfile()
    fetchPerformance()
  }, [userId])

  const fetchStaffProfile = async () => {
    try {
      const response = await api.get(`/users/${userId}`)
      setStaff(response.data)
    } catch (error) {
      console.error('Error fetching staff profile:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchPerformance = async () => {
    try {
      const response = await api.get(`/users/${userId}/performance`)
      setPerformance(response.data.performance || [])
    } catch (error) {
      console.error('Error fetching performance:', error)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-600">Loading profile...</div>
      </div>
    )
  }

  if (!staff) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-600">Staff not found</div>
      </div>
    )
  }

  const renderCaseManagerStats = () => (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="p-4 bg-blue-50 rounded-lg">
        <p className="text-sm font-medium text-gray-900 mb-1">Active Cases</p>
        <p className="text-2xl font-bold text-blue-600">{staff.activeCases || 0}</p>
      </div>
      <div className="p-4 bg-green-50 rounded-lg">
        <p className="text-sm font-medium text-gray-900 mb-1">Closed Cases</p>
        <p className="text-2xl font-bold text-green-600">{staff.closedCases || 0}</p>
      </div>
      <div className="p-4 bg-red-50 rounded-lg">
        <p className="text-sm font-medium text-gray-900 mb-1">Overdue Cases</p>
        <p className="text-2xl font-bold text-red-600">{staff.overdueCases || 0}</p>
      </div>
    </div>
  )

  const renderStats = () => {
    switch (staff.role) {
      case 'case_manager':
        return renderCaseManagerStats()
      default:
        return null
    }
  }

  const getRoleLabel = (role) => {
    const labels = {
      case_manager: 'Case Manager',
      admin: 'Admin',
      super_admin: 'Super Admin',
      finance: 'Finance'
    }
    return labels[role] || role
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Staff Profile</h1>
        <p className="text-gray-600 mt-1">View detailed staff information and performance</p>
      </div>

      {/* Profile Info */}
      <div className="card">
        <div className="flex items-start gap-6">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-white text-2xl font-bold">
            {staff.name?.charAt(0)?.toUpperCase()}
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-gray-900">{staff.name}</h2>
            <div className="flex items-center gap-4 mt-2 text-gray-600">
              <span className="flex items-center gap-1">
                <Mail className="w-4 h-4" />
                {staff.email}
              </span>
              <span className="flex items-center gap-1">
                <User className="w-4 h-4" />
                {getRoleLabel(staff.role)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Performance Metrics</h3>
        {renderStats()}
      </div>

      {/* Performance Chart */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Monthly Performance</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={performance}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="score" fill="#10b981" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Current Cases */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Currently Assigned</h3>
        <div className="text-gray-600">
          {staff.currentCases?.length > 0 ? (
            <div className="space-y-2">
              {staff.currentCases.map((caseItem, index) => (
                <div key={index} className="p-3 bg-gray-50 rounded-lg flex justify-between items-center">
                  <span>{caseItem.caseNumber}</span>
                  <span className="text-sm text-gray-500">{caseItem.clientName}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center py-8">No cases currently assigned</p>
          )}
        </div>
      </div>
    </div>
  )
}

export default StaffProfile

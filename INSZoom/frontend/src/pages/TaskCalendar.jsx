import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  Clock,
  AlertTriangle,
  Plus,
  Filter,
  ArrowLeft
} from 'lucide-react'

const TaskCalendar = () => {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState(null)
  const [filters, setFilters] = useState({
    status: '',
    priority: ''
  })

  useEffect(() => {
    const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
    const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0)
    fetchCalendarTasks(startOfMonth, endOfMonth)
  }, [currentDate, filters])

  const fetchCalendarTasks = async (startDate, endDate) => {
    try {
      setLoading(true)
      const response = await api.get('/tasks/calendar', {
        params: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          ...filters
        }
      })
      setTasks(Array.isArray(response.data?.tasks) ? response.data.tasks : [])
      setError(null)
    } catch (error) {
      console.error('Error fetching calendar tasks:', error)
      setError('Failed to load calendar tasks')
    } finally {
      setLoading(false)
    }
  }

  const getDaysInMonth = (date) => {
    const year = date.getFullYear()
    const month = date.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()
    const startDayOfWeek = firstDay.getDay()
    
    const days = []
    
    // Add empty days for the start of the month
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push({ day: null, date: null })
    }
    
    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day)
      days.push({ day, date })
    }
    
    return days
  }

  const getTasksForDate = (date) => {
    if (!date) return []
    const dateStr = date.toDateString()
    return (tasks || []).filter(task => {
      if (!task.dueDate) return false
      const parsed = new Date(task.dueDate)
      return !Number.isNaN(parsed.getTime()) && parsed.toDateString() === dateStr
    })
  }

  const getPriorityColor = (priority) => {
    const colors = {
      low: 'border-gray-300 bg-gray-50',
      medium: 'border-blue-300 bg-blue-50',
      high: 'border-orange-300 bg-orange-50',
      urgent: 'border-red-300 bg-red-50'
    }
    return colors[priority] || 'border-gray-300 bg-gray-50'
  }

  const getPriorityIcon = (priority) => {
    switch (priority) {
      case 'urgent': return <AlertTriangle className="w-3 h-3 text-red-600" />
      case 'high': return <AlertTriangle className="w-3 h-3 text-orange-600" />
      case 'medium': return <Clock className="w-3 h-3 text-blue-600" />
      default: return <Clock className="w-3 h-3 text-gray-600" />
    }
  }

  const isToday = (date) => {
    if (!date) return false
    const today = new Date()
    return date.toDateString() === today.toDateString()
  }

  const isPastDate = (date) => {
    if (!date) return false
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return date < today
  }

  const formatPriority = (priority) => {
    const value = String(priority || 'medium')
    return value.charAt(0).toUpperCase() + value.slice(1)
  }

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))
  }

  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))
  }

  const goToToday = () => {
    setCurrentDate(new Date())
  }

  const handleDateClick = (date, tasksForDate) => {
    if (tasksForDate.length > 0) {
      setSelectedDate(date)
    }
  }

  const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                  'July', 'August', 'September', 'October', 'November', 'December']
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  const daysInMonth = getDaysInMonth(currentDate)

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
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/tasks')}
            className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            aria-label="Back to task dashboard"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Task Calendar</h1>
            <p className="text-gray-600 mt-1">View and manage task deadlines</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/tasks/create')}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Create Task
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Calendar Controls */}
      <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <button
              onClick={prevMonth}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold text-gray-900">
              {months[currentDate.getMonth()]} {currentDate.getFullYear()}
            </h2>
            <button
              onClick={nextMonth}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            <button
              onClick={goToToday}
              className="px-3 py-1 text-sm text-blue-600 hover:text-blue-700 border border-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
            >
              Today
            </button>
          </div>

          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-600" />
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="px-3 py-1 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Status</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>
            <select
              value={filters.priority}
              onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
              className="px-3 py-1 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Priority</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-2">
          {/* Day Headers */}
          {days.map(day => (
            <div key={day} className="text-center text-sm font-medium text-gray-600 py-2">
              {day}
            </div>
          ))}

          {/* Calendar Days */}
          {daysInMonth.map(({ day, date }, index) => {
            const tasksForDate = date ? getTasksForDate(date) : []
            const isCurrentDay = date && isToday(date)
            const isPast = date && isPastDate(date)

            return (
              <div
                key={index}
                onClick={() => date && tasksForDate.length > 0 && handleDateClick(date, tasksForDate)}
                className={`
                  min-h-24 p-2 border rounded-lg transition-colors
                  ${day 
                    ? isCurrentDay 
                      ? 'border-blue-500 bg-blue-50' 
                      : isPast 
                        ? 'border-gray-200 bg-gray-50' 
                        : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50 cursor-pointer'
                    : 'border-transparent bg-transparent'
                  }
                `}
              >
                {day && (
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-sm font-medium ${isCurrentDay ? 'text-blue-600' : 'text-gray-900'}`}>
                      {day}
                    </span>
                  </div>
                )}
                
                {tasksForDate.length > 0 && (
                  <div className="space-y-1">
                    {tasksForDate.slice(0, 3).map(task => (
                      <div
                        key={task._id}
                        onClick={(e) => {
                          e.stopPropagation()
                          navigate(`/tasks/${task._id}`)
                        }}
                        className={`
                          text-xs p-1 rounded truncate border cursor-pointer
                          ${getPriorityColor(task.priority)}
                        `}
                        title={task.title || 'Untitled task'}
                      >
                        <div className="flex items-center gap-1">
                          {getPriorityIcon(task.priority)}
                          <span className="truncate">{task.title || 'Untitled task'}</span>
                        </div>
                      </div>
                    ))}
                    {tasksForDate.length > 3 && (
                      <div className="text-xs text-gray-500 text-center">
                        +{tasksForDate.length - 3} more
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Selected Date Tasks */}
      {selectedDate && (
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Tasks for {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </h3>
            <button
              onClick={() => setSelectedDate(null)}
              className="text-gray-600 hover:text-gray-900"
            >
              Close
            </button>
          </div>

          {(() => {
            const tasksForDate = getTasksForDate(selectedDate)
            return tasksForDate.length > 0 ? (
              <div className="space-y-3">
                {tasksForDate.map(task => (
                  <div
                    key={task._id}
                    onClick={() => navigate(`/tasks/${task._id}`)}
                    className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-1">
                        {getPriorityIcon(task.priority)}
                      </div>
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900">{task.title || 'Untitled task'}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getPriorityColor(task.priority).replace('border-', '').replace('bg-', 'text-').replace('-50', '-800')}`}>
                            {formatPriority(task.priority)}
                          </span>
                          <span className="text-sm text-gray-600">{task.assignedTo?.name || task.assignedTo?.displayName || 'Unassigned'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 text-center py-4">No tasks for this date</p>
            )
          })()}
        </div>
      )}

      {/* Legend */}
      <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
        <h4 className="text-sm font-medium text-gray-900 mb-3">Priority Legend</h4>
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500"></div>
            <span className="text-sm text-gray-600">Urgent</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-orange-500"></div>
            <span className="text-sm text-gray-600">High</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-blue-500"></div>
            <span className="text-sm text-gray-600">Medium</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-gray-500"></div>
            <span className="text-sm text-gray-600">Low</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default TaskCalendar

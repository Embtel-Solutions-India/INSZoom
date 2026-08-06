import { useState, useEffect, useCallback } from 'react'
import { DollarSign, AlertCircle, Loader2 } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'

// Formats USD cents for display. null => variable/see notes, 0 => explicitly free.
function formatFee(cents) {
  if (cents == null) return '—'
  if (cents === 0) return 'No fee'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100)
}

function BaisFeeCell({ entry }) {
  if (entry.baisFee != null) return <span className="font-medium text-gray-900">{formatFee(entry.baisFee)}</span>
  if (entry.baisNotes) return <span className="text-gray-700">{entry.baisNotes}</span>
  return <span className="text-gray-400">—</span>
}

// Prefers the formatted numeric fee (including $0 => "No fee") whenever a
// concrete uscisBaseFee is known - only falls back to the free-text notes
// for the tiered/conditional entries where no single number applies.
function UscisFeeCell({ entry }) {
  if (entry.uscisBaseFee != null) return <span className="font-medium text-gray-900">{formatFee(entry.uscisBaseFee)}</span>
  if (entry.uscisNotes) return <span className="text-xs text-gray-600">{entry.uscisNotes}</span>
  return <span className="text-gray-400">—</span>
}

export default function FeeSchedule() {
  const { user: me } = useAuth()
  const [fees, setFees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchFees = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data } = await api.get('/fee-schedule')
      setFees(data.feeSchedule || [])
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load the fee schedule.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchFees() }, [fetchFees])

  // Session can expire while this page is still mounted - bail out cleanly
  // instead of throwing, same guard as Teams.jsx.
  if (!me) return null

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <DollarSign className="w-5 h-5 text-primary-600" />
        <div>
          <h1 className="text-lg font-bold text-gray-900">Fee Schedule</h1>
          <p className="text-xs text-gray-500">Internal BAIS service fees and USCIS government fees by visa type</p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      <div className="card !p-0 md:!p-5">
        {loading ? (
          <div className="flex items-center justify-center h-48 gap-2 text-gray-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading fee schedule…
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-gray-100">
              {fees.map((entry) => (
                <div key={entry.id} className="p-4 space-y-2">
                  <p className="font-semibold text-gray-900 text-sm">{entry.label}</p>
                  {entry.explanation && <p className="text-xs text-gray-500">{entry.explanation}</p>}
                  <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                    <div>
                      <p className="text-gray-400 uppercase tracking-wide text-[10px] mb-0.5">BAIS Fee</p>
                      <BaisFeeCell entry={entry} />
                    </div>
                    <div>
                      <p className="text-gray-400 uppercase tracking-wide text-[10px] mb-0.5">USCIS Fee</p>
                      <UscisFeeCell entry={entry} />
                    </div>
                  </div>
                  {entry.processingTimeBefore && (
                    <p className="text-xs text-gray-500"><span className="text-gray-400">Processing:</span> {entry.processingTimeBefore}</p>
                  )}
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Visa / Fee Type</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">BAIS Fee</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">USCIS Fee / Notes</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Processing Time</th>
                  </tr>
                </thead>
                <tbody>
                  {fees.map((entry) => (
                    <tr key={entry.id} className="border-b hover:bg-gray-50 transition align-top">
                      <td className="px-3 py-3 max-w-[260px]">
                        <p className="font-medium text-gray-900 text-sm">{entry.label}</p>
                        {entry.explanation && <p className="text-xs text-gray-500 mt-0.5">{entry.explanation}</p>}
                      </td>
                      <td className="px-3 py-3 text-sm max-w-[180px]"><BaisFeeCell entry={entry} /></td>
                      <td className="px-3 py-3 text-sm max-w-[340px]"><UscisFeeCell entry={entry} /></td>
                      <td className="px-3 py-3 text-xs text-gray-600 max-w-[280px]">{entry.processingTimeBefore || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

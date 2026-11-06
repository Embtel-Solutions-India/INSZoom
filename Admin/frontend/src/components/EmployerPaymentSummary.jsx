import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Receipt } from 'lucide-react'
import api from '../services/api'
import CaseInvoices from './CaseInvoices'
import { FINANCE_COLORS } from '../utils/financeColors'

// The Payment Summary of an employer (principal) case: the accumulated figures of ALL its employees, then one compact row per employee (figures + that employee's Invoices).
// The figures are each employee case's own Payment Summary, so editing one there updates this within seconds.
const usd = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(amount) || 0)

export default function EmployerPaymentSummary({ caseId, title }) {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [invoiceFor, setInvoiceFor] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = () => api.get(`/case-invoices/${caseId}/employee-payments`)
      .then((response) => { if (!cancelled) { setData(response.data.data); setError('') } })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.message || 'Could not load the payments') })
    load()
    const timer = setInterval(load, 30000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [caseId])

  const totals = data?.totals || {}
  const tiles = [
    ['Total Fees', totals.totalAmount, FINANCE_COLORS.total],
    ['USCIS Fee', totals.uscisFee, FINANCE_COLORS.uscis],
    ['Amount Paid', totals.amountPaid, FINANCE_COLORS.paid],
    ['Outstanding', totals.outstanding, FINANCE_COLORS.outstanding],
  ]
  return (
    <div className="card" data-testid="employer-payment-summary">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-foreground">Payment Summary</h3>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">All employees combined{data ? ` · ${data.employees.length} ${data.employees.length === 1 ? 'employee' : 'employees'}` : ''}</span>
        </div>
      </div>
      {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map(([label, value, dot]) => (
          <div key={label}>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: dot }} aria-hidden="true" />{label}</p>
            <p className="text-lg font-semibold tabular-nums text-foreground">{data ? usd(value) : '—'}</p>
          </div>
        ))}
      </div>

      {data && data.employees.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          <div className="hidden grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_1fr_auto] gap-3 bg-muted px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:grid">
            <span>Employee</span><span>Total fees</span><span>USCIS</span><span>Paid</span><span>Outstanding</span><span className="w-[5.5rem]" />
          </div>
          <ul className="max-h-[22rem] divide-y divide-border overflow-y-auto">
            {data.employees.map((row) => (
              <li
                key={row._id}
                data-testid="employee-payment-row"
                onClick={() => navigate(`/crm-cases/${row._id}`)}
                className="grid cursor-pointer grid-cols-2 items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px] hover:bg-muted/60 md:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_1fr_auto]"
              >
                <div className="col-span-2 min-w-0 md:col-span-1">
                  <p className="truncate font-medium text-foreground" title={row.name}>{row.name || 'Employee'}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{row.caseNumber}</p>
                </div>
                <span className="tabular-nums" title="Total fees">{usd(row.totalAmount)}</span>
                <span className="tabular-nums" title="USCIS fee">{usd(row.uscisFee)}</span>
                <span className="font-medium tabular-nums text-foreground" title="Paid">{usd(row.amountPaid)}</span>
                <span className="font-medium tabular-nums text-foreground" title="Outstanding">{usd(row.outstanding)}</span>
                <button type="button" onClick={(event) => { event.stopPropagation(); setInvoiceFor(row) }} className="inline-flex items-center gap-1 justify-self-start rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-secondary md:justify-self-end">
                  <Receipt className="h-3.5 w-3.5" />Invoices
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : data ? (
        <p className="mt-4 text-sm text-muted-foreground">No employees on this matter yet.</p>
      ) : null}
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={() => setInvoiceFor({ _id: caseId, caseNumber: title || '', name: '' })} className="btn-primary inline-flex items-center gap-1.5 px-4 py-1.5 text-sm"><Receipt className="h-4 w-4" />Invoices</button>
      </div>
      {invoiceFor ? <CaseInvoices caseId={invoiceFor._id} title={`${invoiceFor.caseNumber}${invoiceFor.name ? ` · ${invoiceFor.name}` : ''}`} onClose={() => setInvoiceFor(null)} /> : null}
    </div>
  )
}

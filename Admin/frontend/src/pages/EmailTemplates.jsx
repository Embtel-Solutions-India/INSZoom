import { useCallback, useEffect, useState } from 'react'
import { emailTemplatesApi } from '../services/api'
import TemplateLibrary from '../components/emailTemplates/TemplateLibrary'
import TemplateEditor from '../components/emailTemplates/TemplateEditor'
import { LoadingState, ErrorState } from '../components/ui/EmptyState'

// Email Template Customization. Two states: the full-width library, and -
// once a template is chosen - a two-halves editor/preview with the library
// hidden entirely.
const EMPTY_RECIPIENTS = { to: [], cc: [], bcc: [] }
const BLANK = { id: null, name: '', description: '', category: 'Case', subject: '', heading: '', body: '', triggerKey: null, recipients: EMPTY_RECIPIENTS, status: 'draft' }

const fromRecord = (record) => ({
  id: record._id, name: record.name || '', description: record.description || '', category: record.category || 'Case',
  subject: record.subject || '', heading: record.heading || '', body: record.body || '', triggerKey: record.triggerKey || null,
  recipients: { ...EMPTY_RECIPIENTS, ...(record.recipients || {}) }, status: record.status || 'draft',
})

export default function EmailTemplates() {
  const [meta, setMeta] = useState(null)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // { key, form } while the editor is open
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState('')

  const loadLibrary = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [metaRes, libraryRes] = await Promise.all([meta ? Promise.resolve(null) : emailTemplatesApi.meta(), emailTemplatesApi.library()])
      if (metaRes) setMeta(metaRes.data.data)
      setRows(libraryRes.data.data)
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load email templates')
    } finally {
      setLoading(false)
    }
  }, [meta])

  useEffect(() => { loadLibrary() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openCustom = useCallback(async (id) => {
    setOpening(true)
    setOpenError('')
    try {
      const res = await emailTemplatesApi.get(id)
      setEditing({ key: id, form: fromRecord(res.data.data) })
    } catch (err) {
      setOpenError(err.response?.data?.message || 'Could not open the template')
    } finally {
      setOpening(false)
    }
  }, [])

  const handleOpen = async (row) => {
    if (row.kind === 'custom') return openCustom(row.id)
    // Built-in email: start a customization pre-filled with its real wording.
    setOpening(true)
    setOpenError('')
    try {
      const res = await emailTemplatesApi.defaults(row.triggerKey)
      const d = res.data.data
      setEditing({ key: `new-${row.triggerKey}`, form: { ...BLANK, name: d.name, description: d.description, category: d.category, subject: d.subject, heading: d.heading, body: d.body, triggerKey: d.triggerKey, recipients: d.recipients } })
    } catch (err) {
      setOpenError(err.response?.data?.message || 'Could not open this email')
    } finally {
      setOpening(false)
    }
  }

  const handleBack = ({ openId } = {}) => {
    setEditing(null)
    loadLibrary()
    if (openId) openCustom(openId)
  }

  if (editing && meta) {
    return <TemplateEditor key={editing.key} initial={editing.form} meta={meta} onBack={handleBack} onChanged={loadLibrary} />
  }

  return (
    <div className="space-y-4">
      {openError && <ErrorState message={openError} />}
      {opening && <LoadingState label="Opening template…" />}
      {!opening && (
        <TemplateLibrary
          rows={rows} meta={meta} loading={loading} error={error} onRetry={loadLibrary}
          onOpen={handleOpen} onCreate={() => setEditing({ key: `new-${Date.now()}`, form: BLANK })}
        />
      )}
    </div>
  )
}

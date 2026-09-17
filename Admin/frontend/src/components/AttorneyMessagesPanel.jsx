import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageSquare, Loader2, Send, CornerDownRight, Paperclip, X, FileText } from 'lucide-react'
import api from '../services/api'

// Staff side of the attorney<->case-team thread (Backend/src/modules/feedback
// — surfaced to the attorney as "Messages"). The client is never a
// participant of this thread; it exists specifically so a case manager can
// coordinate with an assigned attorney without that conversation being
// visible to (or including) the client. Deliberately its own panel, not
// folded into the existing case Messages page (that one IS client-inclusive
// — see message.service.js's resolveCaseConversationRouting).
function authorLabel(item) {
  const author = item.authorId || {}
  const name = author.displayName || author.name || author.email || 'Unknown'
  const role = (item.authorRole || author.role || '').replace(/_/g, ' ')
  return role ? `${name} · ${role}` : name
}

export default function AttorneyMessagesPanel({ caseId }) {
  const [items, setItems] = useState(null)
  const [message, setMessage] = useState('')
  const [files, setFiles] = useState([])
  const [replyTo, setReplyTo] = useState(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)

  const load = useCallback(
    () =>
      api
        .get(`/cases/${caseId}/feedback`)
        .then(({ data }) => setItems(data.feedback || []))
        .catch((err) => setError(err.response?.data?.message || 'Could not load messages.')),
    [caseId]
  )

  useEffect(() => {
    setItems(null)
    api.patch(`/cases/${caseId}/feedback/mark-read`).catch(() => {}).then(load)
  }, [caseId, load])

  const addFiles = (event) => {
    setFiles((current) => [...current, ...Array.from(event.target.files || [])])
    event.target.value = ''
  }
  const removeFile = (index) => setFiles((current) => current.filter((_, i) => i !== index))

  const download = async (feedbackId, attachment) => {
    const response = await api.get(`/cases/${caseId}/feedback/${feedbackId}/attachments/${attachment._id}`, { responseType: 'blob' })
    const url = URL.createObjectURL(response.data)
    const link = document.createElement('a')
    link.href = url
    link.download = attachment.originalName || 'attachment'
    link.click()
    URL.revokeObjectURL(url)
  }

  const send = async () => {
    const text = message.trim()
    if (!text && !files.length) return
    setSending(true)
    setError('')
    try {
      const form = new FormData()
      if (text) form.append('message', text)
      files.forEach((file) => form.append('attachments', file))
      const path = replyTo ? `/cases/${caseId}/feedback/${replyTo._id}/reply` : `/cases/${caseId}/feedback`
      await api.post(path, form)
      setMessage('')
      setFiles([])
      setReplyTo(null)
      await load()
    } catch (err) {
      setError(err.response?.data?.message || 'Your message could not be sent.')
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  const roots = (items || []).filter((item) => !item.parentFeedbackId)
  const repliesFor = (parentId) => (items || []).filter((item) => String(item.parentFeedbackId) === String(parentId))

  return (
    <div className="card">
      <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
        <MessageSquare className="w-5 h-5 text-blue-600" />
        Attorney Messages
      </h3>

      {items === null ? (
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      ) : (
        <div className="space-y-4">
          {roots.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages with the assigned attorney yet.</p>
          ) : (
            <ul className="space-y-3 max-h-72 overflow-y-auto">
              {roots.map((item) => (
                <li key={item._id} className="p-3 bg-muted rounded-lg">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-muted-foreground mb-1">
                        {authorLabel(item)} · {new Date(item.createdAt).toLocaleString()}
                      </p>
                      {item.message && <p className="text-sm text-foreground whitespace-pre-wrap">{item.message}</p>}
                      {item.attachments?.map((attachment) => (
                        <button
                          key={attachment._id}
                          onClick={() => download(item._id, attachment)}
                          className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 bg-background border border-border rounded-lg px-2 py-1 mr-1.5"
                        >
                          <FileText className="w-3.5 h-3.5" /> {attachment.originalName}
                        </button>
                      ))}
                    </div>
                    <button onClick={() => setReplyTo(item)} className="shrink-0 text-xs font-semibold text-blue-600 hover:underline">
                      Reply
                    </button>
                  </div>
                  {repliesFor(item._id).length > 0 && (
                    <ul className="mt-2 space-y-2 border-l-2 border-border pl-3">
                      {repliesFor(item._id).map((reply) => (
                        <li key={reply._id}>
                          <p className="text-xs font-semibold text-muted-foreground mb-0.5 flex items-center gap-1">
                            <CornerDownRight className="w-3 h-3" /> {authorLabel(reply)} · {new Date(reply.createdAt).toLocaleString()}
                          </p>
                          {reply.message && <p className="text-sm text-foreground whitespace-pre-wrap">{reply.message}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2 pt-2 border-t border-border">
            {replyTo && (
              <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-1.5">
                <p className="text-xs text-muted-foreground truncate">Replying to <span className="font-semibold">{authorLabel(replyTo)}</span></p>
                <button onClick={() => setReplyTo(null)} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Cancel</button>
              </div>
            )}
            {files.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {files.map((file, index) => (
                  <span key={`${file.name}-${index}`} className="inline-flex items-center gap-1 text-xs bg-muted rounded-lg px-2 py-1">
                    {file.name}
                    <button onClick={() => removeFile(index)}><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              rows={2}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Message the attorney… (Enter to send)"
              className="input-field"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex items-center justify-between">
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={addFiles} />
              <button onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                <Paperclip className="w-3.5 h-3.5" /> Attach
              </button>
              <button
                onClick={send}
                disabled={sending || (!message.trim() && !files.length)}
                className="btn-primary flex items-center gap-1.5 text-xs disabled:opacity-50"
              >
                {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

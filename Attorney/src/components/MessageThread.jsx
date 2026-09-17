import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Send, CornerDownRight, Paperclip, X, FileText } from 'lucide-react'
import { attorneyApi } from '../services/api'

// The attorney's ONLY messaging surface — a staff-only thread (attorney <->
// case manager/team lead/admin) backed by models/Feedback.js, never the
// client-inclusive Conversation system (see api.js's attorneyApi comment).
// Used by both /messages/:caseId (the real page) — there is no per-case
// "Messages"/"Feedback" tab any more, by design.

function authorLabel(item) {
  const author = item.authorId || {}
  const name = author.displayName || author.name || author.email || 'Unknown'
  const role = (item.authorRole || author.role || '').replace(/_/g, ' ')
  return role ? `${name} · ${role}` : name
}

function AttachmentList({ caseId, feedbackId, attachments }) {
  if (!attachments?.length) return null
  const download = async (attachment) => {
    const response = await attorneyApi.downloadAttachment(caseId, feedbackId, attachment._id)
    const url = URL.createObjectURL(response.data)
    const link = document.createElement('a')
    link.href = url
    link.download = attachment.originalName || 'attachment'
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((attachment) => (
        <button
          key={attachment._id}
          onClick={() => download(attachment)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary bg-secondary border border-border rounded-lg px-2.5 py-1.5 hover:bg-accent"
        >
          <FileText className="w-3.5 h-3.5" />
          {attachment.originalName}
        </button>
      ))}
    </div>
  )
}

function Message({ item, caseId, onReply, replies }) {
  return (
    <li className="px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-muted-foreground mb-1">
            {authorLabel(item)} · {new Date(item.createdAt).toLocaleString()}
          </p>
          {item.message && <p className="text-sm text-foreground whitespace-pre-wrap">{item.message}</p>}
          <AttachmentList caseId={caseId} feedbackId={item._id} attachments={item.attachments} />
        </div>
        <button onClick={() => onReply(item)} className="shrink-0 text-xs font-semibold text-primary hover:underline">
          Reply
        </button>
      </div>

      {replies.length > 0 && (
        <ul className="mt-3 space-y-3 border-l-2 border-border pl-4">
          {replies.map((reply) => (
            <li key={reply._id}>
              <p className="text-xs font-semibold text-muted-foreground mb-0.5 flex items-center gap-1">
                <CornerDownRight className="w-3 h-3" />
                {authorLabel(reply)} · {new Date(reply.createdAt).toLocaleString()}
              </p>
              {reply.message && <p className="text-sm text-foreground whitespace-pre-wrap">{reply.message}</p>}
              <AttachmentList caseId={caseId} feedbackId={reply._id} attachments={reply.attachments} />
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export default function MessageThread({ caseId }) {
  const [items, setItems] = useState(null)
  const [message, setMessage] = useState('')
  const [files, setFiles] = useState([])
  const [replyTo, setReplyTo] = useState(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)

  const load = useCallback(
    () =>
      attorneyApi
        .feedback(caseId)
        .then(({ data }) => setItems(data.feedback || []))
        .catch((err) => setError(err.response?.data?.message || 'Could not load messages.')),
    [caseId]
  )

  useEffect(() => {
    setItems(null)
    attorneyApi
      .markFeedbackRead(caseId)
      .catch(() => {})
      .then(load)
  }, [caseId, load])

  const addFiles = (event) => {
    const picked = Array.from(event.target.files || [])
    setFiles((current) => [...current, ...picked])
    event.target.value = ''
  }
  const removeFile = (index) => setFiles((current) => current.filter((_, i) => i !== index))

  const send = async () => {
    const text = message.trim()
    if (!text && !files.length) return
    setSending(true)
    setError('')
    try {
      if (replyTo) {
        await attorneyApi.replyFeedback(caseId, replyTo._id, text, files)
      } else {
        await attorneyApi.sendFeedback(caseId, text, files)
      }
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

  const onSubmit = (event) => {
    event.preventDefault()
    send()
  }

  // Enter sends; Shift+Enter inserts a newline — the standard chat-app
  // convention (Slack/Teams/etc.), not just the plain <form> submit-on-Enter
  // a single-line input would already give for free (this is a <textarea>).
  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  if (!items) return <Loader2 className="w-6 h-6 animate-spin text-primary" />

  const roots = items.filter((item) => !item.parentFeedbackId)
  const repliesFor = (parentId) => items.filter((item) => String(item.parentFeedbackId) === String(parentId))

  return (
    <div className="space-y-4">
      <div className="card !p-0">
        {roots.length === 0 ? (
          <p className="px-5 py-10 text-sm text-muted-foreground text-center">
            No messages on this case yet. Start the conversation with the case team below.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {roots.map((item) => (
              <Message key={item._id} item={item} caseId={caseId} onReply={setReplyTo} replies={repliesFor(item._id)} />
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={onSubmit} className="card space-y-3">
        {replyTo && (
          <div className="flex items-center justify-between rounded-lg bg-secondary border border-border px-3 py-2">
            <p className="text-xs text-muted-foreground truncate">
              Replying to <span className="font-semibold text-foreground">{authorLabel(replyTo)}</span>
            </p>
            <button type="button" onClick={() => setReplyTo(null)} className="text-xs font-semibold text-muted-foreground hover:text-foreground">
              Cancel
            </button>
          </div>
        )}

        {files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {files.map((file, index) => (
              <span key={`${file.name}-${index}`} className="inline-flex items-center gap-1.5 text-xs bg-secondary border border-border rounded-lg px-2.5 py-1.5">
                <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                {file.name}
                <button type="button" onClick={() => removeFile(index)} aria-label={`Remove ${file.name}`}>
                  <X className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              </span>
            ))}
          </div>
        )}

        <label htmlFor="message-text" className="sr-only">Message</label>
        <textarea
          id="message-text"
          rows={3}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message the case team… (Enter to send, Shift+Enter for a new line)"
          className="input-field"
        />

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center justify-between">
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={addFiles} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <Paperclip className="w-4 h-4" /> Attach
          </button>

          <button type="submit" disabled={sending || (!message.trim() && !files.length)} className="btn-primary flex items-center gap-2 disabled:opacity-50">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {replyTo ? 'Send reply' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  )
}

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { SuggestMenu, filterVariables, findOpenToken, handleSuggestKey } from './VariableSuggest'
import { Bold, Italic, Underline, List, ListOrdered, Link2, AlignLeft, AlignCenter, AlignRight, MousePointerClick, Code2, Eraser } from 'lucide-react'

// Email bodies are styled HTML (inline-styled buttons, callout tables, ...).
// A schema-based editor (Tiptap/ProseMirror) silently drops inline styles it
// doesn't model, which would flatten the built-in emails the moment an admin
// opened them - so this edits the HTML as-is via contentEditable, and offers
// an HTML view for anything the toolbar can't express.
const CTA_STYLE = 'display:inline-block;padding:10px 20px;background:#1e3a5f;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;'

const escapeAttr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const isBlank = (html) => !html || html.replace(/<br\s*\/?>|&nbsp;|\s/gi, '') === ''

function ToolButton({ title, onClick, active, children }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      // mousedown (not click) + preventDefault keeps the text selection alive.
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      className={`p-1.5 rounded-md transition-colors ${active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
    >
      {children}
    </button>
  )
}

function LabelButton({ title, label, onClick, active, children }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
    >
      {children} {label}
    </button>
  )
}

const RichTextEditor = forwardRef(function RichTextEditor({ value, onChange, onFocus, variables = [] }, ref) {
  const areaRef = useRef(null)
  const wrapperRef = useRef(null)
  const [suggest, setSuggest] = useState(null) // { query, node, start, end, left, top }
  const [activeIndex, setActiveIndex] = useState(0)
  const lastEmitted = useRef(null)
  const savedRange = useRef(null)
  const [htmlMode, setHtmlMode] = useState(false)
  const [popover, setPopover] = useState(null) // 'link' | 'button' | null
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const editingAnchor = useRef(null)

  // Push external value changes (loading a template, "load built-in wording")
  // into the DOM without clobbering the caret while the user types.
  useEffect(() => {
    if (htmlMode || !areaRef.current) return
    if (value !== lastEmitted.current) {
      areaRef.current.innerHTML = value || ''
      lastEmitted.current = value
    }
  }, [value, htmlMode])

  const emit = useCallback(() => {
    const html = areaRef.current?.innerHTML ?? ''
    const next = isBlank(html) ? '' : html
    lastEmitted.current = next
    onChange(next)
  }, [onChange])

  // Offer variables while an unfinished "[token" sits right before the caret.
  const detectToken = () => {
    const selection = window.getSelection()
    const node = selection?.anchorNode
    if (!selection?.rangeCount || !selection.isCollapsed || !node || node.nodeType !== 3 || !areaRef.current?.contains(node)) { setSuggest(null); return }
    const offset = selection.anchorOffset
    const found = findOpenToken(node.textContent.slice(0, offset))
    if (!found) { setSuggest(null); return }
    const range = document.createRange()
    range.setStart(node, offset)
    range.collapse(true)
    let rect = range.getClientRects()[0] || range.getBoundingClientRect()
    if (!rect || (rect.top === 0 && rect.bottom === 0)) rect = node.parentElement.getBoundingClientRect()
    const box = wrapperRef.current.getBoundingClientRect()
    setSuggest({ query: found.query, node, start: offset - found.length, end: offset, left: Math.max(0, Math.min(rect.left - box.left, box.width - 296)), top: rect.bottom - box.top + 4 })
    setActiveIndex(0)
  }

  const suggestItems = suggest ? filterVariables(variables, suggest.query) : []

  const pickSuggestion = (variable) => {
    if (!suggest) return
    const range = document.createRange()
    try {
      range.setStart(suggest.node, suggest.start)
      range.setEnd(suggest.node, suggest.end)
    } catch { setSuggest(null); return }
    const selection = window.getSelection()
    areaRef.current?.focus()
    selection.removeAllRanges()
    selection.addRange(range)
    document.execCommand('insertText', false, `[${variable.key}]`)
    emit()
    rememberSelection()
    setSuggest(null)
  }

  const rememberSelection = () => {
    const selection = window.getSelection()
    if (selection?.rangeCount && areaRef.current?.contains(selection.anchorNode)) {
      savedRange.current = selection.getRangeAt(0).cloneRange()
    }
  }
  const restoreSelection = () => {
    areaRef.current?.focus()
    const selection = window.getSelection()
    if (savedRange.current) {
      selection.removeAllRanges()
      selection.addRange(savedRange.current)
    }
  }

  const exec = (command, arg) => {
    restoreSelection()
    document.execCommand(command, false, arg)
    emit()
    rememberSelection()
  }

  const insertHtml = (html) => {
    restoreSelection()
    document.execCommand('insertHTML', false, html)
    emit()
    rememberSelection()
  }

  useImperativeHandle(ref, () => ({
    // Inserts at the caret (or appends if the editor was never focused).
    insertText(text) {
      if (htmlMode) {
        setHtmlMode(false)
        requestAnimationFrame(() => insertHtml(escapeAttr(text)))
        return
      }
      if (!savedRange.current && areaRef.current) {
        const range = document.createRange()
        range.selectNodeContents(areaRef.current)
        range.collapse(false)
        savedRange.current = range
      }
      restoreSelection()
      document.execCommand('insertText', false, text)
      emit()
      rememberSelection()
    },
  }))

  const openPopover = (kind) => {
    rememberSelection()
    setLabel(kind === 'button' ? 'Open Your Portal' : '')
    setUrl(kind === 'button' ? '[system.portal_link]' : 'https://')
    setPopover(kind)
  }

  // Clicking an existing link/button opens it for editing (text + URL).
  const onAreaClick = (e) => {
    const anchor = e.target.closest?.('a')
    if (!anchor || !areaRef.current?.contains(anchor)) return
    e.preventDefault()
    editingAnchor.current = anchor
    setLabel(anchor.textContent)
    setUrl(anchor.getAttribute('href') || '')
    setPopover('edit')
  }

  const removeAnchor = () => {
    const anchor = editingAnchor.current
    if (anchor?.parentNode) anchor.replaceWith(document.createTextNode(anchor.textContent))
    editingAnchor.current = null
    emit()
    setPopover(null)
  }

  const applyPopover = () => {
    if (!url.trim()) return
    if (popover === 'edit') {
      const anchor = editingAnchor.current
      if (anchor) {
        anchor.setAttribute('href', url.trim())
        if (label.trim() && label !== anchor.textContent) anchor.textContent = label.trim()
        emit()
      }
      editingAnchor.current = null
      setPopover(null)
      return
    }
    if (popover === 'link') {
      exec('createLink', url.trim())
    } else {
      insertHtml(`<p><a href="${escapeAttr(url.trim())}" style="${CTA_STYLE}">${escapeAttr(label.trim() || 'Click here')}</a></p>`)
    }
    setPopover(null)
  }

  const onPaste = (e) => {
    // Plain-text paste: pasted web/Word HTML drags in fonts and colors that
    // look wrong in an email.
    e.preventDefault()
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
  }

  return (
    <div ref={wrapperRef} className="relative rounded-lg border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1.5">
        {!htmlMode && (
          <>
            <ToolButton title="Bold" onClick={() => exec('bold')}><Bold className="w-4 h-4" /></ToolButton>
            <ToolButton title="Italic" onClick={() => exec('italic')}><Italic className="w-4 h-4" /></ToolButton>
            <ToolButton title="Underline" onClick={() => exec('underline')}><Underline className="w-4 h-4" /></ToolButton>
            <span className="mx-1 h-5 w-px bg-border" />
            <ToolButton title="Bulleted list" onClick={() => exec('insertUnorderedList')}><List className="w-4 h-4" /></ToolButton>
            <ToolButton title="Numbered list" onClick={() => exec('insertOrderedList')}><ListOrdered className="w-4 h-4" /></ToolButton>
            <span className="mx-1 h-5 w-px bg-border" />
            <ToolButton title="Align left" onClick={() => exec('justifyLeft')}><AlignLeft className="w-4 h-4" /></ToolButton>
            <ToolButton title="Align center" onClick={() => exec('justifyCenter')}><AlignCenter className="w-4 h-4" /></ToolButton>
            <ToolButton title="Align right" onClick={() => exec('justifyRight')}><AlignRight className="w-4 h-4" /></ToolButton>
            <span className="mx-1 h-5 w-px bg-border" />
            <LabelButton title="Insert a text link" label="Link" onClick={() => openPopover('link')} active={popover === 'link'}><Link2 className="w-4 h-4" /></LabelButton>
            <LabelButton title="Insert a button (a styled link) that opens a URL" label="Button" onClick={() => openPopover('button')} active={popover === 'button'}><MousePointerClick className="w-4 h-4" /></LabelButton>
            <ToolButton title="Clear formatting" onClick={() => exec('removeFormat')}><Eraser className="w-4 h-4" /></ToolButton>
          </>
        )}
        <button
          type="button"
          onClick={() => { setPopover(null); lastEmitted.current = null; setHtmlMode((mode) => !mode) }}
          className={`ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${htmlMode ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
        >
          <Code2 className="w-3.5 h-3.5" /> {htmlMode ? 'Visual editor' : 'HTML'}
        </button>
      </div>

      {popover && !htmlMode && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary/40 px-3 py-2">
          {popover !== 'link' && (
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Button text" aria-label="Button text" className="input-field !py-1.5 !text-sm w-40" />
          )}
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyPopover() } }}
            placeholder="https://… or [system.portal_link]"
            aria-label="Link URL"
            className="input-field !py-1.5 !text-sm flex-1 min-w-[10rem]"
            autoFocus
          />
          <button type="button" onClick={applyPopover} className="btn-primary !py-1.5 !px-3 text-xs">{popover === 'edit' ? 'Update' : 'Insert'}</button>
          {popover === 'edit' && <button type="button" onClick={removeAnchor} className="btn-secondary !py-1.5 !px-3 text-xs text-destructive">Remove</button>}
          <button type="button" onClick={() => setPopover(null)} className="btn-secondary !py-1.5 !px-3 text-xs">Cancel</button>
        </div>
      )}

      {htmlMode ? (
        <textarea
          value={value || ''}
          onChange={(e) => { lastEmitted.current = null; onChange(e.target.value) }}
          onFocus={onFocus}
          spellCheck={false}
          className="block w-full min-h-[280px] resize-y bg-transparent p-3 font-mono text-xs text-foreground outline-none"
        />
      ) : (
        <div
          ref={areaRef}
          contentEditable
          suppressContentEditableWarning
          onInput={() => { emit(); detectToken() }}
          onFocus={onFocus}
          onBlur={() => { rememberSelection(); setSuggest(null) }}
          onKeyDown={(e) => { handleSuggestKey(e, { items: suggestItems, activeIndex, setActiveIndex, onPick: pickSuggestion, close: () => setSuggest(null) }) }}
          onKeyUp={(e) => { rememberSelection(); if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) detectToken() }}
          onMouseUp={rememberSelection}
          onPaste={onPaste}
          onClick={onAreaClick}
          className="email-editor min-h-[280px] max-h-[520px] overflow-y-auto p-4 text-[15px] leading-7 text-foreground outline-none [&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-3 [&_table]:max-w-full"
        />
      )}
      {!htmlMode && suggest && (
        <SuggestMenu items={suggestItems} activeIndex={activeIndex} onPick={pickSuggestion} className="absolute" style={{ left: suggest.left, top: suggest.top }} />
      )}
    </div>
  )
})

export default RichTextEditor

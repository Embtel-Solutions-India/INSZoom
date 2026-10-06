import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { SuggestMenu, filterVariables, findOpenToken, handleSuggestKey } from './VariableSuggest'
import { Bold, Italic, Underline, List, ListOrdered, Link2, AlignLeft, AlignCenter, AlignRight, MousePointerClick, Code2, Eraser } from 'lucide-react'

// Email bodies are styled HTML (inline-styled buttons, callout tables, ...).
// A schema-based editor (Tiptap/ProseMirror) silently drops inline styles it
// doesn't model, which would flatten the built-in emails the moment an admin
// opened them - so this edits the HTML as-is via contentEditable, and offers
// an HTML view for anything the toolbar can't express.
// Buttons are styled links, exactly like the buttons in the built-in emails.
const COLORS = [
  { key: 'navy', label: 'Navy', value: '#1e3a5f' },
  { key: 'red', label: 'Red', value: '#dc2626' },
  { key: 'green', label: 'Green', value: '#065f46' },
]
const buttonStyle = (background) => `display:inline-block;padding:12px 24px;background:${background};color:#fff;border-radius:8px;text-decoration:none;font-weight:700;`
const isButton = (anchor) => /display\s*:\s*inline-block/i.test(anchor.getAttribute('style') || '')
const colorOf = (anchor) => (/background\s*:\s*(#[0-9a-f]{3,6})/i.exec(anchor.getAttribute('style') || '')?.[1] || '#1e3a5f').toLowerCase()
const CUSTOM = '__custom__'

const escapeAttr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const isBlank = (html) => !html || html.replace(/<br\s*\/?>|&nbsp;|\s/gi, '') === ''

// Buttons are edited as ONE unit (click it -> text, link, colour), so inside the
// editor they are non-editable atoms; typing next to one can never put text
// "beside" the button or split it. These editor-only attributes are stripped
// from the saved HTML.
const EDITOR_ONLY_ATTRS = ['contenteditable', 'data-editor-btn', 'title']
function markButtons(root) {
  root?.querySelectorAll('a').forEach((anchor) => {
    if (!isButton(anchor)) return
    anchor.setAttribute('contenteditable', 'false')
    anchor.setAttribute('data-editor-btn', '1')
    anchor.setAttribute('title', 'Click to edit this button')
  })
}
function serialize(root) {
  const clone = root.cloneNode(true)
  clone.querySelectorAll('a[data-editor-btn]').forEach((anchor) => EDITOR_ONLY_ATTRS.forEach((attr) => anchor.removeAttribute(attr)))
  return clone.innerHTML
}

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

const RichTextEditor = forwardRef(function RichTextEditor({ value, onChange, onFocus, variables = [], linkPresets = [] }, ref) {
  const areaRef = useRef(null)
  const wrapperRef = useRef(null)
  const [suggest, setSuggest] = useState(null) // { query, node, start, end, left, top }
  const [activeIndex, setActiveIndex] = useState(0)
  const lastEmitted = useRef(null)
  const savedRange = useRef(null)
  const [htmlMode, setHtmlMode] = useState(false)
  // Link/button panel: { mode: 'add' | 'edit', kind: 'button' | 'link', href, text, color }
  const [panel, setPanel] = useState(null)
  const editingAnchor = useRef(null)

  // Push external value changes (loading a template, "load built-in wording")
  // into the DOM without clobbering the caret while the user types.
  useEffect(() => {
    if (htmlMode || !areaRef.current) return
    if (value !== lastEmitted.current) {
      areaRef.current.innerHTML = value || ''
      markButtons(areaRef.current)
      lastEmitted.current = value
    }
  }, [value, htmlMode])

  const emit = useCallback(() => {
    const html = areaRef.current ? serialize(areaRef.current) : ''
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

  const presetFor = (href) => linkPresets.find((preset) => preset.value === href)

  // ADD: the link is decided first (preset or custom), then the text.
  const openAdd = (kind) => {
    rememberSelection()
    const selectedText = window.getSelection()?.toString() || ''
    const first = linkPresets[0]
    editingAnchor.current = null
    setPanel({ mode: 'add', kind, href: first?.value || 'https://', text: kind === 'link' ? selectedText : (first?.text || 'Open in Immiglance'), color: COLORS[0].value })
  }

  // EDIT: clicking any existing button or link opens it - text, link, colour.
  const onAreaClick = (e) => {
    const anchor = e.target.closest?.('a')
    if (!anchor || !areaRef.current?.contains(anchor)) return
    e.preventDefault()
    editingAnchor.current = anchor
    setPanel({ mode: 'edit', kind: isButton(anchor) ? 'button' : 'link', href: anchor.getAttribute('href') || '', text: anchor.textContent, color: colorOf(anchor) })
  }

  const changeHref = (href) => {
    setPanel((current) => ({ ...current, href }))
    if (editingAnchor.current) { editingAnchor.current.setAttribute('href', href); emit() }
  }
  const changePreset = (value) => {
    if (value === CUSTOM) { changeHref(''); return }
    const preset = linkPresets.find((item) => item.value === value)
    changeHref(value)
    // Suggest matching button text when the text is still empty or was a preset's own text.
    setPanel((current) => (current && (!current.text.trim() || linkPresets.some((item) => item.text === current.text)) && preset?.text ? { ...current, text: preset.text } : current))
    if (editingAnchor.current && preset?.text && linkPresets.some((item) => item.text === editingAnchor.current.textContent)) { editingAnchor.current.textContent = preset.text; emit() }
  }
  // Typing the button text shows up ON the button immediately.
  const changeText = (text) => {
    setPanel((current) => ({ ...current, text }))
    if (editingAnchor.current) { editingAnchor.current.textContent = text; emit() }
  }
  const changeColor = (color) => {
    setPanel((current) => ({ ...current, color }))
    const anchor = editingAnchor.current
    if (anchor) {
      anchor.setAttribute('style', (anchor.getAttribute('style') || '').replace(/background\s*:\s*#[0-9a-f]{3,6}/i, `background:${color}`))
      emit()
    }
  }

  const removeAnchor = () => {
    const anchor = editingAnchor.current
    if (anchor?.parentNode) anchor.replaceWith(document.createTextNode(anchor.textContent))
    editingAnchor.current = null
    emit()
    setPanel(null)
  }

  // Inserts HTML at the remembered caret (or the end) with the DOM Range API.
  const insertHtmlAtCaret = (html) => {
    const area = areaRef.current
    if (!area) return
    area.focus()
    let range = savedRange.current && area.contains(savedRange.current.commonAncestorContainer) ? savedRange.current : null
    if (!range) { range = document.createRange(); range.selectNodeContents(area); range.collapse(false) }
    range.deleteContents()
    const template = document.createElement('template')
    template.innerHTML = html
    const fragment = template.content
    const last = fragment.lastChild
    range.insertNode(fragment)
    if (last) { range.setStartAfter(last); range.collapse(true) }
    savedRange.current = range
    markButtons(area)
    emit()
  }

  const applyPanel = () => {
    if (!panel) return
    if (panel.mode === 'edit') {
      // everything was applied live; just validate + close
      const anchor = editingAnchor.current
      if (anchor && !panel.href.trim()) { anchor.setAttribute('href', '#'); emit() }
      editingAnchor.current = null
      setPanel(null)
      return
    }
    if (!panel.href.trim()) return
    const text = escapeAttr(panel.text.trim() || (panel.kind === 'button' ? 'Click here' : panel.href.trim()))
    if (panel.kind === 'button') {
      insertHtmlAtCaret(`<p><a href="${escapeAttr(panel.href.trim())}" style="${buttonStyle(panel.color)}">${text}</a></p>`)
    } else {
      insertHtmlAtCaret(`<a href="${escapeAttr(panel.href.trim())}">${text}</a>`)
    }
    setPanel(null)
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
            <LabelButton title="Insert a text link" label="Link" onClick={() => openAdd('link')} active={panel?.mode === 'add' && panel.kind === 'link'}><Link2 className="w-4 h-4" /></LabelButton>
            <LabelButton title="Insert a button (a styled link) that opens a URL" label="Add button" onClick={() => openAdd('button')} active={panel?.mode === 'add' && panel.kind === 'button'}><MousePointerClick className="w-4 h-4" /></LabelButton>
            <ToolButton title="Clear formatting" onClick={() => exec('removeFormat')}><Eraser className="w-4 h-4" /></ToolButton>
          </>
        )}
        <button
          type="button"
          onClick={() => { setPanel(null); lastEmitted.current = null; setHtmlMode((mode) => !mode) }}
          className={`ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${htmlMode ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
        >
          <Code2 className="w-3.5 h-3.5" /> {htmlMode ? 'Visual editor' : 'HTML'}
        </button>
      </div>

      {panel && !htmlMode && (
        <div className="space-y-3 border-b border-border bg-secondary/40 px-3 py-3" role="group" aria-label={panel.kind === 'button' ? 'Button settings' : 'Link settings'}>
          <p className="text-xs font-semibold text-foreground">{panel.mode === 'edit' ? `Edit ${panel.kind}` : `Add a ${panel.kind}`}</p>
          {/* 1. The link is decided first */}
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground" htmlFor="rte-link-preset">1. Where should it go?</label>
              <select
                id="rte-link-preset"
                value={presetFor(panel.href) ? panel.href : CUSTOM}
                onChange={(e) => changePreset(e.target.value)}
                className="input-field !py-1.5 !text-sm"
              >
                {linkPresets.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
                <option value={CUSTOM}>Custom link…</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground" htmlFor="rte-link-url">Link address</label>
              <input
                id="rte-link-url"
                value={panel.href}
                onChange={(e) => changeHref(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyPanel() } }}
                placeholder="https://… or [system.portal_link]"
                className="input-field !py-1.5 !text-sm"
              />
            </div>
          </div>
          {/* 2. Then the text */}
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground" htmlFor="rte-link-text">2. {panel.kind === 'button' ? 'Button text' : 'Link text'}</label>
              <input
                id="rte-link-text"
                value={panel.text}
                onChange={(e) => changeText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyPanel() } }}
                placeholder={panel.kind === 'button' ? 'e.g. Upload Documents' : 'Link text'}
                autoFocus={panel.mode === 'edit'}
                className="input-field !py-1.5 !text-sm"
              />
            </div>
            {panel.kind === 'button' && (
              <div>
                <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Colour</span>
                <div className="flex items-center gap-2">
                  {COLORS.map((color) => (
                    <button
                      key={color.key}
                      type="button"
                      title={color.label}
                      aria-label={`${color.label} button`}
                      aria-pressed={panel.color === color.value}
                      onClick={() => changeColor(color.value)}
                      className={`h-7 w-7 rounded-full border-2 ${panel.color === color.value ? 'border-foreground' : 'border-transparent'}`}
                      style={{ background: color.value }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">Variables such as <code className="rounded bg-secondary px-1">[system.portal_link]</code> are replaced with the real link when the email is sent.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={applyPanel} className="btn-primary !py-1.5 !px-3 text-xs">{panel.mode === 'edit' ? 'Done' : `Insert ${panel.kind}`}</button>
            {panel.mode === 'edit' && <button type="button" onClick={removeAnchor} className="btn-secondary !py-1.5 !px-3 text-xs text-destructive">Remove</button>}
            {panel.mode === 'add' && <button type="button" onClick={() => setPanel(null)} className="btn-secondary !py-1.5 !px-3 text-xs">Cancel</button>}
          </div>
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

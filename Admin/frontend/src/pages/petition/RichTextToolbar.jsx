import { useRef, useState } from 'react'
import {
  Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, AlignLeft, AlignCenter, AlignRight,
  Undo, Redo, RemoveFormatting, Palette, Highlighter, Table as TableIcon, Image as ImageIcon,
  Trash2, Rows, Columns, ZoomIn, ZoomOut,
} from 'lucide-react'

// Widths cycled by the grow/shrink buttons when an image is selected.
const IMAGE_WIDTH_STEPS = ['25%', '50%', '75%', '100%']

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function ToolbarButton({ active, disabled, onClick, title, children }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded p-1.5 transition-colors ${active ? 'bg-blue-100 text-blue-700' : 'text-muted-foreground hover:bg-secondary'} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  )
}

const FONT_FAMILIES = [
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Calibri', value: 'Calibri, Candara, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
]

const FONT_SIZES = ['10px', '11px', '12px', '14px', '16px', '18px', '24px']

// Formal-letter formatting: bold/italic/underline, headings, lists,
// alignment, font family/size, text color/highlight, tables, images,
// undo/redo, clear formatting.
export default function RichTextToolbar({ editor, disabled }) {
  const [colorOpen, setColorOpen] = useState(false)
  const [highlightOpen, setHighlightOpen] = useState(false)
  const fileInputRef = useRef(null)

  if (!editor) return null
  const headingLevel = [1, 2, 3].find((level) => editor.isActive('heading', { level })) || 0
  const insideTable = editor.isActive('table')
  const imageSelected = editor.isActive('image')
  const currentImageWidth = editor.getAttributes('image').width || '100%'

  const insertImage = () => fileInputRef.current?.click()

  const handleImageFileChange = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const dataUrl = await fileToDataUrl(file)
    editor.chain().focus().setImage({ src: dataUrl, width: '50%', align: 'left' }).run()
  }

  const resizeImage = (direction) => {
    const currentIndex = IMAGE_WIDTH_STEPS.indexOf(currentImageWidth)
    const nextIndex = direction === 'grow'
      ? Math.min(IMAGE_WIDTH_STEPS.length - 1, (currentIndex === -1 ? 1 : currentIndex) + 1)
      : Math.max(0, (currentIndex === -1 ? 1 : currentIndex) - 1)
    editor.chain().focus().updateAttributes('image', { width: IMAGE_WIDTH_STEPS[nextIndex] }).run()
  }

  const alignImage = (align) => editor.chain().focus().updateAttributes('image', { align }).run()

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border bg-muted px-3 py-2">
      <select
        value={headingLevel}
        disabled={disabled}
        onChange={(e) => {
          const level = Number(e.target.value)
          if (level === 0) editor.chain().focus().setParagraph().run()
          else editor.chain().focus().toggleHeading({ level }).run()
        }}
        className="rounded border border-border bg-card px-2 py-1 text-xs font-medium text-muted-foreground disabled:opacity-40"
      >
        <option value={0}>Body</option>
        <option value={1}>Heading 1</option>
        <option value={2}>Heading 2</option>
        <option value={3}>Heading 3</option>
      </select>
      <select
        disabled={disabled}
        defaultValue=""
        onChange={(e) => {
          if (!e.target.value) return
          editor.chain().focus().setFontFamily(e.target.value).run()
          e.target.value = ''
        }}
        title="Font family"
        className="rounded border border-border bg-card px-2 py-1 text-xs font-medium text-muted-foreground disabled:opacity-40"
      >
        <option value="">Font</option>
        {FONT_FAMILIES.map((font) => (
          <option key={font.value} value={font.value}>{font.label}</option>
        ))}
      </select>
      <select
        disabled={disabled}
        defaultValue=""
        onChange={(e) => {
          if (!e.target.value) return
          editor.chain().focus().setFontSize(e.target.value).run()
          e.target.value = ''
        }}
        title="Font size"
        className="rounded border border-border bg-card px-2 py-1 text-xs font-medium text-muted-foreground disabled:opacity-40"
      >
        <option value="">Size</option>
        {FONT_SIZES.map((size) => (
          <option key={size} value={size}>{size.replace('px', '')}</option>
        ))}
      </select>
      <div className="mx-1 h-5 w-px bg-muted" />
      <ToolbarButton title="Bold (Ctrl+B)" active={editor.isActive('bold')} disabled={disabled} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton title="Italic (Ctrl+I)" active={editor.isActive('italic')} disabled={disabled} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton title="Underline (Ctrl+U)" active={editor.isActive('underline')} disabled={disabled} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon className="h-4 w-4" /></ToolbarButton>
      <div className="relative">
        <ToolbarButton title="Text color" disabled={disabled} onClick={() => { setColorOpen((open) => !open); setHighlightOpen(false) }}><Palette className="h-4 w-4" /></ToolbarButton>
        {colorOpen && (
          <div className="absolute left-0 top-full z-10 mt-1 rounded border border-border bg-card p-2 shadow-lg">
            <input
              type="color"
              defaultValue="#111111"
              className="h-7 w-10 cursor-pointer"
              onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
            />
            <button type="button" className="ml-2 text-xs text-muted-foreground hover:underline" onClick={() => { editor.chain().focus().unsetColor().run(); setColorOpen(false) }}>Clear</button>
          </div>
        )}
      </div>
      <div className="relative">
        <ToolbarButton title="Highlight" active={editor.isActive('highlight')} disabled={disabled} onClick={() => { setHighlightOpen((open) => !open); setColorOpen(false) }}><Highlighter className="h-4 w-4" /></ToolbarButton>
        {highlightOpen && (
          <div className="absolute left-0 top-full z-10 mt-1 rounded border border-border bg-card p-2 shadow-lg">
            <input
              type="color"
              defaultValue="#fef08a"
              className="h-7 w-10 cursor-pointer"
              onChange={(e) => editor.chain().focus().toggleHighlight({ color: e.target.value }).run()}
            />
            <button type="button" className="ml-2 text-xs text-muted-foreground hover:underline" onClick={() => { editor.chain().focus().unsetHighlight().run(); setHighlightOpen(false) }}>Clear</button>
          </div>
        )}
      </div>
      <div className="mx-1 h-5 w-px bg-muted" />
      <ToolbarButton title="Bulleted list" active={editor.isActive('bulletList')} disabled={disabled} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton title="Numbered list" active={editor.isActive('orderedList')} disabled={disabled} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></ToolbarButton>
      <div className="mx-1 h-5 w-px bg-muted" />
      <ToolbarButton title="Align left" active={editor.isActive({ textAlign: 'left' })} disabled={disabled} onClick={() => editor.chain().focus().setTextAlign('left').run()}><AlignLeft className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton title="Align center" active={editor.isActive({ textAlign: 'center' })} disabled={disabled} onClick={() => editor.chain().focus().setTextAlign('center').run()}><AlignCenter className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton title="Align right" active={editor.isActive({ textAlign: 'right' })} disabled={disabled} onClick={() => editor.chain().focus().setTextAlign('right').run()}><AlignRight className="h-4 w-4" /></ToolbarButton>
      <div className="mx-1 h-5 w-px bg-muted" />
      <ToolbarButton title="Insert table" disabled={disabled} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon className="h-4 w-4" /></ToolbarButton>
      {insideTable && (
        <>
          <ToolbarButton title="Add row" disabled={disabled} onClick={() => editor.chain().focus().addRowAfter().run()}><Rows className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton title="Add column" disabled={disabled} onClick={() => editor.chain().focus().addColumnAfter().run()}><Columns className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton title="Delete table" disabled={disabled} onClick={() => editor.chain().focus().deleteTable().run()}><Trash2 className="h-4 w-4" /></ToolbarButton>
        </>
      )}
      <ToolbarButton title="Insert image" disabled={disabled} onClick={insertImage}><ImageIcon className="h-4 w-4" /></ToolbarButton>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFileChange} />
      {imageSelected && (
        <>
          <ToolbarButton title="Shrink image" disabled={disabled} onClick={() => resizeImage('shrink')}><ZoomOut className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton title="Grow image" disabled={disabled} onClick={() => resizeImage('grow')}><ZoomIn className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton title="Align image left" active={editor.getAttributes('image').align === 'left'} disabled={disabled} onClick={() => alignImage('left')}><AlignLeft className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton title="Align image center" active={editor.getAttributes('image').align === 'center'} disabled={disabled} onClick={() => alignImage('center')}><AlignCenter className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton title="Align image right" active={editor.getAttributes('image').align === 'right'} disabled={disabled} onClick={() => alignImage('right')}><AlignRight className="h-4 w-4" /></ToolbarButton>
        </>
      )}
      <div className="mx-1 h-5 w-px bg-muted" />
      <ToolbarButton title="Clear formatting" disabled={disabled} onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}><RemoveFormatting className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton title="Undo (Ctrl+Z)" disabled={disabled} onClick={() => editor.chain().focus().undo().run()}><Undo className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton title="Redo (Ctrl+Shift+Z)" disabled={disabled} onClick={() => editor.chain().focus().redo().run()}><Redo className="h-4 w-4" /></ToolbarButton>
    </div>
  )
}

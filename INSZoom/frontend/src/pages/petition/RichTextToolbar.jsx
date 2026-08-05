import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, AlignLeft, AlignCenter, AlignRight, Undo, Redo, RemoveFormatting } from 'lucide-react'

function ToolbarButton({ active, disabled, onClick, title, children }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded p-1.5 transition-colors ${active ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  )
}

// Formal-letter-only formatting — bold/italic/underline, H1-H3 + body,
// lists, alignment, undo/redo, clear formatting. No font/color pickers, by
// design, so every filing stays visually consistent.
export default function RichTextToolbar({ editor, disabled }) {
  if (!editor) return null
  const headingLevel = [1, 2, 3].find((level) => editor.isActive('heading', { level })) || 0

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 bg-gray-50 px-3 py-2">
      <select
        value={headingLevel}
        disabled={disabled}
        onChange={(e) => {
          const level = Number(e.target.value)
          if (level === 0) editor.chain().focus().setParagraph().run()
          else editor.chain().focus().toggleHeading({ level }).run()
        }}
        className="rounded border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 disabled:opacity-40"
      >
        <option value={0}>Body</option>
        <option value={1}>Heading 1</option>
        <option value={2}>Heading 2</option>
        <option value={3}>Heading 3</option>
      </select>
      <div className="mx-1 h-5 w-px bg-gray-300" />
      <ToolbarButton title="Bold (Ctrl+B)" active={editor.isActive('bold')} disabled={disabled} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton title="Italic (Ctrl+I)" active={editor.isActive('italic')} disabled={disabled} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton title="Underline (Ctrl+U)" active={editor.isActive('underline')} disabled={disabled} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon className="h-4 w-4" /></ToolbarButton>
      <div className="mx-1 h-5 w-px bg-gray-300" />
      <ToolbarButton title="Bulleted list" active={editor.isActive('bulletList')} disabled={disabled} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton title="Numbered list" active={editor.isActive('orderedList')} disabled={disabled} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></ToolbarButton>
      <div className="mx-1 h-5 w-px bg-gray-300" />
      <ToolbarButton title="Align left" active={editor.isActive({ textAlign: 'left' })} disabled={disabled} onClick={() => editor.chain().focus().setTextAlign('left').run()}><AlignLeft className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton title="Align center" active={editor.isActive({ textAlign: 'center' })} disabled={disabled} onClick={() => editor.chain().focus().setTextAlign('center').run()}><AlignCenter className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton title="Align right" active={editor.isActive({ textAlign: 'right' })} disabled={disabled} onClick={() => editor.chain().focus().setTextAlign('right').run()}><AlignRight className="h-4 w-4" /></ToolbarButton>
      <div className="mx-1 h-5 w-px bg-gray-300" />
      <ToolbarButton title="Clear formatting" disabled={disabled} onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}><RemoveFormatting className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton title="Undo (Ctrl+Z)" disabled={disabled} onClick={() => editor.chain().focus().undo().run()}><Undo className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton title="Redo (Ctrl+Shift+Z)" disabled={disabled} onClick={() => editor.chain().focus().redo().run()}><Redo className="h-4 w-4" /></ToolbarButton>
    </div>
  )
}

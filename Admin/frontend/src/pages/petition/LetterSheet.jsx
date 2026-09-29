import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import ResizableImage from './ResizableImage'
import RichTextToolbar from './RichTextToolbar'
import PetitionSheet from './PetitionSheet'
import { LetterheadHeader, LetterheadFooter } from './LetterheadPreview'

// One editable letter (cover/support/personal). Rendered as a single
// continuously-scrollable "sheet"-styled container rather than true
// multi-page pagination — real dynamic HTML->page-break pagination (the
// kind Word/Google Docs implement) is out of scope here; forms/exhibits
// paginate for real because they come from actual PDF pages, letters don't.
export default function LetterSheet({ section, exhibitIndex, isDraft, disabled, saveState, onEdit, branding, startPage, totalPages, onPageCount }) {
  const lastExternalHtml = useRef(section.contentHtml || '')
  // Tiptap fires onUpdate once for the initial content's own normalization
  // transaction, before any user input — without this guard that phantom
  // firing looks like a real edit and autosaves on every viewer open, even
  // reaching the server as a fake "LETTER_EDITED" audit entry. The internal
  // mount transaction happens inside Tiptap's own effect, so a plain
  // useEffect here (which could run before or after it depending on hook
  // order) isn't a reliable guard — a setTimeout defers to the next tick,
  // strictly after every synchronous effect from this commit has run.
  const readyRef = useRef(false)

  useEffect(() => { onPageCount(section.key, 1) }, [])
  useEffect(() => {
    const timer = setTimeout(() => { readyRef.current = true }, 0)
    return () => clearTimeout(timer)
  }, [])

  // BUG #1 (fixed): @tiptap/react's useEditor re-derives its options object
  // on every render and, with the default empty `deps`, compares it against
  // the live editor's stored options — any mismatch triggers
  // editor.setOptions(), which can reset the document. Two things broke
  // this: (1) `.configure()` calls (TextAlign/Highlight/Table) build a NEW
  // extension instance every render, so the array never compared equal even
  // between two idle renders; (2) passing the live-typed `contentHtml` as
  // `content` meant it changed on every keystroke (via the optimistic save
  // updating the parent section prop), guaranteeing a mismatch mid-typing.
  // Both are now frozen at mount — extensions via useMemo(() => ..., []),
  // content via useState's lazy initializer — so the options object
  // useEditor sees is stable across re-renders; external content changes
  // (e.g. after a conflict reload) still flow through the existing
  // editor.commands.setContent() effect below, not through this options
  // object.
  //
  // BUG #2 (fixed): this Tiptap version's StarterKit now bundles Underline
  // (and Link) internally by default — registering the standalone
  // @tiptap/extension-underline package ALONGSIDE StarterKit silently
  // double-registered the same mark ("Duplicate extension names found:
  // ['underline']" in the console), corrupting the schema and causing
  // exactly the symptoms reported: content scrambling while typing, Enter
  // jumping the cursor while earlier text went stale. Removed the separate
  // import; StarterKit's bundled Underline is used instead.
  const extensions = useMemo(() => [
    StarterKit,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    Highlight.configure({ multicolor: true }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    ResizableImage,
  ], [])
  const [initialContent] = useState(() => section.contentHtml || '<p></p>')

  const editor = useEditor({
    extensions,
    content: initialContent,
    editable: !disabled,
    onUpdate: ({ editor: e }) => {
      lastExternalHtml.current = e.getHTML()
      if (readyRef.current) onEdit(section.key, e.getHTML())
    },
  })

  // Keep the editor in sync if the section's content changes from OUTSIDE
  // this instance (e.g. a reload after a conflict banner) without fighting
  // the user's own in-flight typing.
  useEffect(() => {
    if (!editor) return
    const incoming = section.contentHtml || ''
    if (incoming !== lastExternalHtml.current && incoming !== editor.getHTML()) {
      editor.commands.setContent(incoming)
      lastExternalHtml.current = incoming
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section.contentHtml, editor])

  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [disabled, editor])

  return (
    <PetitionSheet pageNumber={startPage} totalPages={totalPages} className="!min-h-0">
      <div className="-mx-16 -my-14">
        {isDraft && (
          <div className="border-b border-amber-200 bg-amber-50 px-16 py-2 text-xs font-semibold text-amber-800">
            Draft — review required before finalizing
          </div>
        )}
        {!disabled && <RichTextToolbar editor={editor} disabled={disabled} />}
        <div className="px-16 py-10">
          <LetterheadHeader branding={branding} />
          <div className="prose prose-sm prose-h3:underline prose-h4:underline max-w-none font-serif text-[15px] leading-relaxed text-foreground">
            <EditorContent editor={editor} />
          </div>
          {section.type === 'cover_letter' && (
            <div className="mt-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Index of Exhibits</p>
              <p className="mb-3 text-xs text-muted-foreground">This table is derived from the exhibits below and can't be edited directly — reorder exhibits in the outline to change it.</p>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-muted">
                    <th className="border border-border px-3 py-2 text-left font-semibold">Exhibit</th>
                    <th className="border border-border px-3 py-2 text-left font-semibold">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {(exhibitIndex || []).map((exhibit) => (
                    <tr key={exhibit.key}>
                      <td className="border border-border px-3 py-2">Exhibit {exhibit.label}</td>
                      <td className="border border-border px-3 py-2">{exhibit.description || exhibit.title}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <LetterheadFooter branding={branding} />
        </div>
        <div className="border-t border-border px-16 py-2 text-right text-xs text-muted-foreground">
          {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved — retry' : saveState === 'saved' ? 'All changes saved' : ' '}
        </div>
      </div>
    </PetitionSheet>
  )
}

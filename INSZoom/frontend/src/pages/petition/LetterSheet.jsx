import { useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import RichTextToolbar from './RichTextToolbar'
import PetitionSheet from './PetitionSheet'

// One editable letter (cover/support/personal). Rendered as a single
// continuously-scrollable "sheet"-styled container rather than true
// multi-page pagination — real dynamic HTML->page-break pagination (the
// kind Word/Google Docs implement) is out of scope here; forms/exhibits
// paginate for real because they come from actual PDF pages, letters don't.
export default function LetterSheet({ section, exhibitIndex, isDraft, disabled, saveState, onEdit, startPage, totalPages, onPageCount }) {
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

  const editor = useEditor({
    extensions: [StarterKit, Underline, TextAlign.configure({ types: ['heading', 'paragraph'] })],
    content: section.contentHtml || '<p></p>',
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
          <div className="prose prose-sm max-w-none font-serif text-[15px] leading-relaxed text-gray-900">
            <EditorContent editor={editor} />
          </div>
          {section.type === 'cover_letter' && (
            <div className="mt-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Index of Exhibits</p>
              <p className="mb-3 text-xs text-gray-400">This table is derived from the exhibits below and can't be edited directly — reorder exhibits in the outline to change it.</p>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border border-gray-200 px-3 py-2 text-left font-semibold">Exhibit</th>
                    <th className="border border-gray-200 px-3 py-2 text-left font-semibold">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {(exhibitIndex || []).map((exhibit) => (
                    <tr key={exhibit.key}>
                      <td className="border border-gray-200 px-3 py-2">Exhibit {exhibit.label}</td>
                      <td className="border border-gray-200 px-3 py-2">{exhibit.description || exhibit.title}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="border-t border-gray-100 px-16 py-2 text-right text-xs text-gray-400">
          {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved — retry' : saveState === 'saved' ? 'All changes saved' : ' '}
        </div>
      </div>
    </PetitionSheet>
  )
}

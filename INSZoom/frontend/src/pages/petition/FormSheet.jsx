import { useEffect } from 'react'
import { FileText, ExternalLink } from 'lucide-react'
import PdfDocumentPages from './PdfDocumentPages'
import PetitionSheet from './PetitionSheet'

// Read-only USCIS form pages — exactly as filed. Field values are edited on
// the case's Forms tab, never here; this only links out.
export default function FormSheet({ caseId, section, startPage, totalPages, onPageCount }) {
  const hasDocument = Boolean(section.documentId)

  useEffect(() => {
    if (!hasDocument) onPageCount(section.key, 1)
  }, [hasDocument, section.key])

  if (!hasDocument) {
    return (
      <PetitionSheet pageNumber={startPage} totalPages={totalPages}>
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <FileText className="h-8 w-8 text-red-400" />
          <p className="text-sm font-semibold text-red-600">{section.title} has not been generated</p>
          <p className="text-xs text-gray-500">Generate this form on the Forms tab before it can appear in the petition.</p>
        </div>
      </PetitionSheet>
    )
  }

  return (
    <div>
      <div className="mx-auto mb-2 flex items-center justify-between" style={{ width: '816px' }}>
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{section.title}</span>
        <a href={`/crm-cases/${caseId}?tab=forms`} className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline">
          Edit on Forms tab <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <PdfDocumentPages
        documentId={section.documentId}
        onPageCount={(count) => onPageCount(section.key, count)}
        renderSheet={(content, key) => {
          const isPage = key.startsWith('page-')
          const pageIndex = isPage ? Number(key.split('-')[1]) : 1
          return (
            <PetitionSheet key={key} pageNumber={startPage + pageIndex - 1} totalPages={totalPages}>
              {content}
            </PetitionSheet>
          )
        }}
      />
    </div>
  )
}

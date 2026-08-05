import { useEffect, useState } from 'react'
import PdfDocumentPages from './PdfDocumentPages'
import PetitionSheet from './PetitionSheet'

// Divider sheet ("Exhibit A — Title") + that exhibit's own document pages,
// read-only. An exhibit can hold more than one document (e.g. "Additional
// Supporting Evidence"), so page counts are aggregated across all of them
// before reporting this exhibit's total contribution to the canvas.
export default function ExhibitSheet({ exhibit, startPage, totalPages, onPageCount }) {
  const documentIds = exhibit.documentIds || []
  const [docPageCounts, setDocPageCounts] = useState({})

  useEffect(() => {
    const known = documentIds.every((id) => docPageCounts[id] != null)
    if (!known) return
    const total = 1 + documentIds.reduce((sum, id) => sum + (docPageCounts[id] || 0), 0)
    onPageCount(exhibit.key, total)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentIds.join(','), JSON.stringify(docPageCounts)])

  let runningOffset = startPage + 1 // +1 for the divider sheet itself

  return (
    <div>
      <PetitionSheet pageNumber={startPage} totalPages={totalPages} className="border-2 border-dashed border-gray-300">
        <div className="flex h-full flex-col items-center justify-center text-center">
          <p className="text-3xl font-bold text-gray-900">Exhibit {exhibit.label}</p>
          <p className="mt-3 text-lg text-gray-600">{exhibit.title}</p>
        </div>
      </PetitionSheet>
      {documentIds.map((documentId) => {
        const thisOffset = runningOffset
        runningOffset += docPageCounts[documentId] || 0
        return (
          <PdfDocumentPages
            key={documentId}
            documentId={documentId}
            onPageCount={(count) => setDocPageCounts((current) => ({ ...current, [documentId]: count }))}
            renderSheet={(content, key) => {
              const isPage = key.startsWith('page-')
              const pageIndex = isPage ? Number(key.split('-')[1]) : 1
              return (
                <PetitionSheet key={`${documentId}-${key}`} pageNumber={thisOffset + pageIndex - 1} totalPages={totalPages}>
                  {content}
                </PetitionSheet>
              )
            }}
          />
        )
      })}
    </div>
  )
}

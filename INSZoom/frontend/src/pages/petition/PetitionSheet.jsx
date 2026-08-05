// One US-Letter "sheet" — white page, drop shadow, footer "Page N of M".
// Shared by every section type (letters/forms/exhibits) so the whole
// petition reads as one continuous, consistent print-layout document
// regardless of what kind of content is on a given sheet.
export default function PetitionSheet({ pageNumber, totalPages, children, className = '' }) {
  return (
    <div
      className={`relative mx-auto mb-6 bg-white shadow-lg ${className}`}
      style={{ width: '816px', minHeight: '1056px' }}
    >
      <div className="h-full px-16 py-14">{children}</div>
      {pageNumber != null && (
        <div className="absolute inset-x-0 bottom-4 text-center text-xs font-medium text-gray-400">
          Page {pageNumber} of {totalPages || '…'}
        </div>
      )}
    </div>
  )
}

// Mirrors CoverLetterService.buildHeaderFooterTemplates exactly (same
// fields, same layout) so the in-app editing canvas is a true WYSIWYG
// preview of the actual mailing PDF's letterhead/footer, not a bare page.
export function LetterheadHeader({ branding }) {
  if (!branding?.name) return null
  return (
    <div className="mb-6 flex items-center gap-3 border-b border-slate-300 pb-3">
      {branding.logoUrl && (
        // eslint-disable-next-line jsx-a11y/alt-text
        <img src={branding.logoUrl} className="h-8 w-auto object-contain" onError={(e) => { e.currentTarget.style.display = 'none' }} />
      )}
      <div>
        <p className="text-sm font-bold text-slate-900">{branding.name}</p>
        {branding.address && <p className="text-[11px] text-slate-500">{branding.address}</p>}
      </div>
    </div>
  )
}

export function LetterheadFooter({ branding }) {
  const contactLine = [branding?.website, branding?.email, branding?.phone].filter(Boolean).join('  ·  ')
  if (!contactLine) return null
  return (
    <div className="mt-8 border-t border-slate-300 pt-2 text-center text-[10px] text-slate-500">
      {contactLine}
    </div>
  )
}

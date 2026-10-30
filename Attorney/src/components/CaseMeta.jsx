// One line under a case's name: email | Case ID B430 | H-1B, with even spacing and a thin divider between the parts. It wraps onto a second line on a narrow screen rather than
// squeezing; empty parts (no email, no visa) are simply left out together with their divider.
export default function CaseMeta({ email, caseId, visa, className = 'text-sm', extra }) {
  const parts = [
    email && <span key="email" className="font-medium text-foreground/80 break-all">{email}</span>,
    caseId && <span key="id" className="text-muted-foreground whitespace-nowrap">Case ID <span className="font-semibold text-foreground">{caseId}</span></span>,
    visa && <span key="visa" className="font-bold text-foreground whitespace-nowrap">{visa}</span>,
    extra && <span key="extra" className="text-muted-foreground whitespace-nowrap">{extra}</span>,
  ].filter(Boolean)
  return (
    <p className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 ${className}`}>
      {parts.map((part, index) => (
        <span key={part.key} className="inline-flex items-center gap-x-3">
          {index > 0 && <span aria-hidden="true" className="text-border select-none">|</span>}
          {part}
        </span>
      ))}
    </p>
  )
}

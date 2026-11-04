// How a petition AI scan is described on screen (the chip in each petition row and the AI Review panel). Kept tiny and separate so the row
// does not load the panel's code (the panel itself is loaded only when opened).
export const SEVERITY_LABEL = { error: 'To fix', warning: 'To check', info: 'Minor' }
export const CATEGORY_LABEL = {
  typo: 'Typo / wording', wrong_name: 'Wrong name', address_mismatch: 'Address', company_rule: 'Company rule', consistency: 'Inconsistency', unreadable_page: 'Unreadable page',
}
export const OPEN_STATUSES = ['queued', 'scanning']

const total = (counts = {}) => (counts.error || 0) + (counts.warning || 0) + (counts.info || 0)

/** { text, tone: 'muted' | 'busy' | 'good' | 'warn' | 'bad' } for a scan summary (or null when there is none). */
export function aiStatusOf(scan) {
  if (!scan) return { text: 'Not scanned', tone: 'muted' }
  const issues = total(scan.counts)
  switch (scan.status) {
    case 'queued':
      if (scan.paused?.code) return { text: scan.paused.code === 'BILLING' ? 'Waiting - AI billing' : 'Waiting for the AI', tone: 'warn' }
      return { text: scan.pagesDone ? `Waiting to resume (page ${scan.pagesDone + 1})` : 'Queued for AI review', tone: 'busy' }
    case 'scanning':
      return { text: scan.lastPage ? `Scanning ${scan.pagesDone || 0} of ${scan.lastPage} pages` : 'Scanning...', tone: 'busy' }
    case 'completed':
      return issues ? { text: `${issues} issue${issues === 1 ? '' : 's'} (${scan.counts?.error || 0} to fix)`, tone: scan.counts?.error ? 'bad' : 'warn' } : { text: 'No issues found', tone: 'good' }
    case 'completed_with_gaps':
      return { text: `${issues} issue${issues === 1 ? '' : 's'} · some pages unread`, tone: 'warn' }
    case 'failed':
      return { text: 'AI review stopped', tone: 'bad' }
    case 'cancelled':
      return { text: 'AI review cancelled', tone: 'muted' }
    case 'not_configured':
      return { text: 'AI review not set up', tone: 'muted' }
    default:
      return { text: String(scan.status || 'Unknown'), tone: 'muted' }
  }
}

export const TONE_CLASS = {
  muted: 'bg-muted text-muted-foreground',
  busy: 'bg-blue-50 text-blue-700',
  good: 'bg-green-100 text-green-700',
  warn: 'bg-amber-100 text-amber-800',
  bad: 'bg-red-100 text-red-700',
}

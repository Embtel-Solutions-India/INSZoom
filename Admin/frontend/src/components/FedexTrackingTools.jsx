import { useEffect, useRef, useState } from 'react'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { copyTextToClipboard } from '../utils/copyToClipboard'
import { cleanTrackingNumber, fedexTrackingUrl, hasFedexNumber } from '../utils/fedexTracking'

// Copy button + "Track on FedEx" link for a case's FedEx number (USCIS Tracking tab). Shown only for a FedEx shipment with a usable number; otherwise a short hint says what is missing.
export default function FedexTrackingTools({ carrier, number }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const ready = hasFedexNumber({ carrier, trackingNumber: number })
  if (!ready) {
    const typed = String(number || '').trim()
    return (
      <p className="mt-1.5 text-xs text-muted-foreground" data-testid="fedex-tools-hint">
        {typed && String(carrier || '').toLowerCase() !== 'fedex' ? 'Choose FedEx as the shipping carrier to copy and track this number on FedEx.' : 'The FedEx number is asked for when the case moves to Submitted (FedEx); you can also enter it here.'}
      </p>
    )
  }
  const copy = async () => {
    if (await copyTextToClipboard(cleanTrackingNumber(number))) {
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    }
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="fedex-tools">
      <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted">
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
        {copied ? 'Copied' : 'Copy number'}
      </button>
      <a href={fedexTrackingUrl(number)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700">
        Track on FedEx <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    </div>
  )
}

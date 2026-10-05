import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { renderPreview } from '../../utils/emailPreviewRenderer'

// Right-hand half of the editor. Renders instantly in the browser on every
// keystroke (see utils/emailPreviewRenderer.js) using the sample data and the
// backend-provided email layout, so it is exactly what recipients receive.
//
// The email is shown at full height (no scrolling inside the frame) and, when
// it would be taller than the panel, scaled down a little - never below
// MIN_SCALE - so almost the whole email is visible at once. Because the frame
// is full height, re-rendering on each keystroke never resets a scroll
// position, and the previous height is kept until the new content has loaded
// so the panel doesn't jump.
const LOGICAL_WIDTH = 640 // the email card is 560px + page padding
const MIN_SCALE = 0.62

function Row({ label, children }) {
  if (!children || (Array.isArray(children) && !children.length)) return null
  return (
    <div className="flex gap-3 text-sm">
      <span className="w-14 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-foreground">{children}</span>
    </div>
  )
}

export default function EmailPreview({ meta, subject, heading, body, triggerKey, recipients }) {
  const preview = useMemo(
    () => renderPreview({ subject, heading, body, triggerKey, recipients }, meta),
    [meta, subject, heading, body, triggerKey, recipients],
  )

  const stageRef = useRef(null)
  const [stage, setStage] = useState({ width: 0, height: 0 })
  const [contentHeight, setContentHeight] = useState(560)

  useEffect(() => {
    const el = stageRef.current
    if (!el) return undefined
    const measure = () => setStage({ width: el.clientWidth, height: el.clientHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Runs after every srcDoc change; only now do we adopt the new height.
  const handleLoad = useCallback((event) => {
    const doc = event.currentTarget.contentDocument
    if (doc?.documentElement) setContentHeight(doc.documentElement.scrollHeight)
  }, [])

  const fitWidth = stage.width ? stage.width / LOGICAL_WIDTH : 1
  const fitHeight = stage.height ? stage.height / contentHeight : 1
  const scale = Math.max(MIN_SCALE, Math.min(1, fitWidth, fitHeight))

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h3 className="text-sm font-semibold text-foreground">Live preview</h3>
        <span className="text-xs text-muted-foreground">Sample data</span>
      </div>
      <div className="space-y-1.5 border-b border-border bg-secondary/30 px-4 py-3">
        <Row label="From">{preview.from}</Row>
        <Row label="To">{preview.to.join(', ')}</Row>
        <Row label="CC">{preview.cc.join(', ')}</Row>
        <Row label="BCC">{preview.bcc.join(', ')}</Row>
        <Row label="Subject"><strong>{preview.subject || '(no subject)'}</strong></Row>
      </div>
      <div ref={stageRef} className="min-h-[360px] flex-1 overflow-y-auto overflow-x-hidden bg-[#f1f5f9]">
        <div className="mx-auto" style={{ width: LOGICAL_WIDTH * scale, height: contentHeight * scale }}>
          <iframe
            title="Email preview"
            // Scripts stay blocked (no allow-scripts); same-origin is only
            // needed so we can measure the rendered email's height.
            sandbox="allow-same-origin"
            srcDoc={preview.html}
            onLoad={handleLoad}
            scrolling="no"
            style={{ width: LOGICAL_WIDTH, height: contentHeight, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left', display: 'block' }}
          />
        </div>
      </div>
    </div>
  )
}

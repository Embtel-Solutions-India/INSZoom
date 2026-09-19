// The one canonical Immiglance logo mark — a filled primary-color circle with
// a white "trending up" glyph, matching the brand's favicon.svg exactly
// (identical polyline path data, not just a similar-looking icon). Ported
// from Immiglance/Landing when Login/Register/etc. moved to this app, so
// there is exactly one place per app that defines what "the Immiglance logo"
// looks like, instead of every surface drawing its own approximation.
export default function BrandMark({ size = "w-9 h-9", className = "" }) {
  return (
    <div className={`${size} rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 ${className}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[55%] h-[55%]">
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
        <polyline points="16 7 22 7 22 13" />
      </svg>
    </div>
  );
}

// The wordmark text styling, kept alongside the mark so every "Immiglance"
// logo lockup (icon + name) uses the exact same font/weight/tracking rather
// than each page picking its own.
export function BrandWordmark({ className = "text-lg" }) {
  return <span className={`font-sans font-extrabold tracking-tight text-foreground ${className}`}>Immiglance</span>;
}

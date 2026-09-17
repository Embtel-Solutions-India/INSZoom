// The one canonical Immiglance logo mark — a filled primary-color circle with
// a white "trending up" glyph, matching the brand's favicon.svg exactly
// (identical polyline path data). Used everywhere the logo appears (sidebar
// header, login page) so this app, Immiglance, and Attorney all render the
// literal same markup for the logo rather than three different
// approximations of it. Inlined as raw SVG (same path data as
// lucide-react's TrendingUp icon, kept byte-identical across all three
// frontends) rather than importing lucide-react's component, so the mark
// can't drift if the apps end up on different lucide-react versions.
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

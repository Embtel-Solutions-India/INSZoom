import ThemeToggle from "../ThemeToggle";
import BrandMark from "../BrandMark";

// Shared shell for every pre-authentication card (Login, Register, ...).
// The brand lockup renders in normal document flow *above and outside* the
// card, in its own fixed-height block, so it never shifts on screen when
// the card below it changes height (a validation error appearing, a role
// tab switch, etc.) — previously the logo was the first child *inside* the
// same vertically-centered card, so any height change visibly moved it.
export default function AuthShell({ title, subtitle, children }) {
  return (
    <div className="relative h-screen overflow-hidden flex flex-col items-center justify-center bg-background px-4 py-4">
      <div className="absolute right-5 top-5">
        <ThemeToggle />
      </div>

      <div className="flex items-center gap-2.5 mb-4 shrink-0">
        <BrandMark size="w-9 h-9" />
        <div>
          <h1 className="text-base font-bold text-foreground font-serif leading-tight">Immiglance</h1>
          <p className="text-xs text-muted-foreground leading-tight">Client Portal</p>
        </div>
      </div>

      <div className="w-full max-w-md rounded-2xl border border-card-border bg-card shadow-sm p-5 sm:p-6">
        {title && <h2 className="text-xl font-serif font-bold text-foreground mb-0.5 text-center">{title}</h2>}
        {subtitle && <p className="text-xs text-muted-foreground mb-4 text-center">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

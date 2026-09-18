import DisclaimerBanner from "./DisclaimerBanner";
import ThemeToggle from "../ThemeToggle";

// Shared shell for the pre-case consultation-booking screen: renders the
// persistent disclaimer banner above the page content on the app's own
// background, plus a theme toggle (PortalLayout's pages already have one in
// their top bar — this standalone, pre-case screen has no such chrome of its
// own, so it needs its own). Otherwise a byte-for-byte mirror of Landing's
// own EligibilityShell.
export default function EligibilityShell({ children }) {
  return (
    <div className="relative min-h-screen bg-background flex flex-col">
      <div className="absolute right-5 top-5 z-10">
        <ThemeToggle />
      </div>
      <DisclaimerBanner />
      <div className="flex-1">{children}</div>
    </div>
  );
}

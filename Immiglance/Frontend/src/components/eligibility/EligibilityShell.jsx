import DisclaimerBanner from "./DisclaimerBanner";

// Shared shell for every public quiz/consultation screen: renders the
// persistent disclaimer banner above the page content on the app's own
// background. Deliberately does not fetch/inject any separate "brand token"
// theme — every child component themes off the app's real tokens
// (bg-primary/text-primary-foreground/etc., see index.css) directly, so this
// flow always matches the rest of the site instead of a law-firm-brand
// navy/gold override.
export default function EligibilityShell({ children }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <DisclaimerBanner />
      <div className="flex-1">{children}</div>
    </div>
  );
}

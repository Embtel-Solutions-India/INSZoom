import { useEffect, useState } from "react";
import { entityConfigApi } from "../../services/api";
import DisclaimerBanner from "./DisclaimerBanner";

// Shared shell for every public quiz screen: fetches brand tokens once and
// exposes them as CSS custom properties (so every child component can theme
// off `var(--eligibility-primary)` / `var(--eligibility-accent)` without its
// own fetch), and renders the persistent disclaimer banner above the page
// content. Defaults to a calm navy/gold professional scheme — matching
// Phase 0's own DEFAULT_BRAND_TOKENS — when no brand tokens are configured.
export default function EligibilityShell({ children }) {
  const [tokens, setTokens] = useState({ primaryColor: "#0B1F3A", accentColor: "#C6A15B" });

  useEffect(() => {
    let mounted = true;
    entityConfigApi.public()
      .then((res) => {
        if (!mounted) return;
        const brandTokens = res.data?.brandTokens;
        if (brandTokens?.primaryColor || brandTokens?.accentColor) {
          setTokens({
            primaryColor: brandTokens.primaryColor || "#0B1F3A",
            accentColor: brandTokens.accentColor || "#C6A15B",
          });
        }
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  return (
    <div
      className="min-h-screen bg-white flex flex-col"
      style={{ "--eligibility-primary": tokens.primaryColor, "--eligibility-accent": tokens.accentColor }}
    >
      <DisclaimerBanner />
      <div className="flex-1">{children}</div>
    </div>
  );
}

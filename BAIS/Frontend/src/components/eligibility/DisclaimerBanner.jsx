import { useEffect, useState } from "react";
import { complianceApi } from "../../services/api";

// Persistent, always-visible non-attorney disclaimer (Phase 0) — a fixed
// banner, never a dismiss-forever footer link, per the compliance
// requirement that it be visible on every quiz screen. Renders safely even
// when lawFirmConfigured:false (the backend already substitutes a generic
// clause server-side — this component never needs to know the difference).
export default function DisclaimerBanner() {
  const [text, setText] = useState("");

  useEffect(() => {
    let mounted = true;
    complianceApi.disclaimer()
      .then((res) => { if (mounted) setText(res.data?.text || ""); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  if (!text) return null;

  return (
    <div className="bg-slate-100 border-b border-slate-200">
      <p className="max-w-3xl mx-auto px-4 py-2.5 text-center text-[0.72rem] leading-snug text-slate-500">
        {text}
      </p>
    </div>
  );
}

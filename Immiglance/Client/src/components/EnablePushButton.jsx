import { useCallback, useEffect, useState } from "react";
import { getPushStatus, requestPermissionAndGetToken, isPushPromptDismissed, dismissPushPrompt } from "../services/notificationService";

// Sticky, theme-coloured call-to-action for browser push notifications. It is
// shown only while push is NOT working for this account in this browser, and
// disappears the moment it is enabled. Clicking it opens the browser's own
// permission prompt (a user gesture, as browsers require) and, once granted,
// registers this browser so push delivery starts immediately.
export default function EnablePushButton() {
  const [status, setStatus] = useState("checking");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");
  const [dismissed, setDismissed] = useState(isPushPromptDismissed);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getPushStatus());
    } catch {
      setStatus("unsupported");
    }
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    let perm;
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: "notifications" }).then((p) => {
        perm = p;
        p.onchange = refresh;
      }).catch(() => {});
    }
    return () => {
      window.removeEventListener("focus", refresh);
      if (perm) perm.onchange = null;
    };
  }, [refresh]);

  if (status === "checking" || status === "unsupported" || status === "enabled" || dismissed) return null;

  const onClick = async () => {
    setHint("");
    if (status === "denied") {
      setHint("Notifications are blocked for this site. Allow them in your browser's site settings, then click again.");
      return;
    }
    setBusy(true);
    try {
      const token = await requestPermissionAndGetToken();
      if (!token && typeof Notification !== "undefined" && Notification.permission === "denied") {
        setHint("Notifications were blocked. Allow them in your browser's site settings to turn them on.");
      }
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-40 flex flex-col items-end gap-2 pointer-events-none">
      {hint && (
        <div className="pointer-events-auto max-w-xs rounded-lg border border-border bg-popover text-popover-foreground text-xs px-3 py-2 shadow-lg">
          {hint}
        </div>
      )}
      <div className="pointer-events-auto relative">
        <button
          type="button"
          onClick={onClick}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold shadow-lg hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
          {busy ? "Enabling…" : "Enable notifications"}
        </button>
        <button
          type="button"
          onClick={() => { dismissPushPrompt(); setDismissed(true); }}
          aria-label="Close"
          title="Close"
          className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-popover text-popover-foreground text-xs leading-none shadow hover:bg-muted"
        >
          ×
        </button>
      </div>
    </div>
  );
}

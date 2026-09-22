import { useEffect, useRef, useState } from "react";
import { documentIntelligenceApi } from "../../services/api";
import { unwrapApiData } from "../../utils/questionnaireEngine";
import { IconSparkles, IconCheckCircle, IconAlertTriangle, IconUpload } from "../../utils/iconComponents";

// A guided "scan your documents first" entry point for the Documents page,
// shown before the manual checklist (see Documents.jsx's `scanStep` gate).
// Reuses the existing single-file OCR-autofill endpoint
// (documentIntelligenceApi.autofillFromDocument — the same one
// QuestionInput.jsx's AutofillButton already calls) for every actual scan;
// this component only adds the "which documents can I scan, and how did
// each one go" UI around it. No new upload pipeline, no new business rules
// about what's scannable — that list comes entirely from the backend's
// GET /case/:caseId/scan-options (documentIntelligenceApi.caseScanOptions),
// which already intersects this case's real, currently-applicable checklist
// against the OCR-capable document-type allowlist.
export default function SmartScanStep({ caseId, onScanComplete, onSkip }) {
  const [optionsState, setOptionsState] = useState("loading"); // loading | loaded | error
  const [optionsError, setOptionsError] = useState("");
  const [items, setItems] = useState([]);
  // Keyed by documentType: { status: "idle" | "scanning" | "done" | "error", document, prefill, message }
  const [scans, setScans] = useState({});
  const inputRefs = useRef({});

  useEffect(() => {
    if (!caseId) return;
    let mounted = true;
    setOptionsState("loading");
    setOptionsError("");
    documentIntelligenceApi.caseScanOptions(caseId)
      .then((response) => {
        if (!mounted) return;
        const data = unwrapApiData(response);
        setItems(data.items || []);
        setOptionsState("loaded");
      })
      .catch((error) => {
        if (!mounted) return;
        setOptionsError(error.message || "Couldn't load Smart Scan options.");
        setOptionsState("error");
      });
    return () => { mounted = false; };
  }, [caseId]);

  // Nothing to scan for this case — skip straight to the checklist. A
  // useEffect (not a render-time call) so onSkip() never fires as a side
  // effect of rendering — this still paints one frame of the (now-empty)
  // scan step first, which is fine, it's instant.
  useEffect(() => {
    if (optionsState === "loaded" && items.length === 0) onSkip();
  }, [optionsState, items, onSkip]);

  const startScan = (documentType, file) => {
    setScans((prev) => ({ ...prev, [documentType]: { status: "scanning" } }));
    documentIntelligenceApi.autofillFromDocument(caseId, documentType, file)
      .then((response) => {
        const data = unwrapApiData(response);
        setScans((prev) => ({
          ...prev,
          [documentType]: { status: "done", document: data.document, prefill: data.prefill || [], message: data.message },
        }));
      })
      .catch((error) => {
        setScans((prev) => ({ ...prev, [documentType]: { status: "error", message: error.message || "That scan failed." } }));
      });
  };

  const handleFileChange = (documentType) => (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) startScan(documentType, file);
  };

  const anyScanning = Object.values(scans).some((scan) => scan.status === "scanning");

  const handleContinue = () => {
    const completed = Object.entries(scans)
      .filter(([, scan]) => scan.status === "done" && scan.document)
      .map(([documentType, scan]) => ({ documentType, status: scan.status, document: scan.document }));
    onScanComplete(completed);
  };

  if (optionsState === "error") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center">
        <IconAlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-500" />
        <h2 className="text-lg font-bold text-foreground">Smart Scan isn't available right now</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{optionsError}</p>
        <button
          type="button"
          onClick={onSkip}
          className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          Skip scanning and fill manually
        </button>
      </div>
    );
  }

  if (optionsState === "loading") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 text-center">
        <IconSparkles className="mx-auto mb-2 h-7 w-7 text-emerald-600" />
        <h1 className="text-xl font-bold text-foreground">Smart Scan</h1>
        <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
          Scan a document and we'll fill in what we can find — you'll still see and confirm everything on the checklist next.
        </p>
      </div>

      <div className="space-y-3">
        {items.map((item) => {
          const scan = scans[item.documentType] || { status: "idle" };
          return (
            <div key={item.documentType} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{item.label}</p>
                  {scan.status === "idle" && <p className="text-xs text-muted-foreground">Not scanned yet</p>}
                  {scan.status === "scanning" && <p className="text-xs font-medium text-emerald-600">Scanning…</p>}
                  {scan.status === "error" && <p className="text-xs font-medium text-destructive">{scan.message}</p>}
                </div>
                <div className="shrink-0">
                  <input
                    ref={(el) => { inputRefs.current[item.documentType] = el; }}
                    type="file"
                    id={`smart-scan-${item.documentType}`}
                    name={`smart-scan-${item.documentType}`}
                    accept={(item.mimeTypes || []).join(",")}
                    onChange={handleFileChange(item.documentType)}
                    className="hidden"
                  />
                  {scan.status === "scanning" ? (
                    <span className="inline-flex h-8 w-8 items-center justify-center">
                      <span className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-600" />
                    </span>
                  ) : scan.status === "error" ? (
                    <button
                      type="button"
                      onClick={() => inputRefs.current[item.documentType]?.click()}
                      className="rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-bold text-destructive transition hover:bg-destructive/20"
                    >
                      Try again
                    </button>
                  ) : scan.status === "done" ? (
                    <button
                      type="button"
                      onClick={() => inputRefs.current[item.documentType]?.click()}
                      className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100"
                    >
                      <IconCheckCircle className="h-3.5 w-3.5" /> Scanned — rescan
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => inputRefs.current[item.documentType]?.click()}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-3 py-1.5 text-xs font-bold text-foreground transition hover:bg-secondary/70"
                    >
                      <IconUpload className="h-3.5 w-3.5" /> Scan
                    </button>
                  )}
                </div>
              </div>

              {scan.status === "done" && scan.prefill?.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-border pt-3">
                  {scan.prefill
                    .filter((entry) => entry.targetSystem === "answer")
                    .map((entry, index) => (
                      <li key={`${entry.key || index}`} className="flex items-center justify-between gap-3 text-xs">
                        <span className="text-muted-foreground">{entry.label || entry.key}</span>
                        <span className={entry.conflict ? "font-semibold text-amber-600" : "font-semibold text-emerald-700"}>
                          {entry.conflict ? "Needs review — you already have a different answer" : String(entry.value ?? "Applied")}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <button type="button" onClick={onSkip} className="text-sm font-semibold text-muted-foreground underline hover:text-foreground">
          Skip scanning and fill manually
        </button>
        <button
          type="button"
          onClick={handleContinue}
          disabled={anyScanning}
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Continue to checklist
        </button>
      </div>
    </div>
  );
}

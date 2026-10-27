import { useEffect, useState } from "react";
import PetitionThread from "./PetitionThread";
import usePetitionStream from "./usePetitionStream";

// The petition opened in the software itself: the PDF takes 75% of the screen, a Feedback column (heading, messages, message box, Send) the other 25%. Below the large
// breakpoint the two stack (the petition first, the feedback under it). Esc or the close button returns to the list.
// The PDF is streamed into the browser's own viewer (page 1 shows while the rest loads); while the server prepares a big file the person sees "Opening…" and we keep trying
// by ourselves - no timeout message.
export default function PetitionViewer({ item, onClose, onChanged, onDownload }) {
  const { status, url, error, waited, retry } = usePetitionStream(item.documentId);
  const [painted, setPainted] = useState(false);

  useEffect(() => { setPainted(false); }, [url]);

  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [onClose]);

  const opening = status === "preparing" || (status === "ready" && !painted);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background" role="dialog" aria-modal="true" aria-label={`Petition: ${item.fileName}`}>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-3 sm:px-5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-foreground">{item.fileName}</p>
          <p className="truncate text-xs text-muted-foreground">Case {item.caseNumber}</p>
        </div>
        <button type="button" onClick={() => onDownload(item)} className="hidden rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold text-primary transition hover:bg-secondary sm:inline-flex">Download</button>
        <button type="button" onClick={onClose} title="Close" aria-label="Close the petition" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-foreground transition hover:bg-secondary"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg></button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,0.9fr)] lg:grid-cols-[75fr_25fr] lg:grid-rows-1">
        <section className="relative min-h-0 bg-muted/30" aria-label="Petition">
          {status === "error" ? (
            <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-muted-foreground">{error}</p>
              <button type="button" onClick={retry} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Try again</button>
            </div>
          ) : (
            <>
              {status === "ready" && <iframe title={`Petition: ${item.fileName}`} src={url} onLoad={() => setPainted(true)} className="h-full w-full border-0" />}
              {opening && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 p-6 text-center" role="status" aria-live="polite">
                  <div className="h-9 w-9 animate-spin rounded-full border-4 border-secondary border-t-primary" />
                  <p className="text-sm font-semibold text-foreground">Opening your petition…</p>
                  {waited && <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">A large petition can take a minute to prepare. We keep trying automatically - you do not need to do anything.</p>}
                </div>
              )}
            </>
          )}
        </section>
        <aside className="flex min-h-0 min-w-0 flex-col border-t border-border bg-card lg:min-w-[15rem] lg:border-l lg:border-t-0" aria-label="Feedback">
          <h2 className="shrink-0 border-b border-border px-3 py-3 text-sm font-bold text-foreground">Feedback</h2>
          <PetitionThread documentId={item.documentId} compact onChanged={onChanged} />
        </aside>
      </div>
    </div>
  );
}

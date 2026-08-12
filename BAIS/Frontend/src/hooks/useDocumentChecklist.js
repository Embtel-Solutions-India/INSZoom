import { useCallback, useEffect, useRef, useState } from "react";
import { documentsApi } from "../services/api";

// Shared files/extractions bookkeeping + upload/remove handlers, lifted out of
// Documents.jsx so any surface driving the same <DocumentChecklist> UI
// doesn't reimplement the resumable-upload plumbing.
//
// FIX: uploadsInFlight tracks how many handleUpload() calls haven't resolved
// yet, so a page (Documents.jsx's commitAll()) can await full completion of
// every in-flight upload before persisting answers/submitting — resumable
// uploads already await completeUpload() internally (services/api.js), so a
// document only ever counts as "done" once finalized server-side; this just
// surfaces that in-flight state to the page instead of it being invisible.
export default function useDocumentChecklist(context = {}) {
  const [files, setFiles] = useState({});
  const [extractions, setExtractions] = useState({});
  const [uploadsInFlight, setUploadsInFlight] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const pendingUploads = useRef(new Set());

  // FIX: this used to swallow every failure (`.catch(() => {})`) with no
  // loading flag at all, so a failed /documents fetch left `files` at `{}`
  // forever with zero indication anything went wrong — uploaded documents
  // just silently didn't appear. loading/error/reload now let a caller
  // distinguish "still fetching" / "fetch failed, here's why" / "no
  // documents yet" instead of treating all three the same way.
  const load = useCallback(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    documentsApi.list().then((docs) => {
      if (!mounted) return;
      const grouped = {};
      docs.forEach((d) => {
        if (!grouped[d.documentType]) grouped[d.documentType] = [];
        grouped[d.documentType].push(d);
      });
      setFiles(grouped);
      const extractionMap = {};
      docs.forEach((d) => { extractionMap[d._id] = { status: d.intelligenceStatus || d.processing?.status || d.aiExtractionStatus }; });
      setExtractions(extractionMap);
    }).catch((err) => {
      if (!mounted) return;
      setError(err.message || "Failed to load documents");
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => load(), [load]);

  const handleUpload = async (file, category, documentType, controls) => {
    setUploadsInFlight((count) => count + 1);
    const uploadPromise = documentsApi.uploadResumable(file, category, documentType, context, controls);
    pendingUploads.current.add(uploadPromise);
    try {
      const doc = await uploadPromise;
      setFiles((prev) => ({
        ...prev,
        [documentType]: [...(prev[documentType] || []), doc.document],
      }));
      setExtractions((prev) => ({ ...prev, [doc.document._id]: { status: doc.document.intelligenceStatus || "queued", processingStage: "queued" } }));
    } finally {
      pendingUploads.current.delete(uploadPromise);
      setUploadsInFlight((count) => Math.max(0, count - 1));
    }
  };

  const handleRemove = async (docId) => {
    await documentsApi.remove(docId);
    setFiles((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        next[key] = next[key].filter((d) => d._id !== docId);
      }
      return next;
    });
  };

  // Awaited by commitAll() before it batch-saves answers/submits — resolves
  // once every upload started so far (successful or failed) has settled, so
  // a client can never lose an in-progress upload by submitting too early.
  const awaitUploads = () => Promise.allSettled([...pendingUploads.current]);

  return { files, extractions, handleUpload, handleRemove, uploadsInFlight, awaitUploads, loading, error, reload: load };
}

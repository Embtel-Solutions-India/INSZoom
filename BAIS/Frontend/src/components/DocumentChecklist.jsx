import { useState, useRef } from "react";

// Shared "document checklist" rendering core, lifted out of Documents.jsx so
// EmployerWorkspace.jsx can render the exact same category-card/upload-zone UI
// against a different item source (a resolved Questionnaire's file questions)
// instead of re-implementing upload widgets per page.

/* ── Icons ─────────────────────────────────────────────────────────────────── */
const Ic = {
  Upload:   () => (
    <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
    </svg>
  ),
  File:     () => (
    <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/>
    </svg>
  ),
  Trash:    () => (
    <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
    </svg>
  ),
  Check:    () => (
    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"/>
    </svg>
  ),
  Passport: () => (
    <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
        d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2"/>
    </svg>
  ),
  GraduationCap: () => (
    <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 14l9-5-9-5-9 5 9 5z"/>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
        d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z"/>
    </svg>
  ),
  Briefcase: () => (
    <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
        d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
    </svg>
  ),
  CreditCard: () => (
    <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
        d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/>
    </svg>
  ),
  Users: () => (
    <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
    </svg>
  ),
  Globe: () => (
    <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
        d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/>
    </svg>
  ),
  Image: () => (
    <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 20m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
    </svg>
  ),
};

/* ── Category presentation (label, icon, color) keyed by checklist category ──── */
const ACCEPT_ALL = ".pdf,.jpg,.jpeg,.png,.tif,.tiff,.docx,.doc";
const CATEGORY_META = {
  identity:     { label: "Identity Documents",       icon: Ic.Passport,      color: { bg: "bg-blue-50",    text: "text-blue-600",    border: "border-blue-100",    tag: "bg-blue-100 text-blue-700",       dot: "bg-blue-500" } },
  education:    { label: "Education Documents",      icon: Ic.GraduationCap, color: { bg: "bg-violet-50",  text: "text-violet-600",  border: "border-violet-100",  tag: "bg-violet-100 text-violet-700",   dot: "bg-violet-500" } },
  employment:   { label: "Employment Documents",     icon: Ic.Briefcase,     color: { bg: "bg-emerald-50", text: "text-emerald-600", border: "border-emerald-100", tag: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" } },
  financial:    { label: "Financial Documents",      icon: Ic.CreditCard,    color: { bg: "bg-amber-50",   text: "text-amber-600",   border: "border-amber-100",   tag: "bg-amber-100 text-amber-700",     dot: "bg-amber-500" } },
  immigration:  { label: "Immigration Documents",    icon: Ic.Globe,         color: { bg: "bg-teal-50",    text: "text-teal-600",    border: "border-teal-100",    tag: "bg-teal-100 text-teal-700",       dot: "bg-teal-500" } },
  evidence:     { label: "Supporting Evidence",      icon: Ic.Image,         color: { bg: "bg-pink-50",    text: "text-pink-600",    border: "border-pink-100",    tag: "bg-pink-100 text-pink-700",       dot: "bg-pink-500" } },
  letters:      { label: "Recommendation Letters",   icon: Ic.Users,         color: { bg: "bg-indigo-50",  text: "text-indigo-600",  border: "border-indigo-100",  tag: "bg-indigo-100 text-indigo-700",   dot: "bg-indigo-500" } },
  relationship: { label: "Relationship Evidence",    icon: Ic.Users,         color: { bg: "bg-rose-50",    text: "text-rose-600",    border: "border-rose-100",    tag: "bg-rose-100 text-rose-700",       dot: "bg-rose-500" } },
  business:     { label: "Business Documents",       icon: Ic.Briefcase,     color: { bg: "bg-sky-50",     text: "text-sky-600",     border: "border-sky-100",     tag: "bg-sky-100 text-sky-700",         dot: "bg-sky-500" } },
  us_business:      { label: "U.S. Company Documents",     icon: Ic.Briefcase, color: { bg: "bg-sky-50",     text: "text-sky-600",     border: "border-sky-100",     tag: "bg-sky-100 text-sky-700",         dot: "bg-sky-500" } },
  foreign_business: { label: "Foreign Company Documents",  icon: Ic.Globe,     color: { bg: "bg-cyan-50",    text: "text-cyan-600",    border: "border-cyan-100",    tag: "bg-cyan-100 text-cyan-700",       dot: "bg-cyan-500" } },
  civil:        { label: "Civil Documents",          icon: Ic.Users,         color: { bg: "bg-rose-50",    text: "text-rose-600",    border: "border-rose-100",    tag: "bg-rose-100 text-rose-700",       dot: "bg-rose-500" } },
  medical:      { label: "Medical Documents",        icon: Ic.File,          color: { bg: "bg-lime-50",    text: "text-lime-700",    border: "border-lime-100",    tag: "bg-lime-100 text-lime-800",       dot: "bg-lime-500" } },
  legal:        { label: "Legal Documents",          icon: Ic.File,          color: { bg: "bg-orange-50",  text: "text-orange-700",  border: "border-orange-100",  tag: "bg-orange-100 text-orange-800",   dot: "bg-orange-500" } },
  supporting:   { label: "Supporting Evidence",      icon: Ic.Image,         color: { bg: "bg-pink-50",    text: "text-pink-600",    border: "border-pink-100",    tag: "bg-pink-100 text-pink-700",       dot: "bg-pink-500" } },
  travel:       { label: "Travel Documents",         icon: Ic.Globe,         color: { bg: "bg-cyan-50",    text: "text-cyan-600",    border: "border-cyan-100",    tag: "bg-cyan-100 text-cyan-700",       dot: "bg-cyan-500" } },
  general:      { label: "Other Documents",          icon: Ic.File,          color: { bg: "bg-slate-50",   text: "text-slate-600",   border: "border-slate-200",   tag: "bg-slate-100 text-slate-700",     dot: "bg-slate-500" } },
};
const metaFor = (cat) => CATEGORY_META[cat] || CATEGORY_META.general;

/** Build category cards from a flat list of {documentType|name, description|notes, required, category} items. */
export function buildCaseCategories(checklist = []) {
  const docs = checklist.map((item) => ({
    key: item.documentType || item.name,
    name: item.name || item.documentType,
    description: item.description || item.notes,
    required: item.required !== false,
    category: item.category || "general",
    status: item.status,
  }));
  const byCat = {};
  docs.forEach((d) => {
    const normalizedCategory = String(d.category || "general").toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const catId = CATEGORY_META[normalizedCategory] ? normalizedCategory : "general";
    if (!byCat[catId]) {
      const meta = metaFor(catId);
      byCat[catId] = { id: catId, label: meta.label, icon: meta.icon, color: meta.color, docs: [] };
    }
    byCat[catId].docs.push({
      id: d.key,
      label: d.name,
      description: d.description,
      required: d.required,
      accept: ACCEPT_ALL,
    });
  });
  // Stable order by the CATEGORY_META key order.
  return Object.keys(CATEGORY_META).filter((k) => byCat[k]).map((k) => byCat[k]);
}

/* ── File chip ─────────────────────────────────────────────────────────────── */
const intelligenceBadge = (file) => {
  const status = file.intelligenceStatus || file.processing?.status || file.aiExtractionStatus;
  if (status === "failed") return { label: "Processing failed", className: "bg-red-100 text-red-700" };
  if (status === "approved") return { label: "Verified", className: "bg-emerald-100 text-emerald-700" };
  if (status === "needs_review" || status === "review_required") return { label: "Under team review", className: "bg-amber-100 text-amber-700" };
  if (["processing", "ocr_complete", "queued"].includes(status)) return { label: "Processing", className: "bg-blue-100 text-blue-700" };
  return { label: "Uploaded", className: "bg-slate-100 text-slate-600" };
};

function FileChip({ file, onRemove, extraction }) {
  const ext = file.name.split(".").pop().toUpperCase();
  const badge = file.reviewStatus === "needs_revision" || file.reviewStatus === "rejected"
    ? { label: "Replacement requested", className: "bg-red-100 text-red-700" }
    : file.reviewStatus === "approved"
      ? { label: "Verified", className: "bg-emerald-100 text-emerald-700" }
      : intelligenceBadge(file);
  const extColors = {
    PDF:  "bg-red-100 text-red-700",
    JPG:  "bg-sky-100 text-sky-700",
    JPEG: "bg-sky-100 text-sky-700",
    PNG:  "bg-indigo-100 text-indigo-700",
    DOCX: "bg-blue-100 text-blue-700",
    DOC:  "bg-blue-100 text-blue-700",
  };
  return (
    <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm shadow-sm group">
      <span className={`text-[0.6rem] font-extrabold px-1.5 py-0.5 rounded ${extColors[ext] || "bg-slate-100 text-slate-600"}`}>
        {ext}
      </span>
      <span className="text-slate-700 font-medium truncate max-w-[160px]" title={file.name}>{file.name}</span>
      <span className={`text-[0.6rem] font-bold px-2 py-0.5 rounded-full ${badge.className}`}>{badge.label}</span>
      <button
        onClick={onRemove}
        className="ml-1 text-slate-400 hover:text-red-500 transition opacity-0 group-hover:opacity-100"
        title="Remove"
      >
        <Ic.Trash />
      </button>
    </div>
  );
}

/* ── Upload zone ────────────────────────────────────────────────────────────── */
function UploadZone({ docId, category, label, description, required, accept, color, files, extractions, onUpload, onRemove }) {
  const inputRef  = useRef();
  const pauseRef = useRef(false);
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadState, setUploadState] = useState(null);
  const hasFiles  = files.length > 0;

  const uploadFiles = async (fileList) => {
    setUploading(true);
    for (const file of fileList) {
      try {
        pauseRef.current = false;
        setUploadState({ fileName: file.name, progress: 0, paused: false, error: "" });
        await onUpload(file, category, docId, {
          isPaused: () => pauseRef.current,
          onProgress: (progress, uploadId) => setUploadState((current) => ({
            ...(current || {}),
            fileName: file.name,
            progress,
            uploadId,
            paused: pauseRef.current,
            error: "",
          })),
        });
        setUploadState((current) => ({ ...(current || {}), progress: 100, paused: false }));
      } catch (err) {
        setUploadState((current) => ({ ...(current || {}), error: err.message, paused: false }));
      }
    }
    setUploading(false);
  };

  const togglePause = (event) => {
    event.stopPropagation();
    pauseRef.current = !pauseRef.current;
    setUploadState((current) => current ? { ...current, paused: pauseRef.current } : current);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    uploadFiles(Array.from(e.dataTransfer.files));
  };

  const handleInput = (e) => {
    uploadFiles(Array.from(e.target.files));
    e.target.value = "";
  };

  const removeFile = async (file) => {
    if (file._id) {
      try { await onRemove(file._id); } catch {}
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden transition hover:shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <span className={`w-2 h-2 rounded-full ${color.dot}`} />
          <div>
            <span className="text-sm font-semibold text-slate-700">{label}</span>
            {description && <p className="text-[0.7rem] text-slate-400 leading-snug">{description}</p>}
          </div>
          {required
            ? <span className={`text-[0.62rem] font-extrabold uppercase px-2 py-0.5 rounded-full ${color.tag}`}>Required</span>
            : <span className="text-[0.62rem] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">Optional</span>}
        </div>
        {hasFiles && (
          <span className="flex items-center gap-1 text-emerald-600 text-xs font-bold shrink-0">
            <Ic.Check /> {files.length} file{files.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={handleDrop}
        onClick={() => !uploading && inputRef.current.click()}
        className={`flex flex-col items-center justify-center gap-1.5 px-4 py-5 cursor-pointer transition
          ${drag ? `${color.bg} border-2 border-dashed border-current ${color.text}` : "bg-slate-50/70 hover:bg-slate-50"}
          ${uploading ? "opacity-80" : ""}
        `}
      >
        <span className={`${color.text} opacity-70`}><Ic.Upload /></span>
        <p className="text-[0.8rem] font-semibold text-slate-500">
          {uploading
            ? `${uploadState?.paused ? "Paused" : "Uploading"} ${uploadState?.fileName || ""}`
            : <>Drop files here or <span className={`${color.text} underline`}>browse</span></>}
        </p>
        {uploading && (
          <div className="w-full max-w-sm mt-2" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="h-2 flex-1 rounded-full bg-slate-200 overflow-hidden">
                <div className={`h-full ${color.dot} transition-all`} style={{ width: `${uploadState?.progress || 0}%` }} />
              </div>
              <span className="text-xs font-bold text-slate-600 w-10 text-right">{uploadState?.progress || 0}%</span>
              <button type="button" onClick={togglePause} className="text-xs font-bold text-emerald-700 hover:text-emerald-900">
                {uploadState?.paused ? "Resume" : "Pause"}
              </button>
            </div>
          </div>
        )}
        {uploadState?.error && !uploading && (
          <p className="text-xs font-semibold text-red-600">Upload failed: {uploadState.error}. Select the file to retry.</p>
        )}
        <p className="text-[0.7rem] text-slate-400">
          {accept.replace(/\./g, "").replace(/,/g, ", ").toUpperCase()}
        </p>
        <input ref={inputRef} type="file" id={`upload-${docId}`} name={`upload-${docId}`} multiple accept={accept} onChange={handleInput} className="hidden" />
      </div>

      {hasFiles && (
        <div className="px-4 pb-4 pt-2 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <FileChip key={f._id || i} file={{ ...f, name: f.originalName || f.name }} extraction={extractions[f._id]} onRemove={() => removeFile(f)} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Category Card ──────────────────────────────────────────────────────────── */
function CategoryCard({ cat, files, extractions, onUpload, onRemove }) {
  const total    = cat.docs.length;
  const uploaded = cat.docs.filter((d) => (files[d.id] || []).length > 0).length;
  const pct      = total > 0 ? Math.round((uploaded / total) * 100) : 0;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className={`px-6 py-4 border-b border-slate-100 flex items-center gap-4`}>
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border ${cat.color.bg} ${cat.color.text} ${cat.color.border}`}>
          <cat.icon />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-base font-bold text-slate-800">{cat.label}</h3>
            <span className={`text-xs font-extrabold ${uploaded === total ? "text-emerald-600" : cat.color.text}`}>
              {uploaded}/{total} uploaded
            </span>
          </div>
          <div className="mt-1.5 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${uploaded === total ? "bg-emerald-500" : cat.color.dot}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>

      <div className="p-4 grid grid-cols-1 gap-3">
        {cat.docs.map((doc) => (
          <UploadZone
            key={doc.id}
            docId={doc.id}
            category={cat.id}
            label={doc.label}
            description={doc.description}
            required={doc.required}
            accept={doc.accept}
            color={cat.color}
            files={files[doc.id] || []}
            extractions={extractions}
            onUpload={onUpload}
            onRemove={onRemove}
          />
        ))}
      </div>
    </div>
  );
}

// items: flat list shaped like documentChecklist entries (documentType/name,
// description, required, category). Renders the same category-card grid used
// on the Documents page against whatever item source the caller provides.
export default function DocumentChecklist({ items = [], files = {}, extractions = {}, onUpload, onRemove, emptyMessage }) {
  const categories = buildCaseCategories(items);
  if (!categories.length) {
    return emptyMessage ? <p className="text-sm text-slate-500">{emptyMessage}</p> : null;
  }
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      {categories.map((cat) => (
        <CategoryCard key={cat.id} cat={cat} files={files} extractions={extractions} onUpload={onUpload} onRemove={onRemove} />
      ))}
    </div>
  );
}

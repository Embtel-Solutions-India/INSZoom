import { STATUS_META, STATUS } from "../../utils/checklistStatus";

const TYPE_TAG = {
  field: { label: "Field", className: "bg-slate-100 text-slate-500" },
  document: { label: "Document", className: "bg-blue-50 text-blue-600" },
};

function FieldTypeIcon({ className = "h-4 w-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 6h16M4 12h10M4 18h7" />
    </svg>
  );
}

function DocumentTypeIcon({ className = "h-4 w-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
}

// The one row anatomy every checklist item (field or document) uses: leading
// type icon, label, a small type tag, a required/optional indicator, helper
// text, and a status chip on the right — then the actual control underneath.
// Reused by both the reusable-document items and the questionnaire's field +
// conditional-document items on the Documents page's single-page Checklist.
export default function ChecklistItemRow({ id, type = "field", label, required = false, help, status = STATUS.NOT_STARTED, statusReason, savingLabel, children }) {
  const meta = STATUS_META[status] || STATUS_META[STATUS.NOT_STARTED];
  const StatusIcon = meta.icon;
  const tag = TYPE_TAG[type] || TYPE_TAG.field;
  const TypeIcon = type === "document" ? DocumentTypeIcon : FieldTypeIcon;
  const controlId = id ? `${id}-control` : undefined;

  return (
    <div id={id} className="scroll-mt-28 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${type === "document" ? "bg-blue-50 text-blue-500" : "bg-slate-100 text-slate-500"}`}>
            <TypeIcon />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={controlId} className="text-sm font-semibold text-slate-900">
                {label}
                {required && <span className="ml-1 text-rose-500" aria-hidden="true">*</span>}
              </label>
              <span className={`rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide ${tag.className}`}>{tag.label}</span>
              <span className={`text-[0.65rem] font-bold uppercase tracking-wide ${required ? "text-rose-500" : "text-slate-400"}`}>
                {required ? "Required" : "Optional"}
              </span>
            </div>
            {help && <p className="mt-1 text-xs leading-5 text-slate-500">{help}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-start">
          {savingLabel && <span className="text-[0.7rem] font-bold text-emerald-600">{savingLabel}</span>}
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.7rem] font-bold ${meta.className}`}>
            <StatusIcon />
            {meta.label}
          </span>
        </div>
      </div>

      {statusReason && status === STATUS.NEEDS_ATTENTION && (
        <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{statusReason}</p>
      )}

      <div className="mt-3" id={controlId}>{children}</div>
    </div>
  );
}

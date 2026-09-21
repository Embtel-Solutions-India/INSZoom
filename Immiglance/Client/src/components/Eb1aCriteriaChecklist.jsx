import { useEffect, useState } from "react";
import { casesApi } from "../services/api";
import useDocumentChecklist from "../hooks/useDocumentChecklist";
import ChecklistItemRow from "./checklist/ChecklistItemRow";
import DocumentUploadControl from "./checklist/DocumentUploadControl";

// EB-1A is a "satisfy at least 3 of 10 criteria" classification, not a flat
// document list — this renders the criterion-grouped view GET
// /:id/eb1a-criteria returns, instead of the generic category-grouped
// <DocumentChecklist>. Read-only w.r.t. criterion status: only a Case
// Manager (via the internal CRM's own version of this view) can mark a
// criterion Qualified/Not Applicable/Comparable Evidence — a client can only
// ever reach EVIDENCE_UPLOADED by uploading, matching the business's
// explicit "don't auto-qualify on upload count" requirement.
const INTRO_COPY =
  "To demonstrate eligibility under the EB-1A extraordinary ability classification, the beneficiary should provide evidence satisfying at least 3 of the 10 listed evidentiary criteria, unless comparable evidence is appropriate where a criterion does not readily apply.";

const STATUS_LABEL = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  EVIDENCE_UPLOADED: "Evidence uploaded",
  READY_FOR_REVIEW: "Ready for review",
  QUALIFIED: "Qualified",
  NOT_APPLICABLE: "Not applicable",
  COMPARABLE_EVIDENCE_REVIEW: "Comparable evidence — under review",
  COMPARABLE_EVIDENCE_ACCEPTED: "Comparable evidence — accepted",
  COMPARABLE_EVIDENCE_REJECTED: "Comparable evidence — not accepted",
  REVIEW_REQUIRED: "Review required",
};

const STATUS_CLASS = {
  QUALIFIED: "border-primary/30 bg-primary/10 text-primary",
  COMPARABLE_EVIDENCE_ACCEPTED: "border-primary/30 bg-primary/10 text-primary",
  NOT_APPLICABLE: "border-border bg-secondary text-muted-foreground",
  EVIDENCE_UPLOADED: "border-accent-foreground/20 bg-accent text-accent-foreground",
  COMPARABLE_EVIDENCE_REVIEW: "border-accent-foreground/20 bg-accent text-accent-foreground",
  REVIEW_REQUIRED: "border-accent-foreground/20 bg-accent text-accent-foreground",
};

function StatusBadge({ status }) {
  const className = STATUS_CLASS[status] || "border-border bg-secondary text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.7rem] font-bold ${className}`}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

function CriterionCard({ criterion, files, onUpload, onRemove }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Criterion {criterion.criterionNumber}</p>
          <p className="truncate text-sm font-semibold text-foreground">{criterion.criterionTitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-xs font-medium text-muted-foreground">{criterion.uploadedDocumentsCount} document{criterion.uploadedDocumentsCount === 1 ? "" : "s"}</span>
          <StatusBadge status={criterion.completionStatus} />
          <svg className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="space-y-3 border-t border-border p-4">
          <p className="text-sm text-muted-foreground">{criterion.criterionDescription}</p>

          {criterion.fieldSpecific && (
            <p className="rounded-lg border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
              This criterion applies to specific fields (e.g. performing/visual arts). If it doesn't apply to you, let your case team know — they can mark it Not Applicable or Comparable Evidence.
            </p>
          )}

          {criterion.applicability === "not_applicable" ? (
            <p className="rounded-lg border border-border bg-secondary px-3 py-2 text-xs font-medium text-muted-foreground">
              Marked not applicable by your case team{criterion.notes ? `: ${criterion.notes}` : "."}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {criterion.evidenceRequirements.map((item) => (
                <ChecklistItemRow key={item.documentType} type="document" label={item.name} help={item.description} required={false} status="not_started">
                  <DocumentUploadControl
                    docId={item.documentType}
                    category="evidence"
                    files={files[item.documentType] || []}
                    onUpload={onUpload}
                    onRemove={onRemove}
                  />
                </ChecklistItemRow>
              ))}
            </div>
          )}

          {criterion.comparableEvidenceDescription && (
            <p className="rounded-lg border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Comparable evidence: </span>{criterion.comparableEvidenceDescription}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function Eb1aCriteriaChecklist({ caseId }) {
  const [view, setView] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { files, handleUpload, handleRemove } = useDocumentChecklist({ caseId });

  const load = () => {
    if (!caseId) return;
    setLoading(true);
    setError("");
    casesApi.getEb1aCriteria(caseId)
      .then((data) => setView(data))
      .catch((err) => setError(err.message || "Unable to load your EB-1A checklist."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [caseId]);

  const onUpload = async (file, category, docId) => {
    await handleUpload(file, category, docId);
    load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-dashed border-border bg-card p-8">
        <div className="h-8 w-8 rounded-full border-4 border-secondary border-t-primary animate-spin" aria-label="Loading your EB-1A checklist" />
      </div>
    );
  }

  if (error || !view) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-8 text-center text-sm text-destructive">
        <p className="font-semibold">We couldn't load your EB-1A checklist.</p>
        {error && <p className="mt-1">{error}</p>}
        <button type="button" onClick={load} className="mt-3 rounded-lg border border-destructive/30 bg-card px-4 py-2 text-sm font-semibold text-destructive transition hover:bg-destructive/10">
          Try again
        </button>
      </div>
    );
  }

  const bannerLabel = view.minimumThresholdReached
    ? "Minimum threshold reached"
    : "Below minimum threshold";

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-serif text-lg font-bold text-foreground sm:text-xl">EB-1A Extraordinary Ability Evidence</h1>
        <p className="mt-1 text-sm text-muted-foreground">{INTRO_COPY}</p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{view.qualifyingCriteriaCount} / {view.totalCriteria} Criteria Qualified</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Minimum threshold: {view.minimumCriteria} criteria</p>
        </div>
        <span className={`rounded-full border px-3 py-1.5 text-xs font-bold ${view.minimumThresholdReached ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-secondary text-muted-foreground"}`}>
          {bannerLabel}
        </span>
      </div>

      {view.minimumThresholdReached && (
        <p className="rounded-lg border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
          Minimum evidence criterion threshold reached. Final eligibility remains subject to case review — you can keep adding evidence for the remaining criteria at any time.
        </p>
      )}

      <div className="space-y-3">
        {view.criteria.map((criterion) => (
          <CriterionCard key={criterion.criterionId} criterion={criterion} files={files} onUpload={onUpload} onRemove={handleRemove} />
        ))}
      </div>
    </div>
  );
}

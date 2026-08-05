import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { documentIntelligenceApi } from "../../services/api";

const STAFF_ROLES = ["super_admin", "admin", "team_lead", "case_manager"];
const PENDING_STATUSES = ["needs_review", "manual_review", "pending_review"];

function unwrap(response) {
  return response?.data ?? response;
}

function confidencePill(confidence) {
  const value = Math.round(Number(confidence) || 0);
  const tone = value >= 80 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : value >= 55 ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-rose-50 text-rose-700 border-rose-200";
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${tone}`}>{value}%</span>;
}

function FieldRow({ extraction, field, onDone }) {
  const [value, setValue] = useState(field.editedValue ?? field.value ?? "");
  const [busy, setBusy] = useState(false);
  const conflictIssue = (field.validationIssues || []).find((issue) => issue.type?.includes("conflict"));

  const act = async (action) => {
    setBusy(true);
    try {
      if (action === "approve") await documentIntelligenceApi.approveExtraction(extraction._id, { key: field.key });
      else if (action === "reject") await documentIntelligenceApi.rejectExtraction(extraction._id, { key: field.key });
      else if (action === "edit") await documentIntelligenceApi.editField(extraction._id, { key: field.key, value });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-black text-slate-900">{field.label || field.key}</p>
        {confidencePill(field.confidenceScore ?? field.confidence)}
      </div>
      {conflictIssue && (
        <p className="mt-1 text-xs font-bold text-amber-700">
          Conflicts with saved value: {String(conflictIssue.existingValue ?? "")}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          className="min-w-[200px] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm"
          value={typeof value === "object" ? JSON.stringify(value) : String(value ?? "")}
          onChange={(event) => setValue(event.target.value)}
          disabled={busy}
        />
        <button type="button" disabled={busy} onClick={() => act("edit")} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-100">Save Edit</button>
        <button type="button" disabled={busy} onClick={() => act("approve")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-black text-white hover:bg-emerald-700">Approve</button>
        <button type="button" disabled={busy} onClick={() => act("reject")} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-black text-rose-700 hover:bg-rose-50">Reject</button>
      </div>
    </div>
  );
}

function ExtractionCard({ extraction, onDone }) {
  const pendingFields = (extraction.extractedData || []).filter((field) => PENDING_STATUSES.includes(field.reviewStatus));
  if (!pendingFields.length) return null;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div>
          <h3 className="text-base font-black text-slate-900">{extraction.documentType || "Document"}</h3>
          <p className="text-xs text-slate-500">Case: {extraction.caseId?.caseNumber || extraction.caseId?._id || extraction.caseId || "—"}</p>
        </div>
        {confidencePill(extraction.confidence)}
      </div>
      <div className="space-y-3">
        {pendingFields.map((field) => (
          <FieldRow key={field._id || field.key} extraction={extraction} field={field} onDone={onDone} />
        ))}
      </div>
    </section>
  );
}

export default function DocumentReview() {
  const { user } = useAuth();
  const [extractions, setExtractions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const response = await documentIntelligenceApi.reviewQueue();
      const data = unwrap(response);
      setExtractions(data?.extractions || data?.items || []);
    } catch (error) {
      setMessage(error?.response?.data?.message || error.message || "Unable to load review queue.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    document.title = "Document Review | BAIS Portal";
    load();
  }, []);

  if (!STAFF_ROLES.includes(user?.role)) return <Navigate to="/dashboard" replace />;

  const withPending = extractions.filter((extraction) => (extraction.extractedData || []).some((field) => PENDING_STATUSES.includes(field.reviewStatus)));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-slate-900">Document Review Queue</h1>
        <p className="mt-1 text-sm text-slate-500">
          Fields extracted from uploaded documents across every document type and visa type, awaiting confirmation before they're written into a case or questionnaire.
        </p>
      </div>

      {message && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">{message}</div>}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : withPending.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm font-bold text-slate-600">Nothing pending review right now.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {withPending.map((extraction) => (
            <ExtractionCard key={extraction._id} extraction={extraction} onDone={load} />
          ))}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { singlePartyFilingsApi } from "../../services/api";

// Single-party individual filings — Change of Status / Extension / Work
// Authorization / Reinstatement. Third structural pattern alongside the
// employer/employee (employment-workflow) and petitioner/beneficiary
// (family-workflow) two-party paths: exactly ONE checklist, filled by the
// applicant themselves. No invite, no second-party account.
//
// PHASE 2 ARCHITECTURE CHANGE: selecting a filing type no longer creates a
// case directly — it routes the client to book a consultation. Case
// creation is now an explicit staff action.

const CATEGORY_LABELS = {
  change_of_status: "Change of Status",
  extension: "Extension",
  ead: "Work Authorization (EAD)",
  reinstatement: "Reinstatement",
};

// A small curated set for the "current status" side of the picker — a
// transition filing type's own fromStatus (when it has one) still takes
// precedence server-side; "Other" just means "let the server pick the best
// available generic match" (resolveTransitionFilingType falls back to
// COS_GENERIC when nothing more specific matches).
const CURRENT_STATUS_OPTIONS = ["F-1", "H-1B", "B-2", "H-4", "Other / Not Sure"];
const DESIRED_STATUS_OPTIONS = ["F-1", "F-2", "B-2", "Other / General Change of Status"];

function FilingOptionCard({ label, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-xl border border-slate-200 bg-white p-3.5 text-left transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="text-sm font-semibold text-slate-900">{label}</span>
    </button>
  );
}

export default function FilingTypeSelection() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [grouped, setGrouped] = useState({ transitions: [], standalone: [], byCategory: {} });
  const [fromStatus, setFromStatus] = useState(CURRENT_STATUS_OPTIONS[0]);
  const [toStatus, setToStatus] = useState(DESIRED_STATUS_OPTIONS[0]);

  useEffect(() => {
    singlePartyFilingsApi
      .types()
      .then((response) => setGrouped(response.data))
      .catch((err) => setError(err.response?.data?.message || err.message || "Failed to load filing types"))
      .finally(() => setLoading(false));
  }, []);

  const startFiling = () => {
    // PHASE 2 ARCHITECTURE CHANGE: Filing type selection no longer creates a case.
    // The user is redirected to book a consultation. Case creation is a staff action.
    navigate("/consultation/book");
  };

  const standaloneByCategory = (grouped.standalone || []).reduce((acc, entry) => {
    acc[entry.category] = acc[entry.category] || [];
    acc[entry.category].push(entry);
    return acc;
  }, {});

  if (loading) return <div className="p-6 text-sm text-slate-500">Loading filing types…</div>;
  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-100">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Filing type</p>
          <h1 className="text-xl font-bold text-slate-900 mt-1">Change of status, extension, or EAD</h1>
          <p className="mt-1 text-sm text-slate-500">
            Pick the filing that matches your situation, then book a consultation to get started.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-6 p-6">

      {(grouped.transitions || []).length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-bold text-slate-900">{CATEGORY_LABELS.change_of_status}</h2>
          <p className="mt-1 text-xs text-slate-500">Tell us your current status and the status you want — we'll match you to the right checklist.</p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold text-slate-500">
              Current status
              <select
                value={fromStatus}
                onChange={(e) => setFromStatus(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800"
              >
                {CURRENT_STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-500">
              Desired status
              <select
                value={toStatus}
                onChange={(e) => setToStatus(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800"
              >
                {DESIRED_STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            onClick={() => startFiling({
              fromStatus: fromStatus.startsWith("Other") ? "" : fromStatus,
              toStatus: toStatus.startsWith("Other") ? "" : toStatus,
            })}
            className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-60"
          >
            Start This Filing
          </button>
        </section>
      )}

      {Object.entries(standaloneByCategory).map(([category, entries]) => (
        <section key={category} className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-bold text-slate-900">{CATEGORY_LABELS[category] || category}</h2>
          <div className="mt-3 space-y-2">
            {entries.map((entry) => (
              <FilingOptionCard
                key={entry.key}
                label={entry.label}
                onClick={() => startFiling({ filingTypeKey: entry.key })}
              />
            ))}
          </div>
        </section>
      ))}

      </div>
    </div>
  );
}

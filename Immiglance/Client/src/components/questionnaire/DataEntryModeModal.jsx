import { useState } from "react";
import { casesApi } from "../../services/api";

// INVARIANT 6: only rendered by the caller when caseStructure is
// employer_employee/family AND dataEntryMode === 'not_set' — see
// Documents.jsx. The choice is permanent from the client's side; only staff
// can reset it (PATCH .../data-entry-mode with { reset: true }).
export default function DataEntryModeModal({ principalCaseId, isFamily, onModeSelected }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const participantLabel = isFamily ? "beneficiary" : "employees";
  const participantSingular = isFamily ? "beneficiary" : "employee";

  const handleSelect = async (mode) => {
    setLoading(true);
    setError("");
    try {
      const res = await casesApi.setDataEntryMode(principalCaseId, mode);
      if (res?.success) {
        onModeSelected(mode);
      } else {
        setError(res?.message || "Failed to set data entry mode");
      }
    } catch (err) {
      setError(err.message || "Failed to set data entry mode");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-7">
        <h2 className="text-lg font-bold text-slate-900 mb-2">
          How would you like to provide {participantLabel} information?
        </h2>
        <p className="text-sm text-slate-500 mb-6">
          This choice cannot be changed after you select it. Contact your case manager if you need to switch later.
        </p>

        <div className="space-y-3">
          <button
            type="button"
            disabled={loading}
            onClick={() => handleSelect("fill_self")}
            className="w-full text-left rounded-xl border border-slate-200 hover:border-slate-400 hover:bg-slate-50 px-5 py-4 transition disabled:opacity-50"
          >
            <p className="text-sm font-bold text-slate-900">I will fill it in myself</p>
            <p className="text-xs text-slate-500 mt-1">
              You'll complete each {participantSingular}'s information directly in this portal, one tab per {participantSingular}.
            </p>
          </button>

          <button
            type="button"
            disabled={loading}
            onClick={() => handleSelect("invite")}
            className="w-full text-left rounded-xl border border-slate-200 hover:border-slate-400 hover:bg-slate-50 px-5 py-4 transition disabled:opacity-50"
          >
            <p className="text-sm font-bold text-slate-900">
              Invite {isFamily ? "the beneficiary" : "each employee"} to fill their own information
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Each {participantSingular} gets their own secure email link to complete their own questionnaire independently. You won't see their answers.
            </p>
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

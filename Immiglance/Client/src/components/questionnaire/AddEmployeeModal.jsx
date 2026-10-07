import { useEffect, useMemo, useState } from "react";
import { casesApi } from "../../services/api";

// "Add employee" - the visa (and filing type, e.g. H-1B Extension) is asked FIRST: each employee of one employer can be
// on a different visa, and their forms and checklists follow it. Then how their information is entered: the employer
// fills it in, or the employee is invited (changeable later from the employee's card).
export default function AddEmployeeModal({ principalId, defaultVisaType, onClose, onAdded }) {
  const [options, setOptions] = useState([]);
  const [visaType, setVisaType] = useState(defaultVisaType || "");
  const [petitionSubType, setPetitionSubType] = useState("");
  const [mode, setMode] = useState("fill_self");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    casesApi.employeeVisaOptions()
      .then((res) => setOptions(res?.data || []))
      .catch(() => setError("Could not load the visa list. Please close and try again."));
  }, []);

  const selected = useMemo(() => options.find((option) => option.visaType === visaType), [options, visaType]);
  const subTypes = selected?.subTypes || [];

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (!visaType) { setError("Choose the employee's visa first."); return; }
    if (subTypes.length && !petitionSubType) { setError(`Choose the ${visaType} filing type.`); return; }
    if (mode === "invite" && (!name.trim() || !email.trim())) { setError("Enter the employee's name and email to send the invitation."); return; }
    setBusy(true);
    let childCaseId = null;
    try {
      const added = await casesApi.addEmployeeSlot(principalId, { visaType, ...(subTypes.length ? { petitionSubType } : {}) });
      childCaseId = added?.childCaseId;
      await casesApi.setEmployeeDataEntryMode(principalId, childCaseId, mode === "invite"
        ? { mode: "invite", employeeName: name.trim(), employeeEmail: email.trim() }
        : { mode: "fill_self" });
      onAdded();
    } catch (err) {
      if (childCaseId) {
        // The employee was added; only the invitation failed. Say so, and let them retry from the card.
        onAdded(`Employee added on ${visaType}, but the invitation was not sent: ${err.message || "please try again"} Use "Invite this employee" on their card to retry.`);
      } else {
        setError(err.message || "The employee could not be added.");
      }
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">Add employee</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">✕</button>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">Visa *</label>
          <select className={field} value={visaType} onChange={(e) => { setVisaType(e.target.value); setPetitionSubType(""); }} disabled={busy}>
            <option value="" disabled>Select the employee's visa</option>
            {options.map((option) => <option key={option.visaType} value={option.visaType}>{option.label}</option>)}
          </select>
        </div>

        {subTypes.length > 0 && (
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">{visaType} type *</label>
            <select className={field} value={petitionSubType} onChange={(e) => setPetitionSubType(e.target.value)} disabled={busy}>
              <option value="" disabled>Select type (new, extension, transfer...)</option>
              {subTypes.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </div>
        )}

        <fieldset className="space-y-2" disabled={busy}>
          <legend className="mb-1 text-xs font-semibold text-slate-500">Who fills in their information?</legend>
          <label className="flex items-center gap-2 text-sm text-slate-800"><input type="radio" checked={mode === "fill_self"} onChange={() => setMode("fill_self")} /> I'll fill it in myself</label>
          <label className="flex items-center gap-2 text-sm text-slate-800"><input type="radio" checked={mode === "invite"} onChange={() => setMode("invite")} /> Invite the employee to fill it in</label>
        </fieldset>

        {mode === "invite" && (
          <div className="space-y-2">
            <input className={field} placeholder="Employee full name" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
            <input type="email" className={field} placeholder="Employee email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
          </div>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">Cancel</button>
          <button type="submit" disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-50">{busy ? "Adding…" : "Add employee"}</button>
        </div>
      </form>
    </div>
  );
}

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

// Full-screen choice popup shown once the employer's own checklist is
// complete: "I'll fill it myself" (unlocks the employee section inline,
// banded, right here on Documents) vs. "Invite the employee" (a small
// popup form — name/email/phone — that calls the existing
// employmentWorkflowApi.inviteEmployee, which already emails the invite).
export default function EmployeeHandoffModal({ open, onClose, onChooseFillMyself, onInvite, message, initialForm }) {
  const [step, setStep] = useState("choice"); // "choice" | "invite" | "sent"
  const [form, setForm] = useState(initialForm || { name: "", email: "", phone: "" });
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  if (!open) return null;

  const handleSend = async () => {
    if (!form.name || !form.email || !form.phone) {
      setError("Name, email, and phone are all required to send the invitation.");
      return;
    }
    setError("");
    setSending(true);
    try {
      await onInvite(form);
      setStep("sent");
    } catch (err) {
      setError(err.message || "Unable to send the invitation. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="w-full max-w-lg rounded-2xl bg-white p-7 shadow-xl"
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          {step === "choice" && (
            <>
              <h2 className="text-lg font-bold text-slate-900">Who will complete the employee's part?</h2>
              <p className="mt-1 text-sm text-slate-500">Your checklist is complete. Choose how the employee's section gets filled in.</p>
              <div className="mt-5 space-y-3">
                <button
                  type="button"
                  onClick={() => setStep("invite")}
                  className="w-full rounded-xl border border-slate-200 p-4 text-left transition hover:border-slate-300 hover:bg-slate-50"
                >
                  <p className="text-sm font-bold text-slate-900">
                    Invite the employee <span className="ml-1 rounded-full bg-slate-900 px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-wide text-white">Recommended</span>
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Send a secure invitation so the employee creates their own account and completes their own section.</p>
                </button>
                <button
                  type="button"
                  onClick={() => { onChooseFillMyself(); onClose(); }}
                  className="w-full rounded-xl border border-slate-200 p-4 text-left transition hover:border-slate-300 hover:bg-slate-50"
                >
                  <p className="text-sm font-bold text-slate-900">I'll fill it myself</p>
                  <p className="mt-1 text-xs text-slate-500">Fill in the employee's section and upload their documents yourself, right here.</p>
                </button>
              </div>
            </>
          )}

          {step === "invite" && (
            <>
              <h2 className="text-lg font-bold text-slate-900">Invite the employee</h2>
              <p className="mt-1 text-sm text-slate-500">They'll get a secure email link to create their own account.</p>
              <div className="mt-5 space-y-3">
                <input
                  placeholder="Employee name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
                />
                <input
                  type="email"
                  placeholder="Employee email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
                />
                <input
                  placeholder="Employee phone"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
                />
              </div>
              {error && <p className="mt-3 text-xs font-semibold text-rose-600">{error}</p>}
              <div className="mt-5 flex items-center justify-between">
                <button type="button" onClick={() => setStep("choice")} className="text-xs font-semibold text-slate-500 hover:text-slate-700">
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={sending}
                  className="rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {sending ? "Sending…" : "Add employee"}
                </button>
              </div>
            </>
          )}

          {step === "sent" && (
            <>
              <h2 className="text-lg font-bold text-slate-900">Invitation sent</h2>
              <p className="mt-1.5 text-sm text-slate-600">{message || "The employee will get an email to set up their own account and complete their section."}</p>
              <button type="button" onClick={onClose} className="mt-5 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-700">
                Done
              </button>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import useHasCase from "../../hooks/useHasCase";
import { leadsApi } from "../../services/api";
import { PRICE_MATRIX } from "../../config/pricingCatalog";
import SignaturePad from "../../components/SignaturePad";
import ThemeToggle from "../../components/ThemeToggle";

// All canonical visa codes this app already prices (Work/Family/Student/
// Temporary/Business/Green Card) — the one place PlanSelection.jsx also
// reads from. Never maintain a second, divergent visa-name list.
const VISA_OPTIONS = Object.keys(PRICE_MATRIX);

const SALUTATIONS = ["Mr.", "Ms.", "Mrs.", "Dr.", "Prof."];

function splitName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { firstName: parts[0] || "", lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function Field({ label, required, help, children }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-foreground mb-1">
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      {help && <p className="text-xs text-muted-foreground mb-1.5">{help}</p>}
      {children}
    </div>
  );
}

const inputClass =
  "w-full h-11 px-3.5 rounded-lg border border-input bg-card text-sm text-foreground outline-none " +
  "hover:border-ring/50 focus:border-ring focus:ring-2 focus:ring-ring/15 transition";

// Pre-case-creation only: a short background-info form, a review + signed
// declaration, then straight to consultation booking. Submits exactly the
// same Lead-only endpoint the previous long branching wizard used
// (POST /api/leads/from-intake — never creates a Case; a staff member
// converts the Lead later) so the rest of the funnel (booking, admin lead
// review) is unchanged.
function ShortIntakeForm() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { loading: hasCaseLoading, isError: hasCaseError } = useHasCase();
  const { firstName: defaultFirst, lastName: defaultLast } = splitName(user?.name || user?.displayName);

  const [step, setStep] = useState("details"); // "details" | "review"
  const [form, setForm] = useState({
    salutation: "",
    firstName: defaultFirst,
    lastName: defaultLast,
    countryOfBirth: "",
    countryOfCitizenship: "",
    location: "",
    phone: user?.phone || "",
    visaType: "",
  });
  const [signedName, setSignedName] = useState("");
  const [signatureDataUrl, setSignatureDataUrl] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    document.title = "Immigration Intake | Immiglance";
  }, []);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const detailsComplete = Boolean(
    form.salutation && form.firstName.trim() && form.lastName.trim() && form.countryOfBirth.trim() &&
    form.countryOfCitizenship.trim() && form.location && form.phone.trim() && form.visaType
  );
  const canSubmit = detailsComplete && signedName.trim() && signatureDataUrl;

  const submitEvaluation = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await leadsApi.createLeadFromIntake({
        visaInterest: form.visaType,
        intakeAnswers: {
          salutation: form.salutation,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          countryOfBirth: form.countryOfBirth.trim(),
          countryOfCitizenship: form.countryOfCitizenship.trim(),
          location: form.location,
          phone: form.phone.trim(),
          visaType: form.visaType,
          declaration: {
            signedName: signedName.trim(),
            signatureDataUrl,
            signedAt: new Date().toISOString(),
          },
        },
      });
      // api.js is a fetch wrapper (see services/api.js's request()) — res is
      // the parsed JSON body directly, not an axios-style { data } envelope.
      if (res?.success && res?.leadId) {
        // BookConsultation.jsx (Landing) normally prefills Full name/Email/
        // Phone from router navigation state.contact — but this navigate()
        // crosses from Client's origin to Landing's via CrossAppRedirect's
        // hard window.location.replace(), which drops React Router state
        // entirely. Query params survive that hard redirect (CrossAppRedirect
        // forwards pathname+search+hash verbatim), so the contact fields are
        // passed that way instead; BookConsultation.jsx reads them as a
        // fallback alongside its existing state.contact prefill.
        const contactParams = new URLSearchParams({
          leadId: res.leadId,
          fullName: `${form.firstName} ${form.lastName}`.trim(),
          email: user?.email || "",
          phone: form.phone.trim(),
        });
        navigate(`/consultation/book?${contactParams.toString()}`);
        return;
      }
      setSubmitError("Unable to submit your case evaluation. Please try again.");
    } catch (err) {
      setSubmitError(err?.message || "Unable to submit your case evaluation. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // Redirect logic (employee / already-cased client) lives entirely in
  // AuthGate — this page renders only once it's confirmed the user is a
  // non-employee client with no case; render nothing while that's still
  // resolving instead of flashing the form.
  if (hasCaseLoading && user) return null;

  if (submitting) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <div className="w-10 h-10 rounded-full border-4 border-secondary border-t-primary animate-spin" />
        <p className="text-sm text-muted-foreground font-medium">Submitting your case evaluation…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border">
        <div className="mx-auto max-w-2xl px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary-foreground">
                <path d="M17 7l-10 10M7 7h10v10" />
              </svg>
            </div>
            <span className="text-sm font-bold text-foreground">Immiglance</span>
          </div>
          <ThemeToggle />
        </div>
        <div className="h-1 bg-secondary">
          <div
            className="h-full bg-primary transition-all duration-500 ease-out"
            style={{ width: step === "details" ? "50%" : "100%" }}
          />
        </div>
      </header>

      {hasCaseError && (
        <div className="bg-accent border-b border-accent-foreground/20 px-6 py-2.5 text-center">
          <p className="text-sm font-semibold text-accent-foreground">
            We couldn't confirm whether you already have a case in progress. If you do, please check your Dashboard before starting a new one.
          </p>
        </div>
      )}

      {submitError && (
        <div className="bg-destructive/10 border-b border-destructive/20 px-6 py-2.5 text-center">
          <p className="text-sm font-semibold text-destructive">{submitError}</p>
        </div>
      )}

      <main className="flex-1 px-6 py-10">
        <div className="mx-auto max-w-2xl">
          {form.visaType && (
            <span className="inline-block mb-4 rounded-full bg-secondary px-2.5 py-1 text-xs font-bold text-foreground">
              {form.visaType}
            </span>
          )}

          {step === "details" ? (
            <>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground leading-snug mb-2">Background Information</h1>
              <p className="text-sm text-muted-foreground mb-8">Basic details so our team can reach you and route your case evaluation correctly.</p>

              <div className="space-y-5">
                <Field label="Which visa are you inquiring about?" required>
                  <select value={form.visaType} onChange={set("visaType")} className={inputClass}>
                    <option value="">Select a visa type</option>
                    {VISA_OPTIONS.map((visa) => <option key={visa} value={visa}>{visa}</option>)}
                  </select>
                </Field>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <Field label="Salutation" required>
                    <select value={form.salutation} onChange={set("salutation")} className={inputClass}>
                      <option value="">Select an option</option>
                      {SALUTATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </Field>
                  <Field label="First name" required help="As shown on your passport or official documents.">
                    <input type="text" value={form.firstName} onChange={set("firstName")} className={inputClass} />
                  </Field>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <Field label="Last name" required help="As shown on your passport or official documents.">
                    <input type="text" value={form.lastName} onChange={set("lastName")} className={inputClass} />
                  </Field>
                  <Field label="Country of birth" required help="As shown on your birth certificate or passport.">
                    <input type="text" value={form.countryOfBirth} onChange={set("countryOfBirth")} className={inputClass} />
                  </Field>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <Field label="Country of citizenship" required>
                    <input type="text" value={form.countryOfCitizenship} onChange={set("countryOfCitizenship")} className={inputClass} />
                  </Field>
                  <Field label="Where are you currently located?" required>
                    <div className="flex flex-col gap-2 pt-1">
                      {[{ value: "inside", label: "Inside the United States" }, { value: "outside", label: "Outside the United States" }].map((option) => (
                        <label key={option.value} className="flex items-center gap-2.5 text-sm font-medium text-foreground cursor-pointer">
                          <input type="radio" name="location" value={option.value}
                            checked={form.location === option.value}
                            onChange={set("location")}
                            className="accent-primary w-4 h-4" />
                          {option.label}
                        </label>
                      ))}
                    </div>
                  </Field>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <Field label="Email address" required help="Used as your primary contact and Immiglance Portal login.">
                    <input type="email" value={user?.email || ""} disabled className={`${inputClass} opacity-70 cursor-not-allowed`} />
                  </Field>
                  <Field label="Phone number" required help="Include country code. Used only for record lookup if you call us.">
                    <input type="tel" value={form.phone} onChange={set("phone")} className={inputClass} />
                  </Field>
                </div>
              </div>

              <div className="mt-8 flex items-center justify-end">
                <button
                  type="button"
                  disabled={!detailsComplete}
                  onClick={() => setStep("review")}
                  className="h-11 px-6 rounded-lg bg-primary text-primary-foreground text-sm font-bold shadow-sm transition hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Continue
                </button>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground leading-snug mb-2">Review & submit</h1>
              <p className="text-sm text-muted-foreground mb-8">Please confirm your details below. Our team will begin reviewing your case evaluation as soon as you submit.</p>

              <div className="rounded-2xl border border-card-border bg-card overflow-hidden mb-6">
                {[
                  ["Category", form.visaType],
                  ["Name", `${form.firstName} ${form.lastName}`.trim()],
                  ["Email", user?.email || "—"],
                  ["Phone", form.phone],
                  ["Country of birth", form.countryOfBirth],
                  ["Country of citizenship", form.countryOfCitizenship],
                  ["Location", form.location === "inside" ? "Inside the United States" : "Outside the United States"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-4 px-5 py-3 border-b border-border last:border-b-0">
                    <span className="text-sm text-muted-foreground">{label}</span>
                    <span className="text-sm font-semibold text-foreground text-right">{value || "—"}</span>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-card-border bg-card p-5 mb-6">
                <div className="flex items-center gap-2 mb-1">
                  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="text-foreground"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  <h2 className="text-sm font-bold text-foreground">Sign your declaration</h2>
                </div>
                <p className="text-xs text-muted-foreground mb-4">
                  By typing your name and signing below, you confirm that the information provided in this questionnaire is true and accurate to the best of your knowledge.
                </p>

                <Field label="Type your full legal name">
                  <input
                    type="text"
                    value={signedName}
                    onChange={(e) => setSignedName(e.target.value)}
                    placeholder="e.g. Priya Nair"
                    className={`${inputClass} font-serif italic`}
                  />
                </Field>

                <div className="mt-4">
                  <SignaturePad onChange={setSignatureDataUrl} />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <button type="button" onClick={() => setStep("details")} className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground transition">
                  ← Back
                </button>
                <button
                  type="button"
                  disabled={!canSubmit}
                  onClick={submitEvaluation}
                  className="h-11 px-6 rounded-lg bg-primary text-primary-foreground text-sm font-bold shadow-sm transition hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Submit Case Evaluation
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// Intake is pre-case-creation only: background info, visa selection,
// signed declaration -> a Lead, then straight to consultation booking.
// Once a case exists, every checklist (client/employer/employee/
// business_plan) lives on the Documents page — not here.
export default function Intake() {
  return <ShortIntakeForm />;
}

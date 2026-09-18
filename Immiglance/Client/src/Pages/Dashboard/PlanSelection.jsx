import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { profileApi, casesApi } from "../../services/api";
import { useMyCase, useMyProfile } from "../../hooks/useMyCaseProfile";
import { PLANS } from "../../config/planConfig";
import { getAmountCents, formatCents } from "../../config/pricingCatalog";
import { IconArrowRight } from "../../utils/iconComponents";
import ApplicantTypeSelector from "../../components/ApplicantTypeSelector";
import SignaturePad from "../../components/SignaturePad";

const Ic = {
  Check: ({ className = "" }) => <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" className={className}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"/></svg>,
};

export default function PlanSelection() {
  const navigate      = useNavigate();
  const [selected, setSelected] = useState("");
  const [saving, setSaving]     = useState(false);
  // "plan" -> "sign": the plan is saved to the case before this component
  // ever shows the signing step, so signCaseId is always set by the time
  // the user reaches it.
  const [step, setStep]         = useState("plan");
  const [signCaseId, setSignCaseId] = useState(null);
  const [signedName, setSignedName] = useState("");
  const [signatureDataUrl, setSignatureDataUrl] = useState(null);
  const [signing, setSigning]   = useState(false);
  const [signError, setSignError] = useState("");

  // Pricing is per visa type — load the user's selected/recommended visa.
  const { data: profile } = useMyProfile();
  const { data: myCase } = useMyCase();
  const visaType = profile?.visaType || profile?.assessmentRecommendedVisa || myCase?.visaType || "";
  // Employment-based visa categories are commonly employer-sponsored — only
  // a suggestion, the client must still confirm via ApplicantTypeSelector.
  const visaCategory = profile?.visaCategory || myCase?.visaCategory || "";
  const suggestedApplicantType = visaCategory === "Work" ? "employer" : "individual";

  const priceLabel = (tier) => formatCents(getAmountCents(visaType, tier));

  const handleConfirm = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await profileApi.selectPlan(selected);
      let myCase = null;
      try {
        myCase = await casesApi.my();
      } catch {
        myCase = null;
      }
      if (myCase?._id) {
        await casesApi.updatePlan(myCase._id, {
          tier: selected,
          paymentStatus: "not_started",
          amount: getAmountCents(visaType, selected),
          currency: "USD",
        });
        setSignCaseId(myCase._id);
        setStep("sign");
      } else {
        navigate("/dashboard/payments");
      }
    } catch (error) {
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  const handleSignDeclaration = async () => {
    if (!signCaseId || !signedName.trim() || !signatureDataUrl || signing) return;
    setSigning(true);
    setSignError("");
    try {
      await casesApi.signDeclaration(signCaseId, { signedName: signedName.trim() });
      navigate("/dashboard/payments");
    } catch (error) {
      setSignError(error.message || "Unable to save your signature. Please try again.");
      setSigning(false);
    }
  };

  if (step === "sign") {
    const canSign = Boolean(signedName.trim() && signatureDataUrl);
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
            <p className="text-muted-foreground text-xs font-bold uppercase tracking-widest">Service plan</p>
            <h1 className="text-xl font-bold text-foreground mt-1">Sign your declaration</h1>
            <p className="text-muted-foreground text-sm mt-1">Confirm your plan selection by signing below.</p>
          </div>
        </header>

        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
          <div className="rounded-2xl border border-card-border bg-card p-6">
            <p className="text-xs text-muted-foreground mb-5">
              By typing your name and signing below, you confirm that your selected plan and the information
              provided in your case are true and accurate to the best of your knowledge.
            </p>

            <label className="block text-sm font-semibold text-foreground mb-1">Type your full legal name</label>
            <input
              type="text"
              value={signedName}
              onChange={(e) => setSignedName(e.target.value)}
              placeholder="e.g. Priya Nair"
              className="w-full h-11 px-3.5 mb-4 rounded-lg border border-input bg-background text-sm text-foreground
                font-serif italic outline-none hover:border-ring/50 focus:border-ring focus:ring-2 focus:ring-ring/15 transition"
            />

            <SignaturePad onChange={setSignatureDataUrl} />

            {signError && <p className="mt-4 text-sm font-semibold text-destructive">{signError}</p>}

            <div className="mt-6 flex items-center justify-between">
              <button type="button" onClick={() => setStep("plan")} className="text-sm font-semibold text-muted-foreground hover:text-foreground transition">
                ← Back
              </button>
              <button
                type="button"
                disabled={!canSign || signing}
                onClick={handleSignDeclaration}
                className="h-11 px-6 rounded-lg bg-primary text-primary-foreground text-sm font-bold shadow-sm transition hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {signing ? "Saving…" : "Confirm & Continue"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
          <p className="text-muted-foreground text-xs font-bold uppercase tracking-widest">Service plan</p>
          <h1 className="text-xl font-bold text-foreground mt-1">Choose your service plan</h1>
          <p className="text-muted-foreground text-sm mt-1">Select the level of support that fits your needs — you can upgrade later.</p>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <ApplicantTypeSelector suggested={suggestedApplicantType} />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {PLANS.map((plan) => (
            <button key={plan.id}
              onClick={() => setSelected(plan.id)}
              className={`relative bg-card rounded-2xl border text-left p-6 transition active:scale-[0.98] cursor-pointer
                ${selected === plan.id ? "border-primary shadow-sm" : "border-border hover:border-muted-foreground/40"}`}>

              {plan.recommended && (
                <span className="absolute -top-2.5 left-6 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
                  Recommended
                </span>
              )}

              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3">{plan.label}</p>
              <p className="font-bold text-base text-foreground mb-0.5">{plan.tagline}</p>
              <p className="mb-5">
                <span className="text-2xl font-bold text-foreground">{priceLabel(plan.id)}</span>
                {visaType && <span className="text-xs text-muted-foreground font-medium ml-1.5">· {visaType}</span>}
              </p>

              <ul className="space-y-2">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Ic.Check className="mt-0.5 text-muted-foreground shrink-0" />
                    <span className="text-sm text-muted-foreground leading-snug">{f}</span>
                  </li>
                ))}
              </ul>

              {selected === plan.id && (
                <div className="mt-5 text-xs font-bold text-primary flex items-center gap-1.5">
                  <Ic.Check /> Selected
                </div>
              )}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-card border border-border rounded-2xl p-5">
          <div>
            {selected
              ? <p className="font-bold text-foreground">Selected: <span className="text-foreground">{PLANS.find(p => p.id === selected)?.label}</span></p>
              : <p className="text-muted-foreground text-sm">Select a plan above to continue</p>}
            <p className="text-xs text-muted-foreground mt-0.5">You can change your plan later by contacting our team.</p>
          </div>
          <button onClick={handleConfirm} disabled={!selected || saving}
            className="flex items-center gap-2 px-8 py-3 bg-primary hover:opacity-90 text-primary-foreground font-bold
              text-sm rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed">
            {saving ? "Saving…" : <>{selected ? <>Continue with {PLANS.find(p => p.id === selected)?.label} <IconArrowRight size={16} className="text-primary-foreground" /></> : "Select a plan to continue"}</>}
          </button>
        </div>

        <p className="text-xs text-muted-foreground text-center">
          All plans include consultation access. Payment details will be discussed with your assigned case manager.
        </p>
      </div>
    </div>
  );
}

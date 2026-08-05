import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { profileApi, casesApi } from "../../services/api";
import { useMyCase, useMyProfile } from "../../hooks/useMyCaseProfile";
import { PLANS } from "../../config/planConfig";
import { getAmountCents, formatCents } from "../../config/pricingCatalog";
import { IconArrowRight } from "../../utils/iconComponents";
import ApplicantTypeSelector from "../../components/ApplicantTypeSelector";

const Ic = {
  Check: ({ className = "" }) => <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" className={className}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"/></svg>,
};

export default function PlanSelection() {
  const navigate      = useNavigate();
  const [selected, setSelected] = useState("");
  const [saving, setSaving]     = useState(false);

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
      }
      navigate("/dashboard/payments");
    } catch (error) {
      console.error(error);
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Service plan</p>
          <h1 className="text-xl font-bold text-slate-900 mt-1">Choose your service plan</h1>
          <p className="text-slate-500 text-sm mt-1">Select the level of support that fits your needs — you can upgrade later.</p>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <ApplicantTypeSelector suggested={suggestedApplicantType} />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {PLANS.map((plan) => (
            <button key={plan.id}
              onClick={() => setSelected(plan.id)}
              className={`relative bg-white rounded-2xl border text-left p-6 transition active:scale-[0.98] cursor-pointer
                ${selected === plan.id ? "border-slate-900 shadow-sm" : "border-slate-200 hover:border-slate-300"}`}>

              {plan.recommended && (
                <span className="absolute -top-2.5 left-6 rounded-full bg-slate-900 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  Recommended
                </span>
              )}

              <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">{plan.label}</p>
              <p className="font-bold text-base text-slate-900 mb-0.5">{plan.tagline}</p>
              <p className="mb-5">
                <span className="text-2xl font-bold text-slate-900">{priceLabel(plan.id)}</span>
                {visaType && <span className="text-xs text-slate-400 font-medium ml-1.5">· {visaType}</span>}
              </p>

              <ul className="space-y-2">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Ic.Check className="mt-0.5 text-slate-400 shrink-0" />
                    <span className="text-sm text-slate-600 leading-snug">{f}</span>
                  </li>
                ))}
              </ul>

              {selected === plan.id && (
                <div className="mt-5 text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <Ic.Check /> Selected
                </div>
              )}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white border border-slate-200 rounded-2xl p-5">
          <div>
            {selected
              ? <p className="font-bold text-slate-800">Selected: <span className="text-slate-900">{PLANS.find(p => p.id === selected)?.label}</span></p>
              : <p className="text-slate-500 text-sm">Select a plan above to continue</p>}
            <p className="text-xs text-slate-400 mt-0.5">You can change your plan later by contacting our team.</p>
          </div>
          <button onClick={handleConfirm} disabled={!selected || saving}
            className="flex items-center gap-2 px-8 py-3 bg-slate-900 hover:bg-slate-700 text-white font-bold
              text-sm rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed">
            {saving ? "Saving…" : <>{selected ? <>Continue with {PLANS.find(p => p.id === selected)?.label} <IconArrowRight size={16} className="text-white" /></> : "Select a plan to continue"}</>}
          </button>
        </div>

        <p className="text-xs text-slate-400 text-center">
          All plans include consultation access. Payment details will be discussed with your assigned case manager.
        </p>
      </div>
    </div>
  );
}

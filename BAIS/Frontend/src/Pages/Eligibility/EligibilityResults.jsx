import { useLocation, useNavigate, useParams } from "react-router-dom";
import EligibilityShell from "../../components/eligibility/EligibilityShell";

const TIER_META = {
  A: { label: "Tier A", color: "bg-emerald-500", ring: "ring-emerald-100", text: "text-emerald-700", bg: "bg-emerald-50" },
  B: { label: "Tier B", color: "bg-blue-500", ring: "ring-blue-100", text: "text-blue-700", bg: "bg-blue-50" },
  C: { label: "Tier C", color: "bg-amber-500", ring: "ring-amber-100", text: "text-amber-700", bg: "bg-amber-50" },
  D: { label: "Tier D", color: "bg-slate-400", ring: "ring-slate-100", text: "text-slate-600", bg: "bg-slate-50" },
};

const DIRECT_ROUTINGS = new Set(["direct_priority", "direct"]);

export default function EligibilityResults() {
  const { leadId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const result = location.state?.result;
  const contact = location.state?.contact;

  if (!result) {
    return (
      <EligibilityShell>
        <div className="max-w-lg mx-auto px-5 py-24 text-center">
          <p className="font-bold text-slate-800 mb-2">Your results aren't available here</p>
          <p className="text-sm text-slate-500 mb-6">
            For your privacy, results are only shown right after you complete the assessment. Please retake it to see your results again.
          </p>
          <button
            type="button"
            onClick={() => navigate("/eligibility")}
            className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-[#1D9E75] hover:bg-[#0F6E56] text-white font-bold text-sm transition cursor-pointer"
          >
            Retake the assessment
          </button>
        </div>
      </EligibilityShell>
    );
  }

  const meta = TIER_META[result.tier] || TIER_META.D;
  const isDirect = DIRECT_ROUTINGS.has(result.routing);

  return (
    <EligibilityShell>
      <div className="max-w-2xl mx-auto px-5 sm:px-6 py-14 sm:py-20">
        <div className={`rounded-2xl border ${meta.ring} ring-4 ${meta.bg} p-6 sm:p-8 mb-8 text-center`}>
          <span className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full ${meta.text} bg-white text-xs font-bold uppercase tracking-widest mb-4`}>
            <span className={`w-2 h-2 rounded-full ${meta.color}`} aria-hidden="true" />
            {meta.label}
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mb-2">{result.pathwayString}</h1>
          <p className="text-slate-500 text-sm">{result.nextStep}</p>
        </div>

        <div className="mb-8">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Your evidence strength</p>
          <div className="space-y-2.5">
            {(result.evidenceStrength || []).map((e) => (
              <div key={e.key} className="flex items-center gap-3">
                <span className="text-xs text-slate-500 w-40 shrink-0 truncate">{e.key.replace(/_/g, " ")}</span>
                <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${e.met ? "bg-emerald-500" : e.developable ? "bg-amber-400" : "bg-slate-300"}`}
                    style={{ width: `${((e.value ?? 0) / 3) * 100}%` }}
                  />
                </div>
                <span className="text-[0.68rem] text-slate-400 w-16 shrink-0">{e.label}</span>
              </div>
            ))}
          </div>
        </div>

        {result.alternativePathways?.length > 0 && (
          <div className="mb-10 rounded-2xl border border-slate-200 p-5 sm:p-6">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Pathways worth exploring</p>
            <div className="flex flex-wrap gap-2">
              {result.alternativePathways.map((p) => (
                <span key={p} className="px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">{p}</span>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => navigate(`/consultation/book/${leadId || result.leadId}`, { state: { contact } })}
          className="w-full inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl text-white font-bold text-base transition active:scale-95 cursor-pointer"
          style={{ backgroundColor: "var(--eligibility-accent, #C6A15B)" }}
        >
          {isDirect ? "Book your free consultation" : "Schedule a free strategy call"}
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </EligibilityShell>
  );
}

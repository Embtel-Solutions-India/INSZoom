import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { eligibilityQuizApi, telemetryApi } from "../../services/api";
import { getSessionId, captureUtmFromUrl } from "../../utils/eligibilitySession";
import EligibilityShell from "../../components/eligibility/EligibilityShell";
import QuizProgress from "../../components/eligibility/QuizProgress";
import { ELIGIBILITY_CATEGORIES } from "./eligibilityCategories";

// A visa's `label` is always "KEY — Description" (see quiz.config.js) — the
// short code before the dash is what we show as example-visa subtext under
// each category card.
function shortCode(visa) {
  return visa.label.split("—")[0].trim();
}

function PickerButton({ selected, onClick, children }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`text-left rounded-xl border px-4 py-3.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 cursor-pointer
        ${selected ? "border-transparent text-white" : "border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50"}`}
      style={selected ? { backgroundColor: "var(--eligibility-primary, #0B1F3A)" } : undefined}
    >
      {children}
    </button>
  );
}

export default function EligibilityIntro() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Which page linked here (e.g. "Home Page") — see StartAssessmentButton's
  // pageSource prop. Carried forward into /eligibility/quiz so the eventual
  // submit's `source` traces a completed quiz back to its originating page,
  // same as ConsultationSection does for the contact forms.
  const pageSource = searchParams.get("src") || "";
  const sessionId = useMemo(() => getSessionId(), []);
  const [uiStep, setUiStep] = useState("category");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedVisa, setSelectedVisa] = useState("");

  const { data: visas, isLoading, isError } = useQuery({
    queryKey: ["eligibility-visas"],
    queryFn: async () => (await eligibilityQuizApi.visas()).data,
  });

  useEffect(() => {
    const utm = captureUtmFromUrl();
    telemetryApi.track({ name: "quiz.started", sessionId, utm, properties: { step: "intro" } });
  }, [sessionId]);

  const visasByCategory = useMemo(() => {
    const map = {};
    (visas || []).forEach((visa) => {
      (map[visa.category] = map[visa.category] || []).push(visa);
    });
    return map;
  }, [visas]);

  const visasInSelectedCategory = visasByCategory[selectedCategory] || [];

  const handleSelectCategory = (categoryId) => setSelectedCategory(categoryId);

  const handleContinueToVisas = () => {
    if (!selectedCategory) return;
    telemetryApi.track({ name: "quiz.category_selected", sessionId, properties: { category: selectedCategory } });
    setSelectedVisa("");
    setUiStep("visa");
  };

  const handleBackToCategories = () => setUiStep("category");

  const handleStart = () => {
    if (!selectedVisa) return;
    telemetryApi.track({ name: "quiz.visa_selected", sessionId, properties: { category: selectedCategory, visaPathway: selectedVisa } });
    const quizParams = new URLSearchParams({ visa: selectedVisa });
    if (pageSource) quizParams.set("src", pageSource);
    navigate(`/eligibility/quiz?${quizParams.toString()}`);
  };

  return (
    <EligibilityShell>
      <div className="max-w-2xl mx-auto px-5 sm:px-6 py-16 sm:py-24">
        <span className="inline-block mb-4 px-4 py-1.5 rounded-full bg-slate-100 text-xs font-bold uppercase tracking-widest text-slate-500">
          Free Eligibility Assessment
        </span>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mb-4 leading-tight">
          Find your strongest U.S. immigration pathway in 5 minutes.
        </h1>
        <p className="text-slate-500 leading-relaxed mb-8">
          Answer a few questions about your background and achievements. We'll show you where you stand today — with a clear recommendation and next step, whatever your result.
        </p>

        <QuizProgress step={uiStep === "category" ? 1 : 2} totalSteps={2} label={uiStep === "category" ? "Choose a category" : "Choose your visa"} />

        {isError && (
          <p className="text-sm text-red-600 mb-8">Couldn't load visa pathways. Please refresh and try again.</p>
        )}

        {isLoading && (
          <div className="space-y-2 mb-8">
            {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}
          </div>
        )}

        {!isLoading && !isError && uiStep === "category" && (
          <>
            <p className="text-sm font-bold text-slate-700 mb-3">Which pathway are you exploring?</p>
            <div className="grid gap-2.5 mb-10" role="radiogroup" aria-label="Visa category">
              {ELIGIBILITY_CATEGORIES.map((category) => {
                const selected = selectedCategory === category.id;
                const examples = (visasByCategory[category.id] || []).map(shortCode).join(", ");
                return (
                  <PickerButton key={category.id} selected={selected} onClick={() => handleSelectCategory(category.id)}>
                    <span className="font-bold text-sm block">{category.label}</span>
                    {examples && (
                      <span className={`text-xs block mt-0.5 ${selected ? "text-white/75" : "text-slate-500"}`}>
                        {examples}
                      </span>
                    )}
                  </PickerButton>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handleContinueToVisas}
              disabled={!selectedCategory}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl text-white font-bold text-base transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              style={{ backgroundColor: "var(--eligibility-accent, #C6A15B)" }}
            >
              Next
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </>
        )}

        {!isLoading && !isError && uiStep === "visa" && (
          <>
            <button
              type="button"
              onClick={handleBackToCategories}
              className="text-sm font-semibold text-slate-500 hover:text-slate-700 mb-4 cursor-pointer"
            >
              ← Back to categories
            </button>
            <p className="text-sm font-bold text-slate-700 mb-3">Which visa are you exploring?</p>
            <div className="grid gap-2.5 mb-10" role="radiogroup" aria-label="Visa pathway">
              {visasInSelectedCategory.map((visa) => {
                const selected = selectedVisa === visa.key;
                return (
                  <PickerButton key={visa.key} selected={selected} onClick={() => setSelectedVisa(visa.key)}>
                    <span className="font-bold text-sm">{visa.label}</span>
                  </PickerButton>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handleStart}
              disabled={!selectedVisa}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl text-white font-bold text-base transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              style={{ backgroundColor: "var(--eligibility-accent, #C6A15B)" }}
            >
              Start assessment
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </>
        )}
      </div>
    </EligibilityShell>
  );
}

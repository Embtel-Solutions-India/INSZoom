import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { eligibilityQuizApi, telemetryApi } from "../../services/api";
import { getSessionId } from "../../utils/eligibilitySession";
import EligibilityShell from "../../components/eligibility/EligibilityShell";
import QuizProgress from "../../components/eligibility/QuizProgress";
import ProfileStep from "../../components/eligibility/ProfileStep";
import CriteriaStep from "../../components/eligibility/CriteriaStep";
import ContactStep, { isContactStepValid } from "../../components/eligibility/ContactStep";
import LiveTracker from "../../components/eligibility/LiveTracker";

const STEPS = ["profile", "criteria", "contact"];

export default function EligibilityQuiz() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const visaPathway = searchParams.get("visa") || undefined;
  const pageSource = searchParams.get("src") || "";
  const sessionId = useMemo(() => getSessionId(), []);

  const [stepIndex, setStepIndex] = useState(0);
  const [profileAnswers, setProfileAnswers] = useState({});
  const [criteriaAnswers, setCriteriaAnswers] = useState({});
  const [contact, setContact] = useState({ fullName: "", email: "", phone: "" });
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [trackerOpen, setTrackerOpen] = useState(false);

  const { data: definition, isLoading, isError } = useQuery({
    queryKey: ["eligibility-definition", visaPathway, sessionId],
    queryFn: async () => (await eligibilityQuizApi.definition(visaPathway, sessionId)).data,
  });

  const submitMutation = useMutation({
    mutationFn: (payload) => eligibilityQuizApi.submit(payload),
  });

  useEffect(() => {
    if (!definition) return;
    // Seed criteria answers to 0 for every question the first time the
    // definition loads, so an unanswered criterion is explicitly "0" (never
    // undefined) — matches the backend's own "unanswered = 0" rule.
    setCriteriaAnswers((current) => {
      const next = { ...current };
      let changed = false;
      definition.criteriaQuestions.forEach((q) => {
        if (!(q.key in next)) { next[q.key] = undefined; changed = true; }
      });
      return changed ? next : current;
    });
  }, [definition]);

  if (isLoading) {
    return (
      <EligibilityShell>
        <div className="max-w-3xl mx-auto px-5 py-16 space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-2xl bg-slate-100 animate-pulse" />)}
        </div>
      </EligibilityShell>
    );
  }
  if (isError || !definition) {
    return (
      <EligibilityShell>
        <div className="max-w-lg mx-auto px-5 py-24 text-center">
          <p className="font-bold text-slate-800 mb-2">Couldn't load the assessment</p>
          <p className="text-sm text-slate-500">Please refresh the page and try again.</p>
        </div>
      </EligibilityShell>
    );
  }

  const currentStep = STEPS[stepIndex];
  const stepLabel = { profile: "Your background", criteria: "Your evidence", contact: "Get your results" }[currentStep];

  const canAdvance = currentStep === "profile"
    ? definition.profileQuestions.every((q) => !q.required || String(profileAnswers[q.key] || "").trim())
    : currentStep === "criteria"
      ? true // criteria are optional per-question; unanswered = 0, submit is still meaningful
      : isContactStepValid(contact, disclaimerAccepted);

  const goNext = () => {
    if (stepIndex < STEPS.length - 1) {
      setStepIndex((i) => i + 1);
      return;
    }
    handleSubmit();
  };
  const goBack = () => setStepIndex((i) => Math.max(0, i - 1));

  const handleSubmit = async () => {
    const criteriaAnswersArray = definition.criteriaQuestions.map((q) => ({ key: q.key, value: criteriaAnswers[q.key] ?? 0 }));
    try {
      const res = await submitMutation.mutateAsync({
        visaPathway: definition.visaPathway,
        fullName: contact.fullName,
        email: contact.email,
        phone: contact.phone,
        profileAnswers,
        criteriaAnswers: criteriaAnswersArray,
        sessionId,
        disclaimerAccepted,
        source: pageSource ? `${pageSource} — Quiz Completed` : "public_quiz",
      });
      telemetryApi.track({ name: "quiz.completed", sessionId, properties: { visaPathway: definition.visaPathway } });
      navigate(`/eligibility/results/${res.data.leadId}`, { state: { result: res.data, contact } });
    } catch {
      // submitMutation.error surfaces the retry UI below — answers are untouched
    }
  };

  return (
    <EligibilityShell>
      <div className="max-w-5xl mx-auto px-5 sm:px-6 py-10 sm:py-14 grid lg:grid-cols-[1fr_320px] gap-8 lg:gap-12">
        <div className="min-w-0">
          <QuizProgress step={stepIndex + 1} totalSteps={STEPS.length} label={stepLabel} />

          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              {currentStep === "profile" && (
                <ProfileStep
                  questions={definition.profileQuestions}
                  answers={profileAnswers}
                  onChange={(key, value) => setProfileAnswers((a) => ({ ...a, [key]: value }))}
                />
              )}
              {currentStep === "criteria" && (
                <>
                  <button
                    type="button"
                    onClick={() => setTrackerOpen((v) => !v)}
                    className="lg:hidden mb-4 w-full text-left rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600"
                  >
                    {trackerOpen ? "Hide" : "Show"} your live snapshot
                  </button>
                  {trackerOpen && (
                    <div className="lg:hidden mb-4">
                      <LiveTracker criteriaQuestions={definition.criteriaQuestions} criteriaAnswers={criteriaAnswers} />
                    </div>
                  )}
                  <CriteriaStep
                    questions={definition.criteriaQuestions}
                    answers={criteriaAnswers}
                    onChange={(key, value) => setCriteriaAnswers((a) => ({ ...a, [key]: value }))}
                  />
                </>
              )}
              {currentStep === "contact" && (
                <ContactStep
                  contact={contact}
                  onChange={(key, value) => setContact((c) => ({ ...c, [key]: value }))}
                  disclaimerAccepted={disclaimerAccepted}
                  onDisclaimerChange={setDisclaimerAccepted}
                />
              )}
            </motion.div>
          </AnimatePresence>

          {submitMutation.isError && (
            <div className="mt-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              Something went wrong submitting your assessment. Your answers are still here — please try again.
            </div>
          )}

          <div className="flex items-center justify-between mt-8">
            <button
              type="button"
              onClick={goBack}
              disabled={stepIndex === 0}
              className="px-5 py-3 rounded-xl text-sm font-bold text-slate-500 hover:text-slate-700 disabled:opacity-0 cursor-pointer"
            >
              Back
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={!canAdvance || submitMutation.isPending}
              className="px-8 py-3.5 rounded-xl text-white font-bold text-sm transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              style={{ backgroundColor: "var(--eligibility-accent, #C6A15B)" }}
            >
              {submitMutation.isPending ? "Submitting…" : stepIndex === STEPS.length - 1 ? "Get my results" : "Continue"}
            </button>
          </div>
        </div>

        <div className="hidden lg:block">
          <div className="sticky top-6">
            <LiveTracker criteriaQuestions={definition.criteriaQuestions} criteriaAnswers={criteriaAnswers} />
          </div>
        </div>
      </div>
    </EligibilityShell>
  );
}

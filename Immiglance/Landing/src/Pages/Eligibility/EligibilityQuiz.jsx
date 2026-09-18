import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { eligibilityQuizApi, telemetryApi, API_BASE_URL } from "../../services/api";
import { getSessionId, captureUtmFromUrl } from "../../utils/eligibilitySession";
import EligibilityShell from "../../components/eligibility/EligibilityShell";
import QuizProgress from "../../components/eligibility/QuizProgress";
import ChoiceStep from "../../components/eligibility/ChoiceStep";
import ContactStep, { isContactStepValid } from "../../components/eligibility/ContactStep";
import { ELIGIBILITY_CATEGORIES } from "./eligibilityCategories";

// One continuous, no-navbar quiz: contact info first, then category -> the
// specific visa within it, then 5 fixed qualifying questions (whose
// label/options come from the backend's profileQuestions, keyed by these
// same 5 keys — see Backend's quiz.config.js DEFAULT_PROFILE_QUESTIONS).
// Category/visa are client-only picks (never sent as "questions"); only
// visaPathway itself is submitted.
const STEPS = ["contact", "category", "visa", "location", "immigrationStatus", "profession", "goal", "timeline"];
const PROFILE_STEP_KEYS = new Set(["location", "immigrationStatus", "profession", "goal", "timeline"]);
const STEP_LABELS = {
  contact: "Your contact info",
  category: "Choose a category",
  visa: "Choose your visa",
  location: "Your location",
  immigrationStatus: "Your status",
  profession: "Your profession",
  goal: "Your goal",
  timeline: "Your timeline",
};

// A visa's `label` is always "KEY — Description" — the short code before the
// dash is shown as example-visa subtext under each category card.
function shortCode(visa) {
  return visa.label.split("—")[0].trim();
}

function LoadingRows() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-xl bg-secondary animate-pulse" />)}
    </div>
  );
}

function ErrorNotice({ children }) {
  return <p className="text-sm text-destructive">{children}</p>;
}

export default function EligibilityQuiz() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const pageSource = searchParams.get("src") || "";
  const sessionId = useMemo(() => getSessionId(), []);

  const [stepIndex, setStepIndex] = useState(0);
  const [contact, setContact] = useState({ fullName: "", email: "", phone: "" });
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [visaPathway, setVisaPathway] = useState("");
  const [profileAnswers, setProfileAnswers] = useState({});

  const currentStep = STEPS[stepIndex];

  const { data: visas, isLoading: visasLoading, isError: visasError } = useQuery({
    queryKey: ["eligibility-visas"],
    queryFn: async () => (await eligibilityQuizApi.visas()).data,
  });

  const { data: definition, isLoading: definitionLoading, isError: definitionError } = useQuery({
    queryKey: ["eligibility-definition", visaPathway, sessionId],
    queryFn: async () => (await eligibilityQuizApi.definition(visaPathway, sessionId)).data,
    enabled: Boolean(visaPathway),
  });

  const submitMutation = useMutation({
    mutationFn: (payload) => eligibilityQuizApi.submit(payload),
  });

  useEffect(() => {
    const utm = captureUtmFromUrl();
    telemetryApi.track({ name: "quiz.started", sessionId, utm, properties: { step: "contact" } });
  }, [sessionId]);

  const visasByCategory = useMemo(() => {
    const map = {};
    (visas || []).forEach((visa) => { (map[visa.category] = map[visa.category] || []).push(visa); });
    return map;
  }, [visas]);
  const visasInSelectedCategory = visasByCategory[selectedCategory] || [];

  // Fire-and-forget autosave — called right before every step advance so an
  // abandoned quiz never loses more than the step currently in progress.
  const saveDraft = (snapshot) => {
    eligibilityQuizApi.draft({
      sessionId,
      fullName: snapshot.contact.fullName,
      email: snapshot.contact.email,
      phone: snapshot.contact.phone,
      visaPathway: snapshot.visaPathway,
      profileAnswers: snapshot.profileAnswers,
      source: pageSource ? `${pageSource} — Quiz In Progress` : "public_quiz_draft",
    });
  };

  // Safety net for a tab close mid-step (before any goNext() has captured
  // it): flushes the latest in-memory answers via sendBeacon, which (unlike
  // a normal fetch) is still delivered during page unload.
  const latestRef = useRef();
  useEffect(() => {
    latestRef.current = { contact, visaPathway, profileAnswers, stepIndex };
  }, [contact, visaPathway, profileAnswers, stepIndex]);

  useEffect(() => {
    const flush = () => {
      const s = latestRef.current;
      if (!s.contact.email && !s.contact.fullName && !s.contact.phone) return; // nothing worth saving yet
      const body = JSON.stringify({
        sessionId,
        fullName: s.contact.fullName,
        email: s.contact.email,
        phone: s.contact.phone,
        visaPathway: s.visaPathway,
        profileAnswers: s.profileAnswers,
        source: pageSource ? `${pageSource} — Quiz Abandoned` : "public_quiz_draft",
      });
      try {
        navigator.sendBeacon(`${API_BASE_URL}/eligibility-quiz/draft`, new Blob([body], { type: "application/json" }));
      } catch {
        // best-effort only
      }
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [sessionId, pageSource]);

  const goBack = () => setStepIndex((i) => Math.max(0, i - 1));

  const goNext = (overrides = {}) => {
    const snapshot = {
      contact,
      visaPathway: overrides.visaPathway ?? visaPathway,
      profileAnswers: overrides.profileAnswers ?? profileAnswers,
    };
    saveDraft(snapshot);
    if (stepIndex < STEPS.length - 1) {
      setStepIndex((i) => i + 1);
      return;
    }
    handleSubmit(snapshot);
  };

  const handleSubmit = async (snapshot) => {
    try {
      const res = await submitMutation.mutateAsync({
        visaPathway: snapshot.visaPathway,
        fullName: snapshot.contact.fullName,
        email: snapshot.contact.email,
        phone: snapshot.contact.phone,
        profileAnswers: snapshot.profileAnswers,
        criteriaAnswers: [],
        sessionId,
        disclaimerAccepted,
        source: pageSource ? `${pageSource} — Quiz Completed` : "public_quiz",
      });
      telemetryApi.track({ name: "quiz.completed", sessionId, properties: { visaPathway: snapshot.visaPathway } });
      navigate(`/consultation/book/${res.data.leadId}`, { state: { contact: snapshot.contact } });
    } catch (error) {
      // The api.js request() wrapper flattens a non-2xx response into a
      // plain Error with .status/.code set directly (not axios's nested
      // error.response.data.code) - same shape Login.jsx already checks
      // via err.code === "PENDING_INVITE".
      if (error.status === 409 && error.code === "CASE_EXISTS") {
        // Authenticated client already has a case (e.g. reloaded the quiz
        // page after already completing it) - send them to their
        // dashboard instead of showing an error/retry UI for what is
        // actually a correct, expected state.
        navigate("/dashboard", { replace: true });
        return;
      }
      // submitMutation.error surfaces the retry UI below — answers are untouched
    }
  };

  const handleContactContinue = () => {
    if (!isContactStepValid(contact, disclaimerAccepted)) return;
    goNext();
  };

  const handleSelectCategory = (categoryId) => {
    setSelectedCategory(categoryId);
    if (categoryId !== selectedCategory) setVisaPathway("");
    telemetryApi.track({ name: "quiz.category_selected", sessionId, properties: { category: categoryId } });
    goNext();
  };

  const handleSelectVisa = (visaKey) => {
    setVisaPathway(visaKey);
    telemetryApi.track({ name: "quiz.visa_selected", sessionId, properties: { category: selectedCategory, visaPathway: visaKey } });
    goNext({ visaPathway: visaKey });
  };

  const handleAnswerProfile = (key, value) => {
    const nextAnswers = { ...profileAnswers, [key]: value };
    setProfileAnswers(nextAnswers);
    goNext({ profileAnswers: nextAnswers });
  };

  return (
    <EligibilityShell>
      <div className="max-w-2xl mx-auto px-5 sm:px-6 py-14 sm:py-20">
        <span className="inline-block mb-4 px-4 py-1.5 rounded-full bg-secondary text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Free Case Evaluation
        </span>

        <QuizProgress step={stepIndex + 1} totalSteps={STEPS.length} label={STEP_LABELS[currentStep]} />

        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            {currentStep === "contact" && (
              <ContactStep
                contact={contact}
                onChange={(key, value) => setContact((c) => ({ ...c, [key]: value }))}
                disclaimerAccepted={disclaimerAccepted}
                onDisclaimerChange={setDisclaimerAccepted}
              />
            )}

            {currentStep === "category" && (
              visasError ? (
                <ErrorNotice>Couldn't load visa pathways. Please refresh and try again.</ErrorNotice>
              ) : visasLoading ? (
                <LoadingRows />
              ) : (
                <ChoiceStep
                  label="Which pathway are you exploring?"
                  options={ELIGIBILITY_CATEGORIES.map((category) => ({
                    value: category.id,
                    label: category.label,
                    subtext: (visasByCategory[category.id] || []).map(shortCode).join(", "),
                  }))}
                  value={selectedCategory}
                  onSelect={handleSelectCategory}
                />
              )
            )}

            {currentStep === "visa" && (
              <ChoiceStep
                label="Which visa are you exploring?"
                options={visasInSelectedCategory.map((visa) => ({ value: visa.key, label: visa.label }))}
                value={visaPathway}
                onSelect={handleSelectVisa}
              />
            )}

            {PROFILE_STEP_KEYS.has(currentStep) && (
              definitionError ? (
                <ErrorNotice>Couldn't load this question. Please refresh and try again.</ErrorNotice>
              ) : definitionLoading || !definition ? (
                <LoadingRows />
              ) : (() => {
                const question = definition.profileQuestions.find((q) => q.key === currentStep);
                if (!question) return null;
                return (
                  <ChoiceStep
                    label={question.label}
                    options={question.options}
                    value={profileAnswers[currentStep]}
                    onSelect={(value) => handleAnswerProfile(currentStep, value)}
                  />
                );
              })()
            )}
          </motion.div>
        </AnimatePresence>

        {submitMutation.isError && (
          <div className="mt-4 rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
            Something went wrong submitting your assessment. Your answers are still here — please try again.
          </div>
        )}

        <div className="flex items-center justify-between mt-8">
          <button
            type="button"
            onClick={goBack}
            disabled={stepIndex === 0 || submitMutation.isPending}
            className="px-5 py-3 rounded-xl text-sm font-bold text-muted-foreground hover:text-foreground disabled:opacity-0 cursor-pointer"
          >
            Back
          </button>
          {currentStep === "contact" && (
            <button
              type="button"
              onClick={handleContactContinue}
              disabled={!isContactStepValid(contact, disclaimerAccepted)}
              className="px-8 py-3.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Continue
            </button>
          )}
          {submitMutation.isPending && (
            <span className="text-sm font-semibold text-muted-foreground">Submitting…</span>
          )}
        </div>
      </div>
    </EligibilityShell>
  );
}

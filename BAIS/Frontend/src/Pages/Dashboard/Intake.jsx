import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "../../context/AuthContext";
import useHasCase from "../../hooks/useHasCase";
import { leadsApi } from "../../services/api";

// Best-effort "what visa is this prospect interested in" summary for
// Lead.visaInterest. The quiz branches through several visa-shaped answer
// keys depending on path (work/student/business/green-card) rather than one
// canonical field — checked in the same priority order the now-removed
// buildCasePayloadFromIntake() used to derive its own selectedKey.
function deriveVisaInterest(answers) {
  return (
    answers.workVisaType || answers.studentVisaType || answers.businessPathway
    || answers.greenCardType || answers.employmentPath || answers.service || ""
  );
}

// Best-effort "is this an extension" signal — no single quiz field means
// this directly, so this checks the handful of answer values that do.
function deriveExtensionInterest(answers) {
  if (answers.h1bScenario === "extension") return "H-1B extension";
  if (answers.service === "renew_replace_conditions" && answers.maintenanceAction === "renew_green_card") return "Green card renewal";
  if (answers.optType || answers.studentVisaType === "stem_opt") return "STEM OPT extension";
  return "";
}

const SERVICE_STEPS = [
  {
    key: "service",
    section: "Service Selection",
    title: "Which service would you like our help applying for?",
    description: "Start with the outcome you want. We will narrow this into the right application pathway.",
    options: [
      { value: "green_card_or_fiance", label: "Apply for a Green Card or Fiance Visa", badge: "Popular", description: "Family, marriage, fiance, employment, or diversity visa pathways." },
      { value: "renew_replace_conditions", label: "Renew or Replace a Green Card or Remove Conditions", description: "Green card renewal, replacement, or conditional residence support." },
      { value: "citizenship", label: "Apply for United States Citizenship", description: "Naturalization preparation and filing support." },
      { value: "work_visa", label: "Apply for a Work Visa", description: "H-1B, L-1, O-1, TN, E visas, and employer-sponsored pathways." },
      { value: "student_exchange", label: "Student, Exchange Visitor, or Training Visa", description: "F-1, J-1, OPT, STEM OPT, and related status planning." },
      { value: "business_investor", label: "Business, Investor, or Founder Immigration", description: "Investor, entrepreneur, founder, executive, and U.S. expansion options." },
      { value: "cos_extension_ead", label: "Change Status, Extend Status, or Apply for Work Authorization", description: "COS to F-1/F-2, F-1 Reinstatement, F-1 to B-2, EAD (I-765), H-4 Extension, and H-4 Extension + EAD." },
    ],
  },
  {
    key: "greenCardType",
    section: "Immigration Category",
    title: "Which type of green card or visa are you applying for?",
    description: "Select the category that best matches the applicant's situation.",
    visibleWhen: { service: "green_card_or_fiance" },
    options: [
      { value: "family_based", label: "Family-Based", badge: "Popular", description: "Petition through a spouse, fiance, parent, child, or sibling." },
      { value: "employment_based", label: "Employment-Based", description: "Employer-sponsored, extraordinary ability, NIW, or skilled worker options." },
      { value: "diversity_lottery", label: "Green Card Lottery", description: "Diversity visa lottery processing and next-step guidance." },
    ],
  },
  {
    key: "petitioner",
    section: "Visa Type",
    title: "Who is the applicant's petitioner?",
    description: "This helps identify the likely family petition and related USCIS forms.",
    visibleWhen: { greenCardType: "family_based" },
    options: [
      { value: "spouse", label: "Spouse", badge: "Popular" },
      { value: "fiance", label: "Fiance" },
      { value: "parent", label: "Parent" },
      { value: "child", label: "Child" },
      { value: "sibling", label: "Sibling" },
    ],
  },
  {
    key: "applicantLocation",
    section: "Current Status",
    title: "Is the applicant currently living in the U.S.?",
    description: "This determines whether the case is likely adjustment of status or consular processing.",
    visibleWhen: { service: "green_card_or_fiance" },
    options: [
      { value: "inside_us", label: "Yes" },
      { value: "outside_us", label: "No" },
    ],
  },
  {
    key: "petitionerStatus",
    section: "Eligibility Questions",
    title: "Is the petitioner a U.S. Citizen or Green Card holder?",
    description: "Petitioner status affects availability, timing, and supporting forms.",
    visibleWhen: { greenCardType: "family_based" },
    options: [
      { value: "us_citizen", label: "U.S. Citizen" },
      { value: "green_card_holder", label: "Green Card Holder" },
    ],
  },
  {
    key: "employmentPath",
    section: "Visa Type",
    title: "Which employment-based pathway best fits the applicant?",
    description: "Choose the closest match; your case team can refine this after review.",
    visibleWhenAny: [{ greenCardType: "employment_based" }, { service: "work_visa" }],
    options: [
      { value: "employer_sponsored", label: "Employer-Sponsored Position" },
      { value: "extraordinary_ability", label: "Extraordinary Ability or Achievement" },
      { value: "national_interest", label: "National Interest Waiver" },
      { value: "executive_transfer", label: "Executive or Manager Transfer" },
      { value: "temporary_professional", label: "Temporary Professional Work Visa" },
    ],
  },
  {
    key: "maintenanceAction",
    section: "Visa Type",
    title: "What would you like to do with your Green Card?",
    description: "Choose the exact green card service you need.",
    visibleWhen: { service: "renew_replace_conditions" },
    options: [
      { value: "renew_green_card", label: "Renew my Green Card" },
      { value: "replace_lost_stolen", label: "Replace a Lost or Stolen Green Card" },
      { value: "replace_damaged", label: "Replace a Damaged Green Card" },
      { value: "correct_information", label: "Correct Information on My Green Card" },
      { value: "remove_conditions", label: "Remove Conditions on Permanent Residence", badge: "Review Needed" },
    ],
  },
  {
    key: "greenCardExpiry",
    section: "Eligibility Questions",
    title: "Is your Green Card expiring within the next 6 months?",
    visibleWhen: { maintenanceAction: "renew_green_card" },
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
      { value: "expired", label: "Already Expired" },
    ],
  },
  {
    key: "residingInUS",
    section: "Current Status",
    title: "Are you currently residing inside the United States?",
    visibleWhenAny: [{ greenCardExpiry: "expired" }, { maintenanceAction: "remove_conditions" }],
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
  {
    key: "returningAsResident",
    section: "Eligibility Questions",
    title: "Are you returning to the U.S. as a permanent resident?",
    visibleWhen: { residingInUS: "no" },
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
      { value: "not_sure", label: "Not Sure" },
    ],
  },
  {
    key: "replacementReason",
    section: "Eligibility Questions",
    title: "Why are you replacing your Green Card?",
    visibleWhenAny: [{ maintenanceAction: "replace_lost_stolen" }, { maintenanceAction: "replace_damaged" }, { maintenanceAction: "correct_information" }],
    options: [
      { value: "lost", label: "Lost" },
      { value: "stolen", label: "Stolen" },
      { value: "damaged", label: "Damaged" },
      { value: "incorrect_information", label: "Incorrect Information" },
      { value: "never_received", label: "Never Received" },
    ],
  },
  {
    key: "reportedLoss",
    section: "Eligibility Questions",
    title: "Have you reported the loss or theft?",
    visibleWhenAny: [{ replacementReason: "lost" }, { replacementReason: "stolen" }],
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
      { value: "not_applicable", label: "Not Applicable" },
    ],
  },
  {
    key: "correctionInfo",
    section: "Eligibility Questions",
    title: "Which information needs correction?",
    visibleWhen: { replacementReason: "incorrect_information" },
    options: [
      { value: "name", label: "Name" },
      { value: "date_of_birth", label: "Date of Birth" },
      { value: "gender", label: "Gender" },
      { value: "uscis_error", label: "USCIS Error" },
      { value: "other", label: "Other" },
    ],
  },
  {
    key: "conditionalResidenceType",
    section: "Eligibility Questions",
    title: "What type of conditional residence do you have?",
    visibleWhen: { maintenanceAction: "remove_conditions" },
    options: [
      { value: "marriage_based", label: "Marriage-Based" },
      { value: "investor_based", label: "Investor-Based" },
    ],
  },
  {
    key: "stillMarried",
    section: "Eligibility Questions",
    title: "Are you still married to the same U.S. citizen or permanent resident?",
    visibleWhen: { conditionalResidenceType: "marriage_based" },
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
  {
    key: "filingWaiver",
    section: "Eligibility Questions",
    title: "Are you filing a waiver?",
    visibleWhen: { stillMarried: "no" },
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
      { value: "need_attorney_review", label: "I need attorney review" },
    ],
  },
  {
    key: "citizenshipStatus",
    section: "Current Status",
    title: "What best describes your current immigration status?",
    visibleWhen: { service: "citizenship" },
    options: [
      { value: "permanent_resident", label: "Permanent Resident" },
      { value: "conditional_resident", label: "Conditional Resident" },
      { value: "other", label: "Other" },
    ],
  },
  {
    key: "residentDuration",
    section: "Eligibility Questions",
    title: "How long have you been a permanent resident?",
    visibleWhenAny: [{ citizenshipStatus: "permanent_resident" }, { citizenshipStatus: "conditional_resident" }],
    options: [
      { value: "less_than_3", label: "Less than 3 years" },
      { value: "3_years", label: "3 years" },
      { value: "5_years", label: "5 years" },
      { value: "more_than_5", label: "More than 5 years" },
    ],
  },
  {
    key: "marriedToCitizen",
    section: "Eligibility Questions",
    title: "Are you currently married to a U.S. citizen?",
    visibleWhen: { residentDuration: "3_years" },
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
  {
    key: "longTrips",
    section: "Immigration History",
    title: "Have you spent more than 6 months continuously outside the United States?",
    visibleWhen: { service: "citizenship" },
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
  {
    key: "taxesFiled",
    section: "Eligibility Questions",
    title: "Have you filed U.S. taxes every year you were required to file?",
    visibleWhen: { service: "citizenship" },
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
      { value: "not_sure", label: "Not Sure" },
    ],
  },
  {
    key: "arrested",
    section: "Additional Review",
    title: "Have you ever been arrested, cited, or detained by law enforcement?",
    visibleWhen: { service: "citizenship" },
    options: [
      { value: "yes", label: "Yes", badge: "Attorney Review" },
      { value: "no", label: "No" },
    ],
  },
  {
    key: "claimedCitizen",
    section: "Additional Review",
    title: "Have you ever claimed to be a U.S. citizen?",
    visibleWhen: { service: "citizenship" },
    options: [
      { value: "yes", label: "Yes", badge: "Attorney Review" },
      { value: "no", label: "No" },
    ],
  },
  {
    key: "primaryApplicant",
    section: "Current Status",
    title: "Who is the primary applicant?",
    visibleWhen: { service: "work_visa" },
    options: [
      { value: "employee", label: "Employee" },
      { value: "employer", label: "Employer" },
    ],
  },
  {
    key: "workVisaType",
    section: "Visa Type",
    title: "Which work visa are you interested in?",
    // Also shown for the Green Card -> Employment-Based path, which previously
    // only collected a generic pathway bucket (employmentPath) and never asked
    // for the actual visa code - so cases from that path had no specific
    // visaType for the questionnaire engine to match against.
    visibleWhenAny: [{ service: "work_visa" }, { greenCardType: "employment_based" }],
    options: [
      { value: "h1b", label: "H-1B" },
      { value: "l1a", label: "L-1A" },
      { value: "l1b", label: "L-1B" },
      { value: "o1a", label: "O-1A" },
      { value: "o1b", label: "O-1B" },
      { value: "tn", label: "TN" },
      { value: "e2", label: "E-2" },
      { value: "e1", label: "E-1" },
      { value: "eb1a", label: "EB-1A" },
      { value: "eb2", label: "EB-2" },
      { value: "niw", label: "EB-2 NIW" },
      { value: "eb3", label: "EB-3" },
    ],
  },
  {
    key: "newOfficePetition",
    section: "Visa Type",
    title: "Is this a New Office petition?",
    description: "A New Office petition is filed when the U.S. company has been doing business for less than one year. This determines whether a business plan is required as part of your L-1A filing.",
    visibleWhen: { workVisaType: "l1a" },
    options: [
      { value: "yes", label: "Yes", description: "The U.S. office has been operating for less than one year (or has not started yet)." },
      { value: "no", label: "No", description: "The U.S. office has been doing business for one year or more." },
    ],
  },
  {
    key: "hasSponsorEmployer",
    section: "Employer Information",
    title: "Does the applicant currently have an employer willing to sponsor them?",
    visibleWhenAny: [{ workVisaType: "h1b" }, { employmentPath: "employer_sponsored" }, { employmentPath: "temporary_professional" }],
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
  {
    key: "previousH1B",
    section: "Immigration History",
    title: "Has the applicant previously held H-1B status?",
    visibleWhen: { workVisaType: "h1b" },
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
  {
    key: "h1bScenario",
    section: "Eligibility Questions",
    title: "Which H-1B scenario applies?",
    visibleWhen: { previousH1B: "yes" },
    options: [
      { value: "cap_exempt", label: "Cap Exempt" },
      { value: "transfer", label: "Transfer" },
      { value: "extension", label: "Extension" },
      { value: "concurrent", label: "Concurrent Employment" },
      { value: "not_sure", label: "Not Sure" },
    ],
  },
  {
    key: "l1QualifyingEmployment",
    section: "Eligibility Questions",
    title: "Has the applicant worked outside the U.S. for the qualifying company for at least one year?",
    visibleWhenAny: [{ workVisaType: "l1a" }, { workVisaType: "l1b" }, { employmentPath: "executive_transfer" }],
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No", badge: "Review Needed" },
      { value: "not_sure", label: "Not Sure" },
    ],
  },
  {
    key: "o1Field",
    section: "Eligibility Questions",
    title: "Which field best describes the applicant?",
    visibleWhenAny: [{ workVisaType: "o1a" }, { workVisaType: "o1b" }, { employmentPath: "extraordinary_ability" }],
    options: [
      { value: "science", label: "Science" },
      { value: "education", label: "Education" },
      { value: "business", label: "Business" },
      { value: "athletics", label: "Athletics" },
      { value: "arts", label: "Arts" },
      { value: "film_tv", label: "Film or Television" },
    ],
  },
  {
    key: "o1Evidence",
    section: "Evidence Questions",
    title: "Which evidence does the applicant already have?",
    visibleWhenAny: [{ o1Field: "science" }, { o1Field: "education" }, { o1Field: "business" }, { o1Field: "athletics" }, { o1Field: "arts" }, { o1Field: "film_tv" }],
    options: [
      { value: "awards", label: "Awards" },
      { value: "media", label: "Media Coverage" },
      { value: "leadership", label: "Leadership or Critical Role" },
      { value: "salary", label: "High Salary" },
      { value: "patents", label: "Patents or Original Contributions" },
      { value: "judging", label: "Judging Others' Work" },
    ],
  },
  {
    key: "studentVisaType",
    section: "Visa Type",
    title: "Which student or exchange category are you applying for?",
    visibleWhen: { service: "student_exchange" },
    options: [
      { value: "f1", label: "F-1" },
      { value: "j1", label: "J-1" },
      { value: "m1", label: "M-1" },
      { value: "opt", label: "OPT" },
      { value: "stem_opt", label: "STEM OPT" },
      { value: "cpt", label: "CPT" },
    ],
  },
  {
    key: "receivedI20",
    section: "Document Readiness",
    title: "Have you received an I-20 or DS-2019?",
    visibleWhenAny: [{ studentVisaType: "f1" }, { studentVisaType: "j1" }, { studentVisaType: "m1" }],
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
  {
    key: "sevisPaid",
    section: "Document Readiness",
    title: "Have you paid the SEVIS fee?",
    visibleWhenAny: [{ studentVisaType: "f1" }, { studentVisaType: "j1" }, { studentVisaType: "m1" }],
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
      { value: "not_yet", label: "Not Yet" },
    ],
  },
  {
    key: "optType",
    section: "Eligibility Questions",
    title: "Which OPT type applies?",
    visibleWhen: { studentVisaType: "opt" },
    options: [
      { value: "pre_completion", label: "Pre-completion" },
      { value: "post_completion", label: "Post-completion" },
    ],
  },
  {
    key: "graduated",
    section: "Eligibility Questions",
    title: "Have you already graduated?",
    visibleWhenAny: [{ studentVisaType: "opt" }, { studentVisaType: "stem_opt" }],
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
  {
    key: "eVerifyEmployer",
    section: "Employer Information",
    title: "Is your employer enrolled in E-Verify?",
    visibleWhen: { studentVisaType: "stem_opt" },
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No", badge: "Warning" },
      { value: "not_sure", label: "Not Sure" },
    ],
  },
  {
    key: "businessPathway",
    section: "Visa Type",
    title: "Which business or investor pathway are you interested in?",
    visibleWhen: { service: "business_investor" },
    options: [
      { value: "eb5", label: "EB-5" },
      { value: "e2", label: "E-2" },
      { value: "l1a", label: "L-1A" },
      { value: "international_entrepreneur", label: "International Entrepreneur" },
      { value: "startup_founder", label: "Startup Founder" },
      { value: "us_expansion", label: "Expansion into the U.S." },
    ],
  },
  {
    key: "investmentCapital",
    section: "Eligibility Questions",
    title: "How much capital are you investing?",
    visibleWhen: { businessPathway: "eb5" },
    options: [
      { value: "under_threshold", label: "Under current EB-5 threshold", badge: "Review Needed" },
      { value: "targeted_area", label: "Targeted employment area threshold" },
      { value: "standard_threshold", label: "Standard EB-5 threshold or higher" },
      { value: "not_sure", label: "Not Sure" },
    ],
  },
  {
    key: "sourceOfFundsReady",
    section: "Evidence Questions",
    title: "Do you have source-of-funds documentation ready?",
    visibleWhen: { businessPathway: "eb5" },
    options: [
      { value: "yes", label: "Yes" },
      { value: "partial", label: "Partially" },
      { value: "no", label: "No" },
    ],
  },
  {
    key: "treatyNationality",
    section: "Eligibility Questions",
    title: "Do you hold nationality from an E-2 treaty country?",
    visibleWhenAny: [{ businessPathway: "e2" }, { workVisaType: "e2" }],
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No", badge: "Review Needed" },
      { value: "not_sure", label: "Not Sure" },
    ],
  },
  {
    key: "businessPurchased",
    section: "Business Information",
    title: "Has the business already been purchased or launched?",
    visibleWhenAny: [{ businessPathway: "e2" }, { businessPathway: "startup_founder" }, { businessPathway: "us_expansion" }],
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
      { value: "in_progress", label: "In Progress" },
    ],
  },
  {
    key: "startupTraction",
    section: "Evidence Questions",
    title: "Which startup evidence do you already have?",
    visibleWhenAny: [{ businessPathway: "startup_founder" }, { businessPathway: "international_entrepreneur" }],
    options: [
      { value: "funding", label: "Funding Raised" },
      { value: "employees", label: "Employees" },
      { value: "revenue", label: "Revenue" },
      { value: "patents", label: "Patents" },
      { value: "investor_support", label: "Investor Support" },
    ],
  },
  {
    key: "urgency",
    section: "Case Creation",
    title: "How soon do you want to begin?",
    description: "This helps the team prioritize consultation and onboarding.",
    options: [
      { value: "immediate", label: "Immediately", description: "I need help as soon as possible." },
      { value: "soon", label: "Within 30 days" },
      { value: "planning", label: "I am planning ahead" },
    ],
  },
];
function isStepVisible(step, answers) {
  if (step.visibleWhen && !Object.entries(step.visibleWhen).every(([key, value]) => answers[key] === value)) return false;
  if (step.visibleWhenAny && !step.visibleWhenAny.some((rule) => Object.entries(rule).every(([key, value]) => answers[key] === value))) return false;
  return true;
}

function SelectionCard({ option, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border p-3.5 text-left transition ${
        selected ? "border-emerald-500 bg-emerald-50/60" : "border-slate-200 bg-white hover:border-emerald-200 hover:bg-slate-50"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{option.label}</h3>
          {option.description && <p className="mt-1 text-xs font-medium leading-5 text-slate-500">{option.description}</p>}
        </div>
        <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${selected ? "border-emerald-600 bg-emerald-600" : "border-slate-300"}`}>
          {selected && <span className="h-2 w-2 rounded-full bg-white" />}
        </span>
      </div>
    </button>
  );
}

function ServiceIntakeQuiz() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { loading: hasCaseLoading, isError: hasCaseError } = useHasCase();
  // Brand-new for every client, every time — no cross-case/cross-user
  // localStorage carryover (that was the root cause of stale pre-populated
  // answers and the "jump straight to the package screen" bug below).
  const [answers, setAnswers] = useState({});
  const [currentIndex, setCurrentIndex] = useState(0);
  // Phase 4: submitting/submitError guard the POST /api/leads/from-intake
  // call the completion handler makes before redirecting to booking.
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const visibleSteps = SERVICE_STEPS.filter((step) => isStepVisible(step, answers));
  // Branching can shrink visibleSteps out from under a stale currentIndex
  // (e.g. an earlier answer changes, hiding later steps) — clamp at read
  // time instead of correcting it back into state via an effect.
  const safeIndex = Math.min(currentIndex, Math.max(visibleSteps.length - 1, 0));
  const currentStep = visibleSteps[safeIndex];
  const completion = Math.round((visibleSteps.filter((step) => answers[step.key]).length / Math.max(visibleSteps.length, 1)) * 100);

  useEffect(() => {
    document.title = "Immigration Intake | BAIS";
  }, []);

  // PHASE 3 ARCHITECTURE CHANGE: routing based on case existence and
  // employee-account status has been moved to AuthGate
  // (src/components/AuthGate.jsx). This page renders only once AuthGate has
  // already confirmed the user is a non-employee client with no case — it
  // should not redirect away from itself.

  const selectAnswer = (key, value) => {
    // Whether the question just answered was actually the LAST visible step
    // — computed from the step list as it stood before this answer. This is
    // the fix for "answering the first question jumps to the package page":
    // completeness alone ("are all currently-visible steps answered") used
    // to be treated as "finished," which stale/leftover answers could satisfy
    // immediately; now finishing also requires being on the final step.
    const wasOnLastStep = currentIndex >= visibleSteps.length - 1;
    let nextAnswers = {};
    setAnswers((previous) => {
      const next = { ...previous, [key]: value };
      SERVICE_STEPS.forEach((step) => {
        if (step.key !== key && !isStepVisible(step, next)) delete next[step.key];
      });
      nextAnswers = next;
      return next;
    });
    setTimeout(async () => {
      const nextSteps = SERVICE_STEPS.filter((step) => isStepVisible(step, nextAnswers));
      const nextComplete = wasOnLastStep && nextSteps.length > 0 && nextSteps.every((step) => nextAnswers[step.key]);
      if (nextComplete) {
        // PHASE 2 ARCHITECTURE CHANGE: Intake no longer shows a package
        // screen or creates a case. Case creation is a staff action.
        // PHASE 4: before routing to booking, submit the completed
        // questionnaire as a Lead (POST /api/leads/from-intake) so the
        // consultation can be attached to it. The API call must succeed
        // before navigating away — a failure surfaces an error and keeps
        // the user here rather than silently losing their answers.
        await submitIntakeLead(nextAnswers);
        return;
      }
      setCurrentIndex((index) => Math.min(index + 1, nextSteps.length - 1));
    }, 120);
  };

  const submitIntakeLead = async (finalAnswers) => {
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await leadsApi.createLeadFromIntake({
        visaInterest: deriveVisaInterest(finalAnswers),
        extensionInterest: deriveExtensionInterest(finalAnswers),
        intakeAnswers: finalAnswers,
      });
      // api.js is a fetch wrapper (see services/api.js's request()) — res is
      // the parsed JSON body directly, not an axios-style { data } envelope.
      if (res?.success && res?.leadId) {
        navigate(`/consultation/book?leadId=${res.leadId}`);
        return;
      }
      setSubmitError("Unable to submit your answers. Please try again.");
    } catch (err) {
      setSubmitError(err?.message || "Unable to submit your answers. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // Redirect effect above fires for an employee or an already-cased client;
  // render nothing while that's still resolving instead of flashing the quiz.
  if (hasCaseLoading && user) return null;

  // Phase 4: the completed questionnaire is being submitted as a Lead —
  // shown instead of the (now-answered) question screen while in flight.
  if (submitting) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-4">
        <div className="w-10 h-10 rounded-full border-4 border-slate-200 border-t-slate-900 animate-spin" />
        <p className="text-sm text-slate-500 font-medium">Saving your answers…</p>
      </div>
    );
  }

  // ── One question per screen ──────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="border-b border-slate-100">
        <div className="mx-auto max-w-2xl px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
            </div>
            <span className="text-sm font-bold text-slate-900">BAIS</span>
          </div>
          <button type="button" onClick={() => navigate("/dashboard")} className="text-xs font-semibold text-slate-400 hover:text-slate-600">
            Save &amp; close
          </button>
        </div>
        <div className="h-1 bg-slate-100">
          <div className="h-full bg-slate-900 transition-all duration-500 ease-out" style={{ width: `${completion}%` }} />
        </div>
      </header>

      {hasCaseError && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5 text-center">
          <p className="text-sm font-semibold text-amber-800">
            We couldn't confirm whether you already have a case in progress. If you do, please check your Dashboard before starting a new one.
          </p>
        </div>
      )}

      {submitError && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-2.5 text-center">
          <p className="text-sm font-semibold text-red-700">{submitError}</p>
        </div>
      )}

      <main className="flex-1 flex items-center justify-center px-6 py-14">
        <div className="w-full max-w-lg">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep?.key}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">
                Step {Math.min(currentIndex + 1, visibleSteps.length)} of {visibleSteps.length}
              </p>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 leading-snug mb-2">{currentStep?.title}</h1>
              {currentStep?.description && <p className="text-sm text-slate-500 mb-8">{currentStep.description}</p>}

              <div className="space-y-2.5">
                {currentStep?.options.map((option) => (
                  <SelectionCard
                    key={option.value}
                    option={option}
                    selected={answers[currentStep.key] === option.value}
                    onClick={() => (
                      // Single-party filings (COS/Extension/EAD/Reinstatement) are
                      // their own dedicated flow — no second party, no invite —
                      // and don't fit this wizard's branching quiz shape, so this
                      // one option navigates away immediately rather than
                      // continuing into SERVICE_STEPS.
                      // PHASE 2 ARCHITECTURE CHANGE: no longer routes to the
                      // (removed) filing-type case-creation flow.
                      // PHASE 4: still submits a Lead (with whatever answers
                      // exist so far, plus this selection) before routing to
                      // booking, for the same reason full completion does —
                      // this is a completion path too, not an opt-out of lead capture.
                      currentStep.key === "service" && option.value === "cos_extension_ead"
                        ? submitIntakeLead({ ...answers, service: option.value })
                        : selectAnswer(currentStep.key, option.value)
                    )}
                  />
                ))}
              </div>
            </motion.div>
          </AnimatePresence>

          <div className="mt-8 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setCurrentIndex((index) => Math.max(index - 1, 0))}
              disabled={currentIndex === 0}
              className="text-sm font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-0 disabled:pointer-events-none transition"
            >
              ← Back
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

// Intake is pre-case-creation only: visa selection, package selection,
// eligibility. Once a case exists, every checklist (client/employer/employee/
// business_plan) lives on the Documents page — not here.
export default function Intake() {
  return <ServiceIntakeQuiz />;
}

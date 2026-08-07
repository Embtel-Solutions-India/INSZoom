import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { casesApi, tokenStore } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { isEmployeeAccount } from "../../utils/auth";
import useHasCase from "../../hooks/useHasCase";
import { IconCheckmark } from "../../utils/iconComponents";
import {
  ATTORNEY_REVIEW_PACKAGE,
  FULL_ATTORNEY_FILING_PACKAGE,
  SELF_FILING_PACKAGE,
} from "../../config/pricingCatalog";

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
const SERVICE_PACKAGES = [
  {
    key: SELF_FILING_PACKAGE,
    planKey: SELF_FILING_PACKAGE,
    label: SELF_FILING_PACKAGE,
    price: "$599*",
    amountCents: 59900,
    tagline: "Do-it-yourself application preparation",
    badge: "",
    features: ["Guided intake", "Required forms checklist", "Document checklist", "Secure portal access", "Virtual PDF application"],
  },
  {
    key: ATTORNEY_REVIEW_PACKAGE,
    planKey: ATTORNEY_REVIEW_PACKAGE,
    label: ATTORNEY_REVIEW_PACKAGE,
    price: "$899*",
    amountCents: 89900,
    tagline: "Legal review of your application",
    badge: "Best Value",
    features: [`Everything in ${SELF_FILING_PACKAGE}`, "Attorney review", "Live chat support", "Document quality review", "RFE readiness guidance"],
  },
  {
    key: FULL_ATTORNEY_FILING_PACKAGE,
    planKey: FULL_ATTORNEY_FILING_PACKAGE,
    label: FULL_ATTORNEY_FILING_PACKAGE,
    price: "$1,299*",
    amountCents: 129900,
    tagline: "Attorney-led legal support when you need it",
    badge: "Most Support",
    features: [`Everything in ${ATTORNEY_REVIEW_PACKAGE}`, "Attorney consultations", "Priority case manager", "Application assembled for filing", "Interview preparation kit"],
  },
];

function isStepVisible(step, answers) {
  if (step.visibleWhen && !Object.entries(step.visibleWhen).every(([key, value]) => answers[key] === value)) return false;
  if (step.visibleWhenAny && !step.visibleWhenAny.some((rule) => Object.entries(rule).every(([key, value]) => answers[key] === value))) return false;
  return true;
}

function computeIntakeResult(answers) {
  if (answers.maintenanceAction === "remove_conditions") {
    const investor = answers.conditionalResidenceType === "investor_based";
    return {
      title: investor ? "Investor Conditional Residence Removal" : "Marriage-Based Conditions Removal",
      subtitle: investor ? "Commonly prepared using Form I-829 for investor-based conditional residence." : "Commonly prepared using Form I-751: Petition to Remove Conditions on Residence.",
      summary: "Your answers indicate a conditions-removal workflow with evidence review, residence history, relationship or investment documentation, and attorney review checkpoints.",
      likelyForms: investor ? ["I-829"] : ["I-751"],
      category: investor ? "investor-conditions-removal" : "marriage-conditions-removal",
    };
  }
  if (answers.service === "renew_replace_conditions") {
    const replacement = answers.maintenanceAction && answers.maintenanceAction !== "renew_green_card";
    return {
      title: replacement ? "Green Card Replacement or Correction" : "Green Card Renewal Application",
      subtitle: replacement ? "Commonly prepared using Form I-90 for replacement, correction, or card not received scenarios." : "Commonly prepared using Form I-90: Application to Replace Permanent Resident Card.",
      summary: "The portal will guide document collection, issue-specific evidence, identity details, and filing preparation for your green card service.",
      likelyForms: ["I-90"],
      category: replacement ? "green-card-replacement" : "green-card-renewal",
    };
  }
  if (answers.service === "citizenship") {
    const needsReview = answers.arrested === "yes" || answers.claimedCitizen === "yes" || answers.marriedToCitizen === "no" || answers.longTrips === "yes";
    return {
      title: needsReview ? "Citizenship Application with Attorney Review" : "United States Citizenship Application",
      subtitle: "Commonly prepared using Form N-400: Application for Naturalization.",
      summary: "We help organize residence history, travel history, taxes, eligibility checkpoints, document uploads, review notes, and final application preparation.",
      likelyForms: ["N-400"],
      category: "citizenship",
    };
  }
  if (answers.petitioner === "fiance") {
    return {
      title: "Fiance Visa Application",
      subtitle: "Commonly prepared using Form I-129F: Petition for Alien Fiance(e).",
      summary: "The platform guides relationship evidence, intent-to-marry evidence, biographic details, supporting documents, review, and next steps.",
      likelyForms: ["I-129F"],
      category: "fiance-visa",
    };
  }
  if (answers.petitioner === "spouse") {
    const outsideUs = answers.applicantLocation === "outside_us";
    return {
      title: outsideUs ? "Petition by Spouse Application" : "Marriage-Based Green Card Application",
      subtitle: outsideUs
        ? "Also known as Forms I-130 and I-130A: Petition for Alien Relative with Supplemental Information for Spouse Beneficiary."
        : "Commonly prepared using Forms I-130, I-130A, I-485, and I-864 for spouse-based adjustment of status.",
      summary: "Our software and support team guide you through every step to prepare, review, organize, and file your application package.",
      likelyForms: outsideUs ? ["I-130", "I-130A"] : ["I-130", "I-130A", "I-485", "I-864", "I-765", "I-131"],
      category: outsideUs ? "marriage-based-consular" : "marriage-based-adjustment",
    };
  }
  if (answers.greenCardType === "family_based") {
    return {
      title: "Family-Based Green Card Application",
      subtitle: "Commonly prepared using Form I-130 and related beneficiary forms.",
      summary: "We help identify the correct family category, petitioner requirements, supporting documents, and filing pathway.",
      likelyForms: ["I-130"],
      category: "family-based",
    };
  }
  if (answers.greenCardType === "employment_based" || answers.service === "work_visa") {
    const selectedWorkType = answers.workVisaType || answers.employmentPath;
    const labelMap = {
      h1b: "H-1B Specialty Occupation Petition",
      l1a: "L-1A Executive or Manager Transfer",
      l1b: "L-1B Specialized Knowledge Transfer",
      o1a: "O-1A Extraordinary Ability Strategy",
      o1b: "O-1B Arts, Film, or Television Strategy",
      tn: "TN Professional Visa Strategy",
      e2: "E-2 Treaty Investor Strategy",
      e1: "E-1 Treaty Trader Strategy",
      eb1a: "EB-1A Extraordinary Ability Green Card Strategy",
      eb2: "EB-2 Employment-Based Green Card Strategy",
      niw: "EB-2 National Interest Waiver Strategy",
      eb3: "EB-3 Employment-Based Green Card Strategy",
      extraordinary_ability: "Extraordinary Ability Immigration Strategy",
      national_interest: "EB-2 NIW Strategy",
      executive_transfer: "Executive or Manager Transfer Strategy",
      temporary_professional: "Temporary Professional Work Visa Strategy",
      employer_sponsored: "Employer-Sponsored Immigration Strategy",
    };
    const formMap = {
      h1b: ["I-129", "H Supplement"],
      l1a: ["I-129", "L Supplement"],
      l1b: ["I-129", "L Supplement"],
      o1a: ["I-129", "O Supplement"],
      o1b: ["I-129", "O Supplement"],
      tn: ["TN Package"],
      e2: ["DS-160", "E Treaty Package"],
      e1: ["DS-160", "E Treaty Package"],
      eb1a: ["I-140"],
      eb2: ["I-140"],
      niw: ["I-140"],
      eb3: ["I-140"],
      extraordinary_ability: ["I-140", "I-129"],
      national_interest: ["I-140"],
      executive_transfer: ["I-129", "I-140"],
      temporary_professional: ["I-129"],
      employer_sponsored: ["I-140", "I-129"],
    };
    return {
      title: labelMap[selectedWorkType] || "Employment Immigration Strategy",
      subtitle: "Potential pathways may include I-129, I-140, PERM-related steps, or supporting visa classifications.",
      summary: "Your case team will review employer details, qualifications, evidence strength, immigration history, and timing before final strategy selection.",
      likelyForms: formMap[selectedWorkType] || ["I-129", "I-140"],
      category: selectedWorkType || "employment-based",
    };
  }
  if (answers.service === "student_exchange") {
    const typeLabel = {
      f1: "F-1 Student Visa",
      j1: "J-1 Exchange Visitor Visa",
      m1: "M-1 Vocational Student Visa",
      opt: "OPT Employment Authorization",
      stem_opt: "STEM OPT Extension",
      cpt: "CPT Work Authorization Planning",
    }[answers.studentVisaType] || "Student, Exchange, or Training Visa Support";
    return {
      title: typeLabel,
      subtitle: "Common pathways include F-1, J-1, OPT, STEM OPT, CPT, and related status planning.",
      summary: "We help organize school documents, SEVIS readiness, program dates, employment authorization evidence, and status-maintenance details.",
      likelyForms: answers.studentVisaType === "opt" || answers.studentVisaType === "stem_opt" ? ["I-765"] : ["DS-160", "I-20/DS-2019"],
      category: answers.studentVisaType || "student-exchange",
    };
  }
  if (answers.service === "business_investor") {
    const pathwayTitle = {
      eb5: "EB-5 Investor Green Card Strategy",
      e2: "E-2 Treaty Investor Strategy",
      l1a: "L-1A New Office or Expansion Strategy",
      international_entrepreneur: "International Entrepreneur Strategy",
      startup_founder: "Startup Founder Immigration Strategy",
      us_expansion: "U.S. Expansion Immigration Strategy",
    }[answers.businessPathway] || "Business, Investor, or Founder Immigration Strategy";
    return {
      title: pathwayTitle,
      subtitle: "Potential pathways may include E-2, L-1, EB-1C, EB-2 NIW, EB-5, or founder-focused strategies depending on facts.",
      summary: "We help collect business, investment, ownership, job creation, funding, executive, and evidence data for attorney review.",
      likelyForms: answers.businessPathway === "eb5" ? ["I-526E", "I-829"] : ["I-129", "I-140", "DS-160"],
      category: answers.businessPathway || "business-investor",
    };
  }
  if (answers.greenCardType === "diversity_lottery") {
    return {
      title: "Diversity Visa Green Card Processing",
      subtitle: "Guidance for diversity visa selection, document readiness, and consular processing steps.",
      summary: "We help organize identity documents, civil documents, supporting evidence, timelines, and interview readiness.",
      likelyForms: ["DS-260"],
      category: "diversity-visa",
    };
  }
  return {
    title: "Immigration Case Strategy Review",
    subtitle: "Your answers point to a custom strategy review before selecting forms.",
    summary: "Our intake team will help identify the right pathway, required documents, service level, and next steps.",
    likelyForms: [],
    category: "strategy-review",
  };
}

function getRequiredDocuments(answers, result) {
  const base = ["Passport biographic page", "Current immigration status evidence", "Government-issued identification"];
  const documentMap = {
    "green-card-renewal": ["Green Card front and back", "Recent address history", "USCIS online account information if available"],
    "green-card-replacement": ["Green Card copy if available", "Police report if lost or stolen", "Evidence supporting correction if applicable"],
    "marriage-conditions-removal": ["Green Card front and back", "Marriage certificate", "Joint residence evidence", "Joint financial records", "Photos and relationship evidence"],
    citizenship: ["Green Card front and back", "Tax returns", "Travel history", "Marriage certificate if applying under 3-year rule", "Certified court records if applicable"],
    "fiance-visa": ["Proof of meeting in person", "Relationship evidence", "Intent to marry statements", "Petitioner proof of status"],
    "marriage-based-consular": ["Marriage certificate", "Proof of petitioner's status", "Relationship evidence", "Civil documents", "Passport photos"],
    "marriage-based-adjustment": ["Marriage certificate", "I-94 record", "Proof of lawful entry", "Financial support evidence", "Medical exam planning"],
    "family-based": ["Proof of qualifying relationship", "Petitioner status evidence", "Civil documents", "Passport photos"],
    h1b: ["Passport", "Resume", "Degree and transcripts", "Employer support letter", "Job description", "Experience letters"],
    l1a: ["Passport", "Resume", "Foreign employment proof", "Company relationship documents", "Organizational charts"],
    l1b: ["Passport", "Resume", "Specialized knowledge evidence", "Foreign employment proof", "Company relationship documents"],
    o1a: ["Resume", "Awards", "Publications", "Media coverage", "Letters of recommendation", "Evidence of original contributions"],
    o1b: ["Resume", "Press or reviews", "Contracts", "Awards", "Production credits", "Recommendation letters"],
    eb2: ["Degrees", "Experience letters", "Employer documents", "PERM or NIW evidence", "Resume"],
    eb3: ["Degrees or training evidence", "Experience letters", "Employer documents", "PERM evidence", "Resume"],
    f1: ["Passport", "I-20", "SEVIS payment receipt", "School admission letter", "Financial support evidence"],
    j1: ["Passport", "DS-2019", "SEVIS payment receipt", "Program sponsor documents", "Financial support evidence"],
    m1: ["Passport", "I-20", "SEVIS payment receipt", "Vocational program documents", "Financial support evidence"],
    opt: ["Passport", "I-20 with OPT recommendation", "I-94", "Prior EAD if any", "Graduation evidence"],
    stem_opt: ["Passport", "STEM OPT I-20", "I-983 training plan", "E-Verify employer details", "Current EAD"],
    eb5: ["Source of funds evidence", "Investment records", "Bank statements", "Business plan", "Job creation evidence"],
    e2: ["Treaty nationality proof", "Investment evidence", "Business plan", "Ownership documents", "Source of funds evidence"],
    startup_founder: ["Incorporation documents", "Funding evidence", "Revenue evidence", "Investor support", "Patents or product evidence"],
  };
  return [...new Set([...base, ...(documentMap[result?.category] || documentMap[answers.workVisaType] || documentMap[answers.studentVisaType] || documentMap[answers.businessPathway] || [])])];
}

function buildCasePayloadFromIntake(answers, result, servicePackage) {
  const visaTypeMap = {
    "green-card-renewal": "I-90",
    "green-card-replacement": "I-90",
    "marriage-conditions-removal": "I-751",
    "investor-conditions-removal": "I-829",
    citizenship: "N-400",
    "fiance-visa": "K-1",
    "marriage-based-consular": "I-130",
    "marriage-based-adjustment": "I-130/I-485",
    "family-based": "I-130",
    "diversity-visa": "DV",
    h1b: "H-1B",
    l1a: "L-1A",
    l1b: "L-1B",
    o1a: "O-1A",
    o1b: "O-1B",
    tn: "TN",
    e2: "E-2",
    e1: "E-1",
    eb1a: "EB-1A",
    eb2: "EB-2",
    niw: "EB-2 NIW",
    eb3: "EB-3",
    eb5: "EB-5",
    f1: "F-1",
    j1: "J-1",
    m1: "M-1",
    opt: "OPT",
    stem_opt: "STEM OPT",
    cpt: "CPT",
    startup_founder: "Startup Founder",
    us_expansion: "U.S. Expansion",
    international_entrepreneur: "International Entrepreneur",
    employer_sponsored: "Employment-Based",
    extraordinary_ability: "O-1/EB-1",
    national_interest: "EB-2 NIW",
    executive_transfer: "L-1",
    temporary_professional: "H-1B",
  };
  // green_card_or_fiance is one top-level service covering three very
  // different sub-paths (family/employment/diversity) - the category must
  // follow the actual greenCardType answer, not default to "family" for all
  // three, or an employment-based green card case gets mis-tagged as family.
  const greenCardCategoryMap = {
    family_based: "family",
    employment_based: "employment",
    diversity_lottery: "diversity",
  };
  const categoryMap = {
    green_card_or_fiance: greenCardCategoryMap[answers.greenCardType] || "family",
    renew_replace_conditions: "permanent_resident_card",
    citizenship: "naturalization",
    work_visa: "employment",
    student_exchange: "student_exchange",
    business_investor: "business_investor",
  };
  const selectedKey = result?.category || answers.workVisaType || answers.studentVisaType || answers.businessPathway || answers.employmentPath;
  const visaType = visaTypeMap[selectedKey] || result?.likelyForms?.[0] || "Strategy Review";
  return {
    visaType,
    visaCategory: categoryMap[answers.service] || result?.category || "immigration",
    caseType: result?.category || "immigration",
    petitionType: result?.title,
    petitionSubType: selectedKey,
    package: servicePackage.planKey || servicePackage.key || "",
    plan: {
      tier: servicePackage.planKey,
      selectedAt: new Date().toISOString(),
      paymentStatus: "not_started",
      amount: servicePackage.amountCents,
      currency: "USD",
    },
    status: "pending_assignment",
    stage: "intake",
    priority: answers.urgency === "immediate" ? "high" : "medium",
    primaryApplicant: answers.primaryApplicant,
    assessmentAnswers: answers,
    assessmentMatchPercentage: 100,
    notes: result?.summary,
    legacySource: "BAIS",
  };
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
  const { hasCase, loading: hasCaseLoading } = useHasCase();
  // Brand-new for every client, every time — no cross-case/cross-user
  // localStorage carryover (that was the root cause of stale pre-populated
  // answers and the "jump straight to the package screen" bug below).
  const [answers, setAnswers] = useState({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedPackage, setSelectedPackage] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [showResult, setShowResult] = useState(false);
  const visibleSteps = SERVICE_STEPS.filter((step) => isStepVisible(step, answers));
  const currentStep = visibleSteps[currentIndex];
  const isComplete = visibleSteps.length > 0 && visibleSteps.every((step) => answers[step.key]);
  const result = isComplete && showResult ? computeIntakeResult(answers) : null;
  const requiredDocuments = result ? getRequiredDocuments(answers, result) : [];
  const completion = Math.round((visibleSteps.filter((step) => answers[step.key]).length / Math.max(visibleSteps.length, 1)) * 100);

  useEffect(() => {
    document.title = "Immigration Intake | BAIS";
  }, []);

  // Invited employees complete only their own checklist (Documents page) —
  // the visa-selection/plan/checkout intake wizard is not part of their flow.
  // A client whose case was already opened by staff (INSZoom's "New Case")
  // has no reason to run the self-registration questionnaire either — send
  // them straight to their dashboard instead.
  useEffect(() => {
    if (isEmployeeAccount(user)) {
      navigate("/dashboard/documents", { replace: true });
      return;
    }
    if (!hasCaseLoading && hasCase) {
      navigate("/dashboard", { replace: true });
    }
  }, [user, navigate, hasCase, hasCaseLoading]);

  useEffect(() => {
    if (currentIndex > visibleSteps.length - 1) setCurrentIndex(Math.max(visibleSteps.length - 1, 0));
    if (!isComplete) setShowResult(false);
  }, [answers, currentIndex, visibleSteps.length, isComplete]);

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
    setMessage("");
    setTimeout(() => {
      const nextSteps = SERVICE_STEPS.filter((step) => isStepVisible(step, nextAnswers));
      const nextComplete = wasOnLastStep && nextSteps.length > 0 && nextSteps.every((step) => nextAnswers[step.key]);
      if (nextComplete) {
        setShowResult(true);
        return;
      }
      setCurrentIndex((index) => Math.min(index + 1, nextSteps.length - 1));
    }, 120);
  };

  const restart = () => {
    setAnswers({});
    setSelectedPackage("");
    setCurrentIndex(0);
    setShowResult(false);
    setMessage("");
  };

  const choosePackage = async (servicePackage) => {
    setSelectedPackage(servicePackage.key);
    const documentsForCase = getRequiredDocuments(answers, result);
    const payload = {
      answers,
      result,
      package: servicePackage,
      requiredDocuments: documentsForCase,
      completedAt: new Date().toISOString(),
      source: "dashboard_intake",
    };
    localStorage.setItem("bais_intake_selection", JSON.stringify(payload));
    if (!tokenStore.getAccess()) {
      navigate(`/signup?source=intake&service=${encodeURIComponent(result?.category || "strategy-review")}&package=${servicePackage.planKey || servicePackage.key}`);
      return;
    }
    setSaving(true);
    try {
      const caseResponse = await casesApi.create(buildCasePayloadFromIntake(answers, result, servicePackage));
      const createdCase = caseResponse?.case || caseResponse?.data?.case || caseResponse?.data || caseResponse;
      localStorage.setItem("bais_active_case_id", createdCase?._id || "");
      navigate("/dashboard", { state: { intakeSelection: payload, caseId: createdCase?._id } });
    } catch (error) {
      setMessage(error.message || "Unable to create your case. Please try again or contact support.");
    } finally {
      setSaving(false);
    }
  };

  // Redirect effect above fires for an employee or an already-cased client;
  // render nothing while that's still resolving instead of flashing the quiz.
  if (hasCaseLoading && user) return null;

  // ── Package/plan screen, shown after the last question ──────────────────
  if (result) {
    return (
      <div className="min-h-screen bg-white">
        <header className="border-b border-slate-100">
          <div className="mx-auto max-w-3xl px-6 py-5">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Recommended starting point</p>
            <h1 className="text-xl font-bold text-slate-900">{result.title}</h1>
            <p className="mt-1 text-sm text-slate-500">{result.subtitle}</p>
          </div>
        </header>

        <main className="mx-auto max-w-3xl px-6 py-10">
          {result.likelyForms.length > 0 && (
            <div className="mb-6 flex flex-wrap gap-1.5">
              {result.likelyForms.map((form) => (
                <span key={form} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">{form}</span>
              ))}
            </div>
          )}
          <p className="text-sm leading-6 text-slate-600">{result.summary}</p>

          {requiredDocuments.length > 0 && (
            <div className="mt-6 rounded-xl border border-slate-100 bg-slate-50 p-4">
              <p className="text-[0.65rem] font-bold uppercase tracking-widest text-slate-400 mb-2.5">Likely required documents</p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {requiredDocuments.map((documentName) => (
                  <div key={documentName} className="flex items-center gap-2 text-xs font-medium text-slate-600">
                    <IconCheckmark size={12} className="text-slate-400 shrink-0" />
                    {documentName}
                  </div>
                ))}
              </div>
            </div>
          )}

          <h2 className="mt-10 mb-4 text-sm font-bold text-slate-900">Choose your service level</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {SERVICE_PACKAGES.map((servicePackage) => (
              <div key={servicePackage.key}
                className={`relative rounded-2xl border p-5 ${servicePackage.badge ? "border-slate-900" : "border-slate-200"}`}>
                {servicePackage.badge && (
                  <span className="absolute -top-2.5 left-5 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    {servicePackage.badge}
                  </span>
                )}
                <h3 className="text-sm font-bold text-slate-900">{servicePackage.label}</h3>
                <p className="mt-1.5 text-2xl font-bold text-slate-900">{servicePackage.price}</p>
                <p className="mt-1 text-xs text-slate-500 min-h-8">{servicePackage.tagline}</p>
                <ul className="mt-4 space-y-1.5">
                  {servicePackage.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-1.5 text-xs text-slate-600">
                      <IconCheckmark size={13} className="text-slate-400 shrink-0 mt-0.5" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => choosePackage(servicePackage)}
                  className="mt-5 w-full rounded-lg bg-slate-900 px-3.5 py-2.5 text-xs font-bold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 transition"
                >
                  {selectedPackage === servicePackage.key && saving ? "Saving…" : "Select"}
                </button>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[0.7rem] text-slate-400">
            *Packages and pricing do not include required government fees, paid directly to USCIS or the relevant agency upon filing.
          </p>
          {message && <p className="mt-3 rounded-lg bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-700">{message}</p>}

          <div className="mt-8 flex items-center gap-4">
            <button type="button" onClick={() => { setShowResult(false); setCurrentIndex(Math.max(visibleSteps.length - 1, 0)); }}
              className="text-xs font-semibold text-slate-500 hover:text-slate-700">
              ← Back to questions
            </button>
            <button type="button" onClick={restart} className="text-xs font-semibold text-slate-400 hover:text-slate-600">
              Start over
            </button>
          </div>
        </main>
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
                      currentStep.key === "service" && option.value === "cos_extension_ead"
                        ? navigate("/dashboard/filing-type")
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
            {message && <p className="text-xs font-semibold text-amber-600">{message}</p>}
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

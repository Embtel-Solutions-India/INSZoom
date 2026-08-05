// Converts the single-party filing-type registry (Backend/src/config/
// filingTypes.js) into MINIMAL SCAFFOLD Questionnaire/Question template
// definitions, in the same shape as questionnaire.service.js's
// VISA_TEMPLATE_DEFINITIONS. Mirrors employmentChecklists.js's/
// familyChecklists.js's conversion pattern, but is its own separate,
// self-contained file — no shared helpers imported from either of those, so
// the two existing two-party paths are never touched or depended on here.
//
// SCAFFOLD NOTICE: every checklist below is a temporary placeholder (a
// handful of fields), not real content — this task builds the mechanism
// (registry, single-checklist auto-assignment, selection UX, guardrails)
// only. Real per-filing-type content is authored in follow-up prompts, one
// filing type at a time, exactly like the K-1/K-3 visa work. Shared/reusable
// sections (applicant bio, current status, I-94, passport, maintaining-
// status evidence) are meant to be authored ONCE, later, and composed per
// filing type — not duplicated per filing type up front.
//
// Single-party model: exactly ONE checklist role per filing type (the
// applicant themselves — `checklistRole: "client"`, mirroring the existing
// single-party precedent of h1b_questionnaire/o1a_questionnaire/eb1a_
// questionnaire/niw_questionnaire/i907_premium_processing_profile, none of
// which have a second-party counterpart checklist). No petitioner/
// beneficiary/employer/employee role, no invite.

const { listFilingTypes } = require("../../config/filingTypes");

const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];

function slugSection(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function buildQuestion(key, label, type, sectionTitle, order, extras = {}) {
  return {
    key,
    label,
    type,
    sectionKey: slugSection(sectionTitle),
    pageKey: slugSection(sectionTitle),
    order,
    required: Boolean(extras.required),
    description: extras.description,
    options: (extras.options || []).map((value) => (typeof value === "object" ? value : { label: value, value })),
    evidenceCategory: extras.evidenceCategory,
    metadata: extras.metadata || {},
    visibility: extras.visibility || {},
    conditionalLogic: extras.conditionalLogic || { mode: "all", rules: [], groups: [] },
    repeatable: false,
  };
}

// Every scaffold checklist gets the SAME minimal shape: a couple of bio
// fields plus one placeholder document — just enough to prove assignment/
// access/gating end-to-end, deliberately not modeling any filing-type-
// specific content yet.
function buildScaffoldChecklist(filingType) {
  const visibility = { roles: ["client", ...STAFF_ROLES], portals: ["client", "admin"] };
  const fieldSection = "Applicant Information (Scaffold)";
  const docSection = "Applicant Documents (Scaffold)";
  const fields = [
    buildQuestion(`${filingType.key.toLowerCase()}_fullName`, `Applicant Full Legal Name (scaffold) — ${filingType.label}`, "text", fieldSection, 1, { required: true, metadata: { sourcePath: "applicant.fullName", scaffold: true }, visibility }),
    buildQuestion(`${filingType.key.toLowerCase()}_currentStatus`, "Current Immigration Status (scaffold)", "text", fieldSection, 2, { metadata: { sourcePath: "applicant.currentStatus", scaffold: true }, visibility }),
  ];
  const docs = [
    buildQuestion(`${filingType.key.toLowerCase()}_scaffold_passport`, "Placeholder: Copy of Passport (scaffold)", "file", docSection, 1, {
      description: "Temporary scaffold document — replace with real content in a follow-up prompt.",
      required: true,
      evidenceCategory: "identity",
      metadata: { documentType: `${filingType.key.toLowerCase()}_scaffold_passport`, category: "identity", scaffold: true },
      visibility,
    }),
  ];
  return {
    key: filingType.questionnaireKey,
    title: `${filingType.label} — Applicant Checklist (Scaffold)`,
    visaType: filingType.visaType,
    checklistRole: "client",
    isDefault: true,
    description: "TEMPORARY SCAFFOLD — real content authored in a follow-up prompt.",
    sections: [fieldSection, docSection],
    questions: [...fields, ...docs],
  };
}

const SINGLE_PARTY_FILING_DEFINITIONS = listFilingTypes().map(buildScaffoldChecklist);

module.exports = { SINGLE_PARTY_FILING_DEFINITIONS, buildScaffoldChecklist };

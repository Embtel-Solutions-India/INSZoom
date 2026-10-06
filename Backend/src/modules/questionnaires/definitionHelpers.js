// Small builders shared by every code-defined checklist (employmentChecklists.js
// and permChecklists.js) so there is exactly ONE definition of what a built
// Question looks like. Moved verbatim out of employmentChecklists.js.

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
    // Omitted entirely (not even as an empty object) when a question has no
    // canonical mapping, so questionnaire.service.js's reconciliation only
    // ever touches/patches the handful of questions that actually carry one.
    ...(extras.mapping ? { mapping: extras.mapping } : {}),
    // Optional per-question validation (regex / min / max / ...), evaluated by
    // questionnaire.service.js validateQuestionValue on the server and by the
    // client's questionnaireEngine.validateQuestion.
    ...(extras.validationRules ? { validationRules: extras.validationRules } : {}),
    visibility: extras.visibility || {},
    conditionalLogic: extras.conditionalLogic || { mode: "all", rules: [], groups: [] },
    repeatable: Boolean(extras.repeatable),
    ...(extras.repeatableConfig ? { repeatableConfig: extras.repeatableConfig } : {}),
  };
}

module.exports = { slugSection, buildQuestion };

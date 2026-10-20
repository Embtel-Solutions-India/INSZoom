// A case created from now on starts with NO forms: every USCIS form is added by its Case Manager ("Manage forms" -> Add form), who then fills it from the
// case's checklists. Cases that already exist are untouched (their formSelectionMode stays "legacy" / unset and they behave exactly as before).
// Spread into the Case.create payload of every route that creates a case; tests that build a case directly with Case.create keep the automatic behaviour.
const NEW_CASE_FORM_SELECTION = Object.freeze({ formSelectionMode: "manual" });

module.exports = { NEW_CASE_FORM_SELECTION };

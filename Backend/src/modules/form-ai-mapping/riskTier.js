// Risk tiering (plan decision 3), pure. A suggestion is one of:
//   auto_use      an unambiguous, low-risk TEXT mapping that passed EVERY independent check; or a risky box (see RISKS) that a trusted sibling form or a verified golden fixture
//                 corroborates (the corroboration also supplies the transform / condition, since a tick box or drop-down needs more than a path)
//   needs_review  anything ambiguous, anything risky that nothing corroborates, any box with no label to go on, any soft check that failed
//   rejected      a hard failure: not in the registry, an incompatible type, a contradicting party, a box that is never filled, a bad shape
// The model's own score is never an input here.
const { widgetKind } = require("../form-mapping/golden/humanize");

const TEXT_KINDS = new Set(["text", "textarea", "number", "date", "phone", "email"]);
const ADDRESS_PATH = /(address|line1|line2|street|city|zip|postal|province|country|unit|aptSte|state)\b/i;
const ADDRESS_LABEL = /\b(street|city|town|state|zip|postal|province|country|apt|suite|floor|in care of|mailing|physical address|address)\b/i;
const IDENTITY_PATH = /(ssn|socialSecurity|aNumber|alienNumber|alienRegistration|uscisNumber|taxId)/i;
const IDENTITY_LABEL = /(social security|a-?number|alien registration|\bssn\b|uscis number)/i;
const OTHER_PARTY_PATH = /(spouse|father|mother|child|children|parent|sibling|signatory|preparer|interpreter|attorney|representative|sponsor|principalImmigrant|pointOfContact|contactPerson|otherNames|physicalAddressDetail|prior)/i;
const CONDITIONAL_LABEL = /\b(if applicable|if any|if you|if yes|if "yes"|if checked|if selected|only if|if item)\b/i;

/** The kind of box as the tiering sees it: text | textarea | number | date | phone | email | checkbox | radio | dropdown (from the scanned field type). */
function kindOf(box = {}) {
  const type = String(box.type || box.fieldType || "text").toLowerCase();
  if (["textarea", "number", "phone", "email"].includes(type)) return type;
  return widgetKind(type);
}

/** Is this box one of a repeated group (a row of a table, the 2nd / 3rd copy of a name block)? */
function isRepeated(box = {}) {
  if (box.repeatable === true || box.repeated === true) return true;
  const stem = String(box.targetPdfField || box.pdfName || "").split(".").pop().replace(/\[\d+\]$/, "");
  return /[A-Za-z_]([2-9])$/.test(stem);
}

/** Is this box only meaningful under a condition (its own script, a stated dependency, "if applicable" wording)? */
function isConditional(box = {}) {
  return Boolean((box.dependencies || []).length || box.readOnly || CONDITIONAL_LABEL.test(String(box.label || box.fieldLabel || "")));
}

/** The risk flags of a box + candidate path (decision 3's list). */
function riskFlags(box = {}, candidate = {}) {
  const flags = [];
  const kind = kindOf(box);
  const path = String(candidate?.path || "");
  const label = String(box.label || box.fieldLabel || "");
  if (["checkbox", "radio", "dropdown"].includes(kind)) flags.push(kind);
  if (ADDRESS_PATH.test(path.split(".").slice(-2).join(".")) || ADDRESS_LABEL.test(label)) flags.push("address_block");
  if (IDENTITY_PATH.test(path) || IDENTITY_LABEL.test(label)) flags.push("ssn_or_anumber");
  if (OTHER_PARTY_PATH.test(path)) flags.push("other_party");
  if (isRepeated(box) || candidate?.cardinality === "many" || /\[\]|\.\d+\./.test(path)) flags.push("repeating");
  if (isConditional(box)) flags.push("conditional");
  return [...new Set(flags)];
}

/**
 * @param box           the scanned template field
 * @param candidate     { path, cardinality? } or null
 * @param validation    CandidateValidator's result: { hard: [codes], soft: [codes] }
 * @param corroboration null, or { source: "sibling_form" | "golden_fixture", path } - it must name the SAME path the model chose
 * @returns { tier, reasons[], risks[], corroboratedBy }
 */
function tierOf({ box = {}, candidate = null, validation = { hard: [], soft: [] }, corroboration = null, missingLabel = false } = {}) {
  if (missingLabel) return { tier: "needs_review", reasons: ["missing_label"], risks: [], corroboratedBy: null };
  if (validation.hard?.length) return { tier: "rejected", reasons: [...validation.hard], risks: [], corroboratedBy: null };
  if (!candidate?.path) return { tier: "needs_review", reasons: ["no_candidate"], risks: [], corroboratedBy: null };
  const risks = riskFlags(box, candidate);
  const reasons = [...(validation.soft || [])];
  const corroborated = Boolean(corroboration && corroboration.path === candidate.path);
  if (risks.length && !corroborated) reasons.push(...risks.map((risk) => `risky_${risk}_uncorroborated`));
  if (!risks.length && !TEXT_KINDS.has(kindOf(box))) reasons.push("not_a_text_box");
  if (reasons.length) return { tier: "needs_review", reasons, risks, corroboratedBy: corroborated ? corroboration.source : null };
  return { tier: "auto_use", reasons: [], risks, corroboratedBy: corroborated ? corroboration.source : null };
}

module.exports = { kindOf, isRepeated, isConditional, riskFlags, tierOf, TEXT_KINDS };

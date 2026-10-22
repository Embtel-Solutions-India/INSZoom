// Phase 7.4 - classifies ONE form field of an exact edition, with a stored, readable reason. Pure: no database, no network, nothing is changed.
//
//   mapped               an ACTIVE mapping edge fills it
//   non_data             not a box the system fills with client data: USCIS-use-only / office-use, signature, barcode, instruction text, the interpreter's and the preparer's
//                        own boxes, a box the editor locks for good (computed / unfillable)
//   deliberately_blank   a person decided it stays empty (graph.keepBlank), OR the system left it empty because no source can be established AND it is optional, is not
//                        required, has no party role and no condition. The reason text says which.
//   conditional          appears only when a condition holds (showWhen / conditionalLogic); whether it applies is unknown until a case exists
//   unmapped_needs_source  everything else: a box that speaks about a person (a protected role), or is required, or whose party is ambiguous, with no active edge
//
// The party a box speaks about comes from its OWN label / section / PDF name through the contract validator's `partyOfText` (reused, not reimplemented); the finer role
// words (employer, dependent) only refine the report.
const { partyOfText, classifyUnmapped } = require("../contract/MappingContractValidator");
const { isProtectedField } = require("../../form-generation/services/ProtectedFieldPolicy");
const { isInterpreterOrPreparerField } = require("../config/blankFieldPolicy");
const { keepsLock, isBarcodeField, isSignatureField } = require("../../uscis-forms/field-lock-policy");

const lower = (value) => String(value ?? "").toLowerCase();
const CLASSES = Object.freeze(["mapped", "non_data", "deliberately_blank", "conditional", "unmapped_needs_source"]);

/** The field's own ids and facts, whether it came from template.formFields or from MappingGraphService.getTemplateFields. */
function facts(field = {}) {
  const id = field.targetFieldId || field.fieldId || field.id || field.fieldName || null;
  const pdf = field.targetPdfField || field.pdfFieldName || field.fieldName || field.originalName || null;
  const label = field.label || field.fieldLabel || field.normalizedName || null;
  return {
    id: id == null ? null : String(id),
    pdfField: pdf == null ? null : String(pdf),
    label: label == null ? "" : String(label),
    type: lower(field.type || field.fieldType || field.semanticType || field.pdfFieldType || "text"),
    section: field.section || field.sectionTitle || field.sectionKey || "",
    page: field.pageNumber ?? field.page ?? null,
    required: Boolean(field.required || field.validation?.required || field.validationRules?.required),
    condition: field.showWhen || field.conditionalLogic || null,
    options: Array.isArray(field.options) ? field.options.map((option) => lower(typeof option === "object" ? option?.value ?? option?.label : option)).sort() : [],
  };
}

/** The party the box is about: petitioner / beneficiary / both-or-unclear, refined to employer / dependent / applicant for the report. */
function roleOf(field = {}) {
  const f = facts(field);
  const text = [f.label, f.section, String(f.pdfField || "").split(".").pop()].join(" ");
  const party = partyOfText(text);
  const lowered = lower(text);
  const mentionsBoth = /\b(petitioner|employer|sponsor|company|organization)\b/.test(lowered) && /\b(beneficiary|applicant|worker|employee|alien)\b/.test(lowered);
  if (party === "petitioner") return { role: /\bemployer\b/.test(lowered) ? "employer" : "petitioner", party, unclear: false };
  if (party === "beneficiary") return { role: /\b(dependent|spouse|child|derivative)\b/.test(lowered) ? "dependent" : /\bapplicant\b/.test(lowered) ? "applicant" : "beneficiary", party, unclear: false };
  if (mentionsBoth) return { role: "unknown", party: null, unclear: true }; // names both sides: the party cannot be told
  return { role: "none", party: null, unclear: false };
}

/**
 * ctx: { mappedIds:Set (ids with an ACTIVE edge), pendingIds:Set (ids with a non-active edge), keptBlank:Map|Set (ids), formCode }
 * Returns { id, pdfField, label, page, type, class, reason, role, required, conditional, condition?, protectedRole, roleUnknown }.
 */
function classifyField(field, ctx = {}) {
  const f = facts(field);
  const { role, party, unclear } = roleOf(field);
  const base = { id: f.id, pdfField: f.pdfField, label: f.label, page: f.page, type: f.type, role, required: f.required, conditional: Boolean(f.condition) };
  const protectedRole = Boolean(party);
  const done = (cls, reason, extra = {}) => ({ ...base, class: cls, reason, protectedRole, roleUnknown: unclear, ...(f.condition ? { condition: f.condition } : {}), ...extra });

  if (f.id && ctx.mappedIds?.has(f.id)) return done("mapped", "an active mapping edge fills this box");

  const blank = ctx.keptBlank;
  const kept = blank && (blank.has ? blank.has(f.id) : false);
  if (kept) {
    const entry = blank.get ? blank.get(f.id) : null;
    return done("deliberately_blank", entry?.reason ? `a person decided this box stays empty: ${entry.reason}` : "a person decided this box stays empty (kept blank)");
  }

  // not client data: decided from the box itself, never from the mapping
  const nonData = nonDataReason(field, f, ctx.formCode);
  if (nonData) return done("non_data", nonData);

  if (f.condition) {
    return done("conditional", f.required ? "required when its condition holds; no mapping fills it yet" : "appears only when its condition holds; no mapping fills it yet");
  }

  const pending = f.id && ctx.pendingIds?.has(f.id) ? " (a mapping edge exists but still needs review)" : "";
  if (protectedRole) return done("unmapped_needs_source", `the box speaks about the ${role} and no active mapping fills it${pending}`);
  if (unclear) return done("unmapped_needs_source", `the box names both parties, so who it is about cannot be told, and no active mapping fills it${pending}`);
  if (f.required) return done("unmapped_needs_source", `the box is required and no active mapping fills it${pending}`);
  if (pending) return done("unmapped_needs_source", `a mapping edge exists but still needs review${pending}`);
  return done("deliberately_blank", "optional box with no party role and no condition; no canonical source can be established, so the system leaves it empty");
}

function nonDataReason(field, f, formCode) {
  if (field.uscisUseOnly === true) return "for USCIS use only";
  if (isSignatureField(field) || /signature/.test(lower(`${f.label} ${f.pdfField}`)) || /signature/.test(f.type)) return "a signature box: signed by a person, never filled by the system";
  if (isBarcodeField(field) || /barcode/.test(lower(f.type))) return "a barcode box printed by USCIS";
  if (["button", "pushbutton", "image"].includes(f.type)) return `a ${f.type} control, not a data box`;
  if (isInterpreterOrPreparerField({ ...field, fieldName: f.pdfField || field.fieldName, label: f.label })) return "the interpreter's or the preparer's own box: never filled by the system";
  try { if (isProtectedField(f.pdfField, formCode, field)) return "a protected box (USCIS-use-only / signature / barcode by name)"; } catch { /* a policy lookup failure never makes a box data */ }
  if (classifyUnmapped({ ...field, label: f.label, required: false, validation: undefined, validationRules: undefined }) === "out_of_scope") return "for office use";
  if ((field.readOnly || field.readonly) && keepsLock(field)) return "locked for good (computed or unfillable)";
  return null;
}

module.exports = { CLASSES, facts, roleOf, classifyField, nonDataReason };

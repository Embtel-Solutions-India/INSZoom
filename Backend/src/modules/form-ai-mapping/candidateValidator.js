// Independent code validation of ONE model candidate (plan Phase 4): the model proposes, this file decides what can be believed. Pure given its context (no database, no model).
// Every check is recorded ({ ok, detail }) with the suggestion, so a person can see why a candidate is or is not trusted.
//
//   hard failures (the suggestion is rejected)       soft failures (the suggestion needs a person)
//   not_in_registry                                    label_evidence_missing   the quoted label text is not on the box
//   type_incompatible                                  label_path_unrelated     the box text and the path share no word at all
//   party_contradiction                                party_unconfirmed        the path belongs to a party but the box does not say whose it is
//   blank_policy_box / kept_blank / unfillable_box     no_checklist_source      no applicable checklist collects this path
//   contract_violation                                 existing_edge_differs    a live edge already maps this box elsewhere
//                                                      contract_unchecked       the live path universe could not be loaded
const { partyOfText, partyOfPath, checkEdge } = require("../form-mapping/contract/MappingContractValidator");
const { isInterpreterOrPreparerField } = require("../form-mapping/config/blankFieldPolicy");
const { canReplace } = require("../form-mapping/contract/MappingPolicy");
const { tokensOf } = require("./registrySlice");
const { kindOf } = require("./riskTier");

const ROLE_SIDE = { petitioner: "petitioner", employer: "petitioner", beneficiary: "beneficiary", applicant: "beneficiary" };
const UNFILLABLE = /signature|barcode|pdf417|button|image/i;
const norm = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const boxText = (box) => [box.label || box.fieldLabel, box.section, String(box.targetPdfField || "").split(".").pop(), ...(box.neighbors || [])].filter(Boolean).join(" ");

/** The side of the form a registry path is about: from the path's own root, else from the registry entry's role; null for case / other paths. */
const sideOfPath = (path, entry) => partyOfPath(path) || ROLE_SIDE[entry?.role] || null;

function typeCompatible(kind, entry, path) {
  const type = String(entry.type || "text").toLowerCase();
  const tail = String(path).split(".").pop();
  const booleanish = /bool|check|flag|yes/.test(type) || /^(is|has|wants|does|needs|uses|will|was|are|ever)[A-Z]/.test(tail);
  if (["text", "textarea", "phone", "email"].includes(kind)) return !/^(array|object)$/.test(type) && !booleanish;
  if (kind === "number") return /number|currency|text/.test(type) && !booleanish;
  if (kind === "date") return /date/.test(type) || /date/i.test(tail);
  if (kind === "checkbox" || kind === "radio") return booleanish || /select|choice|enum|text/.test(type); // a tick box can be driven by a text answer through a transform; the tier decides
  return true; // dropdown: any text-like source can be matched to a choice by the renderer
}

/**
 * ctx: { registry: { entries: Map }, slicePaths: Set (the paths the model was shown for this batch), edgesByTarget: Map, questionPaths: Set, universe }
 * Returns { ok, hard[], soft[], checks, existingEdge }.
 */
function validateCandidate({ box, item, ctx }) {
  const checks = {};
  const hard = [];
  const soft = [];
  const record = (name, ok, detail, failure) => { checks[name] = { ok, ...(detail ? { detail } : {}) }; if (!ok && failure) (failure.startsWith("hard:") ? hard : soft).push(failure.replace(/^(hard|soft):/, "")); };
  const path = item?.candidatePath;
  const kind = kindOf(box);
  const text = boxText(box);

  if (isInterpreterOrPreparerField({ fieldName: box.targetPdfField, pdfFieldName: box.targetPdfField, label: box.label || box.fieldLabel, fieldLabel: box.label || box.fieldLabel })) record("blank_policy", false, "interpreter / preparer boxes are never filled", "hard:blank_policy_box");
  else record("blank_policy", true);
  if (UNFILLABLE.test(`${box.targetPdfField || ""} ${box.type || ""}`)) record("fillable", false, "signature / barcode / button", "hard:unfillable_box");
  else record("fillable", true);
  if (ctx.keptBlank?.has(box.targetFieldId)) record("kept_blank", false, "a person decided this box stays empty", "hard:kept_blank");
  else record("kept_blank", true);
  if (!path) return { ok: hard.length === 0, hard, soft, checks, existingEdge: null };

  const entry = ctx.registry.entries.get(path);
  if (!entry || (ctx.slicePaths && !ctx.slicePaths.has(path))) { record("registry_membership", false, entry ? "not one of the paths offered for this box" : "not a path of the live registry", "hard:not_in_registry"); return { ok: false, hard, soft, checks, existingEdge: null }; }
  record("registry_membership", true);

  record("type_compat", typeCompatible(kind, entry, path), `${kind} box <- ${entry.type} path`, "hard:type_incompatible");

  const boxSide = partyOfText(text);
  const pathSide = sideOfPath(path, entry);
  if (boxSide && pathSide && boxSide !== pathSide) record("party_role", false, `the box speaks about the ${boxSide}, the path belongs to the ${pathSide}`, "hard:party_contradiction");
  else if (pathSide && !boxSide) record("party_role", false, "the box does not say whose data it asks for", "soft:party_unconfirmed");
  else record("party_role", true, pathSide ? `${pathSide}` : "no party claim");

  const evidence = norm(item.labelEvidence);
  const evidenceOk = item.reasonCode === "none" || (evidence.length >= 3 && norm(text).includes(evidence));
  record("label_evidence", evidenceOk, evidenceOk ? undefined : "the quoted label text is not on the box", "soft:label_evidence_missing");

  const wanted = tokensOf(text);
  const related = [...wanted].some((token) => entry.tokens.has(token));
  record("section_label_consistency", related, related ? undefined : "no word of the box text appears in the path, its aliases or its description", "soft:label_path_unrelated");

  const covered = ctx.questionPaths && ctx.questionPaths.size > 0 && [...ctx.questionPaths].some((q) => q === path || q.startsWith(`${path}.`) || path.startsWith(`${q}.`));
  record("questionnaire_coverage", Boolean(covered), covered ? undefined : "no applicable checklist question collects this path", "soft:no_checklist_source");

  const existing = ctx.edgesByTarget?.get(box.targetFieldId);
  let existingEdge = null;
  if (existing && existing.status === "active") {
    const agrees = existing.sourcePath === path;
    existingEdge = { sourcePath: existing.sourcePath, origin: existing.origin || "legacy", agrees, canBeReplacedByAi: canReplace(existing, { origin: "ai" }).allowed };
    record("existing_edge", agrees, agrees ? "agrees with the live mapping" : `a live ${existingEdge.origin} edge maps this box to ${existing.sourcePath}`, "soft:existing_edge_differs");
  } else record("existing_edge", true, "no live edge");

  if (ctx.universe) {
    const synthetic = { mappingId: `ai:${box.targetFieldId}`, targetFieldId: box.targetFieldId, targetPdfField: box.targetPdfField, targetLabel: box.label || box.fieldLabel, section: box.section, targetType: box.type, sourcePath: path, transform: { type: "direct" }, status: "active", origin: "ai" };
    const violations = checkEdge(synthetic, { universe: ctx.universe, target: box }).filter((v) => v.code !== "PARTY_CONTRADICTION"); // the party verdict is recorded above
    record("contract", violations.length === 0, violations[0] ? `${violations[0].code}` : undefined, "hard:contract_violation");
  } else record("contract", false, "the live path universe is not available", "soft:contract_unchecked");

  return { ok: hard.length === 0, hard, soft, checks, existingEdge };
}

module.exports = { validateCandidate, typeCompatible, boxText, sideOfPath };

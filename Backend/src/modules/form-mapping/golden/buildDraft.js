// Builds the DRAFT golden set (the answer key) from the live, already-in-use mappings. Pure: it takes mapping edges and returns entries a person can review in plain
// language. A reviewer never sees a technical id; those are kept in `technical` for developers only.
const crypto = require("crypto");
const MappingResolver = require("../services/MappingResolver");
const humanize = require("./humanize");
const { buildSampleCanonical, sampleValue, valuesThatSatisfy } = require("./sampleClient");

// The forms in the draft, by family. (Plan: at least 3 forms per family; one form is held back so the AI is later tested on something it never saw.)
const SCOPE = {
  "I-129": { family: "employment", name: "Petition for a Nonimmigrant Worker" },
  "I-140": { family: "employment", name: "Immigrant Petition for Alien Worker" },
  "I-907": { family: "employment", name: "Request for Premium Processing Service" },
  "I-485J": { family: "employment", name: "Supplement J to Form I-485 - Confirmation of Bona Fide Job Offer or Request for Job Portability" },
  "I-130": { family: "family", name: "Petition for Alien Relative" },
  "I-129F": { family: "family", name: "Petition for Alien Fiance(e)" },
  "I-485": { family: "family", name: "Application to Register Permanent Residence or Adjust Status" },
  "G-325A": { family: "family", name: "Biographic Information" },
  "I-765": { family: "single", name: "Application for Employment Authorization" },
  "I-131": { family: "single", name: "Application for Travel Document" },
  "I-90": { family: "single", name: "Application to Replace Permanent Resident Card" },
  "I-539": { family: "single", name: "Application to Extend/Change Nonimmigrant Status" },
  "I-824": { family: "single", name: "Application for Action on an Approved Application or Petition" },
  "G-28": { family: "general", name: "Notice of Entry of Appearance as Attorney or Accredited Representative" },
};
const FAMILY_LABEL = { employment: "Employment-based", family: "Family-based", single: "Single-applicant", general: "General / representation" };
// I-131 was the held-out form until its own rules were written (2026-10-22), so it is a normal form now; I-90 (single-applicant family) is untouched and takes its place
const HELD_OUT_FORMS = ["I-90"];
const PER_FORM_CAP = 36;

const sha = (value) => crypto.createHash("sha1").update(value).digest("hex");

const transformSignature = (edge) => JSON.stringify([edge.transform?.type || "direct", edge.transform?.value ?? null, edge.transform?.optionsMap ?? null]);

function sentenceOf(entry) {
  const bits = [`On Form ${entry.formCode} (${entry.where}), the ${entry.boxKind === "checkbox" ? "tick box" : "box"} "${entry.boxLabel}" is filled with ${entry.fillsWith}`];
  if (entry.writtenAs) bits.push(`, ${entry.writtenAs}`);
  if (entry.onlyWhen) bits.push(`, but only when ${entry.onlyWhen}`);
  if (entry.ifEmpty) bits.push(`. If that is empty, it uses ${entry.ifEmpty}`);
  return `${bits.join("")}.`;
}

/** What the box would show for the fictional sample client, run through the REAL autofill resolver. */
function exampleFor(edge, family) {
  const paths = [edge.sourcePath, edge.fallback, ...(edge.transform?.fields || []), ...(edge.transform?.source ? [edge.transform.source] : [])];
  const walk = (rule) => { if (!rule || typeof rule !== "object") return; (rule.all || rule.any || []).forEach(walk); const field = rule.field || rule.source || rule.path; if (field && !rule.all && !rule.any && !/^filledData\./.test(field)) paths.push(String(field).replace(/^canonicalData\./, "")); };
  walk(edge.condition);
  if (edge.transform?.countryPath) paths.push(edge.transform.countryPath);
  // a conditional box is shown for a client where the condition APPLIES, otherwise most of them would just say "left blank"
  const overrides = valuesThatSatisfy(edge.condition);
  Object.keys(overrides).forEach((field) => paths.push(field));
  const canonical = buildSampleCanonical(paths, { family, overrides });
  const result = MappingResolver.resolveMapping({ source: "canonical", path: edge.sourcePath, sourceField: edge.sourcePath, transform: edge.transform, condition: edge.condition, fallback: edge.fallback }, canonical, { filledData: {} });
  const kind = humanize.widgetKind(edge.targetType);
  let boxShows;
  if (result.skipped) boxShows = "Left blank for the sample client (this box does not apply to them)";
  else if (kind === "checkbox" || kind === "radio") boxShows = result.value === true ? "Ticked" : result.value === false ? "Not ticked" : (MappingResolver.isEmpty(result.value) ? "Left blank" : String(result.value));
  else boxShows = MappingResolver.isEmpty(result.value) ? "Left blank" : String(result.value);
  if (edge.condition && !result.skipped && boxShows !== "Left blank") boxShows += " (for a client where this applies)";
  const clientRaw = overrides[edge.sourcePath] !== undefined ? overrides[edge.sourcePath] : sampleValue(edge.sourcePath, { family });
  return { clientData: String(clientRaw), boxShows };
}

function toEntry(edge, formCode, index) {
  const { family, name } = SCOPE[formCode];
  const kind = humanize.widgetKind(edge.targetType);
  const entry = {
    id: sha(`${formCode}|${edge.targetFieldId}`).slice(0, 12),
    ref: `${formCode} #${index}`,
    formCode, formName: name, family, familyLabel: FAMILY_LABEL[family],
    heldOut: HELD_OUT_FORMS.includes(formCode),
    where: humanize.whereOnForm(edge),
    boxLabel: humanize.cleanLabel(edge.targetLabel) || "(no printed label)",
    boxKind: kind,
    belongsTo: humanize.partyOfPath(edge.sourcePath, family),
    fillsWith: humanize.describePath(edge.sourcePath, family),
    writtenAs: humanize.describeTransform(edge.transform, family),
    onlyWhen: humanize.describeCondition(edge.condition, family),
    ifEmpty: edge.fallback && edge.fallback !== edge.sourcePath && humanize.describePath(edge.fallback, family) !== humanize.describePath(edge.sourcePath, family) ? humanize.describePath(edge.fallback, family) : "",
    appearsTimes: edge.__appears || 1,
    example: exampleFor(edge, family),
    technical: { mappingId: edge.mappingId, targetFieldId: edge.targetFieldId, targetPdfField: edge.targetPdfField, sourcePath: edge.sourcePath, origin: edge.origin || "legacy", transform: edge.transform, condition: edge.condition, fallback: edge.fallback, profileOwner: edge.profileOwner, partyRule: edge.partyRule, editionDate: edge.editionDate },
  };
  entry.sentence = sentenceOf(entry);
  entry.contentHash = sha(JSON.stringify([entry.id, entry.formCode, entry.boxLabel, entry.belongsTo, entry.fillsWith, entry.writtenAs, entry.onlyWhen, entry.ifEmpty, entry.where])).slice(0, 16);
  return entry;
}

/** The same data on the same form asked twice (a repeated header, a continuation sheet) is reviewed ONCE and says how often it appears. */
function dedupe(edges) {
  const groups = new Map();
  for (const edge of edges) {
    const key = [edge.sourcePath, humanize.cleanLabel(edge.targetLabel).toLowerCase(), transformSignature(edge), JSON.stringify(edge.condition || null), edge.fallback || ""].join("|");
    if (groups.has(key)) groups.get(key).__appears += 1;
    else groups.set(key, { ...edge, __appears: 1 });
  }
  return [...groups.values()];
}

const orderKey = (edge) => [String(edge.pageNumber ?? 99).padStart(3, "0"), String(edge.section || ""), String(edge.targetLabel || ""), String(edge.targetFieldId)].join("|");

/** Picks up to `cap` edges of one form: every kind of box (text, date, tick box, dropdown) is represented, in the order they appear on the form. */
function selectForForm(edges, cap = PER_FORM_CAP) {
  const sorted = [...edges].sort((a, b) => orderKey(a).localeCompare(orderKey(b)));
  if (sorted.length <= cap) return sorted;
  const byKind = new Map();
  for (const edge of sorted) {
    const kind = humanize.widgetKind(edge.targetType);
    byKind.set(kind, [...(byKind.get(kind) || []), edge]);
  }
  // rarer kinds first, so a dropdown or a date is never crowded out by a hundred text boxes; then round-robin
  const lists = [...byKind.entries()].sort((a, b) => a[1].length - b[1].length).map(([, list]) => list);
  const picked = new Set();
  for (let round = 0; picked.size < cap && lists.some((list) => list[round]); round += 1) {
    for (const list of lists) { if (list[round] && picked.size < cap) picked.add(list[round]); }
  }
  return sorted.filter((edge) => picked.has(edge));
}

/**
 * @param graphsByForm { "I-907": [edges...] } the edges of each form's ACTIVE mapping
 * @returns the draft: { entries, summary, meetsPlan }
 */
function buildDraft(graphsByForm, { cap = PER_FORM_CAP } = {}) {
  const entries = [];
  for (const formCode of Object.keys(SCOPE)) {
    const edges = (graphsByForm[formCode] || []).filter((edge) => edge.status === "active" && edge.sourcePath && edge.targetFieldId);
    const chosen = selectForForm(dedupe(edges), cap);
    chosen.forEach((edge, index) => entries.push(toEntry(edge, formCode, index + 1)));
  }
  const draft = {
    version: 1,
    title: "Golden set - draft for review",
    note: "An answer key of form boxes and what each one is filled with. Built from the mappings that are in use today; a reviewer confirms each one. Nothing here changes how any form is filled.",
    heldOutForms: HELD_OUT_FORMS,
    entries,
  };
  draft.summary = summarize(entries);
  draft.meetsPlan = checkAgainstPlan(draft.summary);
  draft.entriesChecksum = sha(entries.map((entry) => `${entry.id}:${entry.contentHash}`).join("|"));
  return draft;
}

function summarize(entries) {
  const byForm = {};
  const byKind = {};
  const byFamily = {};
  const formsByFamily = {};
  for (const entry of entries) {
    byForm[entry.formCode] = (byForm[entry.formCode] || 0) + 1;
    byKind[entry.boxKind] = (byKind[entry.boxKind] || 0) + 1;
    byFamily[entry.family] = (byFamily[entry.family] || 0) + 1;
    (formsByFamily[entry.family] ||= new Set()).add(entry.formCode);
  }
  return { total: entries.length, byForm, byKind, byFamily, formsByFamily: Object.fromEntries(Object.entries(formsByFamily).map(([family, set]) => [family, [...set].sort()])) };
}

/** The plan's bar for the answer key: 300+ entries, 25+ of each kind of box, 3+ forms in each main family, a held-out form. */
function checkAgainstPlan(summary) {
  const kinds = ["text", "date", "checkbox", "dropdown"];
  const results = {
    "at least 300 entries": summary.total >= 300,
    ...Object.fromEntries(kinds.map((kind) => [`at least 25 ${kind} boxes`, (summary.byKind[kind] || 0) >= 25])),
    ...Object.fromEntries(["employment", "family", "single"].map((family) => [`at least 3 ${family} forms`, (summary.formsByFamily[family] || []).length >= 3])),
    "a held-out form is included": summary.formsByFamily && HELD_OUT_FORMS.every((form) => summary.byForm[form] > 0),
  };
  return { ok: Object.values(results).every(Boolean), results };
}

module.exports = { SCOPE, FAMILY_LABEL, HELD_OUT_FORMS, PER_FORM_CAP, buildDraft, selectForForm, dedupe, toEntry, exampleFor, summarize, checkAgainstPlan, sentenceOf };

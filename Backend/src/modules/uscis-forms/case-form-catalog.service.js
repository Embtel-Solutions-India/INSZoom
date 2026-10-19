// The catalogue of USCIS forms a Case Manager can select for a case - independent of any visa mapping.
//
// Built only from what the system already holds: USCISFormTemplate (imported official templates), VisaFormMapping (the registry: which forms exist, their issuing
// agency) and USCISFormComponentDefinition (embedded components of a parent PDF). Nothing is invented. An entry is listed only when it is verifiably a USCIS form:
//   - the registry says agency USCIS, or
//   - its template was acquired from uscis.gov (artifacts.form.sourceUrl),
// and never when the registry attributes it to another agency (DOS, DOL, ...). Forms with neither signal are reported as `unverified` and are not selectable.
//
// Each entry carries exactly one availability state (never "ready" merely because it is listed):
//   ready               active official template + active field mapping
//   mapping_incomplete  a template exists but its mapping is not active (or the edition is awaiting review)
//   no_template         registered, but no template imported yet (can be recorded as pending acquisition, never provisioned)
//   not_eligible        deprecated edition, or a component that is not active
//
// The scan reads whole template documents (some 10-16 MB), so the result is cached for a few minutes and dropped whenever the template cache is invalidated.

const USCISFormTemplate = require("../../models/USCISFormTemplate");
const VisaFormMapping = require("../../models/VisaFormMapping");
const USCISFormComponentDefinition = require("../../models/USCISFormComponentDefinition");

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = { at: 0, promise: null };

const normalize = (value) => String(value || "").trim().toUpperCase();
const isUscisHost = (url) => /(^|\/\/|\.)uscis\.gov(\/|$)/i.test(String(url || ""));

function clearCache() {
  cache = { at: 0, promise: null };
}

// PURE. How usable is this template for a case?
function availabilityOfTemplate(template) {
  if (!template) return { availability: "no_template", note: "Registered, but no official template has been imported yet. It can be recorded as pending acquisition." };
  if (template.officialStatus === "deprecated") return { availability: "not_eligible", note: "This edition is deprecated by USCIS." };
  if (template.status !== "active") return { availability: "mapping_incomplete", note: "A template exists but is awaiting review or activation." };
  if (template.mappingStatus !== "active") {
    return {
      availability: "mapping_incomplete",
      note: template.mappingStatus === "biographic_active" ? "Basic autofill only (identity, contact, address); the full field mapping is awaiting review." : "The field mapping is incomplete or awaiting review.",
    };
  }
  return { availability: "ready", note: "" };
}

function pickTemplate(list) {
  const rank = (t) => (t.status === "active" ? 2 : t.status === "retired" || t.status === "archived" ? 0 : 1);
  return [...list].sort((a, b) => rank(b) - rank(a) || new Date(b.editionDate || b.updatedAt || 0) - new Date(a.editionDate || a.updatedAt || 0))[0];
}

async function buildEntries() {
  const [templates, mappings, components] = await Promise.all([
    USCISFormTemplate.find({ status: { $nin: ["retired", "archived"] } })
      .select("formCode title formName status mappingStatus officialStatus editionDate version category updatedAt artifacts.form.sourceUrl")
      .lean(),
    VisaFormMapping.find({ active: true }).select("formNumber formName agency componentType parentForm componentCode formTemplateFormCode visaType").lean(),
    USCISFormComponentDefinition.find({ status: "ACTIVE" }).select("componentCode name parentTemplateId").lean(),
  ]);

  const templatesByCode = new Map();
  templates.forEach((template) => {
    const code = normalize(template.formCode);
    if (!templatesByCode.has(code)) templatesByCode.set(code, []);
    templatesByCode.get(code).push(template);
  });

  // what the registry says about each standalone form: its agencies, name and how many visa types use it
  const registryByCode = new Map();
  mappings.filter((row) => !row.componentCode && !row.parentForm).forEach((row) => {
    const code = normalize(row.formTemplateFormCode || row.formNumber);
    if (!registryByCode.has(code)) registryByCode.set(code, { formNumber: row.formNumber, formName: row.formName, agencies: new Set(), visaTypes: new Set(), componentTypes: new Set() });
    const entry = registryByCode.get(code);
    entry.agencies.add(row.agency);
    entry.visaTypes.add(row.visaType);
    entry.componentTypes.add(row.componentType);
  });

  const entries = [];
  const codes = new Set([...templatesByCode.keys(), ...registryByCode.keys()]);
  for (const code of codes) {
    const registry = registryByCode.get(code);
    const template = templatesByCode.has(code) ? pickTemplate(templatesByCode.get(code)) : null;
    const agencies = registry ? [...registry.agencies] : [];
    const fromUscisGov = isUscisHost(template?.artifacts?.form?.sourceUrl);
    const registryUscis = agencies.includes("USCIS");
    const otherAgency = agencies.length > 0 && !registryUscis && !fromUscisGov;
    if (otherAgency) continue; // DS-160, ETA-9035, ... : never offered as a USCIS form
    const verified = registryUscis || fromUscisGov;
    const state = availabilityOfTemplate(template);
    entries.push({
      key: code,
      kind: "form",
      formCode: code,
      title: template?.title || template?.formName || registry?.formName || code,
      parentFormCode: null,
      componentCode: null,
      agency: verified ? "USCIS" : "unverified",
      selectable: verified && state.availability !== "not_eligible",
      category: template?.category || "",
      availability: verified ? state.availability : "not_eligible",
      // a form is created on a case only from an ACTIVE template (a template still in review is never put on a live case); otherwise the selection is recorded
      provisionable: verified && template?.status === "active" && state.availability !== "not_eligible",
      availabilityNote: verified ? state.note : "The issuing agency could not be verified as USCIS, so it is not offered.",
      editionDate: template?.editionDate || null,
      version: template?.version || null,
      mappingStatus: template?.mappingStatus || "unmapped",
      templateId: template?._id || null,
      registered: Boolean(registry),
      visaTypeCount: registry ? registry.visaTypes.size : 0,
    });
  }

  // embedded components: they live inside a parent PDF; only the parent template can make them usable
  const templateById = new Map(templates.map((template) => [String(template._id), template]));
  const seenComponents = new Set();
  for (const component of components) {
    const parent = templateById.get(String(component.parentTemplateId));
    if (!parent) continue;
    const parentCode = normalize(parent.formCode);
    const key = `${parentCode}|${component.componentCode}`;
    if (seenComponents.has(key)) continue;
    seenComponents.add(key);
    const parentEntry = entries.find((entry) => entry.key === parentCode);
    const state = availabilityOfTemplate(parent);
    entries.push({
      key,
      kind: "component",
      formCode: normalize(component.componentCode),
      title: component.name,
      parentFormCode: parentCode,
      componentCode: component.componentCode,
      agency: parentEntry?.agency || "USCIS",
      selectable: Boolean(parentEntry?.selectable),
      category: parent.category || "",
      availability: parentEntry?.selectable ? state.availability : "not_eligible",
      provisionable: Boolean(parentEntry?.provisionable) && state.availability !== "not_eligible",
      availabilityNote: parentEntry?.selectable ? state.note : "The parent form is not selectable.",
      editionDate: parent.editionDate || null,
      version: parent.version || null,
      mappingStatus: parent.mappingStatus || "unmapped",
      templateId: parent._id,
      registered: true,
      visaTypeCount: 0,
    });
  }
  return entries.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
}

async function loadEntries() {
  const now = Date.now();
  if (cache.promise && now - cache.at < CACHE_TTL_MS) return cache.promise;
  const promise = buildEntries().catch((error) => { clearCache(); throw error; });
  cache = { at: now, promise };
  return promise;
}

// PURE. Search by form number / title / keyword / category, and by kind.
function filterEntries(entries, { q = "", category = "", kind = "", availability = "", onlySelectable = false } = {}) {
  const needle = String(q || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return entries.filter((entry) => {
    if (kind && entry.kind !== kind) return false;
    if (availability && entry.availability !== availability) return false;
    if (onlySelectable && !entry.selectable) return false;
    if (category && String(entry.category || "").toLowerCase() !== String(category).toLowerCase()) return false;
    if (!needle) return true;
    const haystack = `${entry.formCode} ${entry.title} ${entry.parentFormCode || ""} ${entry.category || ""}`.toLowerCase().replace(/[^a-z0-9]+/g, " ");
    return needle.split(" ").every((word) => haystack.includes(word));
  });
}

async function listCatalog(query = {}) {
  const entries = await loadEntries();
  const filtered = filterEntries(entries, query);
  const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
  const offset = Math.max(Number(query.offset) || 0, 0);
  return { total: filtered.length, items: filtered.slice(offset, offset + limit), categories: [...new Set(entries.map((entry) => entry.category).filter(Boolean))].sort() };
}

async function findEntry(formCode, componentCode) {
  const entries = await loadEntries();
  const code = normalize(formCode);
  return entries.find((entry) => (componentCode ? entry.kind === "component" && entry.componentCode === componentCode : entry.kind === "form" && entry.key === code)) || null;
}

// What the Case Manager typed in "Add form": an exact form number / component code wins; otherwise a single search hit; otherwise the candidates are returned
// so they can choose (a wrong guess would put the wrong legal form on a case).
async function resolveTypedForm(text) {
  const typed = String(text || "").trim();
  if (!typed) return { match: null, candidates: [] };
  const entries = await loadEntries();
  const code = normalize(typed).replace(/^FORM\s+/, "").replace(/\s+/g, "");
  const squash = (value) => normalize(value).replace(/[^A-Z0-9]+/g, "");
  const exact = entries.filter((entry) => entry.selectable && (squash(entry.formCode) === squash(code) || squash(entry.componentCode) === squash(code)));
  if (exact.length === 1) return { match: exact[0], candidates: [] };
  const candidates = filterEntries(entries, { q: typed, onlySelectable: true }).slice(0, 8);
  if (!exact.length && candidates.length === 1) return { match: candidates[0], candidates: [] };
  return { match: null, candidates: exact.length ? exact : candidates };
}

module.exports = { resolveTypedForm, availabilityOfTemplate, filterEntries, listCatalog, findEntry, loadEntries, clearCache, isUscisHost };

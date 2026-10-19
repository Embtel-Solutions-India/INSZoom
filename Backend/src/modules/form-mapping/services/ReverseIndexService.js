const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const FormMappingService = require("./FormMappingService");
const MappingResolver = require("./MappingResolver");

// The compiled mapping graph (FormMappingService.applyMappingGraph) only
// ever tags an edge's mappingType as "direct" | "date" | "checkbox" (see
// i129-h1b-mapping.seed.js) - there is no first-class "derived"/"composite"
// flag on an edge today. So reverseSync classification below is a
// documented heuristic over the signals that DO exist (condition presence,
// checkbox mappingType, and a small source-path denylist for known
// composite canonical fields), not a first-class property read off the
// edge. Ledger: P2-001 (see docs/forms/issues/) - a later phase should add
// an explicit composite/derived flag at crosswalk-authoring time so this
// stops being a heuristic.
const DERIVED_SOURCE_PATH_SUFFIXES = ["fullName"];
const REVERSE_INDEX_TTL_MS = 5 * 60 * 1000; // even an unchanged key is rebuilt this often, so a missed invalidation can never last

class ReverseIndexService {
  static _cache = new Map(); // formCode -> { mappingVersionId, entries: Map<sourcePath, Array<{formCode,pdfField,reverseSync}>> }

  // true - direct, atomic datum (firstName, lastName, dateOfBirth, employer
  // legalName, address components, etc.) - safe to write back 1:1.
  // false - derived/computed (composite full name, a checkbox/radio
  // selection, an age/format transform) or when in doubt.
  static classifyReverseSync(mapping = {}, sourcePath = "") {
    if (mapping.condition) return false;
    if (mapping.mappingType === "checkbox") return false;
    if (!sourcePath) return false;
    if (DERIVED_SOURCE_PATH_SUFFIXES.some((suffix) => sourcePath === suffix || sourcePath.endsWith(`.${suffix}`))) return false;
    return true;
  }

  static clearCache() {
    this._cache.clear();
  }

  // Map<sourcePath, Array<{formCode, pdfField, reverseSync}>> for one form's
  // active mapping graph. Loaded via FormMappingService.loadTemplate +
  // applyMappingGraph (never hand-parses the crosswalk config files) and
  // cached per {formCode, mappingVersionId} pair.
  // A few bytes that change whenever the form's active template or its mapping changes. Reading just these is one small query; the full template
  // (several MB, ~14 s over a remote database) used to be downloaded on EVERY call only to learn the version, so the cache never saved anything -
  // and one field save asks for this index twice.
  static async freshnessKey(normalizedFormType) {
    const head = await USCISFormTemplate.findOne({ $or: [{ formCode: normalizedFormType }, { formNumber: normalizedFormType }], status: "active" })
      .select("_id updatedAt version mappingVersion mappingVersionId activeMappingVersionId latestMappingVersionId")
      .sort({ activeFlag: -1, editionDate: -1, effectiveDate: -1, updatedAt: -1 })
      .lean();
    if (!head) return null;
    return [head._id, head.updatedAt?.getTime?.() || "", head.version || "", head.mappingVersion || "", head.mappingVersionId || "", head.activeMappingVersionId || "", head.latestMappingVersionId || ""].join("|");
  }

  static async buildFormReverseIndex(formCode) {
    const normalizedFormType = FormMappingService.normalizeFormType(formCode);
    const key = await this.freshnessKey(normalizedFormType);
    const cachedByKey = this._cache.get(normalizedFormType);
    if (key && cachedByKey && cachedByKey.key === key && Date.now() - cachedByKey.at < REVERSE_INDEX_TTL_MS) return cachedByKey.entries;
    const template = await FormMappingService.loadTemplate(normalizedFormType);
    const mappingVersionId = String(template.mappingVersionId || "");
    const cached = this._cache.get(normalizedFormType);
    if (!key && cached && cached.mappingVersionId === mappingVersionId) return cached.entries;

    const entries = new Map();
    const resolvedFormCode = template.formCode || template.formNumber || normalizedFormType;
    (template.formFields || []).forEach((field) => {
      const pdfField = field.fieldId || field.id || field.fieldName;
      if (!pdfField) return;
      FormMappingService.normalizeMappings(field).forEach((mapping) => {
        if (mapping.source !== "canonical") return;
        const sourcePath = MappingResolver.getSourcePath(mapping);
        if (!sourcePath) return;
        if (!entries.has(sourcePath)) entries.set(sourcePath, []);
        entries.get(sourcePath).push({ formCode: resolvedFormCode, pdfField, reverseSync: this.classifyReverseSync(mapping, sourcePath) });
      });
    });
    this._cache.set(normalizedFormType, { mappingVersionId, key, at: Date.now(), entries });
    return entries;
  }

  // canonical source path -> [{formCode, pdfField, reverseSync}], across
  // every active template when formCode is omitted, or scoped to one form.
  static async buildReverseIndex(formCode) {
    if (formCode) return Object.fromEntries(await this.buildFormReverseIndex(formCode));

    const formCodes = await USCISFormTemplate.find({ status: "active" }).distinct("formCode");
    const merged = new Map();
    for (const code of formCodes) {
      const entries = await this.buildFormReverseIndex(code);
      entries.forEach((list, sourcePath) => {
        if (!merged.has(sourcePath)) merged.set(sourcePath, []);
        merged.get(sourcePath).push(...list);
      });
    }
    return Object.fromEntries(merged);
  }

  // Reverse lookup: given a PDF field name + formCode, returns the canonical
  // source path, or null when the field is form-only (no reverse-index hit).
  static async lookupSource(pdfFieldName, formCode) {
    const entries = await this.buildFormReverseIndex(formCode);
    for (const [sourcePath, list] of entries) {
      if (list.some((item) => item.pdfField === pdfFieldName)) return sourcePath;
    }
    return null;
  }
}

module.exports = ReverseIndexService;

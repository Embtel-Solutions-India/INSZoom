const crypto = require("crypto");
const AuditLog = require("../../models/AuditLog");
const QuestionLibraryItem = require("../../models/QuestionLibraryItem");
const USCISFormTemplate = require("../../models/USCISFormTemplate");

const SECTION_DEFINITIONS = [
  ["personal_information", "Personal Information", /\b(first|middle|last|family|given|full|legal|maiden) name\b|\b(date of birth|dob|gender|sex|marital|citizenship|nationality|alien number|a number|ssn)\b/i],
  ["contact_information", "Contact Information", /\b(email|phone|telephone|mobile|address|street|city|state|province|zip|postal)\b/i],
  ["passport_information", "Passport Information", /\b(passport|travel document)\b/i],
  ["immigration_history", "Immigration History", /\b(immigration status|visa status|status at entry|i-94|admission|authorized stay|removal|deportation)\b/i],
  ["family_information", "Family Information", /\b(spouse|fianc|parent|child|children|son|daughter|sibling|family|marriage)\b/i],
  ["education", "Education", /\b(education|degree|school|college|university|institution|major|field of study|graduat)\b/i],
  ["employment_history", "Employment History", /\b(employment|occupation|job title|position|wage|salary|work history|employer)\b/i],
  ["employer_information", "Employer Information", /\b(company|organization|petitioner|federal employer|fein|ein|naics|business)\b/i],
  ["criminal_history", "Criminal History", /\b(arrest|criminal|conviction|offense|crime|citation|detention)\b/i],
  ["security_questions", "Security Questions", /\b(terror|security|military|weapons|genocide|persecution|organization membership)\b/i],
  ["travel_history", "Travel History", /\b(travel|trip|departure|arrival|entry date|exit date|countries visited)\b/i],
  ["previous_uscis_filings", "Previous USCIS Filings", /\b(receipt number|uscis filing|petition|application|prior filing|priority date|notice)\b/i],
  ["supporting_documents", "Supporting Documents", /\b(document|evidence|attachment|certificate|transcript|notice copy)\b/i],
  ["declarations", "Declarations", /\b(declaration|certif|attest|interpreter|preparer|consent)\b/i],
  ["signatures", "Signatures", /\b(signature|sign here|date signed|initials?)\b/i],
];

const SECTION_TITLES = Object.fromEntries(SECTION_DEFINITIONS.map(([key, title]) => [key, title]));

function normalizeText(value = "") {
  return String(value)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_./-]+/g, " ")
    .replace(/\b(?:pt|part)\s*\d+[a-z]?\b/gi, " ")
    .replace(/\b(?:line|item)\s*\d+[a-z]?\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedLabel(value = "") {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\b(the|applicant'?s?|beneficiary'?s?|petitioner'?s?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value = "") {
  return normalizeText(value).replace(/\b\w/g, (character) => character.toUpperCase());
}

function inferSection(field = {}) {
  const text = `${field.label || ""} ${field.fieldName || ""} ${field.sectionTitle || ""}`;
  if (field.type === "signature" || field.signatureArea) return "signatures";
  const match = SECTION_DEFINITIONS.find(([, , pattern]) => pattern.test(text));
  return match?.[0] || "personal_information";
}

function inferCanonicalPath(label, sectionKey) {
  const text = normalizedLabel(label);
  const exactRules = [
    [/\b(date of birth|birth date|dob)\b/, "person.dob"],
    [/\b(first name|given name)\b/, "person.firstName"],
    [/\b(middle name)\b/, "person.middleName"],
    [/\b(last name|family name|surname)\b/, "person.lastName"],
    [/\b(email|email address)\b/, "contact.email"],
    [/\b(phone|telephone|mobile)( number)?\b/, "contact.phone"],
    [/\b(passport number)\b/, "person.passport.number"],
    [/\b(passport expiration date|passport expiry date)\b/, "person.passport.expirationDate"],
    [/\b(passport issue date)\b/, "person.passport.issueDate"],
    [/\b(country of birth|birth country)\b/, "person.countryOfBirth"],
    [/\b(country of citizenship|citizenship country|nationality)\b/, "person.citizenship"],
    [/\b(alien number|a number|a-number)\b/, "person.alienNumber"],
    [/\b(social security number|ssn)\b/, "person.ssn"],
    [/\b(receipt number|uscis receipt number)\b/, "immigrationHistory.receiptNumbers"],
  ];
  const matched = exactRules.find(([pattern]) => pattern.test(text));
  if (matched) return matched[1];
  if (sectionKey === "signatures") return undefined;
  return undefined;
}

function questionnaireType(field = {}) {
  const type = String(field.type || field.fieldType || "text");
  const aliases = {
    dropdown: "select",
    list: "select",
    multilineText: "textarea",
    currency: "currency",
    number: "number",
    date: "date",
    email: "email",
    phone: "phone",
    signature: "signature",
    radio: "radio",
    checkbox: "checkbox",
  };
  return aliases[type] || (["text", "textarea", "select", "radio", "checkbox", "date", "email", "phone", "number", "currency", "signature"].includes(type) ? type : "text");
}

function uniqueValues(values = []) {
  const seen = new Set();
  return values.filter((value) => {
    const key = typeof value === "string" ? value : JSON.stringify(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function requirementFor(sources = []) {
  if (sources.some((source) => source.conditional)) return "conditional";
  const requiredCount = sources.filter((source) => source.required).length;
  if (requiredCount === sources.length && sources.length) return "required";
  if (requiredCount > 0) return "mixed";
  return "optional";
}

function sourceIdentity(source) {
  return `${source.formTemplate}:${source.fieldId}`;
}

function semanticSignature(item = {}) {
  return JSON.stringify({
    canonicalPath: item.canonicalPath,
    label: item.label,
    normalizedLabel: item.normalizedLabel,
    sectionKey: item.sectionKey,
    type: item.type,
    options: item.options || [],
    requirement: item.requirement,
    repeatable: Boolean(item.repeatable),
    repeatableConfig: item.repeatableConfig || {},
    validationRules: item.validationRules || [],
    dependencies: item.dependencies || [],
    conditionalLogic: item.conditionalLogic || {},
    sources: (item.sources || []).map((source) => ({
      formTemplate: String(source.formTemplate),
      formCode: source.formCode,
      formVersion: source.formVersion,
      fieldId: source.fieldId,
      fieldName: source.fieldName,
      required: source.required,
      conditional: source.conditional,
      repeatable: source.repeatable,
      validationRules: source.validationRules,
      dependencies: source.dependencies,
      extractionConfidence: source.extractionConfidence,
      parserStatus: source.parserStatus,
    })).sort((left, right) => `${left.formTemplate}:${left.fieldId}`.localeCompare(`${right.formTemplate}:${right.fieldId}`)),
  });
}

function libraryKey({ canonicalPath, sectionKey, normalized }) {
  const identity = canonicalPath || `${sectionKey}:${normalized}`;
  return `uscis.${crypto.createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

function sourceFrom(template, field) {
  return {
    formTemplate: template._id,
    formCode: template.formCode,
    formVersion: template.version,
    editionDate: template.editionDate,
    fieldId: field.fieldId,
    fieldName: field.fieldName,
    pageNumber: field.pageNumber,
    sectionKey: field.sectionKey || field.sectionId,
    subsectionKey: field.subsectionId || field.groupId,
    required: Boolean(field.required),
    conditional: Boolean(Object.keys(field.conditionalLogic || {}).length || field.dependencies?.length),
    repeatable: Boolean(field.repeatable),
    validationRules: field.validationRules || field.validation || {},
    dependencies: field.dependencies || [],
    extractionConfidence: field.extraction?.confidence,
    parserStatus: field.extraction?.status || template.parserMetadata?.status,
    synchronizedAt: new Date(),
  };
}

class QuestionLibraryService {
  async audit(action, entity, user, req, changes = {}) {
    await AuditLog.create({
      userId: user?._id,
      userRole: user?.role,
      action,
      entityType: "QuestionLibraryItem",
      entityId: entity?._id?.toString(),
      changes,
      ipAddress: req?.ip,
      userAgent: req?.headers?.["user-agent"],
      description: `${action} question library`,
    }).catch(() => null);
  }

  buildCandidate(template, field) {
    const rawLabel = field.label || field.fieldLabel || field.normalizedName || field.fieldName || field.fieldId;
    const label = titleCase(rawLabel);
    const normalized = normalizedLabel(label);
    const sectionKey = inferSection(field);
    const canonicalPath = field.mapping?.canonicalPath || field.canonicalPath || inferCanonicalPath(label, sectionKey);
    const source = sourceFrom(template, field);
    const reviewReasons = [];
    if (!canonicalPath) reviewReasons.push("canonical_path_requires_review");
    if (Number(source.extractionConfidence || 0) < 0.8) reviewReasons.push("low_extraction_confidence");
    if (source.conditional) reviewReasons.push("conditional_logic_requires_review");
    if (!normalized) reviewReasons.push("question_label_requires_review");
    return {
      key: libraryKey({ canonicalPath, sectionKey, normalized: normalized || field.fieldId }),
      canonicalPath,
      label,
      normalizedLabel: normalized || normalizedLabel(field.fieldId),
      aliases: uniqueValues([rawLabel, field.fieldName, field.fieldId].filter(Boolean)),
      sectionKey,
      sectionTitle: SECTION_TITLES[sectionKey],
      type: questionnaireType(field),
      options: field.options || [],
      requirement: requirementFor([source]),
      repeatable: Boolean(field.repeatable),
      repeatableConfig: field.repeatableConfig,
      validationRules: uniqueValues([field.validationRules || field.validation || {}]),
      dependencies: field.dependencies || [],
      conditionalLogic: field.conditionalLogic || {},
      sources: [source],
      sourceForms: [template.formCode],
      sourceFieldCount: 1,
      confidence: Number(source.extractionConfidence || template.parserMetadata?.confidence || 0),
      review: {
        status: reviewReasons.length ? "needs_review" : "approved",
        reasons: reviewReasons,
      },
      lawFirmSpecific: false,
      active: true,
    };
  }

  mergeCandidate(existing, candidate) {
    const sources = [...(existing.sources || []).map((source) => source.toObject?.() || source)];
    const candidateSource = candidate.sources[0];
    const identity = sourceIdentity(candidateSource);
    const sourceIndex = sources.findIndex((source) => sourceIdentity(source) === identity);
    if (sourceIndex >= 0) sources[sourceIndex] = candidateSource;
    else sources.push(candidateSource);
    const reasons = uniqueValues([...(existing.review?.reasons || []), ...(candidate.review.reasons || [])]);
    const merged = {
      aliases: uniqueValues([...(existing.aliases || []), ...candidate.aliases]),
      canonicalPath: existing.canonicalPath || candidate.canonicalPath,
      options: uniqueValues([...(existing.options || []), ...candidate.options]),
      requirement: requirementFor(sources),
      repeatable: Boolean(existing.repeatable || candidate.repeatable),
      repeatableConfig: existing.repeatableConfig || candidate.repeatableConfig,
      validationRules: uniqueValues([...(existing.validationRules || []), ...candidate.validationRules]),
      dependencies: uniqueValues([...(existing.dependencies || []), ...candidate.dependencies]),
      conditionalLogic: Object.keys(existing.conditionalLogic || {}).length ? existing.conditionalLogic : candidate.conditionalLogic,
      sources,
      sourceForms: uniqueValues(sources.map((source) => source.formCode)),
      sourceFieldCount: sources.length,
      confidence: Number((sources.reduce((sum, source) => sum + Number(source.extractionConfidence || 0), 0) / Math.max(sources.length, 1)).toFixed(4)),
      review: {
        ...(existing.review?.toObject?.() || existing.review || {}),
        status: reasons.length ? "needs_review" : "approved",
        reasons,
      },
      active: true,
    };
    merged.version = semanticSignature(existing) === semanticSignature({ ...(existing.toObject?.() || existing), ...merged })
      ? Number(existing.version || 1)
      : Number(existing.version || 1) + 1;
    return merged;
  }

  async syncTemplate(templateOrId, user, req) {
    const template = typeof templateOrId === "object" && templateOrId.formCode
      ? templateOrId
      : await USCISFormTemplate.findById(templateOrId);
    if (!template) throw Object.assign(new Error("USCIS form template not found"), { status: 404 });
    const rawCandidates = (template.formFields || [])
      .filter((field) => field.fieldId && !field.hidden)
      .map((field) => this.buildCandidate(template, field));
    const groupedCandidates = new Map();
    rawCandidates.forEach((candidate) => {
      const grouped = groupedCandidates.get(candidate.key);
      if (!grouped) groupedCandidates.set(candidate.key, candidate);
      else Object.assign(grouped, this.mergeCandidate(grouped, candidate), { version: 1 });
    });
    const candidates = [...groupedCandidates.values()];
    const existingItems = await QuestionLibraryItem.find({ key: { $in: candidates.map((candidate) => candidate.key) } });
    const existingByKey = new Map(existingItems.map((item) => [item.key, item]));
    const now = new Date();
    const operations = candidates.map((candidate) => {
      const existing = existingByKey.get(candidate.key);
      if (existing) {
        return {
          updateOne: {
            filter: { _id: existing._id },
            update: {
              $set: {
                ...this.mergeCandidate(existing, candidate),
                updatedBy: user?._id,
                updatedAt: now,
              },
            },
          },
        };
      }
      return {
        updateOne: {
          filter: { key: candidate.key },
          update: {
            $setOnInsert: {
              ...candidate,
              createdBy: user?._id,
              createdAt: now,
            },
            $set: {
              updatedBy: user?._id,
              updatedAt: now,
            },
          },
          upsert: true,
        },
      };
    });
    if (operations.length) await QuestionLibraryItem.bulkWrite(operations, { ordered: false });
    const results = {
      templateId: template._id,
      formCode: template.formCode,
      created: candidates.filter((candidate) => !existingByKey.has(candidate.key)).length,
      updated: candidates.filter((candidate) => existingByKey.has(candidate.key)).length,
      questions: rawCandidates.length,
      uniqueQuestions: candidates.length,
    };
    await this.audit("QUESTION_LIBRARY_SYNCHRONIZED", null, user, req, results);
    return results;
  }

  async synchronize(query = {}, user, req) {
    const filter = {
      "lifecycle.provider": "uscis",
      "formFields.0": { $exists: true },
    };
    if (query.templateId) filter._id = query.templateId;
    if (query.formCode) filter.formCode = String(query.formCode).trim().toUpperCase();
    const templates = await USCISFormTemplate.find(filter).sort({ formCode: 1, editionDate: 1 });
    const report = { templates: templates.length, questions: 0, created: 0, updated: 0, forms: [] };
    for (const template of templates) {
      const result = await this.syncTemplate(template, user, req);
      report.questions += result.questions;
      report.created += result.created;
      report.updated += result.updated;
      report.forms.push(result);
    }
    return report;
  }

  async list(query = {}, user) {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 250);
    const filter = { active: query.active === "false" ? false : true };
    if (query.sectionKey) filter.sectionKey = query.sectionKey;
    if (query.formCode) filter.sourceForms = String(query.formCode).trim().toUpperCase();
    if (query.requirement) filter.requirement = query.requirement;
    if (query.reviewStatus) filter["review.status"] = query.reviewStatus;
    if (query.lawFirmSpecific !== undefined) filter.lawFirmSpecific = query.lawFirmSpecific === "true";
    if (query.search) {
      const escaped = String(query.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { label: new RegExp(escaped, "i") },
        { normalizedLabel: new RegExp(escaped, "i") },
        { aliases: new RegExp(escaped, "i") },
        { canonicalPath: new RegExp(escaped, "i") },
      ];
    }
    if (user?.role !== "super_admin") {
      const organization = user?.organization || user?.companyId || user?.company;
      filter.$and = [
        ...(filter.$and || []),
        {
          $or: [
            { lawFirmSpecific: false },
            ...(organization ? [{ organization }] : []),
          ],
        },
      ];
    }
    const [items, total] = await Promise.all([
      QuestionLibraryItem.find(filter).sort({ sectionKey: 1, label: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      QuestionLibraryItem.countDocuments(filter),
    ]);
    return { items, total, page, pages: Math.ceil(total / limit) };
  }

  async get(itemId, user) {
    const item = await QuestionLibraryItem.findById(itemId).lean();
    if (!item) throw Object.assign(new Error("Question library item not found"), { status: 404 });
    const organization = user?.organization || user?.companyId || user?.company;
    if (item.lawFirmSpecific && user?.role !== "super_admin" && String(item.organization || "") !== String(organization || "")) {
      throw Object.assign(new Error("Not authorized to access this question"), { status: 403 });
    }
    return item;
  }

  async createCustom(payload, user, req) {
    const organization = payload.organizationId || user?.organization || user?.companyId || user?.company;
    if (!organization && user?.role !== "super_admin") {
      throw Object.assign(new Error("Organization is required for a law-firm-specific question"), { status: 400 });
    }
    const label = titleCase(payload.label);
    const normalized = normalizedLabel(label);
    if (!normalized) throw Object.assign(new Error("Question label is required"), { status: 400 });
    const sectionKey = payload.sectionKey || "personal_information";
    if (!SECTION_TITLES[sectionKey]) throw Object.assign(new Error("Unsupported question library section"), { status: 400 });
    const keyIdentity = `${organization || "global"}:${payload.canonicalPath || `${sectionKey}:${normalized}`}`;
    const item = await QuestionLibraryItem.create({
      key: `custom.${crypto.createHash("sha256").update(keyIdentity).digest("hex").slice(0, 24)}`,
      canonicalPath: payload.canonicalPath,
      label,
      normalizedLabel: normalized,
      aliases: uniqueValues(payload.aliases || []),
      sectionKey,
      sectionTitle: SECTION_TITLES[sectionKey],
      type: payload.type || "text",
      options: payload.options || [],
      requirement: payload.requirement || "optional",
      repeatable: Boolean(payload.repeatable),
      repeatableConfig: payload.repeatableConfig,
      validationRules: payload.validationRules || [],
      dependencies: payload.dependencies || [],
      conditionalLogic: payload.conditionalLogic || {},
      sources: [],
      sourceForms: [],
      sourceFieldCount: 0,
      confidence: 1,
      review: { status: "approved", reasons: [], reviewedBy: user?._id, reviewedAt: new Date() },
      lawFirmSpecific: true,
      organization,
      createdBy: user?._id,
      updatedBy: user?._id,
    });
    await this.audit("CUSTOM_QUESTION_CREATED", item, user, req, { organization, canonicalPath: item.canonicalPath });
    return item;
  }
}

const service = new QuestionLibraryService();
service.SECTION_DEFINITIONS = SECTION_DEFINITIONS;
service.inferCanonicalPath = inferCanonicalPath;
service.inferSection = inferSection;
service.normalizedLabel = normalizedLabel;
service.questionnaireType = questionnaireType;

module.exports = service;

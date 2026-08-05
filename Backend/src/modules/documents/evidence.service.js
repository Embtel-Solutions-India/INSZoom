const Case = require("../../models/Case");
const Document = require("../../models/Document");
const caseService = require("../cases/case.service");
const documentService = require("./document.service");

const EVIDENCE_TAXONOMY = [
  { key: "awards", label: "Awards", terms: ["award", "prize", "honor", "medal", "recognition"] },
  { key: "memberships", label: "Memberships", terms: ["membership", "association", "fellow", "society"] },
  { key: "media", label: "Media", terms: ["media", "press", "article", "interview", "coverage"] },
  { key: "publications", label: "Publications", terms: ["publication", "paper", "journal", "citation", "research"] },
  { key: "judging", label: "Judging", terms: ["judge", "reviewer", "peer review", "panel"] },
  { key: "patents", label: "Patents", terms: ["patent", "invention", "intellectual property"] },
  { key: "salary", label: "Salary", terms: ["salary", "compensation", "pay stub", "w-2", "tax return"] },
  { key: "original_contributions", label: "Original Contributions", terms: ["contribution", "innovation", "impact", "original work"] },
  { key: "leading_role", label: "Leading Role", terms: ["leading role", "leadership", "executive", "director", "manager"] },
  { key: "critical_role", label: "Critical Role", terms: ["critical role", "essential role", "key employee"] },
  { key: "commercial_success", label: "Commercial Success", terms: ["commercial success", "revenue", "sales", "box office"] },
];

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function termsFor(document) {
  const structured = document.ocr?.structuredData || document.aiExtractedData || {};
  return normalize([
    document.documentType,
    document.category,
    document.description,
    ...(document.tags || []),
    structured.documentType,
    structured.classification,
    structured.summary,
    structured.relevance,
  ].filter(Boolean).join(" "));
}

function classify(document) {
  const haystack = termsFor(document);
  const ranked = EVIDENCE_TAXONOMY.map((entry) => ({
    ...entry,
    matches: entry.terms.filter((term) => haystack.includes(normalize(term))).length,
  })).sort((left, right) => right.matches - left.matches);
  return ranked[0]?.matches ? ranked[0] : { key: normalize(document.category || "supporting_evidence").replace(/\s+/g, "_"), label: document.category || "Supporting Evidence", matches: 0 };
}

function requirementText(requirement) {
  return normalize([
    requirement.key,
    requirement.name,
    requirement.label,
    requirement.category,
    requirement.criterion,
    requirement.description,
    requirement.notes,
  ].filter(Boolean).join(" "));
}

function requirementMatch(requirements, evidenceClass, document) {
  const documentTerms = new Set(termsFor(document).split(" ").filter(Boolean));
  return (requirements || []).map((requirement) => {
    const text = requirementText(requirement);
    let score = text.includes(normalize(evidenceClass.key).replace(/_/g, " ")) ? 50 : 0;
    evidenceClass.terms?.forEach((term) => { if (text.includes(normalize(term))) score += 10; });
    documentTerms.forEach((term) => { if (term.length > 3 && text.includes(term)) score += 1; });
    return { requirement, score };
  }).sort((left, right) => right.score - left.score)[0];
}

function strength(score) {
  if (score >= 90) return "critical";
  if (score >= 75) return "strong";
  if (score >= 50) return "moderate";
  return "weak";
}

function confidenceFor(document, match) {
  const extractionConfidence = Number(document.extractionConfidence ?? document.ocr?.confidence ?? 0);
  const classificationConfidence = match?.score ? Math.min(100, 45 + match.score) : 35;
  return Math.round(extractionConfidence ? (extractionConfidence * 0.65) + (classificationConfidence * 0.35) : classificationConfidence);
}

function assignedForms(caseData, requirement) {
  const explicit = requirement?.formTypes || requirement?.forms || requirement?.supportingForms;
  if (Array.isArray(explicit) && explicit.length) return [...new Set(explicit.map(String))];
  return [...new Set((caseData.knowledgePlan?.formAssignments || []).map((item) => item.formCode || item.formType || item.formNumber).filter(Boolean))];
}

async function loadCase(caseId, user) {
  const caseData = await Case.findById(caseId);
  if (!caseData) throw Object.assign(new Error("Case not found"), { status: 404 });
  if (!caseService.canAccessCase(user, caseData)) throw Object.assign(new Error("Not authorized to access this case"), { status: 403 });
  return caseData;
}

async function classifyDocument(document, user, req) {
  if (!(await documentService.canAccessDocument(user, document))) throw Object.assign(new Error("Not authorized to access this document"), { status: 403 });
  if (!document.caseId) throw Object.assign(new Error("Document must be associated with a case before evidence classification"), { status: 422 });
  const caseData = await loadCase(document.caseId, user);
  const evidenceClass = classify(document);
  const match = requirementMatch(caseData.knowledgePlan?.evidenceRequirements || [], evidenceClass, document);
  const confidence = confidenceFor(document, match);
  const score = Math.min(100, Math.round((confidence * 0.7) + (match?.score || 0) * 0.3));
  const criterion = match?.requirement?.criterion || match?.requirement?.key || evidenceClass.key;
  const association = {
    caseId: caseData._id,
    beneficiary: document.beneficiary || caseData.beneficiary,
    companyId: document.companyId || caseData.companyId,
    criterion,
    category: evidenceClass.key,
    status: confidence >= 85 ? "linked" : "suggested",
    confidence,
    strengthScore: score,
    strengthLevel: strength(score),
    supportingForms: assignedForms(caseData, match?.requirement),
    petitionParagraphKeys: [criterion, evidenceClass.key].filter((value, index, values) => value && values.indexOf(value) === index),
    rationale: match?.score
      ? `Matched ${evidenceClass.label} evidence to the case knowledge requirement.`
      : `Classified as ${evidenceClass.label}; case-team verification is required.`,
    source: document.ocr?.provider && document.ocr.provider !== "none" ? "ai" : "rules",
    linkedBy: user?._id,
    linkedAt: new Date(),
  };
  const existing = document.evidenceAssociations?.find((item) => String(item.caseId) === String(caseData._id) && item.criterion === criterion);
  if (existing) Object.assign(existing, association);
  else document.evidenceAssociations.push(association);
  document.isEvidence = true;
  document.evidenceCriteria = [...new Set([...(document.evidenceCriteria || []), criterion])];
  documentService.addAuditEntry(document, "evidence_classified", user, association, req);
  await document.save();
  await documentService.writeAuditLog("evidence_classified", document, user, association, req);
  return { document, classification: association };
}

async function caseEvidenceSummary(caseId, user) {
  const caseData = await loadCase(caseId, user);
  const documents = await Document.find({ caseId: caseData._id, deletedAt: { $exists: false } })
    .select("originalName documentType category reviewStatus expiryDate evidenceAssociations extractionConfidence ocr.confidence")
    .lean();
  const requirements = caseData.knowledgePlan?.evidenceRequirements || [];
  const associations = documents.flatMap((document) => (document.evidenceAssociations || []).map((association) => ({ document, association })));
  const coverage = requirements.map((requirement) => {
    const key = requirement.criterion || requirement.key || requirement.name || requirement.label;
    const linked = associations.filter(({ association }) => normalize(association.criterion) === normalize(key) || normalize(association.category) === normalize(key));
    return {
      key,
      required: requirement.required !== false,
      status: linked.some(({ association }) => association.status === "verified") ? "verified" : linked.length ? "covered" : "missing",
      evidenceCount: linked.length,
      strongestScore: Math.max(0, ...linked.map(({ association }) => association.strengthScore || 0)),
      documentIds: linked.map(({ document }) => document._id),
    };
  });
  return {
    caseId: caseData._id,
    visaType: caseData.visaType,
    totalDocuments: documents.length,
    evidenceDocuments: documents.filter((document) => document.evidenceAssociations?.length).length,
    requirements: coverage,
    missing: coverage.filter((item) => item.required && item.status === "missing"),
    coveragePercentage: coverage.length ? Math.round((coverage.filter((item) => item.status !== "missing").length / coverage.length) * 100) : 100,
    documents,
  };
}

module.exports = { caseEvidenceSummary, classifyDocument };

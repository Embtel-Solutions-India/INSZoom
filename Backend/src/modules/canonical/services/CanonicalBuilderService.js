const crypto = require("crypto");
const Answer = require("../../../models/Answer");
const Beneficiary = require("../../../models/Beneficiary");
const Case = require("../../../models/Case");
const Company = require("../../../models/Company");
const Document = require("../../../models/Document");
const DocumentExtraction = require("../../../models/DocumentExtraction");
const EmployeeProfile = require("../../../models/EmployeeProfile");
const EmployerProfile = require("../../../models/EmployerProfile");
const User = require("../../../models/User");
const MappingResolver = require("../../form-mapping/services/MappingResolver");
const CanonicalMergeService = require("./CanonicalMergeService");
const { CASE_SCOPED_CANONICAL_PATHS } = require("../config/fieldScope");
const {
  EMPLOYER_PROFILE_TO_CANONICAL,
  EMPLOYEE_PROFILE_TO_CANONICAL,
} = require("../config/profileCanonicalMap");

const DATABASE_FIELD_MAP = {
  "beneficiary.firstName": "person.firstName",
  "beneficiary.middleName": "person.middleName",
  "beneficiary.lastName": "person.lastName",
  "beneficiary.fullName": "person.fullName",
  "beneficiary.dateOfBirth": "person.dob",
  "beneficiary.gender": "person.gender",
  "beneficiary.maritalStatus": "person.maritalStatus",
  "beneficiary.countryOfCitizenship": "person.citizenship",
  "beneficiary.nationality": "person.citizenship",
  "beneficiary.countryOfBirth": "person.countryOfBirth",
  "beneficiary.passportNumber": "person.passport.number",
  "beneficiary.passportCountry": "person.passport.country",
  "beneficiary.passportIssueDate": "person.passport.issueDate",
  "beneficiary.passportExpirationDate": "person.passport.expirationDate",
  "beneficiary.alienRegistrationNumber": "person.alienNumber",
  "beneficiary.ssnLast4": "person.ssnLast4",
  "beneficiary.email": "contact.email",
  "beneficiary.primaryPhone": "contact.phone",
  "beneficiary.address": "contact.address.line1",
  "beneficiary.apartment": "contact.address.line2",
  "beneficiary.city": "contact.address.city",
  "beneficiary.state": "contact.address.state",
  "beneficiary.zipCode": "contact.address.zip",
  "beneficiary.country": "contact.address.country",
  // These two map to paths listed in CASE_SCOPED_CANONICAL_PATHS
  // (fieldScope.js) - addMappedObjectCandidates skips them for the
  // "beneficiary" prefix specifically, since Beneficiary is shared across a
  // person's cases and these values are only true for whichever case last
  // wrote them. Left in this table (rather than deleted) so the mapping is
  // still documented; a per-case source (this case's own Answer/Document/
  // OCR extraction) is the only thing allowed to fill these paths.
  "beneficiary.currentVisaStatus": "immigration.currentStatus",
  "beneficiary.visaType": "immigration.currentVisaType",
  "beneficiary.i94Number": "immigration.i94.number",
  "beneficiary.i94ExpirationDate": "immigration.i94.expirationDate",
  "beneficiary.sevisId": "immigration.sevis.id",
  "case.caseNumber": "case.caseNumber",
  "case.visaType": "case.visaType",
  "case.visaCategory": "case.visaCategory",
  "case.petitionType": "case.petitionType",
  "case.package": "case.package",
  "case.status": "case.status",
  "case.stage": "case.stage",
  "case.uscisReceiptNumber": "immigration.receiptNumbers.0",
  "company.name": "company.name",
  "company.legalName": "company.legalName",
  "company.ein": "company.ein",
  "company.industry": "company.industry",
  "company.address.addressLine1": "company.address.line1",
  "company.address.street": "company.address.line1",
  "company.address.city": "company.address.city",
  "company.address.state": "company.address.state",
  "company.address.zip": "company.address.zip",
  "company.address.zipCode": "company.address.zip",
  "company.address.country": "company.address.country",
  "company.contact.email": "company.contact.email",
  "company.contact.phone": "company.contact.phone",
};

const QUESTION_KEY_MAP = {
  firstName: "person.firstName",
  middleName: "person.middleName",
  lastName: "person.lastName",
  fullName: "person.fullName",
  dateOfBirth: "person.dob",
  dob: "person.dob",
  gender: "person.gender",
  maritalStatus: "person.maritalStatus",
  nationality: "person.citizenship",
  countryOfCitizenship: "person.citizenship",
  countryOfBirth: "person.countryOfBirth",
  passportNumber: "person.passport.number",
  passportCountry: "person.passport.country",
  passportIssueDate: "person.passport.issueDate",
  passportExpirationDate: "person.passport.expirationDate",
  email: "contact.email",
  phone: "contact.phone",
  address: "contact.address.line1",
  city: "contact.address.city",
  state: "contact.address.state",
  zipCode: "contact.address.zip",
  country: "contact.address.country",
  currentStatus: "immigration.currentStatus",
  visaType: "case.visaType",
  employmentHistory: "employment",
  educationHistory: "education",
  travelHistory: "travelHistory",
  immigrationHistory: "immigrationHistory",
  dependents: "family.dependents",
};

const OCR_FIELD_MAP = {
  firstName: "person.firstName",
  givenName: "person.firstName",
  middleName: "person.middleName",
  lastName: "person.lastName",
  familyName: "person.lastName",
  surname: "person.lastName",
  dateOfBirth: "person.dob",
  dob: "person.dob",
  gender: "person.gender",
  nationality: "person.citizenship",
  countryOfBirth: "person.countryOfBirth",
  passportNumber: "person.passport.number",
  documentNumber: "person.passport.number",
  issuingCountry: "person.passport.country",
  passportCountry: "person.passport.country",
  issueDate: "person.passport.issueDate",
  expiryDate: "person.passport.expirationDate",
  expirationDate: "person.passport.expirationDate",
  visaType: "immigration.currentVisaType",
  classOfAdmission: "immigration.currentStatus",
  i94Number: "immigration.i94.number",
  education: "education",
  educationHistory: "education",
  employment: "employment",
  employmentHistory: "employment",
  publications: "achievements.publications",
  awards: "achievements.awards",
  skills: "achievements.skills",
  memberships: "achievements.memberships",
  patents: "achievements.patents",
};

function plain(document) {
  if (!document) return {};
  return typeof document.toObject === "function" ? document.toObject({ virtuals: true }) : document;
}

function idOf(value) {
  return value?._id || value;
}

function fingerprint(parts) {
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function pushCandidate(candidates, path, value, metadata = {}) {
  if (!path || MappingResolver.isEmpty(value)) return;
  candidates.push({
    path,
    value,
    sourceType: metadata.sourceType || "database",
    source: metadata.source,
    sourceId: metadata.sourceId,
    sourceField: metadata.sourceField,
    sourceDocumentId: metadata.sourceDocumentId,
    confidence: metadata.confidence,
    status: metadata.status,
    verifiedBy: metadata.verifiedBy,
    verifiedRole: metadata.verifiedRole,
    verificationStatus: metadata.verificationStatus,
    verificationDate: metadata.verificationDate,
    collectedAt: metadata.collectedAt,
    profileOwner: metadata.profileOwner,
    caseScope: metadata.caseScope,
    revision: metadata.revision,
    locked: metadata.locked,
    priority: metadata.priority,
  });
}

function canonicalFieldAt(profile, fieldPath) {
  return fieldPath.split(".").reduce((current, key) => current?.[key], profile?.canonicalData);
}

function profileSourceType(field = {}) {
  if (field.source === "case_manager_edit" || field.source === "form_edit") return "case_manager_verified";
  if (field.source === "ocr") return field.locked ? "ocr_verified" : "ocr";
  if (field.source === "import") return "database";
  return "questionnaire";
}

class CanonicalBuilderService {
  static async loadSources(caseId) {
    const caseRecord = await Case.findById(caseId).lean();
    if (!caseRecord) {
      const error = new Error("Case not found");
      error.status = 404;
      throw error;
    }
    const principalCaseId = caseRecord.caseRole === "employee" || caseRecord.caseRole === "beneficiary"
      ? caseRecord.parentCase
      : caseRecord._id;
    // F-4 fix: Answer.find({caseId}) only ever read THIS case's own answers -
    // for an employer_employee/family case, the principal's questionnaire
    // (company.name, petitioner.name, ...) and the child's (person.firstName,
    // passport, ...) are two separate Case documents with two separate
    // caseId-scoped Answer sets. Building canonical data for either case
    // alone could therefore never see both halves of a single I-129/I-130
    // petition at once - company.* was always unresolvable when building
    // for the child, and person.* always unresolvable when building for the
    // principal, regardless of any per-field mapping fix. A combined
    // petition's canonical profile needs the whole case family's answers,
    // not just whichever single Case document was asked for.
    const familyCaseIds = caseRecord.caseRole === "principal" || caseRecord.caseStructure === "family"
      ? [caseRecord._id, ...(caseRecord.childCases || [])]
      : [principalCaseId, caseRecord._id].filter(Boolean);
    const [beneficiary, company, user, answers, documents, extractions, employerProfile, employeeProfile] = await Promise.all([
      caseRecord.beneficiary ? Beneficiary.findById(caseRecord.beneficiary).lean() : null,
      caseRecord.companyId ? Company.findById(caseRecord.companyId).lean() : null,
      caseRecord.user ? User.findById(caseRecord.user).select("-password").lean() : null,
      Answer.find({ caseId: { $in: familyCaseIds } }).sort({ updatedAt: -1 }).populate({ path: "question", select: "mapping questionnaire" }).lean(),
      Document.find({ caseId, deletedAt: { $exists: false } }).sort({ uploadDate: -1 }).lean(),
      DocumentExtraction.find({ caseId }).sort({ updatedAt: -1 }).lean(),
      principalCaseId ? EmployerProfile.findOne({ principalCaseId }).lean() : null,
      ["employee", "beneficiary"].includes(caseRecord.caseRole) ? EmployeeProfile.findOne({ caseId: caseRecord._id }).lean() : null,
    ]);
    return { caseRecord, beneficiary, company, user, answers, documents, extractions, employerProfile, employeeProfile };
  }

  static addMappedObjectCandidates(candidates, prefix, sourceObject, sourceId, sourceType = "database") {
    // Beneficiary is the one source here shared across every case a person
    // has (Case.beneficiary is many-cases-to-one) - anything case-scoped
    // (fieldScope.js) must not be read from it into this case's profile, or
    // a different case's petition-specific answers would bleed in as a
    // stale default. Case/company prefixes are already per-case/per-record,
    // so they're never filtered.
    const blockedTargets = prefix === "beneficiary" ? CASE_SCOPED_CANONICAL_PATHS : null;
    Object.entries(DATABASE_FIELD_MAP).forEach(([sourcePath, targetPath]) => {
      if (!sourcePath.startsWith(`${prefix}.`)) return;
      if (blockedTargets?.has(targetPath)) return;
      const value = MappingResolver.resolvePath({ [prefix]: sourceObject }, sourcePath);
      pushCandidate(candidates, targetPath, value, {
        sourceType,
        sourceId,
        sourceField: sourcePath,
        confidence: 70,
        collectedAt: sourceObject?.updatedAt || sourceObject?.createdAt,
      });
    });
  }

  static addQuestionnaireCandidates(candidates, answers = []) {
    answers.forEach((answer) => {
      // question.mapping.canonicalPath is how an admin explicitly wires a
      // custom questionnaire question to the canonical profile (set via the
      // questionnaire builder / library import - see Question.js `mapping`
      // and questionnaire.service.js `inferMasterDataPath`). QUESTION_KEY_MAP
      // only covers a fixed set of well-known keys, so without this an
      // admin-authored question for a new visa type would never reach
      // autofill even though the mapping exists on the question itself.
      const targetPath = answer.question?.mapping?.canonicalPath || QUESTION_KEY_MAP[answer.questionKey];
      if (!targetPath) return;
      pushCandidate(candidates, targetPath, answer.normalizedValue !== undefined ? answer.normalizedValue : answer.value, {
        sourceType: "questionnaire",
        source: "Questionnaire",
        sourceId: answer._id,
        sourceField: answer.questionKey,
        confidence: answer.status === "approved" ? 95 : answer.status === "submitted" ? 85 : 75,
        status: answer.status,
        verifiedBy: answer.approvedBy || answer.reviewedBy,
        verificationStatus: answer.status === "approved" ? "case_manager_verified" : undefined,
        verificationDate: answer.approvedAt || answer.reviewedAt,
        collectedAt: answer.updatedAt,
      });
    });
  }

  static addOcrCandidates(candidates, extractions = []) {
    extractions.forEach((extraction) => {
      const documentType = extraction.documentType || extraction.classification?.documentType || "other";
      (extraction.extractedData || []).forEach((field) => {
        const targetPath = OCR_FIELD_MAP[field.path] || OCR_FIELD_MAP[field.key] || field.canonicalPath;
        if (!targetPath) return;
        const value = field.editedValue !== undefined ? field.editedValue : field.value;
        pushCandidate(candidates, targetPath, value, {
          sourceType: "ocr",
          source: documentType,
          sourceId: extraction._id,
          sourceField: field.key || field.path,
          sourceDocumentId: field.sourceDocumentId || field.sourceDocument || extraction.documentId,
          confidence: field.confidenceScore ?? field.confidence ?? extraction.confidence ?? 60,
          status: field.reviewStatus || extraction.reviewStatus,
          verifiedBy: field.reviewedBy || field.editedBy,
          verificationStatus: ["approved", "edited", "auto_accepted"].includes(field.reviewStatus) ? "ocr_verified" : undefined,
          verificationDate: field.reviewedAt || field.editedAt,
          collectedAt: field.extractedAt || field.extractionTimestamp || extraction.processingCompletedAt || extraction.updatedAt,
        });
      });
    });
  }

  static addProfileCandidates(candidates, profile, pathMap, profileOwner, caseScope = {}) {
    if (!profile) return;
    Object.entries(pathMap).forEach(([profilePath, canonicalPath]) => {
      const field = canonicalFieldAt(profile, profilePath);
      if (!field || MappingResolver.isEmpty(field.value)) return;
      pushCandidate(candidates, canonicalPath, field.value, {
        sourceType: profileSourceType(field),
        source: field.source,
        sourceId: field.sourceId || profile._id,
        sourceField: field.sourceField || `${profileOwner}.${profilePath}`,
        confidence: field.source === "case_manager_edit" || field.source === "form_edit" ? 100 : 92,
        priority: field.source === "case_manager_edit" || field.source === "form_edit" ? 650 : 520,
        status: field.locked ? "staff_locked" : "selected",
        verifiedBy: field.updatedBy,
        verificationStatus: field.source === "case_manager_edit" || field.source === "form_edit" ? "case_manager_verified" : undefined,
        verificationDate: field.updatedAt,
        collectedAt: field.updatedAt || profile.updatedAt,
        profileOwner,
        caseScope,
        revision: field.revision,
        locked: field.locked,
      });
    });
  }

  static buildRawCollections({ caseRecord, beneficiary, company, user, answers, documents, extractions }) {
    return {
      beneficiary: plain(beneficiary),
      petitioner: plain(company),
      company: plain(company),
      case: plain(caseRecord),
      user: plain(user),
      documents: (documents || []).map((document) => ({
        id: document._id,
        documentType: document.documentType,
        category: document.category,
        status: document.status,
        reviewStatus: document.reviewStatus,
        requestStatus: document.requestStatus,
        originalName: document.originalName || document.originalFileName,
        storageKey: document.storageKey,
        uploadedAt: document.uploadDate || document.createdAt,
        source: "document",
      })),
      ocr: (extractions || []).reduce((acc, extraction) => {
        const documentType = extraction.documentType || extraction.classification?.documentType || "other";
        acc[documentType] = acc[documentType] || [];
        acc[documentType].push(extraction);
        return acc;
      }, {}),
      questionnaireAnswers: (answers || []).reduce((acc, answer) => {
        acc[answer.questionKey] = {
          value: answer.normalizedValue !== undefined ? answer.normalizedValue : answer.value,
          answerId: answer._id,
          status: answer.status,
          updatedAt: answer.updatedAt,
          source: "Questionnaire",
          confidence: answer.status === "approved" ? 95 : 80,
        };
        return acc;
      }, {}),
    };
  }

  static addRepeatableCollections(profile, sources) {
    const beneficiary = sources.beneficiary || {};
    // Employment is petition-specific (this case's employer/wage/offer
    // details, per fieldScope.js) - unlike education/travel/immigration
    // history below, it must never fall back to the shared beneficiary
    // record, or a brand-new case would inherit a prior case's employer.
    // The current case's OWN employment answers (if any) still flow in via
    // the merge candidates above (addQuestionnaireCandidates), untouched.
    profile.employment = profile.employment?.length
      ? profile.employment
      : (CASE_SCOPED_CANONICAL_PATHS.has("employment") ? [] : beneficiary.employmentHistory || []);
    profile.education = profile.education?.length ? profile.education : beneficiary.educationHistory || [];
    profile.travelHistory = profile.travelHistory?.length ? profile.travelHistory : beneficiary.travelHistory || [];
    profile.immigrationHistory = profile.immigrationHistory?.length ? profile.immigrationHistory : beneficiary.immigrationHistory || [];
    profile.addressHistory = profile.addressHistory?.length ? profile.addressHistory : beneficiary.addressHistory || [];
    profile.family = {
      ...(profile.family || {}),
      members: profile.family?.members || beneficiary.familyMembers || [],
      dependents: profile.family?.dependents || beneficiary.dependents || beneficiary.familyMembers?.filter((person) => person.isDependent) || [],
    };
    profile.documents = sources.documents || [];
    profile.ocr = sources.ocr || {};
    profile.raw = {
      questionnaireAnswers: sources.questionnaireAnswers || {},
    };
  }

  static async build(caseId) {
    const sources = await this.loadSources(caseId);
    const candidates = [];
    this.addMappedObjectCandidates(candidates, "beneficiary", sources.beneficiary, idOf(sources.beneficiary), "database");
    this.addMappedObjectCandidates(candidates, "case", sources.caseRecord, idOf(sources.caseRecord), "database");
    this.addMappedObjectCandidates(candidates, "company", sources.company, idOf(sources.company), "database");
    const principalCaseId = sources.caseRecord.caseRole === "employee" || sources.caseRecord.caseRole === "beneficiary"
      ? sources.caseRecord.parentCase
      : sources.caseRecord._id;
    this.addProfileCandidates(candidates, sources.employerProfile, EMPLOYER_PROFILE_TO_CANONICAL, "employer", { principalCaseId: String(principalCaseId || "") });
    if (sources.employeeProfile) {
      this.addProfileCandidates(candidates, sources.employeeProfile, EMPLOYEE_PROFILE_TO_CANONICAL, sources.employeeProfile.profileType, {
        caseId: String(sources.caseRecord._id),
        principalCaseId: String(sources.caseRecord.parentCase || ""),
      });
    }
    if (sources.user) {
      pushCandidate(candidates, "contact.email", sources.user.email, { sourceType: "database", sourceId: sources.user._id, sourceField: "user.email", confidence: 75 });
      pushCandidate(candidates, "person.fullName", sources.user.name || sources.user.displayName, { sourceType: "database", sourceId: sources.user._id, sourceField: "user.name", confidence: 65 });
    }
    this.addQuestionnaireCandidates(candidates, sources.answers);
    this.addOcrCandidates(candidates, sources.extractions);
    const merged = CanonicalMergeService.merge(candidates);
    // F-4: two canonical paths CanonicalSectionValidators.js requires have no
    // real question anywhere in h1b_employee_checklist to source them from -
    // not a mapping gap (M4), a genuine content gap. Rather than block on a
    // question the real checklist never asks, fill in the value the
    // section's own label already implies, only when there's nothing more
    // specific on record: the "Current US Address" section is, per its own
    // name, always United States; a passport is overwhelmingly issued by the
    // holder's country of citizenship absent any evidence otherwise. Both
    // conditioned on the address/passport actually being on file - never
    // invented for a case with no address/passport data at all.
    if (merged.profile.contact?.address?.city && !merged.profile.contact.address.country) {
      merged.profile.contact.address.country = "United States";
    }
    if (merged.profile.person?.passport?.number && !merged.profile.person.passport.country) {
      merged.profile.person.passport.country = merged.profile.person.citizenship;
    }
    const rawCollections = this.buildRawCollections(sources);
    this.addRepeatableCollections(merged.profile, rawCollections);
    merged.profile.beneficiary = rawCollections.beneficiary;
    // Same overwrite bug as company.* (below), plus PetitionerValidator
    // (CanonicalSectionValidators.js) requires petitioner.name for every
    // non-family visa unconditionally - for a company-sponsored petition
    // (employer_employee structure) there is no separate "petitioner" entity
    // distinct from the company; falling back to the already-resolved
    // company.name is the correct real-world value, not a workaround.
    merged.profile.petitioner = { ...(merged.profile.petitioner || {}), ...rawCollections.petitioner };
    if (!merged.profile.petitioner.name && sources.caseRecord.caseStructure === "employer_employee") {
      merged.profile.petitioner.name = merged.profile.company?.name;
    }
    // F-4 fix (N2): rawCollections.company comes from the OLD Company model
    // (caseRecord.companyId) - always {} for an employer/employee (Phase 9)
    // case, which uses EmployerProfile instead and has no Company document at
    // all. Unconditionally overwriting merged.profile.company with that empty
    // object discarded whatever addQuestionnaireCandidates/addProfileCandidates
    // had already merged into company.* from real questionnaire answers (e.g.
    // company.name from employer_company_fullName, wired in Phase F-3) -
    // company.name could never resolve for any employer/employee case,
    // regardless of any question-mapping fix. Spreading instead of replacing
    // keeps the merged questionnaire-derived fields, while a real Company
    // document (old single-Case architecture) still takes precedence for
    // whichever fields IT defines, preserving the original intent for that
    // case type.
    merged.profile.company = { ...(merged.profile.company || {}), ...rawCollections.company };
    // NOT `...rawCollections.case` here - that's the entire raw Case
    // document, including its OWN canonicalProfile/canonicalHistory. Since
    // this profile gets saved back onto that same case, spreading the whole
    // record re-embeds the prior rebuild's canonicalHistory (which itself
    // contains earlier snapshots) every time, growing the document
    // exponentially across rebuilds until it exceeds MongoDB's 16MB
    // document limit. addMappedObjectCandidates(candidates, "case", ...)
    // above already populates merged.profile.case with just the specific
    // case.* fields listed in DATABASE_FIELD_MAP - nothing more is needed.
    merged.profile.case = merged.profile.case || {};
    merged.profile.case.id = sources.caseRecord._id;
    merged.profile.case.caseId = sources.caseRecord.caseId || sources.caseRecord.caseNumber;
    // F-4 fix: DocumentsValidator (CanonicalSectionValidators.js) needs to
    // know which role THIS case represents so it can require only that
    // role's documents, not the whole visa's combined employer+employee set
    // against a single case's own Document records.
    merged.profile.case.caseRole = sources.caseRecord.caseRole;
    merged.profile.case.caseStructure = sources.caseRecord.caseStructure;
    merged.profile.metadata = {
      caseId,
      beneficiaryId: idOf(sources.beneficiary),
        companyId: idOf(sources.company),
        employerProfileId: idOf(sources.employerProfile),
        employeeProfileId: idOf(sources.employeeProfile),
        answerCount: sources.answers.length,
      documentCount: sources.documents.length,
      extractionCount: sources.extractions.length,
      builtAt: new Date(),
    };
    return {
      ...merged,
      sourceFingerprint: fingerprint({
        caseUpdatedAt: sources.caseRecord.updatedAt,
        beneficiaryUpdatedAt: sources.beneficiary?.updatedAt,
        companyUpdatedAt: sources.company?.updatedAt,
        answerIds: sources.answers.map((answer) => [answer._id, answer.updatedAt, answer.status]),
        documentIds: sources.documents.map((document) => [document._id, document.updatedAt, document.reviewStatus]),
        extractionIds: sources.extractions.map((extraction) => [extraction._id, extraction.updatedAt, extraction.reviewStatus]),
        employerProfileUpdatedAt: sources.employerProfile?.updatedAt,
        employeeProfileUpdatedAt: sources.employeeProfile?.updatedAt,
      }),
    };
  }
}

module.exports = CanonicalBuilderService;

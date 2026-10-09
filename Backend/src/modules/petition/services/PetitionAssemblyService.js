const Case = require("../../../models/Case");
const CaseForm = require("../../../models/CaseForm");
const Document = require("../../../models/Document");
const Company = require("../../../models/Company");
const User = require("../../../models/User");
const Settings = require("../../../models/Settings");
const PackageDefinition = require("../../../models/PackageDefinition");
const PetitionPackage = require("../../../models/PetitionPackage");
const AuditLog = require("../../../models/AuditLog");
const caseService = require("../../cases/case.service");
const CoverLetterService = require("../../form-generation/services/CoverLetterService");
const FilingPackageService = require("../../form-generation/services/FilingPackageService");
const PetitionWordPackageService = require("../../form-generation/services/PetitionWordPackageService");
const ExhibitService = require("./ExhibitService");
const PetitionValidationService = require("./PetitionValidationService");
const Answer = require("../../../models/Answer");
const uscisFormService = require("../../uscis-forms/uscis-form.service");

// Phase H6 conditional forms - never attached by visa-type tag, gated by
// the SAME real-world conditions uscis-form.service.js's
// resolveConditionalTemplates uses for assignment, reused here (not
// re-derived) so assignment and packet-inclusion can never disagree about
// whether a condition is currently true.
const CONDITIONAL_FORM_META = {
  "I-907": { label: "Form I-907 (Premium Processing)" },
  "G-28": { label: "Form G-28 (Notice of Entry of Appearance as Attorney)" },
  "I-539": { label: "Form I-539 (Application to Extend/Change Nonimmigrant Status)" },
  "I-539A": { label: "Form I-539A (Supplemental Information for Application to Extend/Change Nonimmigrant Status)" },
};

async function resolveConditionalRequirements(caseId) {
  const caseData = await Case.findById(caseId).lean();
  const { conditions, dependentsInfo } = await uscisFormService.resolveConditionalTemplates(caseData);
  const conditionalRequiredForms = Object.entries({
    "I-907": conditions.premium,
    "G-28": conditions.attorney,
    "I-539": conditions.dependents,
    "I-539A": conditions.dependentsI539A,
  })
    .filter(([, active]) => active)
    .map(([formCode]) => ({ formCode, required: true, label: CONDITIONAL_FORM_META[formCode]?.label || formCode }));

  const filingTypeAnswer = await Answer.findOne({ caseId, questionKey: "employee_filingType" }).lean();
  const isNewCapFiling = filingTypeAnswer?.value === "New H1B";
  const requiredDocuments = isNewCapFiling
    ? [{ documentType: "cap_selection_notice", label: "H-1B Registration Selection Notice (I-797C)", required: true, code: "SELECTION_NOTICE_MISSING" }]
    : [];

  return { conditions, dependentsInfo, conditionalRequiredForms, requiredDocuments };
}

function userId(user) {
  return user?._id || user?.id || (user && typeof user === "object" && !user._bsontype ? undefined : user);
}

function normalizeVisa(value) {
  return String(value || "").replace(/[-\s]/g, "").toUpperCase();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return String(value || "").split(/\r?\n+/).map((line) => line.trim()).filter(Boolean);
}

function maskTail(value, keep = 4) {
  const str = String(value || "");
  if (str.length <= keep) return str ? "•".repeat(str.length) : "";
  return `${"•".repeat(str.length - keep)}${str.slice(-keep)}`;
}

class PetitionAssemblyService {
  // SECURITY FIX: saveLetterEdit/reorderExhibits/unlock/recordFiling/
  // recordReceipt all fetched a PetitionPackage by id and mutated it
  // WITHOUT ever checking whether `user` may access the case it belongs
  // to — despite every one of them already receiving `user` as a parameter.
  // Any staff account holding forms:update/forms:approve (effectively any
  // case_manager/team_lead/admin) could finalize, unlock, re-file, or edit
  // letters on a petition package for a case they have no assignment to,
  // just by knowing/guessing its ObjectId. finalize() already re-derives
  // caseData but never called canAccessCase on it either. This helper is
  // now the one place that loads a package and verifies access — mirrors
  // the same canAccessCase() every other case-scoped module already uses.
  static async loadAuthorizedPackage(packageId, user) {
    const petitionPackage = await PetitionPackage.findById(packageId);
    if (!petitionPackage) throw Object.assign(new Error("Package not found"), { status: 404 });
    const caseData = await Case.findById(petitionPackage.caseId);
    if (!caseData || !caseService.canAccessCase(user, caseData)) {
      throw Object.assign(new Error("Not authorized to access this petition package"), { status: 403 });
    }
    return { petitionPackage, caseData };
  }

  static async resolveDefinition({ definitionKey, caseData }) {
    if (definitionKey) return PackageDefinition.findOne({ key: definitionKey, status: "active" });
    const candidates = await PackageDefinition.find({ status: "active" });
    const normalizedCaseVisa = normalizeVisa(caseData.visaType || caseData.petitionType);
    return candidates.find((definition) => {
      const aliases = [definition.visaType, ...(definition.visaTypes || [])];
      return aliases.some((alias) => normalizeVisa(alias) === normalizedCaseVisa);
    }) || null;
  }

  // Builds the §7 merge context generically off Case/Company/User fields —
  // no visa-specific branching, just "does this case have an employer side
  // or a petitioner side" (both already-established, visa-agnostic case
  // shapes elsewhere in this codebase).
  static async buildMergeContext(caseData, definition) {
    const settings = await Settings.findOne({ key: "global" });
    const isEmployerShape = Boolean(caseData.employerUser || caseData.companyId || caseData.employer);
    const company = isEmployerShape && caseData.companyId ? await Company.findById(caseData.companyId) : null;
    const petitionerUser = !isEmployerShape && caseData.petitionerUser ? await User.findById(caseData.petitionerUser) : null;
    const beneficiaryUser = caseData.beneficiaryUser || caseData.employeeUser ? await User.findById(caseData.beneficiaryUser || caseData.employeeUser) : null;
    const attorneyPresent = Boolean(caseData.assignedAttorney || caseData.attorney);

    const petitioner = company
      ? {
          legalName: company.name,
          feinMasked: maskTail(company.ein),
          address: {
            line1: company.businessAddress?.street || company.businessAddress?.addressLine1 || "",
            line2: company.businessAddress?.addressLine2 || "",
            city: company.businessAddress?.city || "",
            state: company.businessAddress?.state || "",
            zip: company.businessAddress?.zip || company.businessAddress?.zipCode || "",
          },
          signatoryName: company.authorizedSignatory?.name || "",
          signatoryTitle: company.authorizedSignatory?.title || "",
          phone: company.authorizedSignatory?.phone || "",
          email: company.authorizedSignatory?.email || "",
        }
      : {
          legalName: petitionerUser?.name || petitionerUser?.displayName || caseData.clientName || "",
          feinMasked: "",
          address: {},
          signatoryName: petitionerUser?.name || petitionerUser?.displayName || "",
          signatoryTitle: "",
          phone: petitionerUser?.phone || "",
          email: petitionerUser?.email || "",
        };

    const beneficiary = {
      fullName: beneficiaryUser?.name || beneficiaryUser?.displayName || caseData.clientName || "",
      dob: "",
      countryOfBirth: "",
      countryOfCitizenship: "",
      passportNumber: "",
      address: {},
      currentStatus: "",
    };

    const jobPosition = caseData.jobPosition || {};
    const job = {
      title: jobPosition.title || "",
      socCode: jobPosition.socCode || "",
      duties: asArray(jobPosition.duties),
      minRequirements: jobPosition.minRequirements || "",
      worksite: { address: jobPosition.worksiteAddress || {} },
      fullTime: jobPosition.fullTime !== false,
    };

    const wage = {
      offered: jobPosition.salary || "",
      unit: jobPosition.salaryUnit || "",
      prevailingWage: "",
      lcaCaseNumber: "",
    };

    return {
      case: { caseNumber: caseData.caseNumber || caseData.caseId, visaType: caseData.visaType, filingSubtype: definition.filingSubtype || "", package: caseData.package || caseData.plan?.tier || "", receiptNumber: caseData.immigrationLifecycle?.filings?.[0]?.receiptNumber || "" },
      petitioner,
      beneficiary,
      attorney: { present: attorneyPresent, name: "", firm: "", barState: "", g28OnFile: attorneyPresent },
      job,
      wage,
      forms: [],
      certifications: [],
      exhibits: [],
      filing: { uscisAddress: "", method: "usps", today: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) },
      firm: { letterhead: settings?.companyName || "", name: settings?.companyName || "", address: settings?.firmAddress || "", phone: settings?.firmPhone || "" },
    };
  }

  // Front-matter letters: use a firm-supplied approved Document for the slot
  // if one exists, else auto-draft from the slot's template (flagged
  // draft:true/reviewRequired:true). Returns
  // { [slotKey]: { documentId, title, draft, html, pdfBuffer, storageKey } }
  // — pdfBuffer/storageKey are alternate mailing-PDF sources (one or the
  // other is set, never both): a firm-supplied PDF uses storageKey directly;
  // an HTML letter (drafted here, or a previously-approved HTML draft) is
  // rendered to pdfBuffer via CoverLetterService.htmlToPdfBuffer.
  static async resolveFrontMatterLetters({ caseId, definition, context }, user) {
    const letters = {};
    for (const slot of (definition.letterSlots || []).filter((entry) => entry.placement === "front_matter")) {
      const existing = await Document.findOne({ caseId, documentType: slot.key, reviewStatus: "approved", deletedAt: { $exists: false } });
      if (existing) {
        const isHtml = /html/i.test(existing.mimeType || "");
        if (isHtml) {
          const html = (await require("../../uploads/storage.service").readBuffer(existing.storageKey)).toString("utf8");
          letters[slot.key] = { documentId: existing._id, title: slot.label, draft: false, html, pdfBuffer: await CoverLetterService.htmlToPdfBuffer(html, { title: slot.label }) };
        } else {
          letters[slot.key] = { documentId: existing._id, title: slot.label, draft: false, storageKey: existing.storageKey };
        }
        continue;
      }
      const drafted = await CoverLetterService.renderLetterDraft({ caseId, definition, slot, context }, user);
      if (drafted) letters[slot.key] = { documentId: drafted.document._id, title: slot.label, draft: true, html: drafted.html, pdfBuffer: drafted.pdfBuffer };
    }
    return letters;
  }

  // extraFormCodes: Phase H6 conditional forms (I-907/G-28/I-539/I-539A)
  // currently applicable to this case - passed by the caller (already
  // resolved via resolveConditionalRequirements) rather than re-derived
  // here, so this stays a plain fetch. A form whose condition has since
  // gone false is never in extraFormCodes to begin with (see
  // resolveConditionalRequirements), so it's excluded automatically -
  // no separate "exclude archived" filter needed.
  static async loadReadyCaseForms(caseId, definition, extraFormCodes = []) {
    const formCodes = [...new Set([...(definition.requiredForms || []).map((entry) => entry.formCode), ...extraFormCodes])];
    if (!formCodes.length) return [];
    return CaseForm.find({ caseId, formCode: { $in: formCodes } }).populate("generatedPdfDocument");
  }

  // Returns one entry per required certification regardless of whether it's
  // been approved yet (`doc: null` when missing) — the petition's section
  // list always shows every heading the definition calls for; only the
  // ACTUAL merged PDF/Word content is limited to what's resolved (see
  // assemble()'s renderableSections filter).
  static async resolveCertificationDocuments(caseId, definition) {
    return Promise.all((definition.requiredCertifications || []).map(async (cert) => {
      const doc = await Document.findOne({ caseId, documentType: cert.documentType, reviewStatus: "approved", deletedAt: { $exists: false } });
      return { cert, doc };
    }));
  }

  // Every document already placed in a non-exhibit mailing section this run
  // (form PDFs, certifications) must be excluded from ExhibitService's
  // "approved evidence" pool, or the same file appears twice in the packet.
  static claimedDocumentIds(caseForms, certificationDocs) {
    return [
      ...caseForms.filter((form) => form.generatedPdfDocument).map((form) => form.generatedPdfDocument._id),
      ...certificationDocs.filter((entry) => entry.doc).map((entry) => entry.doc._id),
    ];
  }

  // One placeholder-or-real entry per required form (unconditional +
  // currently-active conditional forms), G-28 excluded (handled separately
  // by the caller since it can come from an uploaded Document instead of a
  // generated CaseForm). A form with no CaseForm yet, or one not yet PDF-
  // generated, still gets its heading here — just with no documentId/
  // storageKey — so the petition's structure is visible from day one and
  // fills in as each form is generated.
  static buildFormSections(definition, caseForms, conditionalRequiredForms) {
    const formCodes = [...new Set([...(definition.requiredForms || []).map((entry) => entry.formCode), ...conditionalRequiredForms.map((entry) => entry.formCode)])];
    return formCodes.filter((formCode) => formCode !== "G-28").map((formCode) => {
      const form = caseForms.find((entry) => entry.formCode === formCode);
      const ready = form?.generatedPdfDocument?.storageKey;
      return {
        type: "form",
        key: formCode,
        title: formCode,
        documentId: ready ? form.generatedPdfDocument._id : undefined,
        caseFormId: form?._id,
        storageKey: ready ? form.generatedPdfDocument.storageKey : undefined,
      };
    });
  }

  // Sorts an already-built mailingSections pool by each section's `type`
  // rank in definition.ordering.mailing (the same field
  // PetitionWordPackageService already honors for the presentation copy —
  // see its buildPresentationHtml). Stable sort: sections sharing a type
  // keep their original relative order. A type absent from ordering.mailing
  // sorts after everything listed, rather than being dropped, so an
  // incomplete/legacy definition never silently loses content. A definition
  // with no ordering.mailing at all (empty array) is a no-op, preserving
  // whatever order the caller built — no regression for definitions that
  // predate this field.
  static orderMailingSections(sections, definition) {
    const orderList = definition?.ordering?.mailing || [];
    if (!orderList.length) return sections;
    const rank = new Map(orderList.map((type, index) => [type, index]));
    return [...sections].sort((a, b) => (rank.has(a.type) ? rank.get(a.type) : orderList.length) - (rank.has(b.type) ? rank.get(b.type) : orderList.length));
  }

  // Splices user-inserted blank/separator pages (see insertPage/removePage)
  // into the FINAL, already type-ordered mailing section list, anchored
  // after a specific section's key — must run AFTER orderMailingSections,
  // never before: these page types aren't in any definition's
  // ordering.mailing list, so an earlier pass would sort them all to the
  // end and lose the requested position. An insertAfterKey that no longer
  // matches anything (the anchor section was removed) degrades to
  // "append at the end" rather than dropping the page or throwing.
  static async applyManualInsertions(sections, manualInsertions = []) {
    if (!manualInsertions.length) return sections;
    let result = [...sections];
    for (const insertion of manualInsertions) {
      const buffer = await ExhibitService.buildStandalonePage({ type: insertion.type, title: insertion.title });
      const section = { type: insertion.type, key: insertion.key, title: insertion.title || (insertion.type === "blank_page" ? "Blank Page" : "Separator"), buffer };
      const anchorIndex = insertion.insertAfterKey ? result.findIndex((entry) => entry.key === insertion.insertAfterKey) : -1;
      result = anchorIndex === -1 ? [...result, section] : [...result.slice(0, anchorIndex + 1), section, ...result.slice(anchorIndex + 1)];
    }
    return result;
  }

  static async supersedeCurrent(caseId, packageDefinitionKey, excludeId) {
    await PetitionPackage.updateMany(
      { caseId, packageDefinitionKey, isCurrent: true, ...(excludeId ? { _id: { $ne: excludeId } } : {}) },
      { $set: { isCurrent: false, status: "superseded" } }
    );
  }

  // Non-blocking, non-user-initiated re-assembly — the event-driven hook
  // called at case creation and after every document/form approval, so the
  // petition draft always reflects the latest approved data without anyone
  // clicking "Assemble". Never throws: a case whose visa type has no active
  // PackageDefinition yet (or any other assembly failure) is silently
  // skipped rather than surfaced as an error to the caller of the
  // triggering action (case creation, document review, form approval).
  static async autoSync(caseId, user, req) {
    const logger = require("../../../utils/logger");
    try {
      const caseData = await Case.findById(caseId);
      if (!caseData) return null;
      const definition = await this.resolveDefinition({ caseData });
      if (!definition) return null;
      return await this.assemble(caseId, { definitionKey: definition.key }, user, req);
    } catch (error) {
      logger.error("petition_auto_sync_failed", { caseId: String(caseId), error: error.message });
      return null;
    }
  }

  static async assemble(caseId, { definitionKey, mode } = {}, user, req) {
    const caseData = await Case.findById(caseId);
    if (!caseData) throw Object.assign(new Error("Case not found"), { status: 404 });
    if (!caseService.canAccessCase(user, caseData)) throw Object.assign(new Error("Not authorized to assemble a petition for this case"), { status: 403 });

    const definition = await this.resolveDefinition({ definitionKey, caseData });
    if (!definition) throw Object.assign(new Error(`No active package definition found for visa type "${caseData.visaType}"`), { status: 422, code: "NO_PACKAGE_DEFINITION" });

    const existingCurrent = await PetitionPackage.findOne({ caseId, packageDefinitionKey: definition.key, isCurrent: true });
    if (existingCurrent?.lock?.locked) {
      throw Object.assign(new Error("This petition package is finalized and locked — unlock it before re-assembling"), { status: 409, code: "PACKAGE_LOCKED" });
    }

    const nextVersionNumber = (existingCurrent?.versionNumber || 0) + 1;
    let petitionPackage = await PetitionPackage.create({
      caseId,
      packageDefinitionKey: definition.key,
      packageDefinitionVersion: definition.version,
      status: "assembling",
      versionNumber: nextVersionNumber,
      isCurrent: true,
      createdBy: userId(user),
      // Manual page insertions are deliberate structural additions to this
      // case's binder (unlike exhibitOrder, a draft-only tweak) — carried
      // forward to every new version rather than reset.
      manualInsertions: existingCurrent?.manualInsertions || [],
      history: [{ versionNumber: nextVersionNumber, status: "assembling", action: "ASSEMBLE_STARTED", actorId: userId(user) }],
    });
    await this.supersedeCurrent(caseId, definition.key, petitionPackage._id);

    try {
      const context = await this.buildMergeContext(caseData, definition);
      const { conditionalRequiredForms, requiredDocuments } = await resolveConditionalRequirements(caseId);
      const caseForms = await this.loadReadyCaseForms(caseId, definition, conditionalRequiredForms.map((entry) => entry.formCode));
      const letters = await this.resolveFrontMatterLetters({ caseId, definition, context }, user);
      const certificationDocs = await this.resolveCertificationDocuments(caseId, definition);
      const { exhibits, exhibitIndex } = await ExhibitService.build(caseId, definition, { excludeDocumentIds: this.claimedDocumentIds(caseForms, certificationDocs) });

      // No-criteria drafting: validation still runs (it decides finalize
      // eligibility and surfaces what's missing), but it no longer aborts
      // assembly. A brand-new case with nothing approved yet still gets a
      // full petition package — cover letter + every required heading,
      // rendered as placeholders — and each subsequent document/form
      // approval re-runs this same assemble() to swap placeholders for
      // real content. Only finalize() (a separate, still-gated action)
      // refuses to proceed while validation.status is "blocked".
      const validation = await PetitionValidationService.validate({ caseId, definition, caseForms, letters, exhibits, conditionalRequiredForms, requiredDocuments });

      const { document: coverLetterDoc, html: coverLetterHtml, pdfBuffer: coverLetterPdfBuffer } = await CoverLetterService.renderCoverLetter({ caseId, definition, context, exhibitIndex, filingMethod: mode?.filingMethod || "usps" }, user);
      // Split the rendered cover letter into editable prose + the derived
      // exhibit-index table (a known, deterministic substring — see
      // CoverLetterService.buildExhibitIndexHtml) so the frontend editor
      // only ever touches the prose; the table always re-derives fresh from
      // package.exhibitIndex and is never itself editable.
      const coverLetterBodyHtml = coverLetterHtml.replace(CoverLetterService.buildExhibitIndexHtml(exhibitIndex), "");

      // G-28 inclusion (Phase H6): a manually uploaded, approved "g28"
      // Document (attorney-provided, already-signed) takes precedence over
      // the generated form - if one exists, use it verbatim. Otherwise, if
      // an attorney is on record, fall back to the GENERATED G-28 CaseForm
      // (from the imported G-28 template, filled like any other USCIS
      // form) - it's already in `caseForms` since conditionalRequiredForms
      // included "G-28" and loadReadyCaseForms fetched it above. The
      // generic `...caseForms.filter(...).map(...)` block below would
      // otherwise ALSO add it as a plain "form" section, so it's excluded
      // there and only added once, correctly labeled "g28".
      const uploadedG28Document = context.attorney.present ? await Document.findOne({ caseId, documentType: "g28", reviewStatus: "approved", deletedAt: { $exists: false } }) : null;
      const generatedG28Form = !uploadedG28Document ? caseForms.find((form) => form.formCode === "G-28" && form.generatedPdfDocument?.storageKey) : null;
      const g28Document = uploadedG28Document || (generatedG28Form ? generatedG28Form.generatedPdfDocument : null);
      // The full, heading-complete structure — every required form/
      // certification appears even before it exists (documentId/storageKey
      // left undefined), so petitionPackage.sections below always reflects
      // the definition's structure. Only entries that actually have content
      // (storageKey or buffer) are handed to the PDF assembler.
      const mailingSections = await this.applyManualInsertions(this.orderMailingSections([
        { type: "cover_letter", key: "cover_letter", title: "Cover Letter", documentId: coverLetterDoc._id, buffer: coverLetterPdfBuffer, contentHtml: coverLetterBodyHtml },
        ...(g28Document ? [{ type: "g28", key: "g28", title: "Form G-28", documentId: g28Document._id, storageKey: g28Document.storageKey }] : []),
        // Every other required form (I-129, and Phase H6's I-907/I-539/
        // I-539A when their condition is active) - G-28 is excluded here
        // since it's already added above (either the uploaded document or
        // the generated CaseForm), never both.
        ...this.buildFormSections(definition, caseForms, conditionalRequiredForms),
        ...certificationDocs.map(({ cert, doc }) => ({ type: "certification", key: cert.key, title: cert.label, documentId: doc?._id, storageKey: doc?.storageKey })),
        ...Object.entries(letters).map(([slotKey, letter]) => ({ type: slotKey, key: slotKey, title: letter.title, documentId: letter.documentId, storageKey: letter.storageKey, buffer: letter.pdfBuffer, contentHtml: letter.html || "" })),
      ], definition), petitionPackage.manualInsertions);
      const renderableSections = mailingSections.filter((section) => section.storageKey || section.buffer);

      const { document: mailingPdfDocument, totalPages, pageMap } = await FilingPackageService.assembleOrdered({
        caseId,
        packageType: `petition_${definition.key}`,
        sections: renderableSections,
        exhibits,
        watermark: mode?.finalize ? "" : "DRAFT",
        metadata: { title: `${definition.displayName} — ${caseData.caseNumber || caseData.caseId}` },
      }, user, req);

      const forms = await CaseForm.find({ caseId }).populate("generatedPdfDocument");
      const frontMatterLettersForWord = {};
      for (const [slotKey, letter] of Object.entries(letters)) {
        frontMatterLettersForWord[slotKey] = { title: letter.title, html: letter.html || "" };
      }
      const exhibitIndexHtml = CoverLetterService.buildExhibitIndexHtml(exhibitIndex);
      const { document: presentationDocument } = await PetitionWordPackageService.render({
        caseData,
        definition,
        coverLetterHtml,
        letters: frontMatterLettersForWord,
        exhibitIndexHtml,
        forms,
      }, user, req);

      petitionPackage.sections = mailingSections.map((section) => {
        const mapped = pageMap.find((entry) => entry.key === section.key);
        return { type: section.type, key: section.key, title: section.title, documentId: section.documentId, caseFormId: section.caseFormId, pageStart: mapped?.pageStart, pageEnd: mapped?.pageEnd, order: 0, contentHtml: section.contentHtml };
      });
      petitionPackage.exhibitIndex = exhibitIndex.map((exhibit) => {
        const mapped = pageMap.find((entry) => entry.label === exhibit.label);
        return { ...exhibit, pageStart: mapped?.pageStart, pageEnd: mapped?.pageEnd };
      });
      petitionPackage.outputs = {
        presentationWordDocumentId: presentationDocument._id,
        mailingPdfDocumentId: mailingPdfDocument._id,
        coverLetterDocumentId: coverLetterDoc._id,
      };
      petitionPackage.validation = { status: validation.status, issues: validation.issues, validatedAt: validation.validatedAt };
      // "blocked" no longer aborts assembly (see the no-criteria drafting
      // note above) — it just means the draft is missing required pieces,
      // reflected as needs_revision rather than assembled. finalize() is
      // still the one place that refuses to proceed on a blocked status.
      petitionPackage.status = validation.status === "blocked" ? "needs_revision" : "assembled";
      petitionPackage.assembledBy = userId(user);
      petitionPackage.history.push({ versionNumber: nextVersionNumber, status: petitionPackage.status, action: validation.status === "blocked" ? "ASSEMBLE_COMPLETED_WITH_ISSUES" : "ASSEMBLE_COMPLETED", actorId: userId(user), changeSummary: `${totalPages} pages, ${exhibits.length} exhibits`, validationSnapshot: validation });
      await petitionPackage.save();

      await AuditLog.create({ userId: userId(user), userRole: user?.role, action: validation.status === "blocked" ? "PETITION_ASSEMBLE_BLOCKED" : "PETITION_ASSEMBLED", entityType: "PetitionPackage", entityId: String(petitionPackage._id), changes: { caseId, versionNumber: nextVersionNumber, totalPages, exhibitCount: exhibits.length, issueCount: validation.issues.length }, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] }).catch(() => null);
      caseService.addTimelineEvent(caseData, "petition_assembled", "Petition Package Assembled", `${definition.displayName} petition assembled (v${nextVersionNumber}).`, user, { packageId: petitionPackage._id });
      await caseData.save();

      return petitionPackage;
    } catch (error) {
      // A structured error carrying `.issues` (e.g. an unreadable source PDF
      // from assembleOrdered) is a reportable validation failure, not a
      // crash — surface it the same way a blocked pre-assembly validation
      // would be, rather than a bare "failed" status with no actionable detail.
      if (error.issues) {
        petitionPackage.status = "needs_revision";
        petitionPackage.validation = { status: "blocked", issues: error.issues, validatedAt: new Date() };
        petitionPackage.history.push({ versionNumber: nextVersionNumber, status: "needs_revision", action: "ASSEMBLE_BLOCKED", actorId: userId(user), changeSummary: error.message });
        await petitionPackage.save().catch(() => null);
        return petitionPackage;
      }
      petitionPackage.status = "failed";
      petitionPackage.history.push({ versionNumber: nextVersionNumber, status: "failed", action: "ASSEMBLE_FAILED", actorId: userId(user), changeSummary: error.message });
      await petitionPackage.save().catch(() => null);
      throw error;
    }
  }

  // acknowledgeWarnings: true lets a team_lead+ finalize a package whose
  // validation status is "warnings" (e.g. an auto-drafted letter not yet
  // marked reviewed) — a "blocked" status can never be overridden this way.
  // The acknowledgment itself is the reviewer sign-off the spec calls for
  // ("drafts unreviewed at finalize require an explicit reviewer
  // acknowledgment, logged") — captured in the history entry + AuditLog
  // below, by whoever actually called finalize.
  static async finalize(packageId, user, req, { acknowledgeWarnings = false } = {}) {
    const petitionPackage = await PetitionPackage.findById(packageId);
    if (!petitionPackage) throw Object.assign(new Error("Package not found"), { status: 404 });
    const status = petitionPackage.validation?.status;
    if (status === "blocked") throw Object.assign(new Error("Cannot finalize — validation is blocked"), { status: 422 });
    if (status === "warnings" && !acknowledgeWarnings) {
      throw Object.assign(new Error("This package has unresolved warnings — pass acknowledgeWarnings:true to finalize anyway, or resolve them first"), { status: 422, code: "WARNINGS_UNACKNOWLEDGED" });
    }
    const definition = await PackageDefinition.findOne({ key: petitionPackage.packageDefinitionKey });
    const caseData = await Case.findById(petitionPackage.caseId);
    if (!caseData || !caseService.canAccessCase(user, caseData)) {
      throw Object.assign(new Error("Not authorized to access this petition package"), { status: 403 });
    }

    // Regenerate the mailing PDF clean (no draft watermark) for the final,
    // filing-ready copy. Forms/certifications are re-resolved fresh (they're
    // read-only elsewhere, so nothing to preserve). Letters and exhibit
    // order are NOT re-rendered from the template/default order — they use
    // THIS version's current, possibly-edited state (petitionPackage.sections'
    // contentHtml, petitionPackage.exhibitOrder) so finalize can never
    // silently discard edits made via PATCH .../letters or .../exhibits/order.
    const context = await this.buildMergeContext(caseData, definition);
    const { conditionalRequiredForms } = await resolveConditionalRequirements(petitionPackage.caseId);
    const caseForms = await this.loadReadyCaseForms(petitionPackage.caseId, definition, conditionalRequiredForms.map((entry) => entry.formCode));
    const certificationDocs = await this.resolveCertificationDocuments(petitionPackage.caseId, definition);
    const { exhibits, exhibitIndex } = await ExhibitService.build(petitionPackage.caseId, definition, {
      excludeDocumentIds: this.claimedDocumentIds(caseForms, certificationDocs),
      order: petitionPackage.exhibitOrder,
    });

    const coverLetterSection = petitionPackage.sections.find((section) => section.type === "cover_letter");
    const tableHtml = CoverLetterService.buildExhibitIndexHtml(exhibitIndex);
    const coverLetterFullHtml = `${coverLetterSection?.contentHtml || ""}${tableHtml}`;
    const coverLetterPdfBuffer = await CoverLetterService.htmlToPdfBuffer(coverLetterFullHtml, { title: "Cover Letter" });
    const coverLetterDoc = await CoverLetterService.persistLetter({ caseId: petitionPackage.caseId, html: coverLetterFullHtml, documentType: "cover_letter", title: "Cover Letter", tag: "cover-letter" }, user);

    const otherLetterSections = petitionPackage.sections.filter((section) => ["support_letter", "position_description_letter", "itinerary", "personal_statement"].includes(section.type));
    const otherLettersForMailing = await Promise.all(otherLetterSections.map(async (section) => ({
      type: section.type,
      key: section.key,
      title: section.title,
      documentId: section.documentId,
      buffer: await CoverLetterService.htmlToPdfBuffer(section.contentHtml || "", { title: section.title }),
    })));

    const uploadedG28Document = context.attorney.present ? await Document.findOne({ caseId: petitionPackage.caseId, documentType: "g28", reviewStatus: "approved", deletedAt: { $exists: false } }) : null;
    const generatedG28Form = !uploadedG28Document ? caseForms.find((form) => form.formCode === "G-28" && form.generatedPdfDocument?.storageKey) : null;
    const g28Document = uploadedG28Document || (generatedG28Form ? generatedG28Form.generatedPdfDocument : null);
    const mailingSections = await this.applyManualInsertions(this.orderMailingSections([
      { type: "cover_letter", key: "cover_letter", title: "Cover Letter", documentId: coverLetterDoc._id, buffer: coverLetterPdfBuffer },
      ...(g28Document ? [{ type: "g28", key: "g28", title: "Form G-28", documentId: g28Document._id, storageKey: g28Document.storageKey }] : []),
      ...caseForms.filter((form) => form.generatedPdfDocument?.storageKey && form.formCode !== "G-28").map((form) => ({ type: "form", key: form.formCode, title: form.formCode, documentId: form.generatedPdfDocument._id, caseFormId: form._id, storageKey: form.generatedPdfDocument.storageKey })),
      ...certificationDocs.map(({ cert, doc }) => ({ type: "certification", key: cert.key, title: cert.label, documentId: doc._id, storageKey: doc.storageKey })),
      ...otherLettersForMailing,
    ], definition), petitionPackage.manualInsertions);
    petitionPackage.outputs.coverLetterDocumentId = coverLetterDoc._id;
    const { document: mailingPdfDocument, totalPages, pageMap } = await FilingPackageService.assembleOrdered({
      caseId: petitionPackage.caseId,
      packageType: `petition_${definition.key}_final`,
      sections: mailingSections.filter((section) => section.storageKey || section.buffer),
      exhibits,
      watermark: "",
      metadata: { title: `${definition.displayName} — ${caseData.caseNumber || caseData.caseId} (Final)` },
    }, user, req);

    petitionPackage.outputs.mailingPdfDocumentId = mailingPdfDocument._id;
    petitionPackage.exhibitIndex = exhibitIndex.map((exhibit) => {
      const mapped = pageMap.find((entry) => entry.label === exhibit.label);
      return { ...exhibit, pageStart: mapped?.pageStart, pageEnd: mapped?.pageEnd };
    });
    petitionPackage.sections = petitionPackage.sections.map((section) => {
      const mapped = pageMap.find((entry) => entry.key === section.key);
      const documentId = section.type === "cover_letter" ? coverLetterDoc._id : section.documentId;
      return mapped ? { ...section.toObject(), documentId, pageStart: mapped.pageStart, pageEnd: mapped.pageEnd } : section;
    });
    petitionPackage.status = "finalized";
    petitionPackage.lock = { locked: true, lockedAt: new Date(), lockedBy: userId(user) };
    petitionPackage.finalizedBy = userId(user);
    petitionPackage.history.push({ versionNumber: petitionPackage.versionNumber, status: "finalized", action: "FINALIZE", actorId: userId(user), changeSummary: `${totalPages} pages (clean, no watermark)${status === "warnings" ? " — warnings acknowledged" : ""}` });
    await petitionPackage.save();

    caseData.status = caseData.status === "ready_to_file" ? caseData.status : "ready_to_file";
    caseService.addTimelineEvent(caseData, "petition_finalized", "Petition Finalized", `${definition.displayName} petition finalized and locked — ready to file.`, user, { packageId: petitionPackage._id });
    await caseData.save();

    await AuditLog.create({ userId: userId(user), userRole: user?.role, action: "PETITION_FINALIZED", entityType: "PetitionPackage", entityId: String(petitionPackage._id), changes: { caseId: petitionPackage.caseId }, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] }).catch(() => null);
    return petitionPackage;
  }

  // Persists an edited letter's HTML onto this version — never re-renders
  // from the template, never touches the assembled mailing PDF (that only
  // reflects letters as of the last assemble/finalize; editing here is a
  // working-draft change, not a re-assembly). For the cover letter, `html`
  // is the PROSE ONLY (frontend never sends the exhibit-index table); the
  // persisted Document combines it with the CURRENT table so downloads
  // stay correct, while `sections[].contentHtml` keeps just the prose for
  // the editor.
  static async saveLetterEdit(packageId, sectionKey, html, user, req) {
    const { petitionPackage } = await this.loadAuthorizedPackage(packageId, user);
    if (petitionPackage.lock?.locked) throw Object.assign(new Error("This petition package is finalized and locked — unlock it before editing"), { status: 409, code: "PACKAGE_LOCKED" });
    const section = petitionPackage.sections.find((entry) => entry.key === sectionKey);
    if (!section) throw Object.assign(new Error(`Section "${sectionKey}" not found on this package`), { status: 404 });
    if (!["cover_letter", "support_letter", "position_description_letter", "itinerary", "personal_statement"].includes(section.type)) {
      throw Object.assign(new Error(`Section "${sectionKey}" is not an editable letter`), { status: 422 });
    }

    const isCoverLetter = section.type === "cover_letter";
    const persistedHtml = isCoverLetter ? `${html}${CoverLetterService.buildExhibitIndexHtml(petitionPackage.exhibitIndex)}` : html;
    const document = await CoverLetterService.persistLetter({
      caseId: petitionPackage.caseId,
      html: persistedHtml,
      documentType: section.type === "cover_letter" ? "cover_letter" : section.type,
      title: section.title,
      tag: section.key,
    }, user);

    section.contentHtml = html;
    section.documentId = document._id;
    if (isCoverLetter) petitionPackage.outputs.coverLetterDocumentId = document._id;
    petitionPackage.history.push({ versionNumber: petitionPackage.versionNumber, status: petitionPackage.status, action: "LETTER_EDITED", actorId: userId(user), changeSummary: `Edited ${section.title}` });
    await petitionPackage.save();

    await AuditLog.create({ userId: userId(user), userRole: user?.role, action: "PETITION_LETTER_EDITED", entityType: "PetitionPackage", entityId: String(petitionPackage._id), changes: { sectionKey, documentId: document._id }, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] }).catch(() => null);
    return petitionPackage;
  }

  // Re-labels exhibits in the requested order and re-renders ONLY the cover
  // letter's exhibit-index table (recomputed from the new order, concatenated
  // with the CURRENT prose — never touching or overwriting user edits to the
  // letter body). Page numbers on the reordered exhibits/sections go stale
  // until the next assemble/finalize — recomputing them would mean a full
  // mailing-PDF rebuild on every drag, too slow for a live reorder.
  static async reorderExhibits(packageId, order, user, req) {
    const { petitionPackage } = await this.loadAuthorizedPackage(packageId, user);
    if (petitionPackage.lock?.locked) throw Object.assign(new Error("This petition package is finalized and locked — unlock it before reordering exhibits"), { status: 409, code: "PACKAGE_LOCKED" });

    const definition = await PackageDefinition.findOne({ key: petitionPackage.packageDefinitionKey });
    const { conditionalRequiredForms } = await resolveConditionalRequirements(petitionPackage.caseId);
    const caseForms = await this.loadReadyCaseForms(petitionPackage.caseId, definition, conditionalRequiredForms.map((entry) => entry.formCode));
    const certificationDocs = await this.resolveCertificationDocuments(petitionPackage.caseId, definition);
    const { exhibitIndex } = await ExhibitService.build(petitionPackage.caseId, definition, {
      excludeDocumentIds: this.claimedDocumentIds(caseForms, certificationDocs),
      order,
    });

    // Preserve old page numbers where a bucket's key still matches (best
    // effort — exact per exhibit types).
    const oldByKey = new Map(petitionPackage.exhibitIndex.map((entry) => [entry.key, entry]));
    petitionPackage.exhibitIndex = exhibitIndex.map((entry) => ({ ...entry, pageStart: oldByKey.get(entry.key)?.pageStart, pageEnd: oldByKey.get(entry.key)?.pageEnd }));
    petitionPackage.exhibitOrder = order;

    const coverLetterSection = petitionPackage.sections.find((section) => section.type === "cover_letter");
    if (coverLetterSection) {
      const persistedHtml = `${coverLetterSection.contentHtml || ""}${CoverLetterService.buildExhibitIndexHtml(petitionPackage.exhibitIndex)}`;
      const document = await CoverLetterService.persistLetter({ caseId: petitionPackage.caseId, html: persistedHtml, documentType: "cover_letter", title: "Cover Letter", tag: "cover-letter" }, user);
      coverLetterSection.documentId = document._id;
      petitionPackage.outputs.coverLetterDocumentId = document._id;
    }

    petitionPackage.history.push({ versionNumber: petitionPackage.versionNumber, status: petitionPackage.status, action: "EXHIBITS_REORDERED", actorId: userId(user), changeSummary: `${order.length} exhibits reordered` });
    await petitionPackage.save();

    await AuditLog.create({ userId: userId(user), userRole: user?.role, action: "PETITION_EXHIBITS_REORDERED", entityType: "PetitionPackage", entityId: String(petitionPackage._id), changes: { order }, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] }).catch(() => null);
    return petitionPackage;
  }

  // Inserts a blank or titled separator page anchored after an existing
  // section/exhibit key (see applyManualInsertions). Structural, unlike
  // saveLetterEdit/reorderExhibits (which mutate the current draft in
  // place) — a page insertion changes the mailing PDF's actual content, so
  // it's persisted onto the current package AND immediately re-assembled
  // (new version), the same "structural change → re-run assemble()"
  // pattern autoSync already uses for document/form approvals.
  static async insertPage(packageId, { type, title, insertAfterKey } = {}, user, req) {
    if (!["blank_page", "separator_page"].includes(type)) {
      throw Object.assign(new Error('type must be "blank_page" or "separator_page"'), { status: 422 });
    }
    const { petitionPackage } = await this.loadAuthorizedPackage(packageId, user);
    if (petitionPackage.lock?.locked) throw Object.assign(new Error("This petition package is finalized and locked — unlock it before inserting a page"), { status: 409, code: "PACKAGE_LOCKED" });

    const key = `manual_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    petitionPackage.manualInsertions.push({ key, type, title: title || "", insertAfterKey: insertAfterKey || null, createdBy: userId(user) });
    await petitionPackage.save();

    await AuditLog.create({ userId: userId(user), userRole: user?.role, action: "PETITION_PAGE_INSERTED", entityType: "PetitionPackage", entityId: String(petitionPackage._id), changes: { type, insertAfterKey }, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] }).catch(() => null);
    return this.assemble(petitionPackage.caseId, { definitionKey: petitionPackage.packageDefinitionKey }, user, req);
  }

  static async removePage(packageId, sectionKey, user, req) {
    const { petitionPackage } = await this.loadAuthorizedPackage(packageId, user);
    if (petitionPackage.lock?.locked) throw Object.assign(new Error("This petition package is finalized and locked — unlock it before removing a page"), { status: 409, code: "PACKAGE_LOCKED" });

    const before = petitionPackage.manualInsertions.length;
    petitionPackage.manualInsertions = petitionPackage.manualInsertions.filter((entry) => entry.key !== sectionKey);
    if (petitionPackage.manualInsertions.length === before) {
      throw Object.assign(new Error(`No inserted page found with key "${sectionKey}"`), { status: 404 });
    }
    await petitionPackage.save();

    await AuditLog.create({ userId: userId(user), userRole: user?.role, action: "PETITION_PAGE_REMOVED", entityType: "PetitionPackage", entityId: String(petitionPackage._id), changes: { sectionKey }, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] }).catch(() => null);
    return this.assemble(petitionPackage.caseId, { definitionKey: petitionPackage.packageDefinitionKey }, user, req);
  }

  static async unlock(packageId, { reason }, user, req) {
    const { petitionPackage } = await this.loadAuthorizedPackage(packageId, user);
    petitionPackage.lock = { locked: false, lockedAt: null, lockedBy: null, reason };
    petitionPackage.status = "assembled";
    petitionPackage.history.push({ versionNumber: petitionPackage.versionNumber, status: "assembled", action: "UNLOCK", actorId: userId(user), changeSummary: reason });
    await petitionPackage.save();
    await AuditLog.create({ userId: userId(user), userRole: user?.role, action: "PETITION_UNLOCKED", entityType: "PetitionPackage", entityId: String(petitionPackage._id), changes: { reason }, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] }).catch(() => null);
    return petitionPackage;
  }

  static async recordFiling(packageId, { method, addressUsed, shippedAt, trackingNumber }, user, req) {
    const { petitionPackage } = await this.loadAuthorizedPackage(packageId, user);
    petitionPackage.status = "filed";
    petitionPackage.filing = { ...petitionPackage.filing, method, addressUsed, shippedAt, trackingNumber, filedBy: userId(user) };
    petitionPackage.history.push({ versionNumber: petitionPackage.versionNumber, status: "filed", action: "RECORD_FILING", actorId: userId(user), changeSummary: `${method} ${trackingNumber || ""}`.trim() });
    await petitionPackage.save();
    await AuditLog.create({ userId: userId(user), userRole: user?.role, action: "PETITION_FILED", entityType: "PetitionPackage", entityId: String(petitionPackage._id), changes: { method, trackingNumber }, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] }).catch(() => null);
    return petitionPackage;
  }

  static async recordReceipt(packageId, { receiptNumber }, user, req) {
    const { petitionPackage } = await this.loadAuthorizedPackage(packageId, user);
    petitionPackage.filing = { ...petitionPackage.filing, receiptNumber };
    petitionPackage.history.push({ versionNumber: petitionPackage.versionNumber, status: petitionPackage.status, action: "RECORD_RECEIPT", actorId: userId(user), changeSummary: receiptNumber });
    await petitionPackage.save();
    await AuditLog.create({ userId: userId(user), userRole: user?.role, action: "PETITION_RECEIPT_RECORDED", entityType: "PetitionPackage", entityId: String(petitionPackage._id), changes: { receiptNumber }, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] }).catch(() => null);
    return petitionPackage;
  }
}

module.exports = PetitionAssemblyService;

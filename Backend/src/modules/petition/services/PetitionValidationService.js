const Document = require("../../../models/Document");

// Package-level completeness / RFE-readiness gate. Deliberately does NOT
// re-run PDFFieldMapper/PDFValidationService's per-field checks — a
// CaseForm can only ever have generatedPdfDocument set if
// PDFGenerationService.generate() already ran PDFValidationService.validate()
// and it came back with zero blocking errors (including SIGNATURE_MISSING).
// So "a real, non-deleted generated PDF exists" IS the field-level
// validation guarantee, inherited rather than re-derived. This service only
// adds the NEW layer: is everything a real filing-ready petition needs
// actually present, assembled, and correctly labeled.
//
// THE SEAM (Phase H5): "has a generated PDF" is NOT enough on its own — a
// form can be generated, then later unlocked and edited again
// (interactive-form-review.service's setLock reverts status to
// under_review/isLocked:false while any PRIOR generatedPdfDocument stays set
// on the CaseForm, since generation is never retroactively deleted). Without
// an explicit approved+locked check here, assembling a petition from such a
// form would silently ship a stale or since-edited PDF. So every required
// form must ALSO be individually confirmed approved (status/approvedBy) and
// currently locked (isLocked:true) - not merely "has ever been generated."
class PetitionValidationService {
  static addIssue(issues, severity, code, message, details = {}) {
    issues.push({ severity, code, message, ...details });
  }

  // caseForms must already be populated with generatedPdfDocument.
  // letters is a map of slotKey -> { documentId, draft } for front_matter
  // slots only (resolved by the caller before validation runs).
  //
  // Phase H6: conditionalRequiredForms/requiredDocuments let the caller
  // (PetitionAssemblyService) require I-907/G-28/I-539/I-539A and the cap
  // selection notice ONLY when their real-world condition is currently true
  // (active premium addon / attorney on record / H-4 dependents / New-CAP
  // filing) - resolved once by the caller via uscisFormService's condition
  // helpers, not re-derived here, so this service stays a pure check over
  // whatever requirements it's handed. definition.requiredForms/
  // requiredCertifications remain the UNCONDITIONAL, always-required list;
  // these two params are the conditional, case-specific additions.
  static async validate({ caseId, definition, caseForms, letters = {}, exhibits = [], conditionalRequiredForms = [], requiredDocuments = [] }) {
    const issues = [];

    for (const requirement of [...(definition.requiredForms || []), ...conditionalRequiredForms]) {
      if (!requirement.required) continue;
      const caseForm = caseForms.find((form) => form.formCode === requirement.formCode);
      if (!caseForm) {
        this.addIssue(issues, "error", "FORM_NOT_FOUND", `${requirement.formCode} has not been started for this case`, { formCode: requirement.formCode });
        continue;
      }
      const generated = caseForm.generatedPdfDocument;
      const ready = generated && !generated.deletedAt && generated.storageKey;
      if (!ready) {
        this.addIssue(issues, "error", "FORM_NOT_GENERATED", `${requirement.formCode} has not been generated, or its generated PDF is missing — cannot assemble`, { formCode: requirement.formCode });
        continue;
      }
      const approved = Boolean(caseForm.approvedBy) && ["approved", "ready_for_pdf", "generated", "locked"].includes(caseForm.status);
      if (!approved) {
        this.addIssue(issues, "error", "FORM_NOT_APPROVED", `${requirement.formCode} has not been approved by a team lead or admin — cannot assemble`, { formCode: requirement.formCode });
        continue;
      }
      if (!caseForm.isLocked) {
        this.addIssue(issues, "error", "FORM_NOT_LOCKED", `${requirement.formCode} is approved but not locked — lock it before assembling so it can't change out from under the petition`, { formCode: requirement.formCode });
        continue;
      }
      if (caseForm.syncState?.stale || caseForm.syncState?.requiresRegeneration) {
        this.addIssue(issues, "warning", "FORM_OUT_OF_DATE", `${requirement.formCode} was changed after its PDF was generated — consider regenerating before filing`, { formCode: requirement.formCode });
      }
    }

    for (const cert of definition.requiredCertifications || []) {
      if (!cert.required) continue;
      const exists = await Document.exists({ caseId, documentType: cert.documentType, reviewStatus: "approved", deletedAt: { $exists: false } });
      if (!exists) this.addIssue(issues, "error", "CERTIFICATION_MISSING", `Required certification missing: ${cert.label}`, { sectionKey: cert.key });
    }

    for (const doc of requiredDocuments) {
      if (!doc.required) continue;
      const exists = await Document.exists({ caseId, documentType: doc.documentType, reviewStatus: "approved", deletedAt: { $exists: false } });
      if (!exists) this.addIssue(issues, "error", doc.code || "REQUIRED_DOCUMENT_MISSING", `Required document missing: ${doc.label}`, { sectionKey: doc.documentType });
    }

    for (const slot of definition.letterSlots || []) {
      if (!slot.required || slot.placement !== "front_matter") continue;
      const resolved = letters[slot.key];
      if (!resolved) this.addIssue(issues, "error", "LETTER_MISSING", `Required letter missing: ${slot.label}`, { sectionKey: slot.key });
      else if (resolved.draft) this.addIssue(issues, "warning", "LETTER_DRAFT_UNREVIEWED", `${slot.label} was auto-drafted and has not been marked reviewed`, { sectionKey: slot.key });
    }

    for (const exhibit of exhibits) {
      if (exhibit.required && !exhibit.documentIds.length) {
        this.addIssue(issues, "error", "EXHIBIT_MISSING", `Required exhibit has no approved documents: ${exhibit.title}`, { sectionKey: exhibit.key });
      } else if (exhibit.unclassified) {
        this.addIssue(issues, "warning", "EXHIBIT_UNCLASSIFIED", `${exhibit.documentIds.length} approved document(s) did not match any exhibit category and were filed under Additional Supporting Evidence`, { sectionKey: exhibit.key });
      }
    }

    const errors = issues.filter((issue) => issue.severity === "error");
    const status = errors.length ? "blocked" : issues.length ? "warnings" : "passed";
    return { status, issues, validatedAt: new Date() };
  }
}

module.exports = PetitionValidationService;

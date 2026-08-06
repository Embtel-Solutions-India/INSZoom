const crypto = require("crypto");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const AuditLog = require("../../../models/AuditLog");
const notificationService = require("../../notifications/notification.service");
const storageService = require("../../uploads/storage.service");
const PDFFieldScannerService = require("./PDFFieldScannerService");
const FormMetadataService = require("./FormMetadataService");
const FieldLabelEnrichmentService = require("./FieldLabelEnrichmentService");
const FormVersionService = require("./FormVersionService");
const { FormValidationService, enterpriseError } = require("./FormValidationService");
const { normalizePdf } = require("../../../utils/normalizePdf");

function checksum(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function userId(user) {
  return user?._id || user?.id || user;
}

function normalizeFormCode(value = "") {
  return String(value).trim().toUpperCase();
}

function assertOfficialUscisUrl(url) {
  if (!/^https:\/\/.+/i.test(String(url || ""))) {
    throw enterpriseError("A valid HTTPS pdfUrl is required for system import", 400, "INVALID_PDF_URL");
  }
  const parsed = new URL(url);
  if (parsed.hostname !== "uscis.gov" && !parsed.hostname.endsWith(".uscis.gov")) {
    throw enterpriseError("Only official USCIS PDF URLs are supported", 400, "UNSUPPORTED_PDF_SOURCE");
  }
  return parsed;
}

async function fetchPdf(url) {
  assertOfficialUscisUrl(url);
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; ImmigrationCRM-USCIS-Importer/1.0; +https://www.uscis.gov/forms/all-forms)",
      accept: "application/pdf,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  if (!response.ok) throw enterpriseError(`Failed to download USCIS PDF: ${response.status}`, 502, "PDF_DOWNLOAD_FAILED");
  const contentType = response.headers.get("content-type") || "";
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (contentType && !/pdf|octet-stream/i.test(contentType) && buffer.subarray(0, 5).toString("utf8") !== "%PDF-") {
    throw enterpriseError("Downloaded resource is not a PDF", 400, "DOWNLOADED_RESOURCE_NOT_PDF");
  }
  return {
    buffer,
    contentType,
    contentLength: Number(response.headers.get("content-length")) || buffer.length,
    downloadedAt: new Date(),
  };
}

function storageSegment(value = "") {
  return String(value).trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function immutableVersionId(formCode, version, checksumValue) {
  return `uscis:${storageSegment(formCode)}:${storageSegment(version)}:${checksumValue}`;
}

function pdfFieldMappings(fields = []) {
  return fields.map((field) => ({
    caseField: field.fieldId,
    formFieldId: field.fieldId,
    pdfField: field.fieldName,
    type: field.type,
    pageNumber: field.pageNumber,
  }));
}

class USCISFormImporterService {
  constructor() {
    this.scanner = new PDFFieldScannerService();
    this.metadata = new FormMetadataService();
    this.validation = new FormValidationService();
    this.versioning = new FormVersionService();
  }

  async audit(action, template, user, req, changes = {}) {
    await AuditLog.create({
      userId: userId(user),
      userRole: user?.role,
      action,
      entityType: "USCISFormTemplate",
      entityId: template?._id?.toString(),
      changes,
      ipAddress: req?.ip,
      userAgent: req?.headers?.["user-agent"],
      description: `${action} ${template?.formCode || changes.formCode || ""} ${template?.version || changes.version || ""}`.trim(),
    }).catch(() => null);
  }

  async notifyAdmins(title, message, metadata, user, req) {
    await notificationService.createForRoles(["super_admin", "admin"], {
      source: "shared",
      category: "system",
      type: "uscis_form_import",
      title,
      message,
      metadata,
    }, user, req).catch(() => []);
  }

  async downloadOfficialPdf(url, artifactType = "form") {
    const maxAttempts = Math.min(Math.max(Number(process.env.USCIS_PDF_DOWNLOAD_MAX_ATTEMPTS || 3), 1), 6);
    const baseDelayMs = Math.max(Number(process.env.USCIS_PDF_DOWNLOAD_RETRY_DELAY_MS || 500), 0);
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const downloaded = await fetchPdf(url);
        await this.validation.validatePdfBuffer(downloaded.buffer);
        return { ...downloaded, attempts: attempt, sourceUrl: url, artifactType };
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts && baseDelayMs) {
          await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (2 ** (attempt - 1))));
        }
      }
    }
    lastError.attempts = maxAttempts;
    lastError.artifactType = artifactType;
    throw lastError;
  }

  async storeArtifacts(metadata, sourceChecksum, buffer, input = {}) {
    const baseKey = [
      "government",
      "uscis",
      storageSegment(metadata.formCode),
      storageSegment(metadata.version),
      sourceChecksum,
    ].join("/");
    const storedForm = await storageService.storeImmutableBuffer(`${baseKey}/form.pdf`, buffer);
    let storedInstructions = null;
    let instructionsChecksum = null;
    if (input.instructionsBuffer) {
      await this.validation.validatePdfBuffer(input.instructionsBuffer);
      instructionsChecksum = checksum(input.instructionsBuffer);
      storedInstructions = await storageService.storeImmutableBuffer(`${baseKey}/instructions-${instructionsChecksum}.pdf`, input.instructionsBuffer);
    }
    return {
      immutableVersionId: immutableVersionId(metadata.formCode, metadata.version, sourceChecksum),
      form: {
        sourceUrl: metadata.sourcePdfUrl,
        storageProvider: storedForm.provider,
        storageKey: storedForm.key,
        storagePath: storedForm.path,
        checksum: storedForm.checksum,
        fileSize: storedForm.size,
        downloadedAt: input.formDownload?.downloadedAt || new Date(),
        downloadAttempts: input.formDownload?.attempts || 0,
        status: storedForm.duplicate ? "duplicate" : "downloaded",
      },
      instructions: input.instructionsBuffer ? {
        sourceUrl: input.instructionsPdfUrl,
        storageProvider: storedInstructions.provider,
        storageKey: storedInstructions.key,
        storagePath: storedInstructions.path,
        checksum: instructionsChecksum,
        fileSize: storedInstructions.size,
        downloadedAt: input.instructionsDownload?.downloadedAt || new Date(),
        downloadAttempts: input.instructionsDownload?.attempts || 0,
        status: storedInstructions.duplicate ? "duplicate" : "downloaded",
      } : {
        sourceUrl: input.instructionsPdfUrl,
        downloadAttempts: input.instructionsDownload?.attempts || 0,
        status: input.instructionsPdfUrl ? "failed" : "missing",
        error: input.instructionsError,
      },
    };
  }

  async importFromBuffer(buffer, input = {}, user, req) {
    const importedAt = new Date();
    try {
      // sourceChecksum is always the fingerprint of the RAW bytes exactly as
      // downloaded/provided — computed first, before anything below ever
      // touches the buffer, and never affected by normalization.
      const sourceChecksum = checksum(buffer);
      // Some official USCIS PDFs (e.g. the I-129) ship with compressed
      // object/xref streams plus a hidden XFA layer that make pdf-lib's
      // PDFDocument.load() throw ("Expected instance of PDFDict, but got
      // instance of undefined") — this affects BOTH validatePdfBuffer's own
      // load call and the scanner's. qpdf rewrites the file into a form
      // pdf-lib can parse (object streams disabled, streams uncompressed);
      // normalizing here, before validation, is required for those PDFs to
      // import at all. metadata.extract() below intentionally still reads
      // the RAW buffer — it already degrades gracefully if pdf-lib can't
      // load it (falls back to scanResult's page count / empty text), and
      // `fileSize`/pdfParse-derived fields should reflect the original file.
      const normalizedBuffer = await normalizePdf(buffer);
      await this.validation.validatePdfBuffer(normalizedBuffer);
      const scanResult = await this.scanner.scan(normalizedBuffer);
      this.validation.validateFields(scanResult, { allowEmpty: (input.provider || "uscis") === "uscis" });
      // Explicit stop even when validateFields' allowEmpty would otherwise
      // tolerate it — a normalized PDF with zero AcroForm fields means
      // normalization silently lost the form's fillable layer, and importing
      // it would create an unusable template. Nothing is stored.
      if (!scanResult.fields?.length) {
        throw enterpriseError(
          "Normalized PDF scan found zero AcroForm fields — aborting import; the form was not stored.",
          422,
          "NORMALIZED_SCAN_EMPTY_FIELDS"
        );
      }
      const metadata = await this.metadata.extract(buffer, input, scanResult);
      metadata.formCode = normalizeFormCode(metadata.formCode);
      metadata.formNumber = metadata.formCode;
      this.validation.validateMetadata(metadata);
      // Human-readable labels + USCIS-use-only classification (see
      // FieldLabelEnrichmentService's own header). Fields are kept (not
      // dropped) here, including uscis_use_only ones - PDF flattening and
      // FormMappingService both walk the FULL formFields array, so barcode
      // fields still need to exist there; they're filtered out later, at
      // the review-facing boundary (uscis-form.service.js's buildSections()),
      // not at storage time.
      scanResult.fields = FieldLabelEnrichmentService.enrichFields(scanResult.fields, metadata.formCode);
      const sameVersion = await USCISFormTemplate.findOne({ formCode: metadata.formCode, version: metadata.version });
      const sameVersionChecksum = sameVersion?.artifacts?.form?.checksum || sameVersion?.importMetadata?.checksum || sameVersion?.lifecycle?.sourceChecksum;
      if (sameVersion && sameVersionChecksum && sameVersionChecksum !== sourceChecksum) {
        metadata.version = `${metadata.version}-rev-${sourceChecksum.slice(0, 12)}`;
      }
      const duplicate = await this.validation.detectDuplicate({
        formCode: metadata.formCode,
        version: metadata.version,
        checksum: sourceChecksum,
        fieldFingerprint: scanResult.fieldFingerprint,
      });
      if (duplicate) {
        if ((!duplicate.pdfStorageKey || (input.instructionsBuffer && !duplicate.instructionsStorageKey))) {
          const artifacts = await this.storeArtifacts(metadata, sourceChecksum, normalizedBuffer, input);
          duplicate.immutableVersionId = duplicate.immutableVersionId || artifacts.immutableVersionId;
          duplicate.pdfStorageKey = duplicate.pdfStorageKey || artifacts.form.storageKey;
          duplicate.pdfTemplatePath = duplicate.pdfTemplatePath || artifacts.form.storagePath;
          duplicate.localPdfPath = duplicate.localPdfPath || artifacts.form.storagePath;
          duplicate.instructionsPdfUrl = duplicate.instructionsPdfUrl || input.instructionsPdfUrl;
          duplicate.instructionsStorageKey = duplicate.instructionsStorageKey || artifacts.instructions.storageKey;
          duplicate.artifacts = {
            form: duplicate.artifacts?.form?.storageKey ? duplicate.artifacts.form : artifacts.form,
            instructions: duplicate.artifacts?.instructions?.storageKey ? duplicate.artifacts.instructions : artifacts.instructions,
          };
          await duplicate.save();
        } else if (input.instructionsPdfUrl && !duplicate.instructionsStorageKey && input.instructionsError) {
          duplicate.instructionsPdfUrl = duplicate.instructionsPdfUrl || input.instructionsPdfUrl;
          duplicate.artifacts = {
            ...(duplicate.artifacts?.toObject?.() || duplicate.artifacts || {}),
            instructions: {
              sourceUrl: input.instructionsPdfUrl,
              downloadAttempts: input.instructionsDownload?.attempts || Number(process.env.USCIS_PDF_DOWNLOAD_MAX_ATTEMPTS || 3),
              status: "failed",
              error: input.instructionsError,
            },
          };
          await duplicate.save();
        }
        await this.audit("FORM_IMPORT_DUPLICATE_DETECTED", duplicate, user, req, {
          formCode: metadata.formCode,
          version: metadata.version,
          checksum: sourceChecksum,
        });
        await require("../../questionnaires/question-library.service").syncTemplate(duplicate, user, req).catch(async (error) => {
          await this.audit("QUESTION_LIBRARY_SYNC_FAILED", duplicate, user, req, { message: error.message });
        });
        let synchronizedDuplicate = duplicate;
        if (!duplicate.mappingVersion) {
          await require("../../form-mapping/services/MappingGraphService")
            .generate(duplicate._id, { persist: true }, user, req)
            .catch(async (error) => this.audit("MAPPING_GENERATION_FAILED", duplicate, user, req, { message: error.message }));
          synchronizedDuplicate = await USCISFormTemplate.findById(duplicate._id);
        }
        return { duplicate: true, template: synchronizedDuplicate, data: synchronizedDuplicate, scanResult, metadata };
      }
      const artifacts = await this.storeArtifacts(metadata, sourceChecksum, normalizedBuffer, input);
      const templatePayload = {
        formCode: metadata.formCode,
        formNumber: metadata.formCode,
        formName: metadata.formName,
        title: metadata.title,
        editionDate: metadata.editionDate,
        revisionDate: metadata.revisionDate,
        effectiveDate: input.effectiveDate ? new Date(input.effectiveDate) : undefined,
        version: metadata.version,
        immutableVersionId: artifacts.immutableVersionId,
        status: input.status || "draft",
        officialStatus: input.officialStatus || "current",
        category: input.category,
        categories: input.categories || (input.category ? [input.category] : []),
        relatedForms: input.relatedForms || [],
        description: input.description,
        officialPdfUrl: metadata.sourcePdfUrl,
        instructionsPdfUrl: input.instructionsPdfUrl,
        instructionsStorageKey: artifacts.instructions.storageKey,
        localPdfPath: artifacts.form.storagePath,
        pdfTemplatePath: artifacts.form.storagePath,
        pdfStorageKey: artifacts.form.storageKey,
        artifacts,
        pdfMetadata: {
          provider: metadata.provider,
          pageCount: metadata.pageCount,
          pdfVersion: metadata.pdfVersion,
          pdfInfo: metadata.pdfInfo,
          fieldCount: scanResult.fieldCount,
          fieldFingerprint: scanResult.fieldFingerprint,
          extractedAt: scanResult.scannedAt,
          scannerVersion: "2.0",
          scannerWarnings: scanResult.warnings || [],
          scannerErrors: scanResult.errors || [],
          sourceChecksum,
          sourceMetadataChecksum: input.precomputedChecksum,
          downloadDate: artifacts.form.downloadedAt,
          fileSize: artifacts.form.fileSize,
        },
        formFields: scanResult.fields,
        sections: scanResult.sections?.length ? scanResult.sections : metadata.sections,
        formStructure: scanResult.structure || metadata.formStructure,
        formLayout: scanResult.layout || {},
        fieldIndexes: scanResult.indexes || {},
        fieldDependencies: scanResult.dependencies || [],
        validationRules: scanResult.validation || {},
        definition: {
          metadata,
          sections: scanResult.sections?.length ? scanResult.sections : metadata.sections,
          fields: scanResult.fields,
          pages: scanResult.pages || metadata.formStructure?.pages || [],
          groups: scanResult.groups || [],
          repeatableGroups: scanResult.repeatableGroups || [],
          questions: scanResult.structure?.questions || [],
          dependencies: scanResult.dependencies || [],
          validation: scanResult.validation || {},
          indexes: scanResult.indexes || {},
          layout: scanResult.layout || {},
          formStructure: scanResult.structure || metadata.formStructure,
        },
        pdfFieldMappings: pdfFieldMappings(scanResult.fields),
        parserMetadata: {
          version: "3.0",
          parsedAt: scanResult.scannedAt,
          source: "pdf_acroform",
          usedOcr: false,
          confidence: scanResult.confidence,
          status: scanResult.parserStatus,
          reviewItems: scanResult.reviewItems || [],
          warnings: scanResult.warnings || [],
          errors: scanResult.errors || [],
        },
        importMetadata: {
          source: input.source || (input.pdfUrl ? "system_download" : "manual_upload"),
          importedBy: userId(user),
          importedAt,
          checksum: sourceChecksum,
          validationSummary: {
            pageCount: metadata.pageCount,
            fieldCount: scanResult.fieldCount,
            duplicateFields: scanResult.duplicateNames || [],
            duplicateFieldIds: scanResult.duplicateFieldIds || [],
            warnings: scanResult.warnings || [],
            extractionErrors: scanResult.errors || [],
          },
        },
        lifecycle: {
          provider: metadata.provider || "uscis",
          sourcePageUrl: metadata.sourcePageUrl,
          sourcePdfUrl: metadata.sourcePdfUrl,
          sourceChecksum,
          detectionStatus: "imported_draft",
          detectedAt: importedAt,
          importedByScanner: input.source === "scanner" || input.importedByScanner === true,
          changeEvents: [{
            type: "imported",
            at: importedAt,
            by: userId(user),
            fieldCount: scanResult.fieldCount,
          }],
        },
      };
      const creationResult = await this.versioning.createTemplate(templatePayload, user, req);
      let template = creationResult.template;
      const comparisonReport = creationResult.comparisonReport;
      await require("../../questionnaires/question-library.service").syncTemplate(template, user, req).catch(async (error) => {
        await this.audit("QUESTION_LIBRARY_SYNC_FAILED", template, user, req, { message: error.message });
      });
      await require("../../form-mapping/services/MappingGraphService")
        .generate(template._id, { persist: true }, user, req)
        .catch(async (error) => this.audit("MAPPING_GENERATION_FAILED", template, user, req, { message: error.message }));
      template = await USCISFormTemplate.findById(template._id);
      await this.audit("FORM_IMPORTED", template, user, req, {
        formCode: template.formCode,
        version: template.version,
        pageCount: metadata.pageCount,
        fieldCount: scanResult.fieldCount,
      });
      await this.audit("FIELD_EXTRACTION_COMPLETED", template, user, req, {
        fieldCount: scanResult.fieldCount,
        fieldFingerprint: scanResult.fieldFingerprint,
      });
      await this.notifyAdmins("USCIS form imported", `${template.formCode} ${template.version} was imported as a draft.`, {
        templateId: template._id,
        formCode: template.formCode,
        version: template.version,
        fieldCount: scanResult.fieldCount,
      }, user, req);
      return { duplicate: false, template, data: template, scanResult, metadata, comparisonReport };
    } catch (error) {
      await this.audit("FORM_IMPORT_FAILED", null, user, req, {
        formCode: input.formType || input.formCode || input.formNumber,
        pdfUrl: input.pdfUrl,
        message: error.message,
        code: error.code,
        details: error.details,
      });
      throw error;
    }
  }

  async importUpload(file, input = {}, user, req) {
    if (!file?.buffer) throw enterpriseError("PDF upload is required", 400, "PDF_UPLOAD_REQUIRED");
    return this.importFromBuffer(file.buffer, input, user, req);
  }

  async importFromUrl(input = {}, user, req) {
    const pdfUrl = input.pdfUrl || input.url;
    const formDownload = await this.downloadOfficialPdf(pdfUrl, "form");
    let instructionsDownload = null;
    let instructionsError;
    if (input.instructionsPdfUrl) {
      try {
        instructionsDownload = await this.downloadOfficialPdf(input.instructionsPdfUrl, "instructions");
      } catch (error) {
        instructionsError = error.message;
      }
    }
    return this.importFromBuffer(formDownload.buffer, {
      ...input,
      pdfUrl,
      source: input.source || "system_download",
      formDownload,
      instructionsDownload,
      instructionsBuffer: instructionsDownload?.buffer,
      instructionsError,
    }, user, req);
  }

  async list(query = {}) {
    const filter = {};
    if (query.status) filter.status = query.status;
    if (query.provider) filter["lifecycle.provider"] = query.provider;
    if (query.formType || query.formCode) filter.formCode = normalizeFormCode(query.formType || query.formCode);
    const forms = await USCISFormTemplate.find(filter).sort({ formCode: 1, editionDate: -1, updatedAt: -1 }).lean();
    const dashboard = {
      total: forms.length,
      active: forms.filter((item) => item.status === "active").length,
      draft: forms.filter((item) => item.status === "draft").length,
      review: forms.filter((item) => item.status === "review").length,
      retired: forms.filter((item) => item.status === "retired").length,
      archived: forms.filter((item) => item.status === "archived").length,
      fieldCount: forms.reduce((sum, item) => sum + (item.formFields?.length || 0), 0),
    };
    return { forms, dashboard };
  }

  async get(templateId) {
    const template = await USCISFormTemplate.findById(templateId).lean();
    if (!template) throw enterpriseError("USCIS form template not found", 404, "TEMPLATE_NOT_FOUND");
    return template;
  }
}

module.exports = new USCISFormImporterService();

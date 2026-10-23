const AuditLog = require("../../../models/AuditLog");
const CaseForm = require("../../../models/CaseForm");
const { ACTIVE_FORM_FILTER } = require("../../uscis-forms/case-form-selection.service");
const Document = require("../../../models/Document");
const storageService = require("../../uploads/storage.service");
const WatermarkService = require("./WatermarkService");
const FilingArtifactPolicy = require("./FilingArtifactPolicy");
const autonomy = require("../../../config/formPipelineAutonomy");
const logger = require("../../../utils/logger");

class FilingPackageService {
  static userId(user) {
    return user?._id || user?.id || (user && typeof user === "object" && !user._bsontype ? undefined : user);
  }

  static loadPdfLib() {
    try {
      return require("pdf-lib");
    } catch (error) {
      const missing = new Error("pdf-lib dependency is required to assemble filing packages");
      missing.status = 501;
      throw missing;
    }
  }

  static async readItemBuffer(item) {
    // A directly-supplied in-memory buffer (e.g. a rendered-to-PDF cover
    // letter — see CoverLetterService.htmlToPdfBuffer) skips storage
    // entirely; it's not a persisted artifact of its own, just content
    // handed straight to assembly.
    if (item.buffer) return item.buffer;
    if (item.storageKey) return storageService.readBuffer(item.storageKey);
    if (item.documentId) {
      const document = await Document.findById(item.documentId);
      if (!document?.storageKey) throw new Error(`Document ${item.documentId} is not available in storage`);
      return storageService.readBuffer(document.storageKey);
    }
    throw new Error("Package item is missing storage reference");
  }

  /**
   * Phase 7.1 (FORM_PIPELINE_AUTONOMY). A FILING package (no watermark requested) must not embed a generated copy that carries a review / FINAL watermark.
   *   off     -> an empty map: every item is read exactly as before;
   *   shadow  -> logs "would rebuild" / "would refuse" per form, still returns an empty map;
   *   on      -> every form item (one with a caseFormId) is rebuilt as a clean, fidelity-verified copy (PDFRenderer.renderFiling) and returned in the map; a form that
   *              cannot be rebuilt, or any other item that carries a watermark, refuses the whole package (nothing is stored).
   * Review / draft packages (a watermark was asked for) are never touched. `deps` is injectable for tests.
   */
  static async cleanFormBuffers(items, { watermark } = {}, deps = {}) {
    const buffers = new Map();
    const mode = autonomy.mode(deps.env || process.env);
    if (mode === "off" || !FilingArtifactPolicy.isFilingPackage(watermark)) return buffers;
    const log = deps.logger || logger;
    const documentMetadata = deps.documentMetadata || (async (item) => (item.documentId ? (await Document.findById(item.documentId).select("metadata.watermark").lean())?.metadata : null));
    const problems = [];
    for (const item of items) {
      let marked = false;
      try { marked = FilingArtifactPolicy.carriesWatermark(await documentMetadata(item)); } catch (error) { log.warn("filing_package_watermark_check_failed", { error: error.message }); }
      if (!item.caseFormId) {
        // nothing to rebuild it from: a watermarked component cannot go into a filing package
        if (marked) problems.push({ code: "FILING_PACKAGE_WATERMARKED_COMPONENT", message: `"${item.title || item.key || item.documentId}" carries a review watermark and cannot be rebuilt as a clean copy.` });
        continue;
      }
      if (mode === "shadow") {
        if (marked) log.warn("form_filing_artifact_would_rebuild", { event: "filing_package", caseFormId: String(item.caseFormId), title: item.title || item.key });
        continue;
      }
      try {
        const caseForm = await (deps.loadCaseForm || ((id) => require("./PDFGenerationService").loadCaseForm(id, { readOnly: true })))(item.caseFormId);
        const rendered = await (deps.renderer || require("./PDFRenderer")).renderFiling({ caseForm, template: caseForm.formTemplateId.toObject ? caseForm.formTemplateId.toObject() : caseForm.formTemplateId });
        buffers.set(item, rendered.buffer);
      } catch (error) {
        problems.push({ code: error.code || "FILING_PACKAGE_FORM_NOT_VERIFIED", message: `"${item.title || item.key || item.caseFormId}" could not be produced as a clean, verified copy (${error.message}).` });
      }
    }
    if (problems.length) {
      if (mode === "shadow") {
        log.warn("form_filing_artifact_would_refuse", { event: "filing_package", problems: problems.map((problem) => problem.code) });
        return buffers;
      }
      const refusal = new Error(`Filing package refused: ${problems.map((problem) => problem.message).join(" ")}`);
      refusal.status = 409;
      refusal.statusCode = 409;
      refusal.code = "FILING_ARTIFACT_NOT_VALIDATED";
      refusal.problems = problems;
      throw refusal;
    }
    return buffers;
  }

  static async assemble({ caseId, items = [], packageType = "filing_package", metadata = {}, watermark }, user, req) {
    const { PDFDocument, StandardFonts, rgb } = this.loadPdfLib();
    let packageItems = items;
    if (!packageItems.length) {
      const [forms, evidence] = await Promise.all([
        CaseForm.find({ caseId, ...ACTIVE_FORM_FILTER, generatedPdfDocument: { $exists: true, $ne: null } }).populate("generatedPdfDocument").sort({ formCode: 1 }),
        Document.find({
          caseId,
          documentType: { $ne: "uscis_form" },
          reviewStatus: { $in: ["approved", "accepted"] },
          storageKey: { $exists: true, $ne: "" },
          deletedAt: { $exists: false },
        }).sort({ category: 1, createdAt: 1 }),
      ]);
      packageItems = [
        ...forms.filter((form) => form.generatedPdfDocument?.storageKey).map((form) => ({
          caseFormId: form._id,
          documentId: form.generatedPdfDocument._id,
          storageKey: form.generatedPdfDocument.storageKey,
          title: `${form.formCode} · Edition ${form.formVersion}`,
          type: "form",
        })),
        ...evidence.map((document) => ({
          documentId: document._id,
          storageKey: document.storageKey,
          title: document.originalName || document.fileName || document.documentType,
          type: "evidence",
        })),
      ];
    }
    if (!packageItems.length) throw Object.assign(new Error("No generated forms or approved evidence are available for the filing package"), { status: 422 });
    const packagePdf = await PDFDocument.create();
    const font = await packagePdf.embedFont(StandardFonts.Helvetica);
    const tocPage = packagePdf.addPage();
    tocPage.drawText(metadata.title || "USCIS Filing Package", { x: 50, y: 740, size: 18, font, color: rgb(0, 0, 0) });
    packageItems.forEach((item, index) => tocPage.drawText(`${index + 1}. ${item.title || item.name || item.documentId || item.storageKey}`, { x: 60, y: 700 - index * 18, size: 11, font }));

    const cleanBuffers = await this.cleanFormBuffers(packageItems, { watermark });
    for (const item of packageItems) {
      const sourcePdf = await PDFDocument.load(cleanBuffers.get(item) || await this.readItemBuffer(item));
      const pages = await packagePdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
      pages.forEach((page) => packagePdf.addPage(page));
    }

    let buffer = Buffer.from(await packagePdf.save());
    buffer = await WatermarkService.apply(buffer, watermark);
    const originalName = `${packageType}-${caseId}-${Date.now()}.pdf`;
    const key = storageService.generateDocumentKey({ caseId, userId: this.userId(user), originalName });
    const stored = await storageService.storeBuffer(key, buffer);
    const document = await Document.create({
      user: user?._id,
      caseId,
      category: "forms",
      documentType: "uscis_form",
      description: metadata.description || "USCIS filing package",
      folderPath: `/cases/${caseId}/filing-packages`,
      folderName: "Filing Packages",
      tags: ["uscis", "filing-package", packageType],
      originalName,
      originalFileName: originalName,
      storedName: key.split("/").pop(),
      fileName: key.split("/").pop(),
      mimeType: "application/pdf",
      fileType: "application/pdf",
      size: buffer.length,
      fileSize: buffer.length,
      filePath: stored.path,
      documentUrl: stored.url,
      storageProvider: stored.provider,
      storageKey: stored.key,
      checksum: stored.checksum,
      uploadedBy: "system",
      uploadedByUser: this.userId(user),
      metadata: { packageType, includedItems: packageItems, ...metadata },
      versions: [{ version: 1, originalName, storedName: key.split("/").pop(), storageProvider: stored.provider, storageKey: stored.key, filePath: stored.path, documentUrl: stored.url, mimeType: "application/pdf", size: buffer.length, checksum: stored.checksum, uploadedByUser: this.userId(user), uploadedByRole: user?.role }],
      legacySource: "shared",
    });
    await AuditLog.create({ userId: this.userId(user), userRole: user?.role, action: "PACKAGE_GENERATED", entityType: "Document", entityId: String(document._id), changes: { caseId, packageType, itemCount: packageItems.length }, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] }).catch(() => null);
    await CaseForm.updateMany({ caseId, _id: { $in: packageItems.map((item) => item.caseFormId).filter(Boolean) } }, { $push: { filingPackages: { packageDocument: document._id, generatedAt: new Date(), generatedBy: this.userId(user), packageType, includedItems: packageItems, metadata } } });
    await require("../../cases/case-lifecycle-orchestrator.service").recalculate(caseId, user, req, "filing_package_generated").catch(() => null);
    return { document, itemCount: packageItems.length, items: packageItems };
  }

  // Rows-per-TOC-page heuristic for the two-pass reservation below — real
  // petitions run to a handful of forms/certs/letters plus a dozen-ish
  // exhibits, well inside this margin; if a pathological case ever
  // overflows it, entries simply keep drawing past the reserved pages'
  // bottom margin rather than throwing — a cosmetic overflow, not a
  // correctness failure.
  static tocPageCount(entryCount) {
    return Math.max(1, Math.ceil((entryCount + 2) / 32));
  }

  // Hand-builds the /Outlines dictionary tree via pdf-lib's low-level
  // context API (context.nextRef/assign/obj + catalog.set) — pdf-lib has no
  // high-level bookmark API. Validated by direct round-trip testing before
  // use here: saved PDF reloads with /Outlines present, each entry's /Dest
  // resolves to the correct page ref, and Prev/Next sibling links hold.
  static addOutline(packagePdf, entries) {
    if (!entries.length) return;
    const { PDFName, PDFString } = require("pdf-lib");
    const context = packagePdf.context;
    const pages = packagePdf.getPages();
    const itemRefs = entries.map(() => context.nextRef());
    const outlineRootRef = context.nextRef();
    entries.forEach((entry, index) => {
      const dict = context.obj({
        Title: PDFString.of(entry.title),
        Parent: outlineRootRef,
        Dest: [pages[entry.pageIndex].ref, PDFName.of("Fit")],
        ...(index > 0 ? { Prev: itemRefs[index - 1] } : {}),
        ...(index < entries.length - 1 ? { Next: itemRefs[index + 1] } : {}),
      });
      context.assign(itemRefs[index], dict);
    });
    const outlineDict = context.obj({ Type: PDFName.of("Outlines"), First: itemRefs[0], Last: itemRefs[itemRefs.length - 1], Count: entries.length });
    context.assign(outlineRootRef, outlineDict);
    packagePdf.catalog.set(PDFName.of("Outlines"), outlineRootRef);
  }

  // Ordered mailing-PDF assembler: dividers before each exhibit, a real
  // table of contents with page numbers (two-pass — blank pages reserved
  // up front, drawn once final page numbers are known), PDF bookmarks, and
  // continuous Bates-style footer pagination across the whole packet.
  // `sections` is the ordering.mailing-ordered list of non-exhibit content
  // (cover letter, G-28, forms, certifications, front-matter letters);
  // `exhibits` is ExhibitService's output (dividers + their documents).
  // Never silently produces a partial/corrupt packet: an unreadable source
  // PDF throws a structured 422 naming the offending item instead.
  static async assembleOrdered({ caseId, packageType = "petition_filing_pdf", sections = [], exhibits = [], watermark, metadata = {} }, user, req) {
    const { PDFDocument, StandardFonts, rgb } = this.loadPdfLib();
    const tocEntries = [
      ...sections.map((section) => ({ title: section.title, sourceLabel: section.title })),
      ...exhibits.filter((exhibit) => exhibit.dividerBuffer).map((exhibit) => ({ title: `Exhibit ${exhibit.label} — ${exhibit.title}`, sourceLabel: `Exhibit ${exhibit.label}` })),
    ];
    if (!tocEntries.length) throw Object.assign(new Error("No sections or exhibits are available to assemble"), { status: 422 });

    const reservedTocPages = this.tocPageCount(tocEntries.length);
    const packagePdf = await PDFDocument.create();
    const font = await packagePdf.embedFont(StandardFonts.Helvetica);
    const boldFont = await packagePdf.embedFont(StandardFonts.HelveticaBold);
    for (let i = 0; i < reservedTocPages; i += 1) packagePdf.addPage();

    const cleanBuffers = await this.cleanFormBuffers(sections, { watermark });
    const unreadable = [];
    const pageMap = [];
    const outlineEntries = [];

    const appendBuffer = async (buffer, label) => {
      try {
        const sourcePdf = await PDFDocument.load(buffer);
        const pages = await packagePdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
        const firstPageIndex = packagePdf.getPageCount();
        pages.forEach((page) => packagePdf.addPage(page));
        return { firstPageIndex, pageCount: pages.length };
      } catch (error) {
        unreadable.push({ label, message: error.message });
        return null;
      }
    };

    for (const section of sections) {
      const result = await appendBuffer(cleanBuffers.get(section) || await this.readItemBuffer(section), section.title);
      if (!result) continue;
      outlineEntries.push({ title: section.title, pageIndex: result.firstPageIndex });
      pageMap.push({ key: section.key, type: section.type, pageStart: result.firstPageIndex + 1, pageEnd: result.firstPageIndex + result.pageCount });
    }

    for (const exhibit of exhibits) {
      if (!exhibit.dividerBuffer) continue;
      const dividerResult = await appendBuffer(exhibit.dividerBuffer, `Exhibit ${exhibit.label} divider`);
      if (!dividerResult) continue;
      outlineEntries.push({ title: `Exhibit ${exhibit.label} — ${exhibit.title}`, pageIndex: dividerResult.firstPageIndex });
      let exhibitPageStart = dividerResult.firstPageIndex + 1;
      let exhibitPageCount = dividerResult.pageCount;
      for (const document of exhibit.documents) {
        const docResult = await appendBuffer(await this.readItemBuffer({ storageKey: document.storageKey, documentId: document._id }), `${exhibit.title} — ${document.originalName || document._id}`);
        if (docResult) exhibitPageCount += docResult.pageCount;
      }
      pageMap.push({ key: exhibit.key, label: exhibit.label, type: "exhibit", pageStart: exhibitPageStart, pageEnd: exhibitPageStart + exhibitPageCount - 1 });
    }

    if (unreadable.length) {
      throw Object.assign(new Error(`Unable to read ${unreadable.length} source document(s) during assembly`), { status: 422, issues: unreadable.map((item) => ({ severity: "error", code: "SOURCE_PDF_UNREADABLE", message: `Could not read "${item.label}": ${item.message}` })) });
    }

    const totalPages = packagePdf.getPageCount();
    packagePdf.getPages().forEach((page, index) => {
      const { width } = page.getSize();
      const label = `Page ${index + 1} of ${totalPages}`;
      const labelWidth = font.widthOfTextAtSize(label, 9);
      page.drawText(label, { x: width - labelWidth - 40, y: 24, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    });

    // Draw the TOC onto the reserved pages now that real page numbers are
    // known — second pass, same PDFDocument instance (no merge-of-merges).
    let tocPageIndex = 0;
    let y = 740;
    let tocPage = packagePdf.getPage(tocPageIndex);
    tocPage.drawText(metadata.title || "Table of Contents", { x: 50, y, size: 16, font: boldFont, color: rgb(0, 0, 0) });
    y -= 30;
    outlineEntries.forEach((entry, index) => {
      if (y < 60) {
        tocPageIndex += 1;
        if (tocPageIndex >= reservedTocPages) return; // reservation exhausted — see tocPageCount's comment
        tocPage = packagePdf.getPage(tocPageIndex);
        y = 740;
      }
      const pageLabel = String(entry.pageIndex + 1);
      tocPage.drawText(`${index + 1}. ${entry.title}`, { x: 60, y, size: 11, font });
      tocPage.drawText(pageLabel, { x: 500, y, size: 11, font });
      y -= 20;
    });

    this.addOutline(packagePdf, outlineEntries);

    let buffer = Buffer.from(await packagePdf.save());
    buffer = await WatermarkService.apply(buffer, watermark);

    const originalName = `${packageType}-${caseId}-${Date.now()}.pdf`;
    const key = storageService.generateDocumentKey({ caseId, userId: this.userId(user), originalName });
    const stored = await storageService.storeBuffer(key, buffer);
    const document = await Document.create({
      user: user?._id,
      caseId,
      category: "forms",
      documentType: "petition_filing_pdf",
      description: metadata.description || "Assembled petition mailing PDF",
      folderPath: `/cases/${caseId}/petitions`,
      folderName: "Petitions",
      tags: ["petition", "mailing-pdf", packageType],
      originalName,
      originalFileName: originalName,
      storedName: key.split("/").pop(),
      fileName: key.split("/").pop(),
      mimeType: "application/pdf",
      fileType: "application/pdf",
      size: buffer.length,
      fileSize: buffer.length,
      filePath: stored.path,
      documentUrl: stored.url,
      storageProvider: stored.provider,
      storageKey: stored.key,
      checksum: stored.checksum,
      uploadedBy: "system",
      uploadedByUser: this.userId(user),
      metadata: { packageType, totalPages, ...metadata },
      versions: [{ version: 1, originalName, storedName: key.split("/").pop(), storageProvider: stored.provider, storageKey: stored.key, filePath: stored.path, documentUrl: stored.url, mimeType: "application/pdf", size: buffer.length, checksum: stored.checksum, uploadedByUser: this.userId(user), uploadedByRole: user?.role }],
      legacySource: "shared",
    });
    await AuditLog.create({ userId: this.userId(user), userRole: user?.role, action: "PETITION_MAILING_PDF_ASSEMBLED", entityType: "Document", entityId: String(document._id), changes: { caseId, packageType, totalPages, sectionCount: sections.length, exhibitCount: exhibits.length }, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] }).catch(() => null);
    return { document, totalPages, pageMap };
  }
}

module.exports = FilingPackageService;

const Document = require("../../../models/Document");
const storageService = require("../../uploads/storage.service");
const { resolveFilingAddress } = require("../../petition/config/filingAddresses");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

class CoverLetterService {
  static userId(user) {
    return user?._id || user?.id || user;
  }

  // renderTemplate is a single flat pass (dot-path + bracket-index lookup,
  // no loops/conditionals) — array-shaped context values (job duties, the
  // exhibit index) must be pre-flattened into ready-made HTML snippets
  // BEFORE calling it, at predictable dot-paths the template references
  // directly (e.g. {{job.dutiesHtml}}, {{exhibitIndexHtml}}).
  static renderTemplate(template = "", data = {}) {
    return String(template).replace(/\{\{\s*([\w.[\]]+)\s*\}\}/g, (_, path) => {
      const normalizedPath = path.replace(/\[(\d+)\]/g, ".$1");
      const value = normalizedPath.split(".").reduce((current, segment) => (current && current[segment] !== undefined ? current[segment] : ""), data);
      return value === undefined || value === null ? "" : String(value);
    });
  }

  static buildDutiesHtml(duties = []) {
    if (!Array.isArray(duties) || !duties.length) return "";
    return `<ul>${duties.map((duty) => `<li>${escapeHtml(duty)}</li>`).join("")}</ul>`;
  }

  // The auto-generated Exhibit Index table — the single source of truth for
  // exhibit labels/descriptions is ExhibitService's output; this only
  // renders it, never re-derives or hand-types it, so the cover letter's
  // index and the mailing PDF's dividers can never drift apart.
  static buildExhibitIndexHtml(exhibitIndex = []) {
    if (!exhibitIndex.length) return "<p><em>No exhibits attached.</em></p>";
    const rows = exhibitIndex.map((exhibit) => `<tr><td>Exhibit ${escapeHtml(exhibit.label)}</td><td>${escapeHtml(exhibit.description || exhibit.title)}</td></tr>`).join("");
    return `<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;"><thead><tr><th>Exhibit</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  static buildAddressHtml(filingAddressKey, method = "usps") {
    const resolved = resolveFilingAddress(filingAddressKey, method);
    if (!resolved) return "";
    return resolved.formatted.split("\n").map(escapeHtml).join("<br/>");
  }

  // Merges pre-flattened HTML-ready derived fields into the raw context the
  // orchestrator builds (§7), at the exact dot-paths templates reference.
  // Never mutates the caller's context object.
  static withDerivedFields(context, { exhibitIndex = [], filingAddressKey, filingMethod = "usps" } = {}) {
    return {
      ...context,
      job: { ...(context.job || {}), dutiesHtml: this.buildDutiesHtml(context.job?.duties) },
      exhibitIndexHtml: this.buildExhibitIndexHtml(exhibitIndex),
      filing: { ...(context.filing || {}), addressHtml: this.buildAddressHtml(filingAddressKey, filingMethod) },
    };
  }

  // The mailing PDF needs the cover letter / front-matter letters as real
  // PDF pages, not HTML — pdf-lib can't render HTML, and this codebase has
  // no HTML-to-PDF dependency (no puppeteer/wkhtmltopdf/etc). Rather than add
  // one for a single feature, this strips tags to plain text (preserving
  // paragraph/list breaks) and lays it out with pdf-lib's own text/wrapping
  // primitives — real, working pages, just without HTML's rich formatting.
  // The presentation Word draft keeps the full HTML (tables, styling) for
  // whoever edits it; the mailing PDF only needs it to be a legible page.
  static htmlToPlainText(html) {
    return String(html || "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|tr)>/gi, "\n\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<td[^>]*>/gi, "  ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .split("\n")
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  static async htmlToPdfBuffer(html, { title } = {}) {
    const { PDFDocument, StandardFonts, rgb } = (() => {
      try {
        return require("pdf-lib");
      } catch (error) {
        const missing = new Error("pdf-lib dependency is required to render letters into the mailing PDF");
        missing.status = 501;
        throw missing;
      }
    })();
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
    const fontSize = 11;
    const lineHeight = 16;
    const margin = 60;
    let page = pdf.addPage();
    let { width, height } = page.getSize();
    let y = height - margin;
    const maxWidth = width - margin * 2;

    if (title) {
      page.drawText(title, { x: margin, y, size: 16, font: boldFont, color: rgb(0, 0, 0) });
      y -= lineHeight * 2;
    }

    const wrapLine = (line) => {
      if (!line) return [""];
      const words = line.split(" ");
      const wrapped = [];
      let current = "";
      words.forEach((word) => {
        const candidate = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth && current) {
          wrapped.push(current);
          current = word;
        } else {
          current = candidate;
        }
      });
      wrapped.push(current);
      return wrapped;
    };

    const text = this.htmlToPlainText(html);
    for (const rawLine of text.split("\n")) {
      for (const line of wrapLine(rawLine)) {
        if (y < margin) {
          page = pdf.addPage();
          ({ width, height } = page.getSize());
          y = height - margin;
        }
        if (line) page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0.1, 0.1, 0.1) });
        y -= lineHeight;
      }
    }
    return Buffer.from(await pdf.save());
  }

  static findTemplate(definition, { key, kind }) {
    return (definition.templates || []).find((template) => template.key === key && template.kind === kind) || null;
  }

  // Renders the cover letter for a package assembly — always HTML, always
  // carries the auto-built exhibit index (never hand-typed), always
  // attorney work product (draft:true, reviewRequired:true) until a human
  // reviews it. Returns both the persisted HTML Document (the editable
  // artifact, referenced by outputs.coverLetterDocumentId) and a rendered
  // PDF buffer (for the mailing packet only — never persisted separately,
  // just handed straight to FilingPackageService.assembleOrdered).
  static async renderCoverLetter({ caseId, definition, context, exhibitIndex = [], filingMethod = "usps" }, user) {
    const template = this.findTemplate(definition, { key: definition.coverLetterTemplateKey, kind: "cover_letter" });
    if (!template) {
      const error = new Error(`No cover letter template found for key "${definition.coverLetterTemplateKey}"`);
      error.status = 422;
      throw error;
    }
    const mergedContext = this.withDerivedFields(context, { exhibitIndex, filingAddressKey: definition.filingAddressKey, filingMethod });
    const html = this.renderTemplate(template.content, mergedContext);
    const document = await this.persistLetter({ caseId, html, documentType: "cover_letter", title: "Cover Letter", tag: "cover-letter" }, user);
    const pdfBuffer = await this.htmlToPdfBuffer(html, { title: "Cover Letter" });
    return { document, html, pdfBuffer };
  }

  // Front-matter letter drafting (support letter / personal statement) —
  // only ever called for slots without a firm-supplied Document already on
  // file (see PetitionAssemblyService). Always flagged draft/reviewRequired.
  static async renderLetterDraft({ caseId, definition, slot, context }, user) {
    const template = this.findTemplate(definition, { key: slot.templateKey, kind: "letter" });
    if (!template) return null;
    const mergedContext = this.withDerivedFields(context, { filingAddressKey: definition.filingAddressKey });
    const html = this.renderTemplate(template.content, mergedContext);
    const document = await this.persistLetter({ caseId, html, documentType: slot.key, title: slot.label, tag: slot.key }, user);
    const pdfBuffer = await this.htmlToPdfBuffer(html, { title: slot.label });
    return { document, html, pdfBuffer };
  }

  static async persistLetter({ caseId, html, documentType, title, tag }, user) {
    const originalName = `${title}-${caseId}.html`.replace(/[^\w.-]+/g, "-");
    const buffer = Buffer.from(html, "utf8");
    const key = storageService.generateDocumentKey({ caseId, userId: this.userId(user), originalName });
    const stored = await storageService.storeBuffer(key, buffer);
    const version = {
      version: 1,
      originalName,
      storedName: key.split("/").pop(),
      storageProvider: stored.provider,
      storageKey: stored.key,
      filePath: stored.path,
      documentUrl: stored.url,
      mimeType: "text/html",
      fileType: "text/html",
      size: buffer.length,
      checksum: stored.checksum,
      uploadedByUser: this.userId(user),
      uploadedByRole: user?.role,
    };
    return Document.create({
      user: user?._id,
      caseId,
      category: "letters",
      documentType,
      description: `${title} (auto-drafted — attorney review required)`,
      folderPath: `/cases/${caseId}/cover-letters`,
      folderName: "Cover Letters",
      tags: [tag].filter(Boolean),
      originalName,
      originalFileName: originalName,
      storedName: version.storedName,
      fileName: version.storedName,
      mimeType: "text/html",
      fileType: "text/html",
      size: buffer.length,
      fileSize: buffer.length,
      filePath: stored.path,
      documentUrl: stored.url,
      storageProvider: stored.provider,
      storageKey: stored.key,
      checksum: stored.checksum,
      uploadedBy: "system",
      uploadedByUser: this.userId(user),
      metadata: { title, editable: true, generatedBy: "CoverLetterService", draft: true, reviewRequired: true },
      versions: [version],
      legacySource: "shared",
    });
  }

  static async createDraft({ caseId, template, data, title, petitionType }, user) {
    const body = this.renderTemplate(template, data);
    const originalName = `${title || petitionType || "cover-letter"}-${caseId}.txt`.replace(/[^\w.-]+/g, "-");
    const buffer = Buffer.from(body, "utf8");
    const key = storageService.generateDocumentKey({ caseId, userId: this.userId(user), originalName });
    const stored = await storageService.storeBuffer(key, buffer);
    const version = {
      version: 1,
      originalName,
      storedName: key.split("/").pop(),
      storageProvider: stored.provider,
      storageKey: stored.key,
      filePath: stored.path,
      documentUrl: stored.url,
      mimeType: "text/plain",
      fileType: "text/plain",
      size: buffer.length,
      checksum: stored.checksum,
      uploadedByUser: this.userId(user),
      uploadedByRole: user?.role,
    };
    return Document.create({
      user: user?._id,
      caseId,
      category: "letters",
      documentType: "support_letter",
      description: `${petitionType || "Petition"} cover letter draft`,
      folderPath: `/cases/${caseId}/cover-letters`,
      folderName: "Cover Letters",
      tags: ["cover-letter", petitionType].filter(Boolean),
      originalName,
      originalFileName: originalName,
      storedName: version.storedName,
      fileName: version.storedName,
      mimeType: "text/plain",
      fileType: "text/plain",
      size: buffer.length,
      fileSize: buffer.length,
      filePath: stored.path,
      documentUrl: stored.url,
      storageProvider: stored.provider,
      storageKey: stored.key,
      checksum: stored.checksum,
      uploadedBy: "system",
      uploadedByUser: this.userId(user),
      metadata: { petitionType, title, editable: true, generatedBy: "CoverLetterService" },
      versions: [version],
      legacySource: "shared",
    });
  }
}

module.exports = CoverLetterService;

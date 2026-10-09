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
    return user?._id || user?.id || (user && typeof user === "object" && !user._bsontype ? undefined : user);
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

  // Firm letterhead identity for letter PDFs — read live from Settings on
  // every render (not cached) so an admin's letterhead edit takes effect on
  // the very next assemble, with no stale-cache invalidation to manage.
  static async getBranding() {
    const Settings = require("../../../models/Settings");
    const settings = await Settings.findOne({ key: "global" }).lean();
    return {
      name: settings?.companyName || settings?.msoEntityName || "",
      address: settings?.firmAddress || "",
      phone: settings?.firmPhone || "",
      email: settings?.firmEmail || "",
      website: settings?.firmWebsite || "",
      logoUrl: settings?.companyLogo || settings?.brandTokens?.logoUrl || "",
    };
  }

  // Puppeteer's page.pdf() header/footer templates only accept inline
  // content (no external network fetches reliably resolve in that isolated
  // context), so the logo has to be embedded as a data URI up front. Handles
  // the three shapes companyLogo/brandTokens.logoUrl can already hold in
  // this codebase: an http(s) URL, an already-encoded data URI, or a
  // storage-service key (same path client document previews already use).
  // Never throws — a broken/unreachable logo degrades to "no logo" rather
  // than failing the whole render.
  static async resolveLogoDataUri(logoUrl) {
    if (!logoUrl) return "";
    try {
      if (/^data:/i.test(logoUrl)) return logoUrl;
      if (/^https?:\/\//i.test(logoUrl)) {
        const response = await fetch(logoUrl);
        if (!response.ok) return "";
        const buffer = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get("content-type") || "image/png";
        return `data:${contentType};base64,${buffer.toString("base64")}`;
      }
      const buffer = await storageService.readBuffer(logoUrl);
      const ext = (logoUrl.split(".").pop() || "png").toLowerCase();
      return `data:image/${ext === "svg" ? "svg+xml" : ext};base64,${buffer.toString("base64")}`;
    } catch (error) {
      return "";
    }
  }

  // Mirrors the letterhead convention observed across real filed petitions
  // (logo + firm name/address, thin rule, repeated on every page) — see
  // dev-assets/petitions analysis: logo/name/address block above a thin
  // divider rule, and a thin-rule footer with contact info, on every page of
  // every firm-authored document. Rendered via Puppeteer's header/footer
  // template slots (see HtmlPdfRenderer) so it repeats correctly across a
  // multi-page letter — plain CSS has no equivalent for print pagination.
  static buildHeaderFooterTemplates(branding, logoDataUri) {
    const logoImg = logoDataUri ? `<img src="${logoDataUri}" style="height:32px;width:auto;margin-right:10px;" />` : "";
    const contactLine = [branding.website, branding.email, branding.phone].filter(Boolean).join("  ·  ");
    const headerTemplate = branding.name
      ? `<div style="width:100%;font-family:Helvetica,Arial,sans-serif;padding:0 60px;box-sizing:border-box;">
          <div style="display:flex;align-items:center;border-bottom:1px solid #999;padding-bottom:8px;">
            ${logoImg}
            <div>
              <div style="font-size:12px;font-weight:bold;color:#111;">${escapeHtml(branding.name)}</div>
              ${branding.address ? `<div style="font-size:8px;color:#555;">${escapeHtml(branding.address)}</div>` : ""}
            </div>
          </div>
        </div>`
      : "<span></span>";
    const footerTemplate = contactLine
      ? `<div style="width:100%;font-family:Helvetica,Arial,sans-serif;font-size:8px;color:#555;text-align:center;padding:6px 60px 0;box-sizing:border-box;border-top:1px solid #999;">${escapeHtml(contactLine)}</div>`
      : "<span></span>";
    return { headerTemplate, footerTemplate };
  }

  // Real CSS-driven HTML->PDF rendering (via Puppeteer, see HtmlPdfRenderer)
  // — replaces a prior plain-text/pdf-lib fallback that stripped all
  // formatting (bold, color, tables, letterhead) before it ever reached the
  // mailing PDF. The presentation Word draft (PetitionWordPackageService)
  // already preserved full HTML; this brings the filing-ready mailing PDF
  // up to the same fidelity.
  static async htmlToPdfBuffer(html, { title } = {}) {
    const HtmlPdfRenderer = require("./HtmlPdfRenderer");
    const branding = await this.getBranding();
    const logoDataUri = await this.resolveLogoDataUri(branding.logoUrl);
    const { headerTemplate, footerTemplate } = this.buildHeaderFooterTemplates(branding, logoDataUri);
    const documentHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: "Times New Roman", Times, serif; font-size: 12px; line-height: 1.5; color: #111; margin: 0; }
      h1, h2 { font-family: "Times New Roman", Times, serif; }
      h3, h4 { font-family: "Times New Roman", Times, serif; font-weight: bold; text-decoration: underline; margin: 20px 0 10px; }
      table { border-collapse: collapse; width: 100%; }
      td, th { border: 1px solid #333; padding: 6px; font-size: 11px; text-align: left; }
      ul, ol { margin: 0 0 12px 0; padding-left: 22px; }
      p { margin: 0 0 12px 0; }
      img { max-width: 100%; }
    </style>
  </head>
  <body>
    ${title ? `<h2 style="margin-bottom:16px;">${escapeHtml(title)}</h2>` : ""}
    ${html}
  </body>
</html>`;
    // Only reserve header/footer margin space when there's real branding to
    // show in it — an unconfigured firm identity (fresh install, no logo/
    // address/contact info set yet) renders a plain full-margin letter
    // instead of a letter with blank space reserved for nothing.
    const hasHeader = Boolean(branding.name);
    const hasFooter = Boolean(branding.website || branding.email || branding.phone);
    return HtmlPdfRenderer.render(documentHtml, {
      headerTemplate: hasHeader ? headerTemplate : "",
      footerTemplate: hasFooter ? footerTemplate : "",
      margin: {
        top: hasHeader ? "110px" : "60px",
        bottom: hasFooter ? "70px" : "60px",
        left: "60px",
        right: "60px",
      },
    });
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

  static async persistLetter({ caseId: rawCaseId, html, documentType, title, tag }, user) {
    // A caller can hand this a populated Case sub-document instead of a
    // plain id (confirmed live: document.workflow.service.js's
    // documentReviewed() used to pass a populated document.caseId straight
    // through autoSync() -> assemble() -> here) — normalize defensively so a
    // future caller with the same mistake produces a correct filename
    // instead of Node's object-inspect dump of the whole case getting baked
    // into it ("Cover-Letter--_id-new-ObjectId-...-caseNumber-B155-...").
    const caseId = rawCaseId?._id || rawCaseId;
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

  static async createDraft({ caseId: rawCaseId, template, data, title, petitionType }, user) {
    // See persistLetter's matching comment - defends against a caller
    // passing a populated Case sub-document instead of a plain id.
    const caseId = rawCaseId?._id || rawCaseId;
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

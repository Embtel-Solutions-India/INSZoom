const Document = require("../../../models/Document");
const HtmlPdfRenderer = require("../../form-generation/services/HtmlPdfRenderer");
const CoverLetterService = require("../../form-generation/services/CoverLetterService");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The engine's own generated outputs (cover letter, mailing PDF, presentation
// draft) are persisted as approved Documents on the same case — without this
// exclusion, the NEXT assemble() pass would sweep its own prior outputs back
// in as "unclassified approved evidence", growing the exhibit set on every
// re-assembly. Front-matter letters (support_letter, personal_statement,
// etc.) are excluded too — resolveFrontMatterLetters already surfaces those
// from the same Documents; bucketing them here as well would double-count
// the same file into both the front matter AND "Additional Supporting
// Evidence".
const ENGINE_GENERATED_DOCUMENT_TYPES = ["petition_filing_pdf", "petition_word_package", "petition_presentation_package", "cover_letter"];

// Resolves the firm's letterhead once per build() call (not once per
// divider) — same branding CoverLetterService already renders onto letter
// pages, so a divider looks like it belongs to the same assembled packet.
// Real filed petitions we reverse-engineered (see dev-assets/petitions)
// either had no dividers at all or a bare flat-color divider with no
// branding; this exceeds both by carrying the firm's own header/footer.
async function resolveDividerBranding() {
  const branding = await CoverLetterService.getBranding();
  const logoDataUri = await CoverLetterService.resolveLogoDataUri(branding.logoUrl);
  const { headerTemplate, footerTemplate } = CoverLetterService.buildHeaderFooterTemplates(branding, logoDataUri);
  return {
    headerTemplate: branding.name ? headerTemplate : "",
    footerTemplate: branding.website || branding.email || branding.phone ? footerTemplate : "",
  };
}

// One-page "EXHIBIT A — Title" divider, built fresh per exhibit so it can be
// merged into the mailing PDF exactly like any other source PDF. Centered
// large exhibit label + a rule + the exhibit title, matching the two-tier
// centered-title convention observed in real filed petitions' exhibit
// dividers, rendered via the same HTML/Puppeteer pipeline as letters (see
// HtmlPdfRenderer) so fonts/branding stay consistent across the whole packet.
async function buildDividerBuffer(label, title, { headerTemplate = "", footerTemplate = "" } = {}) {
  const documentHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { height: 100%; margin: 0; }
      body { font-family: "Times New Roman", Times, serif; display: flex; align-items: center; justify-content: center; }
      .divider { text-align: center; padding: 0 60px; }
      .divider .label { font-size: 56px; font-weight: bold; letter-spacing: 3px; color: #111; }
      .divider .rule { width: 140px; height: 3px; background: #111; margin: 28px auto; }
      .divider .title { font-size: 20px; color: #333; }
    </style>
  </head>
  <body>
    <div class="divider">
      <div class="label">EXHIBIT ${escapeHtml(label)}</div>
      <div class="rule"></div>
      <div class="title">${escapeHtml(title)}</div>
    </div>
  </body>
</html>`;
  return HtmlPdfRenderer.render(documentHtml, {
    headerTemplate,
    footerTemplate,
    margin: {
      top: headerTemplate ? "110px" : "40px",
      bottom: footerTemplate ? "70px" : "40px",
      left: "40px",
      right: "40px",
    },
  });
}

function exhibitLabelFor(index) {
  // A, B, ... Z, AA, AB, ... — standard spreadsheet-column style, in case a
  // case ever has more than 26 exhibits.
  let n = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

class ExhibitService {
  // Pulls approved evidence + exhibit-placement letters, buckets each into
  // the definition's exhibitTaxonomy (by documentType) in taxonomy order,
  // appends one bucket per exhibit-placement letterSlot (matched by
  // documentType === slot.key), then an "Additional Supporting Evidence"
  // catch-all for anything approved but unclassified (warning, not
  // blocking — surfaced by PetitionValidationService, not decided here).
  // Assigns exhibit labels ONCE in this final order — the single source of
  // truth the cover letter's exhibit index and the mailing PDF's dividers
  // both read from, so labels can never drift apart.
  // excludeDocumentIds: documents already placed in a NON-exhibit mailing
  // section this same assembly run — every required form's generatedPdfDocument
  // and every resolved certification Document. Without this, e.g. the LCA
  // certification (already its own "certification" section) or the I-129
  // form PDF (already its own "form" section) would ALSO get swept in here
  // as "unclassified approved evidence" and appear twice in the packet.
  // order: an array of bucket `key`s in a previously-saved custom order
  // (see PetitionAssemblyService.reorderExhibits) — buckets are re-sorted
  // to match it before labeling; any bucket whose key isn't listed (e.g. a
  // newly-appeared exhibit type since the order was saved) keeps its
  // default relative position, appended after the ordered ones.
  static async build(caseId, definition, { excludeDocumentIds = [], order } = {}) {
    const frontMatterSlotKeys = (definition.letterSlots || []).filter((slot) => slot.placement === "front_matter").map((slot) => slot.key);
    const excludedDocumentTypes = [...ENGINE_GENERATED_DOCUMENT_TYPES, ...frontMatterSlotKeys];
    const excludedIds = new Set(excludeDocumentIds.map(String));
    const approved = (await Document.find({ caseId, reviewStatus: "approved", documentType: { $nin: excludedDocumentTypes }, deletedAt: { $exists: false } }).sort({ category: 1, createdAt: 1 }))
      .filter((doc) => !excludedIds.has(String(doc._id)));

    const exhibitLetterSlots = (definition.letterSlots || []).filter((slot) => slot.placement === "exhibit");
    const claimedIds = new Set();
    const buckets = [];

    for (const entry of [...(definition.exhibitTaxonomy || [])].sort((a, b) => (a.order || 0) - (b.order || 0))) {
      const docs = approved.filter((doc) => !claimedIds.has(String(doc._id)) && (entry.documentTypes || []).includes(doc.documentType));
      docs.forEach((doc) => claimedIds.add(String(doc._id)));
      if (docs.length || entry.required) buckets.push({ key: entry.key, title: entry.label, required: Boolean(entry.required), documents: docs });
    }

    for (const slot of exhibitLetterSlots) {
      const docs = approved.filter((doc) => !claimedIds.has(String(doc._id)) && doc.documentType === slot.key);
      docs.forEach((doc) => claimedIds.add(String(doc._id)));
      if (docs.length || slot.required) buckets.push({ key: slot.key, title: slot.label, required: Boolean(slot.required), documents: docs });
    }

    const unclassified = approved.filter((doc) => !claimedIds.has(String(doc._id)));
    if (unclassified.length) buckets.push({ key: "additional_supporting_evidence", title: "Additional Supporting Evidence", required: false, documents: unclassified, unclassified: true });

    let orderedBuckets = buckets;
    if (Array.isArray(order) && order.length) {
      const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
      const listed = order.map((key) => byKey.get(key)).filter(Boolean);
      const listedKeys = new Set(listed.map((bucket) => bucket.key));
      const unlisted = buckets.filter((bucket) => !listedKeys.has(bucket.key));
      orderedBuckets = [...listed, ...unlisted];
    }

    const dividerBranding = orderedBuckets.some((bucket) => bucket.documents.length) ? await resolveDividerBranding() : null;
    const exhibits = [];
    for (let index = 0; index < orderedBuckets.length; index += 1) {
      const bucket = orderedBuckets[index];
      const label = exhibitLabelFor(index);
      const description = bucket.documents.length
        ? `${bucket.title} (${bucket.documents.length} document${bucket.documents.length === 1 ? "" : "s"})`
        : `${bucket.title} — no approved documents on file`;
      const dividerBuffer = bucket.documents.length ? await buildDividerBuffer(label, bucket.title, dividerBranding) : null;
      exhibits.push({
        key: bucket.key,
        label,
        title: bucket.title,
        description,
        required: bucket.required,
        unclassified: Boolean(bucket.unclassified),
        documentIds: bucket.documents.map((doc) => doc._id),
        documents: bucket.documents,
        dividerBuffer,
      });
    }

    const exhibitIndex = exhibits.map((exhibit) => ({ key: exhibit.key, label: exhibit.label, title: exhibit.title, description: exhibit.description, documentIds: exhibit.documentIds }));
    return { exhibits, exhibitIndex };
  }

  // A user-inserted blank or titled separator page (see
  // PetitionAssemblyService.insertPage/applyManualInsertions) - a blank page
  // is a truly empty page (pdf-lib, no HTML needed); a separator page reuses
  // the same branded letterhead/footer as exhibit dividers, just without the
  // "EXHIBIT X" label, since it isn't anchored to an exhibit bucket.
  static async buildStandalonePage({ type, title }) {
    if (type === "blank_page") {
      const { PDFDocument } = require("pdf-lib");
      const pdf = await PDFDocument.create();
      pdf.addPage();
      return Buffer.from(await pdf.save());
    }
    const branding = await resolveDividerBranding();
    const documentHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { height: 100%; margin: 0; }
      body { font-family: "Times New Roman", Times, serif; display: flex; align-items: center; justify-content: center; }
      .title { font-size: 32px; font-weight: bold; text-align: center; padding: 0 60px; color: #111; }
    </style>
  </head>
  <body>
    <div class="title">${escapeHtml(title || "")}</div>
  </body>
</html>`;
    return HtmlPdfRenderer.render(documentHtml, {
      headerTemplate: branding.headerTemplate,
      footerTemplate: branding.footerTemplate,
      margin: {
        top: branding.headerTemplate ? "110px" : "40px",
        bottom: branding.footerTemplate ? "70px" : "40px",
        left: "40px",
        right: "40px",
      },
    });
  }
}

module.exports = ExhibitService;

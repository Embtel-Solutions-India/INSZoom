const Document = require("../../../models/Document");

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

function loadPdfLib() {
  try {
    return require("pdf-lib");
  } catch (error) {
    const missing = new Error("pdf-lib dependency is required to build exhibit dividers");
    missing.status = 501;
    throw missing;
  }
}

// One-page "Exhibit A — Title" divider, built fresh per exhibit so it can be
// merged into the mailing PDF exactly like any other source PDF.
async function buildDividerBuffer(label, title) {
  const { PDFDocument, StandardFonts, rgb } = loadPdfLib();
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const { width, height } = page.getSize();
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const headline = `Exhibit ${label}`;
  const headlineSize = 28;
  const headlineWidth = boldFont.widthOfTextAtSize(headline, headlineSize);
  page.drawText(headline, { x: (width - headlineWidth) / 2, y: height / 2 + 20, size: headlineSize, font: boldFont, color: rgb(0.05, 0.05, 0.05) });
  const titleSize = 14;
  const titleText = String(title || "");
  const titleWidth = font.widthOfTextAtSize(titleText, titleSize);
  page.drawText(titleText, { x: Math.max(40, (width - titleWidth) / 2), y: height / 2 - 20, size: titleSize, font, color: rgb(0.2, 0.2, 0.2) });
  return Buffer.from(await pdf.save());
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

    const exhibits = [];
    for (let index = 0; index < orderedBuckets.length; index += 1) {
      const bucket = orderedBuckets[index];
      const label = exhibitLabelFor(index);
      const description = bucket.documents.length
        ? `${bucket.title} (${bucket.documents.length} document${bucket.documents.length === 1 ? "" : "s"})`
        : `${bucket.title} — no approved documents on file`;
      const dividerBuffer = bucket.documents.length ? await buildDividerBuffer(label, bucket.title) : null;
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
}

module.exports = ExhibitService;

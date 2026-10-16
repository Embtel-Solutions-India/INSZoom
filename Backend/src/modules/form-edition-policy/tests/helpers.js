// Test doubles for the Release 0b-1 evidence path: an in-memory store (same interface as EditionPolicyStore) and scripted official-source fetchers.
// No database, no network.
const crypto = require("crypto");
const { createEvidenceService } = require("../EvidenceService");

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

function memoryStore({ templates = [] } = {}) {
  const decisions = new Map();
  const snapshots = [];
  const events = [];
  let nextId = 1;
  const store = {
    decisions, snapshots, events,
    async findDecision(formCode, edition) { const row = decisions.get(`${formCode}|${edition}`); return row ? JSON.parse(JSON.stringify(row), revive) : null; },
    async saveDecision(row, expectedVersion) {
      const key = `${row.formCode}|${row.editionIdentifier}`;
      const current = decisions.get(key);
      if (expectedVersion === null || expectedVersion === undefined) {
        if (current) { const error = new Error("exists"); error.status = 409; error.code = "DECISION_VERSION_CONFLICT"; throw error; }
        const saved = { ...row, _id: String(nextId++), version: 1 };
        decisions.set(key, saved);
        return { ...saved };
      }
      if (!current || current.version !== expectedVersion) { const error = new Error("changed"); error.status = 409; error.code = "DECISION_VERSION_CONFLICT"; throw error; }
      const saved = { ...row, _id: current._id, version: expectedVersion + 1 };
      decisions.set(key, saved);
      return { ...saved };
    },
    async listDecisions() { return [...decisions.values()].map((row) => ({ ...row })); },
    async insertSnapshot(snapshot) { const saved = { ...snapshot, _id: `snap${nextId++}` }; snapshots.push(saved); return { ...saved }; },
    async insertEvent(event) {
      if (events.some((item) => item.evidenceCaseId === event.evidenceCaseId && item.seq === event.seq)) throw new Error("duplicate event seq");
      const saved = { ...event, _id: `ev${nextId++}` };
      events.push(saved);
      return { ...saved };
    },
    async listEvents(id) { return events.filter((event) => event.evidenceCaseId === id).sort((a, b) => a.seq - b.seq).map((event) => ({ ...event })); },
    async findSnapshot(id) { const found = snapshots.find((snapshot) => snapshot._id === id); return found ? { ...found } : null; },
    async findTemplates(formCode) { return templates.filter((template) => template.formCode === formCode); },
    async listTemplates() { return templates.map((template) => ({ ...template })); },
  };
  return store;
}
const revive = (key, value) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(value) : value);

// the live-data shape: I-131 edition 2025-01-20, certified, with a stored PDF checksum
const PDF_BYTES = Buffer.from("%PDF-1.7 official form bytes");
const edition = "2025-01-20";
function template(overrides = {}) {
  return {
    _id: "tpl1", formCode: "I-131", version: "2025-01-20", editionDate: new Date(`${edition}T00:00:00Z`), status: "active", mappingStatus: "active",
    officialPdfUrl: "https://www.uscis.gov/sites/default/files/document/forms/i-131.pdf",
    // like the live data: artifacts.form.checksum is the sha256 of the qpdf-NORMALIZED stored copy (never equal to the official download);
    // importMetadata.checksum / lifecycle.sourceChecksum are the sha256 of the RAW download, which is what a re-download must be compared with
    artifacts: { form: { checksum: sha256("the normalized copy the app stores") } },
    importMetadata: { editionDateSource: "uscis_page", checksum: sha256(PDF_BYTES) },
    lifecycle: { sourceChecksum: sha256(PDF_BYTES) },
    ...overrides,
  };
}

const PAGE_TEXT = "Form I-131 alert. USCIS will accept the 01/20/25 edition of Form I-131 for filing. Earlier editions are accepted until further notice.";
const QUOTE = "USCIS will accept the 01/20/25 edition of Form I-131 for filing.";
const pageHtml = (text = PAGE_TEXT) => `<html><head><title>x</title><script>var a=1;</script></head><body><main><h1>Alert</h1><p>${text}</p></main></body></html>`;

const okFetch = (text = PAGE_TEXT, extra = {}) => async (url) => ({
  ok: true, finalUrl: extra.finalUrl || url, status: 200, contentType: "text/html", chain: [{ url, status: 200, location: null }],
  bytes: Buffer.from(pageHtml(text)), violations: [], error: null,
});
const failFetch = (error = "no response within 15000 ms", violations = []) => async () => ({ ok: false, finalUrl: null, status: null, contentType: null, chain: [], bytes: null, violations, error });
const pdfFetch = (bytes = PDF_BYTES) => async (url = "https://www.uscis.gov/sites/default/files/document/forms/form.pdf") => ({ ok: true, finalUrl: url, status: 200, contentType: "application/pdf", chain: [{ url, status: 200, location: null }], bytes, violations: [], error: null });
const noPdf = async () => ({ ok: false, bytes: null, violations: [], error: "down" });

// a clock the tests can move
function clock(start = "2026-10-16T10:00:00.000Z") {
  let current = new Date(start).getTime();
  return { now: () => new Date(current), advance: (ms) => { current += ms; } };
}

const user = (role, id = role) => ({ _id: `user-${id}`, role });
const admin = user("admin");
const lead = user("team_lead");

function build({ templates = [template()], html = okFetch(), pdf = pdfFetch(), time = clock(), auditSink = null, resolvePageUrl, readPrintedEdition, readPdfTextOf } = {}) {
  const store = memoryStore({ templates });
  let counter = 0;
  const service = createEvidenceService({ store, fetchHtml: html, fetchPdf: pdf, now: time.now, newId: () => `case-${++counter}`, auditSink, ...(resolvePageUrl ? { resolvePageUrl } : {}), readPrintedEdition: readPrintedEdition || (async () => null), ...(readPdfTextOf ? { readPdfTextOf } : {}) });
  return { store, service, time };
}

const submission = (overrides = {}) => ({ formCode: "I-131", editionIdentifier: edition, sourceUrl: "https://www.uscis.gov/i-131-alert", quote: QUOTE, ...overrides });
const confirmation = (decision, caseInfo = {}) => ({ confirmed: true, decision, formCode: "I-131", editionIdentifier: edition, ...caseInfo });

module.exports = { memoryStore, template, clock, build, user, admin, lead, submission, confirmation, okFetch, failFetch, pdfFetch, noPdf, pageHtml, sha256, PAGE_TEXT, QUOTE, PDF_BYTES, edition };

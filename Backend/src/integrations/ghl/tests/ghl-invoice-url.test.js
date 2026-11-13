// The case's Invoices popup lists LINKS, kept in step BOTH WAYS with the GoHighLevel card's "Invoice URL": a change on the card is read in; a link added or removed here is written to the card.
// DB-free (stubs).
const test = require("node:test");
const assert = require("node:assert/strict");

const rec = { caseUpdates: [], queued: [], cardUpdates: [] };
const state = { row: null, card: null, rejectMulti: false, clearMatches: [true] };
const stub = (path, exports) => { const resolved = require.resolve(path); require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }; };
const chain = (value) => ({ select: () => chain(value), lean: async () => value, then: (resolve) => resolve(value) });
class GHLApiError extends Error { constructor(message, opts = {}) { super(message); Object.assign(this, opts); } }

stub("../../../models/Case", {
  findById: () => chain(state.row),
  updateOne: async (filter, update) => { rec.caseUpdates.push({ filter, update }); const matched = filter["invoiceLinks.pending"] === undefined ? 1 : (state.clearMatches.length ? (state.clearMatches.shift() ? 1 : 0) : 1); return { modifiedCount: matched, matchedCount: matched }; },
});
stub("../../../modules/cases/case.service", { getAccessibleCaseOrThrow: async () => ({ _id: "c1" }), CASE_OMIT_HISTORY: "" });
stub("../ghlAuxOutbound", { queueJob: async (caseId, type) => { rec.queued.push([caseId, type]); return { _id: "job1" }; } });
stub("../ghlOutboundService", { processJobSoon: () => {} });
stub("../ghlOpportunityService", {
  getOpportunity: async () => state.card,
  updateOpportunity: async (id, body) => {
    const value = body.customFields[0].field_value;
    if (state.rejectMulti && String(value).includes("\n")) throw new GHLApiError("invalid url", { status: 422 });
    rec.cardUpdates.push({ id, value });
    return {};
  },
  fetchAllOpportunities: async () => [],
});
stub("../ghlClient", { getClient: () => ({}), GHLApiError });

const finance = require("../ghlFinance");
const service = require("../../../modules/case-invoices/caseInvoice.service");
const { isUnchanged } = require("../ghlReconcileService");

const CLIENT = { get: async () => ({ customFields: [{ fieldKey: "opportunity.invoice_url", id: "F-URL" }, { fieldKey: "opportunity.uscis_fee", id: "F-FEE" }, { fieldKey: "opportunity.qb_amount_paid", id: "F-PAID" }] }) };
const IDS = { invoice_url: "F-URL", uscis_fee: "F-FEE", qb_amount_paid: "F-PAID" };
const opportunity = (url) => ({ id: "O1", customFields: url === undefined ? [] : [{ id: "F-URL", fieldValueString: url }] });
const lastSet = () => rec.caseUpdates[rec.caseUpdates.length - 1].update.$set;
const links = (urls, extra = {}) => ({ integrations: { ghl: { opportunityId: "O1" } }, invoiceLinks: { urls, ghlValue: "", ...extra } });

test.beforeEach(() => { rec.caseUpdates.length = 0; rec.queued.length = 0; rec.cardUpdates.length = 0; state.row = links([]); state.card = opportunity(undefined); state.rejectMulti = false; state.clearMatches = [true]; finance._resetFieldCache(); });

test("parse / serialize: real http(s) links only, once each; all of them one per line, or only the newest", () => {
  assert.deepEqual(finance.parseInvoiceUrls("https://connect.intuit.com/t/abc?locale=en_US&utm=1,2  junk\nhttp://b.org ftp://c.net https://connect.intuit.com/t/abc?locale=en_US&utm=1,2"), ["https://connect.intuit.com/t/abc?locale=en_US&utm=1,2", "http://b.org"]);
  assert.deepEqual(finance.parseInvoiceUrls("javascript:alert(1)"), []);
  assert.equal(finance.serializeInvoiceUrls(["https://a.com/1", "https://b.com/2"]), "https://a.com/1\nhttps://b.com/2");
  assert.equal(finance.serializeInvoiceUrls([{ url: "https://a.com/1" }, { url: "https://b.com/2" }], true), "https://b.com/2");
  assert.equal(finance.serializeInvoiceUrls([]), "");
});

test("card -> list: a link written in GHL appears (source ghl); unchanged = no write; replaced / removed / cleared on the card follows, including links that were written from here", async () => {
  const link = "https://connect.intuit.com/t/abc";
  assert.equal((await finance.syncInvoiceUrl({ _id: "c1" }, opportunity(link), IDS)).changed, true);
  assert.deepEqual(lastSet()["invoiceLinks.urls"].map((u) => [u.url, u.source]), [[link, "ghl"]]);

  rec.caseUpdates.length = 0;
  state.row = links([{ url: link, source: "ghl" }, { url: "https://mine.example/1", source: "crm" }], { ghlValue: `${link}\nhttps://mine.example/1` });
  assert.equal((await finance.syncInvoiceUrl({ _id: "c1" }, opportunity(`${link}\nhttps://mine.example/1`), IDS)).changed, false, "nothing changed in GHL");
  assert.equal(rec.caseUpdates.length, 0);

  // someone removed my link on the card: it goes here too; the one added here is shown with its original label
  await finance.syncInvoiceUrl({ _id: "c1" }, opportunity(link), IDS);
  assert.deepEqual(lastSet()["invoiceLinks.urls"].map((u) => u.url), [link]);
  // cleared on the card
  state.row = links([{ url: link, source: "ghl" }], { ghlValue: link });
  await finance.syncInvoiceUrl({ _id: "c1" }, opportunity(""), IDS);
  assert.deepEqual(lastSet()["invoiceLinks.urls"], []);
  assert.equal(lastSet()["invoiceLinks.ghlValue"], "");
});

test("a link that was added here but never written to the card (no card yet) is kept when the card's field changes; a local change still on its way is never overwritten", async () => {
  state.row = links([{ url: "https://never.example/1", source: "crm" }], { ghlValue: "" });
  await finance.syncInvoiceUrl({ _id: "c1" }, opportunity("https://card.example/2"), IDS);
  assert.deepEqual(lastSet()["invoiceLinks.urls"].map((u) => [u.url, u.source]), [["https://card.example/2", "ghl"], ["https://never.example/1", "crm"]]);
  rec.caseUpdates.length = 0;
  state.row = links([{ url: "https://mine.example/1", source: "crm" }], { ghlValue: "", pending: "https://mine.example/1" });
  assert.equal((await finance.syncInvoiceUrl({ _id: "c1" }, opportunity("https://older.example"), IDS)).skipped, "push_pending");
  assert.equal(rec.caseUpdates.length, 0);
});

test("list -> card: ALL links are written to the card's Invoice URL, one per line", async () => {
  state.row = links([{ url: "https://a.example/1", source: "ghl" }, { url: "https://b.example/2", source: "crm" }], { ghlValue: "https://a.example/1", pending: "https://a.example/1\nhttps://b.example/2" });
  assert.equal(await finance.runPushInvoiceUrl({ caseId: "c1" }, CLIENT), "done");
  assert.deepEqual(rec.cardUpdates, [{ id: "O1", value: "https://a.example/1\nhttps://b.example/2" }]);
  const done = rec.caseUpdates.at(-1).update;
  assert.equal(done.$set["invoiceLinks.ghlValue"], "https://a.example/1\nhttps://b.example/2");
  assert.ok("invoiceLinks.pending" in done.$unset);
});

test("if GHL refuses several links in the field, the NEWEST is written and remembered (the list here keeps them all); a removal of the last link clears the field", async () => {
  state.rejectMulti = true;
  state.row = links([{ url: "https://a.example/1", source: "ghl" }, { url: "https://b.example/2", source: "crm" }], { ghlValue: "", pending: "https://a.example/1\nhttps://b.example/2" });
  await finance.runPushInvoiceUrl({ caseId: "c1" }, CLIENT);
  assert.deepEqual(rec.cardUpdates, [{ id: "O1", value: "https://b.example/2" }]);
  assert.equal(rec.caseUpdates.at(-1).update.$set["invoiceLinks.single"], true);

  rec.cardUpdates.length = 0;
  state.row = links([], { ghlValue: "https://b.example/2", pending: "" });
  await finance.runPushInvoiceUrl({ caseId: "c1" }, CLIENT);
  assert.deepEqual(rec.cardUpdates, [{ id: "O1", value: "" }], "removing the last link empties the card's field");
});

test("a list edited while a push is running is sent again (the marker is cleared only when nothing changed)", async () => {
  state.row = links([{ url: "https://a.example/1", source: "crm" }], { pending: "https://a.example/1" });
  state.clearMatches = [false, true]; // the first clear finds the list edited again
  await finance.runPushInvoiceUrl({ caseId: "c1" }, CLIENT);
  assert.equal(rec.cardUpdates.length, 2);
});

test("the reconcile fast path notices a changed Invoice URL (and a change still being sent)", () => {
  const existing = { caseRole: "single", clientName: "A", clientEmail: "a@x.com", user: "u", finance: undefined, integrations: { ghl: { opportunityId: "O1", pipelineId: "P", pipelineStageId: "S", unifiedStageKey: "k", opportunityStatus: "open", role: "individual", sync: { state: "synced" }, flags: {} } }, invoiceLinks: { ghlValue: "https://a.example", urls: [] } };
  const base = { id: "O1", name: "A", pipelineId: "P", pipelineStageId: "S", status: "open", monetaryValue: 0, customFields: [{ id: "F-URL", fieldValueString: "https://a.example" }], contact: { email: "a@x.com" } };
  const mapping = { unifiedStageKey: "k" };
  assert.equal(isUnchanged({ existing, opportunity: base, mapping, moneyIds: IDS }), true);
  assert.equal(isUnchanged({ existing, opportunity: { ...base, customFields: [{ id: "F-URL", fieldValueString: "https://b.example" }] }, mapping, moneyIds: IDS }), false);
  assert.equal(isUnchanged({ existing, opportunity: { ...base, customFields: [] }, mapping, moneyIds: IDS }), false, "cleared in GHL");
  assert.equal(isUnchanged({ existing: { ...existing, invoiceLinks: { ...existing.invoiceLinks, pending: "x" } }, opportunity: base, mapping, moneyIds: IDS }), false);
});

test("adding and removing a link here: validated, no duplicates, saved, and the whole list queued for the card; any link can be removed; a case without a card just keeps its list", async () => {
  assert.throws(() => service.cleanUrl("ftp://x.com"), (e) => e.status === 400);
  assert.throws(() => service.cleanUrl("two words"), (e) => e.status === 400);

  state.row = links([{ url: "https://theirs.example", source: "ghl" }], { ghlValue: "https://theirs.example" });
  await service.addUrl("c1", { url: " https://mine.example/1 " }, { _id: "u1" });
  let set = rec.caseUpdates.at(-1).update.$set;
  assert.deepEqual(set["invoiceLinks.urls"].map((u) => [u.url, u.source]), [["https://theirs.example", "ghl"], ["https://mine.example/1", "crm"]]);
  assert.equal(set["invoiceLinks.pending"], "https://theirs.example\nhttps://mine.example/1", "the card keeps the link it had and gains the new one");
  assert.deepEqual(rec.queued[0], ["c1", "push_invoice_url"]);

  state.row = links([{ url: "https://theirs.example", source: "ghl" }, { url: "https://mine.example/1", source: "crm" }], { ghlValue: "https://theirs.example\nhttps://mine.example/1" });
  await assert.rejects(() => service.addUrl("c1", { url: "https://mine.example/1" }, { _id: "u1" }), (e) => e.status === 409);
  await service.removeUrl("c1", "https://theirs.example", { _id: "u1" });
  set = rec.caseUpdates.at(-1).update.$set;
  assert.deepEqual(set["invoiceLinks.urls"].map((u) => u.url), ["https://mine.example/1"], "a link that came from GHL can be removed here too");
  assert.equal(set["invoiceLinks.pending"], "https://mine.example/1");
  await assert.rejects(() => service.removeUrl("c1", "https://nope.example", { _id: "u1" }), (e) => e.status === 404);

  rec.queued.length = 0;
  state.row = { integrations: { ghl: {} }, invoiceLinks: { urls: [], ghlValue: "" } };
  await service.addUrl("c1", { url: "https://nocard.example" }, { _id: "u1" });
  assert.equal(rec.caseUpdates.at(-1).update.$set["invoiceLinks.pending"], undefined);
  assert.equal(rec.queued.length, 0);
});

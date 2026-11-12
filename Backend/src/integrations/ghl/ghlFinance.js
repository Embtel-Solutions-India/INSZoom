// The money of a case, read from its GoHighLevel card (all amounts in US DOLLARS, never cents):
//   Value          (the opportunity's own amount)  -> finance.totalAmount : the company's total fees for the case (USCIS fees NOT included)
//   USCIS Fee      (opportunity custom field)      -> finance.uscisFee    : the USCIS fees (which may also be paid to us)
//   QB Amount Paid (opportunity custom field)      -> finance.amountPaid  : what the client has paid, out of the Value
//   QB Invoice No. (opportunity custom field)      -> finance.invoiceNo
// This is the ONLY source of payment figures for the Admin analytics. It is kept apart from the Payment collection, which the client portal uses, so
// nothing the client sees or pays is affected. Read-only towards GoHighLevel; fail-safe: nothing here ever throws into a sync.
const env = require("../../config/env");
const logger = require("../../utils/logger");
const Case = require("../../models/Case");
const { getClient, GHLApiError } = require("./ghlClient");
const { getOpportunity } = require("./ghlOpportunityService");

const MONEY_FIELD_KEYS = {
  uscis_fee: "opportunity.uscis_fee",
  qb_amount_paid: "opportunity.qb_amount_paid",
  qb_invoice_no: "opportunity.qb_invoice_no",
  invoice_url: "opportunity.invoice_url", // the card's "Invoice URL": read into the case's Invoices popup (see syncInvoiceUrl)
};
const FIELD_CACHE_MS = 6 * 60 * 60 * 1000;
let fieldCache = null; // { ids, at }

// Pure. "$1,200.50", " 1200 ", "1 200", 1200 -> 1201 / 1200 (whole dollars, rounded); anything that is not a plain non-negative amount -> null.
function parseMoney(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? round2(value) : null;
  const text = String(value).trim().replace(/[$,\s]/g, "");
  if (!text || !/^\d+(\.\d+)?$/.test(text)) return null;
  return round2(Number(text));
}
// whole US dollars everywhere: any cents are rounded off
const round2 = (number) => Math.round(number);

function customFieldValue(customFields, id) {
  const entry = (Array.isArray(customFields) ? customFields : []).find((item) => item?.id === id);
  return entry ? entry.fieldValueString ?? entry.fieldValueNumber ?? entry.fieldValue ?? entry.value : undefined;
}

// Pure. The finance figures of an opportunity: { totalAmount, uscisFee, amountPaid, invoiceNo } (numbers in dollars; a blank field is 0).
function financeFromOpportunity(opportunity, fieldIds = {}) {
  const fields = opportunity?.customFields;
  return {
    totalAmount: parseMoney(opportunity?.monetaryValue ?? opportunity?.monetary_value) ?? 0,
    uscisFee: parseMoney(customFieldValue(fields, fieldIds.uscis_fee)) ?? 0,
    amountPaid: parseMoney(customFieldValue(fields, fieldIds.qb_amount_paid)) ?? 0,
    invoiceNo: String(customFieldValue(fields, fieldIds.qb_invoice_no) ?? "").trim(),
  };
}

// Pure. Is there anything to record? (a card with no money on it, on a case with no finance yet, is left alone)
const hasMoney = (finance) => Boolean(finance && (finance.totalAmount || finance.uscisFee || finance.amountPaid || finance.invoiceNo));

async function moneyFieldIds(client = getClient()) {
  if (fieldCache && Date.now() - fieldCache.at < FIELD_CACHE_MS) return fieldCache.ids;
  const data = await client.get(`/locations/${env.ghl.locationId}/customFields`, { model: "opportunity" });
  const byKey = new Map((data?.customFields || []).map((field) => [field.fieldKey, field.id]));
  const ids = {};
  for (const [name, key] of Object.entries(MONEY_FIELD_KEYS)) if (byKey.get(key)) ids[name] = byKey.get(key);
  fieldCache = { ids, at: Date.now() };
  return ids;
}

const sameFinance = (a = {}, b = {}) => ["totalAmount", "uscisFee", "amountPaid"].every((key) => Number(a[key] || 0) === Number(b[key] || 0)) && String(a.invoiceNo || "") === String(b.invoiceNo || "");

// Tells every open Admin screen (live) and clears the dashboard cache. Best effort.
function announce(caseDoc) {
  try {
    require("../../config/redis").dashboardCacheBump().catch(() => {});
    const gateway = require("../../modules/realtime/realtime.gateway");
    const payload = { caseId: String(caseDoc._id), source: "ghl", kind: "finance" };
    for (const role of ["super_admin", "admin", "team_lead", "case_manager"]) gateway.emitToRole(role, "payment:updated", payload);
  } catch (_error) {
    /* live refresh only */
  }
}

const delta = (next, previous) => Math.round(((Number(next) || 0) - (Number(previous) || 0)) * 100) / 100;

// Records the figures on the case when they changed, and one history entry per change (signed dollars). `caseDoc` is a Case document or lean object.
// opts.when = when the payment was made (the card's last update); opts.addedAt = when the fee was first set (the card's creation), used for the first record only.
// Returns { changed }.
// opts.source = "ghl" (read from the card) or "crm" (typed in Immiglance); opts.localEdit = an edit made in Immiglance: the case is marked as waiting to be
// sent to GoHighLevel (opts.push) so GoHighLevel's older figures cannot overwrite it meanwhile; opts.editedBy = who typed it.
async function applyFinance(caseDoc, finance, { when = new Date(), addedAt = null, source = "ghl", localEdit = false, push = false, editedBy = null } = {}) {
  const current = caseDoc.finance || null;
  if (!current && !hasMoney(finance)) return { changed: false };
  if (current && sameFinance(current, finance)) return { changed: false };
  const paidUp = Number(finance.amountPaid || 0) > Number(current?.amountPaid || 0);
  const totalDelta = delta(finance.totalAmount, current?.totalAmount);
  const uscisDelta = delta(finance.uscisFee, current?.uscisFee);
  const paidDelta = delta(finance.amountPaid, current?.amountPaid);
  const now = new Date();
  // the first record dates the fee at the card's creation and the payment at its last update; later changes are dated when they were seen
  const entries = [];
  if (totalDelta || uscisDelta) entries.push({ at: !current && addedAt ? new Date(addedAt) : now, totalDelta, uscisDelta, paidDelta: 0 });
  if (paidDelta) entries.push({ at: !current ? new Date(when) : now, totalDelta: 0, uscisDelta: 0, paidDelta });
  const set = {
    "finance.totalAmount": finance.totalAmount,
    "finance.uscisFee": finance.uscisFee,
    "finance.amountPaid": finance.amountPaid,
    "finance.invoiceNo": finance.invoiceNo,
    "finance.source": source,
    "finance.updatedAt": now,
    ...(localEdit ? { "finance.pendingPush": Boolean(push), "finance.pushError": "", ...(editedBy ? { "finance.editedBy": editedBy } : {}) } : {}),
    ...(paidUp || (!current && finance.amountPaid > 0) ? { "finance.lastPaymentAt": !current ? new Date(when) : now } : {}),
  };
  const update = { $set: set };
  if (entries.length) update.$push = { "finance.history": { $each: entries, $slice: -200 } };
  await Case.updateOne({ _id: caseDoc._id }, update, { timestamps: false });
  announce(caseDoc);
  return { changed: true };
}

// The card as GoHighLevel has it, or the given opportunity when it already carries the figures (search results do; some webhook payloads do not).
async function completeOpportunity(opportunity, client) {
  if (opportunity && opportunity.monetaryValue !== undefined && Array.isArray(opportunity.customFields)) return opportunity;
  if (!opportunity?.id) return opportunity;
  const full = await getOpportunity(opportunity.id, client).catch(() => null);
  return full ? { ...full, ...Object.fromEntries(Object.entries(opportunity || {}).filter(([, v]) => v !== undefined && v !== null && v !== "")) } : opportunity;
}

// ---- the invoice URL -----------------------------------------------------------------------------------------------------------------------------------------------------------------
// GoHighLevel's "Invoice URL" field (one link) is read into the case's invoice links; the team can add more here. See models/Case.js invoiceLinks. Pure parsing, never throws.
/** The text of the card's Invoice URL field ("" when empty). */
const invoiceUrlFromOpportunity = (opportunity, ids = {}) => String(customFieldValue(opportunity?.customFields, ids.invoice_url) ?? "").trim();

/** Pure. Every valid http(s) link in a text (separated by spaces / new lines), without duplicates. Anything else is ignored. */
function parseInvoiceUrls(raw) {
  const seen = new Set();
  const out = [];
  for (const piece of String(raw ?? "").split(/\s+/)) {
    if (!piece) continue;
    try {
      const url = new URL(piece);
      if (!["http:", "https:"].includes(url.protocol) || seen.has(url.href)) continue;
      seen.add(url.href);
      out.push(piece);
    } catch (_error) { /* not a link */ }
  }
  return out;
}

/** Pure. What is written into the card's Invoice URL field for a list of links: all of them, one per line (or only the newest when GHL refused several). "" for an empty list. */
function serializeInvoiceUrls(urls = [], single = false) {
  const list = urls.map((item) => (typeof item === "string" ? item : item.url)).filter(Boolean);
  if (!list.length) return "";
  return single ? list[list.length - 1] : list.join("\n");
}

const sameLinks = (a, b) => a.length === b.length && a.every((url) => b.includes(url));

/**
 * Both directions (2026-11-13), the card's Invoice URL field and the case's list mirror each other:
 *   - the field changed in GoHighLevel -> the list follows (a link removed there is removed here; a link that was never written to the card, for example one added while the card did not exist yet, is kept);
 *   - the list changed here (add / remove) -> `pending` is set and a job writes it to the field (see runPushInvoiceUrl); meanwhile the card's older value never overwrites the local change.
 * Never throws.
 */
async function syncInvoiceUrl(caseDoc, opportunity, ids) {
  try {
    if (!caseDoc?._id || !ids?.invoice_url) return { changed: false };
    const raw = invoiceUrlFromOpportunity(opportunity, ids);
    const row = await Case.findById(caseDoc._id).select("+invoiceLinks").lean();
    const links = row?.invoiceLinks || {};
    if (links.pending !== undefined && links.pending !== null) return { changed: false, skipped: "push_pending" }; // a local change (even "empty the field") is on its way to the card
    if (raw === String(links.ghlValue || "")) return { changed: false };
    const fromCard = parseInvoiceUrls(raw);
    const written = parseInvoiceUrls(links.ghlValue || "");
    const known = new Map((links.urls || []).map((item) => [item.url, item]));
    const neverWritten = (links.urls || []).filter((item) => !fromCard.includes(item.url) && !written.includes(item.url)); // added here, not on the card (yet)
    const urls = [...fromCard.map((url) => known.get(url) || { url, addedAt: new Date(), source: "ghl" }), ...neverWritten];
    await Case.updateOne({ _id: caseDoc._id }, { $set: { "invoiceLinks.urls": urls, "invoiceLinks.ghlValue": raw } }, { timestamps: false });
    return { changed: true };
  } catch (error) {
    logger.warn("ghl_invoice_url_sync_failed", { caseId: String(caseDoc?._id), error: error.message });
    return { changed: false, error: error.message };
  }
}

// For one case and its opportunity: read the figures and record them. Never throws.
async function syncCaseFinance(caseDoc, opportunity, { client } = {}) {
  try {
    if (!caseDoc?._id || !opportunity) return { changed: false };
    // an edit made in Immiglance is still on its way to GoHighLevel: GoHighLevel's older figures must not overwrite it (and nothing is asked of GHL meanwhile)
    if (caseDoc.finance?.pendingPush) return { changed: false, skipped: "push_pending" };
    const full = await completeOpportunity(opportunity, client);
    const ids = await moneyFieldIds(client);
    await syncInvoiceUrl(caseDoc, full, ids); // the card's Invoice URL -> the case's invoice links (own try/catch: never affects the money below)
    const when = full?.lastStatusChangeAt || full?.updatedAt || full?.dateUpdated || new Date();
    return await applyFinance(caseDoc, financeFromOpportunity(full, ids), { when: new Date(when), addedAt: full?.createdAt || full?.dateAdded || null });
  } catch (error) {
    logger.warn("ghl_finance_sync_failed", { caseId: String(caseDoc?._id), error: error.message });
    return { changed: false, error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Immiglance -> GoHighLevel: an edit of a case's payment figures is written to the card (Value, USCIS Fee, QB Amount Paid, QB Invoice No.).
// Runs as an outbound job (retried with back-off like every other change we send). It sends the case's CURRENT figures when it runs, never a stale
// copy, and repeats if the figures were edited again while it was sending.
// ---------------------------------------------------------------------------
const permanentError = (message) => new GHLApiError(message, { status: 0, retryable: false });

async function runPushFinance(job, client) {
  const opportunities = require("./ghlOpportunityService");
  for (let round = 0; round < 3; round += 1) {
    const caseDoc = await Case.findById(job.caseId).select("finance integrations.ghl.opportunityId").lean();
    const opportunityId = caseDoc?.integrations?.ghl?.opportunityId;
    if (!caseDoc?.finance || !opportunityId) {
      await Case.updateOne({ _id: job.caseId }, { $set: { "finance.pendingPush": false } }).catch(() => null);
      return "skipped";
    }
    const ids = await moneyFieldIds(client);
    for (const name of ["uscis_fee", "qb_amount_paid"]) {
      if (!ids[name]) throw permanentError(`The "${name === "uscis_fee" ? "USCIS Fee" : "QB Amount Paid"}" field was not found in GoHighLevel, so the amount could not be sent`);
    }
    const f = caseDoc.finance;
    const money = (value) => String(round2(value));
    const customFields = [
      { id: ids.uscis_fee, field_value: money(f.uscisFee) },
      { id: ids.qb_amount_paid, field_value: money(f.amountPaid) },
      ...(ids.qb_invoice_no ? [{ id: ids.qb_invoice_no, field_value: String(f.invoiceNo || "") }] : []),
    ];
    await opportunities.updateOpportunity(opportunityId, { monetaryValue: round2(f.totalAmount), customFields }, client);
    // clear the marker only if nobody edited meanwhile (updatedAt unchanged); otherwise send again
    const cleared = await Case.updateOne({ _id: job.caseId, "finance.updatedAt": f.updatedAt }, { $set: { "finance.pendingPush": false, "finance.pushedAt": new Date(), "finance.pushError": "" } });
    if (cleared.modifiedCount === 1 || cleared.matchedCount === 1) { announce({ _id: job.caseId }); return "done"; }
  }
  return "done";
}

// The links added or removed in Immiglance are written to the card's Invoice URL field - all of them, one per line. If GHL refuses several links in that field (it is a single-link field), only the
// NEWEST link is written, from then on for this case; the list here keeps them all. Retried like every other GHL write; sends again if the list changed while it was sending.
async function runPushInvoiceUrl(job, client) {
  const opportunities = require("./ghlOpportunityService");
  for (let round = 0; round < 3; round += 1) {
    const row = await Case.findById(job.caseId).select("integrations.ghl.opportunityId +invoiceLinks").lean();
    const opportunityId = row?.integrations?.ghl?.opportunityId;
    const links = row?.invoiceLinks || {};
    if (links.pending === undefined || links.pending === null || !opportunityId) return round === 0 ? "skipped" : "done";
    const ids = await moneyFieldIds(client);
    if (!ids.invoice_url) throw permanentError('The "Invoice URL" field was not found in GoHighLevel, so the link could not be sent');
    let value = links.pending;
    let single = Boolean(links.single);
    const write = (text) => opportunities.updateOpportunity(opportunityId, { customFields: [{ id: ids.invoice_url, field_value: text }] }, client);
    try {
      await write(value);
    } catch (error) {
      const several = parseInvoiceUrls(value).length > 1;
      if (!(several && error instanceof GHLApiError && [400, 422].includes(error.status))) throw error;
      single = true; // GHL accepts one link only
      value = serializeInvoiceUrls(parseInvoiceUrls(value), true);
      await write(value);
    }
    // clear the marker only if the list was not edited meanwhile; otherwise send again
    const cleared = await Case.updateOne({ _id: job.caseId, "invoiceLinks.pending": links.pending }, { $set: { "invoiceLinks.ghlValue": value, ...(single ? { "invoiceLinks.single": true } : {}) }, $unset: { "invoiceLinks.pending": "" } }, { timestamps: false });
    if (cleared.modifiedCount === 1 || cleared.matchedCount === 1) return "done";
  }
  return "done";
}

module.exports = { runPushInvoiceUrl, syncInvoiceUrl, parseInvoiceUrls, serializeInvoiceUrls, invoiceUrlFromOpportunity, runPushFinance, parseMoney, financeFromOpportunity, hasMoney, applyFinance, syncCaseFinance, moneyFieldIds, sameFinance, MONEY_FIELD_KEYS, _resetFieldCache: () => { fieldCache = null; } };

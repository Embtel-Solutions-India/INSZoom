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

// For one case and its opportunity: read the figures and record them. Never throws.
async function syncCaseFinance(caseDoc, opportunity, { client } = {}) {
  try {
    if (!caseDoc?._id || !opportunity) return { changed: false };
    // an edit made in Immiglance is still on its way to GoHighLevel: GoHighLevel's older figures must not overwrite it
    if (caseDoc.finance?.pendingPush) return { changed: false, skipped: "push_pending" };
    const full = await completeOpportunity(opportunity, client);
    const ids = await moneyFieldIds(client);
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

module.exports = { runPushFinance, parseMoney, financeFromOpportunity, hasMoney, applyFinance, syncCaseFinance, moneyFieldIds, sameFinance, MONEY_FIELD_KEYS, _resetFieldCache: () => { fieldCache = null; } };

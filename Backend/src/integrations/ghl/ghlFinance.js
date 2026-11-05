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
const { getClient } = require("./ghlClient");
const { getOpportunity } = require("./ghlOpportunityService");

const MONEY_FIELD_KEYS = {
  uscis_fee: "opportunity.uscis_fee",
  qb_amount_paid: "opportunity.qb_amount_paid",
  qb_invoice_no: "opportunity.qb_invoice_no",
};
const FIELD_CACHE_MS = 6 * 60 * 60 * 1000;
let fieldCache = null; // { ids, at }

// Pure. "$1,200.50", " 1200 ", "1 200", 1200 -> 1200.5 / 1200; anything that is not a plain non-negative amount -> null.
function parseMoney(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? round2(value) : null;
  const text = String(value).trim().replace(/[$,\s]/g, "");
  if (!text || !/^\d+(\.\d+)?$/.test(text)) return null;
  return round2(Number(text));
}
const round2 = (number) => Math.round(number * 100) / 100;

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

// Records the figures on the case when they changed. `caseDoc` is a Case document or lean object. Returns { changed }.
async function applyFinance(caseDoc, finance, { when = new Date() } = {}) {
  const current = caseDoc.finance || null;
  if (!current && !hasMoney(finance)) return { changed: false };
  if (current && sameFinance(current, finance)) return { changed: false };
  const paidUp = Number(finance.amountPaid || 0) > Number(current?.amountPaid || 0);
  const set = {
    "finance.totalAmount": finance.totalAmount,
    "finance.uscisFee": finance.uscisFee,
    "finance.amountPaid": finance.amountPaid,
    "finance.invoiceNo": finance.invoiceNo,
    "finance.source": "ghl",
    "finance.updatedAt": new Date(),
    ...(paidUp || (!current && finance.amountPaid > 0) ? { "finance.lastPaymentAt": when } : {}),
  };
  await Case.updateOne({ _id: caseDoc._id }, { $set: set }, { timestamps: false });
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
    const full = await completeOpportunity(opportunity, client);
    const ids = await moneyFieldIds(client);
    const when = full?.lastStatusChangeAt || full?.updatedAt || full?.dateUpdated || new Date();
    return await applyFinance(caseDoc, financeFromOpportunity(full, ids), { when: new Date(when) });
  } catch (error) {
    logger.warn("ghl_finance_sync_failed", { caseId: String(caseDoc?._id), error: error.message });
    return { changed: false, error: error.message };
  }
}

module.exports = { parseMoney, financeFromOpportunity, hasMoney, applyFinance, syncCaseFinance, moneyFieldIds, sameFinance, MONEY_FIELD_KEYS, _resetFieldCache: () => { fieldCache = null; } };

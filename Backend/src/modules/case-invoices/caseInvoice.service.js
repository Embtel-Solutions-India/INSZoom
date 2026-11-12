// Case invoices: internal-only invoice LINKS of a case (no files). Access = the same case access as everywhere else, for internal staff roles only.
const caseService = require("../cases/case.service");

const STAFF_ROLES = ["super_admin", "admin", "team_lead", "case_manager"];
const httpError = (message, status) => Object.assign(new Error(message), { status, statusCode: status });

async function accessibleCase(caseId, user) {
  const caseData = await caseService.getAccessibleCaseOrThrow(caseId, user, { omit: caseService.CASE_OMIT_HISTORY });
  return caseData;
}

// An employer matter's payments: every employee case's figures plus the accumulated totals (US dollars). Staff only. A case manager assigned to only some of the
// employees sees only those, exactly as the case page itself does.
async function employeePayments(caseId, user) {
  const Case = require("../../models/Case");
  const { scopedChildIdsFor } = require("../cases/caseManagerAccess");
  const { employeeContact } = require("../cases/employee-identity");
  const principal = await accessibleCase(caseId, user);
  let children = await Case.find({ parentCase: principal._id, status: { $ne: "removed" } })
    .select("caseNumber clientName clientEmail employeeIdentity pendingEmployee caseRole childIndex finance status assignedCaseManager additionalCaseManagers")
    .sort({ childIndex: 1, createdAt: 1 })
    .lean();
  const scoped = await scopedChildIdsFor(principal, user).catch(() => null);
  if (scoped) {
    const allowed = new Set(scoped.map(String));
    children = children.filter((child) => allowed.has(String(child._id)));
  }
  const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
  const employees = children.map((child) => {
    const finance = child.finance || {};
    const total = money(finance.totalAmount);
    const paid = money(finance.amountPaid);
    return {
      _id: child._id,
      caseNumber: child.caseNumber,
      name: employeeContact({ ...child, caseRole: "employee" })?.name || child.clientName || "",
      email: employeeContact({ ...child, caseRole: "employee" })?.email || "",
      totalAmount: total,
      uscisFee: money(finance.uscisFee),
      amountPaid: paid,
      outstanding: money(Math.max(total - paid, 0)),
    };
  });
  const sum = (key) => money(employees.reduce((acc, row) => acc + row[key], 0));
  return { employees, totals: { totalAmount: sum("totalAmount"), uscisFee: sum("uscisFee"), amountPaid: sum("amountPaid"), outstanding: sum("outstanding") } };
}

// ---- invoice URLs (2026-11-13) ---------------------------------------------------------------------------------------------------------------------------------------------------------
// The Invoices popup no longer uploads or lists files: it lists LINKS - the "Invoice URL" of the case's GoHighLevel card (read in by the sync) and any the team adds here. Links open in the
// browser's own tab; nothing is stored or proxied. Earlier uploaded invoice files are kept untouched (just no longer shown). Stored in Case.invoiceLinks (internal only).
const MAX_URLS = 50;
const MAX_URL_LENGTH = 2000;

/** Pure. The link as typed, trimmed, when it is a single valid http(s) address; otherwise throws a 400 with a plain message. */
function cleanUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) throw httpError("Enter the invoice URL", 400);
  if (/\s/.test(text)) throw httpError("An invoice URL cannot contain spaces. Add one link at a time.", 400);
  if (text.length > MAX_URL_LENGTH) throw httpError("That link is too long.", 400);
  let parsed;
  try {
    parsed = new URL(text);
  } catch (_error) {
    throw httpError("Enter a valid link starting with http:// or https://", 400);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw httpError("Enter a valid link starting with http:// or https://", 400);
  return text;
}

const presentUrl = (item) => ({ url: item.url, source: item.source || "crm", addedAt: item.addedAt || null });

async function loadLinks(caseId) {
  const Case = require("../../models/Case");
  return Case.findById(caseId).select("integrations.ghl.opportunityId +invoiceLinks").lean();
}

async function listUrls(caseId, user) {
  const caseData = await accessibleCase(caseId, user);
  const row = await loadLinks(caseData._id);
  const links = row?.invoiceLinks || {};
  return { urls: (links.urls || []).map(presentUrl), pending: Boolean(links.pending) };
}

// A change to the list is written to the GoHighLevel card's Invoice URL field (all links, one per line; see ghlFinance.runPushInvoiceUrl): `pending` carries the text to write.
async function saveList(caseData, row, urls, links) {
  const Case = require("../../models/Case");
  const hasCard = Boolean(row?.integrations?.ghl?.opportunityId);
  const desired = require("../../integrations/ghl/ghlFinance").serializeInvoiceUrls(urls, Boolean(links.single));
  const update = { $set: { "invoiceLinks.urls": urls } };
  if (hasCard) update.$set["invoiceLinks.pending"] = desired;
  await Case.updateOne({ _id: caseData._id }, update, { timestamps: false });
  if (hasCard) {
    try {
      const job = await require("../../integrations/ghl/ghlAuxOutbound").queueJob(caseData._id, "push_invoice_url");
      if (job) require("../../integrations/ghl/ghlOutboundService").processJobSoon(job._id);
    } catch (_error) { /* the list is saved here; the job runs on the next sweep */ }
  }
}

async function addUrl(caseId, body, user) {
  const caseData = await accessibleCase(caseId, user);
  const url = cleanUrl(body?.url);
  const row = await loadLinks(caseData._id);
  const links = row?.invoiceLinks || {};
  const current = links.urls || [];
  if (current.length >= MAX_URLS) throw httpError(`A case can have up to ${MAX_URLS} invoice URLs.`, 400);
  const same = (a, b) => { try { return new URL(a).href === new URL(b).href; } catch (_error) { return a === b; } };
  if (current.some((item) => same(item.url, url))) throw httpError("This invoice URL is already in the list.", 409);
  await saveList(caseData, row, [...current, { url, addedAt: new Date(), addedBy: user._id, source: "crm" }], links);
  return listUrls(caseId, user);
}

async function removeUrl(caseId, url, user) {
  const caseData = await accessibleCase(caseId, user);
  const row = await loadLinks(caseData._id);
  const links = row?.invoiceLinks || {};
  const current = links.urls || [];
  if (!current.some((item) => item.url === url)) throw httpError("That invoice URL is not in the list.", 404);
  await saveList(caseData, row, current.filter((item) => item.url !== url), links);
  return listUrls(caseId, user);
}

module.exports = { STAFF_ROLES, employeePayments, listUrls, addUrl, removeUrl, cleanUrl };

// Payment analytics for the ADMIN portal, read live from each case's finance figures (US DOLLARS, never cents), which come from the case's GoHighLevel
// card (integrations/ghl/ghlFinance.js):
//   totalAmount = the card's Value (the company's own fees, USCIS fees NOT included)
//   uscisFee    = the USCIS fees (may also be paid to the company)
//   amountPaid  = QB Amount Paid, out of totalAmount
//   outstanding = totalAmount - amountPaid (never below 0)
// Cases are counted per person (an employer matter is only a container: its employee cards hold the money), like every other dashboard count.
// Nothing here reads the Payment collection: that belongs to the client portal and is not used for analytics.
const Case = require("../../models/Case");
const { COUNTABLE_CASE } = require("../cases/countableCase");

const HAS_FINANCE = { "finance.source": "ghl" };
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const owed = { $max: [{ $subtract: [{ $ifNull: ["$finance.totalAmount", 0] }, { $ifNull: ["$finance.amountPaid", 0] }] }, 0] };
const monthOf = { $ifNull: ["$finance.lastPaymentAt", "$createdAt"] };

// The cases with figures that an analytics request asks for (date range on the case's creation, like the other dashboard counts; an extra filter may be merged in).
function financeMatch(range = {}, extra = {}) {
  return { $and: [{ ...range }, HAS_FINANCE, COUNTABLE_CASE, extra] };
}

async function totals(match) {
  const [row] = await Case.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: { $ifNull: ["$finance.totalAmount", 0] } }, uscisFees: { $sum: { $ifNull: ["$finance.uscisFee", 0] } }, revenue: { $sum: { $ifNull: ["$finance.amountPaid", 0] } }, outstanding: { $sum: owed }, count: { $sum: 1 } } },
  ]);
  return { total: round2(row?.total), uscisFees: round2(row?.uscisFees), revenue: round2(row?.revenue), outstanding: round2(row?.outstanding), refunded: 0, count: row?.count || 0 };
}

const groupBy = (field, match) => Case.aggregate([
  { $match: match },
  { $group: { _id: { $ifNull: [field, "Unspecified"] }, revenue: { $sum: { $ifNull: ["$finance.amountPaid", 0] } }, total: { $sum: { $ifNull: ["$finance.totalAmount", 0] } }, uscisFees: { $sum: { $ifNull: ["$finance.uscisFee", 0] } }, outstanding: { $sum: owed }, count: { $sum: 1 } } },
  { $sort: { revenue: -1, total: -1 } },
]).then((rows) => rows.map((row) => ({ ...row, revenue: round2(row.revenue), total: round2(row.total), uscisFees: round2(row.uscisFees), outstanding: round2(row.outstanding) })));

async function monthlyRevenue(match) {
  const rows = await Case.aggregate([
    { $match: match },
    { $group: { _id: { year: { $year: monthOf }, month: { $month: monthOf } }, count: { $sum: 1 }, value: { $sum: { $ifNull: ["$finance.amountPaid", 0] } } } },
    { $sort: { "_id.year": 1, "_id.month": 1 } },
  ]);
  return rows.map((row) => ({ month: `${row._id.year}-${String(row._id.month).padStart(2, "0")}`, count: row.count, value: round2(row.value) }));
}

// paid = nothing left to pay; partially_paid = something paid, something left; pending = a fee is due and nothing is paid; (no fee = not counted)
async function byStatus(match) {
  const rows = await Case.aggregate([
    { $match: { $and: [match, { "finance.totalAmount": { $gt: 0 } }] } },
    { $group: { _id: { $switch: { branches: [{ case: { $gte: [{ $ifNull: ["$finance.amountPaid", 0] }, "$finance.totalAmount"] }, then: "paid" }, { case: { $gt: [{ $ifNull: ["$finance.amountPaid", 0] }, 0] }, then: "partially_paid" }], default: "pending" } }, count: { $sum: 1 }, value: { $sum: owed } } },
    { $sort: { count: -1 } },
  ]);
  return rows.map((row) => ({ key: row._id, count: row.count, value: round2(row.value) }));
}

// The same shape the dashboard / analytics pages have always read (revenueAnalytics), now in dollars and from GoHighLevel.
async function revenueAnalytics(range = {}, extra = {}) {
  const match = financeMatch(range, extra);
  const [summary, byPackage, byVisaType, monthly, statuses] = await Promise.all([
    totals(match),
    groupBy("$package", match),
    groupBy("$visaType", match),
    monthlyRevenue(match),
    byStatus(match),
  ]);
  return { totals: summary, byPackage, byVisaType, monthlyRevenue: monthly, byStatus: statuses };
}

// One row per case, for the Payments Overview table.
async function listCases({ range = {}, search = "", status = "", page = 1, limit = 25, extra = {} } = {}) {
  const and = [financeMatch(range, extra)];
  const term = String(search || "").trim();
  if (term) {
    const rx = { $regex: term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    and.push({ $or: [{ clientName: rx }, { clientEmail: rx }, { caseNumber: rx }, { "finance.invoiceNo": rx }, { visaType: rx }] });
  }
  const filter = { $and: and };
  if (status === "paid") and.push({ $expr: { $gte: ["$finance.amountPaid", "$finance.totalAmount"] }, "finance.totalAmount": { $gt: 0 } });
  else if (status === "partially_paid") and.push({ "finance.amountPaid": { $gt: 0 }, $expr: { $lt: ["$finance.amountPaid", "$finance.totalAmount"] } });
  else if (status === "pending") and.push({ "finance.totalAmount": { $gt: 0 }, "finance.amountPaid": { $not: { $gt: 0 } } });
  const size = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * size;
  const [rows, count] = await Promise.all([
    Case.find(filter).sort({ "finance.updatedAt": -1 }).skip(skip).limit(size)
      .select("caseNumber clientName clientEmail visaType petitionSubType caseRole pendingEmployee employeeIdentity finance createdAt").lean(),
    Case.countDocuments(filter),
  ]);
  const items = rows.map((row) => {
    const f = row.finance || {};
    const total = Number(f.totalAmount) || 0;
    const paid = Number(f.amountPaid) || 0;
    const pendingPerson = row.caseRole === "employee" ? row.pendingEmployee || row.employeeIdentity || {} : {};
    return {
      _id: row._id,
      caseNumber: row.caseNumber,
      clientName: (row.caseRole === "employee" ? pendingPerson.name : "") || row.clientName || pendingPerson.name || "",
      clientEmail: (row.caseRole === "employee" ? pendingPerson.email : "") || row.clientEmail || pendingPerson.email || "",
      visaType: row.visaType,
      petitionSubType: row.petitionSubType,
      totalAmount: round2(total),
      uscisFee: round2(f.uscisFee),
      amountPaid: round2(paid),
      outstanding: round2(Math.max(total - paid, 0)),
      invoiceNo: f.invoiceNo || "",
      status: total > 0 && paid >= total ? "paid" : paid > 0 ? "partially_paid" : total > 0 ? "pending" : "no_fee",
      lastPaymentAt: f.lastPaymentAt || null,
      updatedAt: f.updatedAt || null,
    };
  });
  return { items, pagination: { page: Math.max(parseInt(page, 10) || 1, 1), limit: size, total: count, pages: Math.ceil(count / size) || 1 } };
}

// A single case's figures (for the case's Payments tab).
async function forCase(caseId) {
  const row = await Case.findById(caseId).select("finance").lean();
  const f = row?.finance;
  if (!f || f.source !== "ghl") return null;
  const total = Number(f.totalAmount) || 0;
  const paid = Number(f.amountPaid) || 0;
  return { totalAmount: round2(total), uscisFee: round2(f.uscisFee), amountPaid: round2(paid), outstanding: round2(Math.max(total - paid, 0)), invoiceNo: f.invoiceNo || "", lastPaymentAt: f.lastPaymentAt || null, updatedAt: f.updatedAt || null, status: total > 0 && paid >= total ? "paid" : paid > 0 ? "partially_paid" : total > 0 ? "pending" : "no_fee" };
}

module.exports = { financeMatch, totals, revenueAnalytics, listCases, forCase, byStatus, monthlyRevenue, HAS_FINANCE, round2 };

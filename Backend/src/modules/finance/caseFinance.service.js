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

const FINANCE_SOURCES = ["ghl", "crm"]; // read from the GoHighLevel card, or typed in Immiglance (a case with no card)
const HAS_FINANCE = { "finance.source": { $in: FINANCE_SOURCES } };
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
  if (!f || !FINANCE_SOURCES.includes(f.source)) return null;
  const total = Number(f.totalAmount) || 0;
  const paid = Number(f.amountPaid) || 0;
  return { totalAmount: round2(total), uscisFee: round2(f.uscisFee), amountPaid: round2(paid), outstanding: round2(Math.max(total - paid, 0)), invoiceNo: f.invoiceNo || "", lastPaymentAt: f.lastPaymentAt || null, updatedAt: f.updatedAt || null, status: total > 0 && paid >= total ? "paid" : paid > 0 ? "partially_paid" : total > 0 ? "pending" : "no_fee" };
}

// ---------------------------------------------------------------------------
// Paid vs total over time (day / week / month), and this period against the previous one on the same date. Dates are India Standard Time.
// Built from finance.history (every change of a case's figures as signed dollars): "total" = fees set, "paid" = payments made.
// ---------------------------------------------------------------------------
const IST_MS = 330 * 60 * 1000;
const TZ = "Asia/Kolkata";
const istParts = (date) => { const x = new Date(date.getTime() + IST_MS); return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), dow: x.getUTCDay() }; };
const fromIst = (y, m, d) => new Date(Date.UTC(y, m, d) - IST_MS); // the real instant of 00:00 IST on that date (month/day overflow rolls over)
const pad = (n) => String(n).padStart(2, "0");
const dayKey = (date) => { const p = istParts(date); return `${p.y}-${pad(p.m + 1)}-${pad(p.d)}`; };
const monthKey = (date) => { const p = istParts(date); return `${p.y}-${pad(p.m + 1)}`; };
// ISO week key ("2026-W45"), the same text MongoDB's %G-W%V gives
function isoWeekKey(date) {
  const p = istParts(date);
  const day = new Date(Date.UTC(p.y, p.m, p.d));
  const weekday = (day.getUTCDay() + 6) % 7; // Monday = 0
  day.setUTCDate(day.getUTCDate() - weekday + 3); // the Thursday of this week
  const firstThursday = new Date(Date.UTC(day.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((day - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${day.getUTCFullYear()}-W${pad(week)}`;
}
const startOfWeek = (date) => { const p = istParts(date); return fromIst(p.y, p.m, p.d - ((p.dow + 6) % 7)); };
const FORMATS = { day: "%Y-%m-%d", week: "%G-W%V", month: "%Y-%m" };

async function sumWindow(match, from, to) {
  const [row] = await Case.aggregate([
    { $match: match },
    { $unwind: "$finance.history" },
    { $match: { "finance.history.at": { $gte: from, $lt: to } } },
    { $group: { _id: null, paid: { $sum: "$finance.history.paidDelta" }, total: { $sum: "$finance.history.totalDelta" }, uscis: { $sum: "$finance.history.uscisDelta" } } },
  ]);
  return { paid: round2(row?.paid), total: round2(row?.total), uscisFees: round2(row?.uscis) };
}

const changePct = (now, before) => (before ? Math.round(((now - before) / Math.abs(before)) * 100) : null);

async function trend({ granularity = "day", now = new Date(), range = {} } = {}) {
  const gran = ["day", "week", "month"].includes(granularity) ? granularity : "day";
  const match = financeMatch(range);
  const here = istParts(now);
  const thisMonth = fromIst(here.y, here.m, 1);
  const prevMonth = fromIst(here.y, here.m - 1, 1);
  const thisWeek = startOfWeek(now);
  const prevWeek = new Date(thisWeek.getTime() - 7 * 86400000);

  // the buckets to show, oldest first
  const buckets = [];
  if (gran === "day") {
    for (let day = 1; day <= here.d; day += 1) buckets.push({ key: dayKey(fromIst(here.y, here.m, day)), label: String(day), dayOfMonth: day });
  } else if (gran === "week") {
    for (let i = 11; i >= 0; i -= 1) { const start = new Date(thisWeek.getTime() - i * 7 * 86400000); const p = istParts(start); buckets.push({ key: isoWeekKey(start), label: `${pad(p.d)}/${pad(p.m + 1)}` }); }
  } else {
    for (let i = 11; i >= 0; i -= 1) { const start = fromIst(here.y, here.m - i, 1); const p = istParts(start); buckets.push({ key: monthKey(start), label: new Date(Date.UTC(p.y, p.m, 1)).toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }) }); }
  }
  const from = gran === "day" ? prevMonth : gran === "week" ? new Date(thisWeek.getTime() - 11 * 7 * 86400000) : fromIst(here.y, here.m - 11, 1);

  const rows = await Case.aggregate([
    { $match: match },
    { $unwind: "$finance.history" },
    { $match: { "finance.history.at": { $gte: from, $lte: now } } },
    { $group: { _id: { $dateToString: { format: FORMATS[gran], date: "$finance.history.at", timezone: TZ } }, paid: { $sum: "$finance.history.paidDelta" }, total: { $sum: "$finance.history.totalDelta" } } },
  ]);
  const byKey = new Map(rows.map((row) => [row._id, row]));
  // day view: the previous month's same dates, for the comparison line
  const prevByDay = new Map();
  if (gran === "day") {
    const prevRows = await Case.aggregate([
      { $match: match },
      { $unwind: "$finance.history" },
      { $match: { "finance.history.at": { $gte: prevMonth, $lt: thisMonth } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$finance.history.at", timezone: TZ } }, paid: { $sum: "$finance.history.paidDelta" }, total: { $sum: "$finance.history.totalDelta" } } },
    ]);
    prevRows.forEach((row) => prevByDay.set(row._id, row));
  }
  let cumulativePaid = 0;
  let cumulativeTotal = 0;
  let previousCumulativePaid = 0;
  let previousCumulativeTotal = 0;
  const points = buckets.map((bucket) => {
    const row = byKey.get(bucket.key);
    const paid = round2(row?.paid);
    const total = round2(row?.total);
    cumulativePaid = round2(cumulativePaid + paid);
    cumulativeTotal = round2(cumulativeTotal + total);
    const point = { key: bucket.key, label: bucket.label, paid, total, paidCumulative: cumulativePaid, totalCumulative: cumulativeTotal };
    if (gran === "day") {
      const prev = prevByDay.get(dayKey(fromIst(here.y, here.m - 1, bucket.dayOfMonth)));
      const previousInMonth = new Date(fromIst(here.y, here.m - 1, bucket.dayOfMonth)) < thisMonth; // a 31st that the previous month does not have
      previousCumulativePaid = round2(previousCumulativePaid + (previousInMonth ? Number(prev?.paid) || 0 : 0));
      previousCumulativeTotal = round2(previousCumulativeTotal + (previousInMonth ? Number(prev?.total) || 0 : 0));
      point.previousPaid = previousInMonth ? round2(prev?.paid) : null;
      point.previousTotal = previousInMonth ? round2(prev?.total) : null;
      point.previousPaidCumulative = previousCumulativePaid;
      point.previousTotalCumulative = previousCumulativeTotal;
    }
    return point;
  });

  // this period so far against the previous period up to the same point in it (month to date vs last month's same dates; this week vs last week)
  const weekly = gran === "week";
  const currentStart = weekly ? thisWeek : thisMonth;
  const previousStart = weekly ? prevWeek : prevMonth;
  const elapsed = now.getTime() - currentStart.getTime();
  const previousEnd = new Date(Math.min(previousStart.getTime() + elapsed, (weekly ? thisWeek : thisMonth).getTime()));
  const [current, previous] = await Promise.all([sumWindow(match, currentStart, new Date(now.getTime() + 1)), sumWindow(match, previousStart, previousEnd)]);
  return {
    granularity: gran,
    timezone: TZ,
    points,
    comparison: {
      periodLabel: weekly ? "This week so far" : "This month so far",
      previousLabel: weekly ? "Last week, same days" : "Last month, same dates",
      current, previous,
      paidChangePercent: changePct(current.paid, previous.paid),
      totalChangePercent: changePct(current.total, previous.total),
    },
  };
}

// ---------------------------------------------------------------------------
// Breakdowns for the Payments Overview graphs (US dollars): by case type, the cases with the most still to pay, and by case manager.
// "Case manager" = the one assigned to the case (assignedCaseManager), so the amounts add up to the totals; cases with none are "Unassigned".
// ---------------------------------------------------------------------------
async function breakdown(range = {}) {
  const User = require("../../models/User");
  const { resolveDisplayVisa } = require("../../utils/visaDisplay");
  const match = financeMatch(range);
  const [byVisa, topRows, managerRows, statusRows] = await Promise.all([
    groupBy("$visaType", match),
    Case.aggregate([
      { $match: match },
      { $addFields: { owed: owed } },
      { $match: { owed: { $gt: 0 } } },
      { $sort: { owed: -1 } },
      { $limit: 10 },
      { $project: { caseNumber: 1, clientName: 1, petitionerName: 1, parentCase: 1, visaType: 1, petitionSubType: 1, caseRole: 1, pendingEmployee: 1, employeeIdentity: 1, owed: 1, total: "$finance.totalAmount", paid: "$finance.amountPaid" } },
    ]),
    Case.aggregate([
      { $match: match },
      { $group: { _id: "$assignedCaseManager", cases: { $sum: 1 }, total: { $sum: { $ifNull: ["$finance.totalAmount", 0] } }, uscisFees: { $sum: { $ifNull: ["$finance.uscisFee", 0] } }, paid: { $sum: { $ifNull: ["$finance.amountPaid", 0] } }, outstanding: { $sum: owed } } },
      { $sort: { total: -1 } },
    ]),
    byStatus(match),
  ]);
  // the petitioner: the company / person who files for the case (an employee's case: the employer matter's name; a family case: the petitioner; otherwise the client)
  const parentIds = [...new Set(topRows.map((row) => row.parentCase && String(row.parentCase)).filter(Boolean))];
  const parents = parentIds.length ? await Case.find({ _id: { $in: parentIds } }).select("clientName petitionerName").lean() : [];
  const parentById = new Map(parents.map((parent) => [String(parent._id), parent]));
  const petitionerOf = (row) => {
    const parent = row.parentCase ? parentById.get(String(row.parentCase)) : null;
    return row.petitionerName || parent?.petitionerName || parent?.clientName || name(row);
  };
  const ids = managerRows.map((row) => row._id).filter(Boolean);
  const users = ids.length ? await User.find({ _id: { $in: ids } }).select("name displayName email").lean() : [];
  const names = new Map(users.map((user) => [String(user._id), user.displayName || user.name || user.email || "Case manager"]));
  const name = (row) => {
    const own = row.caseRole === "employee" ? row.pendingEmployee || row.employeeIdentity || {} : {};
    return (row.caseRole === "employee" ? own.name : "") || row.clientName || own.name || row.caseNumber;
  };
  return {
    byVisaType: byVisa.map((row) => ({ visaType: row._id === "Unspecified" ? "Unspecified" : resolveDisplayVisa({ visaType: row._id }) || row._id, paid: row.revenue, total: row.total, uscisFees: row.uscisFees, outstanding: row.outstanding, cases: row.count })),
    topOutstandingCases: topRows.map((row) => ({ _id: row._id, caseNumber: row.caseNumber, name: name(row), petitioner: petitionerOf(row), visaType: resolveDisplayVisa({ visaType: row.visaType, petitionSubType: row.petitionSubType }) || row.visaType, outstanding: round2(row.owed), total: round2(row.total), paid: round2(row.paid) })),
    byCaseManager: managerRows.map((row) => ({
      caseManagerId: row._id ? String(row._id) : null,
      name: row._id ? names.get(String(row._id)) || "Case manager" : "Unassigned",
      cases: row.cases, total: round2(row.total), paid: round2(row.paid), outstanding: round2(row.outstanding), uscisFees: round2(row.uscisFees),
      averageCaseValue: row.cases ? round2(row.total / row.cases) : 0,
    })),
    byStatus: statusRows,
  };
}

// ---------------------------------------------------------------------------
// Editing a case's payment figures from Immiglance (two-way with GoHighLevel). The edit is saved at once and counted by every analytics screen; if the
// case has a GoHighLevel card it is then sent there through the outbound queue (retried), and GoHighLevel's older figures cannot overwrite it meanwhile.
// ---------------------------------------------------------------------------
const MAX_AMOUNT = 100000000;
function badRequest(message, code = "INVALID_AMOUNT") { return Object.assign(new Error(message), { status: 400, code }); }

function readAmount(value, label) {
  if (value === undefined) return undefined;
  const parsed = require("../../integrations/ghl/ghlFinance").parseMoney(value === null || value === "" ? 0 : value);
  if (parsed === null) throw badRequest(`${label} must be an amount in US dollars, like 1200 or 1200.50`);
  if (parsed > MAX_AMOUNT) throw badRequest(`${label} is too large`);
  return parsed;
}

async function editCaseFinance(caseId, input = {}, user) {
  const ghlFinance = require("../../integrations/ghl/ghlFinance");
  const env = require("../../config/env");
  const caseDoc = await Case.findById(caseId).select("caseNumber caseRole caseStructure finance integrations.ghl.opportunityId").lean();
  if (!caseDoc) throw Object.assign(new Error("Case not found"), { status: 404 });
  if (caseDoc.caseRole === "principal" && caseDoc.caseStructure === "employer_employee") throw badRequest("This is an employer matter: edit the payment figures on each employee's case", "EMPLOYER_MATTER");
  const current = caseDoc.finance || {};
  const next = {
    totalAmount: readAmount(input.totalAmount, "Total fees") ?? (Number(current.totalAmount) || 0),
    uscisFee: readAmount(input.uscisFee, "USCIS fee") ?? (Number(current.uscisFee) || 0),
    amountPaid: readAmount(input.amountPaid, "Amount paid") ?? (Number(current.amountPaid) || 0),
    invoiceNo: input.invoiceNo === undefined ? String(current.invoiceNo || "") : String(input.invoiceNo || "").trim().slice(0, 60),
  };
  const hasCard = Boolean(caseDoc.integrations?.ghl?.opportunityId);
  const pushToGhl = hasCard && Boolean(env.ghl.enabled && env.ghl.token);
  const result = await ghlFinance.applyFinance(caseDoc, next, { source: current.source || (hasCard ? "ghl" : "crm"), localEdit: true, push: pushToGhl, editedBy: user?._id });
  let queued = false;
  if (result.changed && pushToGhl) {
    try {
      const aux = require("../../integrations/ghl/ghlAuxOutbound");
      const job = await aux.queueJob(caseDoc._id, "push_finance");
      if (job) require("../../integrations/ghl/ghlOutboundService").processJobSoon(job._id);
      queued = true; // a job already waiting sends the latest figures when it runs
    } catch (error) {
      require("../../utils/logger").warn("finance_push_queue_failed", { caseId: String(caseDoc._id), error: error.message });
    }
  }
  return { changed: result.changed, before: { totalAmount: current.totalAmount || 0, uscisFee: current.uscisFee || 0, amountPaid: current.amountPaid || 0, invoiceNo: current.invoiceNo || "" }, after: next, ghl: { hasCard, queued }, caseNumber: caseDoc.caseNumber };
}

module.exports = { editCaseFinance, FINANCE_SOURCES, breakdown, trend, isoWeekKey, startOfWeek, financeMatch, totals, revenueAnalytics, listCases, forCase, byStatus, monthlyRevenue, HAS_FINANCE, round2 };

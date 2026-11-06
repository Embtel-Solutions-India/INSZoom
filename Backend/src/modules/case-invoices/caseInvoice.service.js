// Case invoices: internal-only files attached to a case (see models/CaseInvoice.js). Access = the same case access as everywhere else, for internal staff roles only.
const crypto = require("crypto");
const path = require("path");
const CaseInvoice = require("../../models/CaseInvoice");
const caseService = require("../cases/case.service");
const storageService = require("../uploads/storage.service");

const STAFF_ROLES = ["super_admin", "admin", "team_lead", "case_manager"];
const httpError = (message, status) => Object.assign(new Error(message), { status, statusCode: status });

async function accessibleCase(caseId, user) {
  const caseData = await caseService.getAccessibleCaseOrThrow(caseId, user, { omit: caseService.CASE_OMIT_HISTORY });
  return caseData;
}

const present = (invoice) => ({
  _id: invoice._id,
  fileName: invoice.fileName,
  mimeType: invoice.mimeType,
  size: invoice.size,
  note: invoice.note || "",
  createdAt: invoice.createdAt,
  uploadedBy: invoice.uploadedBy ? { _id: invoice.uploadedBy._id, name: invoice.uploadedBy.name || invoice.uploadedBy.displayName || invoice.uploadedBy.email } : null,
});

async function list(caseId, user) {
  const caseData = await accessibleCase(caseId, user);
  const rows = await CaseInvoice.find({ caseId: caseData._id }).populate("uploadedBy", "name displayName email").sort({ createdAt: -1 }).lean();
  return rows.map(present);
}

async function add(caseId, file, body, user) {
  if (!file?.buffer?.length) throw httpError("Choose an invoice file to upload", 400);
  const caseData = await accessibleCase(caseId, user);
  const originalName = String(file.originalname || "invoice").slice(0, 200);
  const key = `invoices/${caseData._id}/${crypto.randomUUID()}${path.extname(originalName).toLowerCase()}`;
  const stored = await storageService.storeBuffer(key, file.buffer, file.mimetype);
  try {
    const invoice = await CaseInvoice.create({
      caseId: caseData._id,
      fileName: originalName,
      mimeType: file.mimetype || "application/octet-stream",
      size: file.size || file.buffer.length,
      storageKey: stored.key,
      note: String(body?.note || "").trim().slice(0, 300),
      uploadedBy: user._id,
    });
    return present(await CaseInvoice.findById(invoice._id).populate("uploadedBy", "name displayName email").lean());
  } catch (error) {
    await storageService.deleteObject(stored.key).catch(() => false); // the record failed: do not leave an orphan file
    throw error;
  }
}

async function read(caseId, invoiceId, user) {
  const caseData = await accessibleCase(caseId, user);
  const invoice = /^[a-f0-9]{24}$/i.test(String(invoiceId)) ? await CaseInvoice.findOne({ _id: invoiceId, caseId: caseData._id }).lean() : null;
  if (!invoice) throw httpError("Invoice not found", 404);
  return { invoice, buffer: await storageService.readBuffer(invoice.storageKey) };
}

// Deletes the invoice for good: the record first (so it can never be listed again), then its file.
async function remove(caseId, invoiceId, user) {
  const caseData = await accessibleCase(caseId, user);
  const invoice = /^[a-f0-9]{24}$/i.test(String(invoiceId)) ? await CaseInvoice.findOneAndDelete({ _id: invoiceId, caseId: caseData._id }).lean() : null;
  if (!invoice) throw httpError("Invoice not found", 404);
  await storageService.deleteObject(invoice.storageKey).catch(() => false);
  return { _id: invoice._id };
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

module.exports = { STAFF_ROLES, list, add, read, remove, employeePayments };

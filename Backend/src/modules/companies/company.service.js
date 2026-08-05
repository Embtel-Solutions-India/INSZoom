const AuditLog = require("../../models/AuditLog");
const Appointment = require("../../models/Appointment");
const Beneficiary = require("../../models/Beneficiary");
const Case = require("../../models/Case");
const Client = require("../../models/Client");
const Company = require("../../models/Company");
const Document = require("../../models/Document");
const Message = require("../../models/Message");
const Notification = require("../../models/Notification");
const Payment = require("../../models/Payment");
const User = require("../../models/User");
const Workflow = require("../../models/Workflow");
const { normalizeRole } = require("../authorization/roleHierarchy");

const ADMIN_ROLES = ["super_admin", "admin"];
const STAFF_ROLES = ["super_admin", "admin", "hr", "finance", "team_lead", "case_manager", "attorney", "paralegal", "reviewer"];

function sameId(left, right) {
  return left && right && left.toString() === right.toString();
}

function roleOf(user) {
  return normalizeRole(user?.role);
}

function canAccessCompany(user, company) {
  if (!user || !company) return false;
  const role = roleOf(user);
  if (ADMIN_ROLES.includes(role) || ["hr", "finance"].includes(role)) return true;
  if (role === "employer" && sameId(user.companyId, company._id)) return true;
  if (role === "team_lead" && sameId(user.companyId, company._id)) return true;
  return STAFF_ROLES.includes(role);
}

function canModifyCompany(user, company) {
  if (!user || !company) return false;
  const role = roleOf(user);
  if (ADMIN_ROLES.includes(role) || role === "hr") return true;
  if (role === "employer" && sameId(user.companyId, company._id)) return true;
  return false;
}

function cleanPayload(payload = {}) {
  return Object.entries(payload).reduce((picked, [key, value]) => {
    if (value !== undefined) picked[key] = value;
    return picked;
  }, {});
}

function mapCompanyPayload(payload = {}) {
  const address = payload.address || {};
  const contact = payload.contact || {};
  return cleanPayload({
    name: payload.name || payload.companyName,
    legalName: payload.legalName,
    dbaName: payload.dbaName,
    ein: payload.ein,
    registrationNumber: payload.registrationNumber,
    industry: payload.industry,
    website: payload.website || contact.website,
    description: payload.description,
    status: payload.status,
    isActive: payload.isActive,
    address: payload.address || (payload.street || payload.city ? {
      street: payload.street,
      city: payload.city,
      state: payload.state,
      zip: payload.zip || payload.zipCode,
      country: payload.country || "USA",
      isPrimary: true,
    } : undefined),
    addresses: payload.addresses,
    officeLocations: payload.officeLocations,
    branchOffices: payload.branchOffices,
    contact: {
      phone: payload.phone || contact.phone,
      email: payload.email || contact.email,
      website: payload.website || contact.website,
    },
    contacts: payload.contacts,
    hrManager: payload.hrManager,
    hrUsers: payload.hrUsers,
    employees: payload.employees,
    beneficiaries: payload.beneficiaries,
    immigrationPrograms: payload.immigrationPrograms,
    settings: payload.settings,
    billing: payload.billing,
    source: payload.source,
  });
}

function addTimeline(company, type, title, description, user, metadata = {}) {
  company.timeline.push({ type, title, description, metadata, createdBy: user?._id });
  company.activityHistory.push({ type, title, description, metadata, createdBy: user?._id });
}

async function writeAuditLog(action, company, user, changes, req) {
  await AuditLog.create({
    userId: user?._id,
    action,
    entityType: "company",
    entityId: company?._id?.toString(),
    changes,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
    description: `${action} company ${company?.name || company?._id}`,
  }).catch(() => {});
}

function buildCompanyFilter(query = {}, user) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.isActive !== undefined) filter.isActive = query.isActive === "true" || query.isActive === true;
  if (query.hrManager) filter.hrManager = query.hrManager;
  if (query.industry) filter.industry = query.industry;
  if (query.search) {
    const search = { $regex: query.search, $options: "i" };
    filter.$or = [{ name: search }, { legalName: search }, { ein: search }, { "contact.email": search }];
  }
  if (roleOf(user) === "employer") filter._id = user.companyId;
  return filter;
}

function pagination(query = {}) {
  const page = Math.max(Number(query.page || 1), 1);
  const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
  return { page, limit, skip: (page - 1) * limit };
}

async function populateCompanyQuery(query) {
  return query.populate([
    { path: "hrManager", select: "name displayName email role department" },
    { path: "hrUsers", select: "name displayName email role department" },
    { path: "employees", select: "name displayName email role department" },
    { path: "beneficiaries", select: "fullName email visaType status" },
  ]);
}

async function listCompanies(query, user) {
  const filter = buildCompanyFilter(query, user);
  const { page, limit, skip } = pagination(query);
  const sortBy = ["name", "createdAt", "updatedAt", "status"].includes(query.sortBy) ? query.sortBy : "updatedAt";
  const sort = { [sortBy]: query.sortOrder === "asc" ? 1 : -1 };
  const [companies, total] = await Promise.all([
    populateCompanyQuery(Company.find(filter).sort(sort).skip(skip).limit(limit)),
    Company.countDocuments(filter),
  ]);
  return { companies, count: companies.length, total, pagination: { page, limit, pages: Math.ceil(total / limit) || 1 } };
}

async function getCompanyOrThrow(id, user) {
  const company = await populateCompanyQuery(Company.findById(id));
  if (!company) {
    const error = new Error("Company not found");
    error.status = 404;
    throw error;
  }
  if (!canAccessCompany(user, company)) {
    const error = new Error("You do not have permission to access this company");
    error.status = 403;
    throw error;
  }
  return company;
}

async function createCompany(payload, user, req) {
  const mapped = mapCompanyPayload({ ...payload, source: payload.source || "shared" });
  const company = await Company.create(mapped);
  addTimeline(company, "company_created", "Company Created", "Company profile created", user);
  company.auditHistory.push({ action: "create", changes: mapped, performedBy: user?._id, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] });
  await company.save();
  await syncCompanyUsers(company);
  await writeAuditLog("create", company, user, mapped, req);
  return populateCompanyQuery(Company.findById(company._id));
}

async function updateCompany(id, payload, user, req) {
  const company = await getCompanyOrThrow(id, user);
  if (!canModifyCompany(user, company)) {
    const error = new Error("Not authorized to update this company");
    error.status = 403;
    throw error;
  }
  const mapped = mapCompanyPayload(payload);
  Object.assign(company, mapped);
  addTimeline(company, "company_updated", "Company Updated", "Company profile updated", user);
  company.auditHistory.push({ action: "update", changes: mapped, performedBy: user?._id, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] });
  await company.save();
  await syncCompanyUsers(company);
  await writeAuditLog("update", company, user, mapped, req);
  return populateCompanyQuery(Company.findById(company._id));
}

async function archiveCompany(id, user, req) {
  const company = await updateCompany(id, { status: "archived", isActive: false }, user, req);
  await writeAuditLog("archive", company, user, {}, req);
  return company;
}

async function syncCompanyUsers(company) {
  const userIds = [...(company.hrUsers || []), ...(company.employees || []), company.hrManager].filter(Boolean);
  if (userIds.length) await User.updateMany({ _id: { $in: userIds } }, { companyId: company._id });
  await Beneficiary.updateMany({ _id: { $in: company.beneficiaries || [] } }, { companyId: company._id });
  await Client.updateMany({ beneficiary: { $in: company.beneficiaries || [] } }, { companyId: company._id });
}

async function addNote(id, payload, user, req) {
  const company = await getCompanyOrThrow(id, user);
  if (!canModifyCompany(user, company)) {
    const error = new Error("Not authorized to update this company");
    error.status = 403;
    throw error;
  }
  company.notes.push({ note: payload.note, isInternal: payload.isInternal !== false, author: user._id });
  addTimeline(company, "note", "Company Note Added", payload.note, user);
  await company.save();
  await writeAuditLog("add_note", company, user, { note: payload.note }, req);
  return company;
}

async function updateStatus(id, status, user, req) {
  return updateCompany(id, { status, isActive: !["inactive", "archived"].includes(status) }, user, req);
}

async function getRelated(id, user) {
  const company = await getCompanyOrThrow(id, user);
  const companyId = company._id;
  const [users, clients, beneficiaries, cases, documents, appointments, payments, notifications, workflows] = await Promise.all([
    User.find({ companyId }).select("-password").sort({ name: 1 }),
    Client.find({ companyId }).sort({ updatedAt: -1 }).limit(100),
    Beneficiary.find({ companyId }).sort({ updatedAt: -1 }).limit(100),
    Case.find({ companyId }).sort({ updatedAt: -1 }).limit(100),
    Document.find({ companyId }).sort({ updatedAt: -1 }).limit(100),
    Appointment.find({ companyId }).sort({ startAt: -1 }).limit(100),
    Payment.find({ companyId }).sort({ updatedAt: -1 }).limit(100),
    Notification.find({ companyId }).sort({ createdAt: -1 }).limit(100),
    Workflow.find({ "context.companyId": companyId }).sort({ updatedAt: -1 }).limit(100),
  ]);
  const caseIds = cases.map((caseData) => caseData._id);
  const messages = caseIds.length ? await Message.find({ caseId: { $in: caseIds } }).sort({ createdAt: -1 }).limit(100) : [];
  return { company, users, employees: users, hrUsers: users.filter((item) => ["hr", "employer"].includes(roleOf(item))), clients, beneficiaries, cases, documents, appointments, payments, notifications, workflows, messages };
}

async function getDashboard(id, user) {
  const related = await getRelated(id, user);
  const openCases = related.cases.filter((caseData) => !["closed", "archived", "approved", "denied"].includes(caseData.status));
  const paid = related.payments.reduce((sum, payment) => sum + (payment.amountPaid || payment.paidAmount || 0), 0);
  const outstanding = related.payments.reduce((sum, payment) => sum + (payment.remainingAmount || 0), 0);
  return {
    company: related.company,
    stats: {
      users: related.users.length,
      employees: related.employees.length,
      beneficiaries: related.beneficiaries.length,
      cases: related.cases.length,
      openCases: openCases.length,
      documents: related.documents.length,
      appointments: related.appointments.length,
      payments: related.payments.length,
      paidAmount: paid,
      outstandingAmount: outstanding,
      unreadNotifications: related.notifications.filter((item) => !item.read && !item.isRead).length,
    },
    recentActivity: [...related.company.activityHistory, ...related.notifications.map((notification) => ({
      type: "notification",
      title: notification.title,
      description: notification.message,
      createdAt: notification.createdAt,
    }))].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 25),
    companyCasesList: openCases.slice(0, 10),
  };
}

module.exports = {
  addNote,
  archiveCompany,
  canAccessCompany,
  canModifyCompany,
  createCompany,
  getCompanyOrThrow,
  getDashboard,
  getRelated,
  listCompanies,
  updateCompany,
  updateStatus,
};

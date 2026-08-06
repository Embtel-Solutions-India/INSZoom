const User = require("../../models/User");
const Client = require("../../models/Client");
const Case = require("../../models/Case");
const Company = require("../../models/Company");
const Document = require("../../models/Document");
const Task = require("../../models/Task");
const Message = require("../../models/Message");
const Conversation = require("../../models/Conversation");
const Answer = require("../../models/Answer");
const StaffPerformance = require("../../models/StaffPerformance");
const ReportExecution = require("../../models/ReportExecution");
const EODReport = require("../../models/EODReport");

const DEMO_FILTER = { isDemoData: true };

// Mongo rejects `$or: []`, and an all-empty clause set is a no-op anyway, so
// build the usable clauses first and return null to mean "skip this delete"
// rather than accidentally matching (or deleting) everything.
function orFilter(clauses) {
  const usable = clauses
    .filter(([, ids]) => Array.isArray(ids) && ids.length)
    .map(([field, ids]) => ({ [field]: { $in: ids } }));
  return usable.length ? { $or: usable } : null;
}

async function deleteWhere(Model, filter) {
  if (!filter) return 0;
  const result = await Model.deleteMany(filter);
  return result?.deletedCount || 0;
}

async function purgeDemoData() {
  const [userIds, clientIds, caseIds, companyIds] = await Promise.all([
    User.distinct("_id", DEMO_FILTER),
    Client.distinct("_id", DEMO_FILTER),
    Case.distinct("_id", DEMO_FILTER),
    Company.distinct("_id", DEMO_FILTER),
  ]);

  // Conversations first (their ids are needed to scope Message deletion),
  // then messages, then the conversations themselves.
  const conversationFilter = orFilter([
    ["caseId", caseIds],
    ["clientId", userIds],
    ["companyId", companyIds],
    ["participants.user", userIds],
  ]);
  const conversationIds = conversationFilter ? await Conversation.distinct("_id", conversationFilter) : [];

  const messages = await deleteWhere(
    Message,
    orFilter([
      ["conversationId", conversationIds],
      ["threadId", conversationIds],
      ["caseId", caseIds],
      ["senderId", userIds],
      ["receiverId", userIds],
    ])
  );
  const conversations = await deleteWhere(Conversation, conversationFilter);

  // Document/Task/Answer are matched by ownership and case/client/company
  // linkage only — deliberately NOT by staff-assignment fields (Document has
  // none besides the string-enum `uploadedBy`; Task.assignedTo/assignedBy and
  // Answer.assignedTo/assignedBy are excluded on purpose) so that a seeded
  // staff account working a real case never causes that real case's records
  // to be swept up in a purge.
  const documents = await deleteWhere(
    Document,
    orFilter([
      ["caseId", caseIds],
      ["user", userIds],
      ["client", clientIds],
      ["companyId", companyIds],
    ])
  );

  const tasks = await deleteWhere(
    Task,
    orFilter([
      ["caseId", caseIds],
      ["clientId", userIds],
      ["companyId", companyIds],
    ])
  );

  // Never match on `questionnaire`/`question` — those point at protected
  // library templates, not demo data.
  const answers = await deleteWhere(
    Answer,
    orFilter([
      ["caseId", caseIds],
      ["user", userIds],
      ["clientId", userIds],
      ["client", clientIds],
      ["companyId", companyIds],
    ])
  );

  // These analytics collections only key off User, so they must match on
  // demo user ids directly.
  const staffPerformance = await deleteWhere(StaffPerformance, orFilter([["staff", userIds]]));
  const reportExecutions = await deleteWhere(ReportExecution, orFilter([["generatedBy", userIds]]));
  const eodReports = await deleteWhere(EODReport, orFilter([["staff", userIds], ["reviewedBy", userIds]]));

  const cases = (await Case.deleteMany(DEMO_FILTER)).deletedCount || 0;
  const clients = (await Client.deleteMany(DEMO_FILTER)).deletedCount || 0;
  const companies = (await Company.deleteMany(DEMO_FILTER)).deletedCount || 0;
  const users = (await User.deleteMany(DEMO_FILTER)).deletedCount || 0;

  // Don't auto-mutate real data left dangling by a deleted demo record (e.g.
  // a demo client who created a real case) — just report it so an operator
  // can investigate.
  const [orphanedCases, orphanedCompanies] = await Promise.all([
    userIds.length ? Case.countDocuments({ user: { $in: userIds }, isDemoData: { $ne: true } }) : 0,
    userIds.length ? User.countDocuments({ companyId: { $in: companyIds }, isDemoData: { $ne: true } }) : 0,
  ]);

  return {
    deleted: {
      messages,
      conversations,
      documents,
      tasks,
      answers,
      staffPerformance,
      reportExecutions,
      eodReports,
      cases,
      clients,
      companies,
      users,
    },
    orphanedReferences: {
      casesReferencingDeletedUsers: orphanedCases,
      usersReferencingDeletedCompanies: orphanedCompanies,
    },
  };
}

module.exports = { purgeDemoData };

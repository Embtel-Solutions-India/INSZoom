const mongoose = require("mongoose");
const Answer = require("../../models/Answer");
const Case = require("../../models/Case");
const Question = require("../../models/Question");
const Questionnaire = require("../../models/Questionnaire");
const Task = require("../../models/Task");
const User = require("../../models/User");
const caseService = require("../cases/case.service");
const participantService = require("../cases/case-participant.service");
const notificationService = require("../notifications/notification.service");
const emailService = require("../email/email.service");
const env = require("../../config/env");

// Generic staff "Request information" flow.
//
// Design: a request never edits a shared questionnaire template. It appends a
// Question to a per-case, per-recipient "Additional Requested Information"
// checklist (a private Questionnaire tagged "staff_request", referenced from
// Case.questionnaireReferences with staffRequest: true). Answers/uploads then
// use the normal Answer/storage/Document pipeline (saveAnswers/saveFileAnswer).
const STAFF_REQUEST_TAG = "staff_request";
const SECTION_KEY = "requested_information";
const ITEM_KINDS = ["document", "text", "textarea", "number", "date", "yes_no", "select"];
const DOCUMENT_CATEGORIES = ["Identity", "Immigration", "Financial", "Employment", "Other"];
const CHECKLIST_ROLES = ["employer", "employee", "petitioner", "beneficiary", "joint_sponsor", "client"];
const ROLE_LABELS = { employer: "Employer", employee: "Employee", petitioner: "Petitioner", beneficiary: "Beneficiary", joint_sponsor: "Joint Sponsor", client: "Client" };
const QUESTION_TYPE_BY_KIND = { document: "file", text: "text", textarea: "textarea", number: "number", date: "date", yes_no: "select", select: "select" };

function idOf(value) {
  return value?._id?.toString?.() || value?.toString?.() || "";
}

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function userName(user) {
  return clean(user?.name || user?.displayName || [user?.firstName, user?.lastName].filter(Boolean).join(" "));
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// Pure: resolves the people a request can be addressed to from the case's own
// participant data. `users` maps userId -> { name, email }. Only roles that
// actually exist on the case are returned. Each option has a stable id
// ("p:<participantId>" or "f:<role>:<userId>") that the server re-resolves on send.
function buildRecipients(caseData, users = {}) {
  const options = [];
  const seen = new Set();
  const single = caseData?.caseStructure === "single" || caseData?.caseRole === "single";
  // Family cases (including the legacy "-A" beneficiary child case, which stores
  // the beneficiary under employee-shaped fields) must never surface as employer/employee.
  const family = caseData?.caseStructure === "family"
    || caseData?.caseRole === "beneficiary"
    || Boolean(caseData?.petitionerUser || caseData?.beneficiaryUser || caseData?.familyWorkflow?.petitionerStatus);
  const FAMILY_ROLE = { employee: "beneficiary", employer: "petitioner" };
  const push = ({ id, role: rawRole, userId, participantId, name, email }) => {
    const role = family ? (FAMILY_ROLE[rawRole] || rawRole) : rawRole;
    if (!CHECKLIST_ROLES.includes(role)) return;
    const known = users[idOf(userId)] || {};
    const resolvedEmail = clean(email || known.email).toLowerCase();
    const identity = `${role}:${idOf(userId) || resolvedEmail || idOf(participantId)}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    const resolvedName = clean(name) || clean(known.name);
    const label = single && role === "employee" ? "Client" : ROLE_LABELS[role];
    options.push({
      id,
      role,
      roleLabel: label,
      participantId: participantId ? idOf(participantId) : null,
      userId: userId ? idOf(userId) : null,
      name: resolvedName,
      email: resolvedEmail,
      label: `${label} - ${resolvedName || "Unnamed"}${resolvedEmail ? ` (${resolvedEmail})` : ""}`,
    });
  };
  participantService.activeParticipants(caseData).forEach((participant) => {
    const role = participantService.normalizeParticipantRole(participant.role);
    push({ id: `p:${idOf(participant._id)}`, role, userId: participant.userId, participantId: participant._id, name: participant.name, email: participant.email });
  });
  const fieldRoles = [
    ["employer", caseData?.employerUser],
    ["employee", caseData?.employeeUser],
    ["petitioner", caseData?.petitionerUser],
    ["beneficiary", caseData?.beneficiaryUser],
    ["joint_sponsor", caseData?.jointSponsorUser],
  ];
  fieldRoles.forEach(([role, userId]) => {
    if (userId) push({ id: `f:${role}:${idOf(userId)}`, role, userId });
  });
  // Single-person client: the case owner, when not already represented above.
  if (caseData?.user && !options.some((option) => option.userId === idOf(caseData.user))) {
    push({ id: `f:client:${idOf(caseData.user)}`, role: "client", userId: caseData.user, name: caseData.clientName, email: caseData.clientEmail });
  }
  return options;
}

async function listRecipients(caseData) {
  const ids = new Set();
  [caseData.employerUser, caseData.employeeUser, caseData.petitionerUser, caseData.beneficiaryUser, caseData.jointSponsorUser, caseData.user].forEach((id) => id && ids.add(idOf(id)));
  participantService.activeParticipants(caseData).forEach((participant) => participant.userId && ids.add(idOf(participant.userId)));
  const found = ids.size ? await User.find({ _id: { $in: [...ids] } }).select("name displayName firstName lastName email").lean() : [];
  const users = {};
  found.forEach((user) => { users[idOf(user)] = { name: userName(user), email: user.email }; });
  return buildRecipients(caseData, users);
}

// Pure: the Question document fields for one request.
function buildQuestionPayload({ questionnaire, key, name, itemKind, documentCategory, options = [], description, order, requestId, actor }) {
  const type = QUESTION_TYPE_BY_KIND[itemKind];
  const optionList = itemKind === "yes_no" ? ["Yes", "No"] : (itemKind === "select" ? options : []);
  return {
    questionnaire: questionnaire._id,
    questionnaireKey: questionnaire.key,
    questionnaireVersion: questionnaire.version || 1,
    key,
    sectionKey: SECTION_KEY,
    pageKey: SECTION_KEY,
    order,
    type,
    label: name,
    description: description || undefined,
    options: optionList.map((value) => ({ label: value, value })),
    required: true,
    active: true,
    isActive: true,
    evidenceCategory: itemKind === "document" ? (documentCategory || "Other") : undefined,
    metadata: {
      staffRequested: true,
      requestId: idOf(requestId),
      itemKind,
      ...(itemKind === "document" ? { documentType: name, documentCategory: documentCategory || "Other" } : {}),
    },
    createdBy: actor?._id,
  };
}

async function ensureRequestQuestionnaire(caseData, recipient, actor) {
  const owner = recipient.participantId || `${recipient.role}-${recipient.userId || "none"}`;
  const key = `staff_requests_${idOf(caseData._id)}_${owner}`;
  let questionnaire = await Questionnaire.findOne({ key, version: 1 });
  if (questionnaire) return questionnaire;
  const payload = {
    key,
    title: "Additional Requested Information",
    description: "Items your case manager asked you to provide.",
    version: 1,
    status: "published",
    type: "questionnaire",
    module: "cases",
    isActive: true,
    isTemplate: false,
    isDefault: false,
    latestVersion: true,
    checklistRole: recipient.role,
    tags: [STAFF_REQUEST_TAG],
    sections: [{ key: SECTION_KEY, title: "Requested Information", order: 1 }],
    pages: [{ key: SECTION_KEY, title: "Requested Information", order: 1, sectionKeys: [SECTION_KEY] }],
    createdBy: actor?._id,
  };
  try {
    questionnaire = await Questionnaire.create(payload);
  } catch (error) {
    if (error?.code !== 11000) throw error;
    questionnaire = await Questionnaire.findOne({ key, version: 1 });
  }
  return questionnaire;
}

function ensureReference(caseData, questionnaire, recipient, actor, dueDate) {
  let reference = (caseData.questionnaireReferences || []).find((item) => idOf(item.questionnaireId) === idOf(questionnaire._id));
  if (!reference) {
    const responseId = participantService.participantResponseId(questionnaire._id, caseData._id, recipient.participantId, recipient.userId);
    caseData.questionnaireReferences.push({
      questionnaireId: questionnaire._id,
      questionnaireTemplateId: questionnaire._id,
      responseId,
      title: questionnaire.title,
      targetRole: recipient.role,
      participantId: recipient.participantId || undefined,
      participantRole: recipient.role,
      status: "not_started",
      active: true,
      staffRequest: true,
      sentAt: new Date(),
      dueDate,
      assignedTo: recipient.userId || undefined,
      sentBy: actor?._id,
    });
    reference = caseData.questionnaireReferences[caseData.questionnaireReferences.length - 1];
  } else {
    reference.active = true;
    // A new required row re-opens a checklist that was already finished.
    if (["completed", "submitted", "approved", "returned"].includes(reference.status)) reference.status = "in_progress";
  }
  return reference;
}

const PORTAL_LINK = "/dashboard/documents";

async function notifyRecipient({ caseData, recipient, name, itemKind, description, actor, req }) {
  const caseManager = userName(actor) || "Your case manager";
  const emailData = {
    caseNumber: caseData.caseNumber,
    recipientName: recipient.name,
    caseManagerName: caseManager,
    itemName: name,
    itemKind: itemKind === "document" ? "document" : "information",
    details: description || name,
    portalLink: `${env.clientUrl || ""}${PORTAL_LINK}`,
  };
  const message = `${caseManager} is asking for ${itemKind === "document" ? "this document" : "this information"}: ${name}. Please log in and provide the details in your checklist.`;
  if (recipient.userId) {
    return notificationService.createNotification({
      userId: recipient.userId,
      type: "additional_information_requested",
      title: "Information requested",
      message,
      link: PORTAL_LINK,
      caseId: caseData._id,
      companyId: caseData.companyId,
      channels: ["in_app", "push", "email"],
      emailTemplate: "additional-info-requested",
      emailData,
      emailTo: recipient.email || undefined,
      source: "shared",
    }, actor);
  }
  // Invited participant without an account yet: only the email channel is possible.
  if (recipient.email) {
    return emailService.sendTemplateEmail("additional-info-requested", { to: recipient.email, data: emailData, caseId: caseData._id, triggeredBy: actor?._id, source: "shared" });
  }
  return null;
}

async function createRequest(caseData, input, actor, req) {
  const recipients = await listRecipients(caseData);
  const recipient = recipients.find((option) => option.id === input.recipientId);
  if (!recipient) throw httpError(400, "Recipient is not a participant of this case");
  const name = clean(input.name);
  const itemKind = input.itemKind;
  if (!name) throw httpError(400, "Item name is required");
  if (!ITEM_KINDS.includes(itemKind)) throw httpError(400, "Unsupported request type");
  const options = (input.options || []).map(clean).filter(Boolean);
  if (itemKind === "select" && options.length < 2) throw httpError(400, "A select question needs at least two options");
  const description = clean(input.description);

  const questionnaire = await ensureRequestQuestionnaire(caseData, recipient, actor);
  const requestId = new mongoose.Types.ObjectId();
  const key = `req_${requestId}`;
  const order = (await Question.countDocuments({ questionnaire: questionnaire._id })) + 1;
  const question = await Question.create(buildQuestionPayload({
    questionnaire, key, name, itemKind, documentCategory: input.documentCategory, options, description, order, requestId, actor,
  }));
  const reference = ensureReference(caseData, questionnaire, recipient, actor, input.dueDate);

  const task = await Task.create({
    title: `Provide: ${name}`,
    description,
    caseId: caseData._id,
    companyId: caseData.companyId,
    assignedTo: recipient.userId || undefined,
    assignedBy: actor._id,
    category: "client_communication",
    documentation: { workType: itemKind === "document" ? "document_request" : "client_follow_up", documentType: name, instructions: description },
    priority: "medium",
    status: recipient.userId ? "assigned" : "pending",
    dueDate: input.dueDate,
    source: "shared",
  });

  caseData.informationRequests.push({
    _id: requestId,
    target: recipient.role,
    title: name,
    description,
    requestType: itemKind === "document" ? "document" : "questionnaire",
    documentType: itemKind === "document" ? name : undefined,
    itemKind,
    documentCategory: itemKind === "document" ? (input.documentCategory || "Other") : undefined,
    options: itemKind === "select" ? options : [],
    recipientRole: recipient.role,
    recipientName: recipient.name,
    recipientEmail: recipient.email,
    dueDate: input.dueDate,
    assignedTo: recipient.userId || undefined,
    participantId: recipient.participantId || undefined,
    requestedBy: actor._id,
    task: task._id,
    questionnaireId: questionnaire._id,
    questionKey: key,
    referenceId: reference._id,
  });
  caseService.addTimelineEvent(caseData, "request", "Information Requested", `${recipient.label} was asked for ${name}.`, actor, { target: recipient.role, taskId: task._id, requestId });
  caseService.addAuditEntry(caseData, "information_request_created", `Requested ${name} from ${recipient.label}`, actor, { requestId, questionKey: key, itemKind, recipientRole: recipient.role }, req);
  await caseData.save();
  await caseService.writeAuditLog("information_request_created", caseData, actor, { requestId, itemKind, recipientRole: recipient.role }, req).catch(() => null);
  // Delivery failures must never undo a saved request.
  await notifyRecipient({ caseData, recipient, name, itemKind, description, actor, req }).catch(() => null);
  return { request: caseData.informationRequests.id(requestId), question, reference, task, recipient };
}

function isAnswered(answer) {
  if (!answer) return false;
  if (Array.isArray(answer.files) && answer.files.length) return true;
  const value = answer.value;
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

// Called from questionnaire.service saveAnswers for "staff_request" checklists:
// open requests whose row now has an answer move to "submitted" and the
// requesting team member is notified.
async function markAnswered({ caseId, questionnaire, answerMap = {}, user, req }) {
  const caseData = await Case.findById(caseId).select("informationRequests caseNumber assignedCaseManager").lean();
  if (!caseData) return [];
  const now = new Date();
  const done = [];
  for (const request of caseData.informationRequests || []) {
    if (request.status !== "open" || !request.questionKey) continue;
    if (idOf(request.questionnaireId) !== idOf(questionnaire._id)) continue;
    if (!isAnswered(answerMap[request.questionKey])) continue;
    const result = await Case.updateOne(
      { _id: caseId, informationRequests: { $elemMatch: { _id: request._id, status: "open" } } },
      { $set: { "informationRequests.$.status": "submitted", "informationRequests.$.submittedAt": now } }
    );
    if (!result.modifiedCount) continue;
    done.push(request);
    const notifyId = request.requestedBy || caseData.assignedCaseManager;
    if (notifyId) {
      await notificationService.createNotification({
        userId: notifyId,
        type: "questionnaire_submitted",
        title: "Requested information received",
        message: `${request.recipientName || "The client"} provided "${request.title}" for ${caseData.caseNumber || "the case"}.`,
        link: `/crm-cases/${caseId}`,
        caseId,
        source: "shared",
      }, user, req).catch(() => null);
    }
  }
  return done;
}

// Admin view: all requests (legacy employer/employee ones included) joined with the stored answer (value or file names).
async function listRequestsWithAnswers(caseData) {
  const requests = caseData.informationRequests || [];
  const out = [];
  for (const request of requests) {
    let answer = null;
    const reference = (caseData.questionnaireReferences || []).find((item) => idOf(item._id) === idOf(request.referenceId));
    if (request.questionKey && reference?.responseId) {
      answer = await Answer.findOne({ responseId: reference.responseId, questionKey: request.questionKey }).select("value files status").lean();
    }
    out.push({
      ...(request.toObject ? request.toObject() : request),
      responseId: reference?.responseId,
      answer: answer ? { value: answer.value, status: answer.status, files: (answer.files || []).map((file) => ({ originalName: file.originalName, storageKey: file.storageKey })) } : null,
    });
  }
  return out;
}

module.exports = {
  ITEM_KINDS,
  DOCUMENT_CATEGORIES,
  STAFF_REQUEST_TAG,
  buildRecipients,
  buildQuestionPayload,
  listRecipients,
  createRequest,
  markAnswered,
  isAnswered,
  listRequestsWithAnswers,
};

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
const requestedFields = require("./requested-fields");
const { isSharedRoleForChildCase } = require("../cases/sharedCaseRoles");
const realtimeGateway = require("../realtime/realtime.gateway");
const { allCaseManagerIds } = require("../cases/caseManagerAccess");
const { evaluateRequest, sameRecipientRole } = require("./request-fulfilment");
const { scopedChildIdsFor } = require("../cases/caseManagerAccess");

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
  // ...but never a second entry for a person already listed under another role (the beneficiary / employee of the same case, matched by login or by e-mail).
  if (caseData?.user) {
    const ownerId = idOf(caseData.user);
    const ownerEmail = clean(caseData.clientEmail || users[ownerId]?.email).toLowerCase();
    const alreadyListed = options.some((option) => option.userId === ownerId || (ownerEmail && option.email === ownerEmail));
    if (!alreadyListed) push({ id: `f:client:${ownerId}`, role: "client", userId: caseData.user, name: caseData.clientName, email: caseData.clientEmail });
  }
  return options;
}

// Pure: one "Send to" option per employee / beneficiary child case of a matter. The request is created on that child case, so only that person's checklist shows it.
// `userId` is set only for an invited person who has their own login (the child case is then owned by them, not by the employer).
function buildChildRecipients(principal, children = []) {
  return children
    .filter((child) => child && child.status !== "removed" && ["employee", "beneficiary"].includes(child.caseRole))
    .sort((a, b) => String(a.childIndex || "").localeCompare(String(b.childIndex || "")))
    .map((child) => {
      const role = child.caseRole === "beneficiary" ? "beneficiary" : "employee";
      const invited = Boolean(child.user) && (!principal?.user || idOf(child.user) !== idOf(principal.user));
      const name = clean(child.employeeIdentity?.name) || clean(child.pendingEmployee?.name) || clean(child.clientName) || `Slot ${clean(child.caseNumber)}`;
      const email = clean(child.employeeIdentity?.email || child.pendingEmployee?.email || child.clientEmail).toLowerCase();
      return {
        id: `c:${idOf(child._id)}`,
        role,
        roleLabel: ROLE_LABELS[role],
        childCaseId: idOf(child._id),
        participantId: null,
        userId: invited ? idOf(child.user) : null,
        name,
        email,
        label: `${ROLE_LABELS[role]} - ${name}${email ? ` (${email})` : ""}`,
      };
    });
}

// The case's own participants (employer / petitioner / client ...). Unchanged: the per-item "Request" flow and every other caller keep exactly this list.
async function listRecipients(caseData) {
  const ids = new Set();
  [caseData.employerUser, caseData.employeeUser, caseData.petitionerUser, caseData.beneficiaryUser, caseData.jointSponsorUser, caseData.user].forEach((id) => id && ids.add(idOf(id)));
  participantService.activeParticipants(caseData).forEach((participant) => participant.userId && ids.add(idOf(participant.userId)));
  const found = ids.size ? await User.find({ _id: { $in: [...ids] } }).select("name displayName firstName lastName email").lean() : [];
  const users = {};
  found.forEach((user) => { users[idOf(user)] = { name: userName(user), email: user.email }; });
  return buildRecipients(caseData, users);
}

// "Send to" of the Documents tab's special-request section. `user` is the staff member asking: a case manager who is on only some of the matter's employees is offered only those.
//  - an employee / beneficiary case: that one person, nobody else (not the employer, not another employee);
//  - the matter's own case (employer / petitioner): its own participants plus every active employee / beneficiary, each addressed on their own case;
//  - any other case (single, family two-party): its participants, as before.
async function listRecipientsForPanel(caseData, user) {
  if (["employee", "beneficiary"].includes(caseData.caseRole) && caseData.parentCase) {
    const parent = await Case.findById(caseData.parentCase).select("user").lean();
    return buildChildRecipients(parent || {}, [caseData]);
  }
  const options = await listRecipients(caseData);
  if (caseData.caseRole === "principal") {
    let children = await Case.find({ parentCase: caseData._id, status: { $ne: "removed" }, caseRole: { $in: ["employee", "beneficiary"] } })
      .select("caseNumber clientName clientEmail pendingEmployee employeeIdentity user caseRole childIndex status").lean();
    const scoped = user ? await scopedChildIdsFor(caseData, user).catch(() => null) : null;
    if (scoped) { const allowed = new Set(scoped.map(String)); children = children.filter((child) => allowed.has(String(child._id))); }
    options.push(...buildChildRecipients(caseData, children));
  }
  return options;
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

async function notifyRecipient({ caseData, recipient, name, itemKind, description, actor, req, required = false }) {
  const caseManager = userName(actor) || "Your case manager";
  const emailData = {
    caseNumber: caseData.caseNumber,
    recipientName: recipient.name,
    caseManagerName: caseManager,
    itemName: name,
    itemKind: itemKind === "document" ? "document" : "information",
    details: description || name,
    required,
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

async function createRequest(matterCase, input, actor, req) {
  const recipients = await listRecipientsForPanel(matterCase, actor);
  const recipient = recipients.find((option) => option.id === input.recipientId);
  if (!recipient) throw httpError(400, "Recipient is not a participant of this case");
  // A request to an employee / beneficiary is created on THEIR case, so it appears in their checklist only. Everyone else's request is created on this case, as before.
  let caseData = matterCase;
  if (recipient.childCaseId && idOf(recipient.childCaseId) !== idOf(matterCase._id)) {
    caseData = await Case.findById(recipient.childCaseId);
    if (!caseData || caseData.status === "removed" || idOf(caseData.parentCase) !== idOf(matterCase._id)) throw httpError(404, "That person's case is no longer available");
  }
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
    questionnaireId: questionnaire._id,
    questionKey: key,
    referenceId: reference._id,
  });
  caseService.addTimelineEvent(caseData, "request", "Information Requested", `${recipient.label} was asked for ${name}.`, actor, { target: recipient.role, requestId });
  caseService.addAuditEntry(caseData, "information_request_created", `Requested ${name} from ${recipient.label}`, actor, { requestId, questionKey: key, itemKind, recipientRole: recipient.role }, req);
  await caseData.save();
  await caseService.writeAuditLog("information_request_created", caseData, actor, { requestId, itemKind, recipientRole: recipient.role }, req).catch(() => null);
  // Delivery failures must never undo a saved request.
  await notifyRecipient({ caseData, recipient, name, itemKind, description, actor, req }).catch(() => null);
  return { request: caseData.informationRequests.id(requestId), question, reference, recipient };
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
      { $set: { "informationRequests.$.status": "submitted", "informationRequests.$.submittedAt": now, "informationRequests.$.fulfilledBy": "request" } }
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
  if (done.length) announceRequestChange(caseData, "information_request_received");
  return done;
}

// ── A request the client already satisfied on their normal checklist ───────────────────────────────────────────────────────────────────
// Staff type requests as free text ("Current U.S. Address", "Copy of Educational Credential Evaluation Report"...). When the client has already
// answered the same item on their own checklist, the request is Received - not Open - and disappears from the client's "Requested by your case
// manager" list. It reopens if that answer is later removed. Matching is conservative (request-fulfilment.js): an item it cannot match keeps the
// request open. Called after every answer save on a case that has such requests, and when the Admin panel lists the requests.

const isChecklistFulfillable = (request) => request.questionKey && request.scope !== "existing_question" && ((request.status || "open") === "open" || request.fulfilledBy === "checklist");

// Everything the recipient has on their normal (non staff-request) checklists: questions + answers, keys namespaced per checklist.
async function recipientChecklistFacts(caseData, request) {
  const refs = (caseData.questionnaireReferences || []).filter((ref) => ref.active !== false && !ref.staffRequest && ref.questionnaireId && ref.responseId
    && (sameRecipientRole(ref.targetRole, request.recipientRole) || sameRecipientRole(ref.participantRole, request.recipientRole))
    && (!request.participantId || !ref.participantId || idOf(ref.participantId) === idOf(request.participantId)));
  const questions = [];
  const answers = new Map();
  const where = new Map();
  for (const ref of refs) {
    const [rows, stored] = await Promise.all([
      Question.find({ questionnaire: ref.questionnaireId, active: { $ne: false } }).select("key label").lean(),
      Answer.find({ responseId: ref.responseId }).select("questionKey value files").lean(),
    ]);
    const byKey = new Map(stored.map((answer) => [answer.questionKey, answer]));
    rows.forEach((row) => {
      const namespaced = `${idOf(ref._id)}|${row.key}`;
      questions.push({ key: namespaced, label: row.label });
      where.set(namespaced, { questionnaireId: ref.questionnaireId, responseId: ref.responseId, questionKey: row.key, label: row.label });
      if (byKey.has(row.key)) answers.set(namespaced, byKey.get(row.key));
    });
  }
  return { questions, answers, where };
}

function announceRequestChange(caseData, action) {
  try {
    const recipients = new Set([caseData.user, ...allCaseManagerIds(caseData)].filter(Boolean).map(String));
    (caseData.informationRequests || []).forEach((request) => request.assignedTo && recipients.add(String(request.assignedTo)));
    recipients.forEach((userId) => {
      realtimeGateway.emitToUser(userId, "case:checklists_changed", { caseId: String(caseData._id), reason: action, at: new Date().toISOString() });
      realtimeGateway.emitToUser(userId, "case:updated", { caseId: caseData._id, caseNumber: caseData.caseNumber, action, performedAt: new Date() });
    });
  } catch { /* a missed live push must never fail the change */ }
}

async function reconcileFulfilment({ caseId, user, req } = {}) {
  const caseData = await Case.findById(caseId).select("informationRequests questionnaireReferences caseNumber user assignedCaseManager additionalCaseManagers").lean();
  if (!caseData) return { changed: 0 };
  const candidates = (caseData.informationRequests || []).filter(isChecklistFulfillable);
  if (!candidates.length) return { changed: 0 };
  let changed = 0;
  for (const request of candidates) {
    const facts = await recipientChecklistFacts(caseData, request);
    const verdict = evaluateRequest(request.title, facts.questions, facts.answers);
    const open = (request.status || "open") === "open";
    if (open && verdict.fulfilled) {
      const result = await Case.updateOne(
        { _id: caseId, informationRequests: { $elemMatch: { _id: request._id, status: "open" } } },
        { $set: { "informationRequests.$.status": "submitted", "informationRequests.$.submittedAt": new Date(), "informationRequests.$.fulfilledBy": "checklist" } }
      );
      if (!result.modifiedCount) continue;
      changed += 1;
      // the client no longer sees it under "Requested by your case manager"; the work item is done
      await Question.updateOne({ questionnaire: request.questionnaireId, key: request.questionKey }, { $set: { active: false, isActive: false } }).catch(() => null);
      if (request.task) await Task.updateOne({ _id: request.task, status: { $nin: ["completed", "cancelled"] } }, { $set: { status: "completed" } }).catch(() => null);
      const notify = request.requestedBy ? [request.requestedBy] : allCaseManagerIds(caseData);
      await Promise.all(notify.map((userId) => notificationService.createNotification({
        userId,
        type: "questionnaire_submitted",
        title: "Requested information received",
        message: `${request.recipientName || "The client"} already provided "${request.title}" for ${caseData.caseNumber || "the case"}.`,
        link: `/crm-cases/${caseId}`,
        caseId,
        source: "shared",
      }, user, req).catch(() => null)));
    } else if (!open && request.fulfilledBy === "checklist" && !verdict.fulfilled) {
      const result = await Case.updateOne(
        { _id: caseId, informationRequests: { $elemMatch: { _id: request._id, status: "submitted", fulfilledBy: "checklist" } } },
        { $set: { "informationRequests.$.status": "open", "informationRequests.$.fulfilledBy": "" }, $unset: { "informationRequests.$.submittedAt": "" } }
      );
      if (!result.modifiedCount) continue;
      changed += 1;
      await Question.updateOne({ questionnaire: request.questionnaireId, key: request.questionKey }, { $set: { active: true, isActive: true } }).catch(() => null);
      if (request.task) await Task.updateOne({ _id: request.task, status: "completed" }, { $set: { status: request.assignedTo ? "assigned" : "pending" } }).catch(() => null);
    }
  }
  if (changed) announceRequestChange(caseData, "information_request_received");
  return { changed };
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
    // Satisfied from the client's normal checklist: say where, and expose those answers so Admin can read/open them.
    let providedIn = [];
    if (request.fulfilledBy === "checklist" && isChecklistFulfillable(request)) {
      const facts = await recipientChecklistFacts(caseData, request);
      const verdict = evaluateRequest(request.title, facts.questions, facts.answers);
      providedIn = verdict.questionKeys.map((key) => {
        const place = facts.where.get(key);
        const stored = facts.answers.get(key);
        return { ...place, value: stored?.value, files: (stored?.files || []).map((file) => ({ originalName: file.originalName, storageKey: file.storageKey })) };
      });
    }
    out.push({
      ...(request.toObject ? request.toObject() : request),
      responseId: reference?.responseId,
      answer: answer ? { value: answer.value, status: answer.status, files: (answer.files || []).map((file) => ({ originalName: file.originalName, storageKey: file.storageKey })) } : null,
      providedIn,
    });
  }
  return out;
}

// The requests sent to the employees / beneficiaries of a matter live on their own cases; the matter's panel lists them together with its own.
async function listChildRequests(principal, user) {
  const out = [];
  let children = await Case.find({ parentCase: principal._id, "informationRequests.0": { $exists: true } });
  const scoped = user ? await scopedChildIdsFor(principal, user).catch(() => null) : null;
  if (scoped) { const allowed = new Set(scoped.map(String)); children = children.filter((child) => allowed.has(String(child._id))); }
  for (const child of children) {
    await reconcileFulfilment({ caseId: child._id, user, req: null }).catch(() => null);
    const fresh = (await Case.findById(child._id)) || child;
    for (const item of await listRequestsWithAnswers(fresh)) out.push({ ...item, caseId: idOf(child._id) });
  }
  return out;
}

// ── "Request" on an item that is ALREADY on the client's checklist ─────────────────────────────────────────────────────────────────────
// The case manager clicks Request next to a text answer or a document row. That question becomes REQUIRED FOR THIS CASE ONLY (the shared
// questionnaire is never edited): the client is e-mailed what is being asked, sees the item flagged "Requested by your case manager", and
// cannot submit the checklist until it is answered. Idempotent: asking again for an item with an open request re-sends the e-mail (with the
// updated note) instead of creating a second request.
function kindOfQuestion(question) {
  return question?.type === "file" || question?.type === "file-multiple" ? "document" : "text";
}

// The recipients that can own this checklist: its role first, the case's single person otherwise.
function candidateRecipients(recipients, role) {
  const byRole = recipients.filter((option) => option.role === role);
  if (byRole.length) return byRole;
  return recipients.length === 1 ? recipients : [];
}

async function createItemRequest(caseData, input, actor, req) {
  const questionKey = clean(input.questionKey);
  if (!questionKey) throw httpError(400, "questionKey is required");
  const note = clean(input.note || input.description);
  if (note.length > 2000) throw httpError(400, "The note is too long (2000 characters at most)");

  // Resolve the checklist exactly the way the screen showed it; this is also what proves the question is really on this case's checklist.
  const questionnaireService = require("../questionnaires/questionnaire.service");
  const state = await questionnaireService.getQuestionnaireForCase(caseData._id, actor, clean(input.targetRole) || undefined, { referenceId: clean(input.referenceId) || undefined });
  if (!state?.questionnaire || !state.responseId) throw httpError(404, "That checklist is not available for this case");
  const question = (state.questions || []).find((item) => item.key === questionKey);
  if (!question) throw httpError(404, "That question is not on this case's checklist");
  const role = clean(input.targetRole) || state.questionnaire.checklistRole || "";

  // Where the response (and therefore the request) lives: a principal's shared role is answered on the principal case.
  let ownerCase = caseData;
  if (isSharedRoleForChildCase(caseData, role)) {
    ownerCase = await Case.findById(caseData.parentCase);
    if (!ownerCase || !caseService.canAccessCase(actor, ownerCase)) throw httpError(404, "Case not found");
  }

  const recipients = await listRecipients(ownerCase);
  let recipient = input.recipientId ? recipients.find((option) => option.id === input.recipientId) : null;
  if (input.recipientId && !recipient) throw httpError(400, "Recipient is not a participant of this case");
  if (!recipient) {
    const candidates = candidateRecipients(recipients, role);
    if (candidates.length === 1) [recipient] = candidates;
    else if (candidates.length > 1) {
      const error = httpError(409, "Choose who this request goes to");
      error.code = "RECIPIENT_REQUIRED";
      error.details = { recipients: candidates };
      throw error;
    }
  }
  if (!recipient) throw httpError(400, "There is no client on this checklist to send the request to");

  const itemKind = kindOfQuestion(question);
  const name = clean(question.label) || questionKey;
  const existing = (ownerCase.informationRequests || []).find((request) => (
    request.scope === "existing_question" && request.questionKey === questionKey && String(request.responseId || "") === String(state.responseId) && (request.status || "open") === "open"
  ));

  let request = existing;
  if (existing) {
    if (note) existing.description = note;
    existing.requestedBy = actor._id;
    existing.requestedAt = new Date();
  } else {
    const requestId = new mongoose.Types.ObjectId();
    ownerCase.informationRequests.push({
      _id: requestId,
      scope: "existing_question",
      target: recipient.role,
      title: name,
      description: note,
      requestType: itemKind === "document" ? "document" : "questionnaire",
      documentType: itemKind === "document" ? name : undefined,
      itemKind,
      recipientRole: recipient.role,
      recipientName: recipient.name,
      recipientEmail: recipient.email,
      dueDate: input.dueDate,
      assignedTo: recipient.userId || undefined,
      participantId: recipient.participantId || undefined,
      requestedBy: actor._id,
      questionnaireId: state.questionnaire._id,
      questionKey,
      responseId: state.responseId,
    });
    request = ownerCase.informationRequests[ownerCase.informationRequests.length - 1];
    // A request on a finished checklist re-opens it: the client has something to submit again.
    const reference = (ownerCase.questionnaireReferences || []).find((item) => item.active !== false && String(item.responseId || "") === String(state.responseId));
    if (reference && ["completed", "submitted", "approved", "returned"].includes(reference.status)) reference.status = "in_progress";
    caseService.addTimelineEvent(ownerCase, "request", "Information Requested", `${recipient.label} was asked for ${name} (now required for this case).`, actor, { target: recipient.role, requestId, questionKey });
  }
  caseService.addAuditEntry(ownerCase, existing ? "information_request_resent" : "information_request_created", `${existing ? "Re-sent request for" : "Requested"} ${name} from ${recipient.label}`, actor, { requestId: request._id, questionKey, scope: "existing_question", itemKind, recipientRole: recipient.role }, req);
  await ownerCase.save();
  await caseService.writeAuditLog(existing ? "information_request_resent" : "information_request_created", ownerCase, actor, { requestId: request._id, questionKey, scope: "existing_question" }, req).catch(() => null);
  // Delivery failures must never undo a saved request.
  await notifyRecipient({ caseData: ownerCase, recipient, name, itemKind, description: note, actor, req, required: true }).catch(() => null);
  return { request, recipient, resent: Boolean(existing), question: { key: question.key, label: name, itemKind }, ownerCaseId: ownerCase._id };
}

// Withdraws a request (made by mistake / no longer needed): the item stops being required for this case. The client's answer, if any, stays.
async function cancelItemRequest(caseData, requestId, actor, req) {
  const request = caseData.informationRequests?.id?.(requestId) || (caseData.informationRequests || []).find((item) => idOf(item._id) === idOf(requestId));
  if (!request || request.scope !== "existing_question") throw httpError(404, "Request not found");
  if (request.status === "closed") return request;
  request.status = "closed";
  request.resolvedAt = new Date();
  if (request.task) await Task.updateOne({ _id: request.task, status: { $nin: ["completed", "cancelled"] } }, { $set: { status: "cancelled" } }).catch(() => null);
  caseService.addTimelineEvent(caseData, "request", "Request Withdrawn", `The request for ${request.title} was withdrawn; it is no longer required.`, actor, { requestId: request._id });
  caseService.addAuditEntry(caseData, "information_request_closed", `Withdrew request for ${request.title}`, actor, { requestId: request._id, questionKey: request.questionKey }, req);
  await caseData.save();
  return request;
}

// Called by saveAnswers when an answer arrives for a response that has open item requests: answered ones move to "submitted" and the
// requesting team member is told.
async function markItemRequestsAnswered({ caseId, responseId, answerMap = {}, user, req }) {
  const caseData = await Case.findById(caseId).select("informationRequests caseNumber assignedCaseManager").lean();
  if (!caseData) return [];
  const now = new Date();
  const done = [];
  for (const request of caseData.informationRequests || []) {
    if (!requestedFields.isItemRequest(request) || (request.status || "open") !== "open" || String(request.responseId || "") !== String(responseId)) continue;
    if (!isAnswered(answerMap[request.questionKey])) continue;
    const result = await Case.updateOne(
      { _id: caseId, informationRequests: { $elemMatch: { _id: request._id, status: "open" } } },
      { $set: { "informationRequests.$.status": "submitted", "informationRequests.$.submittedAt": now } }
    );
    if (!result.modifiedCount) continue;
    done.push(request);
    if (request.task) await Task.updateOne({ _id: request.task, status: { $nin: ["completed", "cancelled"] } }, { $set: { status: "completed" } }).catch(() => null);
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

module.exports = {
  reconcileFulfilment,
  createItemRequest,
  cancelItemRequest,
  markItemRequestsAnswered,
  candidateRecipients,
  ITEM_KINDS,
  DOCUMENT_CATEGORIES,
  STAFF_REQUEST_TAG,
  buildRecipients,
  buildQuestionPayload,
  listRecipients,
  listRecipientsForPanel,
  buildChildRecipients,
  listChildRequests,
  createRequest,
  markAnswered,
  isAnswered,
  listRequestsWithAnswers,
};

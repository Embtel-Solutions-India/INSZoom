// Client-side questionnaire alerts for the case team. When a client-side user (client, employer, delegate employer, employee,
// beneficiary, petitioner) SAVES PROGRESS on or SUBMITS a checklist, the case's assigned case manager(s) and its team lead - never
// administrators - get:
//   * an email naming the questions / documents the client has answered, with a login button to Admin
//       save   -> "questionnaire-progress-saved"   (one email per person per case per 30 minutes, the trigger's cooldown)
//       submit -> "questionnaire-submitted-team"   (de-duplicated for a couple of minutes, see emailPolicy.js)
//   * a browser push + in-app notification that opens the case in Admin.
// Everything here is best effort: it never throws, so a failed alert can never fail the save or submit that triggered it.
const mongoose = require("mongoose");
const Case = require("../../models/Case");
const Answer = require("../../models/Answer");
const Question = require("../../models/Question");
const Questionnaire = require("../../models/Questionnaire");
const EmailLog = require("../../models/EmailLog");
const caseService = require("../cases/case.service");
const emailService = require("../email/email.service");
const notificationService = require("../notifications/notification.service");
const { resolveCaseTeam, CASE_FIELDS } = require("../notifications/caseTeam");
const { actorInfo, actorRole } = require("../notifications/caseActor");
const { isClientSideUser } = require("./checklist-gate");
const logger = require("../../utils/logger");

const displayName = (user) => user?.displayName || user?.name || user?.email || "";
const MAX_LISTED = 30;

const KINDS = {
  saved: { template: "questionnaire-progress-saved", type: "questionnaire_started", pushTitle: (who) => `${who} saved progress`, verb: "saved progress on" },
  submitted: { template: "questionnaire-submitted-team", type: "questionnaire_submitted", pushTitle: (who) => `${who} submitted a questionnaire`, verb: "submitted" },
};

// Which party the acting person is on this case (Employer, Employee, Petitioner, Beneficiary, Delegate employer, Client).
const fillerLabel = (caseData, parentCase, user) => actorRole(caseData, parentCase, user);

const hasAnswer = (answer) => {
  if (answer.visible === false) return false;
  if (Array.isArray(answer.files) && answer.files.length) return true;
  const value = answer.value;
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
};

// The questions / documents this person has given an answer for, grouped by checklist: [{ title, labels }], plus how many more there
// were than fit in the email. `since` limits it to what changed after the previous alert.
async function answeredQuestions({ caseIds, userId, since }) {
  const filter = { caseId: { $in: caseIds }, user: userId };
  if (since) filter.updatedAt = { $gt: since };
  const answers = (await Answer.find(filter).select("question questionnaire value files visible").sort({ updatedAt: -1 }).limit(500).lean()).filter(hasAnswer);
  if (!answers.length) return { groups: [], more: 0 };

  const unique = (field) => [...new Set(answers.map((answer) => String(answer[field])))];
  const [questions, questionnaires] = await Promise.all([
    Question.find({ _id: { $in: unique("question") } }).select("label").lean(),
    Questionnaire.find({ _id: { $in: unique("questionnaire") } }).select("title").lean(),
  ]);
  const labelById = new Map(questions.map((question) => [String(question._id), question.label]));
  const titleById = new Map(questionnaires.map((questionnaire) => [String(questionnaire._id), questionnaire.title]));

  const groups = new Map();
  let listed = 0;
  let more = 0;
  for (const answer of answers) {
    const label = labelById.get(String(answer.question));
    if (!label) continue;
    if (listed >= MAX_LISTED) { more += 1; continue; }
    const title = titleById.get(String(answer.questionnaire)) || "Checklist";
    if (!groups.has(title)) groups.set(title, []);
    groups.get(title).push(label);
    listed += 1;
  }
  return { groups: [...groups].map(([title, labels]) => ({ title, labels })), more };
}

async function lastEmailAt(templateKey, caseId) {
  const last = await EmailLog.findOne({ templateKey, caseId, status: "sent" }).sort({ createdAt: -1 }).select("createdAt").lean();
  return last?.createdAt;
}

// kind: "saved" | "submitted"
//   verified: the caller already checked this user may act on the case (a submit endpoint has)
//   skipCaseManagerEmail / skipCaseManagerPush: the existing code path already tells the case manager that way, so do not repeat it
// Returns { sent, reason }: sent = at least one email went out.
async function alertTeam({ kind, caseId, checklistName, completionPercentage, verified = false, skipCaseManagerEmail = false, skipCaseManagerPush = false }, user, req) {
  try {
    if (mongoose.connection.readyState !== 1) return { sent: false, reason: "db_unavailable" };
    const spec = KINDS[kind];
    const caseData = await Case.findById(caseId).select(`caseNumber visaType clientName petitionerName user parentCase caseRole caseStructure delegateEmployerUser petitionerUser beneficiaryUser employeeUser employerUser ${CASE_FIELDS}`).lean();
    if (!caseData) return { sent: false, reason: "case_not_found" };
    if (!verified && !caseService.canAccessCase(user, caseData)) return { sent: false, reason: "not_authorized" };
    // Staff editing a client's answers from Admin is not "the client filled it in".
    if (!isClientSideUser(user)) return { sent: false, reason: "staff_user" };

    const team = await resolveCaseTeam(caseData);
    if (!team.length) return { sent: false, reason: "no_recipients" };

    const parentCase = caseData.parentCase ? await Case.findById(caseData.parentCase).select("user delegateEmployerUser petitionerName clientName").lean() : null;
    const actor = actorInfo(user, caseData, parentCase); // the person's own name, registered email and party on the case
    const who = actor.name;
    const caseNumber = caseData.caseNumber;
    const since = kind === "saved" ? await lastEmailAt(spec.template, caseData._id).catch(() => undefined) : undefined;
    const answered = await answeredQuestions({ caseIds: [caseData._id, caseData.parentCase].filter(Boolean), userId: user._id, since }).catch(() => ({ groups: [], more: 0 }));
    const total = answered.groups.reduce((sum, group) => sum + group.labels.length, 0) + answered.more;
    const percent = Number.isFinite(Number(completionPercentage)) ? Math.round(Number(completionPercentage)) : undefined;

    const results = await Promise.all(team.map(async ({ user: member, kind: memberKind }) => {
      const outcome = { userId: String(member._id), emailed: false };
      const covered = memberKind === "case_manager";
      if (!(covered && skipCaseManagerEmail)) {
        const sent = await emailService.sendTemplateEmail(spec.template, {
          to: member.email,
          recipientRole: member.role,
          caseId: caseData._id,
          userId: member._id,
          triggeredBy: user._id,
          source: "shared",
          data: {
            recipientName: displayName(member),
            caseManagerName: displayName(member),
            clientName: who,
            filledBy: actor.role,
            actorName: actor.name,
            actorEmail: actor.email,
            actorRole: actor.role,
            caseNumber,
            visaType: caseData.visaType,
            employerName: parentCase?.petitionerName || caseData.petitionerName || undefined,
            checklistName: checklistName ? String(checklistName).slice(0, 120) : undefined,
            completionPercentage: percent,
            answeredGroups: answered.groups,
            answeredMore: answered.more,
          },
        }).catch((error) => ({ sent: false, error: error.message }));
        outcome.emailed = Boolean(sent?.sent);
        outcome.reason = sent?.reason || sent?.error;
      }
      if (!(covered && skipCaseManagerPush)) {
        await notificationService.createNotification({
          userId: member._id,
          recipientRole: member.role,
          type: spec.type,
          category: "case",
          title: spec.pushTitle(who),
          message: `${actor.role}${actor.email ? ` (${actor.email})` : ""}${total ? ` - ${total} answer${total === 1 ? "" : "s"}` : ""}`,
          caseId: caseData._id,
          link: `/crm-cases/${caseData._id}`,
          priority: "high",
          channels: ["in_app", "socket", "push"],
          // one notification per case on the device, replaced by the next alert for that case
          data: { tag: `qa-${caseData._id}` },
          metadata: { kind, checklistName, answeredCount: total },
          source: "shared",
        }, user, req).catch((error) => logger.error("questionnaire_alert_push_failed", { caseId: String(caseData._id), userId: outcome.userId, error: error.message }));
      }
      return outcome;
    }));
    const firstReason = results.find((entry) => entry.reason)?.reason;
    return { sent: results.some((entry) => entry.emailed), reason: results.some((entry) => entry.emailed) ? undefined : firstReason };
  } catch (error) {
    logger.error("questionnaire_alert_failed", { kind, caseId: String(caseId), error: error.message });
    return { sent: false, reason: "error" };
  }
}

// "Save progress" - POST /questionnaires/case/:caseId/progress-saved (the client portal calls it after a successful save).
const notifyProgressSaved = (input, user, req) => alertTeam({ ...input, kind: "saved" }, user, req);

// "Submit" - called by each submit endpoint after the submission has been committed. Fire-and-forget (never awaited by the
// caller's response path): returns a promise that always resolves.
const notifySubmitted = (input, user, req) => alertTeam({ ...input, kind: "submitted", verified: true }, user, req);

module.exports = { notifyProgressSaved, notifySubmitted, fillerLabel, answeredQuestions };

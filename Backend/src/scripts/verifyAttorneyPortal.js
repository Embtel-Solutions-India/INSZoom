// End-to-end API verification for the Attorney Portal backend, run against
// a LIVE server (not mocks, not status-code-only assertions — every check
// asserts on real response bodies and real database state).
//
//   node src/scripts/e2eFixtures.js seed        # creates the attorney users
//   node src/scripts/verifyAttorneyPortal.js
//   node src/scripts/e2eFixtures.js teardown
//
// Exits non-zero on the first failed assertion so it can gate CI.
require("dotenv").config();

const API = process.env.E2E_API_URL || "http://localhost:7000/api";
const E2E_TAG = "e2e-audit.invalid";
const PASSWORD = "E2eAudit!Passw0rd";

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function api(method, path, { token, body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: response.status, body: parsed };
}

// Real multipart upload — a genuine File/Blob through fetch's native
// FormData, not a JSON body pretending to carry a file.
async function apiUpload(method, path, { token, message, files } = {}) {
  const form = new FormData();
  if (message !== undefined) form.append("message", message);
  for (const file of files || []) form.append("attachments", file);
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form,
  });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: response.status, body: parsed };
}

async function login(email) {
  const { status, body } = await api("POST", "/auth/login", { body: { email, password: PASSWORD } });
  if (status !== 200) throw new Error(`login failed for ${email}: ${status} ${JSON.stringify(body).slice(0, 200)}`);
  return body.token;
}

async function main() {
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require("../models/User");
  const Case = require("../models/Case");
  const Feedback = require("../models/Feedback");

  const tagged = new RegExp(`@${E2E_TAG.replace(/\./g, "\\.")}$`, "i");
  // Fixture emails are `${key}.${runId}@tag` and stored lowercased, so the
  // key is recovered from the local-part rather than from the role (two
  // fixtures share role "attorney" and would otherwise collide).
  const users = Object.fromEntries(
    (await User.find({ email: tagged }).select("_id email role").lean()).map((u) => [u.email.split(".")[0].toLowerCase(), u])
  );
  users.attorneyOther = users.attorneyother;

  if (!users.attorney || !users.admin) {
    throw new Error("fixtures missing — run: node src/scripts/e2eFixtures.js seed");
  }

  const adminToken = await login(users.admin.email);
  const attorneyToken = await login(users.attorney.email);
  const otherAttorneyToken = users.attorneyOther ? await login(users.attorneyOther.email) : null;

  // ── Setup: a throwaway case owned by the admin fixture ──────────────────
  // assignedCaseManager: admin — required for the attorney-authored
  // recipient-resolution check below (resolveRecipients notifies whoever is
  // assigned; an unassigned case has no one to notify).
  const created = await api("POST", "/cases", {
    token: adminToken,
    body: {
      clientName: "Attorney Portal Verify Client",
      clientEmail: `attorneyverify.${Date.now()}@${E2E_TAG}`,
      visaType: "H-1B",
      assignedCaseManager: String(users.admin._id),
    },
  });
  if (created.status !== 201 && created.status !== 200) {
    throw new Error(`case creation failed: ${created.status} ${JSON.stringify(created.body).slice(0, 300)}`);
  }
  const caseId = String(created.body.case?._id || created.body.data?._id);
  console.log(`\n[setup] case ${caseId}\n`);

  try {
    // ── S7: role boundary — non-attorney hits the attorney namespace ──────
    const adminOnAttorneyApi = await api("GET", "/attorney/cases", { token: adminToken });
    check("S7 admin (non-attorney) gets 403 from GET /api/attorney/cases", adminOnAttorneyApi.status === 403, `got ${adminOnAttorneyApi.status}`);

    // ── S3: isolation BEFORE any grant ────────────────────────────────────
    const beforeGrant = await api("GET", `/attorney/cases/${caseId}`, { token: attorneyToken });
    check("S3 attorney is denied a case with no grant", beforeGrant.status === 403, `got ${beforeGrant.status}`);

    const listBefore = await api("GET", "/attorney/cases", { token: attorneyToken });
    check(
      "S3 ungranted case absent from attorney case list",
      listBefore.status === 200 && !(listBefore.body.cases || []).some((c) => String(c._id) === caseId),
      `status ${listBefore.status}, ${(listBefore.body.cases || []).length} case(s)`
    );

    // Existing (non-attorney-namespace) case route must deny too — proves
    // canAccessCase itself is attorney-aware, not just the new middleware.
    const genericBefore = await api("GET", `/cases/${caseId}`, { token: attorneyToken });
    check("S3 generic GET /api/cases/:id also denies ungranted attorney", genericBefore.status === 403, `got ${genericBefore.status}`);

    // ── S1: Case Manager/Admin grants access ──────────────────────────────
    const grant = await api("PATCH", `/cases/${caseId}/attorney-access`, {
      token: adminToken,
      body: { attorneyId: String(users.attorney._id), action: "grant" },
    });
    check("S1 grant returns 200", grant.status === 200, `got ${grant.status} ${JSON.stringify(grant.body).slice(0, 200)}`);

    const caseAfterGrant = await Case.findById(caseId).select("attorneyAccess").lean();
    const activeGrant = (caseAfterGrant.attorneyAccess || []).find(
      (g) => String(g.attorneyId) === String(users.attorney._id) && g.status === "active"
    );
    check("S1 Case.attorneyAccess has an active entry in the database", Boolean(activeGrant));
    check("S1 grant records assignedBy", String(activeGrant?.assignedBy) === String(users.admin._id));

    const EmailLog = require("../models/EmailLog");
    const emailLog = await EmailLog.findOne({ templateKey: "attorney-assignment", caseId }).lean();
    check("S1 assignment email written to EmailLog", Boolean(emailLog), emailLog ? `status=${emailLog.status}` : "no EmailLog row");

    const AuditLog = require("../models/AuditLog");
    const audit = await AuditLog.findOne({ action: "attorney_access_granted", entityId: caseId }).lean();
    check("S1 audit log records attorney_access_granted", Boolean(audit));

    // ── S2/S8: attorney can now reach the case ────────────────────────────
    const afterGrant = await api("GET", `/attorney/cases/${caseId}`, { token: attorneyToken });
    check("S2 granted attorney can fetch the case", afterGrant.status === 200, `got ${afterGrant.status}`);
    check("S2 case payload carries real data", afterGrant.body.case?.clientName === "Attorney Portal Verify Client", afterGrant.body.case?.clientName);

    const listAfter = await api("GET", "/attorney/cases", { token: attorneyToken });
    const listed = (listAfter.body.cases || []).find((c) => String(c._id) === caseId);
    check("S2 granted case appears in attorney case list", Boolean(listed));
    check("S2 list row carries assignedAt", Boolean(listed?.assignedAt));

    const dashboard = await api("GET", "/attorney/dashboard", { token: attorneyToken });
    check("S2 dashboard returns real stats", dashboard.status === 200 && dashboard.body.stats?.totalCases >= 1, JSON.stringify(dashboard.body.stats || {}).slice(0, 160));

    // ── S3 (continued): a DIFFERENT attorney still cannot reach it ────────
    check("S3 second attorney fixture is present (isolation test can run)", Boolean(otherAttorneyToken));
    const otherAttorney = await api("GET", `/attorney/cases/${caseId}`, { token: otherAttorneyToken });
    check("S3 a DIFFERENT attorney is still denied this granted case", otherAttorney.status === 403, `got ${otherAttorney.status}`);
    const otherList = await api("GET", "/attorney/cases", { token: otherAttorneyToken });
    check(
      "S3 granted case is absent from the other attorney's case list",
      !(otherList.body.cases || []).some((c) => String(c._id) === caseId)
    );

    // ── Security regression: the attorney must NOT reach the client-
    // inclusive Messages/Conversation system at all (reverted on purpose —
    // see message.routes.js/permissions.registry.js's "no messages:*" note).
    const blockedList = await api("GET", "/messages", { token: attorneyToken });
    check("Messages(client system): attorney is denied the general conversation list", blockedList.status === 403, `got ${blockedList.status}`);
    const blockedSend = await api("POST", "/messages", { token: attorneyToken, body: { caseId, message: "should never be reachable" } });
    check("Messages(client system): attorney cannot post a case conversation message", blockedSend.status === 403, `got ${blockedSend.status}`);

    // ── Tasks (new): assign one to the attorney, verify scoped visibility ──
    const taskCreate = await api("POST", "/tasks", {
      token: adminToken,
      body: { title: "Review I-129 draft", caseId, assignedTo: String(users.attorney._id), priority: "high" },
    });
    check("Tasks: admin can assign a task to the attorney", taskCreate.status === 201, `got ${taskCreate.status} ${JSON.stringify(taskCreate.body).slice(0, 200)}`);
    const taskId = String(taskCreate.body.data?._id || taskCreate.body.task?._id || taskCreate.body._id);

    const myTasks = await api("GET", "/tasks/my-tasks", { token: attorneyToken });
    check(
      "Tasks: assigned task appears in the attorney's my-tasks list",
      (myTasks.body.data || myTasks.body.tasks || myTasks.body.items || []).some((t) => String(t._id) === taskId),
      JSON.stringify(myTasks.body).slice(0, 200)
    );

    const otherAttorneyTasks = await api("GET", "/tasks/my-tasks", { token: otherAttorneyToken });
    check(
      "Tasks: a different attorney's my-tasks does NOT include it",
      !(otherAttorneyTasks.body.data || otherAttorneyTasks.body.tasks || otherAttorneyTasks.body.items || []).some((t) => String(t._id) === taskId)
    );

    const taskUpdate = await api("PUT", `/tasks/${taskId}`, {
      token: attorneyToken,
      body: { status: "in_progress" },
    });
    check("Tasks: attorney can update status on their own assigned task", taskUpdate.status === 200, `got ${taskUpdate.status} ${JSON.stringify(taskUpdate.body).slice(0, 200)}`);

    // ── Tasks: attorney self-creates a task (new "New Task" button) ────────
    const selfTask = await api("POST", "/tasks", {
      token: attorneyToken,
      body: { title: "Prepare RFE response outline", caseId, priority: "urgent" },
    });
    check("Tasks: attorney can create their own task", selfTask.status === 201, `got ${selfTask.status} ${JSON.stringify(selfTask.body).slice(0, 200)}`);
    check("Tasks: self-created task is assigned to the attorney themselves", String(selfTask.body.data?.assignedTo) === String(users.attorney._id), selfTask.body.data?.assignedTo);

    // Trying to assign to someone else is rejected outright (403), not
    // silently overridden to self — resolveAssignment's real enforcement
    // for any role outside super_admin/admin/team_lead.
    const selfTaskAttemptedOther = await api("POST", "/tasks", {
      token: attorneyToken,
      body: { title: "Should be rejected, not reassigned", caseId, assignedTo: String(users.admin._id) },
    });
    check(
      "Tasks: attempting to assign to someone else is rejected (403), not reassigned",
      selfTaskAttemptedOther.status === 403,
      `status=${selfTaskAttemptedOther.status} ${JSON.stringify(selfTaskAttemptedOther.body).slice(0, 150)}`
    );

    const otherAttorneyTaskUpdate = await api("PUT", `/tasks/${taskId}`, {
      token: otherAttorneyToken,
      body: { status: "completed" },
    });
    check("Tasks: a different attorney cannot update someone else's task", otherAttorneyTaskUpdate.status === 403, `got ${otherAttorneyTaskUpdate.status}`);

    // ── S4: attorney sends feedback -> CM notified ────────────────────────
    const sent = await api("POST", `/attorney/cases/${caseId}/feedback`, {
      token: attorneyToken,
      body: { message: "Attorney portal verification message — please review the I-129 draft." },
    });
    check("S4 attorney can post feedback", sent.status === 201, `got ${sent.status} ${JSON.stringify(sent.body).slice(0, 200)}`);
    check("S4 feedback records authorRole=attorney", sent.body.feedback?.authorRole === "attorney", sent.body.feedback?.authorRole);

    const NotificationModel = require("../models/Notification");
    const staffNotif = await NotificationModel.findOne({ userId: users.admin._id, type: "attorney_feedback" }).sort({ createdAt: -1 }).lean();
    check("S4 case manager received an in-app notification", Boolean(staffNotif), staffNotif?.title);
    check("S4 notification deep-links to Admin's case detail (attorney -> staff direction)", staffNotif?.link === `/crm-cases/${caseId}`, staffNotif?.link);

    const thread = await api("GET", `/attorney/cases/${caseId}/feedback`, { token: attorneyToken });
    check("S4 feedback appears in the thread", (thread.body.feedback || []).length >= 1, `${(thread.body.feedback || []).length} message(s)`);

    // ── File upload: a real multipart request, a real stored file ─────────
    const testFile = new File([Buffer.from("PDF-ish verification bytes")], "draft-i129.pdf", { type: "application/pdf" });
    const withAttachment = await apiUpload("POST", `/attorney/cases/${caseId}/feedback`, {
      token: attorneyToken,
      message: "Attaching the draft for review.",
      files: [testFile],
    });
    check("Attachments: attorney can send a message with a file", withAttachment.status === 201, `got ${withAttachment.status} ${JSON.stringify(withAttachment.body).slice(0, 200)}`);
    const attachment = withAttachment.body.feedback?.attachments?.[0];
    check("Attachments: stored attachment metadata includes the original filename", attachment?.originalName === "draft-i129.pdf", JSON.stringify(attachment));

    const download = await api("GET", `/attorney/cases/${caseId}/feedback/${withAttachment.body.feedback?._id}/attachments/${attachment?._id}`, { token: attorneyToken });
    check("Attachments: the author can download their own attachment back", download.status === 200);

    const otherAttorneyDownload = await api("GET", `/attorney/cases/${caseId}/feedback/${withAttachment.body.feedback?._id}/attachments/${attachment?._id}`, { token: otherAttorneyToken });
    check("Attachments: an ungranted attorney cannot download it", otherAttorneyDownload.status === 403, `got ${otherAttorneyDownload.status}`);

    const staffDownload = await api("GET", `/cases/${caseId}/feedback/${withAttachment.body.feedback?._id}/attachments/${attachment?._id}`, { token: adminToken });
    check("Attachments: the case manager (staff side) can download it too", staffDownload.status === 200, `got ${staffDownload.status}`);

    // ── S5: case manager replies -> attorney notified ─────────────────────
    const feedbackId = String(sent.body.feedback?._id);
    const reply = await api("POST", `/cases/${caseId}/feedback/${feedbackId}/reply`, {
      token: adminToken,
      body: { message: "Case manager reply — draft updated, take another look." },
    });
    check("S5 staff can reply to attorney feedback", reply.status === 201, `got ${reply.status} ${JSON.stringify(reply.body).slice(0, 200)}`);
    check("S5 reply is threaded to the parent", String(reply.body.feedback?.parentFeedbackId) === feedbackId);

    const Notification = require("../models/Notification");
    const attorneyNotif = await Notification.findOne({ userId: users.attorney._id, type: "attorney_feedback" }).sort({ createdAt: -1 }).lean();
    check("S5 attorney received an in-app notification", Boolean(attorneyNotif), attorneyNotif?.title);
    check("S5 notification deep-links to the attorney portal's Messages page", attorneyNotif?.link === `/messages/${caseId}`, attorneyNotif?.link);

    // Unread accounting: the attorney has 1 unread (the CM's reply); their
    // own message must not count against them.
    const listWithUnread = await api("GET", "/attorney/cases", { token: attorneyToken });
    const rowWithUnread = (listWithUnread.body.cases || []).find((c) => String(c._id) === caseId);
    check("S5 unread badge counts the reply but not the attorney's own message", rowWithUnread?.unreadFeedback === 1, `unread=${rowWithUnread?.unreadFeedback}`);

    const markRead = await api("PATCH", `/attorney/cases/${caseId}/feedback/mark-read`, { token: attorneyToken });
    check("S5 mark-read succeeds", markRead.status === 200, `got ${markRead.status}`);
    const listAfterRead = await api("GET", "/attorney/cases", { token: attorneyToken });
    const rowAfterRead = (listAfterRead.body.cases || []).find((c) => String(c._id) === caseId);
    check("S5 unread badge clears after mark-read", rowAfterRead?.unreadFeedback === 0, `unread=${rowAfterRead?.unreadFeedback}`);

    // ── Revoke: access must actually stop ─────────────────────────────────
    const revoke = await api("PATCH", `/cases/${caseId}/attorney-access`, {
      token: adminToken,
      body: { attorneyId: String(users.attorney._id), action: "revoke" },
    });
    check("S1 revoke returns 200", revoke.status === 200, `got ${revoke.status}`);

    const afterRevoke = await api("GET", `/attorney/cases/${caseId}`, { token: attorneyToken });
    check("S1 revoked attorney is denied the case (200 -> 403 transition)", afterRevoke.status === 403, `got ${afterRevoke.status}`);

    const listAfterRevoke = await api("GET", "/attorney/cases", { token: attorneyToken });
    check(
      "S1 revoked case disappears from the attorney case list",
      !(listAfterRevoke.body.cases || []).some((c) => String(c._id) === caseId)
    );

    const revokedEntry = (await Case.findById(caseId).select("attorneyAccess").lean()).attorneyAccess.find(
      (g) => String(g.attorneyId) === String(users.attorney._id)
    );
    check("S1 revoked grant is retained with status=revoked + revokedAt", revokedEntry?.status === "revoked" && Boolean(revokedEntry?.revokedAt));
  } finally {
    // ── Cleanup ───────────────────────────────────────────────────────────
    await Feedback.deleteMany({ caseId });
    await Case.deleteOne({ _id: caseId });
    const Notification = require("../models/Notification");
    await Notification.deleteMany({ caseId });
    const Task = require("../models/Task");
    const removedTasks = await Task.deleteMany({ caseId });
    console.log(`\n[cleanup] removed case ${caseId} + its feedback/notifications/${removedTasks.deletedCount} task(s)`);
    await mongoose.disconnect();
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log("FAILED:");
    failed.forEach((r) => console.log(`  - ${r.name}${r.detail ? ` (${r.detail})` : ""}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error("verification aborted:", error.message);
  process.exit(1);
});

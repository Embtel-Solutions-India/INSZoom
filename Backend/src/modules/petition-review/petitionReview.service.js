// Petition review: the case manager releases an uploaded petition to the attorney(s) and/or to the client-side audience, the client reads it on the Petition page of the
// Client Portal and sends feedback, and the case manager answers - live in both portals.
//
//   attorney review -> the case's attorneys (active access grant) see it in the Attorney Portal and are e-mailed ("petition-attorney-review")
//   client review   -> ONLY the case's petition audience (single person / petitioner / employer, see petitionAudience.js) sees it and is e-mailed ("petition-client-review")
//   feedback thread -> between that audience and the case team; attorneys are not in it
//
// Every function throws an Error with .status for a refusal; side effects after the main write (e-mail, bell, live events) are best-effort and can never fail the request.
const { pickAudience, idOf } = require("./petitionAudience");
const { PETITION_DOCUMENT_TYPE, roleOf } = require("./petitionGate");

const MANAGER_ROLES = new Set(["super_admin", "admin", "team_lead", "case_manager"]);
const LATEST = 5; // messages shown under a petition row
const MAX_BODY = 4000;

const refuse = (status, message) => Object.assign(new Error(message), { status });
const name = (user) => user?.displayName || user?.name || user?.email || "";
const preview = (text) => (String(text).length > 100 ? `${String(text).slice(0, 100)}…` : String(text));

function createPetitionReviewService(deps = {}) {
  const data = deps.data || require("./petitionReview.data");
  const logger = deps.logger || require("../../utils/logger");
  const now = deps.now || (() => new Date());
  const emailService = () => deps.emailService || require("../email/email.service");
  const gateway = () => deps.gateway || require("../realtime/realtime.gateway");
  const canAccessCase = (user, caseData) => (deps.canAccessCase || require("../cases/case.service").canAccessCase)(user, caseData);
  const teamIds = (caseData) => (deps.teamIds || ((row) => [...require("../cases/caseManagerAccess").allCaseManagerIds(row), row.assignedTeamLead, row.primaryOwner]))(caseData).map(idOf).filter(Boolean);
  const portalUrl = (portal) => (deps.portalUrl || require("../email/portalUrls").portalUrl)(portal);
  const quietly = (label, fn) => Promise.resolve().then(fn).catch((error) => logger.error?.(label, { error: error?.message }));

  async function loadParent(caseData) {
    return caseData?.parentCase ? (await data.getCases([caseData.parentCase]))[0] || null : null;
  }

  async function audienceOf(caseData) {
    const picked = pickAudience(caseData, await loadParent(caseData));
    if (!picked) return null;
    const user = await data.getUser(picked.userId);
    return user && user.isActive !== false ? { ...picked, user } : null;
  }

  function assertManager(user, caseData) {
    if (!MANAGER_ROLES.has(roleOf(user)) || !canAccessCase(user, caseData)) throw refuse(403, "You do not have permission to manage this case's petition.");
  }

  async function loadPetition(caseId, documentId) {
    const [caseData, document] = await Promise.all([data.getCase(caseId), data.getDocument(documentId)]);
    if (!caseData) throw refuse(404, "Case not found.");
    if (!document || document.deletedAt || document.documentType !== PETITION_DOCUMENT_TYPE || idOf(document.caseId) !== idOf(caseData._id)) throw refuse(404, "This petition was not found on the case.");
    return { caseData, document };
  }

  const fileNameOf = (document) => document.originalName || document.originalFileName || document.fileName || "petition.pdf";
  const messageOut = (row) => ({ _id: String(row._id), documentId: String(row.documentId), side: row.side, authorId: idOf(row.authorId), authorName: row.authorName || "", body: row.body, createdAt: row.createdAt });
  const reviewOut = (part) => (part?.sentAt ? { sentAt: part.sentAt, count: part.count || 1 } : null);
  const caseLabel = (caseData) => caseData.caseNumber || caseData.caseId || String(caseData._id);

  function emit(userIds, event, payload) {
    try {
      new Set(userIds.map(idOf).filter(Boolean)).forEach((id) => gateway().emitToUser(id, event, payload));
    } catch (error) {
      logger.error?.("petition_review_emit_failed", { event, error: error?.message });
    }
  }

  async function bell(userId, author, { title, message, caseId, link, documentId, kind }) {
    return quietly("petition_review_bell_failed", () =>
      (deps.createNotification || require("../notifications/notification.service").createNotification)(
        { userId, type: kind === "message" ? "message" : "document", category: kind === "message" ? "message" : "document", title, message, caseId, link, priority: "high", channels: ["in_app", "socket"], metadata: { documentId: String(documentId), kind: "petition" }, source: "shared" },
        author
      )
    );
  }

  // ---------------------------------------------------------------- release
  async function sendForAttorneyReview({ caseId, documentId, actor, note = "", req }) {
    const { caseData, document } = await loadPetition(caseId, documentId);
    assertManager(actor, caseData);
    const grants = (caseData.attorneyAccess || []).filter((grant) => grant.status === "active" && grant.attorneyId);
    if (!grants.length) throw refuse(409, "No attorney has access to this case yet. Grant an attorney access first, then send the petition for attorney review.");
    const cleanNote = String(note || "").trim().slice(0, 2000);
    const review = await data.release(documentId, caseData._id, "attorneyReview", { sentBy: actor._id, note: cleanNote, at: now() });
    warm(document);

    // the same staff-only Feedback thread message the former single "Review by Attorney" button posted
    await quietly("petition_attorney_feedback_failed", () => (deps.createFeedback || ((args) => require("../feedback/feedback.service").createFeedback(args)))({
      caseId: caseData._id,
      author: actor,
      message: `The case manager has uploaded the petition for case ${caseLabel(caseData)}. Please review it and give your feedback.${cleanNote ? `\n\nNote: ${cleanNote}` : ""}`,
    }));

    let emailed = 0;
    for (const grant of grants) {
      const attorney = await data.getUser(grant.attorneyId);
      if (!attorney?.email || attorney.isActive === false) continue;
      const result = await quietly("petition_attorney_email_failed", () => emailService().sendTemplateEmail("petition-attorney-review", {
        to: attorney.email, recipientRole: "attorney", caseId: caseData._id, userId: attorney._id, source: "shared",
        data: { attorneyName: name(attorney), caseNumber: caseLabel(caseData), clientName: caseData.clientName || "", visaType: caseData.visaType || caseData.visaCategory || "", petitionName: fileNameOf(document), note: cleanNote },
      }));
      if (result?.sent) emailed += 1;
    }
    quietly("petition_live_update_failed", () => require("../realtime/caseLiveUpdates").notifyCaseDataChanged(caseData._id, "documents", { actor, reason: "petition_attorney_review" }));
    emit([...teamIds(caseData), ...grants.map((grant) => grant.attorneyId)], "petition:review", { caseId: String(caseData._id), documentId: String(documentId), stage: "attorney" });
    return { attorneysNotified: grants.length, emailed, attorneyReview: reviewOut(review.attorneyReview) };
  }

  async function sendForClientReview({ caseId, documentId, actor, note = "", req }) {
    const { caseData, document } = await loadPetition(caseId, documentId);
    assertManager(actor, caseData);
    const audience = await audienceOf(caseData);
    if (!audience) throw refuse(409, "This case has no client account that can receive the petition yet.");
    const cleanNote = String(note || "").trim().slice(0, 2000);
    const review = await data.release(documentId, caseData._id, "clientReview", { sentBy: actor._id, note: cleanNote, at: now() });
    warm(document);

    let emailed = false;
    if (audience.user.email) {
      const result = await quietly("petition_client_email_failed", () => emailService().sendTemplateEmail("petition-client-review", {
        to: audience.user.email, recipientRole: audience.user.role, caseId: caseData._id, userId: audience.user._id, source: "shared",
        data: { clientName: name(audience.user), caseNumber: caseLabel(caseData), petitionName: fileNameOf(document), note: cleanNote },
      }));
      emailed = Boolean(result?.sent);
    }
    bell(audience.user._id, actor, { title: "Your petition is ready for review", message: `Please review the petition for case ${caseLabel(caseData)} and share any changes you would like.`, caseId: caseData._id, link: "/dashboard/petition", documentId, kind: "review" });
    emit([audience.userId, ...teamIds(caseData)], "petition:review", { caseId: String(caseData._id), documentId: String(documentId), stage: "client" });
    return { audience: { role: audience.role, name: name(audience.user) }, emailed, clientReview: reviewOut(review.clientReview) };
  }

  // ---------------------------------------------------------------- listings
  async function summarise(documents, reviews, viewerId) {
    const ids = documents.map((document) => document._id);
    const [latest, totals, unread] = ids.length ? await Promise.all([data.recentMessages(ids, LATEST), data.countMessages(ids), data.countUnread(ids, viewerId)]) : [new Map(), new Map(), new Map()];
    const byDoc = new Map(reviews.map((review) => [String(review.documentId), review]));
    return documents.map((document) => {
      const key = String(document._id);
      const review = byDoc.get(key);
      return {
        documentId: key, caseId: idOf(document.caseId), fileName: fileNameOf(document), uploadedAt: document.createdAt,
        attorneyReview: reviewOut(review?.attorneyReview), clientReview: reviewOut(review?.clientReview), clientNote: review?.clientReview?.note || "",
        messages: { total: totals.get(key) || 0, unread: unread.get(key) || 0, latest: (latest.get(key) || []).map(messageOut) },
      };
    });
  }

  async function listForStaff({ caseId, user }) {
    const caseData = await data.getCase(caseId);
    if (!caseData) throw refuse(404, "Case not found.");
    assertManager(user, caseData);
    const documents = await data.listPetitionDocuments(caseData._id);
    const [reviews, audience] = await Promise.all([documents.length ? data.getReviews(documents.map((document) => document._id)) : [], audienceOf(caseData)]);
    const items = documents.length ? await summarise(documents, reviews, user._id) : [];
    return { audience: audience ? { role: audience.role, name: name(audience.user) } : null, attorneys: (caseData.attorneyAccess || []).filter((grant) => grant.status === "active").length, items };
  }

  async function listForClient({ user }) {
    const cases = await data.casesOfUser(user._id);
    if (!cases.length) return { items: [] };
    const parentIds = [...new Set(cases.map((row) => idOf(row.parentCase)).filter(Boolean))];
    const parents = new Map((parentIds.length ? await data.getCases(parentIds) : []).map((row) => [String(row._id), row]));
    const eligible = cases.filter((row) => pickAudience(row, row.parentCase ? parents.get(idOf(row.parentCase)) || null : null)?.userId === String(user._id));
    if (!eligible.length) return { items: [] };
    const caseById = new Map(eligible.map((row) => [String(row._id), row]));
    const released = await data.releasedToClientForCases(eligible.map((row) => row._id));
    const documents = (await Promise.all(released.map((review) => data.getDocument(review.documentId)))).filter((document) => document && !document.deletedAt && document.documentType === PETITION_DOCUMENT_TYPE);
    const items = await summarise(documents, released, user._id);
    return {
      items: items
        .map((item) => ({ ...item, caseNumber: caseLabel(caseById.get(item.caseId) || {}), attorneyReview: undefined }))
        .sort((a, b) => new Date(b.clientReview.sentAt) - new Date(a.clientReview.sentAt)),
    };
  }

  // ---------------------------------------------------------------- thread + file access
  async function authorizeThread(user, documentId) {
    const document = await data.getDocument(documentId);
    if (!document || document.deletedAt || document.documentType !== PETITION_DOCUMENT_TYPE) throw refuse(404, "This petition was not found.");
    const caseData = await data.getCase(document.caseId);
    if (!caseData) throw refuse(404, "This petition was not found.");
    const review = await data.getReview(documentId);
    if (MANAGER_ROLES.has(roleOf(user))) {
      if (!canAccessCase(user, caseData)) throw refuse(403, "You do not have permission to access this petition.");
      return { side: "staff", document, caseData, review };
    }
    const audience = pickAudience(caseData, await loadParent(caseData));
    if (audience && audience.userId === String(user._id) && review?.clientReview?.sentAt) return { side: "client", document, caseData, review, audience };
    throw refuse(404, "This petition was not found."); // not "forbidden": a person outside the audience learns nothing about it
  }

  async function readFile({ user, documentId }) {
    const { side, document } = await authorizeThread(user, documentId);
    if (side !== "client") throw refuse(403, "Staff open petitions from the case's Documents.");
    const buffer = await data.readDocumentBuffer(document);
    return { buffer, fileName: fileNameOf(document), mimeType: document.mimeType || document.fileType || "application/pdf" };
  }

  async function listMessages({ user, documentId, limit = 50, before }) {
    await authorizeThread(user, documentId);
    const cap = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100);
    const beforeDate = before ? new Date(before) : null;
    const rows = await data.listMessages(documentId, { limit: cap, before: beforeDate && !Number.isNaN(beforeDate.getTime()) ? beforeDate : null });
    return { messages: rows.map(messageOut), hasMore: rows.length === cap };
  }

  // The first time the client side gives feedback on a petition, the case manager(s) and the team lead of the case get ONE e-mail. Later messages are not e-mailed (they are in the
  // Petition tab and the bell). The atomic claim makes "first" true for one message even when two arrive together; nothing here can fail or delay the send.
  function announceFirstFeedback({ caseData, document, author, text }) {
    quietly("petition_first_feedback_email_failed", async () => {
      if (!(await data.claimFirstFeedbackNotice(document._id, now()))) return;
      for (const id of new Set(teamIds(caseData))) {
        if (id === String(author._id)) continue;
        const member = await data.getUser(id);
        if (!member?.email || member.isActive === false) continue;
        await quietly("petition_first_feedback_email_failed", () => emailService().sendTemplateEmail("petition-feedback-received", {
          to: member.email, recipientRole: member.role, caseId: caseData._id, userId: member._id, source: "shared",
          data: { recipientName: name(member), caseNumber: caseLabel(caseData), clientName: name(author), petitionName: fileNameOf(document), messagePreview: preview(text) },
        }));
      }
    });
  }

  async function postMessage({ user, documentId, body, clientMessageId = "" }) {
    const text = typeof body === "string" ? body.trim() : "";
    if (!text) throw refuse(400, "Write a message first.");
    if (text.length > MAX_BODY) throw refuse(400, `A message can be at most ${MAX_BODY} characters.`);
    const { side, caseData, document, audience: knownAudience, review } = await authorizeThread(user, documentId);
    if (side === "staff" && !review?.clientReview?.sentAt) throw refuse(409, "Send the petition for client review first; the client can then read and answer here.");
    const clean = String(clientMessageId || "").slice(0, 64);
    if (clean) {
      const existing = await data.findMessageByClientId(documentId, user._id, clean);
      if (existing) return { message: messageOut(existing), duplicate: true };
    }
    const row = await data.insertMessage({ caseId: caseData._id, documentId, authorId: user._id, authorName: name(user), side, body: text, clientMessageId: clean });
    const message = messageOut(row);
    if (side === "client") announceFirstFeedback({ caseData, document, author: user, text });
    const audience = knownAudience || pickAudience(caseData, await loadParent(caseData));
    const staffIds = teamIds(caseData);
    const audienceId = audience?.userId || "";
    emit([audienceId, ...staffIds], "petition:message", { caseId: String(caseData._id), documentId: String(documentId), message });
    // bell for the other end of the thread, never for the author, never blocking the send
    const targets = side === "client" ? staffIds : [audienceId];
    [...new Set(targets)].filter((id) => id && id !== String(user._id)).forEach((id) => bell(id, user, {
      title: name(user) || "Petition feedback", message: preview(text), caseId: caseData._id, documentId, kind: "message",
      link: side === "client" ? `/crm-cases/${caseData._id}` : "/dashboard/petition",
    }));
    return { message };
  }

  // ---------------------------------------------------------------- the viewer: a link the PDF viewer can load by URL, in byte ranges, from memory
  const viewToken = () => deps.viewToken || require("./petitionViewToken");
  const warm = (document) => quietly("petition_warm_failed", () => data.readDocumentBuffer(document));

  async function createViewLink({ user, documentId }) {
    const { side, document } = await authorizeThread(user, documentId);
    warm(document); // the slow part (storage read + decrypt) starts now, while the browser is still setting the viewer up
    return { token: viewToken().sign({ documentId, userId: user._id, side }), expiresInSeconds: viewToken().TTL_SECONDS };
  }

  // The token is only a pointer: who may look is decided again, now, on every request.
  async function resolveStream(token) {
    const payload = viewToken().verify(token);
    if (!payload) throw refuse(401, "This viewer link has expired. Please open the petition again.");
    const user = await data.getUser(payload.uid);
    if (!user || user.isActive === false) throw refuse(403, "This account cannot open the petition.");
    if (payload.side === "staff") {
      if (!MANAGER_ROLES.has(roleOf(user))) throw refuse(403, "This account cannot open the petition.");
      const document = await data.getDocument(payload.doc);
      if (!document || document.deletedAt || document.documentType !== PETITION_DOCUMENT_TYPE) throw refuse(404, "This petition was not found.");
      return { document };
    }
    const { side, document } = await authorizeThread({ ...user, _id: payload.uid }, payload.doc);
    if (side !== "client") throw refuse(403, "This account cannot open the petition.");
    return { document };
  }

  async function streamFile({ token }) {
    const { document } = await resolveStream(token);
    const buffer = await data.readDocumentBuffer(document);
    return { buffer, fileName: fileNameOf(document), mimeType: document.mimeType || document.fileType || "application/pdf", etag: `"${document._id}-${buffer.length}"` };
  }

  // Long-poll: answers as soon as the file is in memory, or after `waitMs` with { ready: false } so the viewer simply asks again - the person never sees a timeout.
  async function streamReady({ token, waitMs = 12000 }) {
    const { document } = await resolveStream(token);
    const loading = data.readDocumentBuffer(document).then(() => true);
    loading.catch(() => {});
    const outcome = await Promise.race([loading, new Promise((resolve) => setTimeout(() => resolve(false), waitMs))]);
    return { ready: outcome === true };
  }

  async function markRead({ user, documentId }) {
    await authorizeThread(user, documentId);
    await data.markRead(documentId, user._id);
    return { ok: true };
  }

  return { sendForAttorneyReview, sendForClientReview, listForStaff, listForClient, readFile, listMessages, postMessage, markRead, authorizeThread, audienceOf, createViewLink, streamFile, streamReady };
}

module.exports = { createPetitionReviewService, MANAGER_ROLES, LATEST, MAX_BODY };

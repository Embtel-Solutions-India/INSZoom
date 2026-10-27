// DB-free and network-free: who sees a petition, how it is released, and the feedback thread between the client-side audience and the case team.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { pickAudience } = require("../petitionAudience");
const gate = require("../petitionGate");
const { createRouter } = require("../petitionReview.routes");

// ---------------------------------------------------------------- fixtures
const { U, users, cases, PETITION, makeWorld } = require("./world");
const cm = users[U.cm];
const releaseToClient = (world, caseId, documentId) => world.service.sendForClientReview({ caseId, documentId, actor: cm });

// ---------------------------------------------------------------- who is the audience
test("the audience of a petition: the single person; the petitioner of a family case (never the beneficiary); the employer of an employer-employee case (never the employee)", () => {
  assert.deepEqual(pickAudience(cases.single), { role: "client", userId: U.client });
  assert.deepEqual(pickAudience(cases.family), { role: "petitioner", userId: U.petitioner });
  assert.equal(pickAudience({ ...cases.family, user: U.beneficiary, petitionerUser: U.petitioner }).userId, U.petitioner, "the petitioner even when the case owner field holds someone else");
  assert.deepEqual(pickAudience(cases.employerPrincipal), { role: "employer", userId: U.employer });
  assert.deepEqual(pickAudience(cases.employee, cases.employerPrincipal), { role: "employer", userId: U.employer }, "an employee's own case still goes to the employer, from the parent case");
  assert.notEqual(pickAudience(cases.employee, cases.employerPrincipal).userId, U.employee);
  assert.equal(pickAudience({ ...cases.family, petitionerUser: undefined, user: U.petitioner }).userId, U.petitioner, "family: falls back to the case owner, never to the beneficiary");
  assert.deepEqual(pickAudience({ _id: "legacy", user: U.client, employerUser: U.employer }), { role: "employer", userId: U.employer }, "a case from before case structures: an employer on it wins");
  assert.deepEqual(pickAudience({ _id: "legacy2", user: U.client }), { role: "client", userId: U.client });
  assert.equal(pickAudience({ _id: "empty", caseStructure: "family" }), null);
  assert.equal(pickAudience({}), null);
});

// ---------------------------------------------------------------- the gate on the Documents API
test("the Documents API gate: the team always sees a petition; an attorney only once it is sent (old petitions without a record stay visible); a client never", () => {
  assert.equal(gate.decide("case_manager", null), true);
  assert.equal(gate.decide("admin", { attorneyReview: {} }), true);
  assert.equal(gate.decide("attorney", null), true, "uploaded before this feature");
  assert.equal(gate.decide("attorney", { attorneyReview: { sentAt: null } }), false);
  assert.equal(gate.decide("attorney", { attorneyReview: { sentAt: new Date() } }), true);
  for (const role of ["client", "employer", "employee", "beneficiary", "petitioner", ""]) assert.equal(gate.decide(role, { clientReview: { sentAt: new Date() } }), false, role);
});

test("the gate lets every other kind of document through untouched, and hides petitions from client-like roles in lists", async () => {
  assert.equal(await gate.viewerMaySee({ role: "client" }, { documentType: "passport", _id: "x" }), true);
  assert.equal(await gate.viewerMaySee({ role: "client" }, { documentType: PETITION, _id: "x" }), false);
  assert.equal(await gate.viewerMaySee({ role: "case_manager" }, { documentType: PETITION, _id: "x" }), true);
  assert.equal(await gate.listCondition({ role: "admin" }, "c1"), null);
  assert.deepEqual(await gate.listCondition({ role: "client" }, "c1"), { documentType: { $ne: PETITION } });
  assert.deepEqual(await gate.listCondition({ role: "beneficiary" }), { documentType: { $ne: PETITION } });
});

test("the Documents API is wired to the gate (list filter, open/download guard, record created at upload)", () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, "..", "..", "documents", file), "utf8");
  assert.match(read("document.service.js"), /petitionGate"\)\.listCondition\(user, query\.caseId\)/);
  assert.match(read("document.service.js"), /petitionReview\.data"\)\.ensureReview\(document\._id/);
  assert.match(read("document.controller.js"), /petitionGate"\)\.viewerMaySee\(user, document\)/);
});

// ---------------------------------------------------------------- release to the attorney
test("attorney review: needs an active attorney; records the release; e-mails each active attorney (not a revoked one); posts the staff-only Feedback message; tells the live sessions", async () => {
  const world = makeWorld();
  const result = await world.service.sendForAttorneyReview({ caseId: "c-single", documentId: "d1", actor: cm, note: "Please check section 3" });
  assert.equal(result.attorneysNotified, 1);
  assert.equal(result.emailed, 1);
  assert.ok(world.reviews.get("d1").attorneyReview.sentAt);
  assert.equal(world.reviews.get("d1").clientReview.sentAt, undefined, "attorney review does not release it to the client");
  const [mail] = world.sent.emails;
  assert.equal(mail.key, "petition-attorney-review");
  assert.equal(mail.to, "alex@law.test");
  assert.equal(mail.recipientRole, "attorney");
  assert.equal(mail.data.petitionName, "Petition.pdf");
  assert.equal(mail.data.note, "Please check section 3");
  assert.match(mail.data.attorneyPortalUrl, /^https:\/\/attorney\.example\.test\/cases\/c-single$/);
  assert.match(world.sent.feedback[0].message, /Please review it and give your feedback\./);
  assert.ok(world.sent.events.some((event) => event.event === "petition:review" && event.id === U.attorney));

  const twoGrants = makeWorld();
  const r2 = await twoGrants.service.sendForAttorneyReview({ caseId: "c-emp-child", documentId: "d3", actor: cm });
  assert.equal(r2.attorneysNotified, 1, "the revoked grant is not an attorney with access");
  assert.deepEqual(twoGrants.sent.emails.map((m) => m.to), ["alex@law.test"]);
});

test("attorney review without any attorney on the case is refused with a clear message and records nothing", async () => {
  const world = makeWorld();
  await assert.rejects(world.service.sendForAttorneyReview({ caseId: "c-family", documentId: "d2", actor: cm }), (error) => error.status === 409 && /attorney/i.test(error.message));
  assert.equal(world.reviews.size, 0);
  assert.equal(world.sent.emails.length, 0);
});

// ---------------------------------------------------------------- release to the client
test("client review e-mails ONLY the audience: the single person; the petitioner (not the beneficiary); the employer (not the employee) - and never staff", async () => {
  for (const [caseId, documentId, expected] of [["c-single", "d1", "sam@x.test"], ["c-family", "d2", "pat@x.test"], ["c-emp-child", "d3", "erin@corp.test"]]) {
    const world = makeWorld();
    const result = await releaseToClient(world, caseId, documentId);
    assert.equal(result.emailed, true);
    assert.deepEqual(world.sent.emails.map((mail) => mail.to), [expected], caseId);
    assert.equal(world.sent.emails[0].key, "petition-client-review");
    assert.match(world.sent.emails[0].data.petitionLink, /^https:\/\/client\.example\.test\/dashboard\/petition$/);
    assert.equal(world.sent.bells.length, 1, "one bell notice, to the audience");
    assert.ok(world.reviews.get(documentId).clientReview.sentAt);
    assert.ok(!world.sent.emails.some((mail) => /cm@firm|alex@law|ben@x|eli@corp/.test(mail.to)));
  }
});

test("client review needs a client-side account on the case, and only a case manager (or above) with access to the case can send it", async () => {
  const world = makeWorld();
  cases.noParty = { _id: "c-none", caseStructure: "family", assignedCaseManager: U.cm };
  world.data.getCase = ((original) => async (id) => (String(id) === "c-none" ? cases.noParty : original(id)))(world.data.getCase);
  const documents = world.data.getDocument;
  world.data.getDocument = async (id) => (id === "dn" ? { _id: "dn", caseId: "c-none", documentType: PETITION } : documents(id));
  await assert.rejects(world.service.sendForClientReview({ caseId: "c-none", documentId: "dn", actor: cm }), (error) => error.status === 409);
  delete cases.noParty;
  await assert.rejects(world.service.sendForClientReview({ caseId: "c-single", documentId: "d1", actor: users[U.client] }), (error) => error.status === 403);
  await assert.rejects(world.service.sendForClientReview({ caseId: "c-single", documentId: "d2", actor: cm }), (error) => error.status === 404, "a petition of another case");
  await assert.rejects(world.service.sendForClientReview({ caseId: "c-single", documentId: "dx", actor: cm }), (error) => error.status === 404, "not a petition");
});

// ---------------------------------------------------------------- the client's Petition page
test("the client's list shows a petition only after client review, and only to the audience: not before, not to the beneficiary, the employee, or another client", async () => {
  const world = makeWorld();
  assert.deepEqual((await world.service.listForClient({ user: users[U.client] })).items, [], "nothing released yet");
  await releaseToClient(world, "c-single", "d1");
  const mine = await world.service.listForClient({ user: users[U.client] });
  assert.equal(mine.items.length, 1);
  assert.equal(mine.items[0].documentId, "d1");
  assert.equal(mine.items[0].fileName, "Petition.pdf");
  assert.equal(mine.items[0].caseNumber, "S-1");
  assert.equal("attorneyReview" in mine.items[0] && mine.items[0].attorneyReview !== undefined, false, "the client is not told about the attorney review");
  assert.deepEqual((await world.service.listForClient({ user: users[U.other] })).items, []);

  await releaseToClient(world, "c-family", "d2");
  assert.equal((await world.service.listForClient({ user: users[U.petitioner] })).items.length, 1);
  assert.equal((await world.service.listForClient({ user: users[U.beneficiary] })).items.length, 0, "the beneficiary never sees the family petition");

  await releaseToClient(world, "c-emp-child", "d3");
  const employer = await world.service.listForClient({ user: users[U.employer] });
  assert.equal(employer.items.length, 1);
  assert.equal(employer.items[0].documentId, "d3");
  assert.equal((await world.service.listForClient({ user: users[U.employee] })).items.length, 0, "the employee never sees the employer's petition");
});

test("the PDF is served only to the audience after release (404 otherwise - no hint it exists); staff open petitions from the case's Documents", async () => {
  const world = makeWorld();
  await assert.rejects(world.service.readFile({ user: users[U.client], documentId: "d1" }), (error) => error.status === 404, "before release");
  await releaseToClient(world, "c-single", "d1");
  const file = await world.service.readFile({ user: users[U.client], documentId: "d1" });
  assert.equal(file.buffer.toString(), "PDF of d1");
  assert.equal(file.fileName, "Petition.pdf");
  assert.equal(file.mimeType, "application/pdf");
  await assert.rejects(world.service.readFile({ user: users[U.other], documentId: "d1" }), (error) => error.status === 404);
  await assert.rejects(world.service.readFile({ user: users[U.beneficiary], documentId: "d2" }), (error) => error.status === 404);
  await assert.rejects(world.service.readFile({ user: users[U.attorney], documentId: "d1" }), (error) => error.status === 404, "attorneys are not part of the client's page");
  await assert.rejects(world.service.readFile({ user: users[U.client], documentId: "nope" }), (error) => error.status === 404);
});

// ---------------------------------------------------------------- the feedback thread
test("the client sends feedback: stored, shown live to the case team and the client's other tabs, a bell for the case manager only", async () => {
  const world = makeWorld();
  await releaseToClient(world, "c-single", "d1");
  world.sent.events.length = 0;
  world.sent.bells.length = 0;
  const { message } = await world.service.postMessage({ user: users[U.client], documentId: "d1", body: "  Please correct my middle name on page 2.  ", clientMessageId: "cm-1" });
  assert.equal(message.body, "Please correct my middle name on page 2.");
  assert.equal(message.side, "client");
  assert.equal(message.authorName, "Sam Single");
  const live = world.sent.events.filter((event) => event.event === "petition:message");
  assert.deepEqual(live.map((event) => event.id).sort(), [U.cm, U.client].sort());
  assert.equal(live[0].payload.message._id, message._id);
  assert.deepEqual(world.sent.bells.map((bell) => bell.userId), [U.cm]);
  assert.equal(world.sent.bells[0].channels.includes("push"), false);
  assert.equal(world.sent.emails.filter((mail) => /message/.test(mail.key)).length, 0, "no e-mail per feedback message");
});

test("a retried send is recognised and not posted twice; empty and oversized messages are refused", async () => {
  const world = makeWorld();
  await releaseToClient(world, "c-single", "d1");
  const first = await world.service.postMessage({ user: users[U.client], documentId: "d1", body: "Hello", clientMessageId: "same" });
  const again = await world.service.postMessage({ user: users[U.client], documentId: "d1", body: "Hello", clientMessageId: "same" });
  assert.equal(again.duplicate, true);
  assert.equal(again.message._id, first.message._id);
  assert.equal(world.messages.length, 1);
  await assert.rejects(world.service.postMessage({ user: users[U.client], documentId: "d1", body: "   " }), (error) => error.status === 400);
  await assert.rejects(world.service.postMessage({ user: users[U.client], documentId: "d1", body: "x".repeat(4001) }), (error) => error.status === 400);
  await assert.rejects(world.service.postMessage({ user: users[U.client], documentId: "d1", body: { $ne: "" } }), (error) => error.status === 400);
});

test("the case manager answers: only after the petition went to the client; the client gets a live message and a bell; an outsider can neither read nor write", async () => {
  const world = makeWorld();
  await assert.rejects(world.service.postMessage({ user: cm, documentId: "d1", body: "Hi" }), (error) => error.status === 409);
  await releaseToClient(world, "c-single", "d1");
  world.sent.events.length = 0;
  world.sent.bells.length = 0;
  const { message } = await world.service.postMessage({ user: cm, documentId: "d1", body: "Corrected, please check." });
  assert.equal(message.side, "staff");
  assert.ok(world.sent.events.some((event) => event.event === "petition:message" && event.id === U.client));
  assert.deepEqual(world.sent.bells.map((bell) => bell.userId), [U.client]);
  assert.equal(world.sent.bells[0].link, "/dashboard/petition");

  for (const outsider of [users[U.other], users[U.attorney], users[U.beneficiary]]) {
    await assert.rejects(world.service.postMessage({ user: outsider, documentId: "d1", body: "Hi" }), (error) => error.status === 404, outsider.role);
    await assert.rejects(world.service.listMessages({ user: outsider, documentId: "d1" }), (error) => error.status === 404, outsider.role);
  }
});

test("each petition row carries the latest five messages (oldest first), the total, and the viewer's unread count; reading clears it", async () => {
  const world = makeWorld();
  await releaseToClient(world, "c-single", "d1");
  for (let i = 1; i <= 7; i += 1) await world.service.postMessage({ user: i % 2 ? users[U.client] : cm, documentId: "d1", body: `message ${i}` });
  const staffView = (await world.service.listForStaff({ caseId: "c-single", user: cm })).items[0];
  assert.equal(staffView.messages.total, 7);
  assert.equal(staffView.messages.latest.length, 5);
  assert.deepEqual(staffView.messages.latest.map((m) => m.body), ["message 3", "message 4", "message 5", "message 6", "message 7"]);
  assert.equal(staffView.messages.unread, 4, "the four client messages the case manager has not read");
  assert.equal(staffView.clientReview.count, 1);
  assert.equal(staffView.attorneyReview, null);

  await world.service.markRead({ user: cm, documentId: "d1" });
  assert.equal((await world.service.listForStaff({ caseId: "c-single", user: cm })).items[0].messages.unread, 0);
  const clientView = (await world.service.listForClient({ user: users[U.client] })).items[0];
  assert.equal(clientView.messages.unread, 3, "the client has not read the case manager's three answers");
  const thread = await world.service.listMessages({ user: users[U.client], documentId: "d1", limit: 50 });
  assert.equal(thread.messages.length, 7);
  assert.equal(thread.messages[0].body, "message 1");
});

test("the staff list names the audience and shows the release state of every petition of the case", async () => {
  const world = makeWorld();
  assert.equal((await world.service.listForStaff({ caseId: "c-emp-child", user: cm })).audience.role, "employer");
  assert.equal((await world.service.listForStaff({ caseId: "c-family", user: cm })).audience.name, "Pat Petitioner");
  await world.service.sendForAttorneyReview({ caseId: "c-single", documentId: "d1", actor: cm });
  const listing = await world.service.listForStaff({ caseId: "c-single", user: cm });
  assert.equal(listing.items.length, 1, "only petition uploads, not the passport");
  assert.equal(listing.items[0].attorneyReview.count, 1);
  assert.equal(listing.items[0].clientReview, null);
  assert.equal(listing.attorneys, 1);
  await assert.rejects(world.service.listForStaff({ caseId: "c-single", user: users[U.client] }), (error) => error.status === 403);
});

// ---------------------------------------------------------------- first-feedback e-mail to the case team
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const feedbackMails = (world) => world.sent.emails.filter((mail) => mail.key === "petition-feedback-received");

test("the FIRST client feedback on a petition e-mails the case manager and the team lead of the case - once; later messages are not e-mailed", async () => {
  const world = makeWorld();
  await releaseToClient(world, "c-team", "d4");
  world.sent.emails.length = 0;
  const olive = users[U.other];

  await world.service.postMessage({ user: olive, documentId: "d4", body: "Please correct my business address on page 2." });
  await tick();
  const first = feedbackMails(world);
  assert.deepEqual(first.map((mail) => mail.to).sort(), ["cm@firm.test", "lead@firm.test"]);
  assert.equal(first[0].data.caseNumber, "T-1");
  assert.equal(first[0].data.clientName, "Olive Other");
  assert.equal(first[0].data.petitionName, "Team Petition.pdf");
  assert.equal(first[0].data.messagePreview, "Please correct my business address on page 2.");
  assert.match(first[0].data.caseLink, /^https:\/\/admin\.example\.test\/crm-cases\/c-team$/);
  assert.ok(first.every((mail) => mail.recipientRole === "case_manager" || mail.recipientRole === "team_lead"));

  await world.service.postMessage({ user: olive, documentId: "d4", body: "Also the date of incorporation." });
  await world.service.postMessage({ user: olive, documentId: "d4", body: "And the phone number." });
  await tick();
  assert.equal(feedbackMails(world).length, 2, "still only the two e-mails of the first message");
});

test("two feedback messages arriving together still send one round of e-mails; the case manager's own replies and the client's e-mail never trigger it", async () => {
  const world = makeWorld();
  await releaseToClient(world, "c-team", "d4");
  world.sent.emails.length = 0;
  await world.service.postMessage({ user: cm, documentId: "d4", body: "Welcome - tell me what to change." });
  await tick();
  assert.equal(feedbackMails(world).length, 0, "a staff message is not client feedback");

  const olive = users[U.other];
  await Promise.all([
    world.service.postMessage({ user: olive, documentId: "d4", body: "one" }),
    world.service.postMessage({ user: olive, documentId: "d4", body: "two" }),
  ]);
  await tick();
  assert.equal(feedbackMails(world).length, 2);
  assert.ok(!feedbackMails(world).some((mail) => mail.to === "o@x.test"), "the client is never told about their own message");
});

test("each petition has its own first time; a failing e-mail never fails the client's message", async () => {
  const world = makeWorld();
  await releaseToClient(world, "c-team", "d4");
  await releaseToClient(world, "c-single", "d1");
  world.sent.emails.length = 0;
  await world.service.postMessage({ user: users[U.other], documentId: "d4", body: "feedback on the team petition" });
  await tick();
  assert.equal(feedbackMails(world).length, 2);
  await world.service.postMessage({ user: users[U.client], documentId: "d1", body: "feedback on the other petition" });
  await tick();
  assert.equal(feedbackMails(world).length, 3, "the single case has only its case manager: a new first time, one more e-mail");

  const broken = makeWorld();
  await releaseToClient(broken, "c-team", "d4");
  const originalSend = broken.sent.emails.push.bind(broken.sent.emails);
  void originalSend;
  broken.data.claimFirstFeedbackNotice = async () => { throw new Error("database hiccup"); };
  const result = await broken.service.postMessage({ user: users[U.other], documentId: "d4", body: "this must still be saved" });
  await tick();
  assert.equal(result.message.body, "this must still be saved");
  assert.equal(broken.messages.length, 1);
});

test("the first-feedback e-mail is registered (template, audience, policy, trigger) and reads professionally with the client's words escaped", () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, "..", "..", "email", file), "utf8");
  assert.match(read("email.service.js"), /"petition-feedback-received": require\("\.\/templates\/petition-feedback-received"\)/);
  assert.match(read("email.service.js"), /"petition-feedback-received": "team_member"/);
  assert.match(read("emailPolicy.js"), /"petition-feedback-received": \{ when:/);
  assert.match(read("emailTriggers.registry.js"), /t\("petition-feedback-received"/);
  const template = require("../../email/templates/petition-feedback-received");
  const html = template.bodyLines({ recipientName: "Casey", caseNumber: "T-1", clientName: "Olive", petitionName: "P.pdf", messagePreview: "Fix <script>x</script>", caseLink: "https://admin.example.test/crm-cases/c1" }).join("\n");
  assert.match(template.subject({ caseNumber: "T-1" }), /Client feedback received on the petition — T-1/);
  assert.match(html, /Hello Casey,/);
  assert.match(html, /href="https:\/\/admin\.example\.test\/crm-cases\/c1"/);
  assert.match(html, /further messages are not e-mailed/);
  assert.doesNotMatch(html, /<script>|undefined|\[object/);
});

// ---------------------------------------------------------------- HTTP layer
async function withApp(service, guard, fn) {
  const app = express();
  app.use(express.json());
  app.use("/api/petition-review", createRouter({ service, guard }));
  app.use((error, req, res, next) => res.status(500).json({ success: false, message: error.message })); // eslint-disable-line no-unused-vars
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}/api/petition-review`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
const as = (user) => [(req, res, next) => { req.user = user; next(); }];

test("HTTP: every endpoint needs a signed-in user", async () => {
  await withApp({}, undefined, async (base) => {
    for (const [method, route] of [["GET", "/cases/c1"], ["POST", "/cases/c1/documents/d1/client-review"], ["GET", "/client/petitions"], ["GET", "/client/petitions/d1/file"], ["GET", "/documents/d1/messages"], ["POST", "/documents/d1/messages"]]) {
      const response = await fetch(`${base}${route}`, { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? "{}" : undefined });
      assert.equal(response.status, 401, `${method} ${route}`);
    }
  });
});

test("HTTP: release actions are for case managers and above; a client gets 403 before the service is even called", async () => {
  const calls = [];
  const service = { sendForClientReview: async (args) => { calls.push(args); return { emailed: true }; }, listForStaff: async () => ({ items: [] }) };
  await withApp(service, as({ _id: "u1", role: "client" }), async (base) => {
    assert.equal((await fetch(`${base}/cases/c1`)).status, 403);
    assert.equal((await fetch(`${base}/cases/c1/documents/d1/client-review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 403);
  });
  assert.equal(calls.length, 0);
  await withApp(service, as({ _id: "u2", role: "case_manager" }), async (base) => {
    const response = await fetch(`${base}/cases/c1/documents/d1/client-review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: "hello" }) });
    assert.equal(response.status, 201);
    assert.deepEqual({ caseId: calls[0].caseId, documentId: calls[0].documentId, note: calls[0].note }, { caseId: "c1", documentId: "d1", note: "hello" });
  });
});

test("HTTP: refusals keep their status and message; the file endpoint sends the PDF inline or as a download, never cached", async () => {
  const service = {
    readFile: async ({ documentId }) => {
      if (documentId === "missing") throw Object.assign(new Error("This petition was not found."), { status: 404 });
      return { buffer: Buffer.from("%PDF-1.4 test"), fileName: "My Petition.pdf", mimeType: "application/pdf" };
    },
    postMessage: async () => { throw Object.assign(new Error("Write a message first."), { status: 400 }); },
    listForClient: async () => ({ items: [{ documentId: "d1" }] }),
  };
  await withApp(service, as({ _id: "u1", role: "client" }), async (base) => {
    const missing = await fetch(`${base}/client/petitions/missing/file`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).message, "This petition was not found.");
    const inline = await fetch(`${base}/client/petitions/d1/file`);
    assert.equal(inline.status, 200);
    assert.equal(inline.headers.get("content-type"), "application/pdf");
    assert.match(inline.headers.get("content-disposition"), /^inline;/);
    assert.equal(inline.headers.get("cache-control"), "private, no-store");
    assert.equal(await inline.text(), "%PDF-1.4 test");
    assert.match((await fetch(`${base}/client/petitions/d1/file?download=1`)).headers.get("content-disposition"), /^attachment;/);
    const bad = await fetch(`${base}/documents/d1/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: "" }) });
    assert.equal(bad.status, 400);
    assert.equal((await (await fetch(`${base}/client/petitions`)).json()).data.items[0].documentId, "d1");
  });
});

// ---------------------------------------------------------------- the e-mails
test("the two new e-mails are registered everywhere an e-mail must be: template, audience, client-only rule, policy and trigger catalog", () => {
  const email = (file) => fs.readFileSync(path.join(__dirname, "..", "..", "email", file), "utf8");
  const service = email("email.service.js");
  for (const key of ["petition-client-review", "petition-attorney-review"]) {
    assert.match(service, new RegExp(`"${key}": require\\("./templates/${key}"\\)`), `${key} template`);
    assert.match(email("emailPolicy.js"), new RegExp(`"${key}": \\{ when:`), `${key} policy`);
    assert.match(email("emailTriggers.registry.js"), new RegExp(`t\\("${key}"`), `${key} trigger`);
  }
  assert.match(service, /CLIENT_ONLY_TEMPLATES = new Set\(\[[^\]]*"petition-client-review"/, "never copied to staff");
  assert.match(service, /"petition-client-review": "client"/);
  assert.match(service, /"petition-attorney-review": "attorney"/);
});

test("the e-mail texts: professional, name the case and the petition, carry the link, and escape the case manager's note", () => {
  const client = require("../../email/templates/petition-client-review");
  const attorney = require("../../email/templates/petition-attorney-review");
  const clientData = { clientName: "Sam", caseNumber: "S-1", petitionName: "Petition.pdf", note: "Check <b>page 2</b>\nThanks", petitionLink: "https://client.example.test/dashboard/petition" };
  const clientHtml = client.bodyLines(clientData).join("\n");
  assert.match(client.subject(clientData), /Your petition is ready for your review — S-1/);
  assert.match(clientHtml, /Hi Sam,/);
  assert.match(clientHtml, /Petition\.pdf/);
  assert.match(clientHtml, /href="https:\/\/client\.example\.test\/dashboard\/petition"/);
  assert.match(clientHtml, /Check &lt;b>page 2&lt;\/b>\s*<br\/>Thanks/, "note is escaped, line break kept");
  assert.doesNotMatch(clientHtml, /<b>page 2/);
  const attorneyData = { attorneyName: "Alex", caseNumber: "S-1", clientName: "Sam Single", visaType: "H-1B", petitionName: "Petition.pdf", attorneyPortalUrl: "https://attorney.example.test/cases/c1" };
  const attorneyHtml = attorney.bodyLines(attorneyData).join("\n");
  assert.match(attorney.subject(attorneyData), /Petition ready for your review — S-1/);
  assert.match(attorneyHtml, /Hello Alex,/);
  assert.match(attorneyHtml, /Sam Single/);
  assert.match(attorneyHtml, /href="https:\/\/attorney\.example\.test\/cases\/c1"/);
  assert.doesNotMatch(attorneyHtml, /undefined|\[object/);
  assert.doesNotMatch(clientHtml, /undefined|\[object/);
});

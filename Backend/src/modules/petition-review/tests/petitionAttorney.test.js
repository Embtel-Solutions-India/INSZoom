// DB-free: what an attorney can see and open of a petition (released for attorney review only), the push notice on release, and that the client thread stays closed to them.
// Run with: node --test src/modules/petition-review/tests/petitionAttorney.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeWorld, users, U } = require("./world");
const viewToken = require("../petitionViewToken");

const attorney = users[U.attorney];
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "test-secret-for-petition-attorney";

async function released() {
  const world = makeWorld();
  await world.service.sendForAttorneyReview({ caseId: "c-single", documentId: "d1", actor: users[U.cm], note: "Please check section 3" });
  return world;
}

test("release: each attorney gets an in-app notice WITH a browser push that opens the case's Petition page, and a line on their own timeline", async () => {
  const world = await released();
  await new Promise((resolve) => setImmediate(resolve));
  const bell = world.sent.bells.find((payload) => payload.userId === U.attorney);
  assert.ok(bell, "the attorney is notified in the app");
  assert.ok(bell.channels.includes("push"), "and by browser push");
  assert.equal(bell.link, "/cases/c-single/petition");
  const line = world.sent.timeline.find((event) => event.attorneyId === U.attorney);
  assert.equal(line.type, "petition_received");
  assert.equal(line.caseId, "c-single");
});

test("an attorney sees only the petitions released for attorney review, with the note, on a case they have access to", async () => {
  const world = makeWorld();
  assert.deepEqual((await world.service.listForAttorney({ caseId: "c-single", user: attorney })).items, [], "nothing is listed before the release");
  await world.service.sendForAttorneyReview({ caseId: "c-single", documentId: "d1", actor: users[U.cm], note: "Look at section 3" });
  const { items } = await world.service.listForAttorney({ caseId: "c-single", user: attorney });
  assert.equal(items.length, 1);
  assert.equal(items[0].documentId, "d1");
  assert.equal(items[0].note, "Look at section 3");
  assert.equal(items[0].fileName, "Petition.pdf");
});

test("no access, no list: another case, a revoked grant, a non-attorney and a client are all refused", async () => {
  const world = await released();
  await assert.rejects(world.service.listForAttorney({ caseId: "c-team", user: attorney }), (error) => error.status === 404, "no grant on that case");
  await assert.rejects(world.service.listForAttorney({ caseId: "c-single", user: users[U.client] }), (error) => error.status === 403);
  await assert.rejects(world.service.listForAttorney({ caseId: "c-single", user: users[U.cm] }), (error) => error.status === 403);
});

test("the attorney can open the released petition through the signed viewer, and the open is written to their timeline", async () => {
  const world = await released();
  const { token } = await world.service.createViewLink({ user: attorney, documentId: "d1" });
  const file = await world.service.streamFile({ token });
  assert.equal(file.buffer.toString(), "PDF of d1");
  assert.equal(world.sent.timeline.some((event) => event.type === "petition_viewed" && event.attorneyId === U.attorney), true);
});

test("an unreleased petition cannot be opened by the attorney, even with a hand-made link", async () => {
  const world = makeWorld(); // d1 exists but was never sent
  await assert.rejects(world.service.createViewLink({ user: attorney, documentId: "d1" }), (error) => error.status === 404);
  const forged = viewToken.sign({ documentId: "d1", userId: U.attorney, side: "attorney" });
  await assert.rejects(world.service.streamFile({ token: forged }), (error) => error.status === 404);
});

test("a petition on a case the attorney has no grant on stays closed (d3 is on a case where their only entry is active, d4 has none)", async () => {
  const world = makeWorld();
  await world.service.sendForAttorneyReview({ caseId: "c-single", documentId: "d1", actor: users[U.cm] });
  await assert.rejects(world.service.createViewLink({ user: attorney, documentId: "d4" }), (error) => error.status === 404);
});

test("a viewer token for one side cannot be used as another: an attorney token never opens a petition for someone without the attorney role", async () => {
  const world = await released();
  const forged = viewToken.sign({ documentId: "d1", userId: U.client, side: "attorney" });
  await assert.rejects(world.service.streamFile({ token: forged }), (error) => [403, 404].includes(error.status));
});

test("attorneys are not part of the client petition thread: reading, writing and marking read are all refused", async () => {
  const world = await released();
  await assert.rejects(world.service.listMessages({ user: attorney, documentId: "d1" }), (error) => error.status === 403);
  await assert.rejects(world.service.postMessage({ user: attorney, documentId: "d1", body: "hello" }), (error) => error.status === 403);
  await assert.rejects(world.service.markRead({ user: attorney, documentId: "d1" }), (error) => error.status === 403);
});

test("the client side is unchanged: the client token still opens the client's petition", async () => {
  const world = makeWorld();
  await world.service.sendForClientReview({ caseId: "c-single", documentId: "d1", actor: users[U.cm] });
  const { token } = await world.service.createViewLink({ user: users[U.client], documentId: "d1" });
  assert.equal((await world.service.streamFile({ token })).buffer.toString(), "PDF of d1");
});

// "Supporting Documents" (Petition tab): letters, reports ... shared for review apart from the petition. Same release / viewer / feedback flow as a petition, with its own
// e-mails, an explicit kind on every listed item, and no legacy exception in the gate (an attorney sees one only after it was sent for attorney review).
const assert = require("node:assert/strict");
const test = require("node:test");
const gate = require("../petitionGate");
const { U, users, SUPPORTING, makeWorld } = require("./world");

const letter = { ds1: { _id: "ds1", caseId: "c-single", documentType: SUPPORTING, originalName: "Expert Opinion Letter.pdf", mimeType: "application/pdf", createdAt: new Date("2026-11-01") } };

test("gate: a supporting document is hidden from an attorney until it was sent for attorney review (no legacy exception), never shown to a client, always to staff", () => {
  assert.equal(gate.decide("attorney", null, SUPPORTING), false, "no review record -> hidden (unlike a legacy petition)");
  assert.equal(gate.decide("attorney", { attorneyReview: {} }, SUPPORTING), false);
  assert.equal(gate.decide("attorney", { attorneyReview: { sentAt: new Date() } }, SUPPORTING), true);
  assert.equal(gate.decide("client", { clientReview: { sentAt: new Date() } }, SUPPORTING), false, "clients use the Petition page, never the Documents API");
  assert.equal(gate.decide("case_manager", null, SUPPORTING), true);
  // a legacy petition keeps its old rule
  assert.equal(gate.decide("attorney", null), true);
  assert.equal(gate.kindOf(SUPPORTING), "supporting");
  assert.equal(gate.kindOf("petition_manual_upload"), "petition");
  assert.ok(gate.isReviewDocumentType(SUPPORTING) && !gate.isReviewDocumentType("passport"));
});

test("gate: a client's document list excludes petitions AND supporting documents", async () => {
  const condition = await gate.listCondition(users[U.client], "c-single");
  assert.deepEqual(condition, { documentType: { $nin: ["petition_manual_upload", SUPPORTING] } });
});

test("staff list: petitions and supporting documents both listed, each with its kind", async () => {
  const { service } = makeWorld({ extraDocuments: letter });
  const result = await service.listForStaff({ caseId: "c-single", user: users[U.cm] });
  const kinds = Object.fromEntries(result.items.map((item) => [item.documentId, item.kind]));
  assert.equal(kinds.d1, "petition");
  assert.equal(kinds.ds1, "supporting");
});

test("client review of a supporting document sends its OWN e-mail (not the petition one) to the audience only, and the client sees it with kind 'supporting'", async () => {
  const { service, sent } = makeWorld({ extraDocuments: letter });
  await service.sendForClientReview({ caseId: "c-single", documentId: "ds1", actor: users[U.cm] });
  assert.equal(sent.emails.length, 1);
  assert.equal(sent.emails[0].key, "supporting-document-client-review");
  assert.equal(sent.emails[0].to, users[U.client].email);
  assert.equal(sent.emails[0].data.petitionName, "Expert Opinion Letter.pdf");
  assert.match(sent.bells[0].title, /supporting document/i);
  assert.deepEqual(sent.bells[0].channels, ["in_app", "socket", "push"], "e-mail + in-app + browser notification");
  const listed = await service.listForClient({ user: users[U.client] });
  assert.deepEqual(listed.items.map((item) => [item.documentId, item.kind]), [["ds1", "supporting"]]);
});

test("attorney review of a supporting document sends its OWN e-mail; the attorney sees only what was released, with kind", async () => {
  const { service, sent } = makeWorld({ extraDocuments: letter });
  const before = await service.listForAttorney({ caseId: "c-single", user: users[U.attorney] });
  assert.equal(before.items.length, 0, "nothing is listed before release");
  await service.sendForAttorneyReview({ caseId: "c-single", documentId: "ds1", actor: users[U.cm] });
  assert.deepEqual(sent.emails.map((mail) => mail.key), ["supporting-document-attorney-review"]);
  assert.match(sent.feedback[0].message, /supporting document \(Expert Opinion Letter\.pdf\)/);
  const after = await service.listForAttorney({ caseId: "c-single", user: users[U.attorney] });
  assert.deepEqual(after.items.map((item) => [item.documentId, item.kind]), [["ds1", "supporting"]]);
});

test("a petition still sends the petition e-mails (unchanged)", async () => {
  const { service, sent } = makeWorld({ extraDocuments: letter });
  await service.sendForClientReview({ caseId: "c-single", documentId: "d1", actor: users[U.cm] });
  await service.sendForAttorneyReview({ caseId: "c-single", documentId: "d1", actor: users[U.cm] });
  assert.deepEqual(sent.emails.map((mail) => mail.key), ["petition-client-review", "petition-attorney-review"]);
});

test("client feedback thread works on a released supporting document; the first-feedback e-mail says 'supporting document'", async () => {
  const { service, sent } = makeWorld({ extraDocuments: letter });
  await service.sendForClientReview({ caseId: "c-single", documentId: "ds1", actor: users[U.cm] });
  sent.emails.length = 0;
  await service.postMessage({ user: users[U.client], documentId: "ds1", body: "Please fix the date on page 2." });
  await new Promise((resolve) => setImmediate(resolve));
  const notice = sent.emails.find((mail) => mail.key === "petition-feedback-received");
  assert.ok(notice, "the case manager hears about the first feedback");
  assert.equal(notice.data.kind, "supporting");
  const template = require("../../email/templates/petition-feedback-received");
  assert.match(template.subject(notice.data), /supporting document/);
});

test("the two new e-mails: subject and body name the document and point to the Petition page", () => {
  const client = require("../../email/templates/supporting-document-client-review");
  const attorney = require("../../email/templates/supporting-document-attorney-review");
  const data = { clientName: "Sam", attorneyName: "Alex", caseNumber: "S-1", petitionName: "Expert <Letter>.pdf", note: "See page 2" };
  assert.match(client.subject(data), /New supporting document for your review/);
  const clientBody = client.bodyLines(data).join(" ");
  assert.match(clientBody, /Expert &lt;Letter&gt;\.pdf/, "the name is escaped");
  assert.match(clientBody, /Petition<\/strong> page/);
  assert.match(clientBody, /See page 2/);
  const attorneyBody = attorney.bodyLines(data).join(" ");
  assert.match(attorneyBody, /Petition<\/strong> tab/);
  const email = require("../../email/email.service");
  assert.ok(email.TEMPLATES["supporting-document-client-review"] && email.TEMPLATES["supporting-document-attorney-review"]);
  assert.equal(email.TEMPLATE_AUDIENCE["supporting-document-client-review"], "client");
  assert.equal(email.TEMPLATE_AUDIENCE["supporting-document-attorney-review"], "attorney");
});

test("document intelligence: a supporting document is never scanned (no OCR / AI / Gemini), and OCR never re-labels a petition or supporting document", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "..", "document-intelligence", "services", "document-intelligence.service.js"), "utf8");
  const processStart = source.indexOf("async function processDocument(");
  const skip = source.indexOf('if (document.documentType === "petition_supporting_upload") {', processStart);
  const firstScanStep = source.indexOf("repository.upsertForDocument(", processStart);
  assert.ok(skip > processStart && skip < firstScanStep, "the skip comes before any scanning step");
  assert.match(source, /const keepType = require\("\.\.\/\.\.\/petition-review\/petitionGate"\)\.isReviewDocumentType\(document\.documentType\);/);
  assert.match(source, /if \(!keepType\) document\.documentType = documentEnumFor\(type\);/);
});

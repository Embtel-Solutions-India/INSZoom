// The golden-set review against the LOCAL throwaway test database (src/test-utils/pipelineDb.js refuses anything else; skipped when no local MongoDB answers).
// A small synthetic draft is used, never the real one, so nothing here depends on or touches real data.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { useTestDatabase } = require("../../../test-utils/pipelineDb");
const GoldenSetReview = require("../../../models/GoldenSetReview");
const GoldenSetSignOff = require("../../../models/GoldenSetSignOff");
const { createGoldenSetService, reviewerEmails } = require("../golden/GoldenSetService");

const db = useTestDatabase({ before: test.before, after: test.after }, [GoldenSetReview, GoldenSetSignOff]);
test.beforeEach(async () => {
  if (db.ok) await Promise.all([GoldenSetReview.deleteMany({}), GoldenSetSignOff.deleteMany({})]); // the database is a throwaway one of this process
});

const entry = (n, over = {}) => ({ id: `e${n}`, ref: `I-130 #${n}`, formCode: "I-130", formName: "Petition", familyLabel: "Family-based", heldOut: false, where: "Part 1", boxLabel: `Box ${n}`, boxKind: "text", belongsTo: "Sponsor (petitioner)", fillsWith: "the sponsor's first (given) name", writtenAs: "", onlyWhen: "", ifEmpty: "", appearsTimes: 1, example: { clientData: "Daniel", boxShows: "Daniel" }, sentence: `s${n}`, contentHash: `h${n}`, technical: { sourcePath: "petitioner.firstName" }, ...over });
const makeDraft = (entries) => ({ title: "t", note: "n", entries, entriesChecksum: `sum-${entries.length}-${entries.map((e) => e.contentHash).join("")}` });
const reviewer = { _id: new mongoose.Types.ObjectId(), email: "Admin@Immiglance.com" };
const someoneElse = { _id: new mongoose.Types.ObjectId(), email: "staff@immiglance.com" };
// the plan's bar is tested with the real function elsewhere; here a service whose bar is trivially met is enough for the sign-off flow
const service = (entries, extra = {}) => createGoldenSetService({ draft: makeDraft(entries), reviewers: () => ["admin@immiglance.com"], ...extra });

test("the reviewer defaults to admin@immiglance.com and is configurable", () => {
  assert.deepEqual(reviewerEmails({}), ["admin@immiglance.com"]);
  assert.deepEqual(reviewerEmails({ GOLDEN_SET_REVIEWERS: "A@x.com, b@y.com" }), ["a@x.com", "b@y.com"]);
});

test("only the named reviewer can answer; the email match ignores case", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const svc = service([entry(1)]);
  await assert.rejects(svc.setReview("e1", { verdict: "right" }, someoneElse), (error) => error.status === 403 && error.code === "NOT_THE_REVIEWER");
  const saved = await svc.setReview("e1", { verdict: "right" }, reviewer);
  assert.equal(saved.review.verdict, "right");
  assert.equal(saved.review.reviewerEmail, "admin@immiglance.com");
  assert.equal(saved.technical, undefined);
});

test("validation: unknown entry, bad verdict, a Wrong answer needs a reason and what it should be (or blank)", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const svc = service([entry(1)]);
  await assert.rejects(svc.setReview("nope", { verdict: "right" }, reviewer), (error) => error.status === 404);
  await assert.rejects(svc.setReview("e1", { verdict: "maybe" }, reviewer), (error) => error.code === "BAD_VERDICT");
  await assert.rejects(svc.setReview("e1", { verdict: "wrong", correction: "the last name" }, reviewer), (error) => error.code === "REASON_REQUIRED");
  await assert.rejects(svc.setReview("e1", { verdict: "wrong", reason: "wrong person" }, reviewer), (error) => error.code === "CORRECTION_REQUIRED");
  const wrong = await svc.setReview("e1", { verdict: "wrong", reason: "this is the worker's box", correction: "the sponsor's last name" }, reviewer);
  assert.equal(wrong.review.reason, "this is the worker's box");
  assert.equal(wrong.review.correction, "the sponsor's last name");
  const blank = await svc.setReview("e1", { verdict: "wrong", reason: "USCIS says leave empty", shouldBeBlank: true, correction: "ignored" }, reviewer);
  assert.equal(blank.review.shouldBeBlank, true);
  assert.equal(blank.review.correction, "");
  const back = await svc.setReview("e1", { verdict: "right", reason: "ignored", correction: "ignored", shouldBeBlank: true }, reviewer);
  assert.deepEqual([back.review.reason, back.review.correction, back.review.shouldBeBlank], ["", "", false]);
  assert.equal(await GoldenSetReview.countDocuments({ entryId: "e1" }), 1); // changing your mind updates, never duplicates
});

test("progress counts, filters and plain-language-only output", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const svc = service([entry(1), entry(2), entry(3, { formCode: "I-131", heldOut: true })]);
  await svc.setReview("e1", { verdict: "right" }, reviewer);
  await svc.setReview("e2", { verdict: "unsure" }, reviewer);
  const summary = await svc.summary(reviewer);
  assert.deepEqual(summary.counts, { right: 1, wrong: 0, unsure: 1, blank: 0, unanswered: 1 });
  assert.equal(summary.you.canReview, true);
  assert.equal((await svc.summary(someoneElse)).you.canReview, false);
  assert.equal(summary.perForm.find((form) => form.formCode === "I-130").answered, 2);
  assert.equal((await svc.list({ status: "unanswered" })).entries[0].id, "e3");
  assert.equal((await svc.list({ formCode: "i-130" })).total, 2);
  assert.equal((await svc.list({ search: "Box 2" })).total, 1);
  assert.ok((await svc.list({})).entries.every((row) => row.technical === undefined));
});

test("sign-off needs every box answered, no 'Not sure', and the plan's bar; then it is recorded once with a checksum", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const entries = [entry(1), entry(2)];
  const svc = service(entries);
  await assert.rejects(svc.signOff(someoneElse, { confirm: true }), (error) => error.status === 403);
  await assert.rejects(svc.signOff(reviewer, {}), (error) => error.code === "CONFIRM_REQUIRED");
  await assert.rejects(svc.signOff(reviewer, { confirm: true }), (error) => error.code === "NOT_READY" && /no answer yet/.test(error.message));
  await svc.setReview("e1", { verdict: "right" }, reviewer);
  await svc.setReview("e2", { verdict: "unsure" }, reviewer);
  await assert.rejects(svc.signOff(reviewer, { confirm: true }), (error) => /Not sure/.test(error.message));
  await svc.setReview("e2", { verdict: "right" }, reviewer);
  // two entries can never meet the real plan minimum (300 entries, 25 of each kind...), so the sign-off is refused for that reason even when everything is answered
  await assert.rejects(svc.signOff(reviewer, { confirm: true }), (error) => error.code === "NOT_READY" && /minimum/.test(error.message));
});

test("with the plan's bar met, sign-off is recorded and goes out of date when the draft changes", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const kinds = ["text", "date", "checkbox", "dropdown"];
  const forms = [["I-129", "employment"], ["I-140", "employment"], ["I-907", "employment"], ["I-130", "family"], ["I-129F", "family"], ["I-485", "family"], ["I-765", "single"], ["I-131", "single"], ["I-90", "single"]];
  const { SCOPE } = require("../golden/buildDraft");
  const entries = [];
  for (let n = 0; n < 320; n += 1) {
    const [formCode] = forms[n % forms.length];
    entries.push(entry(n, { id: `big${n}`, formCode, family: SCOPE[formCode].family, boxKind: kinds[n % 4], heldOut: formCode === "I-131" }));
  }
  const svc = createGoldenSetService({ draft: makeDraft(entries), reviewers: () => ["admin@immiglance.com"] });
  for (const row of entries) await svc.setReview(row.id, { verdict: "right" }, reviewer);
  const before = await svc.summary(reviewer);
  assert.equal(before.canSignOff, true, before.blockers.join("; "));
  const done = await svc.signOff(reviewer, { confirm: true });
  assert.equal(done.counts.right, 320);
  assert.equal((await svc.summary(reviewer)).signOff.upToDate, true);
  // the same answers against a draft whose entry was reworded: that answer no longer counts and the sign-off is out of date
  const changed = entries.map((row, index) => (index === 0 ? { ...row, contentHash: "different" } : row));
  const svc2 = createGoldenSetService({ draft: makeDraft(changed), reviewers: () => ["admin@immiglance.com"] });
  const after = await svc2.summary(reviewer);
  assert.equal(after.staleAnswers, 1);
  assert.equal(after.counts.unanswered, 1);
  assert.equal(after.signOff.upToDate, false);
  assert.equal(after.canSignOff, false);
});

test("export has the answers in words and no technical details", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const svc = service([entry(1), entry(2)]);
  await svc.setReview("e1", { verdict: "wrong", reason: "wrong person", correction: "the last name", note: "see page 2" }, reviewer);
  const rows = await svc.exportRows();
  assert.equal(rows[0].verdictLabel, "Wrong");
  assert.equal(rows[0].correction, "the last name");
  assert.equal(rows[0].reason, "wrong person");
  assert.equal(rows[1].verdictLabel, "");
  assert.ok(rows.every((row) => row.technical === undefined));
});

test("Keep blank is a verified answer that needs a reason: counts as answered, is filtered and exported in words, and does not block sign-off", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const svc = service([entry(1), entry(2)]);
  await assert.rejects(svc.setReview("e1", { verdict: "blank" }, reviewer), (error) => error.code === "REASON_REQUIRED");
  const saved = await svc.setReview("e1", { verdict: "blank", reason: "USCIS says leave this empty" }, reviewer);
  assert.equal(saved.review.verdict, "blank");
  assert.equal(saved.review.reason, "USCIS says leave this empty");
  await svc.setReview("e2", { verdict: "right" }, reviewer);
  const summary = await svc.summary(reviewer);
  assert.deepEqual(summary.counts, { right: 1, wrong: 0, unsure: 0, blank: 1, unanswered: 0 });
  assert.equal(summary.verified.total, 2); // both are verified answers
  assert.equal((await svc.list({ status: "blank" })).total, 1);
  const rows = await svc.exportRows();
  assert.deepEqual([rows[0].verdictLabel, rows[0].reason], ["Keep blank", "USCIS says leave this empty"]);
  const back = await svc.setReview("e1", { verdict: "wrong", reason: "no, fill it", correction: "the name" }, reviewer);
  assert.equal(back.review.verdict, "wrong");
});

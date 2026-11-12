// The held-email queue can address someone other than the person whose activation releases it (an employer's copy of an employee's submitted e-mail waits for the EMPLOYEE to activate). DB-free.
const assert = require("node:assert/strict");
const test = require("node:test");
const deferred = require("../deferredEmail.service");
const DeferredEmail = require("../../../models/DeferredEmail");

test("the queue can address someone other than the person whose activation releases it, and the two copies never collapse into one", async () => {
  const created = [];
  const original = { findOne: DeferredEmail.findOne, create: DeferredEmail.create };
  DeferredEmail.findOne = () => ({ select: () => ({ lean: async () => null }) });
  DeferredEmail.create = async (doc) => { created.push(doc); return { _id: "d1" }; };
  try {
    await deferred.enqueue({ user: { _id: "employee1", email: "employee@acmeclients.com" }, to: "employer@acmeclients.com", templateKey: "case-submitted-client", data: { a: 1 }, caseId: "c1", event: "case_submitted" });
    await deferred.enqueue({ user: { _id: "employee1", email: "employee@acmeclients.com" }, templateKey: "case-submitted-client", data: { a: 1 }, caseId: "c1", event: "case_submitted" });
  } finally {
    DeferredEmail.findOne = original.findOne;
    DeferredEmail.create = original.create;
  }
  assert.deepEqual(created.map((row) => [String(row.userId), row.to]), [["employee1", "employer@acmeclients.com"], ["employee1", "employee@acmeclients.com"]]);
  assert.notEqual(created[0].dedupeKey, created[1].dedupeKey);
});

const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const mongoose = require("mongoose");
const Case = require("../../../models/Case");
const Questionnaire = require("../../../models/Questionnaire");
const caseService = require("../case.service");
const workflowService = require("../case.workflow.service");
const questionnaireService = require("../../questionnaires/questionnaire.service");
const paymentService = require("../../payments/payment.service");
const paymentGateway = require("../../payments/payment.gateway");
const caseController = require("../case.controller");

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test("requestDocuments pushes new items into both checklistItems and documentChecklist, and dedups by documentType", async (t) => {
  t.after(() => mock.restoreAll());
  const caseData = {
    _id: new mongoose.Types.ObjectId(),
    documentChecklist: [{ name: "Existing Passport", documentType: "passport" }],
    checklistItems: [{ name: "Existing Passport", documentType: "passport" }],
    save: async () => {},
  };
  mock.method(Case, "findById", async () => caseData);
  mock.method(caseService, "canAccessCase", () => true);
  mock.method(caseService, "writeAuditLog", async () => {});
  mock.method(workflowService, "documentsRequested", async () => {});

  const res = fakeRes();
  await caseController.requestDocuments(
    {
      params: { id: caseData._id.toString() },
      body: { requiredDocuments: [{ name: "Passport copy", documentType: "passport" }, { name: "Marriage Certificate", documentType: "marriage_certificate" }] },
      user: { _id: new mongoose.Types.ObjectId(), role: "case_manager" },
    },
    res,
    (err) => { throw err; }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(caseData.documentChecklist.length, 2, "the passport re-request must be deduped; only marriage_certificate is new");
  assert.equal(caseData.checklistItems.length, 2, "checklistItems must receive the same new item, not diverge from documentChecklist");
  assert.ok(caseData.checklistItems.some((item) => item.documentType === "marriage_certificate"));
  assert.equal(caseData.checklistItems.filter((item) => item.documentType === "passport").length, 1);
});

test("requestDocuments deduping is called twice with the same document and does not duplicate it", async (t) => {
  t.after(() => mock.restoreAll());
  const caseData = { _id: new mongoose.Types.ObjectId(), documentChecklist: [], checklistItems: [], save: async () => {} };
  mock.method(Case, "findById", async () => caseData);
  mock.method(caseService, "canAccessCase", () => true);
  mock.method(caseService, "writeAuditLog", async () => {});
  mock.method(workflowService, "documentsRequested", async () => {});

  const body = { requiredDocuments: [{ name: "Employment Letter", documentType: "employment_letter" }] };
  const user = { _id: new mongoose.Types.ObjectId(), role: "case_manager" };

  await caseController.requestDocuments({ params: { id: caseData._id.toString() }, body, user }, fakeRes(), (err) => { throw err; });
  await caseController.requestDocuments({ params: { id: caseData._id.toString() }, body, user }, fakeRes(), (err) => { throw err; });

  assert.equal(caseData.documentChecklist.length, 1, "requesting the same document twice must not duplicate it");
  assert.equal(caseData.checklistItems.length, 1);
});

test("purchaseAddon (Premium Processing) dedups its required documents against an item already present under a different name, and dual-pushes the rest", async (t) => {
  t.after(() => mock.restoreAll());
  const caseData = {
    _id: new mongoose.Types.ObjectId(),
    petitionType: "H-1B",
    uscisReceiptNumber: "WAC1234567890",
    addons: [],
    // Simulates a G-28 already present under a different name from another writer.
    checklistItems: [{ name: "Attorney Notice of Entry of Appearance", documentType: "g_28" }],
    documentChecklist: [{ name: "Attorney Notice of Entry of Appearance", documentType: "g_28" }],
    questionnaireReferences: [],
    save: async () => {},
  };
  mock.method(Case, "findById", async () => caseData);
  mock.method(caseService, "canAccessCase", () => true);
  mock.method(caseService, "writeAuditLog", async () => {});
  mock.method(questionnaireService, "ensureDefaultVisaTemplates", async () => []);
  mock.method(Questionnaire, "findOne", () => ({ sort: async () => null }));
  mock.method(paymentService, "createPayment", async () => ({ _id: new mongoose.Types.ObjectId() }));
  mock.method(paymentService, "createPendingTransaction", async () => ({ _id: new mongoose.Types.ObjectId() }));
  mock.method(paymentService, "attachCheckoutSession", async () => {});
  mock.method(paymentGateway, "createCheckoutSession", async () => ({ url: "https://example.test/checkout", sessionId: "sess_1", disabled: false }));

  const res = fakeRes();
  await caseController.purchaseAddon(
    { params: { id: caseData._id.toString(), addonKey: "premium_processing_i907" }, body: {}, user: { _id: new mongoose.Types.ObjectId(), role: "case_manager" } },
    res,
    (err) => { throw err; }
  );

  assert.equal(res.statusCode, 201, res.body && JSON.stringify(res.body));
  // requiredDocuments are i_797_receipt_notice, g_28 (already present under a
  // different name), and authorization_letter - only the two new ones should
  // have been added, and into BOTH arrays.
  assert.equal(caseData.checklistItems.filter((item) => item.documentType === "g_28").length, 1, "g_28 must not be duplicated despite the differing name");
  assert.ok(caseData.checklistItems.some((item) => item.documentType === "i_797_receipt_notice"));
  assert.ok(caseData.checklistItems.some((item) => item.documentType === "authorization_letter"));
  assert.equal(caseData.checklistItems.length, caseData.documentChecklist.length, "checklistItems and documentChecklist must stay mirrored");
});

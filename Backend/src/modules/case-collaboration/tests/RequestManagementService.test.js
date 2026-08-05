const assert = require("node:assert/strict");
const test = require("node:test");
const RequestManagementService = require("../services/RequestManagementService");

test("RequestManagementService creates document checklist requests", () => {
  const caseData = { documentChecklist: [], checklistItems: [], timeline: [], auditHistory: [] };
  const request = RequestManagementService.createRequest(caseData, { name: "Passport Copy", documentType: "passport", dueDate: "2027-01-01" }, { _id: "u1" });
  assert.equal(request.name, "Passport Copy");
  assert.equal(request.status, "requested");
  assert.equal(caseData.documentChecklist.length, 1);
  assert.equal(caseData.checklistItems.length, 1);
});

test("RequestManagementService closes matching request when document arrives", () => {
  const caseData = { documentChecklist: [{ name: "Passport", documentType: "passport", status: "requested", uploadedFiles: [] }] };
  const result = RequestManagementService.completeByDocument(caseData, { _id: "d1", documentType: "passport", originalName: "passport.pdf" });
  assert.equal(result.status, "uploaded");
  assert.equal(result.uploadedFiles.length, 1);
});

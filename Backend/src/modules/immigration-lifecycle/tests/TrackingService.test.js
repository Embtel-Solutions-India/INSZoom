const test = require("node:test");
const assert = require("node:assert/strict");
const Case = require("../../../models/Case");
const routes = require("../routes/lifecycleRoutes");
const TrackingService = require("../services/TrackingService");

test("case schema stores enterprise USCIS filing and RFE tracking", () => {
  for (const path of [
    "immigrationLifecycle.tracking.status",
    "immigrationLifecycle.tracking.filing.receiptNumber",
    "immigrationLifecycle.tracking.filing.filingAttorney",
    "immigrationLifecycle.tracking.filing.filingFeeCents",
    "immigrationLifecycle.tracking.rfe.responseDueDate",
    "immigrationLifecycle.tracking.rfe.documentReferences",
    "immigrationLifecycle.tracking.rfe.aiSummary",
  ]) {
    assert.ok(Case.schema.path(path), `missing tracking path ${path}`);
  }
});

test("tracking lifecycle supports every government processing state", () => {
  for (const status of [
    "draft", "ready_to_file", "filed", "delivered", "receipt_issued",
    "biometrics_scheduled", "biometrics_completed", "interview_scheduled",
    "interview_completed", "rfe_issued", "rfe_response_submitted",
    "transferred", "approved", "denied", "withdrawn", "closed",
  ]) {
    assert.ok(TrackingService.STATUS_TO_LIFECYCLE[status], `missing lifecycle mapping for ${status}`);
  }
});

test("tracking APIs provide read and atomic save operations", () => {
  const registered = routes.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods).join(",").toUpperCase()} ${layer.route.path}`);
  assert.ok(registered.includes("GET /cases/:caseId/tracking"));
  assert.ok(registered.includes("PUT /cases/:caseId/tracking"));
});

test("tracking rejects malformed government data before persistence", () => {
  assert.throws(
    () => TrackingService.validatePayload({ status: "unknown" }),
    (error) => error.status === 422 && error.code === "INVALID_USCIS_TRACKING"
  );
  assert.throws(
    () => TrackingService.validatePayload({ filing: { receiptNumber: "invalid" } }),
    (error) => error.status === 422
  );
  assert.doesNotThrow(() => TrackingService.validatePayload({
    status: "receipt_issued",
    filing: { receiptNumber: "IOE1234567890", filingMethod: "online", carrier: "" },
    rfe: { responseStatus: "" },
  }));
});

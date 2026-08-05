const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const router = require("../case.routes");
const CaseAssignmentEvent = require("../../../models/CaseAssignmentEvent");

function routes() {
  return router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));
}

function roleMiddleware(method, path) {
  const route = router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method])?.route;
  assert.ok(route, `${method.toUpperCase()} ${path} route is missing`);
  return route.stack[1].handle;
}

function runAuthorization(middleware, role) {
  let nextCalled = false;
  let responseStatus;
  const response = {
    status(status) {
      responseStatus = status;
      return this;
    },
    json() {
      return this;
    },
  };
  middleware({ user: { role } }, response, () => {
    nextCalled = true;
  });
  return { nextCalled, responseStatus };
}

test("reassignment: POST /:id/reassign and GET /:id/assignment-history are registered", () => {
  const registered = routes();
  assert.ok(registered.includes("POST /:id/reassign"), "POST /:id/reassign is missing");
  assert.ok(registered.includes("GET /:id/assignment-history"), "GET /:id/assignment-history is missing");
});

test("reassignment: /:id/reassign is restricted to admins and team leads, same as the existing assign-case-manager route", () => {
  const authorize = roleMiddleware("get", "/:id/assignment-history");
  assert.equal(runAuthorization(authorize, "case_manager").nextCalled, true);
  assert.equal(runAuthorization(authorize, "client").responseStatus, 403);

  const reassignAuthorize = roleMiddleware("post", "/:id/reassign");
  assert.equal(runAuthorization(reassignAuthorize, "case_manager").responseStatus, 403);
  assert.equal(runAuthorization(reassignAuthorize, "team_lead").nextCalled, true);
  assert.equal(runAuthorization(reassignAuthorize, "admin").nextCalled, true);
  assert.equal(runAuthorization(reassignAuthorize, "super_admin").nextCalled, true);
});

test("reassignment: CaseAssignmentEvent requires caseId/role/toManagerId/reassignedById", () => {
  const missingEverything = new CaseAssignmentEvent({});
  const validationError = missingEverything.validateSync();
  assert.ok(validationError, "an empty CaseAssignmentEvent should fail validation");
  ["caseId", "role", "toManagerId", "reassignedById"].forEach((field) => {
    assert.ok(validationError.errors[field], `${field} should be required`);
  });

  const complete = new CaseAssignmentEvent({
    caseId: new mongoose.Types.ObjectId(),
    role: "case_manager",
    toManagerId: new mongoose.Types.ObjectId(),
    reassignedById: new mongoose.Types.ObjectId(),
  });
  assert.equal(complete.validateSync(), undefined, "a fully-populated event should pass validation");
  assert.equal(complete.fromManagerId, null, "fromManagerId defaults to null (first-ever assignment, not a reassignment)");
});

test("reassignment: CaseAssignmentEvent rejects the role enum outside the four assignable slots", () => {
  const event = new CaseAssignmentEvent({
    caseId: new mongoose.Types.ObjectId(),
    role: "attorney",
    toManagerId: new mongoose.Types.ObjectId(),
    reassignedById: new mongoose.Types.ObjectId(),
  });
  const validationError = event.validateSync();
  assert.ok(validationError?.errors?.role, "an unrecognized role slot should fail validation");
});

test("reassignment: CaseAssignmentEvent is append-only — saving an existing (non-new) document is rejected before any DB write", async () => {
  const event = new CaseAssignmentEvent({
    caseId: new mongoose.Types.ObjectId(),
    role: "case_manager",
    toManagerId: new mongoose.Types.ObjectId(),
    reassignedById: new mongoose.Types.ObjectId(),
  });
  event.isNew = false;
  await assert.rejects(() => event.save(), /immutable/i);
});

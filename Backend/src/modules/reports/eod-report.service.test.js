const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const EODReport = require("../../models/EODReport");
const {
  eodVisibilityFilter,
  manualReportPayload,
  isIstWeekend,
  startOfIstDay,
} = require("./report.service");

const id = () => new mongoose.Types.ObjectId();

test("manual EOD reports always use the authenticated staff identity and role", () => {
  const staffId = id();
  const teamId = id();
  const payload = manualReportPayload({
    staff: id(),
    role: "case_manager",
    casesWorked: "4",
    casesClosed: "",
    documentsReviewed: 2,
    messagesReplied: 7,
    pendingTasks: 3,
  }, {
    _id: staffId,
    role: "team_lead",
    teamId,
    department: "legal",
  });

  assert.equal(payload.staff, staffId);
  assert.equal(payload.role, "team_lead");
  assert.equal(payload.teamId, teamId);
  assert.equal(payload.casesWorked, 4);
  assert.equal(payload.casesClosed, 0);
  assert.equal(payload.source, "manual");
});

test("staff EOD visibility is restricted to the authenticated employee", async () => {
  const staffId = id();
  const filter = await eodVisibilityFilter({ staff: id(), role: "team_lead" }, {
    _id: staffId,
    role: "case_manager",
  });
  assert.equal(filter.staff, staffId);
  assert.equal(filter.role, undefined);
});

test("administrators may filter all staff EOD reports", async () => {
  const staffId = id();
  const filter = await eodVisibilityFilter({ staff: staffId, role: "case_manager" }, {
    _id: id(),
    role: "admin",
  });
  assert.equal(filter.staff, staffId);
  assert.equal(filter.role, "case_manager");
});

test("EOD dates normalize to midnight in India Standard Time", () => {
  assert.equal(
    startOfIstDay("2026-07-03T18:00:00.000Z").toISOString(),
    "2026-07-02T18:30:00.000Z"
  );
});

test("EOD schema prevents duplicate daily staff reports and tracks generation source", () => {
  const uniqueDailyIndex = EODReport.schema.indexes().find(([fields, options]) =>
    fields.staff === 1 && fields.date === -1 && options.unique === true
  );
  assert.ok(uniqueDailyIndex);
  assert.deepEqual(EODReport.schema.path("source").enumValues, ["manual", "automatic"]);
});

test("team leads see every case manager's reports plus their own", async () => {
  const leadId = id();
  const filter = await eodVisibilityFilter({}, { _id: leadId, role: "team_lead" });
  assert.deepEqual(filter.$or, [{ staff: leadId }, { role: "case_manager" }]);
});

test("Saturday and Sunday are weekends on the IST calendar", () => {
  assert.equal(isIstWeekend("2026-10-09T18:30:00.000Z"), true); // Sat 00:00 IST
  assert.equal(isIstWeekend("2026-10-10T18:30:00.000Z"), true); // Sun 00:00 IST
  assert.equal(isIstWeekend("2026-10-11T18:30:00.000Z"), false); // Mon 00:00 IST
  assert.equal(isIstWeekend("2026-10-09T18:00:00.000Z"), false); // Fri 23:30 IST
});

const assert = require("node:assert/strict");
const test = require("node:test");
const routingService = require("../routing.service");
const Settings = require("../../../models/Settings");
const Lead = require("../../../models/Lead");
const Appointment = require("../../../models/Appointment");
const StrategyCallQueueItem = require("../../../models/StrategyCallQueueItem");

// routing.service is DB-backed throughout (Settings/Lead/Appointment/
// StrategyCallQueueItem), so these tests mock the model layer with
// node:test's built-in `t.mock.method` (auto-restored per test) rather than
// requiring a live Mongo connection — matching this repo's established
// no-DB test convention. The full real-DB flow (roster resolution,
// capacity caps, actual booking, email/telemetry side effects) is covered
// by live verification against the running dev backend — see the Phase 1
// report.

function fakeQuerySelect(value) {
  return { select: () => Promise.resolve(value) };
}

test("resolveConsultant: returns null (never throws) when no roster is configured", async (t) => {
  t.mock.method(Settings, "findOne", () => fakeQuerySelect({ consultationRouting: [] }));
  const consultantId = await routingService.resolveConsultant("O-1A", "English");
  assert.equal(consultantId, null);
});

test("resolveConsultant: matches on visa pathway + language and respects capacity", async (t) => {
  t.mock.method(Settings, "findOne", () => fakeQuerySelect({
    consultationRouting: [
      { userId: "consultant1", visaPathways: ["EB-1A"], languages: ["English"], dailyCapacityCap: 8 },
      { userId: "consultant2", visaPathways: ["O-1A"], languages: ["English", "Hindi"], dailyCapacityCap: 2 },
    ],
  }));
  t.mock.method(Appointment, "countDocuments", async ({ assignedTo }) => (assignedTo === "consultant2" ? 0 : 99));
  const consultantId = await routingService.resolveConsultant("O-1A", "English");
  assert.equal(consultantId, "consultant2", "should skip consultant1 (wrong visa pathway) and match consultant2");
});

test("resolveConsultant: skips a matching consultant who is already at their daily capacity cap", async (t) => {
  t.mock.method(Settings, "findOne", () => fakeQuerySelect({
    consultationRouting: [{ userId: "consultant1", visaPathways: ["O-1A"], languages: ["English"], dailyCapacityCap: 2 }],
  }));
  t.mock.method(Appointment, "countDocuments", async () => 2); // already at cap
  const consultantId = await routingService.resolveConsultant("O-1A", "English");
  assert.equal(consultantId, null);
});

test("getOptions: a direct-priority lead with no roster configured falls back to the strategy queue, flagged", async (t) => {
  const lead = {
    _id: "lead1",
    visaPathway: "O-1A",
    scoreResult: { tier: "A", routing: "direct_priority" },
    strategyQueueId: null,
    save: async () => {},
  };
  t.mock.method(Lead, "findById", async () => lead);
  t.mock.method(Settings, "findOne", () => fakeQuerySelect({ consultationRouting: [] }));
  t.mock.method(StrategyCallQueueItem, "create", async (data) => ({ _id: "queue1", ...data }));

  const options = await routingService.getOptions("lead1");
  assert.equal(options.mode, "strategy_queue");
  assert.equal(options.rosterConfigured, false);
  assert.equal(options.priority, true);
});

test("getOptions: a nurture (Tier D) lead always goes to the strategy queue, regardless of roster", async (t) => {
  const lead = {
    _id: "lead2",
    visaPathway: "O-1A",
    scoreResult: { tier: "D", routing: "nurture" },
    strategyQueueId: null,
    save: async () => {},
  };
  t.mock.method(Lead, "findById", async () => lead);
  t.mock.method(StrategyCallQueueItem, "create", async (data) => ({ _id: "queue2", ...data }));

  const options = await routingService.getOptions("lead2");
  assert.equal(options.mode, "strategy_queue");
});

test("book: rejects booking for a lead routed to the strategy queue (not direct booking)", async (t) => {
  const lead = { _id: "lead3", scoreResult: { tier: "C", routing: "strategy_queue" } };
  t.mock.method(Lead, "findById", async () => lead);
  await assert.rejects(routingService.book("lead3", { startAt: new Date().toISOString() }), /strategy queue, not direct booking/);
});

test("book: rejects with a clear error when no roster consultant is available for a direct-routed lead", async (t) => {
  const lead = { _id: "lead4", scoreResult: { tier: "A", routing: "direct_priority" }, visaPathway: "O-1A" };
  t.mock.method(Lead, "findById", async () => lead);
  t.mock.method(Settings, "findOne", () => fakeQuerySelect({ consultationRouting: [] }));
  await assert.rejects(routingService.book("lead4", { startAt: new Date().toISOString() }), /No booking calendar is configured/);
});

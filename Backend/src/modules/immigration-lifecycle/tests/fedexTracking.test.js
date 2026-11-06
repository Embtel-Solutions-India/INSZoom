const assert = require("node:assert/strict");
const test = require("node:test");
const Case = require("../../../models/Case");
const TrackingService = require("../services/TrackingService");
const ImmigrationTimelineService = require("../services/ImmigrationTimelineService");
const caseService = require("../../cases/case.service");

// DB-free: the FedEx tracking number of the filed petition - what the internal team may set, and what the client may see.

test("a FedEx number is cleaned (spaces / dashes removed) and anything implausible is refused", () => {
  assert.equal(TrackingService.cleanFedexNumber(" 7712-3456 7890 "), "771234567890");
  assert.equal(TrackingService.cleanFedexNumber("794644790138"), "794644790138");
  for (const bad of ["", "12", "abc def", "7712 3456 7890 !", "x".repeat(40), null, undefined]) assert.equal(TrackingService.cleanFedexNumber(bad), null, String(bad));
});

test("setting the number writes ONLY the carrier and the number - no status, no timeline, no client notification - and keeps an audit entry", async () => {
  const updates = [];
  const audits = [];
  const original = { updateOne: Case.updateOne, writeAudit: ImmigrationTimelineService.writeAudit };
  Case.updateOne = async (filter, update) => { updates.push({ filter, update }); return {}; };
  ImmigrationTimelineService.writeAudit = async (action, caseData, user, changes) => { audits.push({ action, changes }); };
  try {
    const caseData = { _id: "case1", immigrationLifecycle: { tracking: { filing: { trackingNumber: "OLD123456789" } } } };
    const out = await TrackingService.setFedexNumber(caseData, "7712 3456 7890", { _id: "u1" }, {});
    assert.deepEqual(out, { carrier: "fedex", trackingNumber: "771234567890" });
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].filter, { _id: "case1" });
    assert.deepEqual(Object.keys(updates[0].update), ["$set"]);
    assert.deepEqual(updates[0].update.$set, { "immigrationLifecycle.tracking.filing.carrier": "fedex", "immigrationLifecycle.tracking.filing.trackingNumber": "771234567890" });
    assert.equal(audits[0].action, "FEDEX_TRACKING_SET");
    assert.deepEqual(audits[0].changes, { previous: "OLD123456789", trackingNumber: "771234567890" });
    // an invalid number never reaches the database
    updates.length = 0;
    await assert.rejects(() => TrackingService.setFedexNumber(caseData, "12", {}, {}), { status: 400, code: "INVALID_FEDEX_NUMBER" });
    assert.equal(updates.length, 0);
  } finally {
    Case.updateOne = original.updateOne;
    ImmigrationTimelineService.writeAudit = original.writeAudit;
  }
});

test("the client sees a shipment only for FedEx with a plausible number, and only carrier + number + date", () => {
  const shipment = caseService.clientFilingShipment({ lifecycleFiling: { carrier: "fedex", trackingNumber: " 7712 3456 7890 ", filingDate: "2026-11-10", receiptNumber: "EAC123", filingFeeCents: 99900, lockbox: "x" } });
  assert.deepEqual(shipment, { carrier: "fedex", trackingNumber: "771234567890", shippedAt: "2026-11-10T00:00:00.000Z" });
  assert.deepEqual(Object.keys(shipment).sort(), ["carrier", "shippedAt", "trackingNumber"], "no fee, receipt or lockbox is shared");
  assert.equal(caseService.clientFilingShipment({ lifecycleFiling: { carrier: "ups", trackingNumber: "1Z999AA10123456784" } }), null);
  assert.equal(caseService.clientFilingShipment({ lifecycleFiling: { carrier: "fedex", trackingNumber: "12" } }), null);
  assert.equal(caseService.clientFilingShipment({ lifecycleFiling: { carrier: "fedex" } }), null);
  assert.equal(caseService.clientFilingShipment(), null);
  // the petition package's filing record is the fallback, the Tracking tab's wins
  assert.equal(caseService.clientFilingShipment({ packageFiling: { method: "fedex", trackingNumber: "771234567890", shippedAt: "2026-11-09T00:00:00Z" } }).shippedAt, "2026-11-09T00:00:00.000Z");
  assert.equal(caseService.clientFilingShipment({ packageFiling: { method: "usps", trackingNumber: "9400111899223197428490" } }), null);
  assert.equal(caseService.clientFilingShipment({ lifecycleFiling: { carrier: "fedex", trackingNumber: "111111111111" }, packageFiling: { method: "fedex", trackingNumber: "222222222222" } }).trackingNumber, "111111111111");
});

// ---- the employer's dashboard: the number is entered on the EMPLOYEE's case ------------------------------------------------------------------------------------------------------------------
const PetitionPackage = require("../../../models/PetitionPackage");

function stubQueries({ children = [], packages = [] }) {
  const original = { caseFind: Case.find, packageFind: PetitionPackage.find };
  Case.find = () => ({ select: () => ({ sort: () => ({ lean: async () => children }) }) });
  PetitionPackage.find = () => ({ select: () => ({ lean: async () => packages }) });
  return () => { Case.find = original.caseFind; PetitionPackage.find = original.packageFind; };
}

test("an employer matter shows each employee case's FedEx shipment, labelled; the matter's own record may be empty (B505)", async () => {
  const restore = stubQueries({
    children: [
      { _id: "c1", caseNumber: "B505-A", employeeIdentity: { name: "Ishaan", email: "i@example.com" }, immigrationLifecycle: { tracking: { filing: { carrier: "fedex", trackingNumber: "878282111726" } } } },
      { _id: "c2", caseNumber: "B505-B", employeeIdentity: { name: "Mira Das" }, immigrationLifecycle: { tracking: { filing: { carrier: "ups", trackingNumber: "1Z999AA10123456784" } } } },
      { _id: "c3", caseNumber: "B505-C", immigrationLifecycle: { tracking: { filing: { carrier: "fedex", trackingNumber: "" } } } },
    ],
  });
  try {
    const principal = { _id: "p1", caseNumber: "B505", caseRole: "principal", caseStructure: "employer_employee", childCases: ["c1", "c2", "c3"], immigrationLifecycle: { tracking: { filing: { carrier: "", trackingNumber: "" } } } };
    const out = await caseService.clientFilingShipmentsFor(principal);
    assert.equal(out.filingShipment, null);
    assert.deepEqual(out.filingShipments.map((s) => [s.caseNumber, s.employeeName, s.trackingNumber]), [["B505-A", "Ishaan", "878282111726"]]);
    assert.deepEqual(Object.keys(out.filingShipments[0]).sort(), ["carrier", "caseNumber", "employeeName", "shippedAt", "trackingNumber"], "carrier, number, date and the labels only");
  } finally { restore(); }
});

test("a single / family / employee case shows only its own shipment, and the petition package is the fallback", async () => {
  const restore = stubQueries({ packages: [{ caseId: "s1", filing: { method: "fedex", trackingNumber: "771234567890", shippedAt: "2026-11-09T00:00:00Z" } }] });
  try {
    const own = await caseService.clientFilingShipmentsFor({ _id: "s0", caseNumber: "B1", caseRole: "principal", caseStructure: "single", immigrationLifecycle: { tracking: { filing: { carrier: "fedex", trackingNumber: "794644790138" } } } });
    assert.equal(own.filingShipment.trackingNumber, "794644790138");
    assert.equal(own.filingShipments.length, 1);
    const viaPackage = await caseService.clientFilingShipmentsFor({ _id: "s1", caseNumber: "B2", caseRole: "principal", caseStructure: "single" });
    assert.equal(viaPackage.filingShipments[0].trackingNumber, "771234567890");
    const none = await caseService.clientFilingShipmentsFor({ _id: "s2", caseNumber: "B3", caseRole: "principal", caseStructure: "single" });
    assert.deepEqual(none, { filingShipment: null, filingShipments: [] });
  } finally { restore(); }
});

test("a database problem shows no shipment and never throws", async () => {
  const original = PetitionPackage.find;
  PetitionPackage.find = () => { throw new Error("db down"); };
  try {
    assert.deepEqual(await caseService.clientFilingShipmentsFor({ _id: "x", caseNumber: "B9" }), { filingShipment: null, filingShipments: [] });
  } finally { PetitionPackage.find = original; }
});

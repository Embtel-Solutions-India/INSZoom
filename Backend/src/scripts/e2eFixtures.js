// E2E fixture seeder/teardown for the Playwright golden-path suite.
//
// The pre-existing e2e spec (INSZoom/frontend/e2e/uscis-form-render.spec.js)
// pins hardcoded case IDs, which its own comments record as having gone stale
// every time the dev DB is reset. This script exists so the golden-path specs
// create their own throwaway staff accounts instead, and delete them again.
//
//   node src/scripts/e2eFixtures.js seed     > fixtures.json
//   node src/scripts/e2eFixtures.js teardown < fixtures.json
//
// Everything it creates is tagged with the E2E_TAG email domain so teardown can
// find and remove leftovers even if a run is interrupted.
require("dotenv").config();
const mongoose = require("mongoose");

const E2E_TAG = "e2e-audit.invalid";
const E2E_PASSWORD = "E2eAudit!Passw0rd";

const STAFF_FIXTURES = [
  { key: "admin", role: "admin", name: "E2E Audit Admin" },
  { key: "teamLead", role: "team_lead", name: "E2E Audit Team Lead" },
  { key: "caseManager", role: "case_manager", name: "E2E Audit Case Manager" },
];

async function connect() {
  await mongoose.connect(process.env.MONGODB_URI);
}

async function seed() {
  const User = require("../models/User");
  const runId = Date.now();
  const users = {};

  for (const fixture of STAFF_FIXTURES) {
    const email = `${fixture.key}.${runId}@${E2E_TAG}`;
    const user = await User.create({
      email,
      password: E2E_PASSWORD,
      name: fixture.name,
      displayName: fixture.name,
      role: fixture.role,
      isActive: true,
    });
    users[fixture.key] = { id: String(user._id), email, password: E2E_PASSWORD, role: fixture.role };
  }

  return { runId, users, tag: E2E_TAG };
}

async function teardown() {
  const User = require("../models/User");
  const Case = require("../models/Case");
  const CaseForm = require("../models/CaseForm");
  const EmployerProfile = require("../models/EmployerProfile");
  const EmployeeProfile = require("../models/EmployeeProfile");
  const AuditLog = require("../models/AuditLog");
  const Notification = require("../models/Notification");

  const tagged = new RegExp(`@${E2E_TAG.replace(/\./g, "\\.")}$`, "i");

  // Cases created by the specs use a tagged client email; child cases hang off
  // them by parentCase, and profiles/forms/logs hang off both.
  const principals = await Case.find({ clientEmail: tagged }).select("_id").lean();
  const principalIds = principals.map((c) => c._id);
  const children = await Case.find({ parentCase: { $in: principalIds } }).select("_id").lean();
  const allCaseIds = [...principalIds, ...children.map((c) => c._id)];

  const removed = {
    caseForms: (await CaseForm.deleteMany({ caseId: { $in: allCaseIds } })).deletedCount,
    employerProfiles: (await EmployerProfile.deleteMany({ principalCaseId: { $in: principalIds } })).deletedCount,
    employeeProfiles: (await EmployeeProfile.deleteMany({ principalCaseId: { $in: principalIds } })).deletedCount,
    auditLogs: (await AuditLog.deleteMany({ caseId: { $in: allCaseIds } })).deletedCount,
    notifications: (await Notification.deleteMany({ caseId: { $in: allCaseIds } })).deletedCount,
    cases: (await Case.deleteMany({ _id: { $in: allCaseIds } })).deletedCount,
    users: (await User.deleteMany({ email: tagged })).deletedCount,
  };

  return removed;
}

async function main() {
  const command = process.argv[2];
  await connect();
  try {
    if (command === "seed") {
      console.log(JSON.stringify(await seed()));
    } else if (command === "teardown") {
      console.log(JSON.stringify(await teardown()));
    } else {
      throw new Error(`unknown command '${command}' (expected: seed | teardown)`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

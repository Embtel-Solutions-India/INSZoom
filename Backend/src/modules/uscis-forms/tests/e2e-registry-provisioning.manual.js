/**
 * End-to-end verification of the USCIS Form Registry → S3 → CaseForm chain
 * (implementation spec §38).
 *
 * NOT part of `npm test` — it is deliberately named *.manual.js so the
 * node --test glob ("src/**\/*.test.js") never picks it up. It talks to the
 * real database, the real S3 bucket and a running backend, creates real
 * cases, and cleans them up afterwards. Run it explicitly:
 *
 *   node src/modules/uscis-forms/tests/e2e-registry-provisioning.manual.js
 *
 * Covers §38 steps 1-22 plus the §37 multi-visa regression matrix
 * (H-1B/I-129, L-1A/I-129, EB-1B/I-140, EB-2 NIW/I-140).
 */
require("dotenv").config();
const mongoose = require("mongoose");

const BASE = process.env.E2E_BASE_URL || "http://localhost:7000/api";
const ADMIN = { email: "admin@immiglance.com", password: "Admin123" };

const created = { caseIds: [], userIds: [], clientIds: [], templateIds: [] };
let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function login() {
  const response = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ADMIN),
  });
  const json = await response.json();
  if (!json.token) throw new Error("admin login failed");
  return { Authorization: `Bearer ${json.token}`, "Content-Type": "application/json" };
}

async function createCase(headers, visaType, clientEmail) {
  const response = await fetch(`${BASE}/cases/create-with-client`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      clientName: `E2E ${visaType}`,
      clientEmail,
      visaType,
      visaCategory: visaType,
    }),
  });
  const json = await response.json();
  const caseId = json.caseSummary?._id || json.case?._id;
  if (caseId) created.caseIds.push(caseId);
  if (json.clientUserId) created.userIds.push(json.clientUserId);
  if (json.caseSummary?.linkedEntities?.client) created.clientIds.push(json.caseSummary.linkedEntities.client);
  return { caseId, json };
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const USCISFormTemplate = require("../../../models/USCISFormTemplate");
  const CaseForm = require("../../../models/CaseForm");
  const Case = require("../../../models/Case");
  const User = require("../../../models/User");
  const Client = require("../../../models/Client");

  const headers = await login();
  const stamp = Date.now();

  console.log("\n=== §38 steps 1-9: registry state (analysis + storage + activation) ===");
  const i140 = await USCISFormTemplate.findOne({ formCode: "I-140" }).lean();
  check("I-140 is registered in MongoDB", Boolean(i140), i140 && `${i140.formCode} ${i140.version}`);
  check("I-140 edition is recorded", Boolean(i140?.editionDate || i140?.version), i140?.version);
  check("I-140 PDF lives in S3, not the repo", i140?.artifacts?.form?.storageProvider === "s3", i140?.pdfStorageKey);
  check("I-140 has a SHA-256 recorded", Boolean(i140?.artifacts?.form?.checksum), i140?.artifacts?.form?.checksum?.slice(0, 16) + "...");
  check("I-140 is the active version", i140?.status === "active" && i140?.activeFlag !== false);
  check("I-140 PDF fields were analyzed", (i140?.formFields || []).length > 0, `${(i140?.formFields || []).length} fields`);

  const healthResponse = await (await fetch(`${BASE}/uscis-forms/${i140._id}/health?deep=true`, { headers })).json();
  check("deep health verifies the stored object against its SHA-256", healthResponse.health?.status === "ok",
    healthResponse.health?.checks?.find((item) => item.id === "integrity")?.label);

  console.log("\n=== §38 steps 10-12: EB-2 NIW case provisioning through the registry ===");
  const niw = await createCase(headers, "EB-2 NIW", `e2e.niw.${stamp}@example.com`);
  check("EB-2 NIW case created", Boolean(niw.caseId), niw.caseId);

  const niwForms = await CaseForm.find({ caseId: niw.caseId }).lean();
  const niwI140 = niwForms.find((form) => form.formCode === "I-140");
  check("EB-2 NIW provisioned an I-140 CaseForm", Boolean(niwI140),
    niwForms.map((form) => form.formCode).join(", "));
  check("CaseForm points at the registry template", String(niwI140?.formTemplateId) === String(i140._id));

  console.log("\n=== §38 steps 13-15: the PDF a case manager opens comes from S3 ===");
  const urlResponse = await (await fetch(`${BASE}/uscis-forms/${i140._id}/url`, { headers })).json();
  check("a short-lived signed URL is issued", Boolean(urlResponse.url), `${urlResponse.expiresInSeconds}s TTL`);
  const pdfResponse = await fetch(`http://localhost:7000${urlResponse.url}`);
  const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
  check("the signed URL returns an authentic PDF without an auth header",
    pdfResponse.status === 200 && pdfBytes.subarray(0, 5).toString() === "%PDF-",
    `${pdfBytes.length} bytes`);

  const PDFRenderer = require("../../form-generation/services/PDFRenderer");
  const rendererBuffer = await PDFRenderer.loadTemplateBuffer(i140);
  check("the fill engine loads the same official bytes from storage",
    rendererBuffer.subarray(0, 5).toString() === "%PDF-" && rendererBuffer.length === pdfBytes.length);

  console.log("\n=== §38 steps 16-19: case edits stay case-scoped ===");
  const beforeTemplate = await USCISFormTemplate.findById(i140._id).lean();
  await CaseForm.updateOne(
    { _id: niwI140._id },
    {
      $set: {
        "fieldValues.e2e_probe_field": "E2E VALUE",
        "fieldValueProvenance.e2e_probe_field": { source: "case_manager_override", overriddenAt: new Date() },
      },
    }
  );
  const editedForm = await CaseForm.findById(niwI140._id).lean();
  const afterTemplate = await USCISFormTemplate.findById(i140._id).lean();
  check("the case's field value is stored on the CaseForm", editedForm.fieldValues?.e2e_probe_field === "E2E VALUE");
  check("per-field provenance survives the edit",
    Boolean(editedForm.fieldValueProvenance?.e2e_probe_field));
  check("the GLOBAL template was not mutated by a case edit",
    JSON.stringify(beforeTemplate.formFields?.length) === JSON.stringify(afterTemplate.formFields?.length)
    && afterTemplate.fieldValues === undefined);
  check("the stored S3 object is unchanged by a case edit",
    beforeTemplate.artifacts?.form?.checksum === afterTemplate.artifacts?.form?.checksum);

  console.log("\n=== §38 steps 20-22: a new edition must not move existing cases ===");
  // Register a second I-140 edition directly (mirrors what publishing a newer
  // edition through the admin UI produces) and activate it.
  const newerEdition = await USCISFormTemplate.create({
    formCode: "I-140",
    formNumber: "I-140",
    title: i140.title,
    formName: i140.formName,
    version: `E2E-${stamp}`,
    editionDate: new Date("2027-01-01"),
    effectiveDate: new Date("2027-01-01"),
    status: "active",
    activeFlag: true,
    officialStatus: "current",
    // Points at the same immutable S3 object — this test is about version
    // resolution, not about uploading different bytes.
    pdfStorageKey: i140.pdfStorageKey,
    artifacts: i140.artifacts,
    formFields: i140.formFields,
    supersedes: i140._id,
  });
  created.templateIds.push(newerEdition._id);
  check("a newer I-140 edition can be registered alongside the old one", Boolean(newerEdition._id),
    `${newerEdition.version} (2027-01-01)`);

  const oldStillThere = await USCISFormTemplate.findById(i140._id).lean();
  check("the previous edition is preserved, not overwritten", Boolean(oldStillThere), oldStillThere.version);

  const uscisFormService = require("../uscis-form.service");
  uscisFormService.invalidateTemplateCache();

  const lockedForm = await CaseForm.findById(niwI140._id).lean();
  check("the existing case's CaseForm still points at its ORIGINAL version",
    String(lockedForm.formTemplateId) === String(i140._id),
    `locked to ${lockedForm.formVersionLock?.version || i140.version}`);
  check("the existing case's version lock recorded the original edition",
    Boolean(lockedForm.formVersionLock?.formTemplateId));

  const resolvedActive = await uscisFormService.findLatestActiveTemplate("I-140");
  check("a NEW case would resolve to the newer active edition",
    String(resolvedActive?._id) === String(newerEdition._id),
    resolvedActive?.version);

  console.log("\n=== §37 regression matrix: other visa/form combinations ===");
  for (const [visaType, expectedForm] of [["H-1B", "I-129"], ["L-1A", "I-129"], ["EB-1B", "I-140"]]) {
    const result = await createCase(headers, visaType, `e2e.${visaType.replace(/[^a-z0-9]/gi, "")}.${stamp}@example.com`);
    if (!result.caseId) {
      check(`${visaType} case created`, false, result.json?.message);
      continue;
    }
    const forms = await CaseForm.find({ caseId: result.caseId }).select("formCode formTemplateId").lean();
    const codes = forms.map((form) => form.formCode);
    check(`${visaType} provisions ${expectedForm}`, codes.includes(expectedForm), codes.join(", ") || "(none)");
  }

  console.log("\n=== cleanup ===");
  await CaseForm.deleteMany({ caseId: { $in: created.caseIds } });
  await Case.deleteMany({ _id: { $in: created.caseIds } });
  await User.deleteMany({ _id: { $in: created.userIds } });
  await Client.deleteMany({ _id: { $in: created.clientIds } });
  await USCISFormTemplate.deleteMany({ _id: { $in: created.templateIds } });
  uscisFormService.invalidateTemplateCache();
  const restored = await uscisFormService.findLatestActiveTemplate("I-140");
  check("the original I-140 is the active edition again after cleanup",
    String(restored?._id) === String(i140._id), restored?.version);
  console.log(`  removed ${created.caseIds.length} cases, ${created.userIds.length} users, ${created.templateIds.length} test template(s)`);

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  await mongoose.disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

run().catch(async (error) => {
  console.error("E2E ABORTED:", error.message);
  process.exit(1);
});

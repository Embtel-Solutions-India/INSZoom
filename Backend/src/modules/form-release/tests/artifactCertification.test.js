// Phase 7.6a: the edition probe (data + final file), the certification-to-mapping binding in the ReleaseGate, and the switch behavior. No database, no network: the PDFs
// are built in memory with pdf-lib and the renderer is the REAL PDFRenderer.render driven through a stubbed template loader.
const test = require("node:test");
const assert = require("node:assert/strict");
const pdfLib = require("pdf-lib");
const { PDFDocument } = pdfLib;
const artifact = require("../artifactCertification");
const ReleaseGate = require("../ReleaseGate");
const certPolicy = require("../certPolicy");
const PDFRenderer = require("../../form-generation/services/PDFRenderer");

const withMode = async (mode, fn) => {
  const before = process.env.FORM_PIPELINE_AUTONOMY;
  if (mode === undefined) delete process.env.FORM_PIPELINE_AUTONOMY; else process.env.FORM_PIPELINE_AUTONOMY = mode;
  try { return await fn(); } finally { if (before === undefined) delete process.env.FORM_PIPELINE_AUTONOMY; else process.env.FORM_PIPELINE_AUTONOMY = before; }
};

const NAME = "form1[0].#subform[0].Pt1Line1_FamilyName[0]";
const BEN = "form1[0].#subform[0].Pt2Line1_FamilyName[0]";
const DOB = "form1[0].#subform[0].Pt1Line5_DateOfBirth[0]";
const TICK = "form1[0].#subform[0].Pt1Line6_Yes[0]";
const PICK = "form1[0].#subform[0].Pt1Line7_Status[0]";

async function buildSource() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const form = pdf.getForm();
  const add = (field, x, y, w = 200, h = 20) => field.addToPage(page, { x, y, width: w, height: h });
  const name = form.createTextField(NAME); name.setMaxLength(20); add(name, 50, 700);
  const ben = form.createTextField(BEN); add(ben, 50, 660);
  const dob = form.createTextField(DOB); add(dob, 50, 620);
  const tick = form.createCheckBox(TICK); add(tick, 50, 580, 14, 14);
  const pick = form.createDropdown(PICK); pick.addOptions(["Single", "Married"]); add(pick, 50, 540);
  return Buffer.from(await pdf.save({ updateFieldAppearances: false }));
}

const fields = [
  { fieldId: "page1.name", pdfFieldName: NAME, fieldName: NAME, fieldType: "text", label: "Petitioner Family Name", section: "Part 1. Petitioner" },
  { fieldId: "page1.ben", pdfFieldName: BEN, fieldName: BEN, fieldType: "text", label: "Beneficiary Family Name", section: "Part 2. Beneficiary" },
  { fieldId: "page1.dob", pdfFieldName: DOB, fieldName: DOB, fieldType: "date", label: "Date of Birth" },
  { fieldId: "page1.tick", pdfFieldName: TICK, fieldName: TICK, fieldType: "checkbox", label: "Yes" },
  { fieldId: "page1.pick", pdfFieldName: PICK, fieldName: PICK, fieldType: "dropdown", label: "Status" },
];
const edge = (id, pdfField, sourcePath, extra = {}) => ({ mappingId: `m-${id}`, status: "active", targetFieldId: `page1.${id}`, targetPdfField: pdfField, sourcePath, targetLabel: fields.find((f) => f.fieldId === `page1.${id}`).label, ...extra });
const graph = { edges: [edge("name", NAME, "petitioner.name.last"), edge("ben", BEN, "beneficiary.name.last"), edge("dob", DOB, "beneficiary.dob"), edge("tick", TICK, "case.flag"), edge("pick", PICK, "beneficiary.status")], keepBlank: [] };
const template = { _id: "t1", formCode: "ZZ-PROBE", formFields: fields };

async function deps(source, overrides = {}) {
  return {
    loadPdf: async () => PDFDocument.load(source, { ignoreEncryption: true }),
    render: async ({ caseForm }) => {
      const pdf = await PDFDocument.load(source, { ignoreEncryption: true });
      const form = pdf.getForm();
      if (!overrides.keepLimits) require("../../form-generation/services/FullTextFieldGuard").liftTextLengthLimits(form); // the real renderer lifts every length limit before writing
      const written = [];
      const failed = [];
      for (const [fieldId, value] of Object.entries(caseForm.fieldValues || {})) {
        const meta = fields.find((f) => f.fieldId === fieldId);
        const outcome = overrides.write ? overrides.write({ form, meta, value, written, failed }) : undefined;
        if (outcome === "skip") continue;
        const target = { pdfField: meta.pdfFieldName, value, type: meta.fieldType };
        if (PDFRenderer.setFormField(form, target, "ZZ-PROBE")) written.push(target.pdfField); else failed.push({ pdfField: target.pdfField, message: target.renderError });
      }
      if (!overrides.keepLimits) await require("../../form-generation/services/FullTextFieldGuard").shrinkLongTextToFit(pdf, form); // and shrinks the font of text that would not fit
      return { buffer: Buffer.from(await pdf.save()), renderReport: { adjustedFieldWrites: [], failedFieldWrites: failed, componentPageCount: null } };
    },
    protectedCheck: () => false,
  };
}

test("the plan fills only boxes a person's data can reach, and gives every kind of box a valid value", async () => {
  const source = await buildSource();
  const info = artifact.describePdfFields(await PDFDocument.load(source));
  const boxes = artifact.planBoxes({ template, graph, protectedCheck: () => false });
  assert.equal(boxes.length, 5);
  const long = Object.fromEntries(boxes.map((box) => [box.pdfField.split(".").pop(), artifact.valueFor(box, info, "long")]));
  assert.ok(long["Pt1Line1_FamilyName[0]"].value.length >= 290 && long["Pt1Line1_FamilyName[0]"].value.startsWith("PETITIONER_TEST_001"));
  assert.equal(long["Pt1Line5_DateOfBirth[0]"].value, "01/15/2030");
  assert.equal(long["Pt1Line6_Yes[0]"].value, true);
  assert.equal(long["Pt1Line7_Status[0]"].value, "Single", "a REAL option of this pdf");
  const realistic = artifact.valueFor(boxes[0], info, "realistic");
  assert.equal(realistic.value.length, 20, "exactly the length the form itself allows");
  assert.equal(artifact.valueFor({ pdfField: "not.in.pdf", fieldType: "text" }, info, "long"), null);
});

test("a healthy edition passes both checks: long text survives in full, party data stays in its own box, the final file is sound", async () => {
  const source = await buildSource();
  const result = await artifact.probeEdition(template, { graph, deps: await deps(source) });
  assert.deepEqual(result.data.failures, []);
  assert.equal(result.data.ok, true);
  assert.equal(result.data.checked, 5);
  assert.deepEqual(result.artifact.failures, []);
  assert.equal(result.artifact.ok, true);
});

test("a renderer that CUTS a long text at the field limit is caught: the full text must survive", async () => {
  const source = await buildSource();
  const result = await artifact.probeEdition(template, { graph, deps: await deps(source, { keepLimits: true }) });
  assert.equal(result.data.ok, false);
  assert.ok(result.data.failures.some((failure) => failure.check === "VALUE_MISMATCH" && /read back 20 characters, expected 300/.test(failure.detail)), JSON.stringify(result.data.failures));
});

test("a value the renderer drops is a data failure, not silently accepted", async () => {
  const source = await buildSource();
  const result = await artifact.probeEdition(template, { graph, deps: await deps(source, { write: ({ meta }) => (meta.fieldId === "page1.name" ? "skip" : undefined) }) });
  assert.equal(result.data.ok, false);
  assert.ok(result.data.failures.some((failure) => failure.check === "VALUE_MISMATCH" && /FamilyName/.test(failure.field)), JSON.stringify(result.data.failures));
});

test("a party's data landing in the other party's box is PARTY_LANDING", async () => {
  const source = await buildSource();
  const swap = ({ form, meta, value }) => {
    if (meta.fieldId === "page1.name") { form.getTextField(BEN).setText(value); return "skip"; } // the petitioner's text ends up in the beneficiary's box
    if (meta.fieldId === "page1.ben") return "skip";
    return undefined;
  };
  const result = await artifact.probeEdition(template, { graph, deps: await deps(source, { write: swap }) });
  assert.ok(result.data.failures.some((failure) => failure.check === "PARTY_LANDING"), JSON.stringify(result.data.failures));
});

test("sideOfMarker / textOfLength / partyFailures are pure helpers", () => {
  assert.equal(artifact.sideOfMarker("x COMPANY_TEST_003 y"), "petitioner");
  assert.equal(artifact.sideOfMarker("none"), null);
  assert.equal(artifact.textOfLength(10, "PETITIONER_TEST_001").length, 10);
  assert.ok(artifact.textOfLength(300, null).length === 300);
});

test("the ReleaseGate rejects a certification made for another mapping version, only with the switch on; a certification without a version id is never a failure", async () => {
  const certified = (extra = {}) => ({ importMetadata: { validationSummary: { certification: { passed: true, checks: [], ...extra } } }, approvedAt: new Date(), approvedBy: "u", mappingStatus: "active", activeMappingVersionId: "v2", officialStatus: "ok" });
  const deps = { policy: async () => ({ allowed: true }), editionDiff: async () => ({ blocked: false }), inventory: async () => null };
  const run = (template, mode) => withMode(mode, () => ReleaseGate.evaluate(template, { deps }));
  const stale = await run(certified({ mappingVersionId: "v1" }), "on");
  assert.equal(stale.decision, "blocked");
  assert.match(stale.error, /re-certified/);
  assert.equal((await run(certified({ mappingVersionId: "v2" }), "on")).decision, "promote");
  assert.equal((await run(certified({}), "on")).decision, "promote", "legacy (grandfathered) certification");
  assert.equal((await run(certified({ mappingVersionId: "v1" }), "off")).decision, "promote", "off: exactly as before");
  assert.equal((await run(certified({ mappingVersionId: "v1" }), "shadow")).decision, "promote", "shadow: exactly as before");
});

test("certPolicy: the probe checks are critical, and viewer_download / components_slice become critical only with the switch on", async () => {
  assert.equal(certPolicy.classify("data_probe"), "critical");
  assert.equal(certPolicy.classify("artifact_probe"), "critical");
  assert.equal(await withMode(undefined, () => certPolicy.classify("viewer_download")), "non_critical");
  assert.equal(await withMode("shadow", () => certPolicy.classify("viewer_download")), "non_critical");
  assert.equal(await withMode("on", () => certPolicy.classify("viewer_download")), "critical");
  const failedDownload = { importMetadata: { validationSummary: { certification: { passed: false, checks: [{ name: "viewer_download", passed: false }] } } } };
  const req = { body: { overrideReason: "reviewed by the owner on 2026-10-23" } };
  assert.equal(await withMode(undefined, () => certPolicy.certificationDecision(failedDownload, req).ok), true, "off: still overridable with a reason");
  assert.equal(await withMode("on", () => certPolicy.certificationDecision(failedDownload, req).ok), false);
});

test("the certification service only touches the probe when the switch is not off, and records the binding only with on", () => {
  const source = require("fs").readFileSync(require.resolve("../../form-mapping/services/FormCertificationService"), "utf8");
  assert.match(source, /probeMode !== "off"/);
  assert.match(source, /probeMode === "on"/);
  assert.match(source, /report\.mappingVersionId/);
  const before = source.indexOf("const probeMode");
  assert.ok(before > source.indexOf('"viewer_download"'), "the probe sits after the existing checks");
});

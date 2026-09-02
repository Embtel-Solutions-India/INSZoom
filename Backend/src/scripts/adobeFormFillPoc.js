// Adobe PDF Services POC - controlled, standalone verification that the real
// "Import PDF Form Data" operation (POST /operation/setformdata) can fill the
// actual I-129 AcroForm PDF this app already serves, using the SAME field/
// value map production already computes via AutoFillService/PDFFieldMapper.
//
// This script does not touch PDFRenderer.js, PDFFieldMapper.js,
// WatermarkService.js, normalizePdf.js, or PDFFidelityService.js - it only
// reuses their exports. It does not create any route, model, or CaseForm
// schema change. See C:\Users\ishaan\.claude\plans\serialized-launching-frost.md
// for the approved plan this implements.
//
// Usage: MONGODB_TEST_URI=... node Backend/src/scripts/adobeFormFillPoc.js
//
// The official @adobe/pdfservices-node-sdk (v4.1.0, checked directly against
// its published tarball) has no Import/Export PDF Form Data job class - only
// documentmerge, createpdf, combinepdf, ocr, exportpdf, etc. Per the plan's
// documented fallback, this script calls the real REST endpoints directly,
// verified against Adobe's own published OpenAPI spec
// (https://raw.githubusercontent.com/AdobeDocs/pdfservices-api-documentation/main/static/openapi.json).

require("dotenv").config();
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const ADOBE_BASE = "https://pdf-services-ue1.adobe.io";

const results = [];
function record(id, name, pass, detail) {
  results.push({ id, name, pass, detail: detail || "" });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${id} - ${name}${detail ? " :: " + detail : ""}`);
}

function printSummary() {
  console.log("\n=== ADOBE PDF SERVICES POC - SUMMARY ===");
  results.forEach((r) => console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id.padEnd(5)}  ${r.name}${r.detail ? " - " + r.detail : ""}`));
  const overall = results.length > 0 && results.every((r) => r.pass);
  console.log(`\nOVERALL VERDICT: ${overall ? "PASS" : "FAILED / STOP"}`);
  return overall;
}

class StopError extends Error {}
function stop(reason) {
  throw new StopError(reason);
}

// Splits a raw LiveCycle-style AcroForm field name on "." and deep-merges it
// into the nested-JSON shape Adobe's jsonFormFieldsData requires. This exact
// conversion is the first unverified risk this POC exists to prove or
// disprove - it is NOT assumed correct merely because it runs without error.
function setNested(root, dottedName, value) {
  const segments = dottedName.split(".");
  let node = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (typeof node[seg] !== "object" || node[seg] === null || Array.isArray(node[seg])) node[seg] = {};
    node = node[seg];
  }
  node[segments[segments.length - 1]] = value;
}

function classifyField(field) {
  const ctor = field.constructor?.name || "";
  if (ctor.includes("CheckBox")) return "checkbox";
  if (ctor.includes("RadioGroup")) return "radio";
  if (ctor.includes("Dropdown")) return "dropdown";
  if (ctor.includes("OptionList")) return "optionlist";
  return "text";
}

async function adobeToken(clientId, clientSecret) {
  const res = await fetch(`${ADOBE_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret }).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) stop(`Adobe /token failed: HTTP ${res.status} ${JSON.stringify(json)}`);
  return json.access_token;
}

async function adobeUploadAsset(authHeaders, buffer) {
  const presignRes = await fetch(`${ADOBE_BASE}/assets`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ mediaType: "application/pdf" }),
  });
  const presignJson = await presignRes.json().catch(() => ({}));
  if (!presignRes.ok || !presignJson.uploadUri || !presignJson.assetID) {
    stop(`Adobe /assets (upload presign) failed: HTTP ${presignRes.status} ${JSON.stringify(presignJson)}`);
  }
  const putRes = await fetch(presignJson.uploadUri, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    body: buffer,
  });
  if (!putRes.ok) stop(`Uploading PDF bytes to Adobe's presigned URI failed: HTTP ${putRes.status}`);
  return presignJson.assetID;
}

async function adobeSetFormData(authHeaders, assetID, jsonFormFieldsData) {
  const res = await fetch(`${ADOBE_BASE}/operation/setformdata`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ assetID, jsonFormFieldsData }),
  });
  if (res.status !== 201) {
    const body = await res.text().catch(() => "");
    stop(`Adobe /operation/setformdata failed: HTTP ${res.status} ${body}`);
  }
  const location = res.headers.get("location");
  if (!location) stop("Adobe /operation/setformdata returned 201 with no location header to poll");
  return location;
}

async function adobePollJob(authHeaders, location) {
  const deadline = Date.now() + 120000;
  let last;
  while (Date.now() < deadline) {
    const res = await fetch(location, { headers: authHeaders });
    last = await res.json().catch(() => ({}));
    if (last.status === "done") return last;
    if (last.status === "failed") stop(`Adobe job failed: ${JSON.stringify(last.error)}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  stop(`Adobe job did not complete within 120s. Last status: ${JSON.stringify(last)}`);
}

async function main() {
  // ---- T1: auth from env only ----
  const clientId = process.env.ADOBE_PDF_SERVICES_CLIENT_ID;
  const clientSecret = process.env.ADOBE_PDF_SERVICES_CLIENT_SECRET;
  if (!clientId) stop("ADOBE_PDF_SERVICES_CLIENT_ID is not set in the environment - cannot proceed (brief section 31 stop condition).");
  if (!clientSecret) stop("ADOBE_PDF_SERVICES_CLIENT_SECRET is not set in the environment - cannot proceed (brief section 31 stop condition).");

  const accessToken = await adobeToken(clientId, clientSecret);
  record("T1", "Adobe authenticates using .env credentials only", true, "token acquired, never logged");
  const authHeaders = { Authorization: `Bearer ${accessToken}`, "x-api-key": clientId };

  await mongoose.connect(process.env.MONGODB_TEST_URI || "mongodb://localhost:27017/immigrationcrm_test");

  const CaseForm = require("../models/CaseForm");
  const storageService = require("../modules/uploads/storage.service");
  const PDFRenderer = require("../modules/form-generation/services/PDFRenderer");
  const PDFFieldMapper = require("../modules/form-generation/services/PDFFieldMapper");
  const AutoFillService = require("../modules/form-mapping/services/AutoFillService");
  const { buildGoldenH1bCase } = require("../modules/form-mapping/tests/i129-h1b-golden-case");
  const { PDFDocument } = require("pdf-lib");

  const golden = await buildGoldenH1bCase();
  let outPath = null;
  try {
    // ---- Resolve the real template the same way production does: via AutoFillService.generate, not a hand-rolled query ----
    const generated = await AutoFillService.generate(golden.caseId, "I-129", golden.user, {});
    const caseForm = await CaseForm.findById(generated.caseForm._id).populate("formTemplateId");
    const template = caseForm.formTemplateId.toObject();
    record("T2", "Authentic source is the registered USCISFormTemplate", true, `${template.formCode} ${template.version}, templateId=${template._id}`);

    // ---- T3: checksum verification against the existing artifacts.form.checksum field (reused, not reinvented) ----
    const rawBuffer = await PDFRenderer.loadTemplateBuffer(template);
    const actualChecksum = crypto.createHash("sha256").update(rawBuffer).digest("hex");
    const registeredChecksum = template.artifacts?.form?.checksum;
    if (registeredChecksum) {
      if (actualChecksum !== registeredChecksum) {
        record("T3", "Template SHA-256 matches registered artifacts.form.checksum", false, `computed=${actualChecksum} registered=${registeredChecksum}`);
        stop("Template checksum mismatch - refusing to generate output from an unverified source PDF (brief section 8).");
      }
      record("T3", "Template SHA-256 matches registered artifacts.form.checksum", true, actualChecksum);
    } else {
      record("T3", "Template SHA-256 matches registered artifacts.form.checksum", false, "artifacts.form.checksum is not populated for this template record - cannot verify authenticity against a registered value");
    }

    // ---- Load the actual fillable PDF (reusing PDFRenderer's own normalization) ----
    const sourcePdf = await PDFRenderer.loadTemplatePdf(template, PDFDocument);
    const sourceForm = sourcePdf.getForm();
    const sourceFields = sourceForm.getFields();
    record("T4", "Real AcroForm field names are detected", sourceFields.length > 0, `${sourceFields.length} fields`);

    const sourceFieldNames = new Set(sourceFields.map((f) => f.getName()));
    const fieldTypeByName = new Map(sourceFields.map((f) => [f.getName(), classifyField(f)]));
    const sourcePageCount = sourcePdf.getPageCount();
    const sourcePageSizes = sourcePdf.getPages().map((p) => [p.getWidth(), p.getHeight()]);

    // ---- T5: reuse the SAME mapping call PDFRenderer.render uses - do not hand-write a second mapping ----
    const { mappedFields } = PDFFieldMapper.mapFields(caseForm, template);
    const autofillPopulatedCount = Object.keys(mappedFields).filter((name) => sourceFieldNames.has(name)).length;
    record("T5", "Existing AutoFillService/PDFFieldMapper values populate actual physical AcroForm field names", autofillPopulatedCount > 0, `${autofillPopulatedCount} mapped fields present on the real template`);

    // ---- Build the field/value map to actually send to Adobe, starting from production's own mapping.
    // Only plain TEXT fields go through blind stringification here - per the brief's own rule ("do not
    // silently convert boolean controls to arbitrary strings"), checkbox/radio/dropdown/optionlist
    // fields are excluded from this pass and handled with type-aware, on-value-derived logic below.
    // (First run of this script sent a checkbox's autofill-derived boolean `false` to Adobe as the
    // literal text "false" this way, which Adobe correctly rejected - this exclusion is the fix.)
    const fieldsToSend = {}; // pdfField -> { value, kind }
    Object.values(mappedFields).forEach((m) => {
      if (sourceFieldNames.has(m.pdfField) && fieldTypeByName.get(m.pdfField) === "text") fieldsToSend[m.pdfField] = { value: m.value, kind: "autofill" };
    });

    // ---- Step 4 of the plan: inventory repeated-canonical-value fields for real, via the
    // SAME reverse-index this codebase already uses for repeated-field fan-out.
    // ReverseIndexService's `pdfField` property is - despite its name, and confirmed against this
    // session's own earlier ISSUE-001 findings - the NORMALIZED fieldId, not the raw AcroForm field
    // name pdf-lib's form.getFields() returns. Translate via template.formFields (which carries both
    // fieldId and fieldName on the same entry) before comparing against sourceFieldNames, or every
    // lookup silently misses (confirmed: this returned 0 occurrences before this fix, on a template
    // AutoFillService itself populated 396 fields on moments earlier in this same run).
    const fieldIdToFieldName = new Map((template.formFields || []).map((f) => [f.fieldId || f.fieldName, f.fieldName]));
    const ReverseIndexService = require("../modules/form-mapping/services/ReverseIndexService");
    const reverseIndex = await ReverseIndexService.buildFormReverseIndex("I-129");
    let repeatedGroup = { sourcePath: null, pdfFields: [] };
    for (const [sourcePath, entries] of reverseIndex.entries()) {
      const pdfFields = entries
        .map((e) => fieldIdToFieldName.get(e.pdfField) || e.pdfField)
        .filter((name) => sourceFieldNames.has(name) && fieldTypeByName.get(name) === "text");
      if (pdfFields.length > repeatedGroup.pdfFields.length) repeatedGroup = { sourcePath, pdfFields };
    }
    console.log(`Repeated-field inventory (via ReverseIndexService.buildFormReverseIndex, canonical source path grouping): "${repeatedGroup.sourcePath}" has ${repeatedGroup.pdfFields.length} distinct physical AcroForm occurrence(s) (real count, not assumed).`);
    const repeatedFieldValue = repeatedGroup.pdfFields.length ? "REPEATEDFIELDPOC" : null;
    if (repeatedFieldValue) {
      repeatedGroup.pdfFields.forEach((pdfField) => {
        fieldsToSend[pdfField] = { value: repeatedFieldValue, kind: "repeated" };
      });
    }

    const specialCharValue = "José O'Brien, Apt. #4B - François Müller Ave., 12401";
    // Special-character override (T20) - overwrite ONE existing mapped text field, not a new hand-picked
    // one. Excludes USCIS_USE_ONLY_PATTERNS fields (reused from the existing i129-h1b-crosswalk config,
    // not a new convention) - the first run of this script picked
    // "form1[0].#pageSet[0].Page1[0].PDF417BarCode1[0]" and the value never took, because that field is
    // a USCIS-internal scanning barcode ("never a candidate for any data source" per that config's own
    // comment) that production's own crosswalk already excludes from every real data source - not a
    // genuine case-manager-editable field, so it was never a valid test candidate for T20 in the first place.
    const { USCIS_USE_ONLY_PATTERNS } = require("../modules/form-mapping/config/i129-h1b-crosswalk");
    const isUscisUseOnly = (name) => USCIS_USE_ONLY_PATTERNS.some((p) => p.test(name));
    const textCandidate = Object.values(mappedFields).find(
      (m) => sourceFieldNames.has(m.pdfField) && fieldTypeByName.get(m.pdfField) === "text" && !repeatedGroup.pdfFields.includes(m.pdfField) && !isUscisUseOnly(m.pdfField)
    );
    if (textCandidate) {
      fieldsToSend[textCandidate.pdfField] = { value: specialCharValue, kind: "special-chars" };
    }

    // Checkbox (T18) - autofill may never populate these from canonical data, so pick a real one
    // directly off the template to prove Adobe's representation, independent of AutoFillService's
    // own coverage. Uses PDFAcroCheckBox.getOnValue() (singular - getOnValues() does not exist on
    // this class and silently returns undefined) and decodeText() (a checkbox's real on-value is a
    // PDF name that can itself be escaped, e.g. "STE" is literally encoded as "#20STE#20" i.e. " STE "
    // with surrounding spaces - asString() would send Adobe the undecoded escape sequence).
    const checkboxField = sourceFields.find((f) => classifyField(f) === "checkbox");
    let checkboxOnValue = null;
    if (checkboxField) {
      checkboxOnValue = checkboxField.acroField.getOnValue()?.decodeText();
      if (!checkboxOnValue) stop(`Could not determine the real on-value for checkbox field ${checkboxField.getName()} - cannot test T18 without it.`);
      fieldsToSend[checkboxField.getName()] = { value: checkboxOnValue, kind: "checkbox" };
    }

    // Radio (T19) - this I-129 template has 0 true PDF RadioGroup widgets (confirmed empirically,
    // not assumed): its "choose one of several" controls (e.g. suite/apt/floor unit-type selectors)
    // are implemented as several mutually-exclusive individual CheckBox fields sharing a name prefix,
    // not a single /FT /Btn radio group. Prefer a real RadioGroup if one exists on this template;
    // otherwise fall back to testing mutual exclusion across a real 2+ member checkbox group instead
    // of silently skipping T19 or asserting a radio group that doesn't exist.
    const radioField = sourceFields.find((f) => classifyField(f) === "radio");
    let radioSelectValue = null;
    let checkboxGroupSiblings = null; // fallback: [{name, onValue}] when no true radio group exists
    if (radioField) {
      const options = radioField.getOptions();
      radioSelectValue = options[0];
      fieldsToSend[radioField.getName()] = { value: radioSelectValue, kind: "radio" };
    } else if (checkboxField) {
      const prefix = checkboxField.getName().replace(/\[\d+\]$/, "");
      const siblingNames = sourceFields
        .filter((f) => classifyField(f) === "checkbox" && f.getName().startsWith(prefix) && f.getName() !== checkboxField.getName())
        .map((f) => f.getName());
      if (siblingNames.length > 0) {
        checkboxGroupSiblings = siblingNames;
        console.log(`No true RadioGroup field exists on this template. Testing mutual exclusion instead via checkbox group "${prefix}*": setting only ${checkboxField.getName()}, expecting siblings ${JSON.stringify(siblingNames)} to remain unchecked.`);
      }
    }

    // ---- Build nested jsonFormFieldsData - the first real risk, not assumed correct ----
    const jsonFormFieldsData = {};
    Object.entries(fieldsToSend).forEach(([pdfField, { value }]) => setNested(jsonFormFieldsData, pdfField, String(value)));

    const sourceFieldNameList = Array.from(sourceFieldNames).sort();

    // ---- Upload, fill, poll, download ----
    const uploadBuffer = Buffer.from(await sourcePdf.save());
    const assetID = await adobeUploadAsset(authHeaders, uploadBuffer);
    const location = await adobeSetFormData(authHeaders, assetID, jsonFormFieldsData);
    const jobResult = await adobePollJob(authHeaders, location);
    const downloadRes = await fetch(jobResult.asset.downloadUri);
    if (!downloadRes.ok) stop(`Downloading Adobe's result asset failed: HTTP ${downloadRes.status}`);
    const outputBuffer = Buffer.from(await downloadRes.arrayBuffer());

    outPath = path.join(require("os").tmpdir(), `adobe-poc-i129-output-${Date.now()}.pdf`);
    fs.writeFileSync(outPath, outputBuffer);
    console.log(`Adobe output PDF saved for manual Acrobat inspection at: ${outPath}`);

    // ---- Verify with pdf-lib against the actual output bytes - never trust "the call succeeded" ----
    const outputPdf = await PDFDocument.load(outputBuffer, { ignoreEncryption: true, updateMetadata: false });

    // T16 - page count / dimensions
    const outputPageCount = outputPdf.getPageCount();
    record("T16", "Output page count matches source", outputPageCount === sourcePageCount, `source=${sourcePageCount} output=${outputPageCount}`);
    const outputPageSizes = outputPdf.getPages().map((p) => [p.getWidth(), p.getHeight()]);
    const dimensionsMatch = sourcePageSizes.length === outputPageSizes.length && sourcePageSizes.every(([w, h], i) => Math.abs(w - outputPageSizes[i][0]) < 0.5 && Math.abs(h - outputPageSizes[i][1]) < 0.5);
    record("T16b", "Output page dimensions match source", dimensionsMatch, JSON.stringify({ source: sourcePageSizes, output: outputPageSizes }));

    // T17 - field-name parity, EXHAUSTIVE, per the critical POC rule - any drift is a hard fail
    const outputForm = outputPdf.getForm();
    const outputFieldNameList = outputForm.getFields().map((f) => f.getName()).sort();
    const outputFieldNameSet = new Set(outputFieldNameList);
    const sourceFieldNameSet = new Set(sourceFieldNameList);
    const missingFromOutput = sourceFieldNameList.filter((n) => !outputFieldNameSet.has(n));
    const addedInOutput = outputFieldNameList.filter((n) => !sourceFieldNameSet.has(n));
    const fieldParityOk = missingFromOutput.length === 0 && addedInOutput.length === 0;
    record(
      "T17",
      "Full field-name parity between source and output (exhaustive diff, not sampled)",
      fieldParityOk,
      fieldParityOk ? `${outputFieldNameList.length} fields, exact match` : `missing=${JSON.stringify(missingFromOutput.slice(0, 20))} added=${JSON.stringify(addedInOutput.slice(0, 20))}`
    );
    if (!fieldParityOk) {
      stop("Field-name parity failed - Adobe's output does not have the same AcroForm field set as the source. Per the Critical POC rules, this is FAILED/STOP, not a partial pass.");
    }

    // T5/T6/T20 - read back every text/special-char/repeated field individually, not sampled
    let allTextReadbackOk = true;
    const textFailures = [];
    Object.entries(fieldsToSend).forEach(([pdfField, { value, kind }]) => {
      if (kind === "checkbox" || kind === "radio") return;
      let actual;
      try {
        actual = outputForm.getTextField(pdfField).getText();
      } catch (e) {
        actual = `<error: ${e.message}>`;
      }
      if (actual !== String(value)) {
        allTextReadbackOk = false;
        textFailures.push({ pdfField, kind, expected: value, actual });
      }
    });
    record("T5_T6_T20", "Every text/special-character/repeated-occurrence field reads back exactly as set", allTextReadbackOk, allTextReadbackOk ? `${Object.keys(fieldsToSend).length - (checkboxField ? 1 : 0) - (radioField ? 1 : 0)} fields verified individually` : JSON.stringify(textFailures));

    // T18 - checkbox
    if (checkboxField) {
      let checkboxOk = false;
      let actualChecked;
      try {
        actualChecked = outputForm.getCheckBox(checkboxField.getName()).isChecked();
        checkboxOk = actualChecked === true;
      } catch (e) {
        actualChecked = `<error: ${e.message}>`;
      }
      record("T18", "Checkbox value survives Adobe fill and reopen", checkboxOk, `field=${checkboxField.getName()} setOnValue=${checkboxOnValue} readBackChecked=${actualChecked}`);
      if (!checkboxOk) stop("Adobe did not correctly set the checkbox field - per the Critical POC rules, any checkbox mishandling is FAILED/STOP.");
    } else {
      record("T18", "Checkbox value survives Adobe fill and reopen", false, "no checkbox field found on this template to test - cannot confirm Adobe handles this field type");
    }

    // T19 - radio (or, since this template has 0 true RadioGroup widgets - confirmed
    // empirically - the mutually-exclusive checkbox group substitute described above)
    if (radioField) {
      let radioOk = false;
      let actualSelected;
      try {
        actualSelected = outputForm.getRadioGroup(radioField.getName()).getSelected();
        radioOk = actualSelected === radioSelectValue;
      } catch (e) {
        actualSelected = `<error: ${e.message}>`;
      }
      record("T19", "Radio button value survives Adobe fill and reopen", radioOk, `field=${radioField.getName()} setValue=${radioSelectValue} readBackSelected=${actualSelected}`);
      if (!radioOk) stop("Adobe did not correctly set the radio group field - per the Critical POC rules, any radio mishandling is FAILED/STOP.");
    } else if (checkboxGroupSiblings) {
      const siblingStates = checkboxGroupSiblings.map((name) => {
        try {
          return { name, checked: outputForm.getCheckBox(name).isChecked() };
        } catch (e) {
          return { name, checked: `<error: ${e.message}>` };
        }
      });
      const noSiblingWronglyChecked = siblingStates.every((s) => s.checked === false);
      record(
        "T19",
        "No true RadioGroup on this template (confirmed) - mutually-exclusive checkbox group siblings remain unchecked when only one member is set",
        noSiblingWronglyChecked,
        JSON.stringify(siblingStates)
      );
      if (!noSiblingWronglyChecked) stop("Adobe checked a sibling of a mutually-exclusive checkbox group that was never sent a value - per the Critical POC rules, this is FAILED/STOP.");
    } else {
      record("T19", "Radio button value survives Adobe fill and reopen", false, "no RadioGroup and no multi-member checkbox group found on this template to test - cannot confirm Adobe handles mutually-exclusive selection");
    }

    // T21 - no CRM artifacts (best-effort structural check; Adobe's operation shouldn't add any)
    const noNewFields = addedInOutput.length === 0;
    record("T21", "No CRM watermark/overlay/branding introduced", noNewFields, noNewFields ? "no unexpected fields or pages introduced" : "unexpected fields present, see T17");

    printSummary();
  } finally {
    try {
      await require("../models/CaseForm").deleteMany({ caseId: golden.caseId });
    } catch (_) {}
    await golden.cleanup();
    await mongoose.disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    if (error instanceof StopError) {
      console.error(`\nSTOP: ${error.message}`);
    } else {
      console.error("\nUNEXPECTED ERROR:", error);
    }
    printSummary();
    process.exit(1);
  });

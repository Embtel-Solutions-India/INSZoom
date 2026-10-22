// Phase 7.2a: EditionAuthority, the import policy, and the catalog-sync classification in every FORM_PIPELINE_AUTONOMY mode. Pure / injected: no database, no network.
const assert = require("node:assert/strict");
const test = require("node:test");
const EA = require("../services/EditionAuthority");
const importPolicy = require("../config/importPolicy");
const { classify, classifyLegacy, runCatalogSync } = require("../services/FormCatalogSyncService");

async function withMode(mode, fn, extraEnv = {}) {
  const keys = ["FORM_PIPELINE_AUTONOMY", "FORM_CATALOG_IMPORT_POLICY", "FORM_CATALOG_IMPORT_ALLOWLIST", "FORM_CATALOG_REVISION_CHECK", ...Object.keys(extraEnv)];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.FORM_PIPELINE_AUTONOMY = mode;
  Object.assign(process.env, extraEnv);
  try { return await fn(); } finally { for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } }
}
const d = (value) => new Date(`${value}T00:00:00Z`);
const NOW = new Date("2026-10-22T12:00:00Z");

// ---- EditionAuthority.decide ----------------------------------------------------------------------------------------------------------------------------------------
test("decide: page 'Edition Date' beats the PDF footer, which beats the directory", () => {
  const out = EA.decide({ pageEditionDate: d("2026-09-18"), pdfFooterEdition: d("2025-01-20"), directoryDate: d("2024-04-01"), storedEditionDate: d("2025-01-20"), now: NOW });
  assert.equal(EA.isoDay(out.editionDate), "2026-09-18");
  assert.equal(out.source, "page");
  assert.equal(out.status, "new");
  assert.deepEqual(out.conflicts.map((c) => [c.source, c.reason]), [["pdf_footer", "disagrees"], ["directory", "disagrees"]]);
  const noPage = EA.decide({ pdfFooterEdition: d("2025-01-20"), directoryDate: d("2024-04-01"), now: NOW });
  assert.equal(noPage.source, "pdf_footer");
  assert.equal(EA.decide({ directoryDate: "2024-04-01", now: NOW }).source, "directory");
});

test("decide: a date more than a day in the future is rejected and reported; the next source decides", () => {
  const out = EA.decide({ pageEditionDate: d("2026-12-01"), pdfFooterEdition: d("2025-01-20"), now: NOW });
  assert.equal(EA.isoDay(out.editionDate), "2025-01-20");
  assert.equal(out.source, "pdf_footer");
  assert.deepEqual(out.conflicts, [{ source: "page", date: "2026-12-01", reason: "future" }]);
  assert.equal(EA.decide({ pageEditionDate: d("2026-10-23"), now: NOW }).editionDate !== null, true, "tomorrow is within the one-day allowance");
  const none = EA.decide({ pageEditionDate: d("2027-01-01"), now: NOW });
  assert.equal(none.editionDate, null);
  assert.equal(none.status, "none");
});

test("decide: older than the installed edition is 'older, not new'; equal is 'same'; nothing installed (null) is new; unknown stored is 'unknown'", () => {
  assert.equal(EA.decide({ pageEditionDate: d("2024-04-01"), storedEditionDate: d("2025-01-20"), now: NOW }).status, "older");
  assert.equal(EA.decide({ pageEditionDate: d("2025-01-20"), storedEditionDate: d("2025-01-20"), now: NOW }).status, "same");
  assert.equal(EA.decide({ pageEditionDate: d("2025-01-20"), storedEditionDate: null, now: NOW }).status, "new");
  assert.equal(EA.decide({ pageEditionDate: d("2025-01-20"), now: NOW }).status, "unknown");
  assert.equal(EA.decide({}).status, "none");
  assert.equal(EA.decide({ pageEditionDate: "not a date" }).editionDate, null);
});

// ---- which PDF is the form ---------------------------------------------------------------------------------------------------------------------------------------
const A = (url, text) => ({ url, text });
test("isInstructionsPdf is decided by file name and the START of the link text", () => {
  assert.equal(EA.isInstructionsPdf(A("https://www.uscis.gov/x/i-539instr.pdf", "I-539 filing")), true);
  assert.equal(EA.isInstructionsPdf(A("https://www.uscis.gov/x/i-129h2ainstr.pdf", "Form I-129H2A")), true);
  assert.equal(EA.isInstructionsPdf(A("https://www.uscis.gov/x/i9-INS-Spanish.pdf", "Instructions for Form I-9 in Spanish")), true);
  assert.equal(EA.isInstructionsPdf(A("https://www.uscis.gov/x/i-9.pdf", "Form I-9 (Please see the Download Instructions tab on how to download this version.)")), false);
  assert.equal(EA.isInstructionsPdf(A("https://www.uscis.gov/x/i-485supj.pdf", "Form I-485, Supplement J (PDF, 422.11 KB)")), false);
});

test("choosePdf: the form itself, never instructions, a checklist, another form, or an off-site file", () => {
  const anchors = [
    A("https://www.justice.gov/eoir/x.pdf", "Matter of X"),
    A("https://www.uscis.gov/forms/i-129instr.pdf", "Instructions for Form I-129"),
    A("https://www.uscis.gov/forms/m-735.pdf", "Optional Checklist for Form I-129 H-1B Filings"),
    A("https://www.uscis.gov/forms/i-129h2a.pdf", "Form I-129H2A"),
    A("https://www.uscis.gov/forms/i-129.pdf", "Form I-129 (PDF)"),
  ];
  assert.equal(EA.choosePdf(anchors, "I-129").url, "https://www.uscis.gov/forms/i-129.pdf");
  assert.equal(EA.choosePdf(anchors.slice(0, 4), "I-129"), null, "no PDF names I-129: nothing is guessed");
  assert.equal(EA.choosePdf(anchors.slice(0, 4), "I-129", { allowFirstResort: true }).url, "https://www.uscis.gov/forms/m-735.pdf", "the old last resort still exists when asked for");
  assert.equal(EA.choosePdf([A("https://www.uscis.gov/forms/i-485supj.pdf", "x")], "I-485J", { aliasSlugs: ["i-485supj"] }).url, "https://www.uscis.gov/forms/i-485supj.pdf");
});

// ---- import policy ---------------------------------------------------------------------------------------------------------------------------------------------------------
test("importPolicy: default is 'all'; an invalid value is 'all'; an installed form is always kept current", () => {
  assert.equal(importPolicy.policyOf({}), "all");
  assert.equal(importPolicy.policyOf({ FORM_CATALOG_IMPORT_POLICY: "bogus" }), "all");
  assert.deepEqual(importPolicy.shouldImport({ formCode: "I-212" }, {}), { import: true, reason: "policy: all forms" });
  assert.equal(importPolicy.shouldImport({ formCode: "I-212", installed: true, policy: "allowlist", allowList: [] }).import, true);
});

test("importPolicy: allowlist and registry decide only about forms the software never had", () => {
  assert.equal(importPolicy.shouldImport({ formCode: "I-212", policy: "allowlist", allowList: ["i-130"] }).import, false);
  assert.equal(importPolicy.shouldImport({ formCode: "I-130", policy: "allowlist", allowList: ["i-130"] }).import, true);
  assert.equal(importPolicy.shouldImport({ formCode: "I-212", policy: "registry", registry: new Set(["I-129"]) }).import, false);
  assert.equal(importPolicy.shouldImport({ formCode: "I-129", policy: "registry", registry: new Set(["I-129"]) }).import, true);
  assert.equal(importPolicy.shouldImport({ formCode: "I-212", policy: "registry", registry: (code) => code === "I-212" }).import, true);
  assert.equal(importPolicy.shouldImport({ formCode: "I-212", policy: "registry", registry: new Set(), allowList: ["I-212"] }).import, true, "an allow-list entry also applies under 'registry'");
  assert.deepEqual(importPolicy.allowListOf({ FORM_CATALOG_IMPORT_ALLOWLIST: " i-212, G-639 ,," }), ["I-212", "G-639"]);
});

// ---- classify in every mode ----------------------------------------------------------------------------------------------------------------------------------------
const installed = (extra = {}) => ({ editionDate: d("2025-01-20"), ...extra });

test("classify: off is exactly the old function (an older page date still triggers an upgrade, I-864EZ is not standalone)", async () => {
  await withMode("off", () => {
    assert.deepEqual(classify({ formCode: "I-131", editionDate: d("2024-04-01") }, installed()), classifyLegacy({ formCode: "I-131", editionDate: d("2024-04-01") }, installed()));
    assert.equal(classify({ formCode: "I-131", editionDate: d("2024-04-01") }, installed()).action, "upgrade");
    assert.equal(classify({ formCode: "I-864EZ", editionDate: d("2026-08-24") }, null).action, "skip");
  });
});

test("classify: shadow answers like off and logs the difference", async () => {
  await withMode("shadow", () => {
    assert.equal(classify({ formCode: "I-131", editionDate: d("2024-04-01") }, installed()).action, "upgrade");
    assert.equal(classify({ formCode: "I-864EZ", editionDate: d("2026-08-24") }, null).action, "skip");
  });
});

test("classify: on - 'different' is new only when LATER; a future date is skipped; I-9 / I-864EZ / I-129CWR are standalone", async () => {
  await withMode("on", () => {
    assert.equal(classify({ formCode: "I-131", editionDate: d("2026-09-18") }, installed()).action, "upgrade");
    const older = classify({ formCode: "I-131", editionDate: d("2024-04-01") }, installed());
    assert.equal(older.action, "up_to_date");
    assert.match(older.reason, /newer/);
    assert.equal(classify({ formCode: "I-131", editionDate: d("2025-01-20") }, installed()).action, "up_to_date");
    const future = classify({ formCode: "I-131", editionDate: d("2099-01-01") }, installed());
    assert.equal(future.action, "skip");
    for (const code of ["I-9", "I-864EZ", "I-129CWR"]) assert.equal(classify({ formCode: code, editionDate: d("2026-08-24") }, null).action, "import_new", code);
    assert.equal(classify({ formCode: "EOIR-29", editionDate: null }, null).action, "skip");
    assert.equal(classify({ formCode: "I-131", editionDate: null }, installed()).action, "skip");
    assert.equal(classify({ formCode: "I-131", editionDate: d("2025-01-20") }, { editionDate: null }).action, "check_edition");
  });
});

test("classify: on - the same edition with a different official PDF file is a 'revision' (same kind of checksum only)", async () => {
  await withMode("on", () => {
    const stored = installed({ lifecycle: { sourceChecksum: "aaa" } });
    assert.equal(classify({ formCode: "I-131", editionDate: d("2025-01-20"), pdfSha256: "bbb" }, stored).action, "revision");
    assert.equal(classify({ formCode: "I-131", editionDate: d("2025-01-20"), pdfSha256: "aaa" }, stored).action, "up_to_date");
    assert.equal(classify({ formCode: "I-131", editionDate: d("2025-01-20"), pdfSha256: "bbb" }, installed()).action, "up_to_date", "nothing stored to compare with: unknown, not different");
    assert.equal(classify({ formCode: "I-131", editionDate: d("2026-09-18"), pdfSha256: "bbb" }, stored).action, "upgrade", "a newer edition is an upgrade, not a revision");
  });
});

// ---- the sync run ----------------------------------------------------------------------------------------------------------------------------------------------------------
function syncDeps({ forms, installedBy = {}, fingerprints = {}, extra = {} }) {
  const imported = [];
  return {
    imported,
    listPublishedForms: async () => forms,
    publishedEdition: async () => null,
    installedTemplate: async (code) => installedBy[code] || null,
    importForm: async (code) => { imported.push(code); return { template: { status: "active" }, requiresActivation: false }; },
    officialPdfFingerprint: async (code) => fingerprints[code] || null,
    ...extra,
  };
}
const FORMS = [
  { formCode: "I-129", editionDate: d("2026-09-09") },
  { formCode: "I-212", editionDate: d("2025-01-20") },
  { formCode: "G-639", editionDate: d("2020-10-01") },
  { formCode: "I-864EZ", editionDate: d("2026-08-24") },
];

test("sync run, off: unchanged (every new form is queued, the summary has no new keys)", async () => {
  await withMode("off", async () => {
    const deps = syncDeps({ forms: FORMS, installedBy: { "I-129": installed({ editionDate: d("2026-09-09") }) } });
    const summary = await runCatalogSync({ dryRun: true }, deps);
    assert.deepEqual([...summary.queued].sort(), ["G-639(import_new)", "I-212(import_new)"]);
    assert.equal("discoveredNotImported" in summary, false);
    assert.equal("revisionsDetected" in summary, false);
  });
});

test("sync run, on + allowlist policy: forms not on the list are reported as discoveredNotImported and never imported; installed forms stay current", async () => {
  await withMode("on", async () => {
    const deps = syncDeps({ forms: [...FORMS, { formCode: "I-131", editionDate: d("2026-09-18") }], installedBy: { "I-131": installed() } });
    const summary = await runCatalogSync({ user: null }, deps);
    assert.deepEqual(deps.imported.sort(), ["I-131", "I-212"]);
    assert.deepEqual(summary.discoveredNotImported.map((x) => x.formCode).sort(), ["G-639", "I-129", "I-864EZ"]);
    assert.ok(summary.discoveredNotImported.every((x) => x.reason));
  }, { FORM_CATALOG_IMPORT_POLICY: "allowlist", FORM_CATALOG_IMPORT_ALLOWLIST: "I-212" });
});

test("sync run, on + registry policy uses the injected registry; a registry failure never blocks the sync", async () => {
  await withMode("on", async () => {
    const deps = syncDeps({ forms: FORMS, extra: { registryCodes: async () => new Set(["I-129", "I-864EZ"]) } });
    const summary = await runCatalogSync({ dryRun: true }, deps);
    assert.deepEqual(summary.queued.sort(), ["I-129(import_new)", "I-864EZ(import_new)"]);
    assert.deepEqual(summary.discoveredNotImported.map((x) => x.formCode).sort(), ["G-639", "I-212"]);
    const broken = syncDeps({ forms: FORMS, extra: { registryCodes: async () => { throw new Error("db down"); } } });
    const again = await runCatalogSync({ dryRun: true }, broken);
    assert.equal(again.queued.length, 4);
    assert.deepEqual(again.discoveredNotImported, []);
  }, { FORM_CATALOG_IMPORT_POLICY: "registry" });
});

test("sync run, shadow + allowlist policy: reports nothing as excluded in the result and still imports everything", async () => {
  await withMode("shadow", async () => {
    const deps = syncDeps({ forms: FORMS });
    const summary = await runCatalogSync({ dryRun: true }, deps);
    assert.equal(summary.queued.length, 3, "I-864EZ is still \"not a standalone form\" under the old rule while shadowing");
    assert.equal(summary.newFormsFound, 3);
    assert.equal("discoveredNotImported" in summary, true);
  }, { FORM_CATALOG_IMPORT_POLICY: "allowlist", FORM_CATALOG_IMPORT_ALLOWLIST: "I-212" });
});

test("sync run, on: a silent revision is detected and reported, and queued only when the import path can act on it", async () => {
  await withMode("on", async () => {
    const stored = installed({ editionDate: d("2025-01-20"), lifecycle: { sourceChecksum: "aaa" } });
    const base = { forms: [{ formCode: "I-131", editionDate: d("2025-01-20") }], installedBy: { "I-131": stored }, fingerprints: { "I-131": { sha256: "bbb" } } };
    const detected = await runCatalogSync({ dryRun: true }, syncDeps(base));
    assert.deepEqual(detected.revisionsDetected, ["I-131"]);
    assert.deepEqual(detected.queued, []);
    const supported = await runCatalogSync({ dryRun: true }, syncDeps({ ...base, extra: { supportsRevisionImport: true } }));
    assert.deepEqual(supported.queued, ["I-131(revision)"]);
    const unchanged = await runCatalogSync({ dryRun: true }, syncDeps({ ...base, fingerprints: { "I-131": { sha256: "aaa" } } }));
    assert.deepEqual(unchanged.revisionsDetected, []);
    // a fingerprint that cannot be fetched is "unknown", never "different"
    const unreachable = await runCatalogSync({ dryRun: true }, syncDeps({ ...base, extra: { officialPdfFingerprint: async () => { throw new Error("503"); } } }));
    assert.deepEqual(unreachable.revisionsDetected, []);
    // the file fingerprint is not even requested when the check is switched off
    let asked = 0;
    await runCatalogSync({ dryRun: true }, syncDeps({ ...base, extra: { officialPdfFingerprint: async () => { asked += 1; return { sha256: "bbb" }; } } }), undefined);
    assert.equal(asked, 1);
  });
  await withMode("on", async () => {
    let asked = 0;
    const stored = installed({ editionDate: d("2025-01-20"), lifecycle: { sourceChecksum: "aaa" } });
    await runCatalogSync({ dryRun: true }, syncDeps({ forms: [{ formCode: "I-131", editionDate: d("2025-01-20") }], installedBy: { "I-131": stored }, extra: { officialPdfFingerprint: async () => { asked += 1; return { sha256: "bbb" }; } } }));
    assert.equal(asked, 0);
  }, { FORM_CATALOG_REVISION_CHECK: "false" });
  await withMode("off", async () => {
    let asked = 0;
    const stored = installed({ editionDate: d("2025-01-20"), lifecycle: { sourceChecksum: "aaa" } });
    await runCatalogSync({ dryRun: true }, syncDeps({ forms: [{ formCode: "I-131", editionDate: d("2025-01-20") }], installedBy: { "I-131": stored }, extra: { officialPdfFingerprint: async () => { asked += 1; return { sha256: "bbb" }; } } }));
    assert.equal(asked, 0, "off never fingerprints");
  });
});

// Phase 4 repair strategies, DB-free: injected fakes for the template model, the file storage, qpdf, the PDF reader and the certification. Proves each strategy's match rule,
// that a verified repair is recorded, that a repair which cannot be verified leaves the edition EXACTLY as it was, and the never-repair list.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { defaultStrategies, createRenormalizePdfStrategy, createRediscoverComponentsStrategy, createClearTemplateCacheStrategy, createCertificationInspector, refuses, NEVER_AUTO_REPAIR_CHECKS } = require("../repair");
const { LeaseLostError } = require("../errorClassifier");

const sha = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const pdf = (text) => Buffer.from(`%PDF-1.7\n${text}`);
const NAMES = ["form1[0].a[0]", "form1[0].b[0]", "form1[0].c[0]"];
const cloneDeep = (value) => JSON.parse(JSON.stringify(value));

// an in-memory template model: findById returns the live object, updateOne applies $set / $push / $pull on dotted paths
function fakeTemplateModel(initial) {
  const doc = initial;
  const walk = (path, create) => { const parts = path.split("."); const last = parts.pop(); let node = doc; for (const part of parts) { if (node[part] === undefined && create) node[part] = {}; node = node[part]; if (node === undefined) return [undefined, last]; } return [node, last]; };
  return {
    doc,
    updates: 0,
    findById: async () => doc,
    async updateOne(filter, update) {
      this.updates += 1;
      if (filter.status?.$ne && doc.status === filter.status.$ne) return { modifiedCount: 0 };
      for (const [path, value] of Object.entries(update.$set || {})) { const [node, last] = walk(path, true); node[last] = value; }
      for (const [path, value] of Object.entries(update.$push || {})) { const [node, last] = walk(path, true); node[last] = [...(node[last] || []), value]; }
      for (const [path, match] of Object.entries(update.$pull || {})) { const [node, last] = walk(path, false); if (node?.[last]) node[last] = node[last].filter((item) => !Object.entries(match).every(([k, v]) => item[k] === v)); }
      return { modifiedCount: 1 };
    },
  };
}
const template = (over = {}) => ({
  _id: "t1", formCode: "I-131", version: "2025-01-20", status: "review", pdfStorageKey: "gov/I-131/orig.pdf",
  artifacts: { form: { storageKey: "gov/I-131/orig.pdf", storagePath: "gov/I-131/orig.pdf", checksum: "oldsha", fileSize: 10 } },
  formFields: NAMES.map((name) => ({ pdfFieldName: name })),
  importMetadata: { validationSummary: { certification: { passed: false, checks: [{ name: "pdf_fillable", passed: false, detail: "the stored PDF exposes 0 fillable fields" }] } } },
  ...over,
});
const failure = (...checks) => Object.assign(new Error("certification failed"), { name: "CertificationFailed", code: "CERTIFICATION_FAILED", templateId: "t1", formCode: "I-131", failedChecks: checks.map(([name, detail]) => ({ name, detail })) });
const PDF_FILLABLE = failure(["pdf_fillable", "the stored PDF exposes 0 fillable fields"]);

function renormalizeDeps({ model, names = NAMES, certifyPasses = true, normalized = pdf("normalized") } = {}) {
  const original = pdf("original");
  const objects = new Map([["gov/I-131/orig.pdf", original]]);
  const deleted = [];
  return {
    objects, deleted, original,
    deps: {
      Template: model,
      storage: {
        readBuffer: async (key) => { if (!objects.has(key)) throw new Error(`missing ${key}`); return objects.get(key); },
        storeImmutableBuffer: async (key, buffer) => { objects.set(key, buffer); return { key, duplicate: false }; },
        deleteObject: async (key) => { deleted.push(key); objects.delete(key); return true; },
      },
      normalize: async () => normalized,
      loadFieldNames: async () => names,
      certify: async () => ({ passed: certifyPasses, checks: [{ name: "pdf_fillable", passed: certifyPasses, detail: "x" }] }),
      now: () => new Date("2026-10-22T00:00:00Z"),
    },
  };
}
const run = async (strategy, error, context = {}) => { await strategy.repair(error, context); return strategy.verify(error, context); };

test("renormalize_pdf matches an unloadable / field-short PDF, and not a mapping or value problem", () => {
  const strategy = createRenormalizePdfStrategy({});
  assert.equal(strategy.matches(PDF_FILLABLE), true);
  assert.equal(strategy.matches(failure(["pdf_fillable", "the PDF has 120 fields but 339 were scanned"])), true);
  assert.equal(strategy.matches(failure(["fill_roundtrip", "no mapped field accepted a value - the filled form would be blank"])), false);
  assert.equal(strategy.matches(failure(["viewer_download", "page count changed"])), false);
  assert.equal(strategy.matches(Object.assign(new Error("Failed to parse PDF document (line:1)"), {})), true);
  assert.equal(strategy.matches(new Error("socket hang up")), false);
  assert.equal(strategy.matches(null), false);
});

test("renormalize_pdf: a verified repair points the edition at a NEW copy, keeps the original object, records it, and the failed check now passes", async () => {
  const model = fakeTemplateModel(template());
  const { deps, objects, deleted, original } = renormalizeDeps({ model });
  const strategy = createRenormalizePdfStrategy(deps);
  const verification = await run(strategy, cloneDeep(PDF_FILLABLE));
  assert.match(verification, /^repaired: pdf_fillable pass now; 3 fields in the PDF, all 3 scanned field names present/);
  assert.match(model.doc.pdfStorageKey, /^gov\/I-131\/orig\.repaired-[0-9a-f]{12}\.pdf$/);
  assert.equal(model.doc.artifacts.form.storageKey, model.doc.pdfStorageKey);
  assert.equal(model.doc.artifacts.form.checksum, sha(pdf("normalized")));
  assert.deepEqual(deleted, [], "nothing is deleted on success");
  assert.equal(objects.get("gov/I-131/orig.pdf"), original, "the original object is untouched");
  const record = model.doc.importMetadata.validationSummary.repairs[0];
  assert.deepEqual([record.strategy, record.fromSha256 === sha(original), record.sha256 === sha(pdf("normalized"))], ["renormalize_pdf", true, true]);
});

test("renormalize_pdf: a candidate that would lose a field is refused BEFORE anything changes (nothing stored, nothing pointed)", async () => {
  const model = fakeTemplateModel(template());
  const { deps, objects } = renormalizeDeps({ model, names: NAMES.slice(0, 2) });
  const before = cloneDeep(model.doc);
  await assert.rejects(createRenormalizePdfStrategy(deps).repair(cloneDeep(PDF_FILLABLE), {}), /would lose 1 of 3 fields/);
  assert.deepEqual(model.doc, before);
  assert.equal(model.updates, 0);
  assert.deepEqual([...objects.keys()], ["gov/I-131/orig.pdf"], "no new object was written");
});

test("renormalize_pdf: identical bytes are 'nothing to repair', never reported as repaired", async () => {
  const model = fakeTemplateModel(template());
  const { deps, original } = renormalizeDeps({ model, normalized: pdf("original") });
  await assert.rejects(createRenormalizePdfStrategy(deps).repair(cloneDeep(PDF_FILLABLE), {}), /identical bytes/);
  assert.equal(sha(original), sha(pdf("original")));
  assert.equal(model.updates, 0);
});

test("renormalize_pdf: when the certification still fails after the repair, EVERYTHING is put back - pointers, previous certification, the new object", async () => {
  const model = fakeTemplateModel(template());
  const before = cloneDeep(model.doc);
  const { deps, objects, deleted } = renormalizeDeps({ model, certifyPasses: false });
  const verification = await run(createRenormalizePdfStrategy(deps), cloneDeep(PDF_FILLABLE));
  assert.match(verification, /^FAILED: pdf_fillable still fails after the repair/);
  const summary = model.doc.importMetadata.validationSummary;
  assert.deepEqual(summary.repairs, [], "the repair record was pulled again");
  delete summary.repairs; // (an emptied list is all a $pull leaves behind)
  assert.deepEqual(model.doc, before, "the edition is exactly as it was (pointers, checksum, certification report)");
  assert.equal(deleted.length, 1, "only the object this repair created is removed");
  assert.match(deleted[0], /repaired-/);
  assert.ok(objects.has("gov/I-131/orig.pdf"), "the original is never deleted");
});

test("renormalize_pdf never repairs a live edition or a job with no pending edition", async () => {
  const live = fakeTemplateModel(template({ status: "active" }));
  await assert.rejects(createRenormalizePdfStrategy(renormalizeDeps({ model: live }).deps).repair(cloneDeep(PDF_FILLABLE), {}), /refusing to repair a live edition/);
  const none = Object.assign(new Error("Failed to parse PDF document"), {});
  await assert.rejects(createRenormalizePdfStrategy(renormalizeDeps({ model: fakeTemplateModel(template()) }).deps).repair(none, { job: {} }), /nothing to repair/);
});

// ── rediscover_components ─────────────────────────────────────────────────────
function componentDeps({ ready = true, componentsPass = true, discoveryError = null } = {}) {
  const definitions = [{ _id: "d-old" }];
  const model = fakeTemplateModel(template({ importMetadata: {} }));
  return {
    definitions,
    deps: {
      Template: model,
      Definition: {
        find: () => ({ select: () => ({ lean: async () => definitions.map((item) => ({ ...item })) }) }),
        deleteMany: async ({ _id }) => { for (const id of _id.$in) { const at = definitions.findIndex((item) => item._id === id); if (at >= 0) definitions.splice(at, 1); } },
      },
      discover: async () => { if (discoveryError) return { error: discoveryError }; definitions.push({ _id: "d-new" }); return { results: [] }; },
      editionReady: async () => (ready ? { ready: true, problems: [], components: [{}, {}] } : { ready: false, problems: ["component X could not be sliced from the new edition"] }),
      previousEdition: async () => ({ _id: "prev" }),
      certify: async () => ({ checks: [{ name: "components_slice", passed: componentsPass }] }),
    },
  };
}
const COMPONENTS_BROKE = failure(["components_slice", "component slicing failed: NO_STORED_PDF"]);

test("rediscover_components matches only a BROKEN discovery, never a supplement that is really missing", () => {
  const strategy = createRediscoverComponentsStrategy({});
  assert.equal(strategy.matches(COMPONENTS_BROKE), true);
  assert.equal(strategy.matches(failure(["components_slice", "component I129_H could not be sliced from the new edition"])), false);
  assert.equal(strategy.matches(PDF_FILLABLE), false);
});

test("rediscover_components: success is verified by checkEditionReady AND the re-run certification", async () => {
  const { deps } = componentDeps();
  const verification = await run(createRediscoverComponentsStrategy(deps), cloneDeep(COMPONENTS_BROKE));
  assert.match(verification, /^repaired: components_slice passes now; 2 component\(s\) sliceable/);
});

test("rediscover_components: not verified -> the definitions this repair created are removed again", async () => {
  for (const options of [{ ready: false }, { componentsPass: false }]) {
    const { deps, definitions } = componentDeps(options);
    const verification = await run(createRediscoverComponentsStrategy(deps), cloneDeep(COMPONENTS_BROKE));
    assert.match(verification, /^FAILED/);
    assert.deepEqual(definitions.map((item) => item._id), ["d-old"], "only the pre-existing definition is left");
  }
  const { deps } = componentDeps({ discoveryError: "NO_STORED_PDF" });
  await assert.rejects(createRediscoverComponentsStrategy(deps).repair(cloneDeep(COMPONENTS_BROKE), {}), /discovery failed again/);
});

// ── clear_template_cache ──────────────────────────────────────────────────────
test("clear_template_cache: matches the stale-cache symptom; verified only when the cache agrees with the database; changes no stored document", async () => {
  const mk = (cached, stored) => createClearTemplateCacheStrategy({ invalidate: () => { mk.cleared = true; }, cachedActive: async () => cached, storedActive: async () => stored });
  assert.equal(mk().matches(Object.assign(new Error("x"), { code: "TEMPLATE_CACHE_STALE" })), true);
  assert.equal(mk().matches(new Error("the template cache is stale")), true);
  assert.equal(mk().matches(new Error("socket hang up")), false);
  const agree = await run(mk({ _id: "a" }, { _id: "a", version: "2025-01-20" }), Object.assign(new Error("x"), { formCode: "I-131" }));
  assert.match(agree, /^repaired: cache dropped; the cache and the database agree the live I-131 edition is 2025-01-20/);
  assert.equal(mk.cleared, true);
  assert.match(await run(mk({ _id: "old" }, { _id: "new" }), Object.assign(new Error("x"), { formCode: "I-131" })), /^FAILED: the cache still disagrees/);
});

// ── the never-repair list ─────────────────────────────────────────────────────
test("NEVER repaired automatically: mapping / party / box-value failures, edition-policy holds, lost leases, contract errors - whatever else also failed", () => {
  const strategies = defaultStrategies();
  assert.deepEqual([...NEVER_AUTO_REPAIR_CHECKS].sort(), ["mapping_valid", "party_markers", "widget_inputs"]);
  const unrepairable = [
    failure(["party_markers", "1 box would receive the wrong party's data"]),
    failure(["widget_inputs", "a tick box was given text"]),
    failure(["mapping_valid", "3 mapping errors"]),
    failure(["pdf_fillable", "the stored PDF exposes 0 fillable fields"], ["party_markers", "wrong party"]), // a repairable check next to a never-repair one: still a person's decision
    failure(["components_slice", "component slicing failed: x"], ["widget_inputs", "x"]),
    Object.assign(new Error("Failed to parse PDF"), { name: "EditionPolicyHeldError", code: "EDITION_POLICY_HELD" }),
    new LeaseLostError(),
    Object.assign(new Error("stale template cache"), { code: "MAPPING_CONTRACT_VIOLATION" }),
    Object.assign(new Error("stale template cache"), { code: "UNREVIEWED_EDITION_CHANGES" }),
    Object.assign(new Error("Failed to parse PDF"), { refuseRepair: true }),
  ];
  for (const error of unrepairable) {
    assert.equal(refuses(error), true, error.message);
    for (const strategy of strategies) assert.equal(strategy.matches(error), false, `${strategy.name} must refuse: ${error.message}`);
  }
  assert.equal(refuses(PDF_FILLABLE), false, "an ordinary repairable failure is not refused");
});

test("the registered strategies have unique names, the full interface, and a matches() that never throws", () => {
  const strategies = defaultStrategies();
  assert.deepEqual(strategies.map((item) => item.name), ["renormalize_pdf", "rediscover_components", "clear_template_cache"]);
  for (const strategy of strategies) {
    for (const fn of ["matches", "repair", "verify"]) assert.equal(typeof strategy[fn], "function", `${strategy.name}.${fn}`);
    for (const odd of [undefined, null, {}, { message: 5 }, { failedChecks: "x" }, { failedChecks: [null] }]) assert.doesNotThrow(() => strategy.matches(odd));
  }
});

// ── the certification inspector ───────────────────────────────────────────────
test("the inspector turns a stored failed certification of a PENDING edition into an error strategies can match; nothing else", async () => {
  const model = (doc) => ({ findById: () => ({ select: () => ({ lean: async () => doc }) }) });
  const failedDoc = { _id: "t9", formCode: "I-131", version: "v", status: "review", importMetadata: { validationSummary: { certification: { passed: false, checks: [{ name: "pdf_fillable", passed: false, detail: "0 fillable fields" }, { name: "viewer_download", passed: true }] } } } };
  const error = await createCertificationInspector({ Template: model(failedDoc) })({ requiresActivation: true, newTemplateId: "t9" });
  assert.equal(error.code, "CERTIFICATION_FAILED");
  assert.deepEqual(error.failedChecks, [{ name: "pdf_fillable", detail: "0 fillable fields" }]);
  assert.equal(createRenormalizePdfStrategy({}).matches(error), true);
  const none = async (doc, result) => createCertificationInspector({ Template: model(doc) })(result);
  assert.equal(await none(failedDoc, { requiresActivation: false, newTemplateId: "t9" }), null, "a promoted edition");
  assert.equal(await none(failedDoc, { requiresActivation: true, activationBlockedCode: "EDITION_POLICY_HELD", newTemplateId: "t9" }), null, "waiting for a decision, not a repair");
  assert.equal(await none({ ...failedDoc, status: "active" }, { requiresActivation: true, newTemplateId: "t9" }), null, "a live edition");
  assert.equal(await none({ ...failedDoc, importMetadata: { validationSummary: { certification: { passed: true, checks: [] } } } }, { requiresActivation: true, newTemplateId: "t9" }), null, "certified");
  assert.equal(await none(null, { requiresActivation: true, newTemplateId: "t9" }), null);
  assert.equal(await createCertificationInspector({ Template: model(failedDoc) })(null), null);
});

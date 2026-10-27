// DB-free: the cleanup of leftover non-live copies of a form. Every model is mocked; nothing here touches real data.
const assert = require("node:assert/strict");
const test = require("node:test");
const cleanup = require("../services/StaleEditionCleanupService");

const Template = require("../../../models/USCISFormTemplate");
const Job = require("../../../models/FormPipelineJob");
const MappingVersion = require("../../../models/USCISMappingVersion");
const REFERENCING = ["CaseForm", "CaseFormMigrationSnapshot", "FormMigrationReport", "CaseFormSelection", "FormAiMappingSuggestion", "QuestionLibraryItem", "Questionnaire", "USCISFormComponentDefinition"];
const VersionManagement = require("../../uscis-lifecycle/services/VersionManagementService");

const t = (id, version, status, editionDate, file) => ({ _id: id, version, status, editionDate: new Date(editionDate), pdfStorageKey: file });

function arrange(mock, { templates, openJobs = 0, referenced = {} }) {
  const calls = { deleted: [], mappingDeleted: [], retired: [] };
  mock.method(Template, "find", () => ({ select: () => ({ lean: async () => templates }) }));
  mock.method(Template, "countDocuments", async (query) => (referenced.newerEditions?.includes(String(query.parentVersion)) ? 1 : 0));
  mock.method(Template, "deleteOne", async (query) => { calls.deleted.push(String(query._id)); return { deletedCount: 1 }; });
  mock.method(Template, "distinct", async () => [...new Set(templates.filter((item) => item.status === "active").map(() => "I-485A"))]);
  mock.method(Job, "countDocuments", async () => openJobs);
  mock.method(MappingVersion, "deleteMany", async (query) => { calls.mappingDeleted.push(String(query.template)); return { deletedCount: 1 }; });
  mock.method(VersionManagement, "retire", async (id) => { calls.retired.push(String(id)); return {}; });
  for (const name of REFERENCING) {
    mock.method(require(`../../../models/${name}`), "countDocuments", async (query) => {
      const text = JSON.stringify(query);
      return (referenced[name] || []).some((id) => text.includes(id)) ? 1 : 0;
    });
  }
  return calls;
}

const live = t("live1", "2026-09-18", "active", "2026-09-18", "file-live");

test("a leftover copy of the live edition that nothing references is removed, with its mapping versions - and the stored PDF is never touched", async (context) => {
  const calls = arrange(context.mock, { templates: [live, t("dup1", "2026-10-07", "review", "2026-09-18", "file-dup")] });
  const result = await cleanup.cleanupForm("I-485A");
  assert.deepEqual(result.removed.map((item) => item.id), ["dup1"]);
  assert.deepEqual(calls.deleted, ["dup1"]);
  assert.deepEqual(calls.mappingDeleted, ["dup1"]);
  assert.ok(!calls.deleted.includes("live1"), "the live edition is never removed");
});

test("the cases must have finished moving: while a pipeline job of the form is open, nothing is removed", async (context) => {
  const calls = arrange(context.mock, { templates: [live, t("dup1", "2026-10-07", "review", "2026-09-18")], openJobs: 1 });
  const result = await cleanup.cleanupForm("I-485A");
  assert.equal(result.removed.length, 0);
  assert.match(result.kept[0].reason, /still open/);
  assert.deepEqual(calls.deleted, []);
});

test("nothing that is still referenced is ever removed: a copy a case form points at is only retired, and a retired one stays", async (context) => {
  const calls = arrange(context.mock, {
    templates: [live, t("old1", "2024-01-01", "review", "2024-01-01"), t("old2", "2023-01-01", "retired", "2023-01-01")],
    referenced: { CaseForm: ["old1", "old2"] },
  });
  const result = await cleanup.cleanupForm("I-485A");
  assert.deepEqual(calls.deleted, []);
  assert.deepEqual(result.retired.map((item) => item.id), ["old1"]);
  assert.deepEqual(calls.retired, ["old1"]);
  assert.equal(result.kept[0].reason, "still referenced");
  for (const kind of ["CaseFormMigrationSnapshot", "CaseFormSelection", "Questionnaire", "USCISFormComponentDefinition"]) {
    const calls2 = arrange(context.mock, { templates: [live, t("dupX", "2026-10-07", "review", "2026-09-18")], referenced: { [kind]: ["dupX"] } });
    await cleanup.cleanupForm("I-485A");
    assert.deepEqual(calls2.deleted, [], `${kind} reference blocks removal`);
  }
});

test("a NEWER edition is a pending upgrade and is never touched, and a form with no live edition is left alone", async (context) => {
  const calls = arrange(context.mock, { templates: [live, t("newer1", "2027-01-01", "review", "2027-01-01")] });
  const result = await cleanup.cleanupForm("I-485A");
  assert.deepEqual(calls.deleted, []);
  assert.match(result.kept[0].reason, /newer/);
  const calls2 = arrange(context.mock, { templates: [t("only1", "2026-09-18", "review", "2026-09-18")] });
  assert.deepEqual((await cleanup.cleanupForm("I-485A")).removed, []);
  assert.deepEqual(calls2.deleted, []);
});

test("a code that is not a form (I-854: only I-854A and I-854B exist) is cleared even though it has no live edition - when nothing references it", async (context) => {
  const calls = arrange(context.mock, { templates: [t("stray1", "2025-01-20", "retired", "2025-01-20")] });
  const result = await cleanup.cleanupForm("I-854");
  assert.deepEqual(result.removed.map((item) => item.id), ["stray1"]);
  assert.deepEqual(calls.deleted, ["stray1"]);
  // ...but not while something still points at it
  const calls2 = arrange(context.mock, { templates: [t("stray2", "2025-01-20", "retired", "2025-01-20")], referenced: { CaseForm: ["stray2"] } });
  assert.deepEqual((await cleanup.cleanupForm("I-854")).removed, []);
  assert.deepEqual(calls2.deleted, []);
});

test("dry run changes nothing, and a failing database never throws out of cleanupAll", async (context) => {
  const calls = arrange(context.mock, { templates: [live, t("dup1", "2026-10-07", "review", "2026-09-18")] });
  const result = await cleanup.cleanupForm("I-485A", { dryRun: true });
  assert.equal(result.removed.length, 1, "reports what it would remove");
  assert.deepEqual(calls.deleted, []);
  assert.deepEqual(calls.mappingDeleted, []);
  context.mock.method(Template, "distinct", async () => { throw new Error("db down"); });
  const summary = await cleanup.cleanupAll();
  assert.equal(summary.forms, 0);
});

test("a 'newer' copy whose PDF is proven to be ANOTHER form (a wrong file) is cleared; a genuine newer edition and an unprovable one are kept", async (context) => {
  const storage = require("../../uploads/storage.service");
  const Identity = require("../services/FormIdentityService");
  context.mock.method(storage, "readBuffer", async () => Buffer.from("%PDF-"));
  const calls = arrange(context.mock, { templates: [live, { ...t("wrong1", "2026-02-01", "review", "2027-02-01"), pdfStorageKey: "k-wrong" }] });
  context.mock.method(Identity, "check", async () => ({ ok: false, found: "EOIR-29" }));
  const wrong = await cleanup.cleanupForm("I-485A");
  assert.deepEqual(calls.deleted, ["wrong1"]);
  assert.equal(wrong.removed[0].wrongForm, true);

  const calls2 = arrange(context.mock, { templates: [live, { ...t("genuine1", "2027-01-01", "review", "2027-01-01"), pdfStorageKey: "k-ok" }] });
  Identity.check.mock.mockImplementation(async () => ({ ok: true }));
  assert.match((await cleanup.cleanupForm("I-485A")).kept[0].reason, /newer/);
  assert.deepEqual(calls2.deleted, []);

  const calls3 = arrange(context.mock, { templates: [live, { ...t("unsure1", "2027-01-01", "review", "2027-01-01"), pdfStorageKey: "k-x" }] });
  Identity.check.mock.mockImplementation(async () => ({ ok: true, inconclusive: true }));
  await cleanup.cleanupForm("I-485A");
  assert.deepEqual(calls3.deleted, [], "no proof means no removal");
  storage.readBuffer.mock.mockImplementation(async () => { throw new Error("storage down"); });
  await cleanup.cleanupForm("I-485A");
  assert.deepEqual(calls3.deleted, [], "an unreadable file is not proof either");
});

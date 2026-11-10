// L-1A Extension = its own copy of every L-1A checklist (same questions/documents/logic), under its own keys and visa type.
const assert = require("node:assert/strict");
const test = require("node:test");
const { EMPLOYMENT_CHECKLIST_DEFINITIONS } = require("../employmentChecklists");
const questionnaireRegistry = require("../../employment-workflow/questionnaires/registry");
const { ENTRIES } = require("../../form-registry/seeds/checklistMappings.seed");

const byKey = (key) => EMPLOYMENT_CHECKLIST_DEFINITIONS.find((d) => d.key === key);
const { RETIRED_L1A_CHECKLIST_KEYS } = require("../l1aDocumentChecklists");
const ROLES = ["document", "business_plan"]; // L-1A / L-1A Extension are served by ONE document checklist + the business plan (the old employer / employee pair is retired)

test("l1aext_* document + business plan checklists exist, scoped to L-1A Extension only", () => {
  for (const role of ROLES) {
    const copy = byKey(`l1aext_${role}_checklist`);
    assert.ok(copy, `l1aext_${role}_checklist`);
    assert.equal(copy.visaType, "L1AEXTENSION");
    assert.deepEqual(copy.visaTypes, ["L1AEXTENSION", "L-1A Extension"]);
    assert.ok(!/L-1A(?! Extension)/.test(`${copy.title} ${copy.description}`), "titles say L-1A Extension, not plain L-1A");
  }
  assert.ok(!byKey("l1a_document_checklist").visaTypes.includes("L-1A Extension"), "plain L-1A checklists do not serve extension cases");
});

test("each extension checklist has exactly the same sections and questions as the L-1A one", () => {
  for (const role of ROLES) {
    const original = byKey(`l1a_${role}_checklist`);
    const copy = byKey(`l1aext_${role}_checklist`);
    assert.deepEqual(copy.sections, original.sections);
    assert.deepEqual(copy.questions.map((q) => q.key), original.questions.map((q) => q.key));
    assert.deepEqual(copy.assignmentRules, original.assignmentRules, "same assignment rules (business plan stays New-Office only)");
    assert.equal(copy.checklistRole, original.checklistRole);
  }
});

test("the L1A Documentation Checklist: ONE employer-role checklist, exactly three sections (11 + 16 + 4 = 31 questions), all required, numbered within their section", () => {
  const sections = ["Documents from the U.S. Company", "Documents from the Foreign (outside U.S.) Company", "Documents Pertaining to Beneficiary, Spouse and Child"];
  for (const key of ["l1a_document_checklist", "l1aext_document_checklist"]) {
    const doc = byKey(key);
    assert.match(doc.title, /Documentation Checklist$/);
    assert.equal(doc.checklistRole, "employer");
    assert.equal(doc.isDefault, true);
    assert.equal(doc.settings.inlineDocuments, true, "uploads stay inside their sections: only these three sections show");
    assert.deepEqual(doc.sections, sections, "exactly these three sections, in this order");
    assert.equal(doc.questions.length, 31);
    assert.deepEqual(sections.map((title) => doc.questions.filter((q) => q.sectionKey === require("../definitionHelpers").slugSection(title)).length), [11, 16, 4]);
    assert.ok(doc.questions.every((q) => q.required === true), "all 31 are required");
    assert.equal(new Set(doc.questions.map((q) => q.key)).size, doc.questions.length, "no duplicate question keys");
    // numbered 1..N inside each section
    for (const title of sections) {
      const labels = doc.questions.filter((q) => q.sectionKey === require("../definitionHelpers").slugSection(title)).map((q) => q.label);
      labels.forEach((label, index) => assert.ok(label.startsWith(`${index + 1}. `), `${title}: "${label}" should start with ${index + 1}.`));
    }
  }
});

test("answer types: uploads for the documents, short answers for the two websites, a long answer for the managerial duties (one question holding all four areas), one upload for the emails / memos (all four points)", () => {
  const doc = byKey("l1a_document_checklist");
  const q = (key) => doc.questions.find((item) => item.key === key);
  assert.equal(doc.questions.filter((item) => item.type === "file").length, 28);
  for (const key of ["us_company_website", "foreign_company_website"]) {
    assert.equal(q(key).type, "text");
    assert.ok((q(key).validationRules || []).some((rule) => rule.type === "regex"), "a web-address check");
  }
  const duties = q("employer_foreignCompany_managerialDuties");
  assert.equal(duties.type, "textarea");
  // the four parts are written INSIDE the question text, one per line as a, b, c, d (every screen shows the question text; not every screen shows a description)
  const lines = (question) => question.label.split("\n");
  assert.equal(lines(duties)[0], "13. Detailed Managerial Duties at foreign entity as per following sections and % of each:");
  assert.equal(lines(duties).length, 5, "the question line + four parts");
  ["a", "b", "c", "d"].forEach((letter, index) => assert.ok(lines(duties)[index + 1].trim().startsWith(`${letter}. `), `13 part ${letter}`));
  assert.ok(lines(duties)[1].includes("Manages a corporation, department, subdivision, or function."));
  assert.ok(lines(duties)[4].includes("for which he or she has authority."));
  const emails = q("beneficiary_correspondence_evidence");
  assert.equal(emails.type, "file");
  assert.equal(lines(emails)[0], "14. Copies of emails, memos, letters and other such dispatches from beneficiary (in a foreign country) that show:");
  assert.equal(lines(emails).length, 5, "the question line + four parts");
  ["a", "b", "c", "d"].forEach((letter, index) => assert.ok(lines(emails)[index + 1].trim().startsWith(`${letter}. `), `14 part ${letter}`));
  assert.ok(lines(emails)[1].includes("Beneficiary supervising and controlling the work of the subordinate staff in the organizational chart."));
  assert.ok(lines(emails)[4].includes("Performance reviews by beneficiary for the subordinate staff for one continuous year."));
  // no other question has parts
  assert.equal(doc.questions.filter((item) => item.label.includes("\n")).length, 2);
  // the managerial duties answer is an answer, not a document: the case page's "Required Documents" list stays uploads-only
  assert.equal(doc.questions.filter((item) => item.metadata?.listAsRequiredDocument).length, 0);
  // bullet lists
  assert.equal(q("us_business_premises_photographs").description.split("\n").filter((line) => line.startsWith("• ")).length, 4);
  assert.equal(q("foreign_business_premises_photographs").description, q("us_business_premises_photographs").description);
  // the website check accepts real addresses and refuses junk
  const rule = new RegExp(q("us_company_website").validationRules[0].value);
  ["www.example.com", "https://example.com/about", "http://acme.co.in"].forEach((value) => assert.ok(rule.test(value), value));
  ["", "not a website", "example"].forEach((value) => assert.ok(!rule.test(value), value));
});

test("the questions come in the supplied order (one running order number across the three sections)", () => {
  for (const key of ["l1a_document_checklist", "l1aext_document_checklist"]) {
    const doc = byKey(key);
    const orders = doc.questions.map((item) => item.order);
    assert.deepEqual(orders, orders.map((_, index) => index + 1));
    const titles = doc.questions.map((item) => item.label.replace(/^\d+\. /, ""));
    assert.equal(titles[0], "Articles of Incorporation");
    assert.equal(titles[1], "EIN Assignment Letter by the Internal Revenue Service");
    assert.equal(titles[10], "Letterhead in Microsoft Word Format");
    assert.equal(titles[11], "Business Registration Documents");
    assert.equal(titles[22], "Extract from the Minutes of the Meeting of the Directors or Other Official Documentation Regarding Dispatching the Beneficiary to the U.S.");
    assert.equal(titles[26], "Letterhead in Microsoft Word Format");
    assert.equal(titles[27], "Employment Verification Letter from the Foreign Company's HR Department");
    assert.equal(titles[30], "Passports of Beneficiaries");
  }
});

test("uploads behave exactly like the old L-1A checklists' uploads: same document type and category per document, so storage records, the Admin documents list and the progress gates are fed the same way", () => {
  const { documentTypeForQuestion, documentCategoryFor } = require("../questionnaire.service");
  const Document = require("../../../models/Document");
  // L-1B still carries the original L-1A employer + employee questions (same keys, same document types), so it is the reference for "as before"
  const before = new Map([...byKey("l1b_employer_checklist").questions, ...byKey("l1b_employee_checklist").questions].filter((q) => q.type === "file").map((q) => [q.key, q]));
  for (const key of ["l1a_document_checklist", "l1aext_document_checklist"]) {
    const files = byKey(key).questions.filter((q) => q.type === "file");
    assert.equal(files.length, 28);
    for (const question of files) {
      assert.equal(documentTypeForQuestion(question), question.key, `${question.key}: stored under its own document type`);
      const category = documentCategoryFor(question).category;
      assert.ok(Document.DOCUMENT_CATEGORIES ? Document.DOCUMENT_CATEGORIES.includes(category) : category !== "other", `${question.key}: category ${category} is a real Document category`);
      const old = before.get(question.key);
      if (old) {
        assert.equal(documentTypeForQuestion(old), documentTypeForQuestion(question), `${question.key}: same document type as before`);
        assert.equal(documentCategoryFor(old).category, category, `${question.key}: same category as before`);
      }
    }
    // every document of the old pair (except the two I-94 / previous-notice extras and the old Stock / LOI additions) is still asked for
    const keys = new Set(files.map((q) => q.key));
    ["us_articles_of_incorporation", "ein_assignment_letter", "us_business_license", "us_lease_agreement", "foreign_business_registration", "minutes_dispatching_beneficiary", "passport", "academic_certificates", "updated_resume", "foreign_employment_verification_letter"].forEach((documentType) => assert.ok(keys.has(documentType), documentType));
  }
});

test("the old L-1A / L-1A Extension employer + employee checklists are retired: not defined any more, and the retired list names exactly them", () => {
  assert.deepEqual([...RETIRED_L1A_CHECKLIST_KEYS].sort(), ["l1a_employee_checklist", "l1a_employer_checklist", "l1aext_employee_checklist", "l1aext_employer_checklist"]);
  for (const key of RETIRED_L1A_CHECKLIST_KEYS) assert.equal(byKey(key), undefined, `${key} must not be defined (it would be re-created and offered again)`);
  // L-1B still has its own pair; nothing else was touched
  assert.ok(byKey("l1b_employer_checklist") && byKey("l1b_employee_checklist"));
});

test("a retired checklist cannot be assigned to a case that does not carry it, but a case that already carries it keeps it", () => {
  const { isRetiredChecklistFor } = require("../questionnaire.service");
  const old = { _id: "q-old", key: "l1a_employee_checklist" };
  const fresh = { _id: "q-new", key: "l1a_document_checklist" };
  assert.equal(isRetiredChecklistFor(old, { questionnaireReferences: [] }), true, "new case: blocked");
  assert.equal(isRetiredChecklistFor(old, { questionnaireReferences: [{ questionnaireId: "q-old" }] }), false, "existing case with it: untouched");
  assert.equal(isRetiredChecklistFor(old, { questionnaireReferences: [{ questionnaireTemplateId: "q-old" }] }), false);
  assert.equal(isRetiredChecklistFor(fresh, { questionnaireReferences: [] }), false, "the new checklist is never blocked");
});

test("the L-1A employment workflow (employer data entry / invite employee) serves an L-1A Extension case", () => {
  assert.ok(questionnaireRegistry.getDefinition("L-1A Extension"));
  assert.equal(questionnaireRegistry.getDefinition("L-1A Extension"), questionnaireRegistry.getDefinition("L-1A"));
  assert.ok(questionnaireRegistry.standardDocuments("L-1A Extension").length > 0);
});

test("L-1A Extension maps the same forms to the same checklists as L-1A", () => {
  const rows = (visaType) => ENTRIES.filter((e) => e.visaType === visaType).map((e) => `${e.formNumber}:${e.checklistMappings.map((c) => c.checklistKey.replace(/^l1a(ext)?_/, "")).join(",")}`).sort();
  assert.ok(ENTRIES.some((e) => e.visaType === "L-1A Extension"));
  assert.deepEqual(rows("L-1A Extension"), rows("L-1A"));
});

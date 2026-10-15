const assert = require("node:assert/strict");
const test = require("node:test");
const { itemsOfTitle, evaluateRequest, sameRecipientRole } = require("../request-fulfilment");

// DB-free: the real TN employee checklist questions and the real request titles a case manager typed.
const tn = require("../../employment-workflow/questionnaires/tn");
const fieldQuestions = tn.fieldCatalog().filter((entry) => entry.section === "employee").map((entry) => ({ key: entry.path, label: entry.label }));
const docQuestions = tn.beneficiaryDocuments.map((doc) => ({ key: doc.documentType, label: doc.name }));
const questions = [...fieldQuestions, ...docQuestions];
const key = (label) => questions.find((q) => q.label.startsWith(label)).key;

const TITLES = {
  address: "Current U.S. Address (street, apt#, city, state and zip code)",
  denied: "Has the employee been denied a TN visa during the previous 7 years? Needed Is any person included in the matter in removal proceedings?",
  credential: "Copy of Educational Credential Evaluation Report ( If needs to be US equivalent)",
  i797AndStamp: "All I-797 (Prior Notice/Receipt of Approvals) or latest Visa Stamp, Copy of Educational Credential Evaluation Report",
  messy: "Copy of the Previous Work Experience Letters, Copy of SSN, All I-797 (Prior Notice/Receipt of Approval,Copy of US Driver's License or State Identification Card, if any Must Be Signed by Bearer, if any",
};

test("titles are split into the items they name; notes and 'if any' noise are dropped", () => {
  assert.deepEqual(itemsOfTitle(TITLES.address), ["current u s address"]);
  assert.deepEqual(itemsOfTitle(TITLES.credential), ["copy of educational credential evaluation report"]);
  assert.equal(itemsOfTitle(TITLES.denied).length, 2);
  assert.ok(!itemsOfTitle(TITLES.messy).some((item) => item.startsWith("if any") || item.startsWith("must be signed")));
});

test("a request is Received once the client has answered what it names, and stays open until then", () => {
  const addressKey = key("Current U.S. Address");
  assert.equal(evaluateRequest(TITLES.address, questions, {}).fulfilled, false, "nothing answered");
  const done = evaluateRequest(TITLES.address, questions, { [addressKey]: { value: "1 Main St, Austin TX 78701" } });
  assert.equal(done.fulfilled, true);
  assert.deepEqual(done.questionKeys, [addressKey]);
  assert.equal(evaluateRequest(TITLES.address, questions, { [addressKey]: { value: "   " } }).fulfilled, false, "a blank answer does not count");
});

test("a document request is satisfied by an uploaded file on the matching checklist document", () => {
  const credential = key("Copy of Educational Credential Evaluation Report");
  assert.equal(evaluateRequest(TITLES.credential, questions, { [credential]: { value: [], files: [] } }).fulfilled, false);
  assert.equal(evaluateRequest(TITLES.credential, questions, { [credential]: { value: ["a.pdf"], files: [{ originalName: "a.pdf" }] } }).fulfilled, true);
});

test("a request naming several items needs ALL of them; an item we cannot match keeps it open", () => {
  const denied = key("Has the employee been denied a TN visa");
  const removal = key("Is any person included in the matter in removal proceedings");
  assert.equal(evaluateRequest(TITLES.denied, questions, { [denied]: { value: "No" } }).fulfilled, false, "only one of two answered");
  assert.equal(evaluateRequest(TITLES.denied, questions, { [denied]: { value: "No" }, [removal]: { value: "No" } }).fulfilled, true);
  // "latest Visa Stamp" is not a checklist question: never closed on a guess
  const credential = key("Copy of Educational Credential Evaluation Report");
  const result = evaluateRequest(TITLES.i797AndStamp, questions, { [credential]: { files: [{ originalName: "a.pdf" }] }, [key("All I-797")]: { files: [{ originalName: "b.pdf" }] } });
  assert.equal(result.fulfilled, false);
  assert.ok(result.unmatched.length >= 1);
});

test("the messy multi-document request is satisfied only when every named document is uploaded", () => {
  const answers = {
    [key("Copy of the Previous Work Experience Letters")]: { files: [{ originalName: "w.pdf" }] },
    [key("Copy of SSN")]: { files: [{ originalName: "s.pdf" }] },
    [key("All I-797")]: { files: [{ originalName: "i.pdf" }] },
  };
  assert.equal(evaluateRequest(TITLES.messy, questions, answers).fulfilled, false, "driver's licence still missing");
  answers[key("Copy of US Driver")] = { files: [{ originalName: "d.pdf" }] };
  assert.equal(evaluateRequest(TITLES.messy, questions, answers).fulfilled, true);
});

test("very short or unrelated titles never match by accident", () => {
  assert.equal(evaluateRequest("Passport", questions, { [key("Passport Number")]: { value: "X1" } }).fulfilled, false);
  assert.equal(evaluateRequest("", questions, {}).fulfilled, false);
});

test("recipient roles line up for every case shape (employer matter, family, individual / single-party)", () => {
  assert.ok(sameRecipientRole("beneficiary", "employee") && sameRecipientRole("employee", "beneficiary"));
  assert.ok(sameRecipientRole("petitioner", "employer") && sameRecipientRole("employer", "petitioner"));
  assert.ok(sameRecipientRole("employer", "business_plan") && sameRecipientRole("petitioner", "supporting_documents"), "the employer side's other checklists");
  assert.ok(sameRecipientRole("petitioner", "petitioner") && sameRecipientRole("beneficiary", "beneficiary"), "family cases");
  assert.ok(sameRecipientRole("client", "client"), "individual / single-party filings");
  assert.ok(!sameRecipientRole("employee", "employer") && !sameRecipientRole("client", "employer") && !sameRecipientRole("", "client"));
});

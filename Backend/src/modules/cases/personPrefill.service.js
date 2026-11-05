// One login, many cases - Phase 3A (docs/MULTI_CASE_CLIENTS_PLAN.md): when a person who already has a case gets another one, the new case's
// checklist is PRE-FILLED with that person's own facts from their earlier cases - matched by MEANING, never by question text.
//
// Rules (owner: auto-copy, never overwrite):
//   - only into a checklist about the person themselves (client / petitioner / employee / beneficiary) - never an employer / company checklist
//   - from the same person's own answers on their earlier cases (where they were the client / petitioner / employee / beneficiary), newest first
//   - only identity / contact / passport / current-address facts (ALLOWED below); never other people (father, spouse, children, household),
//     employment, immigration status, signatures / declarations, files or history lists
//   - "self" namespace per checklist: the party namespace most of its questions use (petitioner.* on a single-person or petitioner checklist,
//     beneficiary.* on an employee / beneficiary / NVC checklist); a question under the OTHER namespace is someone else (a sponsor, the employer,
//     the H-1B spouse) and is never matched
//   - never over an answer the new case already has; a drop-down only gets a value that is one of its options; a date only when it is unambiguous
//   - copied as the new case's own answers (it can be edited there; the earlier case is never written), marked on each answer's audit history and on
//     the case timeline with the source case
//   - never throws: any problem is logged and the case simply keeps its empty checklist
const Case = require("../../models/Case");
const logger = require("../../utils/logger");

const SYSTEM_ACTOR = { _id: undefined, role: "super_admin" };
const PERSON_ROLES = new Set(["client", "petitioner", "employee", "beneficiary"]);
const CAPACITY_ROLE = { client: "client", petitioner: "petitioner", employee: "employee", beneficiary: "beneficiary" };
const PARTY_NAMESPACES = new Set(["petitioner", "beneficiary"]);
const PREFILL_ACTION = "prefilled_from_earlier_case";

// one person-level fact <- every way a checklist names it (after the party namespace)
const FACT_ALIASES = {
  firstName: ["firstName", "person.firstName"],
  middleName: ["middleName", "person.middleName"],
  lastName: ["lastName", "person.lastName"],
  dateOfBirth: ["dateOfBirth", "dob", "person.dob", "person.dateOfBirth"],
  gender: ["gender", "person.gender"],
  maritalStatus: ["maritalStatus", "person.maritalStatus"],
  countryOfBirth: ["countryOfBirth", "person.countryOfBirth"],
  cityTownOfBirth: ["cityTownOfBirth", "person.cityTownOfBirth"],
  provinceOfBirth: ["provinceOfBirth", "person.provinceOfBirth"],
  countryOfCitizenship: ["countryOfCitizenship", "nationality", "citizenship", "person.citizenship", "person.countryOfCitizenship"],
  aNumber: ["aNumber", "alienRegistrationNumber", "alienNumber", "person.alienNumber"],
  ssn: ["ssn", "person.ssn"],
  uscisOnlineAccountNumber: ["uscisOnlineAccountNumber", "person.uscisOnlineAccountNumber"],
  email: ["email", "contact.email"],
  phone: ["phone", "primaryPhone", "daytimePhone", "contact.phone"],
  mobilePhone: ["mobilePhone", "contact.mobilePhone"],
  "passport.number": ["passport.number", "passportNumber", "person.passport.number"],
  "passport.country": ["passport.country", "passportCountry", "person.passport.country"],
  "passport.issueDate": ["passport.issueDate", "person.passport.issueDate"],
  "passport.expirationDate": ["passport.expirationDate", "person.passport.expirationDate"],
  "address.line1": ["address.line1", "address", "contact.address.line1"],
  "address.line2": ["address.line2", "apartment", "contact.address.line2"],
  "address.city": ["address.city", "city", "contact.address.city"],
  "address.state": ["address.state", "state", "contact.address.state"],
  "address.zip": ["address.zip", "address.postalCode", "zipCode", "contact.address.zip"],
  "address.country": ["address.country", "country", "contact.address.country"],
  "address.formatted": ["currentAddress.formatted", "contact.address.formatted"],
  "foreignAddress.line1": ["foreignAddress.line1", "contact.foreignAddress.line1"],
  "foreignAddress.line2": ["foreignAddress.line2", "contact.foreignAddress.line2"],
  "foreignAddress.city": ["foreignAddress.city", "contact.foreignAddress.city"],
  "foreignAddress.state": ["foreignAddress.state", "contact.foreignAddress.state"],
  "foreignAddress.province": ["foreignAddress.province", "contact.foreignAddress.province"],
  "foreignAddress.postalCode": ["foreignAddress.postalCode", "contact.foreignAddress.postalCode"],
  "foreignAddress.country": ["foreignAddress.country", "contact.foreignAddress.country"],
  "foreignAddress.formatted": ["foreignAddress.formatted", "contact.foreignAddress.formatted"],
};
const FACT_BY_NAME = new Map(Object.entries(FACT_ALIASES).flatMap(([fact, names]) => names.map((name) => [name, fact])));
const SKIPPED_TYPES = new Set(["file", "repeating_group", "signature", "group", "section", "heading", "info", "address"]);

const hasValue = (value) => value !== undefined && value !== null && !(typeof value === "string" && !value.trim()) && !(Array.isArray(value) && !value.length) && !(typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length);
const pathOf = (question) => String(question?.mapping?.canonicalPath || "");

/** Pure: the party namespace most of this checklist's questions use ("self"), or "" when it has none (person.* / contact.* checklists). */
function selfNamespace(questions = []) {
  const counts = {};
  for (const question of questions) {
    const ns = pathOf(question).split(".")[0];
    if (PARTY_NAMESPACES.has(ns)) counts[ns] = (counts[ns] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

/** Pure: the person-level fact a question asks for (or null): only the checklist's "self" namespace or person.* / contact.*. */
function factOf(question, self) {
  if (!question || SKIPPED_TYPES.has(String(question.type || "").toLowerCase())) return null;
  const path = pathOf(question);
  if (!path) return null;
  const [ns, ...rest] = path.split(".");
  if (ns === "person" || ns === "contact") return FACT_BY_NAME.get(path) || null;
  if (!PARTY_NAMESPACES.has(ns) || ns !== self) return null; // the other party is someone else (sponsor / employer / spouse)
  return FACT_BY_NAME.get(rest.join(".")) || null;
}

/** Pure: an unambiguous yyyy-mm-dd for a date answer, or null (a dd/mm vs mm/dd that cannot be told apart is never guessed). */
function normalizeDate(value) {
  const text = String(value ?? "").trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(text);
  if (match) return valid(+match[1], +match[2], +match[3]);
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (!match) return null;
  const [first, second, year] = [+match[1], +match[2], +match[3]];
  if (first > 12 && second <= 12) return valid(year, second, first); // dd/mm/yyyy
  if (second > 12 && first <= 12) return valid(year, first, second); // mm/dd/yyyy
  if (first === second) return valid(year, first, second);
  return null; // both <= 12 and different (03/04/1990): day/month cannot be told apart - never guessed, the question is left for the person
  function valid(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCMonth() === m - 1 ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
  }
}

/** Pure: the value to write into `target` from a source answer, or undefined when it does not fit (type / options / date). */
function valueFor(target, value) {
  const type = String(target.type || "").toLowerCase();
  if (typeof value === "object" && value !== null) return undefined; // structured values are not carried over
  if (type === "date") return normalizeDate(value) || undefined;
  const options = (target.options || []).map((option) => (typeof option === "object" ? option.value ?? option.label : option)).filter((option) => option !== undefined);
  if (["select", "radio", "dropdown"].includes(type) && options.length) {
    const hit = options.find((option) => String(option).trim().toLowerCase() === String(value).trim().toLowerCase());
    return hit === undefined ? undefined : hit;
  }
  return value;
}

const allQuestions = (bundle) => [...(bundle?.questions || []), ...(bundle?.hiddenQuestions || []), ...(bundle?.completedQuestions || [])];

async function loadChecklist(caseId, role, actor) {
  try {
    return await require("../questionnaires/questionnaire.service").getQuestionnaireForCase(caseId, actor, role);
  } catch (error) {
    return null;
  }
}

/**
 * Pre-fills the person's checklist on `caseId` from their earlier cases. Never throws.
 * @returns {Promise<{status: string, copied?: number, fromCases?: string[]}>}
 */
async function prefillPersonFromEarlierCases(caseId, personId, { targetRole, actor = SYSTEM_ACTOR, now = () => new Date() } = {}) {
  try {
    if (!caseId || !personId || !PERSON_ROLES.has(targetRole)) return { status: "not_a_person_checklist" };
    const target = await Case.findById(caseId).select("caseNumber createdAt").lean();
    if (!target) return { status: "no_case" };
    const fresh = await loadChecklist(caseId, targetRole, actor);
    if (!fresh?.questionnaire) return { status: "no_checklist" };
    const freshQuestions = allQuestions(fresh);
    const freshSelf = selfNamespace(freshQuestions);
    const answered = new Set((fresh.answers || []).filter((answer) => hasValue(answer.value)).map((answer) => answer.questionKey));
    const targetsByFact = new Map();
    for (const question of freshQuestions) {
      const fact = factOf(question, freshSelf);
      if (!fact || answered.has(question.key)) continue;
      if (!targetsByFact.has(fact)) targetsByFact.set(fact, []);
      targetsByFact.get(fact).push(question);
    }
    if (!targetsByFact.size) return { status: "nothing_to_fill" };

    // the person's earlier cases, newest first, where they answered as a person (never an employer matter)
    const sources = (await require("./caseLinks.service").listPersonCases(personId))
      .filter((row) => row._id !== String(caseId) && CAPACITY_ROLE[row.capacity])
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    if (!sources.length) return { status: "no_earlier_case" };

    const picked = new Map(); // questionKey -> { value, sourceCase, fact }
    const usedSources = new Set();
    for (const source of sources) {
      if (picked.size >= [...targetsByFact.values()].flat().length) break;
      const old = await loadChecklist(source._id, CAPACITY_ROLE[source.capacity], actor);
      if (!old?.answers?.length) continue;
      const oldQuestions = new Map(allQuestions(old).map((question) => [question.key, question]));
      const oldSelf = selfNamespace([...oldQuestions.values()]);
      for (const answer of old.answers) {
        if (!hasValue(answer.value)) continue;
        const fact = factOf(oldQuestions.get(answer.questionKey), oldSelf);
        if (!fact || !targetsByFact.has(fact)) continue;
        for (const question of targetsByFact.get(fact)) {
          if (picked.has(question.key)) continue; // a newer case already gave it
          const value = valueFor(question, answer.value);
          if (value === undefined) continue;
          picked.set(question.key, { value, sourceCase: source, fact });
          usedSources.add(source);
        }
      }
    }
    if (!picked.size) return { status: "nothing_to_copy" };

    const qs = require("../questionnaires/questionnaire.service");
    await qs.saveAnswers({ caseId, questionnaireId: fresh.questionnaire._id, targetRole, responseId: fresh.responseId, answers: [...picked.entries()].map(([questionKey, item]) => ({ questionKey, value: item.value })) }, actor, null);

    // mark every copied answer (shown as "Pre-filled from your earlier case" until someone changes it)
    const Answer = require("../../models/Answer");
    await Promise.all([...picked.entries()].map(([questionKey, item]) => Answer.updateOne(
      { responseId: fresh.responseId, questionKey },
      { $push: { auditHistory: { action: PREFILL_ACTION, changes: { sourceCaseId: item.sourceCase._id, sourceCaseNumber: item.sourceCase.caseNumber || "", sourceVisaType: item.sourceCase.visaType || "", fact: item.fact }, performedAt: now() } } }
    ).catch(() => null)));

    const caseDoc = await Case.findById(caseId);
    if (caseDoc) {
      const fromLabel = [...usedSources].map((row) => `${row.visaType || "case"} ${row.caseNumber || ""}`.trim()).join(", ");
      require("./case.service").addTimelineEvent(caseDoc, "questionnaire", "Personal details pre-filled", `${picked.size} answer(s) were pre-filled from this person's earlier case(s): ${fromLabel}. They can be edited here; the earlier case is not changed.`, actor, { sourceCaseIds: [...usedSources].map((row) => row._id), count: picked.size });
      await caseDoc.save();
    }
    return { status: "prefilled", copied: picked.size, fromCases: [...usedSources].map((row) => row._id) };
  } catch (error) {
    logger.error("person_prefill_failed", { caseId: String(caseId), error: error.message });
    return { status: "error", error: error.message };
  }
}

module.exports = { prefillPersonFromEarlierCases, selfNamespace, factOf, normalizeDate, valueFor, PREFILL_ACTION, FACT_ALIASES };

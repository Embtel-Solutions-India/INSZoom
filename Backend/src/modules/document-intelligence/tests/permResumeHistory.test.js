// Resume -> PERM "Employment History" rows: the converter, and its wiring to the checklist question. Pure tests.
const test = require("node:test");
const assert = require("node:assert/strict");

const { derivePermResumeFields } = require("../services/extraction-mapping.service");
const registry = require("../config/field-mapping.registry");
const { AUTOFILL_DOCUMENT_TYPES } = require("../config/autofill-document-types");
const { EMPLOYMENT_CHECKLIST_DEFINITIONS } = require("../../questionnaires/employmentChecklists");
const { HISTORY_COLUMNS } = require("../../questionnaires/permChecklists");

const resume = [
  {
    key: "employment", confidence: 90,
    value: [
      { employer: "Globex Systems", title: "Associate Engineer", startDate: "2018-06", endDate: "2021-02-28", current: false, duties: "Maintained internal tools." },
      { employer: "Acme Robotics Inc", title: "Software Engineer", startDate: "2021-03-01", endDate: "Present", current: false, duties: "Built warehouse control software." },
      { employer: "Initech", title: "Trainee Engineer", startDate: "2013", endDate: "2018-05-31", current: false, duties: "" },
      { employer: null, title: null, startDate: "2010-01-01" },
    ],
  },
  { key: "skills", value: ["Node.js", "React", " MongoDB "] },
];

test("one row per job, most recent first, mapped to the checklist's own column keys", () => {
  const [derived] = derivePermResumeFields(resume);
  assert.equal(derived.key, "permEmploymentHistory");
  const rows = derived.value;
  assert.equal(rows.length, 3, "an entry with no employer and no title is not a job");
  assert.deepEqual(rows.map((row) => row.company_name), ["Acme Robotics Inc", "Globex Systems", "Initech"]);
  const columns = new Set(HISTORY_COLUMNS.map((column) => column.key));
  for (const row of rows) for (const key of Object.keys(row)) assert.ok(columns.has(key), `${key} is a real Employment History column`);
});

test("company, position, duration and experience land in the right columns", () => {
  const [{ value: rows }] = derivePermResumeFields(resume);
  assert.deepEqual(rows[0], { company_name: "Acme Robotics Inc", job_title: "Software Engineer", start_date: "2021-03-01", is_current: true, job_details: "Built warehouse control software.", skills_tools: "Node.js, React, MongoDB" });
  assert.equal(rows[1].start_date, "2018-06-01", "a year-month start becomes the first of that month");
  assert.equal(rows[1].end_date, "2021-02-28");
  assert.equal(rows[1].is_current, false);
  assert.equal(rows[2].start_date, "2013-01-01", "a bare year becomes January 1st");
  assert.equal(rows[2].job_details, "");
});

test("'Present' means a current job: no end date; nothing a resume cannot know is invented", () => {
  const [{ value: rows }] = derivePermResumeFields(resume);
  assert.equal("end_date" in rows[0], false);
  for (const row of rows) {
    for (const column of ["address", "city", "state", "country", "zip_code", "supervisor_name", "supervisor_phone", "business_type", "hours_per_week"]) {
      assert.equal(row[column], undefined, `${column} is left for the employee to enter`);
    }
  }
  assert.equal(rows[1].skills_tools, undefined, "the global skills list is attached to the most recent job only");
});

test("an unparseable date is left blank rather than guessed; nothing derived without employment", () => {
  const [{ value: rows }] = derivePermResumeFields([{ key: "employment", value: [{ employer: "X Co", title: "Dev", startDate: "sometime in spring", endDate: "later" }] }]);
  assert.equal(rows[0].start_date, "");
  assert.equal(rows[0].end_date, "");
  assert.deepEqual(derivePermResumeFields([]), []);
  assert.deepEqual(derivePermResumeFields([{ key: "skills", value: ["a"] }]), []);
});

test("wiring: the derived field targets the PERM question, which is a repeating group on the employee checklist", () => {
  assert.deepEqual(registry.FIELD_MAPPINGS.resume.permEmploymentHistory.questionnaire, ["employee_employment_history"]);
  const employee = EMPLOYMENT_CHECKLIST_DEFINITIONS.find((definition) => definition.key === "perm_employee_information");
  const question = employee.questions.find((item) => item.key === "employee_employment_history");
  assert.equal(question.type, "repeating_group");
  assert.ok(AUTOFILL_DOCUMENT_TYPES.includes("perm_resume"), "the portal's perm_resume upload is accepted by the autofill endpoint");
});

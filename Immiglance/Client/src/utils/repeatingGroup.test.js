import { describe, it, expect } from "vitest";
import { validateRepeatingGroupRows } from "./repeatingGroup";
import { validateQuestion } from "./questionnaireEngine";

const question = {
  key: "history", type: "repeating_group", required: true,
  metadata: {
    itemLabel: "Job", order: "mostRecentFirst", periodFields: { start: "start_date" },
    rowRules: [{ type: "dateOrder", start: "start_date", end: "end_date", current: "is_current" }],
    fields: [
      { key: "job_title", label: "Job Title", type: "text", required: true },
      { key: "start_date", label: "Start Date", type: "date", required: true },
      { key: "is_current", label: "Current", type: "checkbox" },
      { key: "end_date", label: "End Date", type: "date", required: true, hiddenWhen: { field: "is_current", equals: true }, requiredUnless: { field: "is_current", equals: true } },
      { key: "hours", label: "Hours", type: "number", required: true, min: 0.5, max: 168 },
    ],
  },
};
const job = (o = {}) => ({ job_title: "Eng", start_date: "2021-01-01", end_date: "2022-01-01", hours: 40, ...o });

describe("repeating group rows", () => {
  it("accepts complete jobs, any count", () => {
    expect(validateRepeatingGroupRows(question, Array.from({ length: 6 }, () => job())).errors).toEqual([]);
  });
  it("requires fields, names the job, and flags per-field errors", () => {
    const r = validateRepeatingGroupRows(question, [job(), job({ job_title: "" })]);
    expect(r.errors).toEqual(["Job 2: Job Title is required"]);
    expect(r.rowErrors[1].job_title).toBeTruthy();
  });
  it("current job needs no end date; start after end is rejected otherwise", () => {
    expect(validateRepeatingGroupRows(question, [job({ is_current: true, end_date: "" })]).errors).toEqual([]);
    expect(validateRepeatingGroupRows(question, [job({ end_date: "" })]).errors.length).toBe(1);
    expect(validateRepeatingGroupRows(question, [job({ start_date: "2024-01-01" })]).errors.length).toBe(1);
  });
  it("hours must be sensible; order is only a warning", () => {
    expect(validateRepeatingGroupRows(question, [job({ hours: -1 })]).errors.length).toBe(1);
    const r = validateRepeatingGroupRows(question, [job({ start_date: "2015-01-01", end_date: "2016-01-01" }), job()]);
    expect(r.errors).toEqual([]);
    expect(r.warnings.length).toBe(1);
  });
  it("validateQuestion surfaces row errors and treats no jobs as missing", () => {
    expect(validateQuestion(question, [job({ job_title: "" })], {}).some((m) => /Job 1/.test(m))).toBe(true);
    expect(validateQuestion(question, [], {})).toContain("This field is required.");
  });
});

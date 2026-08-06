const { DEGREE_TYPES } = require("../schemas/resume-extraction.schema");

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addIssue(issues, field, code, message, severity = "review") {
  issues.push({ field, code, message, severity });
}

function validateEducationEntries(entries = []) {
  const issues = [];
  entries.forEach((entry, index) => {
    if (entry.degreeType && !DEGREE_TYPES.includes(entry.degreeType)) {
      addIssue(issues, "education", "invalid_degree_type", `Education entry ${index + 1} has a degreeType outside the known enum: "${entry.degreeType}"`);
    }
  });
  const duplicateKeys = new Set();
  entries.forEach((entry, index) => {
    const key = `${(entry.institution || "").toLowerCase()}|${entry.awardDate || ""}`;
    if (!entry.institution) return;
    if (duplicateKeys.has(key)) {
      addIssue(issues, "education", "possible_duplicate", `Education entry ${index + 1} shares institution+awardDate with another entry - likely a duplicate extraction`);
    }
    duplicateKeys.add(key);
  });
  return issues;
}

function validateEmploymentEntries(entries = []) {
  const issues = [];
  entries.forEach((entry, index) => {
    const start = parseDate(entry.startDate);
    const end = parseDate(entry.endDate);
    if (start && end && end < start) {
      addIssue(issues, "employment", "end_before_start", `Employment entry ${index + 1} (${entry.employer || "unknown employer"}) has an end date before its start date`);
    }
  });
  const duplicateKeys = new Set();
  entries.forEach((entry, index) => {
    if (!entry.employer) return;
    const key = `${entry.employer.toLowerCase()}|${entry.startDate || ""}|${entry.endDate || ""}`;
    if (duplicateKeys.has(key)) {
      addIssue(issues, "employment", "possible_duplicate", `Employment entry ${index + 1} shares employer+dates with another entry - likely a duplicate extraction`);
    }
    duplicateKeys.add(key);
  });
  return issues;
}

function validateResumeExtraction(fields = {}) {
  const issues = [
    ...validateEducationEntries(fields.education?.value),
    ...validateEmploymentEntries(fields.employment?.value),
  ];
  const issuesByField = issues.reduce((acc, issue) => {
    acc[issue.field] = [...(acc[issue.field] || []), issue];
    return acc;
  }, {});
  return {
    valid: issues.length === 0,
    issues,
    issuesByField,
  };
}

module.exports = {
  validateResumeExtraction,
  validateEducationEntries,
  validateEmploymentEntries,
};

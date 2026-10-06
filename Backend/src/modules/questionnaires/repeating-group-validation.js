// Row-level validation for repeating_group answers whose question describes its
// columns in metadata.fields (PERM Employment History today; any checklist can
// opt in by declaring columns). Pure functions - no DB - mirrored on the client
// by Immiglance/Client/src/utils/repeatingGroup.js so a row is judged the same
// way in the browser and on the server.
//
// Column spec: { key, label, type, required, min, max, hiddenWhen, requiredUnless }
//   hiddenWhen / requiredUnless: { field, equals }  (a sibling column's value)
// Question metadata: itemLabel ("Job"), rowRules [{ type:"dateOrder", start, end, current, message }],
//   order "mostRecentFirst" (warns when rows are not newest-first).

const isEmpty = (value) => value === undefined || value === null || (typeof value === "string" && value.trim() === "");
const truthy = (value) => value === true || ["true", "yes", "1", "on"].includes(String(value).toLowerCase());
const matches = (row, condition) => Boolean(condition) && (condition.equals === true ? truthy(row?.[condition.field]) : String(row?.[condition.field] ?? "") === String(condition.equals));
const toTime = (value) => (isEmpty(value) ? NaN : new Date(value).getTime());

function columnsOf(question) {
  return question?.metadata?.fields || question?.metadata?.repeatableFields || [];
}

function validateColumn(column, value, row) {
  if (matches(row, column.hiddenWhen)) return null; // not applicable for this row
  const required = Boolean(column.required) && !matches(row, column.requiredUnless);
  if (isEmpty(value)) return required ? `${column.label} is required` : null;
  const type = column.type;
  if (type === "date" && Number.isNaN(toTime(value))) return `${column.label} must be a valid date`;
  if (type === "number") {
    const number = Number(value);
    if (Number.isNaN(number)) return `${column.label} must be a number`;
    if (column.min !== undefined && number < Number(column.min)) return `${column.label} must be at least ${column.min}`;
    if (column.max !== undefined && number > Number(column.max)) return `${column.label} must be at most ${column.max}`;
  }
  if (type === "phone" && String(value).replace(/\D/g, "").length < 7) return `${column.label} must be a valid phone number`;
  if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) return `${column.label} must be a valid email`;
  return null;
}

// -> { errors: string[], warnings: string[] }
function validateRepeatingGroupRows(question, rows) {
  const errors = [];
  const warnings = [];
  const columns = columnsOf(question);
  if (!columns.length || !Array.isArray(rows)) return { errors, warnings };
  const itemLabel = question.metadata?.itemLabel || "Entry";

  rows.forEach((row, index) => {
    const prefix = `${itemLabel} ${index + 1}`;
    columns.forEach((column) => {
      const message = validateColumn(column, row?.[column.key], row || {});
      if (message) errors.push(`${prefix}: ${message}`);
    });
    for (const rule of question.metadata?.rowRules || []) {
      if (rule.type !== "dateOrder") continue;
      const start = toTime(row?.[rule.start]);
      const end = toTime(row?.[rule.end]);
      const current = rule.current && truthy(row?.[rule.current]);
      if (!current && !Number.isNaN(start) && !Number.isNaN(end) && start > end) {
        errors.push(`${prefix}: ${rule.message || "Start date cannot be after End date."}`);
      }
    }
  });

  // Newest first: Job 1 is the most recent. Advisory only - never blocks saving.
  const period = question.metadata?.periodFields;
  if (question.metadata?.order === "mostRecentFirst" && period) {
    for (let index = 0; index < rows.length - 1; index += 1) {
      const newer = toTime(rows[index]?.[period.start]);
      const older = toTime(rows[index + 1]?.[period.start]);
      if (!Number.isNaN(newer) && !Number.isNaN(older) && newer < older) {
        warnings.push(`List the most recent ${itemLabel.toLowerCase()} first (${itemLabel} 1 should be your most recent).`);
        break;
      }
    }
  }
  return { errors, warnings };
}

module.exports = { validateRepeatingGroupRows, columnsOf };

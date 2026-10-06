// Row-level validation for repeating_group answers whose question declares its
// columns in metadata.fields (PERM Employment History). Mirrors
// Backend/src/modules/questionnaires/repeating-group-validation.js so a row is
// judged the same way in the browser and on the server - keep the two in sync.

const isEmpty = (value) => value === undefined || value === null || (typeof value === "string" && value.trim() === "");
const truthy = (value) => value === true || ["true", "yes", "1", "on"].includes(String(value).toLowerCase());
const matches = (row, condition) =>
  Boolean(condition) && (condition.equals === true ? truthy(row?.[condition.field]) : String(row?.[condition.field] ?? "") === String(condition.equals));
const toTime = (value) => (isEmpty(value) ? NaN : new Date(value).getTime());

export function columnsOf(question) {
  return question?.metadata?.fields || question?.metadata?.repeatableFields || [];
}

export const isColumnHidden = (column, row) => matches(row, column.hiddenWhen);
export const isColumnRequired = (column, row) => Boolean(column.required) && !matches(row, column.requiredUnless);

export function validateColumn(column, value, row) {
  if (isColumnHidden(column, row)) return null;
  if (isEmpty(value)) return isColumnRequired(column, row) ? `${column.label} is required` : null;
  if (column.type === "date" && Number.isNaN(toTime(value))) return `${column.label} must be a valid date`;
  if (column.type === "number") {
    const number = Number(value);
    if (Number.isNaN(number)) return `${column.label} must be a number`;
    if (column.min !== undefined && number < Number(column.min)) return `${column.label} must be at least ${column.min}`;
    if (column.max !== undefined && number > Number(column.max)) return `${column.label} must be at most ${column.max}`;
  }
  if (column.type === "phone" && String(value).replace(/\D/g, "").length < 7) return `${column.label} must be a valid phone number`;
  return null;
}

// -> { rowErrors: [{ [columnKey]: message }], errors: string[], warnings: string[] }
export function validateRepeatingGroupRows(question, rows) {
  const columns = columnsOf(question);
  const result = { rowErrors: [], errors: [], warnings: [] };
  if (!columns.length || !Array.isArray(rows)) return result;
  const itemLabel = question.metadata?.itemLabel || "Entry";

  rows.forEach((row, index) => {
    const fieldErrors = {};
    columns.forEach((column) => {
      const message = validateColumn(column, row?.[column.key], row || {});
      if (message) fieldErrors[column.key] = message;
    });
    for (const rule of question.metadata?.rowRules || []) {
      if (rule.type !== "dateOrder") continue;
      const start = toTime(row?.[rule.start]);
      const end = toTime(row?.[rule.end]);
      const current = rule.current && truthy(row?.[rule.current]);
      if (!current && !Number.isNaN(start) && !Number.isNaN(end) && start > end) {
        fieldErrors[rule.end] = fieldErrors[rule.end] || rule.message || "Start date cannot be after End date.";
      }
    }
    result.rowErrors[index] = fieldErrors;
    Object.values(fieldErrors).forEach((message) => result.errors.push(`${itemLabel} ${index + 1}: ${message}`));
  });

  const period = question.metadata?.periodFields;
  if (question.metadata?.order === "mostRecentFirst" && period) {
    for (let index = 0; index < rows.length - 1; index += 1) {
      const newer = toTime(rows[index]?.[period.start]);
      const older = toTime(rows[index + 1]?.[period.start]);
      if (!Number.isNaN(newer) && !Number.isNaN(older) && newer < older) {
        result.warnings.push(`List the most recent ${itemLabel.toLowerCase()} first (${itemLabel} 1 should be your most recent).`);
        break;
      }
    }
  }
  return result;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addIssue(issues, field, code, message, severity = "review") {
  issues.push({ field, code, message, severity });
}

function validatePassportNumber(value) {
  if (!value) return [{ field: "passportNumber", code: "required", message: "Passport number was not extracted", severity: "review" }];
  const normalized = String(value).trim().replace(/\s+/g, "");
  if (!/^[A-Z0-9]{5,12}$/i.test(normalized)) {
    return [{ field: "passportNumber", code: "invalid_format", message: "Passport number must be 5-12 alphanumeric characters", severity: "review" }];
  }
  return [];
}

function validateDateField(field, value, { allowFuture = false, required = false } = {}) {
  const issues = [];
  if (!value) {
    if (required) addIssue(issues, field, "required", `${field} was not extracted`);
    return issues;
  }
  const date = parseDate(value);
  if (!date) {
    addIssue(issues, field, "invalid_date", `${field} is not a valid date`);
    return issues;
  }
  if (!allowFuture && date > new Date()) addIssue(issues, field, "future_date", `${field} cannot be in the future`);
  return issues;
}

function validatePassportDates(fields = {}) {
  const issues = [];
  const dob = parseDate(fields.dateOfBirth?.value);
  const issue = parseDate(fields.issueDate?.value);
  const expiry = parseDate(fields.expiryDate?.value);

  issues.push(...validateDateField("dateOfBirth", fields.dateOfBirth?.value, { required: true }));
  issues.push(...validateDateField("issueDate", fields.issueDate?.value, { required: true }));
  issues.push(...validateDateField("expiryDate", fields.expiryDate?.value, { allowFuture: true, required: true }));

  if (dob) {
    const oldestAllowed = new Date();
    oldestAllowed.setFullYear(oldestAllowed.getFullYear() - 130);
    if (dob < oldestAllowed) addIssue(issues, "dateOfBirth", "unrealistic_age", "Date of birth appears older than 130 years");
  }
  if (issue && expiry && issue >= expiry) addIssue(issues, "issueDate", "issue_after_expiry", "Issue date must be before expiry date");
  return issues;
}

function validatePassportExtraction(fields = {}) {
  const issues = [
    ...validatePassportNumber(fields.passportNumber?.value),
    ...validatePassportDates(fields),
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
  validatePassportExtraction,
  validatePassportNumber,
  validatePassportDates,
};

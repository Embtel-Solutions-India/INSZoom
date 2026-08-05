// Shared recursive AND/OR condition evaluator. Originally private to
// questionnaire.service.js (question-level visibility only); extracted so the
// checklist rule engine (checklist-rule-engine.service.js) can reuse the exact
// same evaluation logic for questionnaire-level assign/remove triggers instead
// of re-implementing rule comparison a second time.

function getAnswerValue(answerMap, key) {
  return answerMap[key]?.value ?? answerMap[key];
}

function compareRule(rule, answerMap) {
  const actual = getAnswerValue(answerMap, rule.questionKey);
  const expected = rule.value;
  switch (rule.operator) {
    case "not_equals":
      return actual !== expected;
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    case "not_in":
      return Array.isArray(expected) && !expected.includes(actual);
    case "exists":
    case "not_empty":
      return actual !== undefined && actual !== null && actual !== "";
    case "missing":
    case "empty":
      return actual === undefined || actual === null || actual === "";
    case "gt":
      return Number(actual) > Number(expected);
    case "gte":
      return Number(actual) >= Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    case "lte":
      return Number(actual) <= Number(expected);
    case "contains":
      return Array.isArray(actual) ? actual.includes(expected) : String(actual || "").includes(String(expected));
    case "not_contains":
      return Array.isArray(actual) ? !actual.includes(expected) : !String(actual || "").includes(String(expected));
    case "equals":
    default:
      return actual === expected;
  }
}

function evaluateConditionGroup(group, answerMap = {}) {
  if (!group) return true;
  const rules = (group.rules || []).map((rule) => compareRule(rule, answerMap));
  const groups = (group.groups || []).map((nested) => evaluateConditionGroup(nested, answerMap));
  const results = [...rules, ...groups];
  if (!results.length) return true;
  return group.mode === "any" ? results.some(Boolean) : results.every(Boolean);
}

module.exports = {
  getAnswerValue,
  compareRule,
  evaluateConditionGroup,
};

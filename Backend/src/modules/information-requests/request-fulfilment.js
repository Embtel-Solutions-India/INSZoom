// A staff "Request information" item is free text typed by a case manager ("Copy of Educational Credential Evaluation Report ( If needs to be US
// equivalent)", "Current U.S. Address (street, apt#, ...)"). The client may already have answered the same thing on their normal checklist, in which
// case the request is satisfied - it must read "Received", not "Open". This module decides that. Pure and deterministic: no DB.
//
// A request is satisfied when EVERY item it names matches a question on the recipient's checklist AND that question has an answer (a file or a value).
// Items we cannot match to a question never count as satisfied - the request stays open rather than being closed on a guess.

const NOISE = /^(if any|if applicable|optional|must be signed by bearer|please|kindly)\b/;
const MIN_WORDS = 3;

const normalize = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const wordCount = (text) => (text ? text.split(" ").length : 0);
// "(street, apt#, city ...)" notes are not part of the item's name.
const stripParens = (text) => String(text || "").replace(/\([^()]*\)/g, " ");

/** The distinct items a request title asks for, normalised. "A, B? Needed C" -> ["a", "b", "c"]; noise like "if any" is dropped. */
function itemsOfTitle(title) {
  const parts = stripParens(title).split(/[,;?\n]|\bneeded\b/i).map(normalize).filter(Boolean);
  return [...new Set(parts.filter((part) => !NOISE.test(part)))];
}

/** Questions whose label contains the named item. One way only: an item that says MORE than the label ("... or latest Visa Stamp") is not that question. */
function questionsMatching(item, questions) {
  if (wordCount(item) < MIN_WORDS) return [];
  return questions.filter((question) => normalize(question.label).includes(item));
}

function hasAnswer(answer) {
  if (!answer) return false;
  if (Array.isArray(answer.files) && answer.files.length) return true;
  const value = answer.value;
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * @param {string} title                the request's title
 * @param {Array<{key,label}>} questions the recipient's active checklist questions
 * @param {Map|Object} answersByKey      questionKey -> { value, files }
 * @returns {{ fulfilled: boolean, questionKeys: string[], unmatched: string[] }}
 */
function evaluateRequest(title, questions, answersByKey) {
  const get = (key) => (answersByKey instanceof Map ? answersByKey.get(key) : answersByKey?.[key]);
  const items = itemsOfTitle(title);
  if (!items.length) return { fulfilled: false, questionKeys: [], unmatched: [] };
  const questionKeys = [];
  const unmatched = [];
  for (const item of items) {
    const matches = questionsMatching(item, questions);
    const answered = matches.filter((question) => hasAnswer(get(question.key)));
    if (!answered.length) { unmatched.push(item); continue; }
    questionKeys.push(...answered.map((question) => question.key));
  }
  return { fulfilled: unmatched.length === 0, questionKeys: [...new Set(questionKeys)], unmatched };
}

// The same person is addressed by different role names depending on the case type, for EVERY visa type: an employer matter's petitioner IS its
// employer (whose business-plan / supporting-document checklists are also theirs), and the beneficiary is the employee. Family cases use
// petitioner / beneficiary directly; individual and single-party filings use client. A request to "beneficiary" is answered on the "employee"
// checklist (and vice versa).
const ROLE_GROUPS = [["employer", "petitioner", "business_plan", "supporting_documents"], ["employee", "beneficiary"]];
function sameRecipientRole(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  return ROLE_GROUPS.some((group) => group.includes(left) && group.includes(right));
}

module.exports = { normalize, itemsOfTitle, questionsMatching, hasAnswer, evaluateRequest, sameRecipientRole };

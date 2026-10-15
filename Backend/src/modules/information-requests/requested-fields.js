// "Request" on an EXISTING question/document of a client's checklist: the case manager asks the client for that one item, and from then on it is
// REQUIRED FOR THIS CASE ONLY - the shared questionnaire is never edited. The request is a Case.informationRequests entry with
// scope "existing_question", identified by (responseId, questionKey): the response id is what one client's one checklist answers live under,
// and question keys are stable across a case's copies of a checklist.
//
// Pure helpers (no DB) + one small loader. Used by questionnaire.service (required-ness in progress/completion/submit, and the flags the
// client portal sees) and information-request.service (create / cancel).

// A request keeps the item required while it is open and after it was answered (the answer cannot be blanked and submitted); only a
// cancelled ("closed") request stops being a requirement.
const REQUIRING_STATUSES = new Set(["open", "submitted", "approved", "rejected"]);

const isItemRequest = (request) => request?.scope === "existing_question" && Boolean(request.questionKey);

function itemRequestsFor(cases, responseId) {
  if (!responseId) return [];
  const wanted = String(responseId);
  const found = [];
  (cases || []).forEach((caseData) => {
    (caseData?.informationRequests || []).forEach((request) => {
      if (isItemRequest(request) && REQUIRING_STATUSES.has(request.status || "open") && String(request.responseId || "") === wanted) found.push(request);
    });
  });
  return found;
}

/** Set of question keys a case manager has asked for on this response (required for this case only). */
function requestedKeysFromCases(cases, responseId) {
  return new Set(itemRequestsFor(cases, responseId).map((request) => request.questionKey));
}

/** Map questionKey -> the request (for the flags shown to the client and the status shown to the case manager). Latest request wins. */
function requestMapFromCases(cases, responseId) {
  const map = new Map();
  itemRequestsFor(cases, responseId)
    .sort((left, right) => new Date(left.requestedAt || 0) - new Date(right.requestedAt || 0))
    .forEach((request) => map.set(request.questionKey, request));
  return map;
}

/**
 * Plain copies of `questions` where each requested one is REQUIRED (overriding an "optional" flag) and carries metadata.requestedByStaff, so
 * every consumer that reads question.required / metadata.optional (the client portal's Submit gate, its asterisks and "missing" list) agrees
 * with the server. Questions that were not requested are returned untouched (same objects).
 */
function applyRequestedRequirement(questions, requestMap) {
  if (!requestMap || !requestMap.size) return questions;
  return (questions || []).map((question) => {
    const request = requestMap.get(question.key);
    if (!request) return question;
    const plain = typeof question.toObject === "function" ? question.toObject() : question;
    // the case manager's note reaches the client where every renderer already shows a question's help text
    const asked = request.description ? `Requested by your case manager: ${request.description}` : "Requested by your case manager.";
    const description = [asked, plain.description].filter(Boolean).join("\n");
    return {
      ...plain,
      description,
      helpText: description,
      required: true,
      metadata: {
        ...(plain.metadata || {}),
        optional: false,
        requestedByStaff: {
          requestId: String(request._id),
          note: request.description || "",
          requestedAt: request.requestedAt,
          status: request.status,
        },
      },
    };
  });
}

/** The cases whose informationRequests can name this response: the case itself and, for an employee/child case, its principal. */
async function loadRequestCases(caseIds) {
  const ids = [...new Set((caseIds || []).filter(Boolean).map(String))];
  if (!ids.length) return [];
  const Case = require("../../models/Case");
  return Case.find({ _id: { $in: ids } }).select("informationRequests parentCase").lean();
}

module.exports = { REQUIRING_STATUSES, isItemRequest, itemRequestsFor, requestedKeysFromCases, requestMapFromCases, applyRequestedRequirement, loadRequestCases };

// Keeps an unreleased petition out of the generic Documents API. Without this a petition uploaded for the case team would already be listed / openable by the client
// (case access is all the Documents API checks). Rules:
//   case team (admin, team lead, case manager and the other internal roles) -> always
//   attorney                                                                 -> only once it was sent for attorney review (a petition from before this feature, which has
//                                                                              no record, stays visible exactly as before)
//   everybody else (client, petitioner, employer, employee, beneficiary)     -> never through the Documents API: the Petition page of the Client Portal has its own,
//                                                                              audience-checked endpoints
// Fails CLOSED for non-staff: if the check cannot be made, the petition is not shown.
const PETITION_DOCUMENT_TYPE = "petition_manual_upload";
// "Supporting Documents" (letters, reports ... shared for review apart from the petition): same release / viewer / feedback flow, but no AI review and
// no legacy exception - an attorney sees one ONLY after it was sent for attorney review.
const SUPPORTING_DOCUMENT_TYPE = "petition_supporting_upload";
const REVIEW_DOCUMENT_TYPES = new Set([PETITION_DOCUMENT_TYPE, SUPPORTING_DOCUMENT_TYPE]);
const isReviewDocumentType = (documentType) => REVIEW_DOCUMENT_TYPES.has(documentType);
const kindOf = (documentType) => (documentType === SUPPORTING_DOCUMENT_TYPE ? "supporting" : "petition");
const STAFF_ROLES = new Set(["super_admin", "admin", "team_lead", "case_manager", "paralegal", "finance", "hr", "team_member"]);

const roleOf = (user) => String(user?.role || "").toLowerCase().replace(/[\s-]+/g, "_");

const reviews = () => require("../../models/PetitionReview");
const logger = () => require("../../utils/logger");

/** Pure: may this role see a petition (or supporting document) whose review record is `review` (null = none)? */
function decide(role, review, documentType = PETITION_DOCUMENT_TYPE) {
  if (STAFF_ROLES.has(role)) return true;
  if (role === "attorney") return documentType === SUPPORTING_DOCUMENT_TYPE ? Boolean(review?.attorneyReview?.sentAt) : !review || Boolean(review.attorneyReview?.sentAt);
  return false;
}

/** For one document (a lean doc or a populated one). Resolves true for anything that is not a petition upload. */
async function viewerMaySee(user, document) {
  if (!document || !isReviewDocumentType(document.documentType)) return true;
  const role = roleOf(user);
  if (STAFF_ROLES.has(role)) return true;
  if (role !== "attorney") return false;
  try {
    const review = await reviews().findOne({ documentId: document._id }).select("attorneyReview.sentAt").lean();
    return decide(role, review, document.documentType);
  } catch (error) {
    logger().error("petition_gate_check_failed", { error: error.message });
    return false;
  }
}

/** A MongoDB condition to AND into a document list query, or null when nothing has to be hidden. */
async function listCondition(user, caseId) {
  const role = roleOf(user);
  if (STAFF_ROLES.has(role)) return null;
  const allTypes = [...REVIEW_DOCUMENT_TYPES];
  if (role !== "attorney") return { documentType: { $nin: allTypes } };
  try {
    const filter = { "attorneyReview.sentAt": null };
    if (caseId) filter.caseId = caseId;
    const hidden = await reviews().find(filter).distinct("documentId");
    // a supporting document is listed only once released to the attorney (no legacy exception)
    const releasedFilter = { "attorneyReview.sentAt": { $ne: null } };
    if (caseId) releasedFilter.caseId = caseId;
    const released = await reviews().find(releasedFilter).distinct("documentId");
    const supporting = { $or: [{ documentType: { $ne: SUPPORTING_DOCUMENT_TYPE } }, { _id: { $in: released } }] };
    return hidden.length ? { $and: [{ _id: { $nin: hidden } }, supporting] } : supporting;
  } catch (error) {
    logger().error("petition_gate_list_failed", { error: error.message });
    return { documentType: { $nin: allTypes } };
  }
}

module.exports = { PETITION_DOCUMENT_TYPE, SUPPORTING_DOCUMENT_TYPE, REVIEW_DOCUMENT_TYPES, isReviewDocumentType, kindOf, STAFF_ROLES, decide, viewerMaySee, listCondition, roleOf };

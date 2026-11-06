// Once a case has been Submitted on the Pipeline it has been filed, and every later stage (Receipt Tracking, RFE, Status - Approved, Status - Disapproved, FeedBack) is "filed" as well.
// On Hold is the one stage after Submitted that does NOT count: a case on hold keeps whatever status it had. This is the same set the backend uses for the client's "Filed" milestone
// (case-lifecycle-orchestrator.service.js SUBMITTED_OR_LATER_STAGE_KEYS). Pure.
export const FILED_STAGE_KEYS = Object.freeze(['submitted_fedex', 'receipt_tracking', 'rfe', 'status_approved', 'status_disapproved', 'feedback'])

export const isFiledByStage = (stageKey) => FILED_STAGE_KEYS.includes(String(stageKey || ''))

// USCIS tracking statuses that mean "not filed yet": these read as Filed once the case is at a filed stage; any later status (receipt issued, RFE, approved ...) is left exactly as recorded.
const PRE_FILING_STATUSES = ['', 'draft', 'ready_to_file']

/** The status the USCIS Tracking tab shows: 'filed' for a pre-filing status of a case at a filed stage, otherwise the recorded status. */
export const shownTrackingStatus = (recordedStatus, stageKey) => (isFiledByStage(stageKey) && PRE_FILING_STATUSES.includes(String(recordedStatus || '')) ? 'filed' : (recordedStatus || 'draft'))

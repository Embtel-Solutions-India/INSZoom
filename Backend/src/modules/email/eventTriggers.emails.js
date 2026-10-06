// Starting wording for every event-based trigger's customizable email.
//
// Where an email of the same kind already exists in the application, its
// wording is reused EXACTLY (same sentences, same bold labels, same button
// text, same layout elements) - the only change is the unavoidable one when
// the reader is staff instead of the client ("your case" -> the client's
// case). The matching originals are the built-in templates in
// ./templates/*.js:
//   questionnaire.assigned:client  <- questionnaire-assigned (original wording, restored)
//   document.rejected:client       <- document-rejected      (original wording, restored)
//   rfe.received:*                 <- rfe-received
//   uscis.decision:*               <- case-approved / case-denied
//   case.filed:*                   <- filing-submitted
//   case.closed:*                  <- case-closed
//   case.created:admin             <- case-created-team-lead ("New Immigration Case Created")
//   questionnaire.submitted:case_manager <- client-intake-submitted-case-manager
//   attorney.assigned:client       <- case-manager-assigned (same announcement, for the attorney)
// Triggers with no earlier email use the same plain register: a greeting, a
// few clear sentences, bold labels like the attorney-assignment email, and the
// same navy button.
//
// All dynamic values are [variables] from the central registry (validated by
// tests against each trigger's variable groups).

const NAVY = "#1e3a5f";

const greeting = () => "<p>Hi [recipient.name],</p>";
const p = (html) => `<p>${html}</p>`;
const button = (label, color = NAVY) =>
  `<a href="[system.portal_link]" style="display:inline-block;padding:12px 24px;background:${color};color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">${label}</a>`;
// "<strong>Case:</strong> B160<br/>..." exactly like the attorney-assignment email.
const labels = (rows) => p(rows.map(([label, value]) => `<strong>${label}:</strong> ${value}`).join("<br/>"));
const redLine = (html) => `<p style="color:#dc2626;font-weight:700;font-size:16px;margin:0 0 16px;">${html}</p>`;
// The green details box of the filing-submitted email.
const filingBox = () => `<table role="presentation" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 20px;margin:0 0 16px;width:100%;">
      <tr><td>
        <p style="margin:0 0 4px;color:#6b7280;font-size:13px;">Case ID</p><p style="margin:0 0 8px;font-weight:700;color:#065f46;">[case.id]</p>
        <p style="margin:0 0 4px;color:#6b7280;font-size:13px;">Filing Date</p><p style="margin:0 0 8px;font-weight:700;color:#065f46;">[case.filing_date]</p>
        <p style="margin:0 0 4px;color:#6b7280;font-size:13px;">Filing Type</p><p style="margin:0;font-weight:700;color:#065f46;">[case.type]</p>
      </td></tr>
    </table>`;

const email = (subject, heading, ...parts) => ({ subject, heading: heading || subject, body: parts.join("\n") });

const CASE_LABELS = [["Case", "[case.id]"], ["Case Type", "[case.visa_type]"], ["Client", "[client.name]"]];

const EVENT_EMAILS = {
  // ── Case created / assigned ────────────────────────────────────────────
  "case.created:admin": email(
    "New Immigration Case Created", null,
    greeting(),
    p("A new case [case.id] for [client.name] has been created and is awaiting assignment."),
    labels(CASE_LABELS),
    button("Open Case"),
  ),
  "case.cm_assigned:team_lead": email(
    "Case Manager Assigned — Case [case.id]", null,
    greeting(),
    p("Case [case.id] for [client.name] has been assigned to <strong>[casemanager.name]</strong>."),
    labels([...CASE_LABELS, ["Case Manager", "[casemanager.name]"]]),
    p("The client has been told who their case manager is. You can follow progress and reassign the case at any time from the case page."),
    button("Open Case"),
  ),
  "case.cm_assigned:admin": email(
    "Case Assignment Completed — Case [case.id]", null,
    greeting(),
    p("Case [case.id] for [client.name] has been assigned to <strong>[casemanager.name]</strong>."),
    labels([...CASE_LABELS, ["Case Manager", "[casemanager.name]"], ["Team Lead", "[teamlead.name]"]]),
    p("The case manager and the client have both been notified. No action is required from you."),
    button("Open Case"),
  ),
  "case.tl_assigned:case_manager": email(
    "Team Lead Assigned — Case [case.id]", null,
    greeting(),
    p("<strong>[teamlead.name]</strong> has been assigned as the team lead for case [case.id] for [client.name]."),
    labels([...CASE_LABELS, ["Team Lead", "[teamlead.name]"]]),
    p("Your team lead is your point of contact for approvals, escalations and any request to reassign the case."),
    button("Open Case"),
  ),

  // ── Attorney ───────────────────────────────────────────────────────────
  "attorney.assigned:client": email(
    "An attorney has been assigned — Case [case.id]", null,
    greeting(),
    p("We're pleased to let you know that <strong>[attorney.name]</strong> has been assigned to support your immigration case [case.id]."),
    p("Your case manager remains your primary point of contact for any questions about your case. You can message them directly through your portal."),
    button("Go to My Case"),
  ),
  "attorney.assigned:admin": email(
    "Attorney Assigned — Case [case.id]", null,
    greeting(),
    p("<strong>[attorney.name]</strong> has been assigned to case [case.id] for [client.name]."),
    labels([...CASE_LABELS, ["Attorney", "[attorney.name]"]]),
    p("The attorney and the client have been notified. No action is required from you."),
    button("Open Case"),
  ),
  "attorney.removed:attorney": email(
    "Case Access Removed — Case [case.id]", null,
    greeting(),
    p("Your access to case [case.id] has been removed. The case will no longer appear in your Attorney Portal."),
    labels(CASE_LABELS),
    p("If you believe this is a mistake, or you have open items on this case, please contact the case manager, [casemanager.name]."),
    button("Open the Attorney Portal"),
  ),

  // ── Questionnaires / documents ─────────────────────────────────────────
  "questionnaire.assigned:client": email(
    "Action required: questionnaire assigned — Case [case.id]", null,
    greeting(),
    p("Your case manager has assigned a questionnaire that requires your input for your immigration case."),
    p("<strong>Questionnaire:</strong> [document.name]"),
    p("Please complete it as soon as possible to avoid delays."),
    button("Complete Questionnaire"),
  ),
  "questionnaire.submitted:case_manager": email(
    "Client intake submitted for [case.id]", null,
    greeting(),
    p("[client.name] submitted their intake information for case [case.id]."),
    p("Please review the client profile, questionnaire responses, uploaded documents, and missing document list in Admin."),
    button("Open Case"),
  ),
  "document.rejected:client": email(
    "Action required: document needs to be replaced — Case [case.id]", null,
    greeting(),
    p("Your case manager has reviewed the document you submitted (<strong>[document.name]</strong>) and has requested a replacement."),
    p("<strong>Reason:</strong> [document.rejection_reason]"),
    p("Please log in to the portal and upload a corrected version as soon as possible to avoid delays to your case."),
    button("Upload Replacement Document"),
  ),
  "document.uploaded:case_manager": email(
    "New Document to Review — Case [case.id]", null,
    greeting(),
    p("[client.name] has uploaded a document on case [case.id]. It is waiting for your review."),
    labels([["Case", "[case.id]"], ["Client", "[client.name]"], ["Document", "[document.name]"]]),
    p("Please check that it is complete and legible, then approve it or request a replacement so the client is not left waiting."),
    button("Review Document"),
  ),

  // ── RFE (wording of rfe-received) ──────────────────────────────────────
  "rfe.received:team_lead": email(
    "URGENT: USCIS has requested additional evidence — Case [case.id]", null,
    greeting(),
    p("USCIS has issued a <strong>Request for Evidence (RFE)</strong> for the immigration case of [client.name]. This requires attention and a response within the deadline."),
    redLine("Response deadline: [case.rfe_deadline]"),
    p("The case manager is reviewing the RFE and will contact the client with specific next steps. Please log in to the portal for the full notice details."),
    button("View RFE Details", "#dc2626"),
  ),
  "rfe.received:admin": email(
    "URGENT: USCIS has requested additional evidence — Case [case.id]", null,
    greeting(),
    p("USCIS has issued a <strong>Request for Evidence (RFE)</strong> for the immigration case of [client.name]. This requires attention and a response within the deadline."),
    redLine("Response deadline: [case.rfe_deadline]"),
    p("The case manager is reviewing the RFE and will contact the client with specific next steps. Please log in to the portal for the full notice details."),
    button("View RFE Details", "#dc2626"),
  ),
  "rfe.received:attorney": email(
    "URGENT: USCIS has requested additional evidence — Case [case.id]", null,
    greeting(),
    p("USCIS has issued a <strong>Request for Evidence (RFE)</strong> for the immigration case of [client.name]. This requires your attention and a response within the deadline."),
    redLine("Response deadline: [case.rfe_deadline]"),
    p("The case manager is reviewing the RFE and will coordinate with you on specific next steps. Please log in to the Attorney Portal for the full notice details."),
    button("View RFE Details", "#dc2626"),
  ),

  // ── USCIS decision (wording of case-approved / case-denied) ────────────
  "uscis.decision:team_lead": email(
    "USCIS Decision Received — Case [case.id]", null,
    greeting(),
    p("USCIS has issued a decision on the immigration case of [client.name]: <strong>[case.status]</strong>."),
    p("The case manager will contact the client to discuss the decision and the recommended next steps. Please log in to the portal to view the full details."),
    button("View Details"),
  ),
  "uscis.decision:admin": email(
    "USCIS Decision Received — Case [case.id]", null,
    greeting(),
    p("USCIS has issued a decision on the immigration case of [client.name]: <strong>[case.status]</strong>."),
    p("The case manager will contact the client to discuss the decision and the recommended next steps. Please log in to the portal to view the full details."),
    button("View Details"),
  ),
  "uscis.decision:attorney": email(
    "USCIS Decision Received — Case [case.id]", null,
    greeting(),
    p("USCIS has issued a decision on the immigration case of [client.name]: <strong>[case.status]</strong>."),
    p("Please review the decision notice and advise the case manager on the recommended next steps. Please log in to the Attorney Portal to view the full details."),
    button("View Details"),
  ),

  // ── Filed (wording of filing-submitted) ────────────────────────────────
  "case.filed:attorney": email(
    "Case Filed with USCIS — Case [case.id]", null,
    greeting(),
    p("The immigration case of [client.name] has been officially submitted to USCIS."),
    filingBox(),
    p("USCIS will send a receipt notice (Form I-797) to the address of record. Processing times vary — the case manager will notify you as soon as any updates arrive."),
    p("You can track the case status at any time in the portal."),
    button("Track Case"),
  ),
  "case.filed:team_lead": email(
    "Case Filed with USCIS — Case [case.id]", null,
    greeting(),
    p("The immigration case of [client.name] has been officially submitted to USCIS."),
    filingBox(),
    p("USCIS will send a receipt notice (Form I-797) to the address of record. Processing times vary — the case manager will notify you as soon as any updates arrive."),
    p("You can track the case status at any time in the portal."),
    button("Track Case"),
  ),

  // ── Closed (wording of case-closed) / reopened / escalated ─────────────
  "case.closed:admin": email(
    "Case Closed — Case [case.id]", null,
    greeting(),
    p("Immigration case [case.id] for [client.name] has been officially closed."),
    p("<strong>Reason:</strong> [case.closure_reason]"),
    p("If you have any questions about this closure or would like to discuss next steps, please contact us through the portal."),
    button("View Case Details"),
  ),
  "case.closed:team_lead": email(
    "Case Closed — Case [case.id]", null,
    greeting(),
    p("Immigration case [case.id] for [client.name] has been officially closed."),
    p("<strong>Reason:</strong> [case.closure_reason]"),
    p("If you have any questions about this closure or would like to discuss next steps, please contact us through the portal."),
    button("View Case Details"),
  ),
  "case.reopened:case_manager": email(
    "Case Reopened — Case [case.id]", null,
    greeting(),
    p("Case [case.id] for [client.name] has been reopened and is active again."),
    labels(CASE_LABELS),
    p("Please review the case timeline for the reason and any outstanding tasks, and contact the client if they need to be updated."),
    button("Open Case"),
  ),
  "case.reopened:attorney": email(
    "Case Reopened — Case [case.id]", null,
    greeting(),
    p("Case [case.id] for [client.name], which you have access to, has been reopened and is active again."),
    labels(CASE_LABELS),
    p("Please review the case timeline for the reason it was reopened and coordinate with the case manager on whether legal review is needed."),
    button("Open the Attorney Portal"),
  ),
  "case.escalated:team_lead": email(
    "Escalation: Case Deadline Breached — Case [case.id]", null,
    greeting(),
    redLine("Case [case.id] has passed its service-level deadline and needs attention."),
    labels([...CASE_LABELS, ["Case Manager", "[casemanager.name]"], ["Current Stage", "[case.stage]"]]),
    p("Please review the case, confirm who is responsible for the next step and clear any blockers. Reassign the case if the current owner cannot act on it promptly."),
    button("Open Case", "#dc2626"),
  ),
  "case.escalated:admin": email(
    "Escalation: Case Deadline Breached — Case [case.id]", null,
    greeting(),
    redLine("Case [case.id] has passed its service-level deadline and needs attention."),
    labels([...CASE_LABELS, ["Case Manager", "[casemanager.name]"], ["Team Lead", "[teamlead.name]"], ["Current Stage", "[case.stage]"]]),
    p("The case manager and team lead have been notified. This message is for escalation visibility; step in if the case is not being actioned."),
    button("Open Case", "#dc2626"),
  ),
  "case.escalated:super_admin": email(
    "Critical: Case Deadline Breached — Case [case.id]", null,
    greeting(),
    redLine("Case [case.id] has passed its service-level deadline."),
    labels([["Case", "[case.id]"], ["Client", "[client.name]"], ["Current Stage", "[case.stage]"]]),
    p("The responsible case manager and team lead have been notified. You are receiving this because it is a critical, system-level alert."),
    button("Open Case", "#dc2626"),
  ),

  // ── System alerts (Super Admin) ────────────────────────────────────────
  "system.email_failed:super_admin": email(
    "Alert: An Automated Email Could Not Be Delivered", null,
    greeting(),
    p("[system.firm_name] was unable to deliver an automated email."),
    p("<strong>Details:</strong> [case.details]<br/><strong>Time:</strong> [system.date]"),
    p("Please check the email delivery log in the Admin Portal, that the mail provider credentials are valid, and that the recipient address is correct. The failure has been logged for audit."),
    button("Open the Admin Portal"),
  ),
  "system.account_locked:super_admin": email(
    "Security Alert: Account Locked After Failed Sign-Ins", null,
    greeting(),
    p("The account for <strong>[recipient.name]</strong> was locked after repeated failed sign-in attempts."),
    p("The lock is temporary and lifts automatically after the lockout period; an administrator can also unlock the account in Settings → Security. If you do not recognise this activity, reset the user's password and review their recent sign-ins."),
    button("Open the Admin Portal"),
  ),

  // ── Leads ──────────────────────────────────────────────────────────────
  "lead.approved:admin": email(
    "Lead Approved — Ready for Case Creation", null,
    greeting(),
    p("[client.name] has been approved as a lead and is ready to be converted into a case."),
    p("<strong>Name:</strong> [client.name]<br/><strong>Email:</strong> [client.email]"),
    p("Open the lead and create the case; the team lead will assign it to a case manager. The prospect has already been told that their request was approved."),
    button("Open Leads"),
  ),

  // ── Attorney <-> staff dialogue ────────────────────────────────────────
  "attorney.feedback:case_manager": email(
    "New Attorney Feedback — Case [case.id]", null,
    greeting(),
    p("<strong>[attorney.name]</strong> has left a comment on case [case.id] for [client.name]."),
    p("<strong>Message:</strong> [case.details]"),
    p("Please read the full message and reply from the Attorney Messages panel on the case, so the attorney is not left waiting for an answer."),
    button("Open Case Messages"),
  ),
  "attorney.feedback:attorney": email(
    "New Reply From the Case Team — Case [case.id]", null,
    greeting(),
    p("The case team has replied on case [case.id] for [client.name]."),
    p("<strong>Message:</strong> [case.details]"),
    p("Open the Messages section of the Attorney Portal to read the full message and respond."),
    button("Open Messages"),
  ),
};

module.exports = { EVENT_EMAILS };

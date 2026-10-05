// Starting wording for every event-based trigger's customizable email - what
// the editor opens with and what an admin activates as-is. Each is a complete
// professional message: greeting, what happened, a case-details card, what the
// reader should do next, a button into the right portal, and a sign-off.
//
// Where an email existed before (client questionnaire / rejected document /
// RFE / approval / filing / closure ...) its original wording is reused, only
// enriched with the details card. All dynamic values are [variables] from the
// central registry (validated by tests against each trigger's variable groups).

const NAVY = "#1e3a5f";

const greeting = () => `<p style="margin:0 0 16px;">Hi [recipient.name],</p>`;
const para = (html) => `<p style="margin:0 0 16px;">${html}</p>`;
const button = (label, color = NAVY) =>
  `<p style="margin:8px 0 24px;"><a href="[system.portal_link]" style="display:inline-block;padding:12px 24px;background:${color};color:#ffffff;border-radius:8px;text-decoration:none;font-weight:700;">${label}</a></p>`;
const closing = (line) => `${line ? para(line) : ""}<p style="margin:0;">Regards,<br/>The [system.firm_name] Team</p>`;

// Light "case details" card. rows: [label, value] pairs.
const card = (rows) => {
  const cells = rows.map(([label, value], index) => `
        <p style="margin:0 0 2px;color:#6b7280;font-size:12px;letter-spacing:0.5px;text-transform:uppercase;">${label}</p>
        <p style="margin:0 0 ${index === rows.length - 1 ? 0 : 14}px;color:#111827;font-size:15px;font-weight:600;">${value}</p>`).join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin:0 0 20px;width:100%;"><tr><td style="padding:16px 20px;">${cells}
      </td></tr></table>`;
};

const callout = (html, tone = "amber") => {
  const palette = { amber: ["#fffbeb", "#fde68a", "#92400e"], red: ["#fef2f2", "#fecaca", "#991b1b"], green: ["#f0fdf4", "#bbf7d0", "#065f46"] }[tone];
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="background:${palette[0]};border:1px solid ${palette[1]};border-radius:10px;margin:0 0 20px;width:100%;"><tr><td style="padding:14px 20px;color:${palette[2]};font-size:15px;font-weight:600;">${html}</td></tr></table>`;
};

const email = (subject, heading, ...parts) => ({ subject, heading, body: parts.join("\n") });

const CASE_ROWS = [["Case ID", "[case.id]"], ["Client", "[client.name]"], ["Visa type", "[case.visa_type]"]];
const CASE_ROWS_WITH_CM = [...CASE_ROWS, ["Case manager", "[casemanager.name]"]];

const EVENT_EMAILS = {
  // ── Case created / assigned ────────────────────────────────────────────
  "case.created:admin": email(
    "New case created — [case.id] ([client.name])", "A new case has been created",
    greeting(),
    para("A new immigration case has been opened in [system.firm_name] and is now in the intake stage."),
    card([...CASE_ROWS, ["Current stage", "[case.stage]"]]),
    para("The case has been routed to the team lead for assignment to a case manager. No action is required from you unless the case needs administrative attention."),
    button("Open case in the Admin Portal"),
    closing(),
  ),
  "case.cm_assigned:team_lead": email(
    "Case manager assigned — [case.id]", "A case manager has been assigned to your case",
    greeting(),
    para("<strong>[casemanager.name]</strong> has been assigned as the case manager for case <strong>[case.id]</strong>. The client has been notified of the assignment."),
    card(CASE_ROWS_WITH_CM),
    para("You can follow progress, review workload and reassign the case at any time from the case page."),
    button("Open case"),
    closing(),
  ),
  "case.cm_assigned:admin": email(
    "Case assignment completed — [case.id]", "Case assignment completed",
    greeting(),
    para("Case <strong>[case.id]</strong> has been assigned to <strong>[casemanager.name]</strong>. The case manager and the client have both been notified."),
    card([...CASE_ROWS_WITH_CM, ["Team lead", "[teamlead.name]"]]),
    para("This message is for your records; no action is required."),
    button("View case"),
    closing(),
  ),
  "case.tl_assigned:case_manager": email(
    "Team lead assigned to case [case.id]", "A team lead now oversees your case",
    greeting(),
    para("<strong>[teamlead.name]</strong> has been assigned as the team lead for case <strong>[case.id]</strong> ([client.name])."),
    card([...CASE_ROWS, ["Team lead", "[teamlead.name]"]]),
    para("Your team lead is your point of contact for approvals, escalations and any request to reassign or reprioritise the case."),
    button("Open case"),
    closing(),
  ),

  // ── Attorney ───────────────────────────────────────────────────────────
  "attorney.assigned:client": email(
    "An attorney has been assigned to your case — [case.id]", "An attorney is now supporting your case",
    greeting(),
    para("We are pleased to let you know that <strong>[attorney.name]</strong> has been assigned to your immigration case to provide legal review and guidance."),
    card([["Case ID", "[case.id]"], ["Visa type", "[case.visa_type]"], ["Attorney", "[attorney.name]"], ["Case manager", "[casemanager.name]"]]),
    para("There is nothing you need to do. Your case manager remains your primary point of contact and will coordinate with the attorney on your behalf."),
    button("View my case"),
    closing("Thank you for trusting [system.firm_name] with your immigration journey."),
  ),
  "attorney.assigned:admin": email(
    "Attorney assigned — [case.id]", "An attorney has been assigned to a case",
    greeting(),
    para("<strong>[attorney.name]</strong> has been given access to case <strong>[case.id]</strong> for [client.name]. The attorney and the client have been notified."),
    card([...CASE_ROWS_WITH_CM, ["Attorney", "[attorney.name]"]]),
    para("This message is for your records; no action is required."),
    button("View case"),
    closing(),
  ),
  "attorney.removed:attorney": email(
    "Your access to case [case.id] has been removed", "Case access removed",
    greeting(),
    para("Your access to case <strong>[case.id]</strong> ([client.name]) has been removed. The case will no longer appear in your Attorney Portal."),
    card(CASE_ROWS),
    para("If you believe this is a mistake, or you have open items on this case, please contact the case manager, [casemanager.name], so the hand-over can be completed properly."),
    button("Open the Attorney Portal"),
    closing(),
  ),

  // ── Questionnaires / documents ─────────────────────────────────────────
  "questionnaire.assigned:client": email(
    "Action required: questionnaire assigned — Case [case.id]", "A questionnaire is waiting for you",
    greeting(),
    para("Your case manager has assigned a questionnaire that requires your input for your immigration case."),
    card([["Questionnaire", "[document.name]"], ["Case ID", "[case.id]"], ["Case manager", "[casemanager.name]"]]),
    para("Please complete it as soon as possible to avoid delays. You can save your progress and return at any time before submitting."),
    button("Complete questionnaire"),
    closing("If you have trouble answering a question, message your case manager from the portal and they will help."),
  ),
  "questionnaire.submitted:case_manager": email(
    "Questionnaire completed — [case.id] ([client.name])", "A client completed a questionnaire",
    greeting(),
    para("<strong>[client.name]</strong> has completed a questionnaire for case <strong>[case.id]</strong>."),
    card(CASE_ROWS),
    para("Please review the responses, check for missing or inconsistent information, and follow up with the client where something needs to be clarified. Once reviewed, the answers can be used to prepare the USCIS forms."),
    button("Review responses"),
    closing(),
  ),
  "document.rejected:client": email(
    "Action required: document needs to be replaced — Case [case.id]", "Please upload a replacement document",
    greeting(),
    para("Your case manager has reviewed the document you submitted (<strong>[document.name]</strong>) and has requested a replacement."),
    callout("<strong>Reason:</strong> [document.rejection_reason]", "amber"),
    para("Please log in to the portal and upload a corrected version as soon as possible to avoid delays to your case."),
    button("Upload replacement document"),
    closing(),
  ),
  "document.uploaded:case_manager": email(
    "New document to review — [case.id]", "A client uploaded a document",
    greeting(),
    para("<strong>[client.name]</strong> has uploaded <strong>[document.name]</strong> on case <strong>[case.id]</strong>. It is waiting in the document review queue."),
    card([...CASE_ROWS, ["Document", "[document.name]"]]),
    para("Please check that the document is complete and legible and matches what was requested, then approve it or request a replacement so the client is not left waiting."),
    button("Review document"),
    closing(),
  ),

  // ── RFE ────────────────────────────────────────────────────────────────
  "rfe.received:team_lead": email(
    "URGENT: RFE received — [case.id] ([client.name])", "USCIS has issued a Request for Evidence",
    greeting(),
    para("USCIS has issued a <strong>Request for Evidence (RFE)</strong> on a case in your team. A response is required within the deadline."),
    callout("Response deadline: [case.rfe_deadline]", "red"),
    card(CASE_ROWS_WITH_CM),
    para("Please confirm that the case manager and attorney have started on the response and that the evidence needed is being collected from the client. Escalate early if the deadline is at risk."),
    button("Open case and RFE details", "#dc2626"),
    closing(),
  ),
  "rfe.received:admin": email(
    "URGENT: RFE received — [case.id] ([client.name])", "USCIS has issued a Request for Evidence",
    greeting(),
    para("USCIS has issued a <strong>Request for Evidence (RFE)</strong> on case <strong>[case.id]</strong>. This is a time-sensitive matter and the response must be filed before the deadline."),
    callout("Response deadline: [case.rfe_deadline]", "red"),
    card(CASE_ROWS_WITH_CM),
    para("The client, case manager and attorney have been notified. This message is for your visibility; step in if the case needs administrative support."),
    button("Open case", "#dc2626"),
    closing(),
  ),
  "rfe.received:attorney": email(
    "RFE response required — [case.id] ([client.name])", "USCIS has issued a Request for Evidence",
    greeting(),
    para("USCIS has issued a <strong>Request for Evidence (RFE)</strong> on a case you have access to. Your review and legal response strategy are required."),
    callout("Response deadline: [case.rfe_deadline]", "red"),
    card(CASE_ROWS_WITH_CM),
    para("Please open the case, review the RFE notice and the evidence requested, and coordinate with the case manager on what to collect from the client. Use the Feedback section in the portal to send questions or instructions."),
    button("Open case in the Attorney Portal", "#dc2626"),
    closing(),
  ),

  // ── USCIS decision / filing ────────────────────────────────────────────
  "uscis.decision:team_lead": email(
    "USCIS decision received — [case.id]: [case.status]", "USCIS has issued a decision",
    greeting(),
    para("USCIS has issued a decision on case <strong>[case.id]</strong> for [client.name]."),
    card([...CASE_ROWS_WITH_CM, ["Decision", "[case.status]"]]),
    para("The client has been notified through the portal. Please make sure the case manager discusses the outcome and the next steps with the client, and that any follow-up deadlines are added to the case."),
    button("Open case"),
    closing(),
  ),
  "uscis.decision:admin": email(
    "USCIS decision received — [case.id]: [case.status]", "USCIS has issued a decision",
    greeting(),
    para("USCIS has issued a decision on case <strong>[case.id]</strong> for [client.name]."),
    card([...CASE_ROWS_WITH_CM, ["Decision", "[case.status]"]]),
    para("The client, case manager and attorney have been notified. This message is for your records; no action is required."),
    button("Open case"),
    closing(),
  ),
  "uscis.decision:attorney": email(
    "USCIS decision received — [case.id]: [case.status]", "USCIS has issued a decision",
    greeting(),
    para("USCIS has issued a decision on a case you have access to: <strong>[case.id]</strong> for [client.name]."),
    card([...CASE_ROWS_WITH_CM, ["Decision", "[case.status]"]]),
    para("Please review the decision notice and advise the case manager on the next steps, including any appeal, motion or follow-up deadlines that apply."),
    button("Open case in the Attorney Portal"),
    closing(),
  ),
  "case.filed:attorney": email(
    "Case submitted to USCIS — [case.id]", "The case has been filed with USCIS",
    greeting(),
    para("Case <strong>[case.id]</strong> for [client.name] has been officially submitted to USCIS."),
    card(CASE_ROWS_WITH_CM),
    para("USCIS will send a receipt notice (Form I-797) to the address of record. The case manager will record the receipt number as soon as it arrives. You will be notified of any RFE or decision."),
    button("View case in the Attorney Portal"),
    closing(),
  ),
  "case.filed:team_lead": email(
    "Case submitted to USCIS — [case.id]", "A case has been filed with USCIS",
    greeting(),
    para("Case <strong>[case.id]</strong> for [client.name] has been officially submitted to USCIS."),
    card(CASE_ROWS_WITH_CM),
    para("USCIS will send a receipt notice (Form I-797) to the address of record, and the case manager will record the receipt number when it arrives. Processing times vary; you will be notified of any update."),
    button("View case"),
    closing(),
  ),

  // ── Closed / reopened / escalated ──────────────────────────────────────
  "case.closed:admin": email(
    "Case closed — [case.id]", "A case has been closed",
    greeting(),
    para("Case <strong>[case.id]</strong> ([client.name]) has been officially closed. The client has been informed."),
    card(CASE_ROWS_WITH_CM),
    para("No further action is required. Closed cases remain available for reference and can be reopened by authorized staff if circumstances change."),
    button("View case"),
    closing(),
  ),
  "case.closed:team_lead": email(
    "Case closed — [case.id]", "A case in your team has been closed",
    greeting(),
    para("Case <strong>[case.id]</strong> ([client.name]) has been officially closed. The client has been informed."),
    card(CASE_ROWS_WITH_CM),
    para("No further action is required. If the closure looks unexpected, review the case timeline or ask the case manager for the reason."),
    button("View case"),
    closing(),
  ),
  "case.reopened:case_manager": email(
    "Case reopened — [case.id] ([client.name])", "A case has been reopened",
    greeting(),
    para("Case <strong>[case.id]</strong> ([client.name]) has been reopened and is active again."),
    card(CASE_ROWS_WITH_CM),
    para("Please review the case timeline for the reason and any outstanding tasks, and contact the client if they need to be updated."),
    button("Open case"),
    closing(),
  ),
  "case.reopened:attorney": email(
    "Case reopened — [case.id] ([client.name])", "A case has been reopened",
    greeting(),
    para("Case <strong>[case.id]</strong> ([client.name]), which you have access to, has been reopened and is active again."),
    card(CASE_ROWS_WITH_CM),
    para("Please review the case timeline for the reason it was reopened and coordinate with the case manager on whether legal review is needed."),
    button("Open case in the Attorney Portal"),
    closing(),
  ),
  "case.escalated:team_lead": email(
    "Escalation: case deadline breached — [case.id]", "A case has breached its deadline",
    greeting(),
    callout("Case [case.id] has passed its service-level deadline and needs attention.", "red"),
    card([...CASE_ROWS_WITH_CM, ["Current stage", "[case.stage]"]]),
    para("Please review the case, confirm who is responsible for the next step and clear any blockers. Reassign the case if the current owner cannot act on it promptly."),
    button("Open case", "#dc2626"),
    closing(),
  ),
  "case.escalated:admin": email(
    "Escalation: case deadline breached — [case.id]", "A case has breached its deadline",
    greeting(),
    callout("Case [case.id] has passed its service-level deadline and needs attention.", "red"),
    card([...CASE_ROWS_WITH_CM, ["Team lead", "[teamlead.name]"]]),
    para("The case manager and team lead have been notified. This message is for escalation visibility; step in if the case is not being actioned."),
    button("Open case", "#dc2626"),
    closing(),
  ),
  "case.escalated:super_admin": email(
    "Critical: case deadline breached — [case.id]", "A case has breached its deadline",
    greeting(),
    callout("Case [case.id] has passed its service-level deadline.", "red"),
    card([["Case ID", "[case.id]"], ["Client", "[client.name]"], ["Current stage", "[case.stage]"]]),
    para("The responsible case manager and team lead have been notified. You are receiving this because it is a critical, system-level alert."),
    button("Open case", "#dc2626"),
    closing(),
  ),

  // ── System alerts (Super Admin) ────────────────────────────────────────
  "system.email_failed:super_admin": email(
    "Alert: an automated email could not be delivered", "Email delivery failed",
    greeting(),
    para("[system.firm_name] was unable to deliver an automated email."),
    card([["Details", "[case.details]"], ["Time", "[system.date]"]]),
    para("<strong>What to check:</strong> the email delivery log in the Admin Portal, that the mail provider credentials are valid, and that the recipient address is correct. The failure has been logged for audit."),
    button("Open the Admin Portal"),
    closing(),
  ),
  "system.account_locked:super_admin": email(
    "Security alert: account locked after failed sign-ins", "An account has been locked",
    greeting(),
    para("The account for <strong>[recipient.name]</strong> was locked after repeated failed sign-in attempts."),
    card([["Account", "[recipient.name]"], ["Time", "[system.date]"]]),
    para("<strong>What this means:</strong> the lock is temporary and lifts automatically after the lockout period; an administrator can also unlock the account in Settings → Security. If you do not recognise this activity, reset the user's password and review their recent sign-ins."),
    button("Open the Admin Portal"),
    closing(),
  ),

  // ── Leads ──────────────────────────────────────────────────────────────
  "lead.approved:admin": email(
    "Lead approved — ready for case creation", "A lead has been approved",
    greeting(),
    para("<strong>[client.name]</strong> has been approved as a lead and is ready to be converted into a case."),
    card([["Name", "[client.name]"], ["Email", "[client.email]"]]),
    para("Open the lead, create the case, and the team lead will assign it to a case manager. The prospect has already been told that their request was approved."),
    button("Open Leads"),
    closing(),
  ),

  // ── Attorney <-> staff dialogue ────────────────────────────────────────
  "attorney.feedback:case_manager": email(
    "New attorney feedback on [case.id]", "An attorney left a comment",
    greeting(),
    para("<strong>[attorney.name]</strong> has left a comment on case <strong>[case.id]</strong> ([client.name])."),
    callout("[case.details]", "green"),
    para("Please read the full message and reply from the Attorney Messages panel on the case, so the attorney is not left waiting for an answer."),
    button("Open case messages"),
    closing(),
  ),
  "attorney.feedback:attorney": email(
    "New reply from the case team on [case.id]", "The case team replied",
    greeting(),
    para("The case team has replied on case <strong>[case.id]</strong> ([client.name])."),
    callout("[case.details]", "green"),
    para("Open the Messages section of the Attorney Portal to read the full message and respond."),
    button("Open messages in the Attorney Portal"),
    closing(),
  ),
};

module.exports = { EVENT_EMAILS };

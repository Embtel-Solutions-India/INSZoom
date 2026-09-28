// One-off testing utility — sends every registered email template
// (Backend/src/modules/email/email.service.js's TEMPLATES registry) to a
// single test address with realistic sample data, so every template can be
// visually reviewed at once instead of triggering each one through its real
// business flow. Not wired into any app code path; run manually:
//
//   node src/scripts/sendAllTemplateEmailsForTesting.js you@example.com
//   node src/scripts/sendAllTemplateEmailsForTesting.js you@example.com --only=all
//
// Every send still goes through the real emailService.sendTemplateEmail() ->
// EmailLog + provider dispatch path, so each attempt is logged exactly like
// a real send (status sent/failed/skipped) and visible in the EmailLog
// collection / Admin's email log view afterward.
require("dotenv").config();
const mongoose = require("mongoose");
const env = require("../config/env");
const emailService = require("../modules/email/email.service");

const TO = process.argv[2] || "ishaan@embtelsolutions.com";

// The first full run (10 sent, then the provider's daily send quota kicked
// in) left these 27 never actually attempted successfully — this is the
// default set so "run it again" resumes from where the quota cut it off
// instead of re-spending quota on the 10 that already went through. Pass
// --only=all to force every template again regardless.
const REMAINING_AFTER_QUOTA_CUTOFF = [
  "quiz-lead-confirmation", "quiz-lead-internal", "consultation-confirmation", "consultation-reschedule",
  "consultation-cancel", "consultation-host-notify", "lead-approved", "lead-rejected", "document-rejected",
  "document-requested", "signature-required", "filing-submitted", "receipt-received", "rfe-received",
  "case-approved", "case-denied", "case-stage-changed", "payment-required",
  "case-manager-assigned", "case-manager-reassigned", "case-closed",
  "questionnaire-assigned", "additional-info-requested", "case-on-hold",
];
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const FILTER = onlyArg ? onlyArg.slice("--only=".length).split(",") : REMAINING_AFTER_QUOTA_CUTOFF;

// One sample-data payload per template key, covering every field that
// template's subject()/bodyLines() actually reads (enumerated directly from
// each template file) with realistic-looking values — not generic
// placeholders — so the rendered email looks like a genuine notification.
// Each client-facing template below gets its own distinct sample name -
// showing the same name on every template when reviewing them side by side
// reads as a bug even though it isn't one; every REAL send already threads
// the actual recipient's name through (verified directly in each real
// trigger's call site — CaseStatusService, case.controller.js,
// attorneyAccess.service.js, consultation.service.js — none of them fall
// back to a hardcoded name).
//
// IMPORTANT: the "*-token-*" values below (invite/reset tokens) are
// deliberately fake and were never written to any User document, so
// clicking Accept/Reset in one of these test emails will always land on
// "Invalid or expired link" — that is not a bug in the real invite/reset
// flow, just a limitation of sending a preview without also seeding a real,
// matching DB record. To test the real end-to-end link, trigger the actual
// flow (create a case / invite a user / use "forgot password") instead of
// this script.
const SAMPLE_DATA = {
  "case-created-client": { caseNumber: "IMG-2026-0142", clientName: "Priya Sharma" },
  "case-created-team-lead": { caseNumber: "IMG-2026-0143", clientName: "Wei Zhang", teamLeadName: "Marcus Chen" },
  "case-assigned-case-manager": { caseManagerName: "Marcus Chen", caseNumber: "IMG-2026-0144", clientName: "Fatima Al-Sayed" },
  "client-intake-submitted-case-manager": { caseManagerName: "Marcus Chen", clientName: "Diego Fernandez", caseNumber: "IMG-2026-0145", completionPercentage: 85 },
  "employee-case-invitation": { caseNumber: "IMG-2026-0146", employeeName: "Ananya Rao", employerName: "Bay Area Tech Inc.", token: "sample-invite-token-abc123" },
  "staff-invitation": { invitedByName: "Marcus Chen", name: "Jordan Lee", role: "case_manager", token: "sample-invite-token-def456" },
  "attorney-assignment": { assignedByName: "Marcus Chen", attorneyName: "David Whitfield, Esq.", attorneyPortalUrl: "https://attorney.immiglance.com", caseNumber: "IMG-2026-0147", clientName: "Kwame Mensah", visaType: "H-1B" },
  "client-portal-invitation": { caseNumber: "IMG-2026-0142", clientName: "Priya Sharma", token: "sample-invite-token-ghi789" },
  "password-reset": { name: "Sofia Rossi", token: "sample-reset-token-jkl012" },
  "family-beneficiary-invitation": { beneficiaryName: "Rahul Sharma", caseNumber: "IMG-2026-0142", petitionerName: "Priya Sharma", token: "sample-invite-token-mno345" },
  "quiz-lead-confirmation": { fullName: "Hana Kobayashi", nextStep: "Schedule your free consultation", pathwayString: "H-1B Specialty Occupation", visaPathway: "H-1B" },
  "quiz-lead-internal": { criteriaMetCount: 4, email: "hana.kobayashi@example.com", fullName: "Hana Kobayashi", phone: "+1 (415) 555-0142", routing: "case_manager", source: "Website Quiz", tier: "A", visaPathway: "H-1B" },
  "consultation-confirmation": { fullName: "Omar Haddad", locationType: "video", manageUrl: "https://immiglance.com/consultation/booking/sample123", meetingUrl: "https://meet.google.com/sample-abc-def", publicHostName: "David Whitfield, Esq.", startAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString() },
  "consultation-reschedule": { fullName: "Omar Haddad", locationType: "video", manageUrl: "https://immiglance.com/consultation/booking/sample123", publicHostName: "David Whitfield, Esq.", startAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() },
  "consultation-cancel": { fullName: "Grace Okafor", reason: "Client requested a different time", startAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString() },
  "consultation-host-notify": { criteriaMetCount: 4, email: "linh.nguyen@example.com", fullName: "Linh Nguyen", phone: "+1 (415) 555-0142", startAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), tier: "A", visaPathway: "H-1B" },
  "lead-approved": { fullName: "Carlos Mendoza" },
  "lead-rejected": { fullName: "Elena Petrova", rejectionReason: "Does not currently meet the minimum criteria for this pathway" },
  "document-rejected": { caseNumber: "IMG-2026-0148", documentName: "Passport Copy", portalLink: "https://client.immiglance.com/dashboard/documents", recipientName: "Noah Williams", rejectionReason: "Image is blurry — please re-upload a clearer scan" },
  "document-requested": { caseNumber: "IMG-2026-0149", documentCount: 3, documentList: "Passport, I-94, Employment Offer Letter", portalLink: "https://client.immiglance.com/dashboard/documents", recipientName: "Amara Okonkwo" },
  "signature-required": { caseNumber: "IMG-2026-0150", documentName: "Form G-28", portalLink: "https://client.immiglance.com/dashboard/documents", recipientName: "Lucas Silva" },
  "filing-submitted": { caseNumber: "IMG-2026-0151", clientName: "Mei Lin", filingDate: new Date().toISOString(), filingType: "I-129 Petition", portalLink: "https://client.immiglance.com/dashboard" },
  "receipt-received": { caseNumber: "IMG-2026-0152", clientName: "Arjun Patel", receiptDate: new Date().toISOString(), receiptNumber: "WAC2612345678" },
  "rfe-received": { caseNumber: "IMG-2026-0153", clientName: "Isabella Rossi", portalLink: "https://client.immiglance.com/dashboard", rfeDeadline: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString() },
  "case-approved": { caseNumber: "IMG-2026-0154", clientName: "Youssef Ibrahim", portalLink: "https://client.immiglance.com/dashboard" },
  "case-denied": { caseNumber: "IMG-2026-0155", clientName: "Hiroshi Tanaka", portalLink: "https://client.immiglance.com/dashboard" },
  "case-stage-changed": { caseNumber: "IMG-2026-0156", clientName: "Zara Ahmed", portalLink: "https://client.immiglance.com/dashboard", stage: "evidence_gathering", stageName: "Evidence Gathering" },
  "payment-required": { amount: "1,500.00", caseNumber: "IMG-2026-0157", clientName: "Miguel Torres", dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), paymentLink: "https://client.immiglance.com/dashboard/payments", portalLink: "https://client.immiglance.com/dashboard" },
  "case-manager-assigned": { caseManagerName: "Marcus Chen", caseNumber: "IMG-2026-0158", clientName: "Anjali Desai", portalLink: "https://client.immiglance.com/dashboard" },
  "case-manager-reassigned": { caseNumber: "IMG-2026-0159", clientName: "Thabo Nkosi", newCaseManagerName: "Jordan Lee", portalLink: "https://client.immiglance.com/dashboard", previousCaseManagerName: "Marcus Chen" },
  "case-closed": { caseNumber: "IMG-2026-0160", clientName: "Camille Dubois", closureReason: "Petition approved and case successfully completed", portalLink: "https://client.immiglance.com/dashboard" },
  "questionnaire-assigned": { caseNumber: "IMG-2026-0161", deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), portalLink: "https://client.immiglance.com/dashboard", questionnaireName: "H-1B Beneficiary Questionnaire", recipientName: "Ravi Kumar" },
  "additional-info-requested": { caseNumber: "IMG-2026-0162", details: "Please clarify the gap in employment history between March and June 2025", portalLink: "https://client.immiglance.com/dashboard", recipientName: "Sara Lindqvist" },
  "case-on-hold": { caseNumber: "IMG-2026-0163", clientName: "Daniel Kim", holdReason: "Awaiting additional evidence from client", portalLink: "https://client.immiglance.com/dashboard" },
};

async function main() {
  await mongoose.connect(env.mongoUri, { maxPoolSize: 5 });

  const templateKeys = FILTER[0] === "all" ? Object.keys(SAMPLE_DATA) : FILTER;
  console.log(`Provider configured: ${emailService.isConfigured()}`);
  console.log(`Sending ${templateKeys.length} template emails to ${TO}...\n`);

  const results = [];
  for (const key of templateKeys) {
    const data = SAMPLE_DATA[key];
    try {
      const result = await emailService.sendTemplateEmail(key, {
        to: TO,
        data,
        source: "system",
      });
      const status = result.sent ? "SENT" : result.skipped ? "SKIPPED" : "FAILED";
      console.log(`[${status}] ${key}${result.error ? ` — ${result.error.message || result.error}` : ""}`);
      results.push({ key, status });
    } catch (err) {
      console.log(`[ERROR] ${key} — ${err.message}`);
      results.push({ key, status: "ERROR", error: err.message });
    }
  }

  const summary = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  console.log("\n--- Summary ---");
  console.log(summary);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});

const DEFAULT_CASE_WORKFLOW_TEMPLATE = {
  key: "enterprise_case_lifecycle",
  name: "Enterprise Case Lifecycle",
  description: "Default immigration case workflow used by client and admin portals.",
  version: 1,
  status: "active",
  module: "cases",
  entityType: "case",
  triggers: [
    "case.created",
    "payment.completed",
    "payment.failed",
    "documents.requested",
    "document.uploaded",
    "document.approved",
    "document.rejected",
    "questionnaire.submitted",
    "questionnaire.approved",
    "uscis.form.generated",
    "uscis.form.approved",
    "pdf.generated",
    "pdf.approved",
    "attorney.review.completed",
    "attorney.review.revisions_requested",
    "professor.assigned",
    "recommendation_letter.uploaded",
    "petition.draft.completed",
    "filing.approved",
    "case.filed",
    "rfe.received",
    "rfe.submitted",
    "case.approved",
    "case.rejected",
    "case.closed",
  ],
  stages: [
    { key: "intake", name: "Intake", order: 1, requiredRoles: ["case_manager"], slaHours: 72 },
    { key: "strategy", name: "Strategy", order: 2, requiredRoles: ["case_manager", "attorney"], slaHours: 120 },
    { key: "evidence", name: "Evidence Collection", order: 3, requiredRoles: ["case_manager", "client"], slaHours: 168 },
    { key: "expert_letters", name: "Expert Letters", order: 4, requiredRoles: ["professor", "attorney"], slaHours: 240 },
    { key: "attorney_review", name: "Attorney Review", order: 5, requiredRoles: ["attorney"], slaHours: 96, approvalRequired: true },
    { key: "filing", name: "Filing", order: 6, requiredRoles: ["attorney", "case_manager"], slaHours: 72, approvalRequired: true },
    { key: "processing", name: "USCIS Processing", order: 7, requiredRoles: ["case_manager"], slaHours: 720 },
    { key: "rfe", name: "RFE Response", order: 8, requiredRoles: ["attorney", "case_manager"], slaHours: 168 },
    { key: "approved", name: "Approved", order: 9, requiredRoles: ["case_manager"], slaHours: 24 },
    { key: "denied", name: "Denied", order: 10, requiredRoles: ["attorney", "case_manager"], slaHours: 48 },
    { key: "closed", name: "Closed", order: 11, requiredRoles: ["case_manager"], slaHours: 24 },
  ],
  transitions: [
    {
      from: "*",
      to: "intake",
      event: "payment.completed",
      automatic: true,
      priority: 20,
      actions: [
        // Case-manager assignment is a deliberate team-lead action (see
        // case.routes.js's PUT /:id/assign-case-manager, gated to
        // super_admin/admin/team_lead) - it must never happen automatically
        // here, otherwise every case silently lands on whichever case
        // manager getAvailableUser() picks (in a small-staff environment,
        // always the same person).
        { type: "create_task", config: { title: "Welcome and complete intake", category: "case_preparation", assignTo: "team_lead", dueInHours: 120, priority: "high", tags: ["welcome", "intake"] } },
        { type: "notify", config: { roles: ["team_lead"], title: "Payment completed", message: "A paid case is ready for intake and needs a case manager assigned.", notificationType: "case_payment_completed" } },
      ],
    },
    {
      from: "*",
      to: "intake",
      event: "case.created",
      automatic: true,
      priority: 15,
      actions: [
        // See the note on the payment.completed transition above -
        // assignment must only happen via the team lead's explicit
        // assign-case-manager action, never automatically on case creation.
        { type: "create_task", config: { title: "Assign a case manager", category: "case_preparation", assignTo: "team_lead", dueInHours: 24, priority: "high", tags: ["assignment"] } },
        { type: "create_task", config: { title: "Initial case review", category: "case_preparation", assignTo: "case_manager", dueInHours: 72, priority: "high", tags: ["initial", "review"] } },
        { type: "create_task", config: { title: "Collect required documents", category: "document_review", assignTo: "case_manager", dueInHours: 168, priority: "high", tags: ["documents", "collection"] } },
        { type: "generate_questionnaire", config: { source: "case_created" } },
        { type: "notify", config: { roles: ["team_lead"], title: "New case awaiting assignment", message: "A new immigration case has been created and needs a case manager assigned.", notificationType: "case_created" } },
      ],
    },
    {
      from: "intake",
      to: "strategy",
      event: "questionnaire.submitted",
      automatic: true,
      actions: [
        { type: "create_task", config: { title: "Review submitted questionnaire", category: "case_preparation", assignTo: "case_manager", dueInHours: 24, priority: "high" } },
        { type: "notify", config: { roles: ["case_manager"], title: "Questionnaire submitted", message: "Client submitted the questionnaire." } },
      ],
    },
    {
      from: "strategy",
      to: "evidence",
      event: "documents.requested",
      automatic: true,
      actions: [
        { type: "create_task", config: { title: "Collect required evidence", category: "document_review", assignTo: "case_manager", dueInHours: 72, priority: "high" } },
        { type: "notify", config: { roles: ["client"], title: "Documents requested", message: "Required documents have been requested." } },
      ],
    },
    {
      from: "evidence",
      to: "evidence",
      event: "document.uploaded",
      automatic: true,
      actions: [
        { type: "create_task", config: { title: "Review uploaded document", category: "document_review", assignTo: "case_manager", dueInHours: 24, priority: "high", tags: ["document", "review"] } },
        { type: "notify", config: { roles: ["case_manager"], title: "Document uploaded", message: "A client uploaded a document for review.", notificationType: "document_uploaded" } },
        { type: "trigger_ocr", config: { source: "document_uploaded" } },
      ],
    },
    {
      from: "evidence",
      to: "attorney_review",
      event: "document.approved",
      conditions: [{ field: "allDocumentsApproved", operator: "equals", value: true }],
      automatic: true,
      actions: [
        { type: "create_task", config: { title: "Attorney review", category: "legal_review", assignTo: "attorney", dueInHours: 48, priority: "high" } },
        { type: "notify", config: { roles: ["attorney"], title: "Case ready for attorney review", message: "Evidence has been approved." } },
      ],
    },
    {
      from: "*",
      to: "evidence",
      event: "document.rejected",
      automatic: true,
      priority: 12,
      actions: [
        { type: "create_task", config: { title: "Request replacement document", category: "document_review", assignTo: "case_manager", dueInHours: 24, priority: "high", tags: ["document", "rejected", "replacement"] } },
        { type: "notify", config: { roles: ["client", "case_manager"], title: "Document needs revision", message: "A submitted document was rejected and requires replacement.", notificationType: "document_rejected" } },
      ],
    },
    {
      from: "attorney_review",
      to: "attorney_review",
      event: "questionnaire.approved",
      automatic: true,
      actions: [
        { type: "create_task", config: { title: "Collect documents from approved questionnaire", category: "document_review", assignTo: "case_manager", dueInHours: 72, priority: "high" } },
        { type: "notify", config: { roles: ["client"], title: "Questionnaire approved", message: "Your questionnaire was approved. Please upload required documents.", notificationType: "questionnaire_approved" } },
      ],
    },
    {
      from: "evidence",
      to: "expert_letters",
      event: "professor.assigned",
      automatic: true,
      actions: [
        { type: "create_task", config: { title: "Request recommendation letter", category: "expert_letter", assignTo: "professor", dueInHours: 168, priority: "high" } },
        { type: "notify", config: { roles: ["professor"], title: "Recommendation letter requested", message: "Please prepare the expert recommendation letter.", notificationType: "recommendation_letter_requested" } },
      ],
    },
    {
      from: "expert_letters",
      to: "attorney_review",
      event: "recommendation_letter.uploaded",
      automatic: true,
      actions: [
        { type: "create_task", config: { title: "Review recommendation letter", category: "legal_review", assignTo: "attorney", dueInHours: 48, priority: "high" } },
        { type: "notify", config: { roles: ["attorney"], title: "Recommendation letter uploaded", message: "A professor uploaded a recommendation letter.", notificationType: "recommendation_letter_uploaded" } },
      ],
    },
    {
      from: "attorney_review",
      to: "filing",
      event: "attorney.review.completed",
      automatic: true,
      actions: [
        { type: "create_task", config: { title: "Prepare filing package", category: "filing", assignTo: "case_manager", dueInHours: 48, priority: "urgent" } },
        { type: "set_case_status", config: { status: "ready_for_filing" } },
      ],
    },
    {
      from: "attorney_review",
      to: "attorney_review",
      event: "attorney.review.revisions_requested",
      automatic: true,
      priority: 18,
      actions: [
        { type: "create_task", config: { title: "Resolve attorney review revisions", category: "legal_review", assignTo: "case_manager", dueInHours: 24, priority: "urgent", tags: ["attorney", "revision"] } },
        { type: "notify", config: { roles: ["case_manager"], title: "Attorney requested revisions", message: "Review the requested changes and update the case materials.", notificationType: "attorney_revisions_requested" } },
      ],
    },
    {
      from: "attorney_review",
      to: "attorney_review",
      event: "uscis.form.generated",
      automatic: true,
      priority: 10,
      actions: [
        { type: "create_task", config: { title: "Review generated USCIS form", category: "legal_review", assignTo: "attorney", dueInHours: 48, priority: "high", tags: ["uscis", "form", "review"] } },
        { type: "notify", config: { roles: ["attorney"], title: "USCIS form generated", message: "A generated USCIS form is ready for legal review.", notificationType: "uscis_form_generated" } },
      ],
    },
    {
      from: "attorney_review",
      to: "filing",
      event: "uscis.form.approved",
      automatic: true,
      priority: 19,
      actions: [
        { type: "create_task", config: { title: "Prepare approved USCIS form for filing package", category: "filing", assignTo: "case_manager", dueInHours: 24, priority: "high", tags: ["uscis", "approved", "filing"] } },
        { type: "notify", config: { roles: ["case_manager"], title: "USCIS form approved", message: "An approved USCIS form is ready for filing package preparation.", notificationType: "uscis_form_approved" } },
      ],
    },
    {
      from: "attorney_review",
      to: "filing",
      event: "petition.draft.completed",
      automatic: true,
      actions: [
        { type: "create_task", config: { title: "Approve petition draft", category: "legal_review", assignTo: "attorney", dueInHours: 72, priority: "high" } },
        { type: "set_case_status", config: { status: "pending_approval" } },
      ],
    },
    {
      from: "filing",
      to: "filing",
      event: "filing.approved",
      automatic: true,
      actions: [
        { type: "create_task", config: { title: "File petition with USCIS", category: "filing", assignTo: "case_manager", dueInHours: 120, priority: "urgent" } },
        { type: "generate_uscis_forms", config: { source: "filing_approved" } },
        { type: "notify", config: { roles: ["admin", "case_manager"], title: "Case ready for filing", message: "Filing package is approved.", notificationType: "filing_approved" } },
      ],
    },
    {
      from: "filing",
      to: "processing",
      event: "case.filed",
      automatic: true,
      actions: [
        { type: "set_case_status", config: { status: "processing" } },
        { type: "notify", config: { roles: ["client", "case_manager"], title: "Case filed", message: "The case has been filed and is now processing." } },
      ],
    },
    {
      from: "*",
      to: "intake",
      event: "payment.failed",
      automatic: true,
      priority: 16,
      actions: [
        { type: "create_task", config: { title: "Resolve failed client payment", category: "finance", assignTo: "finance", dueInHours: 24, priority: "high", tags: ["payment", "failed"] } },
        { type: "notify", config: { roles: ["finance", "case_manager"], title: "Payment failed", message: "A client payment failed and requires follow-up.", notificationType: "payment_failed" } },
      ],
    },
    {
      from: "filing",
      to: "filing",
      event: "pdf.generated",
      automatic: true,
      priority: 11,
      actions: [
        { type: "create_task", config: { title: "Verify generated filing PDF", category: "filing", assignTo: "case_manager", dueInHours: 24, priority: "high", tags: ["pdf", "filing"] } },
        { type: "notify", config: { roles: ["case_manager"], title: "Filing PDF generated", message: "A filing PDF has been generated and is ready for verification.", notificationType: "pdf_generated" } },
      ],
    },
    {
      from: "filing",
      to: "filing",
      event: "pdf.approved",
      automatic: true,
      priority: 12,
      actions: [
        { type: "create_task", config: { title: "Finalize filing package", category: "filing", assignTo: "case_manager", dueInHours: 24, priority: "urgent", tags: ["pdf", "approved", "package"] } },
        { type: "notify", config: { roles: ["case_manager", "attorney"], title: "Filing PDF approved", message: "A filing PDF has been approved for package finalization.", notificationType: "pdf_approved" } },
      ],
    },
    {
      from: "processing",
      to: "rfe",
      event: "rfe.received",
      automatic: true,
      actions: [
        { type: "create_task", config: { title: "Prepare RFE response", category: "rfe_response", assignTo: "attorney", dueInHours: 72, priority: "urgent" } },
        { type: "notify", config: { roles: ["attorney", "case_manager"], title: "RFE received", message: "RFE response workflow started." } },
      ],
    },
    {
      from: "rfe",
      to: "processing",
      event: "rfe.submitted",
      automatic: true,
      actions: [
        { type: "set_case_status", config: { status: "processing" } },
        { type: "close_tasks", config: { category: "rfe_response" } },
        { type: "notify", config: { roles: ["attorney", "case_manager"], title: "RFE response submitted", message: "Case returned to processing.", notificationType: "rfe_submitted" } },
      ],
    },
    {
      from: "processing",
      to: "approved",
      event: "case.approved",
      automatic: true,
      actions: [
        { type: "set_case_status", config: { status: "approved" } },
        { type: "notify", config: { roles: ["client", "case_manager", "attorney"], title: "Case approved", message: "Case has been approved." } },
      ],
    },
    {
      from: "*",
      to: "denied",
      event: "case.rejected",
      automatic: true,
      actions: [
        { type: "set_case_status", config: { status: "rejected" } },
        { type: "create_task", config: { title: "Review denial and next steps", category: "legal_review", assignTo: "attorney", dueInHours: 48, priority: "urgent" } },
      ],
    },
    {
      from: "*",
      to: "closed",
      event: "case.closed",
      automatic: true,
      actions: [
        { type: "set_case_status", config: { status: "closed" } },
        { type: "close_tasks", config: { status: "cancelled" } },
        { type: "notify", config: { roles: ["case_manager"], title: "Case closed", message: "The case has been closed.", notificationType: "case_closed" } },
      ],
    },
  ],
};

module.exports = {
  DEFAULT_CASE_WORKFLOW_TEMPLATE,
};

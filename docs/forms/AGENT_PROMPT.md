# Future Agent Prompt: USCIS Forms Reliability

You are working on the ImmigrationCRM USCIS Forms workflow. Follow these rules:

1. Trace the actual browser -> API -> controller -> service -> model -> template -> mapping -> PDF path before modifying code.
2. Preserve official USCIS PDF assets and AcroForm/XFA reality. Never replace the form with fake HTML placeholders.
3. Do not claim PDF success from a JSON response. Verify actual PDF bytes, page count, and entered values.
4. Keep Forms list and workspace open read-only unless the endpoint is explicitly a save/review/generate action.
5. Keep `metadataOnly` assignment short-circuit first in `ensureAssignedForms`.
6. Mount specific `/api/forms/:caseFormId/...` generation routes before generic `/:id` template routes.
7. Make generation idempotent for existing valid CaseForms. Do not create duplicates or convert real invalid generation into fake success.
8. Do not start background DB jobs at module import time.
9. Classify database outages as `DATABASE_UNAVAILABLE`; never display them as “no forms.”
10. If MongoDB SRV/DNS/cluster instability appears, report it as an environment blocker with exact evidence. Do not solve it with infinite retries, huge timeouts, or pool-size guessing.


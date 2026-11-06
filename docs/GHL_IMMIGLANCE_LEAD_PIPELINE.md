# GoHighLevel "Immiglance Pipeline" (leads only), 2026-11-06

A third GoHighLevel pipeline, **separate** from the two case pipelines (Immigrant / Non-Immigrant Documentation). It holds only the leads from the Admin **Leads** page. It is not in `GHLIntegration.pipelines`, so the Pipeline board, the stage sync, the reconcile passes and case creation never see it.

## What it does
- **New lead -> one card in the pipeline's first stage** ("Lead"). Every lead path is covered: eligibility quiz (when finished, not drafts), consultation request, Immiglance appointment form, intake. Sent in the background after the lead is saved; the request never waits for it and never fails because of it.
- **On the card:** the contact (name, e-mail, phone), the opportunity (name = `Person - Visa (L-007)`, source `Immiglance`) and **one note** with everything else the lead carries (source, status, visa pathway / interest, message, quiz tier / routing / score, consultation dates and notes, UTM, created time, quiz answers).
- **No stage sync.** Later edits of the lead, or moving the card between stages, are not mirrored.
- **Delete both ways.** Deleting a lead in Admin (new trash button on the lead drawer, with a confirm dialog) deletes its card in GoHighLevel **first**; if GoHighLevel cannot be reached the lead is kept and the person is told to retry. Deleting the card in GoHighLevel deletes the lead here: through the webhook (`OpportunityDelete`, after the card is confirmed gone), with a periodic check as a safety net (two-step, same `GHL_DELETE_CASES_REMOVED_IN_GHL` switch and `GHL_DELETE_CONFIRM_MS` window as cases).
- **Visible only on the Leads page** (a "GoHighLevel: ..." line in the lead drawer). Not on the Pipeline page.
- Leads from **before** this feature are never sent (only leads this feature marked are retried).

## Same integration conventions as the two case pipelines
Pipeline id in the environment, the same GoHighLevel client (token, retries, back-off), the same webhook endpoint and signature check, durable retry (marked leads are retried by a background sweep every 5 minutes, up to 8 tries, with a claim so two workers never send the same lead), the same delete safeguards, and a health block in `GET /api/integrations/ghl/status` (`leadPipeline`: configured, counts by sending state). The case pipelines' own status is untouched.

## Environment
- `GHL_IMMIGLANCE_PIPELINE_ID` : the pipeline's GoHighLevel id (placeholder in `Backend/.env.example`; real value set in the local `.env`).
  **Production: set it on the production server** to the same value (`h9M5BnTOC1j8jqiQmLIT` is the id of "Immiglance Pipeline" in the connected GoHighLevel location). Without it nothing is sent and nothing else changes.
- `GHL_LEAD_PIPELINE_SYNC=false` : switches the lead sync off (optional).
- `GHL_ENABLED=true`, token, location id and webhook key are the existing GoHighLevel settings (already used by the case pipelines).
- Optional tuning: `GHL_LEAD_SWEEP_MS` (default 5 minutes).

## In GoHighLevel
- The pipeline must have **"Allow duplicate opportunities"** turned ON (Opportunities > Pipelines > Immiglance Pipeline > Edit). Otherwise a returning person's second lead is refused; the lead shows "could not reach GoHighLevel" and retries, with the reason in the lead's `ghl.error`.
- The location's webhook already covers opportunity events; no new webhook is needed.

## Files
Backend: `integrations/ghl/ghlLeadPipeline.js` (new), `modules/leads/lead-delete.service.js` (new), `models/Lead.js` (additive `ghl` block + index), `modules/leads/lead.service.js` (one call after each lead is created), `modules/eligibility-quiz/quiz.controller.js` + `quiz.routes.js` (`DELETE /eligibility-quiz/leads/:id`), `integrations/ghl/ghlWebhookService.js` (guard at the top of the opportunity handler), `integrations/ghl/ghl.controller.js` (status key), `config/env.js`, `server.js` (sweep + reconcile job), `.env.example`, `integrations/ghl/tests/ghl-lead-pipeline.test.js` (10 tests).
Admin: `pages/Leads.jsx`, `services/api.js`.

## Safety
Off unless the id is set. Fail-safe everywhere: a GoHighLevel problem is recorded on the lead and retried, never raised to the person creating the lead; the webhook guard falls through to the unchanged case logic when it is not configured or on any lookup error.

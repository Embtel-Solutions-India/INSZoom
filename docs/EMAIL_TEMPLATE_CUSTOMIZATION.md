# Email Template Customization

Admin page: **Email Templates** (sidebar, Super Admin / Admin; route `/email-templates`; API `settings:manage_email`).

## How it fits the existing system
Every automated email is a code template in `Backend/src/modules/email/templates/` sent by
`sendTemplateEmail(key, …)` from the call sites that already own the event. That key **is** the trigger.
A customization is an `EmailTemplate` row (`managed: true`, `triggerKey`). While **active** it replaces that
email's subject/heading/body and adds recipient rules; otherwise (none / draft / inactive / archived / any
error) the built-in email is sent exactly as before. No call site changed.

```
TRIGGER (existing sendTemplateEmail key)        emailTriggers.registry.js
  → active customization?                       emailCustomization.service.findActive (30s cache)
  → VARIABLES from call-site data + live case   emailVariables.registry.js + buildContext(caseId)
  → RECIPIENT rules from the live case          applyRecipientRules (roles resolved at send time)
  → RENDERER (shared with the preview)          emailRenderer.renderCustom → layoutHtml
  → DELIVERY (unchanged)                        email.service.dispatch → provider (now supports BCC)
```

## Files
Backend (new): `emailVariables.registry.js`, `emailTriggers.registry.js`, `emailRenderer.js`,
`emailCustomization.service.js`, tests in `email/tests/` and `settings/tests/`.
Backend (changed): `email.service.js` (wrapHtml now uses the shared layout – output byte-identical; override
hook with fallback; BCC), `providers/nodemailer.provider.js` (+bcc), `models/EmailTemplate.js` (additive
fields), `models/EmailLog.js` (+bcc), `settings/emailTemplates.routes.js` (new endpoints; legacy behaviour kept).
Admin: `pages/EmailTemplates.jsx`, `components/emailTemplates/*`, `services/api.js`, `utils/permissions.js`, `App.jsx`.

## API (`/api/email-templates`)
`GET /meta` · `GET /library` · `GET /defaults/:triggerKey` · `POST /preview` · `POST /test` ·
`POST /` (`managed:true`) · `PATCH /:id` · `POST /:id/activate|deactivate|duplicate` · `DELETE /:id` (archives).
Saves are audited to `SettingsAuditLog` (`key: email_template:<id>`, who/when/before/after) and versioned.

## Rules
* One active template per trigger (409 otherwise). Trigger can't change while active.
* Unknown `[variables]` and variables the trigger can't supply are rejected on save and highlighted live.
* Missing runtime values use per-variable fallbacks (e.g. "there", "your case manager"); rendering never throws.
* To-rules replace the call site's recipient only if they resolve to ≥1 address; CC/BCC are additive and de-duplicated.
* Test email goes only to the typed address, sample data, `[TEST]` subject.
* Locked (cannot be customized): `password-reset`, `staff-credentials`.
* The existing `EMAIL_SUPPRESS_STAFF_AND_ATTORNEY` dev gate still applies before any customization.

## Limitations
* Only emails the app already sends are available as triggers. "Document uploaded", "RFE response submitted",
  "Questionnaire completed" (client-facing) etc. have no sender yet; adding one = new template file + call site.
* Multi-recipient To is sent as one message with several To addresses (one EmailLog row).
* Customizations are cached 30 s per server instance.
* Leaving the page via the sidebar with unsaved edits is not intercepted (Back button and tab close are).
* The body editor is a lightweight contentEditable editor (HTML view available), not Tiptap, to preserve inline styles.

## Event triggers + browser push (added)
* `Backend/src/modules/email/eventTriggers.catalog.js` – one trigger per (event, audience): Client, Case Manager,
  Team Lead, Admin, Super Admin (critical/system only), Attorney. Only events the app can actually produce are listed
  (the team-lead review flow, attorney review requests, unassigned-case sweeps etc. are not, until they exist).
  Unused built-in emails (case-on-hold, document-rejected, payment-required, questionnaire-assigned, quiz-lead-confirmation,
  signature-required, staff-invitation) were removed. Where a moment has both a built-in email and an event trigger
  (attorney assigned, documents requested, new lead) the event trigger is `hidden` and its email is customized through the
  built-in (`emailKey`), so the library shows one entry per moment, grouped by audience.
* `notifications/triggerEvents.service.js` – `emit(event, { caseId, actor, data, covered, recipients, skipUserIds })`
  resolves each audience from the live case and sends in-app + socket + **browser push**; an email is added only when an
  admin has ACTIVATED a customized template for that trigger. It is a gap-filler: audiences in `covered` (already notified
  by existing code) get no second alert, nobody is notified twice per emit, the actor is skipped, and the same event on the
  same case within 60 s is reported once.
* `notificationRules.js` `PUSH_ON_TYPES` – existing alerts that hard-coded in-app/socket (case assigned, RFE, approved,
  denied, filed, questionnaire sent, …) now also push. Role-wide workflow broadcasts (`source: "workflow"`) never push.
* Hooked at: case created, CM/TL assigned, attorney granted/revoked, questionnaire assigned/submitted, documents requested,
  client document upload, RFE / USCIS decision / filed / closed (via NotificationLifecycleService), reopened, SLA breach,
  failed email delivery, account lockout, lead created/approved, attorney feedback.
* Known pre-existing issue (not changed): workflow `notify` actions use `createForRoles`, i.e. every user with the role,
  not just the people on the case.

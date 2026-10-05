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

import { test, expect } from '@playwright/test'
import { loginAs, apiLogin, apiRequest, taggedClientEmail, queryDatabase, pollDatabase } from './fixtures.js'

// Comprehensive audit v3.0 — Golden Paths M and N, certification gates
// G15 (questionnaire data reaches canonical data), G16 (canonical data autofills
// the form), G17 (form edits persist), G18 (reverse synchronization).
//
// The field pair used here is not arbitrary: the I-129 field
// `page1.form10Subform0Line3CompanyorOrgName0` was proven in Phase 0 to be the
// mapped destination of the employer's canonical `legalName`, verified in the
// canonical -> form direction against the live database. This spec drives the
// same pair through a real browser and then proves the REVERSE direction.

const COMPANY_FIELD = 'page1.form10Subform0Line3CompanyorOrgName0'

test.describe('Golden Paths M & N — two-way form synchronization', () => {
  test('questionnaire -> canonical -> autofilled form -> staff edit -> canonical (G15/G16/G17/G18)', async ({ page }) => {
    // Generous: async form provisioning alone was measured at ~29s, autofill
    // adds another pass, and the case-detail page fans out to ~16 concurrent
    // populate queries server-side before the PDF even starts rasterizing.
    test.setTimeout(900_000)

    const clientEmail = taggedClientEmail('formSync')
    const questionnaireName = `E2E Sync Employer ${Date.now()}`

    // --- Arrange, via API (cheap) -------------------------------------------
    const token = await apiLogin('admin')
    const created = await apiRequest(token, 'POST', '/cases', {
      clientName: 'E2E Form Sync Client',
      clientEmail,
      visaType: 'H-1B',
      childCaseCount: 1,
    })
    expect(created.status, 'case creation must succeed').toBe(201)
    const principalId = created.body.principalCase._id

    // G15 — the employer's questionnaire answer must reach canonical data.
    const submitted = await apiRequest(token, 'POST', `/employer-profile/${principalId}`, {
      fields: { legalName: questionnaireName },
      source: 'questionnaire',
    })
    expect(submitted.status).toBe(200)
    expect(submitted.body.updatedFields, 'G15: questionnaire answer must be applied to canonical data').toContain('legalName')
    expect(submitted.body.conflictedFields, 'G15: questionnaire answer must not be silently conflicted').not.toContain('legalName')

    // Wait for background form provisioning to finish.
    const provisioned = await pollDatabase(`async ({ Case, CaseForm }) => {
      const principal = await Case.findOne({ clientEmail: ${JSON.stringify(clientEmail)} }).lean();
      if (!principal) return { ready: false };
      const child = await Case.findOne({ parentCase: principal._id }).lean();
      if (!child) return { ready: false };
      const form = await CaseForm.findOne({ caseId: child._id, formCode: "I-129" }).lean();
      return {
        ready: Boolean(form),
        childId: String(child._id),
        childNumber: child.caseNumber,
        formId: form ? String(form._id) : null,
        autofilledValue: form?.fieldValues?.[${JSON.stringify(COMPANY_FIELD)}] ?? null,
      };
    }`, (s) => s.ready, { timeoutMs: 180_000 })

    expect(provisioned.ready, 'the I-129 CaseForm must be provisioned').toBe(true)

    // Re-run autofill so the canonical value written above reaches the form.
    await apiRequest(token, 'POST', `/cases/${provisioned.childId}/workflow/generate-forms`, {})

    const autofilled = await pollDatabase(`async ({ CaseForm }) => {
      const form = await CaseForm.findById(${JSON.stringify(provisioned.formId)}).lean();
      const raw = form?.fieldValues?.[${JSON.stringify(COMPANY_FIELD)}];
      const value = raw && typeof raw === "object" ? raw.value : raw;
      return { value: value ?? null };
    }`, (s) => s.value === questionnaireName, { timeoutMs: 90_000 })

    // G16 — canonical data reached the actual USCIS form field.
    expect(autofilled.value, 'G16: canonical legalName must autofill the I-129 company-name field').toBe(questionnaireName)

    // --- Act, through the real browser --------------------------------------
    // Diagnostics: DEF-006 was proven NOT a backend data-staleness issue (the
    // workspace API returns correct data even with near-zero delay after
    // autofill) — so if overlays still fail to render, capture console/page
    // errors and failed API calls to find the real, frontend-side cause.
    const consoleErrors = []
    const pageErrors = []
    const failedApiCalls = []
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('response', (response) => {
      if (response.url().includes('/api/') && response.status() >= 400) failedApiCalls.push(`${response.status()} ${response.url()}`)
    })

    await loginAs(page, 'admin')
    await page.goto(`/crm-cases/${provisioned.childId}?tab=forms`)

    const row = page.locator('tr').filter({ has: page.getByText('I-129', { exact: true }) })
    await expect(row).toBeVisible({ timeout: 90_000 })
    await row.getByRole('button', { name: 'Open Form' }).click()

    await expect(page.locator('canvas.react-pdf__Page__canvas').first()).toBeVisible({ timeout: 60_000 })

    // Interactive field overlays are what make the official PDF editable — a
    // rendered page canvas alone proves nothing (§13). Wait for them properly
    // before concluding anything, so "still rendering" is never misreported as
    // "never renders".
    const anyOverlay = page.locator('[id^="uscis-field-"]')
    try {
      await expect(anyOverlay.first()).toBeVisible({ timeout: 90_000 })
    } catch (waitError) {
      throw new Error(
        `no interactive field overlays rendered on the official PDF.\n` +
        `console errors (${consoleErrors.length}): ${consoleErrors.slice(0, 10).join(' | ')}\n` +
        `page errors (${pageErrors.length}): ${pageErrors.slice(0, 10).join(' | ')}\n` +
        `failed API calls (${failedApiCalls.length}): ${failedApiCalls.slice(0, 10).join(' | ')}\n` +
        `original: ${waitError.message}`
      )
    }

    const overlay = page.locator(`[id="uscis-field-${COMPANY_FIELD}"]`)
    if (!(await overlay.count())) {
      const rendered = await anyOverlay.evaluateAll((nodes) => nodes.slice(0, 15).map((n) => n.id))
      expect(rendered, `expected overlay ${COMPANY_FIELD} missing; ${rendered.length} overlays present, first: ${rendered.join(', ')}`).toContain(`uscis-field-${COMPANY_FIELD}`)
    }
    await overlay.scrollIntoViewIfNeeded({ timeout: 60_000 })
    await expect(overlay, 'G16: the autofilled value must be visible on the rendered form').toContainText(questionnaireName, { timeout: 30_000 })

    // The Case Manager edits the official form directly.
    const staffEditedName = `${questionnaireName} (staff edited)`
    await overlay.click()
    const input = overlay.locator('input, textarea').first()
    await expect(input).toBeVisible({ timeout: 15_000 })
    await input.fill(staffEditedName)

    const [saveResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/workspace/field') && r.request().method() === 'PATCH', { timeout: 30_000 }),
      input.press('Tab'),
    ])
    expect(saveResponse.status(), 'the staff field edit must be accepted by the server').toBe(200)

    // --- Assert persisted state ---------------------------------------------
    const afterEdit = await pollDatabase(`async ({ CaseForm, EmployerProfile, Case }) => {
      const form = await CaseForm.findById(${JSON.stringify(provisioned.formId)}).lean();
      const raw = form?.fieldValues?.[${JSON.stringify(COMPANY_FIELD)}];
      const formValue = raw && typeof raw === "object" ? raw.value : raw;
      const principal = await Case.findOne({ clientEmail: ${JSON.stringify(clientEmail)} }).lean();
      const employer = await EmployerProfile.findById(principal.employerProfileId).lean();
      return {
        formValue: formValue ?? null,
        canonicalValue: employer?.canonicalData?.legalName?.value ?? null,
        canonicalSource: employer?.canonicalData?.legalName?.source ?? null,
      };
    }`, (s) => s.formValue === staffEditedName, { timeoutMs: 60_000 })

    // G17 — the edit persisted to the CaseForm.
    expect(afterEdit.formValue, 'G17: the staff form edit must persist to CaseForm.fieldValues').toBe(staffEditedName)

    // G18 — and propagated back to canonical data as an authoritative staff edit.
    expect(afterEdit.canonicalValue, 'G18: the form edit must reverse-sync into canonical data').toBe(staffEditedName)
    expect(afterEdit.canonicalSource, 'G18: a staff form edit is recorded as form_edit provenance').toBe('form_edit')

    // G17 (persistence across reload) — reopen the form in a fresh page load.
    await page.reload({ waitUntil: 'networkidle' })
    const rowAgain = page.locator('tr').filter({ has: page.getByText('I-129', { exact: true }) })
    await expect(rowAgain).toBeVisible({ timeout: 90_000 })
    await rowAgain.getByRole('button', { name: 'Open Form' }).click()
    const overlayAgain = page.locator(`[id="uscis-field-${COMPANY_FIELD}"]`)
    await overlayAgain.scrollIntoViewIfNeeded()
    await expect(overlayAgain, 'G17: the edit must still be shown after a full reload').toContainText(staffEditedName, { timeout: 30_000 })
  })

  test('G19 — the review-copy download is a real, authentic USCIS PDF (not HTML)', async ({ page }) => {
    test.setTimeout(240_000)

    // NOTE on G19/G20 scope: as of the Forms Download overhaul, USCISFormRenderer.jsx has TWO
    // distinct download actions — "Download PDF" (formGenerationApi.generatePdf, intentionally
    // watermarked "FINAL"/"ATTORNEY REVIEW" via WatermarkService.apply — an internal review copy,
    // not a filing document) and "Download Official Form" (GET /forms/:caseFormId/download-form,
    // PDFRenderer's own explicitly watermark-free path). Unlike the old "Download filing copy"
    // button this replaced, the official download has NO status gate — it's reachable from any
    // status. This test proves G19 (authenticity) against the always-reachable review copy; a
    // follow-up spec should also drive "Download Official Form" for true G20 (watermark-free)
    // compliance, now that no field-completion/approval gate stands in the way.
    const target = queryDatabase(`async ({ Case, CaseForm }) => {
      const principals = await Case.find({ clientEmail: /@e2e-audit\\.invalid$/i }).select("_id").lean();
      const children = await Case.find({ parentCase: { $in: principals.map(p => p._id) } }).lean();
      const form = await CaseForm.findOne({ caseId: { $in: children.map(c => c._id) }, formCode: "I-129" }).lean();
      return { caseId: form ? String(form.caseId) : null };
    }`)
    test.skip(!target.caseId, 'no provisioned e2e I-129 available in this run')

    await loginAs(page, 'admin')
    await page.goto(`/crm-cases/${target.caseId}?tab=forms`)
    const row = page.locator('tr').filter({ has: page.getByText('I-129', { exact: true }) })
    await expect(row).toBeVisible({ timeout: 90_000 })
    await row.getByRole('button', { name: 'Open Form' }).click()
    await expect(page.locator('canvas.react-pdf__Page__canvas').first()).toBeVisible({ timeout: 60_000 })

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download PDF' }).click(),
    ])
    const fs = await import('node:fs/promises')
    const bytes = await fs.readFile(await download.path())

    // G19 — a real PDF, not an HTML render of the questionnaire.
    expect(bytes.subarray(0, 5).toString('latin1'), 'G19: download is not a real PDF').toBe('%PDF-')
    expect(bytes.length, 'G19: the official multi-page I-129 cannot be this small').toBeGreaterThan(50_000)
    expect(/USCIS|Department of Homeland Security|I-129/i.test(bytes.toString('latin1')), 'G19: downloaded PDF does not identify as the official USCIS form').toBe(true)
  })
})

import { test, expect } from '@playwright/test'
import { loginAs, taggedClientEmail, queryDatabase, pollDatabase } from './fixtures.js'

// PERM (labor certification) end to end, in a real browser against the real backend/DB:
//   Admin creates the case -> employer (client portal) fills the employer checklist -> chooses to enter the
//   employee information himself -> fills the employee checklist (repeatable employment history) and uploads
//   documents -> Admin sees exactly the same persisted answers/documents -> no USCIS form exists yet ->
//   Admin advances the PERM stage -> I-140 / I-485 / I-765 / I-131 appear one stage at a time, filled from the
//   canonical profile with the client's data.
// Every case this spec creates carries a tagged client email, so global teardown removes it (and its answers,
// documents, profiles, forms) even if the run fails part way.

const CLIENT_APP = process.env.E2E_CLIENT_URL || 'http://localhost:5175'
const LANDING_APP = process.env.E2E_LANDING_URL || 'http://localhost:5173'
const CLIENT_PASSWORD = 'E2ePerm!Passw0rd'

const state = {}

// The checklist row wrapper (a div) also carries id=<question key>, so address the real control by name.
const field = (page, key) => page.locator(`input[name="${key}"], textarea[name="${key}"], select[name="${key}"]`)
const row = (page, key) => page.locator(`div#${key}`)

const EMPLOYER = {
  employer_company_name: 'Acme Robotics Inc',
  employer_county: 'Travis County',
  employer_total_employees: '120',
  employer_state_id_number: '012345678',
  employer_ein: '12-3456789',
  employer_business_phone: '5125550100',
  employer_fax: '5125550101',
  employer_contact_person_name: 'Priya Contact',
  employer_contact_person_designation: 'HR Manager',
  employer_contact_person_phone: '5125550102',
  employer_contact_person_phone_extension: '44',
  employer_contact_person_email: 'priya.contact@acme-robotics.test',
  employer_website: 'https://www.acme-robotics.test',
  employer_additional_phone: '5125550103',
  employer_apprentice_registration_number: 'AR-7788',
  employer_company_profile: 'Acme Robotics designs warehouse automation systems and employs 120 people in Austin.',
}
const EMPLOYER_ADDRESS = { line1: '100 Congress Ave', line2: 'Suite 400', city: 'Austin', state: 'TX', postalCode: '78701', country: 'United States' }

const EMPLOYEE = {
  employee_first_name: 'Anita',
  employee_middle_name: 'Devi',
  employee_last_name: 'Rao',
  employee_address: '55 Elm Street Apt 9',
  employee_city: 'Plano',
  employee_zip_code: '75024',
  employee_phone: '9725550111',
  employee_date_of_birth: '1991-04-17',
  employee_alien_registration_number: 'A123456789',
  employee_i94_number: '12345678901',
  employee_major_field: 'Computer Science',
  employee_education_completion_year: '2013',
  employee_education_institution_name: 'University of Mumbai',
  employee_education_institution_address: '1 Fort Campus Road',
  employee_education_institution_city: 'Mumbai',
}
const EMPLOYEE_SELECTS = {
  employee_state: 'TX',
  employee_country: 'United States',
  employee_citizenship_country: 'India',
  employee_birth_country: 'India',
  employee_current_us_status: 'H-1B',
  employee_highest_education: "Bachelor's Degree",
  employee_education_institution_country: 'India',
}
const JOBS = [
  { company_name: 'Acme Robotics Inc', address: '100 Congress Ave', city: 'Austin', state: 'TX', country: 'United States', zip_code: '78701', supervisor_name: 'Sam Boss', supervisor_phone: '5125550104', business_type: 'Robotics', job_title: 'Software Engineer', start_date: '2021-03-01', is_current: true, hours_per_week: '40', job_details: 'Built warehouse control software.', skills_tools: 'Node.js, React, MongoDB' },
  { company_name: 'Globex Systems', address: '9 Tech Park', city: 'Dallas', state: 'TX', country: 'United States', zip_code: '75001', supervisor_name: 'Lee Manager', supervisor_phone: '2145550105', business_type: 'Software', job_title: 'Associate Engineer', start_date: '2018-06-01', end_date: '2021-02-28', hours_per_week: '40', job_details: 'Maintained internal tools.', skills_tools: 'Java, SQL' },
  { company_name: 'Initech', address: '77 Cyber Lane', city: 'Pune', state: '', country: 'India', zip_code: '411001', supervisor_name: 'R Kulkarni', supervisor_phone: '9100000000', business_type: 'IT services', job_title: 'Trainee Engineer', start_date: '2013-07-01', end_date: '2018-05-31', hours_per_week: '45', job_details: 'Support and testing.', skills_tools: 'C#, Testing' },
]

function setClientPasswordExpression(email) {
  return `async ({ User }) => {
    const user = await User.findOne({ email: ${JSON.stringify(email)} }).select('+password');
    user.password = ${JSON.stringify(CLIENT_PASSWORD)};
    user.isActive = true; user.isEmailVerified = true; user.mustSetPassword = false;
    await user.save();
    return { ok: true, role: user.role };
  }`
}

test.describe.configure({ mode: 'serial', timeout: 480_000 })

test.describe('PERM workflow, end to end', () => {
  test('1. Admin creates a PERM case; employer + employee structure and checklists are provisioned, no USCIS form', async ({ page }) => {
    state.clientEmail = taggedClientEmail('perm.employer')
    state.clientName = 'E2E PERM Employer'
    await loginAs(page, 'admin')
    await page.goto('/crm-cases')
    await page.getByRole('button', { name: 'New Case' }).click()
    await expect(page.getByRole('heading', { name: 'New Case', exact: true })).toBeVisible()
    await page.getByPlaceholder('Jane Doe').fill(state.clientName)
    await page.getByPlaceholder('jane@example.com').fill(state.clientEmail)
    await page.locator('select').first().selectOption({ label: 'PERM (Labor Certification)' })
    await expect(page.getByText('This PERM case is created with')).toBeVisible()
    await page.getByPlaceholder('Company or organization name').fill('Acme Robotics Inc')
    await page.getByRole('button', { name: 'Create Case' }).click()
    await expect(page.getByRole('heading', { name: 'Yay! New case created' })).toBeVisible({ timeout: 60_000 })

    const db = await pollDatabase(`async ({ Case, CaseForm }) => {
      const principal = await Case.findOne({ clientEmail: ${JSON.stringify(state.clientEmail)} }).lean();
      if (!principal) return { found: false };
      const children = await Case.find({ parentCase: principal._id }).lean();
      const ids = [principal._id, ...children.map((c) => c._id)];
      const forms = await CaseForm.find({ caseId: { $in: ids } }).lean();
      const Questionnaire = require('./src/models/Questionnaire');
      const refs = [principal, ...children].flatMap((c) => (c.questionnaireReferences || []).map((r) => ({ caseRole: c.caseRole, targetRole: r.targetRole, qid: String(r.questionnaireId), active: r.active !== false })));
      const qs = await Questionnaire.find({ _id: { $in: refs.map((r) => r.qid) } }).select('key').lean();
      const keyById = Object.fromEntries(qs.map((q) => [String(q._id), q.key]));
      return {
        found: true, id: String(principal._id), caseNumber: principal.caseNumber, caseStructure: principal.caseStructure,
        childCount: children.length, childIds: children.map((c) => String(c._id)), childRole: children[0]?.caseRole,
        user: String(principal.user), formCodes: forms.map((f) => f.formCode),
        refs: refs.map((r) => ({ caseRole: r.caseRole, targetRole: r.targetRole, key: keyById[r.qid], active: r.active })),
        permWorkflow: principal.permWorkflow || null,
      };
    }`, (s) => s.found && s.refs?.length >= 2, { timeoutMs: 90_000 })
    console.log('[evidence] stage 1', JSON.stringify(db))
    expect(db.found).toBe(true)
    expect(db.caseStructure).toBe('employer_employee')
    expect(db.childCount, 'PERM has exactly one employee').toBe(1)
    expect(db.childRole).toBe('employee')
    // employer + employee checklists only (no unrelated visa checklists)
    const keys = db.refs.map((r) => r.key).sort()
    expect([...new Set(keys)]).toEqual(['perm_employee_information', 'perm_employer_information'])
    // PERM is a DOL process: nothing USCIS exists on a new PERM case
    expect(db.formCodes, 'no USCIS form at PERM creation').toEqual([])
    Object.assign(state, { caseId: db.id, childId: db.childIds[0], caseNumber: db.caseNumber })

    // the employer is the client user; give it a known password so the real login flow can be driven
    queryDatabase(setClientPasswordExpression(state.clientEmail))
  })

  test('2. employer logs in to the client portal and completes the employer checklist; answers persist', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    state.clientPage = page
    // surface any server failure the portal swallows into a generic message
    page.on('response', async (response) => {
      if (response.status() >= 400 && response.url().includes('/api/')) console.log('[server-error]', response.status(), response.request().method(), response.url(), (await response.text().catch(() => '')).slice(0, 900))
    })
    await page.goto(`${CLIENT_APP}/login`)
    if (!(await page.locator('#login-case-id').isVisible().catch(() => false))) {
      await page.getByRole('button', { name: /case id/i }).first().click().catch(() => {})
    }
    await page.locator('#login-case-id').fill(state.caseNumber)
    await page.locator('input[name="password"]').fill(CLIENT_PASSWORD)
    await page.getByRole('button', { name: 'Sign In', exact: true }).click()
    await page.waitForURL(/\/dashboard/, { timeout: 45_000 })

    await page.goto(`${CLIENT_APP}/dashboard/documents`)
    await expect(field(page, 'employer_company_name')).toBeVisible({ timeout: 60_000 })

    for (const [key, value] of Object.entries(EMPLOYER)) {
      await field(page, key).fill(value)
    }
    for (const [part, value] of Object.entries(EMPLOYER_ADDRESS)) {
      await page.locator(`[name="employer_address.${part}"]`).fill(value)
    }
    await field(page, 'employer_union_status').selectOption('Nonunion Shop')
    await row(page, 'employer_is_federal_contractor').getByRole('button', { name: 'No', exact: true }).click()
    await row(page, 'employer_is_ada_compliant').getByRole('button', { name: 'Yes', exact: true }).click()

    // With every required employer item complete, the portal asks how the employee's part will be provided.
    const handoff = page.getByRole('dialog')
    await expect(handoff, 'employer is asked how to provide employee information').toBeVisible({ timeout: 30_000 })
    await expect(handoff.getByText('How would you like to provide employees information?')).toBeVisible()
    await expect(handoff.getByText('Invite each employee to fill their own information')).toBeVisible()
    await handoff.getByRole('button', { name: /I will fill it in myself/ }).click()
    await expect(handoff).toBeHidden({ timeout: 30_000 })
    await page.screenshot({ path: 'test-results/perm-after-employer-choice.png', fullPage: true })

    await page.getByRole('button', { name: 'Save progress' }).click()
    await expect(page.getByText(/Saved/i).first()).toBeVisible({ timeout: 45_000 })

    const db = await pollDatabase(`async () => {
      const Answer = require("./src/models/Answer");
      const answers = await Answer.find({ caseId: ${JSON.stringify(state.caseId)} }).lean();
      return { count: answers.length, byKey: Object.fromEntries(answers.map((a) => [a.questionKey, a.value])) };
    }`, (r) => r.count >= 18, { timeoutMs: 30_000, intervalMs: 2_000 })
    console.log('[evidence] stage 2 employer answers persisted:', db.count)
    expect(db.byKey.employer_company_name).toBe(EMPLOYER.employer_company_name)
    expect(db.byKey.employer_ein).toBe(EMPLOYER.employer_ein)
    expect(db.byKey.employer_state_id_number).toBe(EMPLOYER.employer_state_id_number)
    expect(db.byKey.employer_address).toMatchObject({ line1: EMPLOYER_ADDRESS.line1, city: 'Austin', state: 'TX' })
    expect(db.byKey.employer_is_federal_contractor).toBe('No')
    expect(db.byKey.employer_is_ada_compliant).toBe('Yes')
    expect(db.byKey.employer_union_status).toBe('Nonunion Shop')
  })

  test('3. employer fills in the employee checklist: documents upload (S3 path + metadata), information, employment history', async () => {
    const page = state.clientPage
    await page.getByRole('button', { name: 'Fill Information' }).first().click()
    await expect(page.getByText('Documents we need')).toBeVisible({ timeout: 30_000 })

    // Step 1 - the four required documents go through the existing client upload workflow.
    const NL = String.fromCharCode(10)
    const pdf = Buffer.from(['%PDF-1.4', '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj', '2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj', '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj', 'trailer<</Root 1 0 R>>', '%%EOF'].join(NL))
    for (const key of ['perm_resume', 'perm_degree_documents', 'perm_transcripts', 'perm_experience_letters']) {
      await row(page, key).locator('input[type="file"]').setInputFiles({ name: `${key}.pdf`, mimeType: 'application/pdf', buffer: pdf })
      await expect(row(page, key).getByText(new RegExp(`${key}\.pdf`))).toBeVisible({ timeout: 60_000 })
    }
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('button', { name: 'Employee Information' })).toBeVisible({ timeout: 30_000 })

    // Step 2a - Employee Information
    for (const [key, value] of Object.entries(EMPLOYEE)) await field(page, key).fill(value)
    for (const [key, value] of Object.entries(EMPLOYEE_SELECTS)) await field(page, key).selectOption(value)

    // Step 2b - Employee Qualification (the duration only appears after "Yes")
    await page.getByRole('button', { name: 'Employee Qualification' }).click()
    await row(page, 'employee_qualifying_experience_with_petitioner').getByRole('button', { name: 'Yes', exact: true }).click()
    await field(page, 'employee_qualifying_experience_years').fill('3')
    await field(page, 'employee_qualifying_experience_months').fill('5')
    await row(page, 'employee_employer_paid_education_training').getByRole('button', { name: 'No', exact: true }).click()
    await row(page, 'employee_currently_employed_by_petitioner').getByRole('button', { name: 'Yes', exact: true }).click()

    // Step 2c - Employment History: a repeatable group, no two-job limit (three jobs here), "+ Add Employment"
    await page.getByRole('button', { name: 'Employment History' }).click()
    for (let index = 0; index < JOBS.length; index += 1) {
      await page.getByRole('button', { name: '+ Add Employment' }).click()
      await expect(page.getByText(`Job ${index + 1}`).first()).toBeVisible()
      const job = JOBS[index]
      for (const [column, value] of Object.entries(job)) {
        const control = page.locator(`[name="employee_employment_history.${index}.${column}"]`)
        if (column === 'is_current') { if (value) await control.check(); continue }
        if (column === 'state' && !value) continue
        const tag = await control.evaluate((node) => node.tagName)
        if (tag === 'SELECT') await control.selectOption(value)
        else await control.fill(value)
      }
    }
    await page.screenshot({ path: 'test-results/perm-employee-history.png', fullPage: true })
    await page.getByRole('button', { name: 'Continue to Review' }).click()
    // Education was completed outside the U.S., so a degree evaluation is now required (a conditional document).
    // The review step must flag it and lead back to the upload.
    const reminder = page.getByRole('button', { name: /Degree evaluation/ })
    await expect(reminder, 'review flags the newly required degree evaluation').toBeVisible({ timeout: 30_000 })
    await reminder.click()
    await expect(row(page, 'perm_degree_evaluation')).toBeVisible({ timeout: 30_000 })
    await row(page, 'perm_degree_evaluation').locator('input[type="file"]').setInputFiles({ name: 'perm_degree_evaluation.pdf', mimeType: 'application/pdf', buffer: pdf })
    await expect(row(page, 'perm_degree_evaluation').getByText(/perm_degree_evaluation\.pdf/)).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Continue to Review' }).click()
    await page.waitForTimeout(3000)
    for (const section of ['Employee Information', 'Employee Qualification', 'Employment History', 'Documents']) {
      await expect(page.getByText(section, { exact: true }).last()).toBeVisible()
    }
    await expect(page.getByText("Everything's complete. Ready to submit.")).toBeVisible()
    await page.getByRole('button', { name: 'Save & Return' }).click()
    await expect(page.getByText('Employees (1)')).toBeVisible({ timeout: 45_000 })
  })

  test('4. everything the client entered is persisted once: answers, repeatable jobs, canonical profile, documents', async () => {
    const db = await pollDatabase(`async ({ Case }) => {
      const Answer = require('./src/models/Answer');
      const Document = require('./src/models/Document');
      const ids = [${JSON.stringify(state.caseId)}, ${JSON.stringify(state.childId)}];
      const answers = await Answer.find({ caseId: { $in: ids } }).lean();
      const byKey = {};
      const dupes = [];
      for (const a of answers) { if (byKey[a.questionKey] !== undefined) dupes.push(a.questionKey); byKey[a.questionKey] = a.value; }
      const docs = await Document.find({ caseId: { $in: ids } }).lean();
      const child = await Case.findById(${JSON.stringify(state.childId)}).lean();
      const principal = await Case.findById(${JSON.stringify(state.caseId)}).lean();
      return {
        count: answers.length, dupes, byKey,
        docs: docs.map((d) => ({ type: d.documentType, name: d.originalName || d.fileName || d.name, key: d.storageKey || d.s3Key || d.fileKey || d.key, url: Boolean(d.url || d.fileUrl) })),
        docFields: docs[0] ? Object.keys(docs[0]) : [],
        childCanonical: child.canonicalProfile?.profile || null,
        principalCanonical: principal.canonicalProfile?.profile || null,
      };
    }`, (r) => r.count >= 40 && r.docs.length >= 5, { timeoutMs: 60_000, intervalMs: 3_000 })
    console.log('[evidence] stage 4 answers:', db.count, 'documents:', db.docs.length, 'doc fields:', db.docFields?.join(','))
    expect(db.dupes, 'no duplicate answer records').toEqual([])
    const by = db.byKey
    for (const [key, value] of Object.entries(EMPLOYEE)) expect(by[key], key).toBe(value)
    for (const [key, value] of Object.entries(EMPLOYEE_SELECTS)) expect(by[key], key).toBe(value)
    expect(by.employee_qualifying_experience_with_petitioner).toBe('Yes')
    expect(Number(by.employee_qualifying_experience_years)).toBe(3)
    expect(by.employee_employer_paid_education_training).toBe('No')
    expect(by.employee_currently_employed_by_petitioner).toBe('Yes')
    // repeatable employment history: all three jobs, in order, as structured rows
    const jobs = by.employee_employment_history
    expect(Array.isArray(jobs) && jobs.length, 'three employment records').toBe(3)
    expect(jobs.map((job) => job.company_name)).toEqual(JOBS.map((job) => job.company_name))
    expect(jobs[0].is_current).toBe(true)
    expect(jobs[1].end_date).toBe('2021-02-28')
    expect(jobs[2].country).toBe('India')
    // documents: one record each, with a storage key (existing S3/local storage pipeline)
    expect(db.docs.map((doc) => doc.type).sort()).toEqual(['perm_degree_documents', 'perm_degree_evaluation', 'perm_experience_letters', 'perm_resume', 'perm_transcripts'])
    for (const doc of db.docs) expect(doc.key || doc.url, `storage reference for ${doc.type}`).toBeTruthy()
    state.docs = db.docs
  })

  test('5. Admin sees the same persisted data: employer checklist, employee checklist, uploaded documents', async ({ page }) => {
    await loginAs(page, 'admin')
    // employer side, on the principal (employer) case
    await page.goto(`/crm-cases/${state.caseId}`)
    await page.getByRole('button', { name: /^Documents/ }).first().click()
    await expect(page.getByText(EMPLOYER.employer_ein).first()).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText(EMPLOYER.employer_company_name).first()).toBeVisible()
    await expect(page.getByText(EMPLOYER.employer_contact_person_email).first()).toBeVisible()
    await expect(page.getByText('Nonunion Shop').first()).toBeVisible()
    await page.screenshot({ path: 'test-results/perm-admin-employer.png', fullPage: true })

    // employee side + documents, on the employee case
    await page.goto(`/crm-cases/${state.childId}`)
    await page.getByRole('button', { name: /^Documents/ }).first().click()
    await expect(page.getByText(EMPLOYEE.employee_first_name).first()).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText(EMPLOYEE.employee_last_name).first()).toBeVisible()
    await expect(page.getByText(EMPLOYEE.employee_alien_registration_number).first()).toBeVisible()
    await expect(page.getByText(EMPLOYEE.employee_i94_number).first()).toBeVisible()
    await expect(page.getByText('Software Engineer').first(), 'repeatable employment history is visible to Admin').toBeVisible()
    await expect(page.getByText('Trainee Engineer').first()).toBeVisible()
    await page.screenshot({ path: 'test-results/perm-admin-employee.png', fullPage: true })
    for (const name of ['perm_resume.pdf', 'perm_degree_documents.pdf', 'perm_transcripts.pdf', 'perm_experience_letters.pdf']) {
      await expect(page.getByText(name).first(), `Admin sees uploaded ${name}`).toBeVisible()
    }
  })

  test('6. no USCIS form until the PERM stage is advanced; each stage brings its form, filled from the client data', async ({ page }) => {
    const formsExpression = `async ({ Case, CaseForm }) => {
      const ids = [${JSON.stringify(state.caseId)}, ${JSON.stringify(state.childId)}];
      const forms = await CaseForm.find({ caseId: { $in: ids }, status: { $ne: 'archived' } }).lean();
      return forms.map((f) => ({ code: f.formCode, caseId: String(f.caseId), values: JSON.stringify({ a: f.fieldValues, b: f.filledData }) }));
    }`
    const formsNow = (isReady, timeoutMs = 120_000) => pollDatabase(formsExpression, isReady, { timeoutMs, intervalMs: 4_000 })
    const codes = (result) => (Array.isArray(result) ? result : []).map((f) => f.code).sort()

    await loginAs(page, 'admin')
    await page.goto(`/crm-cases/${state.childId}`)
    await page.getByRole('button', { name: /^Documents/ }).first().click()
    await expect(page.getByTestId('perm-stage-card')).toBeVisible({ timeout: 60_000 })
    expect(codes(queryDatabase(formsExpression)), 'no USCIS form before certification').toEqual([])

    const advance = async (testId, expectCodes) => {
      await page.getByTestId(testId).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Yes', exact: true }).click()
      await expect(page.getByRole('dialog')).toBeHidden({ timeout: 90_000 })
      const result = await formsNow((rows) => JSON.stringify(codes(rows)) === JSON.stringify(expectCodes))
      expect(codes(result), `forms after ${testId}`).toEqual(expectCodes)
      return result
    }

    await page.getByTestId('perm-mark-certified').click()
    await page.getByTestId('perm-cert-number').fill('A-26001-12345')
    await page.getByRole('dialog').getByRole('button', { name: 'Yes', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 90_000 })
    const afterCert = await formsNow((rows) => codes(rows).length > 0)
    expect(codes(afterCert), 'PERM certified -> I-140 only').toEqual(['I-140'])
    const i140 = afterCert.find((f) => f.code === 'I-140').values
    for (const expected of ['Rao', 'Anita', 'Acme Robotics Inc', '123456789']) expect(i140, `I-140 carries "${expected}" from the client data`).toContain(expected)
    state.i140 = i140

    const afterAos = await advance('perm-start-aos', ['I-140', 'I-485'])
    const i485 = afterAos.find((f) => f.code === 'I-485').values
    for (const expected of ['Rao', 'Anita']) expect(i485, `I-485 carries "${expected}"`).toContain(expected)

    const afterEad = await advance('perm-add-ead', ['I-140', 'I-485', 'I-765'])
    expect(afterEad.find((f) => f.code === 'I-765').values).toContain('Rao')
    const afterAp = await advance('perm-add-ap', ['I-131', 'I-140', 'I-485', 'I-765'])
    expect(afterAp.find((f) => f.code === 'I-131').values).toContain('Rao')
  })
})

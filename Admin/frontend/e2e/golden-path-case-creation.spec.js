import { test, expect } from '@playwright/test'
import { loginAs, taggedClientEmail, queryDatabase, pollDatabase } from './fixtures.js'

// Comprehensive audit v3.0 — Golden Paths C, D, E and certification gates
// G4 (direct create must NOT require a consultation), G5 (Case ID generated),
// G6 (CaseForms provisioned immediately, with no questionnaire), G7 (Team Lead
// receives the new case), G24 (no duplicate case on double submit).
//
// Every assertion that matters is checked against PERSISTED database state, not
// only against what the UI happens to render — a rendered case number does not
// prove a saved case.

async function createCaseThroughUI(page, { clientName, clientEmail, visaType }) {
  await page.goto('/crm-cases')
  await page.getByRole('button', { name: 'New Case' }).click()
  await expect(page.getByRole('heading', { name: 'New Case', exact: true })).toBeVisible()

  await page.getByPlaceholder('Jane Doe').fill(clientName)
  await page.getByPlaceholder('jane@example.com').fill(clientEmail)
  await page.locator('select').first().selectOption({ label: visaType })

  await page.getByRole('button', { name: 'Create Case' }).click()
  return page
}

test.describe('Golden Path C — direct admin case creation', () => {
  test('admin creates an H-1B case with no lead/consultation, and it is fully provisioned', async ({ page }) => {
    const clientEmail = taggedClientEmail('pathC.admin')
    const clientName = 'E2E Path C Client'

    await loginAs(page, 'admin')
    await createCaseThroughUI(page, { clientName, clientEmail, visaType: 'H-1B' })

    // G5 — a Case ID is generated and surfaced to the operator.
    const successModal = page.getByRole('heading', { name: 'Yay! New case created' })
    await expect(successModal).toBeVisible({ timeout: 60_000 })

    // Persisted state is the real evidence.
    const state = await pollDatabase(`async ({ Case, CaseForm, EmployerProfile }) => {
      const principal = await Case.findOne({ clientEmail: ${JSON.stringify(clientEmail)} }).lean();
      if (!principal) return { found: false };
      const children = await Case.find({ parentCase: principal._id }).lean();
      const forms = await CaseForm.find({ caseId: { $in: [principal._id, ...children.map(c => c._id)] } }).lean();
      const employerProfile = principal.employerProfileId
        ? await EmployerProfile.findById(principal.employerProfileId).lean()
        : null;
      return {
        found: true,
        caseNumber: principal.caseNumber,
        caseStructure: principal.caseStructure,
        caseRole: principal.caseRole,
        status: principal.status,
        creationSource: principal.creationSource,
        leadId: principal.leadId || null,
        childCount: children.length,
        childNumbers: children.map(c => c.caseNumber),
        formCodes: forms.map(f => f.formCode),
        formsOnChildren: forms.filter(f => children.some(c => String(c._id) === String(f.caseId))).length,
        employerLegalNameSource: employerProfile?.canonicalData?.legalName?.source || null,
      };
    }`, (s) => s.found && s.formsOnChildren > 0)

    console.log(`[evidence] form provisioning completed ${state.__waitedMs}ms after the create response`)
    expect(state.found, 'the case must actually be persisted').toBe(true)
    // G5 — Case ID exists and follows the project's B### scheme.
    expect(state.caseNumber, 'G5: Case ID must be generated').toMatch(/^B\d+/)
    expect(state.caseStructure).toBe('employer_employee')
    expect(state.caseRole).toBe('principal')
    // G4 — the direct path must not have required (or invented) a lead.
    expect(state.leadId, 'G4: direct case creation must not depend on a lead').toBeNull()
    expect(state.creationSource).toBe('admin_direct')
    // Child case structure.
    expect(state.childCount, 'H-1B creates at least one employee child case').toBeGreaterThan(0)
    expect(state.childNumbers[0], 'child case IDs derive from the principal').toMatch(/^B\d+-[A-Z]$/)
    // G7 — case lands in the Team Lead queue as pending assignment.
    expect(state.status, 'G7: new unassigned case must be pending assignment').toBe('pending_assignment')
    // G6 — forms exist immediately, before any questionnaire was ever answered.
    expect(state.formsOnChildren, 'G6: CaseForms must be provisioned on the child case immediately').toBeGreaterThan(0)
    expect(state.formCodes, 'G6: the H-1B petition form must be provisioned').toContain('I-129')
    // Phase 0 regression guard: an employer legal name that was never supplied
    // must not be pre-stamped as a staff-authoritative edit (the null-placeholder
    // defect fixed in case.controller.js).
    expect(state.employerLegalNameSource, 'employer legalName must not be pre-stamped case_manager_edit').not.toBe('case_manager_edit')
  })

  test('G24 — double-submitting Create Case does not create two cases', async ({ page }) => {
    const clientEmail = taggedClientEmail('pathC.dupe')
    await loginAs(page, 'admin')

    await page.goto('/crm-cases')
    await page.getByRole('button', { name: 'New Case' }).click()
    await page.getByPlaceholder('Jane Doe').fill('E2E Duplicate Guard')
    await page.getByPlaceholder('jane@example.com').fill(clientEmail)
    await page.locator('select').first().selectOption({ label: 'H-1B' })

    const submit = page.getByRole('button', { name: /Create Case|Creating/ })
    // Two clicks as fast as the UI allows — the real double-click a user makes.
    await submit.click()
    await submit.click({ force: true, timeout: 2_000 }).catch(() => {})

    await page.waitForTimeout(15_000)

    const count = queryDatabase(`async ({ Case }) => {
      const principals = await Case.find({ clientEmail: ${JSON.stringify(clientEmail)} }).lean();
      return { principals: principals.length, numbers: principals.map(c => c.caseNumber) };
    }`)
    expect(count.principals, `G24: double submit created ${count.principals} cases (${count.numbers.join(', ')})`).toBe(1)
  })
})

test.describe('Golden Path D — direct team lead case creation', () => {
  test('team lead can create a case directly, without a consultation or lead', async ({ page }) => {
    const clientEmail = taggedClientEmail('pathD.teamlead')
    await loginAs(page, 'teamLead')
    await createCaseThroughUI(page, { clientName: 'E2E Path D Client', clientEmail, visaType: 'H-1B' })

    await expect(page.getByRole('heading', { name: 'Yay! New case created' })).toBeVisible({ timeout: 60_000 })

    const state = await pollDatabase(`async ({ Case, CaseForm }) => {
      const principal = await Case.findOne({ clientEmail: ${JSON.stringify(clientEmail)} }).lean();
      if (!principal) return { found: false };
      const children = await Case.find({ parentCase: principal._id }).lean();
      const forms = await CaseForm.find({ caseId: { $in: children.map(c => c._id) } }).lean();
      return {
        found: true,
        caseNumber: principal.caseNumber,
        creationSource: principal.creationSource,
        leadId: principal.leadId || null,
        childCount: children.length,
        formCount: forms.length,
      };
    }`, (s) => s.found && s.formCount > 0)

    expect(state.found).toBe(true)
    expect(state.caseNumber).toMatch(/^B\d+/)
    expect(state.leadId, 'G4: no lead/consultation dependency on the direct path').toBeNull()
    expect(state.formCount, 'G6: forms provisioned immediately on the team-lead path too').toBeGreaterThan(0)
    // Provenance. The backend's resolveCreationSource() derives team_lead_direct
    // from the caller's role, but CreateCaseModal.jsx always sends the literal
    // creationSource: 'admin_direct' (its default prop), overriding it — so
    // every team-lead-created case is recorded as admin-created. See the audit
    // error register (DEF-002).
    expect(state.creationSource, 'a team lead creating directly must be recorded as team_lead_direct').toBe('team_lead_direct')
  })

  test('both creation paths produce equivalent downstream state (§3.1 convergence)', async ({ page }) => {
    // Path A (lead conversion) cannot be driven here — the lead-approval
    // endpoints do not exist in this codebase (documented in
    // FUNCTIONAL_AUDIT_WORKFLOW_REPORT.md). What IS testable is that the two
    // direct paths (admin vs team lead) differ only in creationSource.
    const state = queryDatabase(`async ({ Case }) => {
      const cases = await Case.find({ clientEmail: /@e2e-audit\\.invalid$/i, caseRole: "principal" }).lean();
      const bySource = {};
      for (const c of cases) {
        bySource[c.creationSource] = bySource[c.creationSource] || [];
        bySource[c.creationSource].push({
          caseStructure: c.caseStructure,
          caseRole: c.caseRole,
          status: c.status,
          hasEmployerProfile: Boolean(c.employerProfileId),
          childCaseCount: c.childCaseCount,
        });
      }
      return bySource;
    }`)

    const adminCases = state.admin_direct || []
    const teamLeadCases = state.team_lead_direct || []
    test.skip(!adminCases.length || !teamLeadCases.length, 'needs one case from each path in the same run')

    const shape = (c) => JSON.stringify({ ...c })
    expect(shape(teamLeadCases[0]), '§3.1: both creation paths must converge on identical downstream state')
      .toBe(shape(adminCases[0]))
  })
})

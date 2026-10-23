import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

afterEach(() => { cleanup() })

// The Phase 5 operations screens (read-only apart from Retry): role gate, plain wording, each status on its own, the review queue, frozen cases (priority first) and the AI view
// (a missing gate is shown as closed). API faked.
const api = vi.hoisted(() => ({ overview: vi.fn(), formStatus: vi.fn(), mappingReview: vi.fn(), frozenCases: vi.fn(), retry: vi.fn(), aiStatus: vi.fn(), aiSuggestions: vi.fn() }))
vi.mock('../services/api', () => ({
  governanceOpsApi: { overview: (...a) => api.overview(...a), formStatus: (...a) => api.formStatus(...a), mappingReview: (...a) => api.mappingReview(...a), frozenCases: (...a) => api.frozenCases(...a) },
  formPipelineApi: { retry: (...a) => api.retry(...a) },
  aiMappingApi: { status: (...a) => api.aiStatus(...a), suggestions: (...a) => api.aiSuggestions(...a) },
}))

let mockUser = { role: 'admin' }
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }))

import FormGovernanceHub from './FormGovernanceHub'
import FormGovernanceOverviewSection from './FormGovernanceOverviewSection'
import FormStatusPanel from './FormStatusPanel'
import MappingReviewQueueSection from './MappingReviewQueueSection'
import FrozenCasesSection from './FrozenCasesSection'
import AiMappingSection from './AiMappingSection'
import { plainPath, formatAge, formatDuration, unwrap } from './governanceShared'

const forms = [{ formCode: 'I-131' }, { formCode: 'I-765' }]
const wrap = (node) => <MemoryRouter>{node}</MemoryRouter>
const ok = (data) => ({ data: { success: true, data } })

const overview = () => ({
  generatedAt: '2026-10-22T10:00:00Z',
  pipeline: {
    mode: 'worker', worker: { alive: true }, counts: { running: 1, blocked: 1, held: 1 },
    oldestUnresolved: { formCode: 'I-129', state: 'blocked', ageMs: 2 * 3600 * 1000 },
    retries: { total: 7, last24h: 2 },
    stageTimings: [{ stage: 'import', count: 4, avgMs: 1500, p95Ms: 4000 }],
  },
  metrics: { promotions24h: 3, failures24h: 1, heldNow: 1, deadLetterNow: 0, frozenCasesOpen: 2 },
  blocked: [{ jobId: 'j1', formCode: 'I-129', state: 'blocked', currentStage: 'import', attempts: 3, ageMs: 7200000, lastError: { message: 'PDF not fillable' } }],
  held: [{ jobId: 'j2', formCode: 'I-90', state: 'held', currentStage: 'release', attempts: 1, ageMs: 600000 }],
  runs: [{ kind: 'catalog_sync', startedAt: '2026-10-22T09:00:00Z', durationMs: 2500, checked: 10, changed: 1, promoted: 1, held: 0, failed: 0 }],
})
const formStatus = () => ({
  formCode: 'I-131', editions: [{ version: '2025-01-20', status: 'active' }],
  statuses: {
    import: { state: 'ok', detail: 'Imported' }, mapping: { state: 'ok' }, coverage: { state: 'warning', detail: '12 boxes not matched' },
    certification: { state: 'blocked', checks: [{ name: 'party_markers', passed: false, detail: 'petitioner data in a beneficiary box' }, { name: 'viewer_download', passed: false, detail: 'slow' }, { name: 'pdf_fillable', passed: true }] },
    release: { state: 'warning', decision: 'restricted_degraded', checks: [{ name: 'certification', outcome: 'degraded', detail: 'viewer_download failed' }] },
    editionPolicy: { state: 'warning', detail: 'No USCIS statement on record' }, monitoring: { state: 'ok' },
  },
  timeline: [{ stage: 'import', status: 'done', attempts: 2 }, { stage: 'certify', status: 'failed', error: { message: 'boom' } }],
  lostEdges: [{ targetFieldId: 'Part1.StreetNumber', sourcePath: 'petitioner.address.street', reason: 'box_removed' }],
  degraded: { reason: 'Viewer slow on staging', failedChecks: ['viewer_download'], at: '2026-10-21T09:00:00Z' },
  hold: { reasons: ['no_uscis_statement'] },
})

beforeEach(() => {
  mockUser = { role: 'admin' }
  api.overview.mockReset().mockResolvedValue(ok(overview()))
  api.formStatus.mockReset().mockResolvedValue(ok(formStatus()))
  api.mappingReview.mockReset().mockResolvedValue(ok({ total: 2, items: [
    { templateId: 't1', targetFieldId: 'A', formCode: 'I-131', label: 'Street name', sourcePath: 'beneficiary.address.street', origin: 'ai', status: 'needs_review', reasons: ['address_block'] },
    { templateId: 't1', targetFieldId: 'B', formCode: 'I-131', label: 'City', sourcePath: 'beneficiary.address.city', origin: 'legacy', status: 'rejected', reasons: [] },
  ] }))
  api.frozenCases.mockReset().mockResolvedValue(ok({ items: [
    { caseFormId: 'a', caseNumber: 'IM-1', formCode: 'I-131', status: 'in_review', fromEdition: '2024-01-01', toEdition: '2025-01-20', priority: false },
    { caseFormId: 'b', caseNumber: 'IM-2', formCode: 'I-765', status: 'filed', fromEdition: '2023-01-01', toEdition: '2025-01-20', priority: true },
  ] }))
  api.retry.mockReset().mockResolvedValue({ data: { success: true } })
  api.aiStatus.mockReset().mockResolvedValue(ok({ mode: 'on', forms: { 'I-90': { auto_use: 5, needs_review: 2, rejected: 1, applied: 0 } }, gate: null }))
  api.aiSuggestions.mockReset().mockResolvedValue(ok([{ formCode: 'I-90', targetFieldId: 'Pt1.FamilyName', candidate: { path: 'beneficiary.name.last' }, tier: 'auto_use', reasons: [] }]))
})

describe('shared helpers', () => {
  it('turns paths, ages and durations into plain words', () => {
    expect(plainPath('petitioner.address.streetName')).toBe('petitioner address street name')
    expect(plainPath('raw.questionnaireAnswers.job_title.value')).toBe('job title')
    expect(plainPath('beneficiary.children.0.name')).toBe('beneficiary children name')
    expect(formatAge(30000)).toBe('less than a minute')
    expect(formatAge(2 * 3600000)).toBe('2 hours')
    expect(formatDuration(1500)).toBe('1.5 s')
    expect(unwrap({ data: { success: true, data: [1] } })).toEqual([1])
    expect(unwrap({ data: [1] })).toEqual([1])
  })
})

describe('FormGovernanceHub', () => {
  it('shows nothing, and calls nothing, to roles outside super_admin / admin / team_lead', () => {
    for (const role of ['case_manager', 'attorney', 'client', undefined]) {
      mockUser = role ? { role } : null
      const { container, unmount } = render(wrap(<FormGovernanceHub forms={forms} />))
      expect(container.textContent).toBe('')
      unmount()
    }
    expect(api.overview).not.toHaveBeenCalled()
  })

  it('opens on the overview and switches between the five views', async () => {
    render(wrap(<FormGovernanceHub forms={forms} />))
    await screen.findByText('Operations overview')
    fireEvent.click(screen.getByRole('tab', { name: 'Mapping review' }))
    await screen.findByTestId('mapping-review-queue')
    fireEvent.click(screen.getByRole('tab', { name: 'Older editions in cases' }))
    await screen.findByTestId('frozen-cases')
    fireEvent.click(screen.getByRole('tab', { name: 'AI mapping' }))
    await screen.findByTestId('ai-mapping')
    fireEvent.click(screen.getByRole('tab', { name: 'Form status' }))
    expect(screen.getByTestId('form-status-panel')).toBeTruthy()
  })
})

describe('FormGovernanceOverviewSection', () => {
  it('describes the pipeline in plain words and lists stuck jobs', async () => {
    render(wrap(<FormGovernanceOverviewSection />))
    await screen.findByTestId('overview-pipeline')
    expect(screen.getByText('The background worker is running.')).toBeTruthy()
    expect(screen.getByTestId('overview-oldest').textContent).toContain('I-129')
    expect(screen.getByTestId('overview-oldest').textContent).toContain('2 hours')
    expect(screen.getByTestId('overview-retries').textContent).toContain('7 in total, 2 in the last 24 hours')
    expect(within(screen.getByTestId('stuck-Needs attention')).getByText('PDF not fillable')).toBeTruthy()
    expect(within(screen.getByTestId('stuck-Waiting for a decision')).getByText('I-90')).toBeTruthy()
    expect(screen.getByTestId('overview-timings').textContent).toContain('4.0 s')
    expect(screen.getByTestId('overview-runs').textContent).toContain('Check of every USCIS form')
  })

  it('retries a stuck job only after the admin confirms', async () => {
    render(wrap(<FormGovernanceOverviewSection />))
    const list = await screen.findByTestId('stuck-Needs attention')
    fireEvent.click(within(list).getByRole('button', { name: 'Retry' }))
    expect(api.retry).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, retry' }))
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith('j1'))
    await screen.findByText('I-129 was put back in the queue.')
  })

  it('hides Retry from team leads, who can only read', async () => {
    mockUser = { role: 'team_lead' }
    render(wrap(<FormGovernanceOverviewSection />))
    await screen.findByTestId('overview-pipeline')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('shows a plain error when the overview cannot load', async () => {
    api.overview.mockReset().mockRejectedValue({ response: { data: { message: 'Not allowed' } } })
    render(wrap(<FormGovernanceOverviewSection />))
    expect((await screen.findByRole('alert')).textContent).toBe('Not allowed')
  })
})

describe('FormStatusPanel', () => {
  it('shows the separate statuses, checks, steps, lost boxes and the override and hold notes', async () => {
    render(wrap(<FormStatusPanel forms={forms} />))
    fireEvent.click(screen.getByRole('button', { name: 'I-131' }))
    await screen.findByTestId('status-import')
    for (const id of ['import', 'mapping', 'coverage', 'certification', 'release', 'editionPolicy', 'monitoring']) expect(screen.getByTestId(`status-${id}`)).toBeTruthy()
    expect(api.formStatus).toHaveBeenCalledWith('I-131')
    const checks = screen.getByTestId('cert-checks').textContent
    expect(checks).toContain("Each person's data lands only in that person's boxes")
    expect(checks).toContain('must pass')
    expect(checks).toContain('an admin can override this with a written reason')
    expect(screen.getByTestId('release-checks').textContent).toContain('Can go live with a written override')
    expect(screen.getByTestId('timeline').textContent).toContain('boom')
    expect(screen.getByTestId('lost-edges').textContent).toContain('petitioner address street')
    expect(screen.getByTestId('degraded-note').textContent).toContain('Viewer slow on staging')
    expect(screen.getByTestId('hold-note').textContent).toContain('no uscis statement')
  })

  it('says so when nothing is certified and a form has no problems', async () => {
    api.formStatus.mockReset().mockResolvedValue(ok({ formCode: 'I-765', statuses: {}, timeline: [], lostEdges: [] }))
    render(wrap(<FormStatusPanel forms={forms} />))
    fireEvent.click(screen.getByRole('button', { name: 'I-765' }))
    await screen.findByText('No certification on record yet.')
    expect(screen.queryByTestId('degraded-note')).toBeNull()
    expect(screen.queryByTestId('hold-note')).toBeNull()
    expect(screen.getByTestId('lost-edges').textContent).toContain('None')
  })

  it('filters the form picker by search', () => {
    render(wrap(<FormStatusPanel forms={forms} />))
    fireEvent.change(screen.getByLabelText('Search forms'), { target: { value: '765' } })
    expect(screen.queryByRole('button', { name: 'I-131' })).toBeNull()
    expect(screen.getByRole('button', { name: 'I-765' })).toBeTruthy()
  })
})

describe('MappingReviewQueueSection', () => {
  it('lists boxes read-only, filters them, and links to the mapping editor', async () => {
    render(wrap(<MappingReviewQueueSection />))
    await screen.findByText('Street name')
    expect(screen.getByTestId('queue-count').textContent).toBe('2 of 2')
    expect(screen.getAllByRole('link', { name: 'Open in mapping editor' })[0].getAttribute('href')).toBe('/form-governance/I-131')
    expect(within(screen.getByRole('table')).getByText('AI suggestion')).toBeTruthy()
    expect(screen.getByText('address block')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'rejected' } })
    expect(screen.queryByText('Street name')).toBeNull()
    expect(screen.getByTestId('queue-count').textContent).toBe('1 of 2')
    expect(screen.queryByRole('button', { name: /save|confirm|approve/i })).toBeNull()
  })

  it('asks the server for one form when a form is typed', async () => {
    render(wrap(<MappingReviewQueueSection />))
    await screen.findByText('Street name')
    fireEvent.change(screen.getByLabelText('Form'), { target: { value: 'i-131' } })
    await waitFor(() => expect(api.mappingReview).toHaveBeenLastCalledWith({ formCode: 'I-131' }))
  })

  it('says when nothing is waiting', async () => {
    api.mappingReview.mockReset().mockResolvedValue(ok({ total: 0, items: [] }))
    render(wrap(<MappingReviewQueueSection />))
    await screen.findByText('Nothing is waiting for review.')
  })
})

describe('FrozenCasesSection', () => {
  it('puts the cases that need checking first', async () => {
    render(wrap(<FrozenCasesSection />))
    const list = await screen.findByTestId('frozen-list')
    const rows = within(list).getAllByRole('listitem')
    expect(rows[0].textContent).toContain('IM-2')
    expect(rows[0].textContent).toContain('Check first')
    expect(rows[1].textContent).toContain('IM-1')
    expect(rows[1].textContent).not.toContain('Check first')
    expect(rows[0].textContent).toContain('On edition 2023-01-01; the live edition is 2025-01-20')
  })

  it('shows an empty message and an error message', async () => {
    api.frozenCases.mockReset().mockResolvedValue(ok({ items: [] }))
    const first = render(wrap(<FrozenCasesSection />))
    await screen.findByText('No case forms are waiting on an older edition.')
    first.unmount()
    api.frozenCases.mockReset().mockRejectedValue(new Error('x'))
    render(wrap(<FrozenCasesSection />))
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load')
  })
})

describe('AiMappingSection', () => {
  it('treats a missing gate as closed and says nothing is applied while it is closed', async () => {
    render(wrap(<AiMappingSection forms={forms} />))
    await screen.findByTestId('ai-gate')
    expect(screen.getByTestId('ai-gate').textContent).toContain('Closed')
    expect(screen.getByTestId('ai-gate').textContent).toContain('Not reported yet')
    expect(screen.getByTestId('ai-gate').textContent).toContain('nothing is applied to any form until the gate opens')
    expect(screen.getByTestId('ai-mode').textContent).toContain('On')
    expect(screen.getByTestId('ai-counts').textContent).toContain('I-90')
    expect(screen.getByTestId('ai-suggestions').textContent).toContain('beneficiary name last')
  })

  it('shows an open gate and passes the filters to the suggestions call', async () => {
    api.aiStatus.mockReset().mockResolvedValue(ok({ mode: 'shadow', forms: {}, gate: { open: true } }))
    render(wrap(<AiMappingSection forms={forms} />))
    await screen.findByTestId('ai-gate')
    expect(screen.getByTestId('ai-gate').textContent).toContain('Open')
    expect(screen.getByTestId('ai-mode').textContent).toContain('Suggesting only')
    fireEvent.change(screen.getByLabelText('Suggestion result'), { target: { value: 'rejected' } })
    await waitFor(() => expect(api.aiSuggestions).toHaveBeenLastCalledWith({ formCode: undefined, tier: 'rejected', limit: 100 }))
  })
})

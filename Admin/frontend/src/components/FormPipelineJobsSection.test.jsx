import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

afterEach(() => { cleanup() })

// The pipeline jobs screen: role gates (read: super_admin/admin/team_lead, retry: super_admin/admin), plain-language states and stages, stuck-job reasons, retry. API faked.
const api = vi.hoisted(() => ({ status: vi.fn(), jobs: vi.fn(), job: vi.fn(), retry: vi.fn() }))
vi.mock('../services/api', () => ({ formPipelineApi: { status: (...a) => api.status(...a), jobs: (...a) => api.jobs(...a), job: (...a) => api.job(...a), retry: (...a) => api.retry(...a) } }))

let mockUser = { role: 'admin' }
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }))

import FormPipelineJobsSection, { READ_ROLES, RETRY_ROLES, stageLabel } from './FormPipelineJobsSection'

const job = (over = {}) => ({ _id: 'j1', formCode: 'I-765', state: 'running', currentStage: 'import', trigger: 'admin_fetch', attempts: 1, maxAttempts: 5, updatedAt: '2026-10-16T10:00:00Z', stages: {}, ...over })
const jobs = () => [job(), job({ _id: 'j2', formCode: 'I-131', state: 'dead_letter', currentStage: 'certify', lastError: { class: 'fatal', code: 'X', stage: 'certify', message: 'The test fill did not match.' } }), job({ _id: 'j3', formCode: 'N-600', state: 'done', currentStage: 'finalize' })]

beforeEach(() => {
  mockUser = { role: 'admin' }
  api.status.mockReset().mockResolvedValue({ data: { data: { mode: 'queued', worker: 'embedded', workerAlive: true, counts: { pending: 0, running: 1, blocked: 0, held: 0, dead_letter: 1, done: 1 } } } })
  api.jobs.mockReset().mockResolvedValue({ data: { data: jobs() } })
  api.job.mockReset().mockImplementation(async (id) => ({ data: { data: jobs().find((row) => row._id === id) } }))
  api.retry.mockReset().mockResolvedValue({ data: { data: {} } })
})

describe('FormPipelineJobsSection', () => {
  it('is for super_admin, admin and team_lead; everyone else sees nothing and nothing is called', async () => {
    expect(READ_ROLES).toEqual(['super_admin', 'admin', 'team_lead'])
    expect(RETRY_ROLES).toEqual(['super_admin', 'admin'])
    for (const role of ['case_manager', 'attorney', 'client', undefined]) {
      mockUser = role ? { role } : null
      const { container, unmount } = render(<FormPipelineJobsSection />)
      expect(container.textContent).toBe('')
      unmount()
    }
    expect(api.status).not.toHaveBeenCalled()
  })

  it('shows states and stages in plain words, with the worker state', async () => {
    render(<FormPipelineJobsSection />)
    await screen.findByText('I-765')
    expect(screen.getByText('Downloading and reading the form')).toBeTruthy()
    expect(screen.getAllByText('Failed - needs an admin').length).toBeGreaterThan(0)
    expect(screen.getByTestId('pipeline-status').textContent).toMatch(/background worker is running/)
    expect(stageLabel('promote')).toBe('Making the new edition live')
  })

  it('says when queued jobs have no worker to run them', async () => {
    api.status.mockResolvedValue({ data: { data: { mode: 'queued', worker: 'separate', workerAlive: false, counts: {} } } })
    render(<FormPipelineJobsSection />)
    await screen.findByText('I-765')
    expect(screen.getByTestId('pipeline-status').textContent).toMatch(/No background worker is running/)
  })

  it('shows why a job failed in its details, and only admins can retry it', async () => {
    render(<FormPipelineJobsSection />)
    await screen.findByText('I-131')
    fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[1])
    expect((await screen.findByTestId('job-detail')).textContent).toMatch(/The test fill did not match\./)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith('j2'))
    expect((await screen.findByRole('status')).textContent).toMatch(/I-131 was put back in the queue/)
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBe(1) // only the failed job has one

    cleanup()
    mockUser = { role: 'team_lead' }
    render(<FormPipelineJobsSection />)
    await screen.findByText('I-131')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('filters by state through the API', async () => {
    render(<FormPipelineJobsSection />)
    await screen.findByText('I-765')
    fireEvent.click(screen.getByRole('button', { name: 'Failed' }))
    await waitFor(() => expect(api.jobs).toHaveBeenLastCalledWith({ state: 'dead_letter', limit: 50 }))
  })
})

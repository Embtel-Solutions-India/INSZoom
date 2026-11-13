import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const api = { syncHealth: vi.fn(), retryAll: vi.fn(), retryJob: vi.fn() }
vi.mock('../../services/api', () => ({ ghlApi: { syncHealth: (...a) => api.syncHealth(...a), retryAll: (...a) => api.retryAll(...a), retryJob: (...a) => api.retryJob(...a) } }))

import SyncHealthSection from './SyncHealthSection'
import Card from './Card'

const health = (over = {}) => ({
  enabled: true,
  reconcile: { lastAt: new Date().toISOString(), ageSeconds: 12, tookMs: 4800, orphanedCards: 4, pipelines: [] },
  webhooks: { configured: true, publicUrlSet: true, lastReceivedAt: null, last24h: 0, total: 0, dead: 0, failed: 0 },
  jobs: { pending: 2, retrying: 1, processing: 0 },
  problems: [
    { caseId: 'c1', caseNumber: 'B197-A', name: 'Manoj', kind: 'retrying', text: 'Retrying (try 3): GHL POST failed with 503', attempts: 3, nextAttemptAt: new Date(Date.now() + 120000).toISOString(), jobId: 'j1', jobType: 'create_opportunity' },
    { caseId: 'c2', caseNumber: 'B456', name: null, kind: 'waiting_email', text: 'Waiting for an e-mail', attempts: 0, nextAttemptAt: null, jobId: null, jobType: null },
  ],
  problemCount: 2,
  ...over,
})

beforeEach(() => {
  api.syncHealth.mockReset().mockResolvedValue({ data: health() })
  api.retryAll.mockReset().mockResolvedValue({ data: { moved: 3 } })
  api.retryJob.mockReset().mockResolvedValue({ data: { status: 'queued' } })
})

describe('Sync health', () => {
  it('shows the last pass, the webhook status (with what to do when none arrive) and every stuck card with its reason', async () => {
    render(<SyncHealthSection />)
    expect(await screen.findByText('2 cards not in sync')).toBeTruthy()
    expect(screen.getByText(/took 4\.8s/)).toBeTruthy()
    expect(screen.getByText(/No webhook has arrived from GoHighLevel/)).toBeTruthy()
    expect(screen.getByText(/Retrying \(try 3\)/)).toBeTruthy()
    expect(screen.getByText('Waiting for e-mail')).toBeTruthy()
    expect(screen.getByText('Cards in GHL without a case')).toBeTruthy()
  })

  it('Retry all now calls the server once and says how many were moved; a single Retry acts on its job', async () => {
    render(<SyncHealthSection />)
    fireEvent.click(await screen.findByTestId('retry-all'))
    await waitFor(() => expect(api.retryAll).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/3 waiting changes will be tried again now/)).toBeTruthy()
    fireEvent.click(screen.getByText('Retry'))
    await waitFor(() => expect(api.retryJob).toHaveBeenCalledWith('j1'))
  })

  it('says everything is in sync, and hides the webhook warning once events arrive', async () => {
    api.syncHealth.mockResolvedValue({ data: health({ problems: [], problemCount: 0, webhooks: { configured: true, publicUrlSet: true, lastReceivedAt: new Date().toISOString(), last24h: 12, total: 40, dead: 0, failed: 0 } }) })
    render(<SyncHealthSection />)
    expect(await screen.findByText('Everything is in sync')).toBeTruthy()
    expect(screen.queryByText(/No webhook has arrived/)).toBeNull()
  })
})

describe('pipeline card sync states (admin)', () => {
  const card = (extra = {}) => ({ _id: 'k1', clientName: 'Asha', caseNumber: 'B1', clientEmail: 'a@x.com', unifiedStageKey: 'a', syncStatus: 'PENDING', ...extra })
  const renderCard = (extra) => render(<Card card={card(extra)} stages={[{ key: 'a', name: 'A' }]} onMoveTo={() => {}} />)

  it('a card whose GHL card was deleted says so; one waiting for an e-mail says so; a retrying one says Retrying and offers Retry', () => {
    const deleted = renderCard({ syncDetail: { kind: 'card_deleted', text: 'Card deleted in GoHighLevel' } })
    expect(screen.getByTestId('sync-card-deleted')).toBeTruthy()
    deleted.unmount()
    const waiting = renderCard({ syncDetail: { kind: 'waiting_email', text: 'Waiting for an e-mail' } })
    expect(screen.getByTestId('sync-waiting-email')).toBeTruthy()
    waiting.unmount()
    renderCard({ syncDetail: { kind: 'retrying', text: 'Retrying (try 2)' }, failedJobId: 'j9' })
    expect(screen.getByTestId('sync-retrying')).toBeTruthy()
    expect(screen.getByTestId('retry-sync')).toBeTruthy()
  })

  it('the original "Failed to sync" marker is unchanged for a failed card, and an in-sync card shows nothing', () => {
    const failed = renderCard({ syncStatus: 'FAILED', failedJobId: 'j1' })
    expect(screen.getByText('Failed to sync')).toBeTruthy()
    failed.unmount()
    renderCard({ syncStatus: 'SYNCED' })
    expect(screen.queryByText('Failed to sync')).toBeNull()
    expect(screen.queryByTestId('sync-retrying')).toBeNull()
  })
})

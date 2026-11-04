import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

// Petition AI Review - Phase 5 (Admin): the status wording, the AI Review panel (summary, counts, findings by page, filters, Open page N,
// Re-scan / Retry / Cancel with the themed confirmation), and the petition row's chip + button (shown only when AI review is available;
// the petition list is unchanged otherwise). Plain fakes: each test decides how the API answers.
const fake = vi.hoisted(() => ({ calls: [], handlers: {}, answers: {} }))
const answer = (name, ...args) => { fake.calls.push([name, ...args]); const fn = fake.answers[name]; return fn ? fn(...args) : Promise.resolve({ data: { data: {} } }) }

vi.mock('../../services/api', () => ({
  documentsApi: { listPetitionUploads: (...a) => answer('listUploads', ...a), uploadPetition: (...a) => answer('upload', ...a), download: vi.fn(), preview: vi.fn() },
  petitionReviewApi: { list: (...a) => answer('reviewList', ...a), viewLink: (...a) => answer('viewLink', ...a), ready: (...a) => answer('ready', ...a), streamUrl: (token) => `https://api.test/stream/${token}` },
  petitionAiReviewApi: {
    listForCase: (...a) => answer('aiList', ...a), getScan: (...a) => answer('getScan', ...a), findings: (...a) => answer('findings', ...a),
    rescan: (...a) => answer('rescan', ...a), retry: (...a) => answer('retry', ...a), cancel: (...a) => answer('cancel', ...a),
  },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { _id: 'u-cm', role: 'case_manager' } }) }))
vi.mock('../../contexts/SocketContext', () => ({ useOptionalSocket: () => ({ subscribe: (event, handler) => { fake.handlers[event] = handler; return () => { delete fake.handlers[event] } } }) }))

import { aiStatusOf } from './petitionAiStatus'
import PetitionAiReviewPanel from './PetitionAiReviewPanel'
import PetitionUploadPanel from './PetitionUploadPanel'

const ok = (data) => () => Promise.resolve({ data: { data } })
const scan = (extra = {}) => ({ id: 's1', status: 'completed', counts: { error: 1, warning: 2, info: 0 }, pagesDone: 12, lastPage: 12, summary: { text: '3 issues on 2 pages: 1 to fix. AI-assisted - verify before acting.' }, diagnostics: [], ...extra })
const finding = (id, page, severity, category, found) => ({ id, page, severity, category, excerpt: `text ${id}`, found, suggestion: '' })

beforeEach(() => {
  fake.calls = []
  fake.answers = {
    getScan: ok(scan()),
    findings: ok({ findings: [finding('f1', 3, 'error', 'wrong_name', 'Name differs from the case'), finding('f2', 3, 'warning', 'typo', 'teh'), finding('f3', 9, 'warning', 'address_mismatch', 'ZIP differs')], pagination: { page: 1, pages: 1, total: 3 } }),
  }
})
afterEach(() => { cleanup(); Object.keys(fake.handlers).forEach((key) => delete fake.handlers[key]) })

describe('status wording', () => {
  it('describes every scan state in plain words', () => {
    expect(aiStatusOf(null).text).toBe('Not scanned')
    expect(aiStatusOf({ status: 'scanning', pagesDone: 40, lastPage: 120 }).text).toBe('Scanning 40 of 120 pages')
    expect(aiStatusOf({ status: 'queued', paused: { code: 'BILLING' } }).text).toBe('Waiting - AI billing')
    expect(aiStatusOf({ status: 'completed', counts: { error: 0, warning: 0, info: 0 } })).toEqual({ text: 'No issues found', tone: 'good' })
    expect(aiStatusOf({ status: 'completed', counts: { error: 2, warning: 1, info: 0 } })).toEqual({ text: '3 issues (2 to fix)', tone: 'bad' })
    expect(aiStatusOf({ status: 'completed_with_gaps', counts: { error: 0, warning: 1, info: 0 } }).text).toContain('some pages unread')
    expect(aiStatusOf({ status: 'not_configured' }).text).toBe('AI review not set up')
    expect(aiStatusOf({ status: 'failed' }).tone).toBe('bad')
  })
})

describe('AI Review panel', () => {
  const open = (props = {}) => render(<PetitionAiReviewPanel caseId="c1" documentId="d1" documentName="Petition.pdf" scanId="s1" onClose={vi.fn()} {...props} />)

  it('shows the status, severity counts, summary, findings grouped by page, and the AI-assisted note', async () => {
    open()
    expect(await screen.findByText('Page 3')).toBeTruthy()
    expect(screen.getByTestId('ai-status').textContent).toContain('3 issues (1 to fix)')
    expect(screen.getByText(/1 To fix/)).toBeTruthy()
    expect(screen.getByText(/3 issues on 2 pages/)).toBeTruthy()
    const page3 = screen.getByRole('region', { name: 'Page 3' })
    expect(within(page3).getAllByRole('listitem')).toHaveLength(2)
    expect(within(page3).getByText('Name differs from the case')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Page 9' })).toBeTruthy()
    expect(screen.getByText('AI-assisted - verify before acting.')).toBeTruthy()
  })

  it('"Open page N" opens the viewer at that page; filters ask the server again', async () => {
    const onOpenPage = vi.fn()
    open({ onOpenPage })
    fireEvent.click(await screen.findByRole('button', { name: 'Open page 9' }))
    expect(onOpenPage).toHaveBeenCalledWith(9)
    fireEvent.change(screen.getByLabelText('Filter by severity'), { target: { value: 'error' } })
    await waitFor(() => expect(fake.calls.some(([name, , params]) => name === 'findings' && params?.severity === 'error')).toBe(true))
    fireEvent.change(screen.getByLabelText('Filter by kind'), { target: { value: 'typo' } })
    await waitFor(() => expect(fake.calls.some(([name, , params]) => name === 'findings' && params?.category === 'typo')).toBe(true))
  })

  it('Re-scan asks first in the themed window, then starts a new scan; Cancel in the window does nothing', async () => {
    fake.answers.rescan = ok({ scan: { id: 's2' }, created: true })
    const onChanged = vi.fn()
    open({ onChanged })
    fireEvent.click(await screen.findByRole('button', { name: /Re-scan/ }))
    expect(screen.getByText('Scan this petition again?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(fake.calls.some(([name]) => name === 'rescan')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /Re-scan/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Scan again' }))
    await waitFor(() => expect(fake.calls.some(([name, caseId, documentId]) => name === 'rescan' && caseId === 'c1' && documentId === 'd1')).toBe(true))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    await waitFor(() => expect(fake.calls.some(([name, id]) => name === 'getScan' && id === 's2')).toBe(true))
  })

  it('a running scan can be stopped (after confirming); a failed or waiting scan offers Retry now', async () => {
    fake.answers.getScan = ok(scan({ status: 'scanning', pagesDone: 4, lastPage: 12 }))
    open()
    expect(await screen.findByText('Scanning 4 of 12 pages')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Re-scan/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel scan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop scan' }))
    await waitFor(() => expect(fake.calls.some(([name, id]) => name === 'cancel' && id === 's1')).toBe(true))
    cleanup()
    fake.answers.getScan = ok(scan({ status: 'queued', paused: { code: 'BILLING', message: 'AI billing: the prepaid credits are used up.' }, nextAttemptAt: '2026-11-04T12:00:00Z' }))
    open()
    expect(await screen.findByText(/prepaid credits are used up/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }))
    await waitFor(() => expect(fake.calls.some(([name]) => name === 'retry')).toBe(true))
  })

  it('a batch that needed a fallback is reported in one line; an API error is shown, never a crash', async () => {
    fake.answers.getScan = ok(scan({ diagnostics: [{ from: 5, to: 8, outcome: 'OK' }, { from: 9, to: 12, outcome: 'TRUNCATED' }] }))
    open()
    expect((await screen.findByTestId('ai-diagnostics')).textContent).toContain('pages 9-12, TRUNCATED')
    cleanup()
    fake.answers.getScan = () => Promise.reject(Object.assign(new Error('x'), { response: { data: { message: 'Scan not found.' } } }))
    open()
    expect((await screen.findByRole('alert')).textContent).toContain('Scan not found.')
  })

  it('shows the AI use of the scan (calls, tokens, cost, model version); hidden when nothing was used', async () => {
    fake.answers.getScan = ok(scan({ usage: { calls: 25, tokens: 180000, costUsd: 0.2468 }, modelVersion: 'gemini-3.8-flash' }))
    open()
    expect((await screen.findByTestId('ai-usage')).textContent).toBe('AI use: 25 calls · 180,000 tokens · about $0.25 · gemini-3.8-flash')
    cleanup()
    fake.answers.getScan = ok(scan({ usage: { calls: 0, tokens: 0, costUsd: null } }))
    open()
    expect(await screen.findByText('Page 3')).toBeTruthy()
    expect(screen.queryByTestId('ai-usage')).toBeNull()
  })

  it('shows the summary as bullets by page: one issue on the line, several as sub-points, with the section; "Page N" opens that page', async () => {
    const points = [
      { page: 4, items: [{ section: 'Part 1, Applicant Information', severity: 'error', category: 'wrong_name', text: 'Beneficiary entered as petitioner → Consello Technologies Inc' }] },
      { page: 47, items: [{ section: 'Ability to pay', severity: 'error', category: 'consistency', text: 'Wrong tax year' }, { section: '', severity: 'info', category: 'typo', text: 'Missing space → company. We' }] },
    ]
    fake.answers.getScan = ok(scan({ counts: { error: 2, warning: 0, info: 1 }, summary: { text: 'x', points, more: 0 } }))
    const onOpenPage = vi.fn()
    open({ onOpenPage })
    const box = await screen.findByTestId('ai-summary-points')
    expect(box.textContent).toContain('3 issues on 2 pages: 2 to fix, 0 to check, 1 minor.')
    const pages = within(box).getAllByRole('listitem').filter((li) => li.parentElement.parentElement === box)
    expect(pages).toHaveLength(2)
    expect(pages[0].textContent).toContain('Page 4 - Part 1, Applicant Information: Beneficiary entered as petitioner')
    expect(within(pages[1]).getAllByRole('listitem')).toHaveLength(2)
    expect(pages[1].textContent).toContain('Ability to pay: Wrong tax year')
    fireEvent.click(within(box).getByRole('button', { name: 'Page 47' }))
    expect(onOpenPage).toHaveBeenCalledWith(47)
  })

  it('an older scan without points still shows its summary text', async () => {
    fake.answers.getScan = ok(scan({ summary: { text: 'Old paragraph summary.' } }))
    open()
    expect(await screen.findByText('Old paragraph summary.')).toBeTruthy()
    expect(screen.queryByTestId('ai-summary-points')).toBeNull()
  })

  it('a petition never scanned shows that, with a Scan now button', async () => {
    open({ scanId: '' })
    expect(await screen.findByText('This petition has not been scanned yet.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Scan now/ })).toBeTruthy()
  })
})

describe('the petition row', () => {
  beforeEach(() => {
    fake.answers.listUploads = ok(undefined)
    fake.answers.listUploads = () => Promise.resolve({ data: { documents: [{ _id: 'd1', originalName: 'Petition.pdf', createdAt: '2026-11-01T10:00:00Z' }] } })
    fake.answers.reviewList = ok({ audience: null, attorneys: 0, items: [] })
  })

  it('shows the AI status chip and the AI Review button when AI review is available; the button opens the panel', async () => {
    fake.answers.aiList = ok({ enabled: true, petitions: [{ documentId: 'd1', scan: scan() }] })
    render(<PetitionUploadPanel caseId="c1" canUpload />)
    expect((await screen.findByTestId('ai-chip-d1')).textContent).toBe('3 issues (1 to fix)')
    fireEvent.click(screen.getByRole('button', { name: /AI Review/ }))
    expect(await screen.findByRole('dialog', { name: /AI review of Petition.pdf/ })).toBeTruthy()
  })

  it('nothing AI-related is shown when the feature is off with no results, or when the AI API fails - the list is unchanged', async () => {
    fake.answers.aiList = ok({ enabled: false, petitions: [{ documentId: 'd1', scan: null }] })
    render(<PetitionUploadPanel caseId="c1" canUpload />)
    expect(await screen.findByText('Petition.pdf')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /AI Review/ })).toBeNull()
    cleanup()
    fake.answers.aiList = () => Promise.reject(Object.assign(new Error('404'), { response: { status: 404 } }))
    render(<PetitionUploadPanel caseId="c1" canUpload />)
    expect(await screen.findByText('Petition.pdf')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /AI Review/ })).toBeNull()
  })

  it('a live petition:ai_review event refreshes the chip', async () => {
    let current = scan({ status: 'scanning', pagesDone: 4, lastPage: 12 })
    fake.answers.aiList = () => Promise.resolve({ data: { data: { enabled: true, petitions: [{ documentId: 'd1', scan: current }] } } })
    render(<PetitionUploadPanel caseId="c1" canUpload />)
    expect((await screen.findByTestId('ai-chip-d1')).textContent).toBe('Scanning 4 of 12 pages')
    current = scan()
    fake.handlers['petition:ai_review']?.({ caseId: 'c1', status: 'completed' })
    await waitFor(() => expect(screen.getByTestId('ai-chip-d1').textContent).toBe('3 issues (1 to fix)'))
  })
})

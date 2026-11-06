import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const api = { get: vi.fn(), post: vi.fn() }
vi.mock('../services/api', () => ({ default: { get: (...a) => api.get(...a), post: (...a) => api.post(...a) } }))
const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => navigate }))

import EverydayPrompt from './EverydayPrompt'
const mount = () => render(<MemoryRouter><EverydayPrompt /></MemoryRouter>)

beforeEach(() => {
  api.get.mockReset(); api.post.mockReset().mockResolvedValue({ data: {} }); navigate.mockReset()
})

describe('EverydayPrompt', () => {
  it('shows the goal box, opens the plan section on click', async () => {
    api.get.mockResolvedValue({ data: { data: { prompts: { plan: true, report: false } } } })
    mount()
    fireEvent.click(await screen.findByText("Write your today's goal"))
    expect(navigate).toHaveBeenCalledWith('/eod-reports?section=plan')
    expect(screen.queryByTestId('everyday-prompt-report')).toBeNull()
  })

  it('the achievements box opens the report section', async () => {
    api.get.mockResolvedValue({ data: { data: { prompts: { plan: false, report: true } } } })
    mount()
    fireEvent.click(await screen.findByText("Don't forget your achievements"))
    expect(navigate).toHaveBeenCalledWith('/eod-reports?section=report')
  })

  it('the cross hides it at once and tells the server', async () => {
    api.get.mockResolvedValue({ data: { data: { prompts: { plan: true, report: false } } } })
    mount()
    fireEvent.click(await screen.findByLabelText(/Dismiss/))
    await waitFor(() => expect(screen.queryByTestId('everyday-prompt-plan')).toBeNull())
    expect(api.post).toHaveBeenCalledWith('/reports/everyday/me/dismiss', { kind: 'plan' })
  })

  it('shows nothing when the server says no prompt, or the person is not on the team', async () => {
    api.get.mockResolvedValue({ data: { data: { prompts: { plan: false, report: false } } } })
    const first = mount()
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(first.container.innerHTML).toBe('')
    first.unmount()
    api.get.mockReset().mockRejectedValue({ response: { status: 403 } })
    const second = mount()
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(second.container.innerHTML).toBe('')
  })
})

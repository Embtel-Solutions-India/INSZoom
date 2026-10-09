import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

let mockUser = { role: 'admin' }
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }))

let lastCategory = null
const hookState = { columns: [], pipelines: [], forceActive: null, status: { loading: false, error: null, disabled: false, configured: true }, notice: null }
vi.mock('../hooks/usePipelineBoard', () => ({
  default: (category) => ({ ...(lastCategory = category, hookState), activeCategory: hookState.forceActive || hookState.staleActive || category, fallbackCategory: hookState.forceActive && hookState.forceActive !== category ? hookState.forceActive : null, dismissNotice: vi.fn(), moveCard: vi.fn(), loadMore: vi.fn(), refresh: vi.fn(), setDragging: vi.fn(), connected: true }),
}))
vi.mock('../components/pipeline/GhlStatusPanel', () => ({ default: () => <div>STATUS PANEL</div> }))

const casesApi = { visaTypes: vi.fn(), update: vi.fn() }
vi.mock('../services/api', () => ({ casesApi: { visaTypes: (...a) => casesApi.visaTypes(...a), update: (...a) => casesApi.update(...a) }, ghlApi: {} }))

import Pipeline from './Pipeline'
import GhlVisaSelectBanner from '../components/GhlVisaSelectBanner'

const column = (key, cards = []) => ({ key, name: key.toUpperCase(), total: cards.length, hasMore: false, cards })
const cardOf = (id, extra = {}) => ({ _id: id, clientName: `Client ${id}`, caseNumber: `N-${id}`, clientEmail: `${id}@x.com`, unifiedStageKey: 'a', syncStatus: 'SYNCED', priority: 'medium', ...extra })
const renderPage = () => render(<MemoryRouter><Pipeline /></MemoryRouter>)

beforeEach(() => {
  mockUser = { role: 'admin' }
  lastCategory = null
  hookState.pipelines = [{ category: 'immigrant', name: 'Immigrant Documentation pipeline', total: 3 }, { category: 'non_immigrant', name: 'Non-Immigrant Documentation pipeline', total: 7 }]
  hookState.forceActive = null
  hookState.staleActive = null
  try { sessionStorage.clear() } catch { /* ignore */ }
  hookState.status = { loading: false, error: null, disabled: false, configured: true }
  hookState.columns = [column('a', [cardOf('1', { visaSelectionRequired: true })]), column('b')]
  hookState.notice = null
})

describe('Pipeline page', () => {
  it('shows admins "Pipeline" with the Integration control', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Pipeline' })).toBeTruthy()
    expect(screen.getByText('Integration')).toBeTruthy()
    expect(screen.getByText('Client 1')).toBeTruthy()
    expect(screen.getByText('Visa required')).toBeTruthy()
  })

  it('shows a case manager "My Pipeline" with NO integration/admin controls', () => {
    mockUser = { role: 'case_manager' }
    renderPage()
    expect(screen.getByRole('heading', { name: 'My Pipeline' })).toBeTruthy()
    expect(screen.queryByText('Integration')).toBeNull()
    expect(screen.getByText(/Only the cases assigned to you/)).toBeTruthy()
  })

  it('team leads get the full pipeline but not the admin integration panel', () => {
    mockUser = { role: 'team_lead' }
    renderPage()
    expect(screen.getByRole('heading', { name: 'Pipeline' })).toBeTruthy()
    expect(screen.queryByText('Integration')).toBeNull()
  })

  it('opens the admin status panel on demand', () => {
    renderPage()
    expect(screen.queryByText('STATUS PANEL')).toBeNull()
    fireEvent.click(screen.getByText('Integration'))
    expect(screen.getByText('STATUS PANEL')).toBeTruthy()
  })

  it('only admins ever see the "Failed to sync" marker', () => {
    hookState.columns = [column('a', [cardOf('1', { syncStatus: 'FAILED' })])]
    renderPage()
    expect(screen.getByText('Failed to sync')).toBeTruthy()
  })

  it('an employee card shows its employer and "not identified yet" until the employer names them', () => {
    hookState.columns = [column('a', [cardOf('1', { caseRole: 'employee', employeeIdentified: false, clientName: '', clientEmail: '', employerName: 'ABC Technologies' }), cardOf('2', { caseRole: 'employee', employeeIdentified: true, clientName: 'John Smith', employerName: 'ABC Technologies' })])]
    renderPage()
    expect(screen.getByText('Employee, not identified yet')).toBeTruthy()
    expect(screen.getByText('John Smith')).toBeTruthy()
    expect(screen.getAllByText('ABC Technologies').length).toBe(2)
    expect(screen.queryByText('No email')).toBeNull() // an employee has no email of their own yet; that is not a problem to show
  })

  it('a family card is ONE card: petitioner as the title, beneficiary underneath', () => {
    hookState.columns = [column('a', [
      cardOf('1', { isFamily: true, clientName: 'John Smith', clientEmail: null, beneficiaryIdentified: false, beneficiaryName: '' }),
      cardOf('2', { isFamily: true, clientName: 'Ana Lopez', clientEmail: null, beneficiaryIdentified: true, beneficiaryName: 'Maria Lopez' }),
    ])]
    renderPage()
    expect(screen.getByText('John Smith')).toBeTruthy()
    expect(screen.getByText('Beneficiary: not identified yet')).toBeTruthy()
    expect(screen.getByText('Beneficiary: Maria Lopez')).toBeTruthy()
    expect(screen.queryByText('No email')).toBeNull()
    expect(screen.getAllByText(/Beneficiary:/).length).toBe(2) // two family cards, two lines, never a separate beneficiary card
    fireEvent.change(screen.getByLabelText('Filter loaded cases'), { target: { value: 'maria' } })
    expect(screen.queryByText('John Smith')).toBeNull()
    expect(screen.getByText('Ana Lopez')).toBeTruthy()
  })

  it('the filter also finds cards by employer name', () => {
    hookState.columns = [column('a', [cardOf('1', { employerName: 'ABC Technologies' }), cardOf('2', { employerName: 'Zed Corp' })])]
    renderPage()
    fireEvent.change(screen.getByLabelText('Filter loaded cases'), { target: { value: 'zed' } })
    expect(screen.queryByText('Client 1')).toBeNull()
    expect(screen.getByText('Client 2')).toBeTruthy()
  })

  it('filters loaded cards client-side', () => {
    hookState.columns = [column('a', [cardOf('1'), cardOf('2', { clientName: 'Zed Person' })])]
    renderPage()
    fireEvent.change(screen.getByLabelText('Filter loaded cases'), { target: { value: 'zed' } })
    expect(screen.queryByText('Client 1')).toBeNull()
    expect(screen.getByText('Zed Person')).toBeTruthy()
  })

  it('shows one tab per GHL pipeline with its own count, never a merged board', () => {
    renderPage()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Immigrant3', 'Non-Immigrant7'])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(tabs[1].getAttribute('aria-selected')).toBe('false')
  })

  it('switching tabs asks for the other pipeline and remembers the choice', () => {
    renderPage()
    expect(lastCategory).toBe('immigrant')
    fireEvent.click(screen.getByRole('tab', { name: /Non-Immigrant/ }))
    expect(lastCategory).toBe('non_immigrant')
    expect(sessionStorage.getItem('ghl-pipeline-category')).toBe('non_immigrant')
  })

  it('starts on the remembered pipeline', () => {
    sessionStorage.setItem('ghl-pipeline-category', 'non_immigrant')
    renderPage()
    expect(lastCategory).toBe('non_immigrant')
  })

  it('a case manager gets the same two tabs on their private board', () => {
    mockUser = { role: 'case_manager' }
    renderPage()
    expect(screen.getAllByRole('tab').length).toBe(2)
    expect(screen.getByRole('heading', { name: 'My Pipeline' })).toBeTruthy()
  })

  it('follows the server when the remembered pipeline is not available', () => {
    sessionStorage.setItem('ghl-pipeline-category', 'non_immigrant')
    hookState.pipelines = [{ category: 'immigrant', name: 'Immigrant Documentation pipeline', total: 1 }]
    hookState.forceActive = 'immigrant' // the server served the Immigrant board even though Non-Immigrant was requested
    renderPage()
    expect(lastCategory).toBe('immigrant')
  })

  it('does not flip back when only the instant tab highlight differs (no server fallback)', () => {
    sessionStorage.setItem('ghl-pipeline-category', 'non_immigrant')
    hookState.pipelines = [{ category: 'immigrant', name: 'I', total: 1 }, { category: 'non_immigrant', name: 'N', total: 1 }]
    hookState.staleActive = 'immigrant' // momentary mismatch right after a click, before the new board answers
    renderPage()
    expect(lastCategory).toBe('non_immigrant')
  })

  it('shows no tabs before the pipelines are known', () => {
    hookState.pipelines = []
    renderPage()
    expect(screen.queryAllByRole('tab').length).toBe(0)
  })

  it('explains the disabled and not-yet-configured states', () => {
    hookState.status = { loading: false, error: null, disabled: true, configured: false }
    const { unmount } = renderPage()
    expect(screen.getByText(/isn’t enabled yet/)).toBeTruthy()
    unmount()
    hookState.status = { loading: false, error: null, disabled: false, configured: false }
    mockUser = { role: 'case_manager' }
    renderPage()
    expect(screen.getByText(/still being set up/)).toBeTruthy()
  })
})

describe('GhlVisaSelectBanner', () => {
  const caseData = { _id: 'case1', visaSelectionStatus: 'pending' }
  const types = { data: { data: [
    { visaType: 'ZZ-1', label: 'ZZ-1 Student', caseStructure: 'single' },
    { visaType: 'H-1B', label: 'H-1B', caseStructure: 'employer_employee' },
    { visaType: 'K-1', label: 'K-1', caseStructure: 'family' },
    { visaType: 'ZZ-2', label: 'ZZ-2', caseStructure: 'single' },
  ] } }

  beforeEach(() => { casesApi.visaTypes.mockReset().mockResolvedValue(types); casesApi.update.mockReset() })

  it('renders nothing for any case that is not waiting on a visa', () => {
    const { container } = render(<GhlVisaSelectBanner caseData={{ _id: 'c', visaType: 'H-1B' }} />)
    expect(container.innerHTML).toBe('')
    expect(casesApi.visaTypes).not.toHaveBeenCalled()
  })

  it('offers the same list as New case, every visa selectable; saves the choice', async () => {
    mockUser = { role: 'team_lead' }
    const onUpdated = vi.fn()
    casesApi.update.mockResolvedValue({ data: { case: { _id: 'case1', visaType: 'ZZ-1' } } })
    render(<GhlVisaSelectBanner caseData={caseData} onUpdated={onUpdated} />)
    await waitFor(() => expect(screen.getByRole('option', { name: /ZZ-1 - ZZ-1 Student/ })).toBeTruthy())
    expect(screen.getByRole('option', { name: 'H-1B' }).disabled).toBe(false) // shared curated option, employer structure: selectable too
    expect(screen.queryByText(/not available/)).toBeNull()
    expect(screen.getByRole('option', { name: /ZZ-1 - ZZ-1 Student/ }).disabled).toBe(false)
    fireEvent.change(screen.getByLabelText('Visa type'), { target: { value: 'ZZ-1' } })
    fireEvent.click(screen.getByText('Set visa type'))
    await waitFor(() => expect(casesApi.update).toHaveBeenCalledWith('case1', { visaType: 'ZZ-1' }))
    await waitFor(() => expect(onUpdated).toHaveBeenCalled())
    expect(screen.getByText(/Visa type saved/)).toBeTruthy()
  })

  it('shows the server message if the visa is rejected, and stays editable', async () => {
    mockUser = { role: 'admin' }
    casesApi.update.mockRejectedValue({ response: { data: { message: 'needs an employer/employee case structure' } } })
    render(<GhlVisaSelectBanner caseData={caseData} />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'ZZ-2' })).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Visa type'), { target: { value: 'ZZ-2' } })
    fireEvent.click(screen.getByText('Set visa type'))
    await waitFor(() => expect(screen.getByText(/employer\/employee case structure/)).toBeTruthy())
    expect(screen.getByLabelText('Visa type')).toBeTruthy()
  })

  it('tells a case manager their team lead selects the visa, with no select and no fetch', () => {
    mockUser = { role: 'case_manager' }
    render(<GhlVisaSelectBanner caseData={caseData} />)
    expect(screen.getByText(/Your team lead selects the visa type/)).toBeTruthy()
    expect(screen.queryByLabelText('Visa type')).toBeNull()
    expect(casesApi.visaTypes).not.toHaveBeenCalled()
  })
})

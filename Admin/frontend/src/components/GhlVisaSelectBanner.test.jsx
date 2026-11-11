import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../services/api', () => ({ casesApi: { update: vi.fn() } }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'team_lead' } }) }))
vi.mock('../utils/visaOptions', () => ({
  useVisaOptions: () => ({ options: [], registryTypes: [], error: null }),
  registryEntryFor: () => null,
  groupVisaOptions: () => [],
}))
vi.mock('./ui/WrappingSelect', () => ({ default: () => <div data-testid="select" /> }))

import GhlVisaSelectBanner, { ghlVisaHint } from './GhlVisaSelectBanner'

const pendingCase = (visaResolution) => ({ _id: 'c1', visaSelectionStatus: 'pending', integrations: { ghl: { visaResolution } } })

describe('GhlVisaSelectBanner', () => {
  it('tells the team what GHL shows and to select the visa accordingly', () => {
    render(<GhlVisaSelectBanner caseData={pendingCase({ field: 'work_visa', value: 'H-1B - Specialty Occupation', status: 'incomplete' })} />)
    expect(screen.getByTestId('ghl-visa-hint').textContent).toContain('GHL shows "H-1B - Specialty Occupation" in its Work Visa dropdown. Select the visa type accordingly.')
  })

  it('names whichever of the four GHL dropdowns holds the value', () => {
    expect(ghlVisaHint({ field: 'work_visa', value: 'L-1A' })).toBe('GHL shows "L-1A" in its Work Visa dropdown.')
    expect(ghlVisaHint({ field: 'study_visa', value: 'F-1' })).toBe('GHL shows "F-1" in its Study Visa dropdown.')
    expect(ghlVisaHint({ field: 'green_card', value: 'EB-2' })).toBe('GHL shows "EB-2" in its Green Card dropdown.')
    expect(ghlVisaHint({ field: 'business__investment', value: 'E-2' })).toBe('GHL shows "E-2" in its Business/Investment dropdown.')
    expect(ghlVisaHint({ field: 'service_type', value: 'Other' })).toBe('GHL shows "Other" in its Service Type field.')
  })

  it('explains the cases with no single value in the words GHL uses', () => {
    expect(ghlVisaHint({ status: 'ambiguous', reason: 'More than one visa field is filled (work_visa, green_card)' })).toBe('GHL: More than one visa field is filled (Work Visa, Green Card).')
    expect(ghlVisaHint({ status: 'none', reason: 'No visa information on the opportunity' })).toContain('no visa chosen in any of its visa dropdowns')
    expect(ghlVisaHint({ status: 'unavailable', reason: 'not available' })).toBe('')
    expect(ghlVisaHint(undefined)).toBe('')
  })

  it('shows no hint when GHL sent no value', () => {
    render(<GhlVisaSelectBanner caseData={pendingCase(undefined)} />)
    expect(screen.queryByTestId('ghl-visa-hint')).toBeNull()
    expect(screen.getByText('Visa selection required')).toBeTruthy()
  })

  it('renders nothing for a case that already has its visa', () => {
    const { container } = render(<GhlVisaSelectBanner caseData={{ _id: 'c1', visaSelectionStatus: 'selected' }} />)
    expect(container.textContent).toBe('')
  })
})

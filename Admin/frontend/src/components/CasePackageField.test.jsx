import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const update = vi.fn()
vi.mock('../services/api', () => ({ casesApi: { update: (...args) => update(...args) } }))

import CasePackageField from './CasePackageField'

const caseData = { _id: 'c1', package: 'Self Filing Package', plan: { tier: 'Self Filing Package', amount: 50000 } }
const setup = (props = {}) => render(<CasePackageField caseData={caseData} label="Self Filing Package" amountText="$500.00" userRole="team_lead" onSaved={vi.fn()} {...props} />)

describe('CasePackageField', () => {
  beforeEach(() => { update.mockReset() }) // (a hook must not return the mock: vitest would call it as a cleanup)

  it('shows the package and the amount exactly as before, with an edit pencil for staff who can edit the case', () => {
    setup()
    expect(screen.getByText('Self Filing Package')).toBeTruthy()
    expect(screen.getByText('$500.00')).toBeTruthy()
    expect(screen.getByLabelText('Change the package')).toBeTruthy()
  })

  it('offers no edit control to a role that cannot edit the case', () => {
    setup({ userRole: 'attorney' })
    expect(screen.queryByLabelText('Change the package')).toBeNull()
    expect(screen.getByText('Self Filing Package')).toBeTruthy()
  })

  it('lists exactly the three packages and saves only { package } through the case update', async () => {
    update.mockResolvedValue({ data: { case: { _id: 'c1', package: 'Attorney Review Package' } } })
    const onSaved = vi.fn()
    setup({ onSaved })
    fireEvent.click(screen.getByLabelText('Change the package'))
    const select = screen.getByLabelText('Package')
    expect([...select.querySelectorAll('option')].map((o) => o.value)).toEqual(['Self Filing Package', 'Attorney Review Package', 'Full Attorney Filing Package'])
    fireEvent.change(select, { target: { value: 'Attorney Review Package' } })
    fireEvent.click(screen.getByLabelText('Save package'))
    await waitFor(() => expect(update).toHaveBeenCalledWith('c1', { package: 'Attorney Review Package' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('does not call the server when nothing changed', () => {
    setup()
    fireEvent.click(screen.getByLabelText('Change the package'))
    fireEvent.click(screen.getByLabelText('Save package'))
    expect(update).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Package')).toBeNull() // the editor closed
  })

  it('shows the server message when saving fails and keeps the editor open', async () => {
    update.mockImplementation(() => { throw Object.assign(new Error('request failed'), { response: { data: { message: 'Package must be one of: ...' } } }) })
    setup()
    fireEvent.click(screen.getByLabelText('Change the package'))
    fireEvent.change(screen.getByLabelText('Package'), { target: { value: 'Full Attorney Filing Package' } })
    fireEvent.click(screen.getByLabelText('Save package'))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByText('Package must be one of: ...')).toBeTruthy()
    expect(screen.getByLabelText('Package')).toBeTruthy() // the editor stays open
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../services/api', () => ({ casesApi: { setEmployerIdentity: vi.fn().mockResolvedValue({}), setEmployeeIdentity: vi.fn() } }))
import { casesApi } from '../services/api'
import { EmployerIdentityNotice } from './EmployeeIdentityForm'

const principal = (contact) => ({ _id: 'p1', caseRole: 'principal', employerContact: contact })

describe('EmployerIdentityNotice', () => {
  beforeEach(() => { casesApi.setEmployerIdentity.mockClear() })

  it('shows nothing when the employer name and email are both set (or it is not an employer matter)', () => {
    const { container, rerender } = render(<EmployerIdentityNotice caseData={principal({ complete: true })} />)
    expect(container.innerHTML).toBe('')
    rerender(<EmployerIdentityNotice caseData={{ _id: 'x' }} />)
    expect(container.innerHTML).toBe('')
  })

  it('asks for the missing email and saves it', async () => {
    const onSaved = vi.fn()
    render(<EmployerIdentityNotice caseData={principal({ complete: false, missingName: false, missingEmail: true })} onSaved={onSaved} />)
    fireEvent.click(screen.getByText('Employer details needed'))
    expect(screen.queryByLabelText('Employer name')).toBeNull()
    fireEvent.change(screen.getByLabelText('Employer email'), { target: { value: 'hr@acme.com' } })
    fireEvent.click(screen.getByText('Save details'))
    await waitFor(() => expect(casesApi.setEmployerIdentity).toHaveBeenCalledWith('p1', { email: 'hr@acme.com' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('asks for both when both are missing', () => {
    render(<EmployerIdentityNotice caseData={principal({ complete: false, missingName: true, missingEmail: true })} />)
    fireEvent.click(screen.getByText('Employer details needed'))
    expect(screen.getByLabelText('Employer name')).toBeTruthy()
    expect(screen.getByLabelText('Employer email')).toBeTruthy()
  })
})

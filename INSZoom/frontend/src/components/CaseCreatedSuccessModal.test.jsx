import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CaseCreatedSuccessModal from './CaseCreatedSuccessModal'

describe('CaseCreatedSuccessModal', () => {
  it('shows the created case number and closes from the primary action', () => {
    const onClose = vi.fn()

    render(<CaseCreatedSuccessModal caseNumber="B005" onClose={onClose} />)

    expect(screen.getByRole('dialog', { name: /yay! new case created/i })).toBeTruthy()
    expect(screen.getByText(/Case B005 has been successfully created and added/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /ok, thanks/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('uses fallback copy when no case number is available', () => {
    render(<CaseCreatedSuccessModal caseNumber="" onClose={() => {}} />)

    expect(screen.getByText(/Your new case has been successfully created and added/i)).toBeTruthy()
  })
})

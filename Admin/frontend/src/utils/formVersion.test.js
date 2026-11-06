import { describe, it, expect } from 'vitest'
import { formVersionLabel } from './formVersion'

describe('formVersionLabel', () => {
  it('hides the internal revision counter of the DOL forms', () => {
    expect(formVersionLabel('v1')).toBe('—')
    expect(formVersionLabel('V12')).toBe('—')
  })
  it('shows every other version exactly as stored', () => {
    expect(formVersionLabel('2026-09-09')).toBe('2026-09-09')
    expect(formVersionLabel('2024-01-04-rev-1a2b3c4d5e6f')).toBe('2024-01-04-rev-1a2b3c4d5e6f')
    expect(formVersionLabel('v1.2')).toBe('v1.2')
  })
  it('shows a dash when there is no version', () => {
    expect(formVersionLabel(undefined)).toBe('—')
    expect(formVersionLabel('')).toBe('—')
  })
})

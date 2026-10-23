import { describe, expect, it } from 'vitest'
import { VISA_TYPE_OPTIONS, isEmployerEmployeeOption } from './visaOptions'

// What GET /cases/visa-types reports for the employer / employee case types (config/visaCategories.js)
const registryTypes = [
  'H-1B', 'H-1B1', 'L-1A', 'L-1B', 'L-1A Extension', 'O-1A', 'O-1B', 'TN', 'E-1', 'E-2', 'E-3', 'R-1', 'PERM',
  'EB-1B', 'EB-1C', 'EB-2', 'EB-2 PERM', 'EB-3', 'EB-3 Skilled Worker', 'EB-3 Professional', 'EB-3 Other Worker',
].map((visaType) => ({ visaType, caseStructure: 'employer_employee', hasChecklist: true }))
  .concat([{ visaType: 'EB-1A', caseStructure: 'single' }, { visaType: 'EB-2 NIW', caseStructure: 'single' }, { visaType: 'IR-1', caseStructure: 'family' }])

const option = (value) => VISA_TYPE_OPTIONS.find((item) => item.value === value)

describe('employer / employee visas get the employer form', () => {
  it('EB-2, EB-3 and the other curated employer visas are employer / employee options, like H-1B', () => {
    for (const value of ['h1b', 'eb2', 'eb3', 'eb1b', 'eb1c', 'perm', 'l1aextension', 'tn', 'o1a']) {
      expect(isEmployerEmployeeOption(option(value), registryTypes), value).toBe(true)
    }
  })
  it('self-petitioned and family visas are not', () => {
    for (const value of ['eb1a', 'niw', 'ir1']) expect(isEmployerEmployeeOption(option(value), registryTypes), value).toBe(false)
  })
  it('an option the registry does not know is not an employer visa', () => {
    expect(isEmployerEmployeeOption({ value: 'nonsense', label: 'Nonsense' }, registryTypes)).toBe(false)
    expect(isEmployerEmployeeOption(undefined, registryTypes)).toBe(false)
  })
})

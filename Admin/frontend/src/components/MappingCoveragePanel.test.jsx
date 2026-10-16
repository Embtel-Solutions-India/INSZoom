import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

afterEach(() => { cleanup() })

const api = vi.hoisted(() => ({ mappingCoverage: vi.fn() }))
vi.mock('../services/api', () => ({ formGovernanceApi: { mappingCoverage: (...a) => api.mappingCoverage(...a) } }))

import MappingCoveragePanel from './MappingCoveragePanel'

const coverage = (over = {}) => ({
  fields: { total: 200, mapped: 150, coveragePercent: 75, requiredUnmapped: 2, requiredUnmappedFields: [], optionalUnmapped: 10, unmappedByClass: { intentional: 5, out_of_scope: 30, optional: 10, unresolved: 5 } },
  edges: { total: 160, byStatus: { active: 150 }, byOrigin: { authored: 20, legacy: 130 }, legacy: 130 },
  questions: { withoutPdfField: 3, paths: [] }, unpopulatedSources: { count: 0, paths: [] }, unreachableConditions: { count: 0, edges: [] }, conflicts: { duplicateTargets: 0, targets: [], recorded: 0 },
  contract: { valid: true, errors: 0, legacyViolations: 4 }, defaults: { total: 5, categories: {}, flaggedCount: 1 },
  warnings: [{ code: 'LEGACY_CONTRACT_VIOLATIONS', count: 4 }, { code: 'REQUIRED_FIELDS_UNMAPPED', count: 2 }], ...over,
})

beforeEach(() => { api.mappingCoverage.mockReset().mockResolvedValue({ data: { success: true, templateId: 't1', coverage: coverage() } }) })

describe('MappingCoveragePanel', () => {
  it('loads only when opened and explains the report in plain words', async () => {
    render(<MappingCoveragePanel templateId="t1" />)
    expect(api.mappingCoverage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Show coverage/ }))
    await screen.findByTestId('coverage-report')
    expect(api.mappingCoverage).toHaveBeenCalledWith('t1')
    expect(screen.getByText(/150 of 200 \(75%\)/)).toBeTruthy()
    expect(screen.getByText(/not something the client provides/)).toBeTruthy()
    expect(screen.getByText(/older mappings \(not yet re-checked\)/)).toBeTruthy()
    expect(screen.getByTestId('coverage-warnings').textContent).toMatch(/4 older mapping\(s\) do not follow today's rules/)
    expect(document.body.textContent).not.toMatch(/PATH_UNKNOWN|LEGACY_CONTRACT_VIOLATIONS/)
  })

  it('says so when nothing needs attention', async () => {
    api.mappingCoverage.mockResolvedValue({ data: { coverage: coverage({ warnings: [] }) } })
    render(<MappingCoveragePanel templateId="t1" />)
    fireEvent.click(screen.getByRole('button', { name: /Show coverage/ }))
    expect(await screen.findByText('Nothing needs attention.')).toBeTruthy()
  })

  it('shows an error instead of crashing, and renders nothing without a template', async () => {
    api.mappingCoverage.mockRejectedValue({ response: { data: { message: 'USCIS form template not found' } } })
    render(<MappingCoveragePanel templateId="t1" />)
    fireEvent.click(screen.getByRole('button', { name: /Show coverage/ }))
    expect((await screen.findByRole('alert')).textContent).toBe('USCIS form template not found')
    cleanup()
    const { container } = render(<MappingCoveragePanel templateId={undefined} />)
    expect(container.textContent).toBe('')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => ({ visaTypes: vi.fn() }))
vi.mock('../services/api', () => ({ casesApi: api }))

import { useVisaOptions, VISA_TYPE_OPTIONS } from './visaOptions'

// The visa list lives on the server (Backend/src/config/visaDropdown.js) so every portal shows the same one; Admin only falls back to its own copy if the server does not send it.
describe('useVisaOptions', () => {
  beforeEach(() => { api.visaTypes.mockReset() })

  it('uses the list the server sends, so a change on the server reaches this portal', async () => {
    const serverOptions = [{ value: 'zz9', label: 'ZZ-9 Brand New Visa', canonicalLabel: 'ZZ-9' }]
    api.visaTypes.mockResolvedValue({ data: { data: [], options: serverOptions } })
    const { result } = renderHook(() => useVisaOptions())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.options).toEqual(serverOptions)
  })

  it('falls back to merging its own curated list when the server sends none (an older server)', async () => {
    api.visaTypes.mockResolvedValue({ data: { data: [] } })
    const { result } = renderHook(() => useVisaOptions())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.options.map((o) => o.value)).toEqual(VISA_TYPE_OPTIONS.map((o) => o.value))
  })

  it('still offers the curated list when the request fails', async () => {
    api.visaTypes.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useVisaOptions())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.error).toBe(true)
    expect(result.current.options.length).toBe(VISA_TYPE_OPTIONS.length)
  })
})

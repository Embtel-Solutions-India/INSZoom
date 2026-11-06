import { describe, it, expect } from 'vitest'
import { cleanTrackingNumber, isValidTrackingNumber, fedexTrackingUrl, displayTrackingNumber, hasFedexNumber } from './fedexTracking'

describe('fedexTracking', () => {
  it('cleans spaces and dashes', () => {
    expect(cleanTrackingNumber(' 7946-4479 0138 ')).toBe('794644790138')
    expect(cleanTrackingNumber(undefined)).toBe('')
  })
  it('accepts plausible numbers and refuses the rest', () => {
    expect(isValidTrackingNumber('794644790138')).toBe(true)
    expect(isValidTrackingNumber('7946 4479 0138')).toBe(true)
    for (const bad of ['', '12', 'abc def', '7946 4479 0138 !', 'x'.repeat(40), null]) expect(isValidTrackingNumber(bad)).toBe(false)
  })
  it('builds the FedEx link only from a valid number', () => {
    expect(fedexTrackingUrl('7946 4479 0138')).toBe('https://www.fedex.com/fedextrack/?trknbr=794644790138')
    expect(fedexTrackingUrl('12')).toBe('')
    expect(fedexTrackingUrl('')).toBe('')
  })
  it('groups long digit numbers for reading', () => {
    expect(displayTrackingNumber('794644790138')).toBe('7946 4479 0138')
    expect(displayTrackingNumber('1Z999AA10123456784')).toBe('1Z999AA10123456784')
  })
  it('recognises a usable FedEx filing record', () => {
    expect(hasFedexNumber({ carrier: 'fedex', trackingNumber: '794644790138' })).toBe(true)
    expect(hasFedexNumber({ carrier: 'ups', trackingNumber: '794644790138' })).toBe(false)
    expect(hasFedexNumber({ carrier: 'fedex', trackingNumber: '12' })).toBe(false)
    expect(hasFedexNumber(undefined)).toBe(false)
  })
})

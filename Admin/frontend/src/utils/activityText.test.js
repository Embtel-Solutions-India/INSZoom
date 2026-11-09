import { describe, it, expect } from 'vitest'
import { plainActivityText } from './activityText'

describe('plainActivityText', () => {
  it('rewrites the system-style pipeline line in plain words', () => {
    expect(plainActivityText('Opportunity JMgJeV4JzoeZYJwRSeVZ in "Immigrant Documentation pipeline"')).toBe('Case added to the Immigrant Documentation pipeline')
    expect(plainActivityText('GHL opportunity created')).toBe('Added to the pipeline')
  })
  it('leaves every other line exactly as written', () => {
    expect(plainActivityText('Moved to "Submitted (FedEx)"')).toBe('Moved to "Submitted (FedEx)"')
    expect(plainActivityText(undefined)).toBe('')
  })
})

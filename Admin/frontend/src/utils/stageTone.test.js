import { describe, it, expect } from 'vitest'
import { stageToneKey, stageToneStyle, stageToneColor, rowToneStyle, mixedMatterTone, allEmployeesFiled, TONE_ORDER } from './stageTone'

const employees = (...names) => names.map((name) => ({ name, count: 1 }))

describe('stage tones: PWD under process is a soft orange, next to the green (filed) and the red (on hold)', () => {
  it('recognises the stage by its name or its key, and nothing else', () => {
    expect(stageToneKey('PWD under process')).toBe('orange')
    expect(stageToneKey('pwd_under_process')).toBe('orange')
    for (const other of ['Case Onboarded', 'Docs checklist', 'Draft ready', 'Internal Review', 'Client review']) expect(stageToneKey(other)).toBeNull()
  })

  it('keeps the other colours exactly as they were', () => {
    expect(stageToneKey('Submitted')).toBe('blue')
    expect(stageToneKey('submitted_fedex')).toBe('blue')
    expect(stageToneKey('Status - Approved')).toBe('blue')
    expect(stageToneKey('On Hold')).toBe('red')
    expect(stageToneKey('on_hold')).toBe('red')
    expect(stageToneKey('')).toBeNull()
  })

  it('orders the colours like the lists: orange, then filed, then on hold', () => {
    expect(TONE_ORDER).toEqual(['orange', 'blue', 'red'])
  })

  it('tints a row with the same soft 9 % wash as the others, and a pill with 13 %', () => {
    expect(rowToneStyle({ pipelineStageKey: 'pwd_under_process' })).toEqual({ backgroundColor: 'rgba(var(--tone-orange-rgb), 0.09)' })
    expect(rowToneStyle({ pipelineStageKey: 'submitted_fedex' })).toEqual({ backgroundColor: 'rgba(var(--tone-blue-rgb), 0.09)' })
    expect(stageToneStyle('PWD under process')).toMatchObject({ backgroundColor: 'rgba(var(--tone-orange-rgb), 0.13)', color: 'rgb(var(--tone-orange-text-rgb))' })
    expect(stageToneColor('PWD under process')).toBe('rgb(var(--tone-orange-text-rgb))')
    expect(rowToneStyle({ pipelineStageKey: 'case_onboarded' })).toBeUndefined()
  })

  it('an employer matter takes the colour only when ALL its employees share it', () => {
    expect(mixedMatterTone({ pipelineStageSummary: employees('PWD under process', 'PWD under process') })).toBe('orange')
    expect(mixedMatterTone({ pipelineStageSummary: employees('Submitted', 'Status - Approved') })).toBe('blue')
    expect(mixedMatterTone({ pipelineStageSummary: employees('PWD under process', 'Case Onboarded') })).toBeNull()
    expect(mixedMatterTone({ pipelineStageSummary: employees('PWD under process', 'Submitted') })).toBeNull()
    expect(mixedMatterTone({ pipelineStageSummary: employees('On Hold', 'On Hold') })).toBeNull() // unchanged: a matter on hold throughout stays white
    expect(allEmployeesFiled({ pipelineStageSummary: employees('Submitted', 'Feedback') })).toBe(true)
    expect(rowToneStyle({ pipelineStageKey: 'x', pipelineStageSummary: employees('PWD under process', 'PWD under process') })).toEqual({ backgroundColor: 'rgba(var(--tone-orange-rgb), 0.09)' })
    expect(rowToneStyle({ pipelineStageSummary: employees('PWD under process', 'Case Onboarded') })).toBeUndefined()
  })

  it('a completed case keeps its own look (the logo colour in the dark theme, the stage tint in the day theme)', () => {
    const style = rowToneStyle({ status: 'completed', pipelineStageKey: 'pwd_under_process' })
    expect(style['--stage-bg']).toBe('rgba(var(--tone-orange-rgb), 0.09)')
    expect(style.backgroundColor).toBe('var(--completed-row-bg, var(--stage-bg))')
  })
})

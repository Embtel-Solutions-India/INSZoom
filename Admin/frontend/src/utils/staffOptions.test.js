import { describe, expect, it } from 'vitest'
import { sortStaff, staffOption } from './staffOptions'

describe('staff pickers (New case, Assign Staff, Edit Staff)', () => {
  it('lists case managers A-Z, then team leads, admins, super admins - each A-Z', () => {
    const list = [
      { _id: '1', name: 'Zed', role: 'team_lead' }, { _id: '2', name: 'Bob', role: 'case_manager' }, { _id: '3', name: 'Amy', role: 'admin' },
      { _id: '4', name: 'Ann', role: 'case_manager' }, { _id: '5', name: 'Al', role: 'team_lead' }, { _id: '6', name: 'Sue', role: 'super_admin' },
    ]
    expect(sortStaff(list).map((p) => p.name)).toEqual(['Ann', 'Bob', 'Al', 'Zed', 'Amy', 'Sue'])
  })

  it('gives everyone who is not a case manager a grey role label', () => {
    expect(staffOption({ _id: '1', name: 'Bob', role: 'case_manager' })).toEqual({ value: '1', label: 'Bob' })
    expect(staffOption({ _id: '2', name: 'Al', role: 'team_lead' }).tag).toBe('Team Lead')
    expect(staffOption({ _id: '3', name: 'Amy', role: 'admin' }).tag).toBe('Admin')
    expect(staffOption({ _id: '4', email: 'sue@x.test', role: 'super_admin' })).toEqual({ value: '4', label: 'sue@x.test', tag: 'Super Admin' })
  })
})

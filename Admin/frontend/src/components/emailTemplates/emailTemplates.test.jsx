import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

vi.mock('../../services/api', () => ({
  emailTemplatesApi: {
    preview: vi.fn(async (payload) => ({ data: { data: { from: 'Immiglance', to: ['john.smith@example.com'], cc: [], bcc: [], subject: payload.subject, html: '<p>preview</p>', validation: { unknown: [], unavailable: [] } } } })),
    defaults: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    activate: vi.fn(),
    deactivate: vi.fn(),
    duplicate: vi.fn(),
    archive: vi.fn(),
    sendTest: vi.fn(),
  },
}))

import TemplateLibrary from './TemplateLibrary'
import TemplateEditor from './TemplateEditor'

const shell = (heading) => `<html><title>{{@TITLE}}</title><body>${heading ? '<h1>{{@HEADING}}</h1>' : ''}<div>{{@BODY}}</div></body></html>`
const meta = {
  previewShells: { tokens: { title: '{{@TITLE}}', heading: '{{@HEADING}}', body: '{{@BODY}}' }, withHeading: shell(true), withoutHeading: shell(false) },
  fromName: 'Immiglance',
  variableGroups: ['Client', 'Case', 'Attorney', 'System'],
  variables: [
    { key: 'client.name', group: 'Client', label: 'Client name', sample: 'John Smith' },
    { key: 'case.id', group: 'Case', label: 'Case ID', sample: 'CASE-10234' },
    { key: 'client.email', group: 'Client', label: 'Client email', sample: 'john.smith@example.com', email: true },
    { key: 'attorney.name', group: 'Attorney', label: 'Attorney name', sample: 'David Miller' },
    { key: 'system.firm_name', group: 'System', label: 'Firm name', sample: 'Immiglance' },
  ],
  triggers: [
    { key: 'rfe-received', label: 'RFE Received', category: 'RFE', recipient: 'client', groups: ['Client', 'Case', 'Attorney'], locked: false, description: 'RFE' },
    { key: 'consultation-confirmation', label: 'Consultation Confirmed', category: 'Consultation', recipient: 'client', groups: ['Client'], locked: false, description: 'c' },
  ],
  categories: ['Case', 'RFE', 'Consultation'],
  recipientTypes: [{ type: 'client', label: 'Client' }, { type: 'attorney', label: 'Attorney' }, { type: 'custom', label: 'Custom' }],
}

const blank = { id: null, name: 'RFE Notice', description: '', category: 'RFE', subject: 'Hello [client.name]', heading: '', body: '<p>Hi</p>', triggerKey: 'rfe-received', recipients: { to: [], cc: [], bcc: [] }, status: 'draft' }

const rows = [
  { id: null, kind: 'default', name: 'RFE Received', category: 'RFE', status: 'default', triggerKey: 'rfe-received', triggerLabel: 'RFE Received', recipient: 'client', locked: false },
  { id: 'a', kind: 'custom', name: 'My Case Approved', category: 'Case Status', status: 'active', triggerKey: 'case-approved', triggerLabel: 'Case Approved', recipient: 'client', locked: false, updatedAt: '2026-10-01' },
  { id: 'b', kind: 'custom', name: 'Old Draft', category: 'Case', status: 'archived', triggerKey: null, locked: false },
  { id: null, kind: 'default', name: 'Password Reset', category: 'Account', status: 'default', triggerKey: 'password-reset', triggerLabel: 'Password Reset', recipient: 'client', locked: true },
]

describe('TemplateLibrary', () => {
  it('hides archived by default, filters by search, and opens only unlocked rows', () => {
    const onOpen = vi.fn()
    render(<TemplateLibrary rows={rows} meta={{ ...meta, categories: ['Case', 'RFE'] }} onOpen={onOpen} onCreate={() => {}} />)
    expect(screen.queryByText('Old Draft')).toBeNull()
    expect(screen.getByText('My Case Approved')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('table')).getAllByText('RFE Received')[0])
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ triggerKey: 'rfe-received' }))
    fireEvent.click(within(screen.getByRole('table')).getAllByText('Password Reset')[0])
    expect(onOpen).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByPlaceholderText('Search templates…'), { target: { value: 'approved' } })
    expect(within(screen.getByRole('table')).queryAllByText('RFE Received')).toHaveLength(0)
  })

  it('has a Create New Template button', () => {
    const onCreate = vi.fn()
    render(<TemplateLibrary rows={rows} meta={meta} onOpen={() => {}} onCreate={onCreate} />)
    fireEvent.click(screen.getByText('Create New Template'))
    expect(onCreate).toHaveBeenCalled()
  })
})

describe('TemplateEditor', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows editor and live preview side by side, with back navigation and no library', async () => {
    render(<TemplateEditor initial={blank} meta={meta} onBack={() => {}} />)
    expect(screen.getByText('Back to Templates')).toBeTruthy()
    expect(screen.getByText('Live preview')).toBeTruthy()
    expect(screen.queryByText('Create New Template')).toBeNull()
    expect(screen.getByTitle('Email preview')).toBeTruthy()
  })

  it('updates the preview instantly as you type, filling variables with sample data', () => {
    render(<TemplateEditor initial={blank} meta={meta} onBack={() => {}} />)
    const frame = () => screen.getByTitle('Email preview').getAttribute('srcdoc')
    fireEvent.change(screen.getByLabelText('Heading'), { target: { value: 'Dear [client.name], case [case.id]' } })
    expect(frame()).toContain('Dear John Smith, case CASE-10234')
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'New [case.id] subject' } })
    expect(screen.getByText('New CASE-10234 subject')).toBeTruthy()
    // the stored value keeps the variable
    expect(screen.getByLabelText('Subject').value).toBe('New [case.id] subject')
  })

  it('lets you fill recipients with an email variable and shows it resolved in the preview', () => {
    render(<TemplateEditor initial={blank} meta={meta} onBack={() => {}} />)
    const input = screen.getAllByPlaceholderText(/Type an email/)[0]
    fireEvent.change(input, { target: { value: '[cl' } })
    fireEvent.mouseDown(screen.getByText('Client email'))
    expect(screen.getByText('[client.email]')).toBeTruthy()
    expect(screen.getByText('john.smith@example.com')).toBeTruthy()
  })

  it('flags unsaved changes and misspelled variables, and blocks saving them', async () => {
    render(<TemplateEditor initial={blank} meta={meta} onBack={() => {}} />)
    expect(screen.queryByText('Unsaved changes')).toBeNull()
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Hi [client.nmae]' } })
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/Unknown variable/)
    fireEvent.click(screen.getByText('Save draft'))
    expect(await screen.findByText('Fix the highlighted variables before saving')).toBeTruthy()
  })

  it('flags variables the chosen trigger cannot supply', () => {
    render(<TemplateEditor initial={{ ...blank, triggerKey: 'consultation-confirmation', subject: 'Hi [attorney.name]' }} meta={meta} onBack={() => {}} />)
    expect(screen.getByRole('alert').textContent).toMatch(/Not available for this trigger/)
  })

  it('inserts a picked variable at the caret in the subject', () => {
    render(<TemplateEditor initial={{ ...blank, subject: 'Case ' }} meta={meta} onBack={() => {}} />)
    const subject = screen.getByLabelText('Subject')
    fireEvent.focus(subject)
    subject.setSelectionRange(5, 5)
    fireEvent.click(screen.getByText('Insert variable'))
    fireEvent.mouseDown(screen.getByText('Case ID'))
    expect(subject.value).toBe('Case [case.id]')
  })

  it('typing [ in the subject suggests variables; Enter completes the highlighted one', () => {
    render(<TemplateEditor initial={{ ...blank, subject: '' }} meta={meta} onBack={() => {}} />)
    const subject = screen.getByLabelText('Subject')
    subject.focus()
    fireEvent.change(subject, { target: { value: 'Hi [cl', selectionStart: 6, selectionEnd: 6 } })
    const list = screen.getByRole('listbox')
    expect(within(list).getByText('Client name')).toBeTruthy()
    expect(within(list).queryByText('Case ID')).toBeNull()
    fireEvent.keyDown(subject, { key: 'Enter' })
    expect(subject.value).toBe('Hi [client.name]')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('does not suggest variables the trigger cannot supply', () => {
    render(<TemplateEditor initial={{ ...blank, triggerKey: 'consultation-confirmation', subject: '' }} meta={meta} onBack={() => {}} />)
    const subject = screen.getByLabelText('Subject')
    fireEvent.change(subject, { target: { value: '[att', selectionStart: 4, selectionEnd: 4 } })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('only offers variables the trigger can supply in Insert variable', () => {
    render(<TemplateEditor initial={{ ...blank, triggerKey: 'consultation-confirmation', subject: '' }} meta={meta} onBack={() => {}} />)
    fireEvent.click(screen.getByText('Insert variable'))
    expect(screen.getByText('Client name')).toBeTruthy()
    expect(screen.queryByText('Attorney name')).toBeNull()
    expect(screen.getByText('Firm name')).toBeTruthy()
  })
})

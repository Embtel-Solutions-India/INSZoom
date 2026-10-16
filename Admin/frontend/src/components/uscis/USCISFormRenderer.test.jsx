import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { useEffect } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

// react-pdf needs a real PDF.js worker/canvas, neither of which exist in
// jsdom - these tests only care about what USCISFormRenderer decides to put
// on screen around the PDF, not react-pdf's own rendering, so Document/Page
// are replaced with trivial stand-ins. onLoadSuccess fires from an effect
// (mirrors react-pdf's own post-render callback timing) rather than during
// render, so React doesn't warn about a cross-component setState-in-render.
vi.mock('react-pdf', () => ({
  Document: ({ children, onLoadSuccess }) => {
    useEffect(() => {
      onLoadSuccess?.({ numPages: 1, annotationStorage: { setValue: vi.fn() }, getFieldObjects: async () => ({}) })
    }, [onLoadSuccess])
    return <div data-testid="pdf-document">{children}</div>
  },
  Page: ({ pageNumber, onRenderSuccess, onRenderAnnotationLayerSuccess }) => {
    useEffect(() => {
      onRenderSuccess?.({ pageNumber })
      onRenderAnnotationLayerSuccess?.({ pageNumber })
    }, [onRenderSuccess, onRenderAnnotationLayerSuccess, pageNumber])
    return (
      <div data-testid={`pdf-page-${pageNumber}`}>
        <div className="annotationLayer">
          <input title="First Name" name="beneficiary.firstName" defaultValue="" />
          <input title="Last Name" name="beneficiary.lastName" defaultValue="Smith" maxLength={10} />
          <input title="Comb Field" name="beneficiary.combField" defaultValue="" maxLength={5} className="comb" />
        </div>
      </div>
    )
  },
  pdfjs: { GlobalWorkerOptions: {} },
}))
vi.mock('react-pdf/dist/Page/AnnotationLayer.css', () => ({}))
vi.mock('react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'blob:mock-worker' }))

const workspaceApi = vi.fn()
const templatePdfApi = vi.fn()
const saveWorkspaceFieldApi = vi.fn()
const resolveFieldConflictApi = vi.fn()
const downloadFormApi = vi.fn()
vi.mock('../../services/api', () => ({
  uscisFormsApi: {
    workspace: (...args) => workspaceApi(...args),
    templatePdf: (...args) => templatePdfApi(...args),
    templatePdfViewer: (...args) => templatePdfApi(...args),
    saveWorkspaceField: (...args) => saveWorkspaceFieldApi(...args),
    saveWorkspaceSection: vi.fn().mockResolvedValue({}),
    resolveFieldConflict: (...args) => resolveFieldConflictApi(...args),
  },
  formGenerationApi: {
    downloadForm: (...args) => downloadFormApi(...args),
  },
}))

import USCISFormRenderer from './USCISFormRenderer'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  saveWorkspaceFieldApi.mockResolvedValue({})
  resolveFieldConflictApi.mockResolvedValue({})
  downloadFormApi.mockResolvedValue({ data: new Blob(['%PDF-1.4 mock'], { type: 'application/pdf' }) })
})

function makeWorkspace(overrides = {}) {
  return {
    values: {},
    comments: [],
    template: {
      _id: 'template-1',
      formCode: 'I-129',
      title: 'Petition for a Nonimmigrant Worker',
      version: '2026-02-27',
      sections: [
        {
          key: 'section-1',
          title: 'Part 1',
          fields: [
            {
              fieldName: 'beneficiary.firstName',
              label: 'First Name',
              fieldType: 'text',
              required: true,
              hidden: false,
              coordinates: { x: 50, y: 700, width: 120, height: 20, pageNumber: 1 },
            },
          ],
        },
      ],
      pageDimensions: [{ pageNumber: 1, width: 612, height: 792 }],
    },
    caseForm: { status: 'draft', isLocked: false, fieldValues: {}, validationErrors: { fields: {} } },
    caseSummary: { caseNumber: 'CASE-100', beneficiary: { firstName: 'Jane', lastName: 'Doe' }, petitioner: { legalName: 'Acme Corp' } },
    permissions: { canEdit: true, canApprove: false, canLock: false, canUnlock: false, canReview: false, mode: 'review' },
    ...overrides,
  }
}

const pdfBlob = () => new Blob(['%PDF-1.4 mock'], { type: 'application/pdf' })

// Phase 3 (§I.3/§I.4) - a workspace with exactly one field carrying the given syncState /
// conflictValues, auto-selected on load (USCISFormRenderer selects allFields[0] when nothing else
// is selected yet), so the sidebar's field-detail panel renders without needing a click.
function makeWorkspaceWithField(fieldOverrides = {}) {
  return makeWorkspace({
    values: { 'beneficiary.lastName': 'Smith' },
    template: {
      _id: 'template-1',
      formCode: 'I-129',
      title: 'Petition for a Nonimmigrant Worker',
      version: '2026-02-27',
      sections: [
        {
          key: 'section-1',
          title: 'Part 1',
          fields: [
            {
              fieldName: 'beneficiary.lastName',
              label: 'Last Name',
              fieldType: 'text',
              required: false,
              hidden: false,
              coordinates: { x: 50, y: 700, width: 120, height: 20, pageNumber: 1 },
              ...fieldOverrides,
            },
          ],
        },
      ],
      pageDimensions: [{ pageNumber: 1, width: 612, height: 792 }],
    },
    caseForm: { status: 'draft', isLocked: false, fieldValues: { 'beneficiary.lastName': 'Smith' }, validationErrors: { fields: {} } },
  })
}

describe('USCISFormRenderer', () => {
  it('renders the form header and native PDF field once the workspace and template PDF both load', async () => {
    workspaceApi.mockResolvedValue({ data: makeWorkspace() })
    templatePdfApi.mockResolvedValue({ data: pdfBlob() })

    render(<USCISFormRenderer caseId="case-1" caseForm={{ _id: 'cf-1' }} onClose={vi.fn()} onSaved={vi.fn()} />)

    expect(await screen.findByText(/I-129/)).toBeTruthy()
    expect(screen.getByText(/Petition for a Nonimmigrant Worker/)).toBeTruthy()
    expect(await screen.findByTitle('First Name')).toBeTruthy()
    expect(screen.queryByText(/Unable to load the official USCIS page image/)).toBeFalsy()
  })

  it('still shows the field data (not a blank viewer) when the official PDF page image fails to load', async () => {
    workspaceApi.mockResolvedValue({ data: makeWorkspace() })
    templatePdfApi.mockRejectedValue(new Error('network error'))

    render(<USCISFormRenderer caseId="case-1" caseForm={{ _id: 'cf-1' }} onClose={vi.fn()} onSaved={vi.fn()} />)

    expect(await screen.findByText(/Unable to load the official USCIS page image/)).toBeTruthy()
    // The regression this guards: previously, once templatePdfError was set,
    // the field-overlay branch never rendered either - both branches of the
    // old ternary were false at the same time, so the viewer was empty.
    expect(await screen.findByTitle('First Name')).toBeTruthy()
    expect(screen.queryByTestId('pdf-document')).toBeFalsy()
  })

  it('shows a readable error instead of crashing when the workspace response is missing required data', async () => {
    workspaceApi.mockResolvedValue({ data: { values: {}, template: null, caseForm: null, caseSummary: null, permissions: null } })

    render(<USCISFormRenderer caseId="case-1" caseForm={{ _id: 'cf-1' }} onClose={vi.fn()} onSaved={vi.fn()} />)

    expect(await screen.findByText(/incomplete and can't be displayed/i)).toBeTruthy()
  })

  it('shows a visible error box when the workspace request fails outright', async () => {
    workspaceApi.mockRejectedValue({ response: { data: { message: 'Case form not found' } } })

    render(<USCISFormRenderer caseId="case-1" caseForm={{ _id: 'cf-1' }} onClose={vi.fn()} onSaved={vi.fn()} />)

    expect(await screen.findByText('Case form not found')).toBeTruthy()
  })

  // Phase 3 (§I.3) - sync state badges

  it('renders the amber "Manual" badge when syncState is MANUAL_OVERRIDE, with no conflict panel', async () => {
    workspaceApi.mockResolvedValue({ data: makeWorkspaceWithField({ syncState: 'MANUAL_OVERRIDE' }) })
    templatePdfApi.mockResolvedValue({ data: pdfBlob() })

    render(<USCISFormRenderer caseId="case-1" caseForm={{ _id: 'cf-1' }} onClose={vi.fn()} onSaved={vi.fn()} />)

    expect(await screen.findByText('Manual')).toBeTruthy()
    expect(screen.queryByText('Field Conflict')).toBeFalsy()
    expect(screen.queryByText('Conflict detected')).toBeFalsy()
  })

  it('renders no override badge when syncState is SYNCED', async () => {
    workspaceApi.mockResolvedValue({ data: makeWorkspaceWithField({ syncState: 'SYNCED' }) })
    templatePdfApi.mockResolvedValue({ data: pdfBlob() })

    render(<USCISFormRenderer caseId="case-1" caseForm={{ _id: 'cf-1' }} onClose={vi.fn()} onSaved={vi.fn()} />)

    expect(await screen.findByTitle('Last Name')).toBeTruthy()
    expect(screen.queryByText('Manual')).toBeFalsy()
    expect(screen.queryByText('Field Conflict')).toBeFalsy()
  })

  it('backwards-compat: renders "Manual" for a pre-Phase-2 field with manualOverride set but no syncState at all', async () => {
    workspaceApi.mockResolvedValue({ data: makeWorkspaceWithField({ syncState: undefined, manualOverride: { value: 'Smith' } }) })
    templatePdfApi.mockResolvedValue({ data: pdfBlob() })

    render(<USCISFormRenderer caseId="case-1" caseForm={{ _id: 'cf-1' }} onClose={vi.fn()} onSaved={vi.fn()} />)

    expect(await screen.findByText('Manual')).toBeTruthy()
  })

  // Phase 3 (§I.4) - conflict resolution actions

  // Explicit Save (no autosave) + save reliability
  it('does not save on blur - the edit stays a local draft until Save is pressed', async () => {
    workspaceApi.mockResolvedValue({ data: makeWorkspaceWithField({ syncState: 'SYNCED' }) })
    templatePdfApi.mockResolvedValue({ data: pdfBlob() })

    render(<USCISFormRenderer caseId="case-1" caseForm={{ _id: 'cf-1' }} onClose={vi.fn()} onSaved={vi.fn()} />)
    const input = await screen.findByTitle('Last Name')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Johnson' } })
    fireEvent.blur(input)

    expect(await screen.findByText('1 unsaved')).toBeTruthy()
    expect(saveWorkspaceFieldApi).not.toHaveBeenCalled()
  })

  it('the Save button is disabled until there is an unsaved change, then saves it', async () => {
    workspaceApi.mockResolvedValue({ data: makeWorkspaceWithField({ syncState: 'SYNCED' }) })
    templatePdfApi.mockResolvedValue({ data: pdfBlob() })

    render(<USCISFormRenderer caseId="case-1" caseForm={{ _id: 'cf-1' }} onClose={vi.fn()} onSaved={vi.fn()} />)
    const input = await screen.findByTitle('Last Name')
    const saveButton = screen.getByRole('button', { name: /^Save$/ })
    expect(saveButton.disabled).toBe(true)

    fireEvent.change(input, { target: { value: 'Johnson' } })
    await vi.waitFor(() => expect(saveButton.disabled).toBe(false))
    fireEvent.click(saveButton)

    await vi.waitFor(() => expect(saveWorkspaceFieldApi).toHaveBeenCalledTimes(1))
    expect(saveWorkspaceFieldApi.mock.calls[0][2]).toMatchObject({ fieldName: 'beneficiary.lastName', value: 'Johnson' })
    expect(await screen.findByText(/Other case managers, team leads and admins can now see your changes/)).toBeTruthy()
  })

  it('retries a failed save with backoff and eventually shows "Saved ✓"', async () => {
    workspaceApi.mockResolvedValue({ data: makeWorkspaceWithField({ syncState: 'SYNCED' }) })
    templatePdfApi.mockResolvedValue({ data: pdfBlob() })
    saveWorkspaceFieldApi
      .mockRejectedValueOnce(new Error('network error'))
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({})

    render(<USCISFormRenderer caseId="case-1" caseForm={{ _id: 'cf-1' }} onClose={vi.fn()} onSaved={vi.fn()} />)
    const input = await screen.findByTitle('Last Name')
    fireEvent.change(input, { target: { value: 'Johnson' } })
    const saveButton = screen.getByRole('button', { name: /^Save$/ })
    await vi.waitFor(() => expect(saveButton.disabled).toBe(false))
    fireEvent.click(saveButton)

    // 500ms + 1000ms of backoff between the 3 attempts - well under vitest's default 5000ms test
    // timeout, but over findBy*'s default 1000ms wait, hence the explicit timeout below.
    expect(await screen.findByText('Saved ✓', {}, { timeout: 4000 })).toBeTruthy()
    expect(saveWorkspaceFieldApi).toHaveBeenCalledTimes(3)
  })

  // Typing smoothness: a stored value must never be written back over the box being typed in
  it('never overwrites the focused box with a stored value while the case manager is typing or deleting', async () => {
    workspaceApi.mockResolvedValue({ data: makeWorkspaceWithField({ syncState: 'SYNCED' }) })
    templatePdfApi.mockResolvedValue({ data: pdfBlob() })

    render(<USCISFormRenderer caseId="case-1" caseForm={{ _id: 'cf-1' }} onClose={vi.fn()} onSaved={vi.fn()} />)
    const input = await screen.findByTitle('Last Name')
    input.focus()
    fireEvent.change(input, { target: { value: 'Johnson' } })
    // A character typed (or deleted) that React state has not caught up with yet:
    input.value = 'Johnsonxyz'
    await new Promise((resolve) => setTimeout(resolve, 500)) // past the state-commit delay -> re-sync runs

    expect(input.value).toBe('Johnsonxyz')
  })

  it('a deleted value stays deleted and is saved as an empty value on Save', async () => {
    workspaceApi.mockResolvedValue({ data: makeWorkspaceWithField({ syncState: 'SYNCED' }) })
    templatePdfApi.mockResolvedValue({ data: pdfBlob() })

    render(<USCISFormRenderer caseId="case-1" caseForm={{ _id: 'cf-1' }} onClose={vi.fn()} onSaved={vi.fn()} />)
    const input = await screen.findByTitle('Last Name')
    input.focus()
    fireEvent.change(input, { target: { value: '' } })
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(input.value).toBe('')

    const saveButton = screen.getByRole('button', { name: /^Save$/ })
    await vi.waitFor(() => expect(saveButton.disabled).toBe(false))
    fireEvent.click(saveButton)
    await vi.waitFor(() => expect(saveWorkspaceFieldApi).toHaveBeenCalledTimes(1))
    expect(saveWorkspaceFieldApi.mock.calls[0][2]).toMatchObject({ fieldName: 'beneficiary.lastName', value: '' })
  })

  it('does not retry a save the server rejected outright (4xx) and shows the server message', async () => {
    workspaceApi.mockResolvedValue({ data: makeWorkspaceWithField({ syncState: 'SYNCED' }) })
    templatePdfApi.mockResolvedValue({ data: pdfBlob() })
    saveWorkspaceFieldApi.mockRejectedValue({ response: { status: 400, data: { message: 'Unknown USCIS form field' } } })

    render(<USCISFormRenderer caseId="case-1" caseForm={{ _id: 'cf-1' }} onClose={vi.fn()} onSaved={vi.fn()} />)
    const input = await screen.findByTitle('Last Name')
    fireEvent.change(input, { target: { value: 'Johnson' } })
    const saveButton = screen.getByRole('button', { name: /^Save$/ })
    await vi.waitFor(() => expect(saveButton.disabled).toBe(false))
    fireEvent.click(saveButton)

    expect(await screen.findByText('Unknown USCIS form field')).toBeTruthy()
    expect(saveWorkspaceFieldApi).toHaveBeenCalledTimes(1)
  })

  it('an edit made while a save is in flight stays unsaved (and is not reloaded over)', async () => {
    workspaceApi.mockResolvedValue({ data: makeWorkspaceWithField({ syncState: 'SYNCED' }) })
    templatePdfApi.mockResolvedValue({ data: pdfBlob() })
    let finishSave
    saveWorkspaceFieldApi.mockImplementation(() => new Promise((resolve) => { finishSave = () => resolve({}) }))

    render(<USCISFormRenderer caseId="case-1" caseForm={{ _id: 'cf-1' }} onClose={vi.fn()} onSaved={vi.fn()} />)
    const input = await screen.findByTitle('Last Name')
    fireEvent.change(input, { target: { value: 'Johnson' } })
    const saveButton = screen.getByRole('button', { name: /^Save$/ })
    await vi.waitFor(() => expect(saveButton.disabled).toBe(false))
    fireEvent.click(saveButton)
    await vi.waitFor(() => expect(saveWorkspaceFieldApi).toHaveBeenCalledTimes(1))

    fireEvent.change(input, { target: { value: 'Johnsonville' } }) // typed while the request is in flight
    finishSave()

    expect(await screen.findByText('1 unsaved')).toBeTruthy()
    expect(input.value).toBe('Johnsonville')
    expect(workspaceApi).toHaveBeenCalledTimes(1) // no reload over the newer edit
  })

  it('the before-unload guard warns when there is an unsaved change', async () => {
    workspaceApi.mockResolvedValue({ data: makeWorkspaceWithField({ syncState: 'SYNCED' }) })
    templatePdfApi.mockResolvedValue({ data: pdfBlob() })

    render(<USCISFormRenderer caseId="case-1" caseForm={{ _id: 'cf-1' }} onClose={vi.fn()} onSaved={vi.fn()} />)
    const input = await screen.findByTitle('Last Name')
    fireEvent.change(input, { target: { value: 'Johnson' } })
    await screen.findByText('1 unsaved')

    const event = new Event('beforeunload', { cancelable: true })
    Object.defineProperty(event, 'returnValue', { writable: true, value: '' })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  // Character limits
  it('removes the PDF maxlength from free-text inputs but keeps it on comb fields', async () => {
    workspaceApi.mockResolvedValue({ data: makeWorkspaceWithField({ syncState: 'SYNCED' }) })
    templatePdfApi.mockResolvedValue({ data: pdfBlob() })

    render(<USCISFormRenderer caseId="case-1" caseForm={{ _id: 'cf-1' }} onClose={vi.fn()} onSaved={vi.fn()} />)
    const input = await screen.findByTitle('Last Name')

    await vi.waitFor(() => expect(input.hasAttribute('maxlength')).toBe(false))
    expect(screen.getByTitle('Comb Field').getAttribute('maxlength')).toBe('5')
  })

  // Forms Download overhaul - single "Download Official Form" button, no status gate
  it('renders "Download Official Form" when the form status is draft (no gate)', async () => {
    workspaceApi.mockResolvedValue({ data: makeWorkspace() }) // default caseForm.status is 'draft'
    templatePdfApi.mockResolvedValue({ data: pdfBlob() })

    render(<USCISFormRenderer caseId="case-1" caseForm={{ _id: 'cf-1' }} onClose={vi.fn()} onSaved={vi.fn()} />)

    expect(await screen.findByText('Download Official Form')).toBeTruthy()
    expect(screen.queryByText(/Save & Download Fillable PDF/i)).toBeFalsy()
    expect(screen.queryByText('Download filing copy')).toBeFalsy()
  })

  it('renders "Download Official Form" when the form is locked (no gate either direction)', async () => {
    workspaceApi.mockResolvedValue({ data: makeWorkspace({ caseForm: { status: 'locked', isLocked: true, fieldValues: {}, validationErrors: { fields: {} } } }) })
    templatePdfApi.mockResolvedValue({ data: pdfBlob() })

    render(<USCISFormRenderer caseId="case-1" caseForm={{ _id: 'cf-1' }} onClose={vi.fn()} onSaved={vi.fn()} />)

    expect(await screen.findByText('Download Official Form')).toBeTruthy()
  })

  it('clicking "Download Official Form" calls formGenerationApi.downloadForm with the caseForm id', async () => {
    workspaceApi.mockResolvedValue({ data: makeWorkspace({ caseForm: { status: 'locked', isLocked: true, fieldValues: {}, validationErrors: { fields: {} } } }) })
    templatePdfApi.mockResolvedValue({ data: pdfBlob() })

    render(<USCISFormRenderer caseId="case-1" caseForm={{ _id: 'cf-1' }} onClose={vi.fn()} onSaved={vi.fn()} />)
    const button = await screen.findByText('Download Official Form')
    fireEvent.click(button)

    await vi.waitFor(() => expect(downloadFormApi).toHaveBeenCalledTimes(1))
    expect(downloadFormApi).toHaveBeenCalledWith('cf-1')
  })
})

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
    useEffect(() => { onLoadSuccess?.({ numPages: 1, annotationStorage: { setValue: vi.fn() } }) }, [onLoadSuccess])
    return <div data-testid="pdf-document">{children}</div>
  },
  Page: ({ pageNumber, onRenderSuccess }) => {
    useEffect(() => { onRenderSuccess?.({ pageNumber }) }, [onRenderSuccess, pageNumber])
    return (
      <div data-testid={`pdf-page-${pageNumber}`}>
        <div className="annotationLayer">
          <input title="First Name" name="beneficiary.firstName" defaultValue="" />
          <input title="Last Name" name="beneficiary.lastName" defaultValue="Smith" />
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
  it('renders the red "Field Conflict" badge and the conflict-resolution panel with both values when syncState is CONFLICT', async () => {
    workspaceApi.mockResolvedValue({ data: makeWorkspaceWithField({ syncState: 'CONFLICT', conflictValues: { canonicalValue: 'Johnson', manualValue: 'Smith' } }) })
    templatePdfApi.mockResolvedValue({ data: pdfBlob() })

    render(<USCISFormRenderer caseId="case-1" caseForm={{ _id: 'cf-1' }} onClose={vi.fn()} onSaved={vi.fn()} />)

    expect(await screen.findByText('Field Conflict')).toBeTruthy()
    const panel = (await screen.findByText('Conflict detected')).closest('div')
    expect(panel.textContent).toContain('Johnson')
    expect(panel.textContent).toContain('Smith')
    expect(screen.getByText('Use canonical value')).toBeTruthy()
    expect(screen.getByText('Keep my edit')).toBeTruthy()
  })

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
  it('clicking "Use canonical value" calls resolveFieldConflict with direction "canonical" and refreshes the workspace', async () => {
    workspaceApi.mockResolvedValue({ data: makeWorkspaceWithField({ syncState: 'CONFLICT', conflictValues: { canonicalValue: 'Johnson', manualValue: 'Smith' } }) })
    templatePdfApi.mockResolvedValue({ data: pdfBlob() })

    render(<USCISFormRenderer caseId="case-1" caseForm={{ _id: 'cf-1' }} onClose={vi.fn()} onSaved={vi.fn()} />)
    const button = await screen.findByText('Use canonical value')
    fireEvent.click(button)

    await vi.waitFor(() => expect(resolveFieldConflictApi).toHaveBeenCalledTimes(1))
    expect(resolveFieldConflictApi.mock.calls[0][2]).toMatchObject({ fieldName: 'beneficiary.lastName', direction: 'canonical' })
    await vi.waitFor(() => expect(workspaceApi).toHaveBeenCalledTimes(2), { timeout: 3000 })
  })

  it('clicking "Keep my edit" calls resolveFieldConflict with direction "manual"', async () => {
    workspaceApi.mockResolvedValue({ data: makeWorkspaceWithField({ syncState: 'CONFLICT', conflictValues: { canonicalValue: 'Johnson', manualValue: 'Smith' } }) })
    templatePdfApi.mockResolvedValue({ data: pdfBlob() })

    render(<USCISFormRenderer caseId="case-1" caseForm={{ _id: 'cf-1' }} onClose={vi.fn()} onSaved={vi.fn()} />)
    const button = await screen.findByText('Keep my edit')
    fireEvent.click(button)

    await vi.waitFor(() => expect(resolveFieldConflictApi).toHaveBeenCalledTimes(1))
    expect(resolveFieldConflictApi.mock.calls[0][2]).toMatchObject({ fieldName: 'beneficiary.lastName', direction: 'manual' })
  })

  // Phase 3 (§I.5) - autosave reliability
  it('retries a failed save with backoff and eventually shows "Saved ✓"', async () => {
    workspaceApi.mockResolvedValue({ data: makeWorkspaceWithField({ syncState: 'SYNCED' }) })
    templatePdfApi.mockResolvedValue({ data: pdfBlob() })
    saveWorkspaceFieldApi
      .mockRejectedValueOnce(new Error('network error'))
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({})

    render(<USCISFormRenderer caseId="case-1" caseForm={{ _id: 'cf-1' }} onClose={vi.fn()} onSaved={vi.fn()} />)
    const input = await screen.findByTitle('Last Name')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Johnson' } })
    fireEvent.blur(input)

    // 500ms + 1000ms of backoff between the 3 attempts - well under vitest's default 5000ms test
    // timeout, but over findBy*'s default 1000ms wait, hence the explicit timeout below.
    expect(await screen.findByText('Saved ✓', {}, { timeout: 4000 })).toBeTruthy()
    expect(saveWorkspaceFieldApi).toHaveBeenCalledTimes(3)
  })

  it('the before-unload guard warns when there is an unsaved change in flight', async () => {
    workspaceApi.mockResolvedValue({ data: makeWorkspaceWithField({ syncState: 'SYNCED' }) })
    templatePdfApi.mockResolvedValue({ data: pdfBlob() })
    saveWorkspaceFieldApi.mockImplementation(() => new Promise(() => {})) // never resolves - save stays in flight

    render(<USCISFormRenderer caseId="case-1" caseForm={{ _id: 'cf-1' }} onClose={vi.fn()} onSaved={vi.fn()} />)
    const input = await screen.findByTitle('Last Name')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Johnson' } })
    fireEvent.blur(input)
    await vi.waitFor(() => expect(saveWorkspaceFieldApi).toHaveBeenCalledTimes(1))

    const event = new Event('beforeunload', { cancelable: true })
    Object.defineProperty(event, 'returnValue', { writable: true, value: '' })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
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

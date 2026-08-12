import { describe, expect, it, vi, afterEach } from 'vitest'
import { useEffect } from 'react'
import { render, screen, cleanup } from '@testing-library/react'

// react-pdf needs a real PDF.js worker/canvas, neither of which exist in
// jsdom - these tests only care about what USCISFormRenderer decides to put
// on screen around the PDF, not react-pdf's own rendering, so Document/Page
// are replaced with trivial stand-ins. onLoadSuccess fires from an effect
// (mirrors react-pdf's own post-render callback timing) rather than during
// render, so React doesn't warn about a cross-component setState-in-render.
vi.mock('react-pdf', () => ({
  Document: ({ children, onLoadSuccess }) => {
    useEffect(() => { onLoadSuccess?.({ numPages: 1 }) }, [onLoadSuccess])
    return <div data-testid="pdf-document">{children}</div>
  },
  Page: ({ pageNumber }) => <div data-testid={`pdf-page-${pageNumber}`} />,
  pdfjs: { GlobalWorkerOptions: {} },
}))
vi.mock('react-pdf/dist/Page/AnnotationLayer.css', () => ({}))
vi.mock('react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'blob:mock-worker' }))

const workspaceApi = vi.fn()
const templatePdfApi = vi.fn()
vi.mock('../../services/api', () => ({
  uscisFormsApi: {
    workspace: (...args) => workspaceApi(...args),
    templatePdf: (...args) => templatePdfApi(...args),
    saveWorkspaceField: vi.fn().mockResolvedValue({}),
    saveWorkspaceSection: vi.fn().mockResolvedValue({}),
  },
  formGenerationApi: {},
}))

import USCISFormRenderer from './USCISFormRenderer'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
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

describe('USCISFormRenderer', () => {
  it('renders the form header and field overlay once the workspace and template PDF both load', async () => {
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
})

// USCISNativeFormPOC.jsx
// POC ONLY - not imported by any production route/page/component. Answers one
// question (see docs/forms/PHASE_POC_REPORT.md): with the REAL normalized
// USCIS I-129 PDF loaded in react-pdf 10.4.1 (nested pdfjs-dist 5.4.296),
// renderAnnotationLayer={true} + renderForms={true}, do the PDF's own
// AcroForm widgets become interactive and fire reliable change events
// carrying the raw PDF field name + correct value?
//
// Reached only via poc.html / src/poc/pocMain.jsx (a separate Vite entry -
// see those files). Never wired into App.jsx or any existing route.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
// Same nested-copy requirement as USCISFormRenderer.jsx (see that file's
// comment above its own workerSrc assignment): react-pdf 10.4.1 bundles its
// OWN pdfjs-dist (5.4.296), which does not API-match this project's
// top-level pdfjs-dist (^6.2.108). Must be set in this module (the one
// rendering <Document>/<Page>), not imported from elsewhere.
import pdfWorkerUrl from 'react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs?url'
import api, { uscisFormsApi } from '../../services/api'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const TEST_DEFS = [
  { id: 1, label: 'Text field', hint: 'Any pdfFieldType "text" widget, e.g. beneficiary last name.' },
  { id: 2, label: 'Date-like text field', hint: 'A widget whose semanticType is "date" - still a plain text widget in the PDF.' },
  { id: 3, label: 'Checkbox', hint: 'A pdfFieldType "checkbox" widget - capture checked AND the export value.' },
  { id: 4, label: 'Radio group', hint: 'A pdfFieldType "radio" widget group - capture the shared group field name AND the selected export value.' },
  { id: 5, label: 'Dropdown / select', hint: 'A pdfFieldType "dropdown"/"choice" widget, if the I-129 has one.' },
  { id: 6, label: 'Repeated field (2 occurrences)', hint: 'Same canonical source appearing on two different widgets - enter different values in each.' },
  { id: 7, label: 'Clear a value', hint: 'Enter a value into a text field, then clear it back to empty string.' },
]

async function sha256Hex(arrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function fmtTime() {
  return new Date().toISOString().split('T')[1].replace('Z', '')
}

// Every path §I.3 lists for recovering the raw PDF field name from a DOM
// event, run in parallel so the live table shows which one actually works
// for THIS pdfjs build/PDF, rather than assuming one in advance.
function extractFieldNameCandidates(target) {
  const candidates = {}
  candidates['target.name'] = target?.name || null
  candidates['target.id'] = target?.id || null
  candidates['target.dataset.annotationId'] = target?.getAttribute?.('data-annotation-id') || null
  let node = target
  let depth = 0
  let parentAnnotationId = null
  let parentDataFieldName = null
  while (node && depth < 6) {
    if (!parentAnnotationId) parentAnnotationId = node.getAttribute?.('data-annotation-id') || null
    if (!parentDataFieldName) parentDataFieldName = node.getAttribute?.('data-field-name') || null
    node = node.parentElement
    depth += 1
  }
  candidates['ancestor.data-annotation-id'] = parentAnnotationId
  candidates['ancestor.data-field-name'] = parentDataFieldName
  return candidates
}

function DiagnosticEventCapture({ configLabel, containerRef, pdfDocumentRef, knownFieldNames, onCapture }) {
  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    const handle = async (domEvent) => {
      const target = domEvent.target
      if (!target || !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)) return
      const candidates = extractFieldNameCandidates(target)
      let annotationStorageSnapshot = null
      try {
        const pdfDocument = pdfDocumentRef.current
        if (pdfDocument?.annotationStorage) {
          const all = pdfDocument.annotationStorage.getAll()
          annotationStorageSnapshot = all ? JSON.parse(JSON.stringify(all)) : null
        }
      } catch (error) {
        annotationStorageSnapshot = { error: String(error?.message || error) }
      }
      const bestGuessFieldName = Object.values(candidates).find((v) => v) || null
      onCapture({
        ts: fmtTime(),
        config: configLabel,
        domEventType: domEvent.type,
        tagName: target.tagName,
        inputType: target.type || null,
        value: target.value ?? null,
        checked: target.type === 'checkbox' || target.type === 'radio' ? target.checked : null,
        candidates,
        bestGuessFieldName,
        matchesKnownFieldName: bestGuessFieldName ? knownFieldNames.has(bestGuessFieldName) : false,
        annotationStorageSnapshot,
      })
    }

    container.addEventListener('input', handle, true)
    container.addEventListener('change', handle, true)
    return () => {
      container.removeEventListener('input', handle, true)
      container.removeEventListener('change', handle, true)
    }
  }, [configLabel, containerRef, pdfDocumentRef, knownFieldNames, onCapture])

  return null
}

export default function USCISNativeFormPOC({ templateId }) {
  const [pdfIdentity, setPdfIdentity] = useState(null)
  const [pdfUrl, setPdfUrl] = useState(null)
  const [knownFieldNames, setKnownFieldNames] = useState(() => new Set())
  const [loadError, setLoadError] = useState('')
  const [testPageNumber, setTestPageNumber] = useState(1)
  const [pageWidgetSummary, setPageWidgetSummary] = useState(null)
  const [capturedEvents, setCapturedEvents] = useState([])
  const [diagnosticLog, setDiagnosticLog] = useState([])
  const [domObservation, setDomObservation] = useState({ A: null, B: null })
  const [testResults, setTestResults] = useState(() =>
    Object.fromEntries(TEST_DEFS.map((t) => [t.id, { status: 'PENDING', evidenceIndex: null }]))
  )

  const pdfDocumentRef = useRef(null)
  const containerARef = useRef(null)
  const containerBRef = useRef(null)

  const log = useCallback((message) => {
    setDiagnosticLog((prev) => [...prev, `[${fmtTime()}] ${message}`])
  }, [])

  useEffect(() => {
    if (!templateId) return undefined
    let cancelled = false
    let objectUrl = null

    async function run() {
      try {
        log(`Fetching template record ${templateId} for field-name ground truth (G5).`)
        const templateResponse = await api.get(`/uscis-forms/${templateId}`)
        const template = templateResponse.data?.data || templateResponse.data
        const fieldNames = new Set((template?.formFields || []).map((f) => f.fieldName).filter(Boolean))
        if (cancelled) return
        setKnownFieldNames(fieldNames)
        log(`Template has ${fieldNames.size} known formFields[].fieldName entries.`)

        log('Fetching real stored PDF via uscisFormsApi.templatePdf (blob).')
        const pdfResponse = await uscisFormsApi.templatePdf(templateId)
        const arrayBuffer = await pdfResponse.data.arrayBuffer()
        const sha256 = await sha256Hex(arrayBuffer)
        const bytes = new Uint8Array(arrayBuffer)
        const magicBytes = new TextDecoder().decode(bytes.slice(0, 5))
        const asText = new TextDecoder('latin1').decode(bytes)
        const hasXFAMarker = asText.includes('/XFA')
        const hasAcroFormMarker = asText.includes('/AcroForm')

        if (cancelled) return
        objectUrl = URL.createObjectURL(pdfResponse.data)
        setPdfUrl(objectUrl)
        setPdfIdentity({
          formCode: template?.formCode,
          editionDate: template?.editionDate,
          templateId,
          sha256,
          byteLength: bytes.length,
          magicBytes,
          hasXFAMarker,
          hasAcroFormMarker,
          pdfjsVersion: pdfjs.version,
          reactPdfExpectedVersion: '10.4.1',
          userAgent: navigator.userAgent,
        })
        log(`PDF identity recorded. SHA-256=${sha256.slice(0, 16)}... magic=${magicBytes} XFA=${hasXFAMarker} AcroForm=${hasAcroFormMarker}`)
      } catch (error) {
        if (!cancelled) {
          setLoadError(error?.response?.data?.message || error.message || 'Failed to load template/PDF')
          log(`ERROR loading template/PDF: ${error?.response?.data?.message || error.message}`)
        }
      }
    }
    run()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [templateId, log])

  const scanPage = useCallback(async (pageNumber) => {
    const pdfDocument = pdfDocumentRef.current
    if (!pdfDocument) return
    log(`Scanning page ${pageNumber} for AcroForm widget annotations (independent of react-pdf's rendered DOM).`)
    const page = await pdfDocument.getPage(pageNumber)
    const annotations = await page.getAnnotations({ intent: 'display' })
    const widgets = annotations.filter((a) => a.subtype === 'Widget')
    setPageWidgetSummary({
      pageNumber,
      totalAnnotations: annotations.length,
      widgetCount: widgets.length,
      widgets: widgets.map((w) => ({
        fieldName: w.fieldName,
        fieldType: w.fieldType,
        rect: w.rect,
        exportValue: w.exportValue,
        buttonValue: w.buttonValue,
        options: w.options,
        radioButton: w.radioButton,
        checkBox: w.checkBox,
        readOnly: w.readOnly,
      })),
    })
    log(`Page ${pageNumber}: ${widgets.length} widget annotations found (${annotations.length} total annotations).`)
  }, [log])

  const handleDocumentLoadSuccess = useCallback((pdfDocument) => {
    pdfDocumentRef.current = pdfDocument
    log(`Document loaded. numPages=${pdfDocument.numPages}`)
    scanPage(testPageNumber)
  }, [log, scanPage, testPageNumber])

  useEffect(() => {
    if (pdfDocumentRef.current) scanPage(testPageNumber)
  }, [testPageNumber, scanPage])

  const observeDom = useCallback((label, containerRef) => {
    const container = containerRef.current
    if (!container) return
    const layer = container.querySelector('.annotationLayer')
    const elements = layer ? Array.from(layer.querySelectorAll('input, select, textarea, button')) : []
    const tally = {}
    elements.forEach((el) => {
      const key = `${el.tagName.toLowerCase()}${el.type ? `[type=${el.type}]` : ''}`
      tally[key] = (tally[key] || 0) + 1
    })
    setDomObservation((prev) => ({ ...prev, [label]: { hasAnnotationLayerSection: Boolean(layer), elementTally: tally, totalInteractiveElements: elements.length } }))
    log(`Config ${label} DOM observation: annotationLayer present=${Boolean(layer)}, interactive elements=${elements.length}, tally=${JSON.stringify(tally)}`)
  }, [log])

  const handlePageRenderSuccessA = useCallback(() => observeDom('A', containerARef), [observeDom])
  const handlePageRenderSuccessB = useCallback(() => observeDom('B', containerBRef), [observeDom])

  const onCapture = useCallback((entry) => {
    setCapturedEvents((prev) => [...prev, entry])
    log(`Captured ${entry.domEventType} on config ${entry.config}: tag=${entry.tagName} type=${entry.inputType} bestGuessFieldName=${entry.bestGuessFieldName} matchesKnown=${entry.matchesKnownFieldName} value=${JSON.stringify(entry.value)} checked=${entry.checked}`)
  }, [log])

  const recordTestResult = (testId, status) => {
    setTestResults((prev) => ({ ...prev, [testId]: { status, evidenceIndex: capturedEvents.length - 1 } }))
  }

  const copyFindingsJson = async () => {
    const payload = { pdfIdentity, knownFieldNamesCount: knownFieldNames.size, domObservation, pageWidgetSummary, capturedEvents, testResults, diagnosticLog }
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
    log('Findings JSON copied to clipboard.')
  }

  const passCount = useMemo(() => Object.values(testResults).filter((t) => t.status === 'PASS').length, [testResults])

  if (!templateId) return <div className="p-6 text-sm text-red-600">No templateId provided to USCISNativeFormPOC.</div>

  return (
    <div className="min-h-screen bg-slate-100 p-4 text-sm">
      <h1 className="mb-2 text-lg font-bold text-slate-900">USCIS Native AcroForm POC — I-129</h1>
      <p className="mb-4 max-w-3xl text-slate-600">
        Testing whether react-pdf 10.4.1 (pdfjs-dist {pdfjs.version}) renders the real I-129's own AcroForm
        widgets as interactive, event-firing DOM elements with <code>renderAnnotationLayer=true</code>. Config A
        uses <code>renderForms=true</code>; Config B uses <code>renderForms=false</code>. Interact with the
        widgets below and watch the captured-events table.
      </p>

      {loadError && <div className="mb-4 rounded border border-red-400 bg-red-50 p-3 text-red-700">{loadError}</div>}

      <section className="mb-4 rounded border border-slate-300 bg-white p-3">
        <h2 className="mb-1 font-semibold">PDF Identity</h2>
        {pdfIdentity ? (
          <pre className="overflow-x-auto text-xs">{JSON.stringify(pdfIdentity, null, 2)}</pre>
        ) : (
          <p className="text-slate-500">Loading…</p>
        )}
      </section>

      <section className="mb-4 flex items-center gap-3 rounded border border-slate-300 bg-white p-3">
        <label className="font-semibold">Test page number:</label>
        <input
          type="number"
          min={1}
          value={testPageNumber}
          onChange={(e) => setTestPageNumber(Number(e.target.value) || 1)}
          className="w-20 rounded border border-slate-300 px-2 py-1"
        />
        {pageWidgetSummary && (
          <span className="text-slate-600">
            Page {pageWidgetSummary.pageNumber}: {pageWidgetSummary.widgetCount} widget annotations
            (types: {[...new Set(pageWidgetSummary.widgets.map((w) => w.fieldType))].join(', ') || 'none'})
          </span>
        )}
      </section>

      {pageWidgetSummary && (
        <section className="mb-4 rounded border border-slate-300 bg-white p-3">
          <h2 className="mb-1 font-semibold">Widget annotations on this page (independent pdfjs.getAnnotations() scan)</h2>
          <div className="max-h-48 overflow-y-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left"><th>fieldName</th><th>fieldType</th><th>exportValue</th><th>options</th></tr></thead>
              <tbody>
                {pageWidgetSummary.widgets.map((w, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="pr-2">{w.fieldName}</td>
                    <td className="pr-2">{w.fieldType}</td>
                    <td className="pr-2">{JSON.stringify(w.exportValue ?? w.buttonValue)}</td>
                    <td>{w.options ? JSON.stringify(w.options) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {pdfUrl && (
        <Document file={pdfUrl} onLoadSuccess={handleDocumentLoadSuccess} loading="Loading PDF…" error="Failed to load PDF">
          <div className="mb-4 grid grid-cols-2 gap-4">
            <div>
              <h3 className="mb-1 font-semibold">Config A — renderForms=true</h3>
              <div ref={containerARef} className="relative overflow-auto border border-slate-400 bg-white" style={{ maxHeight: 700 }}>
                <Page
                  pageNumber={testPageNumber}
                  width={560}
                  renderAnnotationLayer
                  renderForms
                  renderTextLayer={false}
                  onRenderSuccess={handlePageRenderSuccessA}
                />
                <DiagnosticEventCapture configLabel="A" containerRef={containerARef} pdfDocumentRef={pdfDocumentRef} knownFieldNames={knownFieldNames} onCapture={onCapture} />
              </div>
              {domObservation.A && <pre className="mt-1 text-xs text-slate-600">{JSON.stringify(domObservation.A, null, 2)}</pre>}
            </div>
            <div>
              <h3 className="mb-1 font-semibold">Config B — renderForms=false</h3>
              <div ref={containerBRef} className="relative overflow-auto border border-slate-400 bg-white" style={{ maxHeight: 700 }}>
                <Page
                  pageNumber={testPageNumber}
                  width={560}
                  renderAnnotationLayer
                  renderForms={false}
                  renderTextLayer={false}
                  onRenderSuccess={handlePageRenderSuccessB}
                />
                <DiagnosticEventCapture configLabel="B" containerRef={containerBRef} pdfDocumentRef={pdfDocumentRef} knownFieldNames={knownFieldNames} onCapture={onCapture} />
              </div>
              {domObservation.B && <pre className="mt-1 text-xs text-slate-600">{JSON.stringify(domObservation.B, null, 2)}</pre>}
            </div>
          </div>
        </Document>
      )}

      <section className="mb-4 rounded border border-slate-300 bg-white p-3">
        <h2 className="mb-2 font-semibold">Seven field-type tests ({passCount}/{TEST_DEFS.length} marked PASS)</h2>
        <table className="w-full text-xs">
          <thead><tr className="text-left"><th>#</th><th>Field type</th><th>Hint</th><th>Status</th><th>Mark</th></tr></thead>
          <tbody>
            {TEST_DEFS.map((t) => (
              <tr key={t.id} className="border-t border-slate-100">
                <td>{t.id}</td>
                <td>{t.label}</td>
                <td className="text-slate-500">{t.hint}</td>
                <td className="font-semibold">{testResults[t.id].status}</td>
                <td className="space-x-1">
                  <button className="rounded bg-emerald-600 px-2 py-0.5 text-white" onClick={() => recordTestResult(t.id, 'PASS')}>PASS</button>
                  <button className="rounded bg-red-600 px-2 py-0.5 text-white" onClick={() => recordTestResult(t.id, 'FAIL')}>FAIL</button>
                  <button className="rounded bg-slate-500 px-2 py-0.5 text-white" onClick={() => recordTestResult(t.id, 'N/A')}>N/A</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-slate-500">
          Marking a test snapshots the index of the most recently captured event as its evidence — interact with the
          relevant widget above, THEN click PASS/FAIL/N-A for that test.
        </p>
      </section>

      <section className="mb-4 rounded border border-slate-300 bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Captured events ({capturedEvents.length})</h2>
          <button className="rounded bg-blue-600 px-3 py-1 text-white" onClick={copyFindingsJson}>Copy findings JSON</button>
        </div>
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left"><th>ts</th><th>cfg</th><th>event</th><th>tag</th><th>value</th><th>checked</th><th>bestGuessFieldName</th><th>matchesKnown</th></tr></thead>
            <tbody>
              {capturedEvents.map((e, i) => (
                <tr key={i} className={`border-t border-slate-100 ${e.matchesKnownFieldName ? 'bg-emerald-50' : ''}`}>
                  <td>{e.ts}</td><td>{e.config}</td><td>{e.domEventType}</td><td>{e.tagName}[{e.inputType}]</td>
                  <td>{JSON.stringify(e.value)}</td><td>{String(e.checked)}</td>
                  <td>{e.bestGuessFieldName}</td><td>{String(e.matchesKnownFieldName)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded border border-slate-300 bg-white p-3">
        <h2 className="mb-2 font-semibold">Diagnostic log</h2>
        <pre className="max-h-64 overflow-y-auto text-xs">{diagnosticLog.join('\n')}</pre>
      </section>
    </div>
  )
}

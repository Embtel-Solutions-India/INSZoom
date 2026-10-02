import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
// Vite's `?url` import (not `new URL(spec, import.meta.url)` - that form
// mis-resolves this specific nested `pkg/node_modules/pkg2/...` path to a
// root-relative `/node_modules/...` URL that the dev server 404s on;
// confirmed empirically) correctly resolves react-pdf's OWN bundled
// pdfjs-dist worker file - see the workerSrc assignment below for why it
// has to be THIS exact copy, not the project's top-level pdfjs-dist.
import pdfWorkerUrl from 'react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Download,
  FileCheck2,
  FileText,
  History,
  Link2,
  Lock,
  MessageSquare,
  Minus,
  PanelRight,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SkipForward,
  SplitSquareHorizontal,
  Unlock,
  UserCheck,
  XCircle,
} from 'lucide-react'
import { formGenerationApi, uscisFormsApi, readFormWarnings } from '../../services/api'
import { convert as convertPdfFieldChange, extractFieldName, buildWidgetIndex, prePopulateById } from '../../utils/PDFFieldChangeAdapter'
import { buildPageSlots, pageMismatch } from './viewerPageSlots'

// Must be set in the SAME module that renders <Document>/<Page> (react-pdf's
// own README warning - module execution order can otherwise silently
// overwrite it), same pattern PdfDocumentPages.jsx already established for
// petition exhibit rendering.
// react-pdf@10 bundles its OWN pdfjs-dist (5.4.296 - see
// react-pdf/node_modules/pdfjs-dist), which this project's top-level
// pdfjs-dist dependency (^6.2.108, a DIFFERENT major version, used
// elsewhere e.g. server-side PDF field scanning) does not match - pointing
// the worker at the top-level package throws "API version does not match
// Worker version" and the page never renders (confirmed empirically).
// Referencing react-pdf's own nested copy keeps the API and worker on the
// exact same build. PdfDocumentPages.jsx (petition exhibit rendering)
// predates this project's pdfjs-dist major-version bump and has the same
// latent mismatch - out of scope for this task to fix, but worth the same
// treatment if it starts erroring too.
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// The rendered page's on-screen width, in CSS px - field overlays are
// positioned by converting each field's real x/y/width/height (PDF points,
// bottom-left origin - see PDFFieldScannerService's coordinateSystem) into
// this same pixel space via one scale factor per page (PAGE_RENDER_WIDTH /
// the real PDF page width in points).
const PAGE_RENDER_WIDTH = 900
const MIN_PAGE_RENDER_WIDTH = 612

// Phase 3 (§I.5) - autosave retry backoff. 3 retries after the first attempt (500ms, 1s, 2s),
// matching the delays the task spec calls for. A field stays in dirtyFieldsRef until it actually
// succeeds - a failed/retrying save is never quietly dropped, and the existing before-unload guard
// (dirtyFieldsRef.current.size, further down this file) already covers both states for free.
const AUTOSAVE_RETRY_DELAYS_MS = [500, 1000, 2000]
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const getByPath = (source, path) => {
  if (!source || !path) return undefined
  const nested = String(path).split('.').reduce((current, part) => (current == null ? undefined : current[part]), source)
  return nested !== undefined ? nested : source[path]
}

const setByPath = (source, path, value) => {
  const next = structuredClone(source || {})
  // AcroForm field names (e.g. "form1[0].#subform[0].Line1_FamilyName[0]")
  // contain "[" and are FLAT keys in the values store, never nested paths -
  // splitting one on "." (below) destroys it. Set directly and return before
  // any of that logic runs.
  if (String(path).includes('[')) {
    next[path] = value
    return next
  }
  // Genuine dotted canonical paths (e.g. "applicant.lastName"): remove any
  // stale flat key with the same literal name before creating the nested entry.
  if (String(path).includes('.') && Object.prototype.hasOwnProperty.call(next, path)) delete next[path]
  const parts = String(path).split('.')
  let cursor = next
  parts.slice(0, -1).forEach((part) => {
    cursor[part] = cursor[part] && typeof cursor[part] === 'object' ? cursor[part] : {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
  return next
}

const hasValue = (value) => value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0)
const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const labelize = (value) => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase())
const escapeSelector = (value) => {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return String(value).replace(/["\\]/g, '\\$&')
}

const displayValue = (value) => {
  if (value === undefined || value === null || value === '') return 'Not provided'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const statusTone = {
  approved: 'bg-primary-100 text-primary border-primary-200',
  verified: 'bg-primary-100 text-primary border-primary-200',
  ready_for_pdf: 'bg-primary-100 text-primary border-primary-200',
  complete: 'bg-primary-100 text-primary border-primary-200',
  rejected: 'bg-red-100 text-red-800 border-red-200',
  needs_review: 'bg-amber-100 text-amber-800 border-amber-200',
  needs_revision: 'bg-amber-100 text-amber-800 border-amber-200',
  review: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  locked: 'bg-slate-200 text-slate-800 border-slate-300',
  auto_filled: 'bg-primary-100 text-primary border-primary-200',
  manual_override: 'bg-violet-100 text-violet-800 border-violet-200',
}

function StatusBadge({ status, children }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusTone[status] || 'border-slate-200 bg-slate-100 text-slate-700'}`}>
      {children || labelize(status || 'not started')}
    </span>
  )
}

function FieldInput({ field, value, disabled, invalid, onChange, onBlur, onCommit }) {
  const common = `w-full rounded-md border bg-card px-3 py-2 text-sm text-slate-900 outline-none transition focus:ring-2 ${invalid ? 'border-red-400 focus:border-red-500 focus:ring-red-100' : 'border-slate-300 focus:border-primary focus:ring-primary-100'} disabled:bg-slate-50 disabled:text-slate-500`
  const options = field.options || []
  const isDisabled = disabled || field.readOnly || field.readonly
  const handleKeyDown = (event) => {
    if (isDisabled) return
    if (event.key === 'Enter' && field.fieldType !== 'textarea') {
      event.preventDefault()
      onCommit?.()
    }
    if (event.key === 'Tab') onCommit?.()
  }
  if (field.hidden) return null
  if (field.fieldType === 'signature' || field.semanticType === 'signature') {
    return (
      <div className="rounded-md border border-dashed border-slate-400 bg-slate-50 px-3 py-4 text-sm text-slate-500">
        Signature field reserved for final USCIS package execution
      </div>
    )
  }
  if (field.fieldType === 'textarea') {
    return <textarea rows={4} className={common} value={value ?? ''} placeholder={field.placeholder || ''} disabled={isDisabled} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onCommit?.() } if (event.key === 'Tab') onCommit?.() }} />
  }
  if (field.fieldType === 'select' || field.fieldType === 'dropdown') {
    return (
      <select className={common} value={value ?? ''} disabled={isDisabled} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} onKeyDown={handleKeyDown}>
        <option value="">Select an option</option>
        {options.map((option) => {
          const optionValue = option.value ?? option.exportValue ?? option
          return <option key={String(optionValue)} value={optionValue}>{option.label || optionValue}</option>
        })}
      </select>
    )
  }
  if (field.fieldType === 'radio') {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const optionValue = option.value ?? option.exportValue ?? option
          return (
            <label key={String(optionValue)} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${value === optionValue ? 'border-primary bg-primary-50' : 'border-slate-200 bg-card'}`}>
              <input type="radio" checked={value === optionValue} disabled={isDisabled} onChange={() => onChange(optionValue)} onBlur={onBlur} onKeyDown={handleKeyDown} />
              {option.label || optionValue}
            </label>
          )
        })}
      </div>
    )
  }
  if (field.fieldType === 'checkbox') {
    return (
      <label className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm ${value ? 'border-primary bg-primary-50' : 'border-slate-200 bg-card'}`}>
        <input type="checkbox" checked={Boolean(value)} disabled={isDisabled} onChange={(event) => onChange(event.target.checked)} onBlur={onBlur} onKeyDown={handleKeyDown} />
        Selected
      </label>
    )
  }
  if (field.fieldType === 'multiselect') {
    const selected = Array.isArray(value) ? value : []
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const optionValue = option.value ?? option.exportValue ?? option
          return (
            <label key={String(optionValue)} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${selected.includes(optionValue) ? 'border-primary bg-primary-50' : 'border-slate-200 bg-card'}`}>
              <input
                type="checkbox"
                checked={selected.includes(optionValue)}
                disabled={isDisabled}
                onChange={(event) => onChange(event.target.checked ? [...selected, optionValue] : selected.filter((item) => item !== optionValue))}
                onBlur={onBlur}
                onKeyDown={handleKeyDown}
              />
              {option.label || optionValue}
            </label>
          )
        })}
      </div>
    )
  }
  if (field.fieldType === 'address') {
    const address = value && typeof value === 'object' ? value : {}
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {['addressLine1', 'addressLine2', 'city', 'state', 'zipCode', 'country'].map((key) => (
          <input
            key={key}
            className={common}
            value={address[key] || ''}
            placeholder={labelize(key)}
            disabled={isDisabled}
            onChange={(event) => onChange({ ...address, [key]: event.target.value })}
            onBlur={onBlur}
            onKeyDown={handleKeyDown}
          />
        ))}
      </div>
    )
  }
  if (field.fieldType === 'table' || field.fieldType === 'repeatable_group') {
    const rows = Array.isArray(value) ? value : []
    const columns = field.repeatableConfig?.fields || field.columns || [{ fieldId: 'value', label: 'Value' }]
    const updateRow = (rowIndex, key, nextValue) => onChange(rows.map((row, index) => index === rowIndex ? { ...row, [key]: nextValue } : row))
    return (
      <div className="space-y-3">
        {rows.map((row, rowIndex) => (
          <div key={`${field.fieldName}-${rowIndex}`} className="rounded-md border border-slate-300 bg-slate-50 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {columns.map((column) => {
                const key = column.fieldId || column.fieldName || column.key
                return <input key={key} className={common} value={row[key] || ''} placeholder={column.label || labelize(key)} disabled={isDisabled} onChange={(event) => updateRow(rowIndex, key, event.target.value)} onBlur={onBlur} onKeyDown={handleKeyDown} />
              })}
            </div>
            {!isDisabled && <button type="button" className="mt-2 text-xs font-semibold text-red-600" onClick={() => onChange(rows.filter((_, index) => index !== rowIndex))}>Remove entry</button>}
          </div>
        ))}
        {!isDisabled && <button type="button" className="rounded-md border border-slate-300 bg-card px-3 py-2 text-sm font-semibold text-slate-700" onClick={() => onChange([...rows, {}])}>Add entry</button>}
      </div>
    )
  }
  const inputType = field.fieldType === 'number' || field.fieldType === 'currency' ? 'number' : field.fieldType === 'date' ? 'date' : field.fieldType === 'email' ? 'email' : field.fieldType === 'phone' ? 'tel' : 'text'
  return <input type={inputType} className={common} value={value ?? ''} placeholder={field.placeholder || ''} disabled={isDisabled} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} onKeyDown={handleKeyDown} />
}

// Filled / empty / flagged - reusing the SAME statusTone palette the rest of
// this file already uses for review-status badges, rather than a second
// color system: flagged fields borrow 'rejected'/'needs_revision', filled
// fields borrow 'auto_filled'/'manual_override', and "nothing entered yet"
// deliberately has no entry in statusTone (StatusBadge's own fallback for an
// unrecognized key - 'border-slate-200 bg-slate-100 text-slate-700' - IS the
// neutral/empty look, not a new palette).
// Phase 3 (§I.3): prefers the explicit Phase-2 sync state (field.syncState -
// SyncStateService's SYNCED/MANUAL_OVERRIDE/CONFLICT, surfaced by
// buildFieldView) over the older manualOverride/conflicts-derived tone below,
// without dropping either existing check. field.conflicts (canonical-merge
// candidate conflicts, a DIFFERENT, older concept - see the sidebar's two
// separate badges lower in this file) and syncState === 'CONFLICT' (Phase
// 2/3's per-field sync conflict) can both be true independently, so both are
// still checked; either alone still yields the same red 'needs_revision'
// overlay tone, since only one tone can render per field box.
function fieldFillTone(field, value, errors) {
  if (errors?.length) return 'rejected'
  if (field.syncState === 'CONFLICT' || field.conflicts?.length) return 'needs_revision'
  if (!hasValue(value)) return null
  if (field.syncState === 'MANUAL_OVERRIDE') return 'manual_override'
  if (field.syncState === 'SYNCED') return 'auto_filled'
  return field.manualOverride ? 'manual_override' : 'auto_filled'
}

const OVERLAY_BORDER_TONE = {
  rejected: 'border-red-500 bg-red-50/70',
  needs_revision: 'border-amber-500 bg-amber-50/70',
  auto_filled: 'border-primary-400 bg-primary-50',
  manual_override: 'border-violet-500 bg-violet-50/70',
}

function overlayCompactValue(field, value) {
  if (field.fieldType === 'checkbox') return hasValue(value) && value !== false ? '✓' : ''
  if (field.fieldType === 'signature') return ''
  if (!hasValue(value)) return ''
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  const option = (field.options || []).find((item) => (item.value ?? item.exportValue ?? item) === value)
  return String(option?.label ?? value)
}

// One field's real-position overlay on top of the rasterized page image.
// `scale` converts PDF points -> CSS px for this page's current render
// width; `pageHeightPt` flips the PDF's bottom-left-origin y into the
// page's top-left CSS origin. Clicking an unselected, editable overlay opens
// it for inline edit (renders the real FieldInput, positioned over the same
// spot, expanded to a usable minimum size) - exactly the existing FieldInput
// component, just placed by coordinates instead of flat-list order.
function FieldOverlay({ field, value, errors, scale, pageHeightPt, canEdit, editing, selected, onSelect, onStartEdit, onChange, onBlur, onCommit }) {
  const coords = field.coordinates || field.position
  if (!coords || coords.width == null || coords.height == null) return null
  const left = (coords.x || 0) * scale
  const top = (pageHeightPt - (coords.y || 0) - coords.height) * scale
  const width = Math.max(coords.width * scale, 14)
  const height = Math.max(coords.height * scale, 12)
  const tone = fieldFillTone(field, value, errors)
  const boxClass = tone
    ? OVERLAY_BORDER_TONE[tone]
    : field.required
      ? 'border-slate-400 border-dashed bg-card/40'
      : 'border-slate-300 border-dashed bg-card/30'

  if (editing) {
    const popoverWidth = Math.max(width, 240)
    return (
      <div
        id={`uscis-field-${field.fieldName}`}
        className="absolute z-30 rounded-md border-2 border-primary bg-card p-2 shadow-xl"
        style={{ left, top, minWidth: popoverWidth, maxWidth: 360 }}
      >
        <p className="mb-1 truncate text-[10px] font-bold text-slate-500">{field.label || field.fieldLabel}</p>
        <FieldInput field={field} value={value} disabled={!canEdit} invalid={errors?.length > 0} onChange={onChange} onBlur={onBlur} onCommit={onCommit} />
      </div>
    )
  }

  return (
    <button
      type="button"
      id={`uscis-field-${field.fieldName}`}
      title={field.syncState === 'CONFLICT' && field.conflictValues
        ? `${field.label || field.fieldLabel} — Conflict: canonical "${displayValue(field.conflictValues.canonicalValue)}" vs your edit "${displayValue(field.conflictValues.manualValue)}"`
        : field.label || field.fieldLabel}
      onClick={async () => {
        const selectedOk = await onSelect()
        if (selectedOk !== false && canEdit) onStartEdit()
      }}
      className={`absolute flex items-center overflow-hidden rounded-[2px] border px-1 text-left text-[11px] leading-none text-slate-800 transition hover:z-20 hover:border-primary hover:ring-2 hover:ring-primary-200 ${boxClass} ${selected ? 'z-10 ring-2 ring-primary-400' : ''}`}
      style={{ left, top, width, height }}
    >
      <span className="truncate">{overlayCompactValue(field, value)}</span>
    </button>
  )
}

const fieldSourceTone = (field, value, hasError, sessionEdited) => {
  if (hasError) return 'error'
  if (sessionEdited) return 'session'
  if (field?.syncState === 'CONFLICT') return 'conflict'
  if (field?.syncState === 'MANUAL_OVERRIDE' || field?.manualOverride) return 'override'
  if (field?.syncState === 'SYNCED' || hasValue(value)) return 'canonical'
  return ''
}

const applyNativeFieldValue = (element, value) => {
  const nextValue = value == null ? '' : value
  const type = String(element.type || '').toLowerCase()
  if (type === 'checkbox' || type === 'radio') {
    const exportValue = element.value && element.value !== 'on' ? element.value : element.getAttribute?.('data-export-value')
    element.checked = Boolean(nextValue) && (exportValue ? String(nextValue) === String(exportValue) : true)
    return
  }
  element.value = Array.isArray(nextValue) ? nextValue.join(', ') : String(nextValue)
}

const applyNativeFieldStateStyles = (root, { fieldsByName, values, validationErrors, sessionEditedFields, fieldSaveStatus, canEdit }) => {
  if (!root) return
  root.querySelectorAll('input, textarea, select').forEach((element) => {
    const fieldName = extractFieldName({ target: element })
    if (!fieldName) return
    const field = fieldsByName.get(fieldName)
    const value = getByPath(values, fieldName)
    const status = fieldSaveStatus[fieldName]
    const tone = status === 'error'
      ? 'error'
      : status === 'saving'
        ? 'saving'
        : fieldSourceTone(field, value, Boolean(validationErrors[fieldName]?.length), sessionEditedFields.has(fieldName))

    element.dataset.fieldName = fieldName
    element.classList.remove('native-field-canonical', 'native-field-override', 'native-field-session', 'native-field-conflict', 'native-field-error', 'native-field-saving', 'native-field-unmapped')
    if (!field) element.classList.add('native-field-unmapped')
    if (tone) element.classList.add(`native-field-${tone}`)
    element.disabled = !canEdit || Boolean(field?.readOnly || field?.readonly)
    applyNativeFieldValue(element, value)
  })
}

// One rasterized USCIS page (the real blank template PDF, via react-pdf)
// with every in-scope field's overlay positioned on top of it at its real
// coordinates - this IS the "legit form" look Task 2 asks for, replacing
// the flat per-field list this component used to render exclusively.
function PdfFormPage({ pdfPageNumber, displayPageNumber, pdfPageWidth, pdfPageHeight, renderWidth, fields, fieldsByName, values, validationErrors, canEdit, selectedFieldName, onSelectField, onNativeFieldInput, onNativeFieldCommit, registerPageRef, showBackground = true, sessionEditedFields, fieldSaveStatus }) {
  const scale = pdfPageWidth ? renderWidth / pdfPageWidth : 1
  const renderHeight = pdfPageHeight ? pdfPageHeight * scale : undefined
  const pageRef = useRef(null)

  const syncNativeFields = useCallback(() => {
    applyNativeFieldStateStyles(pageRef.current, { fieldsByName, values, validationErrors, sessionEditedFields, fieldSaveStatus, canEdit })
  }, [canEdit, fieldSaveStatus, fieldsByName, sessionEditedFields, validationErrors, values])

  useEffect(() => {
    syncNativeFields()
  }, [syncNativeFields])

  useEffect(() => {
    const node = pageRef.current
    if (!node || !showBackground) return undefined

    const handleFocus = (event) => {
      const fieldName = extractFieldName(event)
      const field = fieldsByName.get(fieldName)
      if (field) onSelectField(field)
    }
    const handleInput = (event) => onNativeFieldInput(event)
    const handleChange = (event) => {
      onNativeFieldInput(event)
      const targetType = String(event.target?.type || '').toLowerCase()
      if (targetType === 'checkbox' || targetType === 'radio' || event.target?.tagName === 'SELECT') onNativeFieldCommit(event)
    }
    const handleBlur = (event) => onNativeFieldCommit(event)

    node.addEventListener('focusin', handleFocus, true)
    node.addEventListener('input', handleInput, true)
    node.addEventListener('change', handleChange, true)
    node.addEventListener('blur', handleBlur, true)
    return () => {
      node.removeEventListener('focusin', handleFocus, true)
      node.removeEventListener('input', handleInput, true)
      node.removeEventListener('change', handleChange, true)
      node.removeEventListener('blur', handleBlur, true)
    }
  }, [fieldsByName, onNativeFieldCommit, onNativeFieldInput, onSelectField, showBackground])
  return (
    <div
      id={`uscis-page-${displayPageNumber}`}
      ref={(node) => {
        pageRef.current = node
        registerPageRef(displayPageNumber, node)
      }}
      className="pdf-native-page relative mx-auto mb-6 bg-card shadow-md"
      style={{ width: renderWidth, minHeight: renderHeight }}
    >
      <style>{`
        .pdf-native-page .annotationLayer input,
        .pdf-native-page .annotationLayer textarea,
        .pdf-native-page .annotationLayer select {
          border-radius: 2px;
          outline-offset: 1px;
          transition: background-color 120ms ease, outline-color 120ms ease;
        }
        .pdf-native-page .annotationLayer .native-field-canonical { background-color: rgba(37, 99, 235, 0.10) !important; outline: 1px solid rgba(37, 99, 235, 0.65); }
        .pdf-native-page .annotationLayer .native-field-override { background-color: rgba(245, 158, 11, 0.15) !important; outline: 1px solid rgba(217, 119, 6, 0.80); }
        .pdf-native-page .annotationLayer .native-field-session { background-color: rgba(16, 185, 129, 0.13) !important; outline: 2px solid rgba(5, 150, 105, 0.82); }
        .pdf-native-page .annotationLayer .native-field-conflict { background-color: rgba(251, 191, 36, 0.18) !important; outline: 2px solid rgba(217, 119, 6, 0.85); }
        .pdf-native-page .annotationLayer .native-field-saving { background-color: rgba(59, 130, 246, 0.16) !important; outline: 2px dashed rgba(37, 99, 235, 0.85); }
        .pdf-native-page .annotationLayer .native-field-error { background-color: rgba(254, 226, 226, 0.78) !important; outline: 2px solid rgba(220, 38, 38, 0.9); }
        .pdf-native-page .annotationLayer .native-field-unmapped { outline: 1px dashed rgba(100, 116, 139, 0.55); }
      `}</style>
      {showBackground ? (
        <Page
          pageNumber={pdfPageNumber}
          width={renderWidth}
          renderAnnotationLayer
          renderForms
          renderTextLayer={false}
          onRenderSuccess={syncNativeFields}
          // RC4: onRenderSuccess fires when the CANVAS finishes, not when the
          // annotation-layer DOM (the actual <input>/<select> elements)
          // exists yet - re-syncing here too is what makes an autofilled
          // value (and its styling) reliably visible immediately, including
          // after a zoom change re-renders just the annotation layer.
          onRenderAnnotationLayerSuccess={syncNativeFields}
          loading={<div className="flex h-[600px] items-center justify-center text-sm text-slate-400">Rendering page {displayPageNumber}…</div>}
          error={<div className="flex h-[300px] items-center justify-center text-sm font-semibold text-red-600">Unable to render page {displayPageNumber}.</div>}
        />
      ) : (
        <div style={{ width: renderWidth, height: renderHeight }} />
      )}
      {!showBackground && <div className="absolute inset-0">
        {fields.map((field) => (
          <FieldOverlay
            key={field.fieldName}
            field={field}
            value={getByPath(values, field.fieldName)}
            errors={validationErrors[field.fieldName]}
            scale={scale}
            pageHeightPt={pdfPageHeight}
            canEdit={canEdit}
            editing={false}
            selected={selectedFieldName === field.fieldName}
            onSelect={() => onSelectField(field)}
            onStartEdit={() => {}}
            onChange={() => {}}
            onBlur={() => {}}
            onCommit={() => {}}
          />
        ))}
      </div>}
    </div>
  )
}

export default function USCISFormRenderer({ caseId, caseForm, onClose, onSaved }) {
  const [loading, setLoading] = useState(true)
  const [workspace, setWorkspace] = useState(null)
  const [values, setValues] = useState({})
  const [activeSection, setActiveSection] = useState('')
  const [selectedFieldName, setSelectedFieldName] = useState('')
  const [search, setSearch] = useState('')
  const [rightTab, setRightTab] = useState('review')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [comment, setComment] = useState('')
  const [decisionReason, setDecisionReason] = useState('')
  const [comparison, setComparison] = useState(false)
  const [undoStack, setUndoStack] = useState([])
  const [redoStack, setRedoStack] = useState([])
  const [editingFieldName, setEditingFieldName] = useState('')
  const [templatePdfUrl, setTemplatePdfUrl] = useState(null)
  const [templatePdfError, setTemplatePdfError] = useState('')
  const [pdfPageCount, setPdfPageCount] = useState(0)
  const [headerPageMap, setHeaderPageMap] = useState(null)
  const [annotationsReady, setAnnotationsReady] = useState(false)
  const widgetIndexRef = useRef(null)
  const [zoomMode, setZoomMode] = useState('fit-width')
  const [zoomScale, setZoomScale] = useState(1)
  const [saveState, setSaveState] = useState('saved')
  const [dirtyCount, setDirtyCount] = useState(0)
  const [fieldSaveStatus, setFieldSaveStatus] = useState({})
  const [sessionEditedFields, setSessionEditedFields] = useState(() => new Set())
  const [viewerSize, setViewerSize] = useState({ width: PAGE_RENDER_WIDTH, height: 680 })
  const lastSaved = useRef({})
  const valuesRef = useRef({})
  const dirtyFieldsRef = useRef(new Set())
  const saveStateTimer = useRef(null)
  const pageRefs = useRef(new Map())
  const viewerRef = useRef(null)
  const pdfDocumentRef = useRef(null)

  const loadWorkspace = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const response = await uscisFormsApi.workspace(caseId, caseForm._id)
      const next = response.data
      setWorkspace(next)
      const nextValues = next.values || next.caseForm?.fieldValues || {}
      setValues(nextValues)
      valuesRef.current = nextValues
      lastSaved.current = structuredClone(nextValues)
      dirtyFieldsRef.current = new Set()
      setDirtyCount(0)
      setFieldSaveStatus({})
      setSessionEditedFields(new Set())
      setSaveState('saved')
      setActiveSection((current) => current || next.template?.sections?.[0]?.key || '')
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error.response?.data?.message || 'Unable to open the interactive USCIS form')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [caseId, caseForm._id])

  useEffect(() => {
    loadWorkspace()
  }, [loadWorkspace])

  useEffect(() => {
    valuesRef.current = values
  }, [values])

  useEffect(() => {
    const node = viewerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry?.contentRect
      if (rect) setViewerSize({ width: rect.width, height: rect.height })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => () => {
    if (saveStateTimer.current) clearTimeout(saveStateTimer.current)
  }, [])

  useEffect(() => {
    const beforeUnload = (event) => {
      if (!dirtyFieldsRef.current.size) return undefined
      event.preventDefault()
      event.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [])

  const sections = workspace?.template?.sections || []
  const allFields = useMemo(() => sections.flatMap((section) => (section.fields || []).filter((field) => !field.hidden).map((field) => ({ ...field, sectionKey: section.key, sectionTitle: section.title }))), [sections])
  const fieldsByName = useMemo(() => new Map(allFields.map((field) => [field.fieldName, field])), [allFields])
  const fieldMetaByName = useMemo(() => Object.fromEntries(allFields.map((field) => [field.fieldName, {
    sectionKey: field.sectionKey,
    occurrenceId: field.occurrenceId,
  }])), [allFields])
  const knownFieldNames = useMemo(() => allFields.map((field) => field.fieldName), [allFields])
  const selectedField = useMemo(() => allFields.find((field) => field.fieldName === selectedFieldName), [allFields, selectedFieldName])
  const validationErrors = workspace?.caseForm?.validationErrors?.fields || workspace?.validationErrors || {}
  const permissions = workspace?.permissions || {}
  const locked = Boolean(workspace?.caseForm?.isLocked || workspace?.caseForm?.status === 'locked' || workspace?.caseForm?.status === 'filed')
  const canEdit = Boolean(permissions.canEdit && !locked)
  const completion = workspace?.caseForm?.completion || workspace?.completion || {}
  const visibleSections = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return sections
    return sections.map((section) => ({
      ...section,
      fields: (section.fields || []).filter((field) => !field.hidden && [field.fieldName, field.fieldId, field.label, field.fieldLabel, field.sourceField].some((value) => String(value || '').toLowerCase().includes(term))),
    })).filter((section) => section.title.toLowerCase().includes(term) || section.fields.length)
  }, [search, sections])

  useEffect(() => {
    if (!selectedFieldName && allFields.length) setSelectedFieldName(allFields[0].fieldName)
  }, [allFields, selectedFieldName])

  // Groups every in-scope field by its real PDF page number (already
  // captured per-field by PDFFieldScannerService, threaded through
  // unchanged) - this IS the "real visual page layout" grouping Task 2
  // needs, replacing the flat per-field list this component used to render
  // as its only view.
  const pageDimensionsByNumber = useMemo(() => {
    const map = new Map()
    ;(workspace?.template?.pageDimensions || []).forEach((page) => map.set(page.pageNumber, page))
    return map
  }, [workspace])

  const fieldsByPage = useMemo(() => {
    const map = new Map()
    allFields.forEach((field) => {
      const pageNumber = field.pageNumber || field.coordinates?.pageNumber || 1
      if (!map.has(pageNumber)) map.set(pageNumber, [])
      map.get(pageNumber).push(field)
    })
    return map
  }, [allFields])

  // Every page the real PDF has gets a row here, whether or not the
  // crosswalk considers it "in scope" - a page with no crosswalk edges
  // still has real, editable AcroForm fields (manual_entry ones) a case
  // manager may need to see, so it still renders visually rather than
  // falling back to a flat list.
  //
  // `pageSlots` (slot = position in the loaded PDF, parentPage = official
  // USCIS page number) replaces the old single `pageNumbers` list, which
  // conflated the two - for a component CaseForm the PDF loaded below is an
  // Adobe-sliced, renumbered-1..N copy, so `pageNumber` alone could not
  // correctly drive both "which slot to render" and "which parent page this
  // is." See viewerPageSlots.js for the full mapping priority.
  const viewerPageConstraint = workspace?.viewerPageConstraint
  const pageSlots = useMemo(() => buildPageSlots({
    viewerPageConstraint,
    headerPageMap,
    pdfPageCount,
    fieldsByPage,
    pageDimensionsByNumber,
  }), [viewerPageConstraint, headerPageMap, pdfPageCount, fieldsByPage, pageDimensionsByNumber])
  const pageNumbers = useMemo(() => pageSlots.map((entry) => entry.parentPage), [pageSlots])
  const pageMismatchMessage = useMemo(
    () => pageMismatch(pageSlots, pdfPageCount, viewerPageConstraint?.expectedPdfPageCount),
    [pageSlots, pdfPageCount, viewerPageConstraint]
  )

  const pageCompletion = useCallback((pageNumber) => {
    const fields = fieldsByPage.get(pageNumber) || []
    const filled = fields.filter((field) => hasValue(getByPath(values, field.fieldName))).length
    return { total: fields.length, filled }
  }, [fieldsByPage, values])

  const templateId = workspace?.template?._id
  // A `component` CaseForm (e.g. I-129's H Classification Supplement) loads
  // its own Adobe-sliced, component-only PDF instead of the full parent -
  // driven by pdfSource (not `type` alone), which is what the backend
  // actually uses to decide which bytes it served (see
  // resolveViewerPageConstraint) - `type` and `pdfSource` agree today, but
  // pdfSource is the field callers should key on for which PDF to load.
  const componentCode = viewerPageConstraint?.pdfSource === 'component' ? workspace?.caseForm?.componentCode : null

  useEffect(() => {
    if (!templateId) return undefined
    let cancelled = false
    let objectUrl = null
    setTemplatePdfError('')
    setTemplatePdfUrl(null)
    setHeaderPageMap(null)
    const request = componentCode
      ? uscisFormsApi.componentTemplatePdf(templateId, componentCode)
      : uscisFormsApi.templatePdfViewer(templateId)
    request
      .then((response) => {
        if (cancelled) return
        const rawHeaderMap = response.headers?.['x-viewer-page-map']
        if (rawHeaderMap) {
          try {
            const parsed = JSON.parse(rawHeaderMap)
            if (Array.isArray(parsed) && parsed.length) setHeaderPageMap(parsed)
          } catch {
            // Malformed header - fall back to viewerPageConstraint.pageMap (buildPageSlots already does this).
          }
        }
        objectUrl = URL.createObjectURL(response.data)
        setTemplatePdfUrl(objectUrl)
      })
      .catch(() => { if (!cancelled) setTemplatePdfError('Unable to load the official USCIS page image for this form - showing field data without the page background.') })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [templateId, componentCode])

  // First-paint values (RC4): pdf.js's annotation storage is keyed by
  // per-widget ANNOTATION ID (e.g. "1234R"), not by field NAME, so a value
  // must be resolved through getFieldObjects() before it can be written
  // anywhere useful. Rendering the actual pages only once this has run (see
  // annotationsReady below, and its reset on templatePdfUrl change) is what
  // makes an autofilled value visible immediately instead of only after the
  // user interacts with that field.
  const handlePdfLoadSuccess = useCallback(async (pdfDocument) => {
    pdfDocumentRef.current = pdfDocument
    setPdfPageCount(pdfDocument.numPages || 0)
    const fieldObjects = await pdfDocument.getFieldObjects?.().catch(() => null)
    widgetIndexRef.current = buildWidgetIndex(fieldObjects || {})
    prePopulateById(pdfDocument.annotationStorage, widgetIndexRef.current, valuesRef.current)
    setAnnotationsReady(true)
  }, [])

  useEffect(() => {
    setAnnotationsReady(false)
  }, [templatePdfUrl])

  useEffect(() => {
    if (!widgetIndexRef.current) return
    prePopulateById(pdfDocumentRef.current?.annotationStorage, widgetIndexRef.current, values)
  }, [values])

  const registerPageRef = useCallback((pageNumber, node) => {
    if (node) pageRefs.current.set(pageNumber, node)
    else pageRefs.current.delete(pageNumber)
  }, [])

  const updateFieldSaveStatus = useCallback((fieldName, status) => {
    setFieldSaveStatus((current) => ({ ...current, [fieldName]: status }))
  }, [])

  const persistAdaptedField = useCallback(async (adapted) => {
    if (!adapted || adapted.error || !canEdit) return false
    const field = fieldsByName.get(adapted.fieldName)
    if (!field) return false
    const value = adapted.value
    const previous = getByPath(lastSaved.current, adapted.fieldName)
    if (sameValue(previous, value)) {
      dirtyFieldsRef.current.delete(adapted.fieldName)
      setDirtyCount(dirtyFieldsRef.current.size)
      return true
    }

    dirtyFieldsRef.current.add(adapted.fieldName)
    setDirtyCount(dirtyFieldsRef.current.size)
    setSaveState('saving')
    updateFieldSaveStatus(adapted.fieldName, 'saving')
    setErrorMessage('')

    const payload = {
      fieldName: adapted.fieldName,
      fieldId: adapted.fieldId,
      sectionKey: adapted.sectionKey || field.sectionKey,
      occurrenceId: adapted.occurrenceId,
      value,
      reason: adapted.reason,
    }

    for (let attempt = 0; attempt <= AUTOSAVE_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        if (attempt > 0) setSaveState('retrying')
        const response = await uscisFormsApi.saveWorkspaceField(caseId, caseForm._id, payload)
        lastSaved.current = setByPath(lastSaved.current, adapted.fieldName, value)
        // Perf fix: the server's response is the full, already-saved CaseForm
        // (interactive-form-review.service.js's saveField -> overrideField),
        // which can carry MORE than just the field we sent - a reverse-sync
        // fan-out can update sibling PDF fields sharing the same canonical
        // source on this same save. Previously the only way to see a sibling
        // update was a full loadWorkspace() reload; merging the response's
        // fieldValues here reflects them immediately without one, for the
        // common case. This is additive only - it never removes a full
        // reload where one is still explicitly requested (see
        // savePendingChanges' own reload option, unchanged).
        const serverForm = response?.data?.form || response?.data?.data
        if (serverForm?.fieldValues && typeof serverForm.fieldValues === 'object') {
          Object.entries(serverForm.fieldValues).forEach(([key, fieldValue]) => {
            if (key === adapted.fieldName) return
            if (sameValue(getByPath(lastSaved.current, key), fieldValue)) return
            lastSaved.current = setByPath(lastSaved.current, key, fieldValue)
            setValues((current) => setByPath(current, key, fieldValue))
          })
        }
        dirtyFieldsRef.current.delete(adapted.fieldName)
        setDirtyCount(dirtyFieldsRef.current.size)
        setFieldSaveStatus((current) => ({ ...current, [adapted.fieldName]: 'saved' }))
        setSessionEditedFields((current) => new Set([...current, adapted.fieldName]))
        setSaveState('saved')
        setNotice('Saved')
        if (saveStateTimer.current) clearTimeout(saveStateTimer.current)
        saveStateTimer.current = setTimeout(() => setSaveState('idle'), 1800)
        onSaved?.()
        return true
      } catch (err) {
        if (attempt === AUTOSAVE_RETRY_DELAYS_MS.length) {
          updateFieldSaveStatus(adapted.fieldName, 'error')
          setSaveState('error')
          setErrorMessage(err.response?.data?.message || 'Unable to save this PDF field. Please try again.')
          throw err
        }
        await wait(AUTOSAVE_RETRY_DELAYS_MS[attempt])
      }
    }
    return false
  }, [canEdit, caseId, caseForm._id, fieldsByName, onSaved, updateFieldSaveStatus])

  const adaptPdfChange = useCallback((event, reason = 'Native PDF field edit') => convertPdfFieldChange(event, caseForm._id, valuesRef.current, {
    fieldMetaByName,
    knownFieldNames,
    reason,
  }), [caseForm._id, fieldMetaByName, knownFieldNames])

  const handleNativeFieldInput = useCallback((event) => {
    const adapted = adaptPdfChange(event)
    if (adapted.error) {
      if (adapted.fieldName) updateFieldSaveStatus(adapted.fieldName, 'error')
      return
    }
    const field = fieldsByName.get(adapted.fieldName)
    if (!field || !canEdit) return
    const previousValue = getByPath(valuesRef.current, field.fieldName)
    if (!sameValue(previousValue, adapted.value)) {
      setUndoStack((current) => [...current.slice(-49), { fieldName: field.fieldName, value: previousValue, sectionKey: field.sectionKey }])
      setRedoStack([])
      dirtyFieldsRef.current.add(field.fieldName)
      setDirtyCount(dirtyFieldsRef.current.size)
      setSaveState('dirty')
      setValues((current) => {
        const next = setByPath(current, field.fieldName, adapted.value)
        valuesRef.current = next
        return next
      })
    }
  }, [adaptPdfChange, canEdit, fieldsByName, updateFieldSaveStatus])

  const handleNativeFieldCommit = useCallback(async (event) => {
    const adapted = adaptPdfChange(event)
    if (adapted.error) {
      if (adapted.fieldName) updateFieldSaveStatus(adapted.fieldName, 'error')
      return
    }
    await persistAdaptedField(adapted)
  }, [adaptPdfChange, persistAdaptedField, updateFieldSaveStatus])

  // Phase 3 (§I.5): retries a single field's save up to AUTOSAVE_RETRY_DELAYS_MS.length times with
  // exponential backoff before giving up. savePendingChanges' own try/catch (below) is unchanged -
  // it still sees exactly one thrown error after all retries are exhausted, and still sets the
  // existing 'error' state (already styled as "Save failed" - see the header badge) for that.
  const saveFieldByName = useCallback(async (fieldName, value, reason = 'Interactive USCIS form review') => {
    const field = allFields.find((item) => item.fieldName === fieldName)
    if (!field || !canEdit) return
    const adapted = convertPdfFieldChange({ fieldName: field.fieldName, fieldType: field.fieldType, value }, caseForm._id, valuesRef.current, {
      fieldMetaByName,
      knownFieldNames,
      reason,
    })
    await persistAdaptedField(adapted)
  }, [allFields, canEdit, caseForm._id, fieldMetaByName, knownFieldNames, persistAdaptedField])

  const savePendingChanges = useCallback(async (reason = 'Auto-save before action', options = {}) => {
    if (!canEdit || !dirtyFieldsRef.current.size) return true
    setSaveState('saving')
    setBusy((current) => current || 'auto-save')
    setErrorMessage('')
    try {
      const fieldNames = [...dirtyFieldsRef.current]
      for (const fieldName of fieldNames) {
        const value = getByPath(valuesRef.current, fieldName)
        const previous = getByPath(lastSaved.current, fieldName)
        if (sameValue(previous, value)) {
          dirtyFieldsRef.current.delete(fieldName)
          setDirtyCount(dirtyFieldsRef.current.size)
          continue
        }
        await saveFieldByName(fieldName, value, reason)
      }
      setSaveState('saved')
      setNotice('Saved')
      if (saveStateTimer.current) clearTimeout(saveStateTimer.current)
      saveStateTimer.current = setTimeout(() => setSaveState('idle'), 1800)
      if (options.reload !== false) await loadWorkspace(true)
      onSaved?.()
      return true
    } catch (error) {
      setSaveState('error')
      setErrorMessage(error.response?.data?.message || 'Unable to save changes. Please try again.')
      return false
    } finally {
      setBusy((current) => current === 'auto-save' ? '' : current)
    }
  }, [canEdit, loadWorkspace, onSaved, saveFieldByName])

  const scrollToPage = useCallback(async (pageNumber) => {
    if (!(await savePendingChanges('Auto-save before page change'))) return
    pageRefs.current.get(pageNumber)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [savePendingChanges])

  const selectField = async (field) => {
    if (editingFieldName && editingFieldName !== field.fieldName) {
      const saved = await savePendingChanges('Auto-save before selecting another field')
      if (!saved) return false
      setEditingFieldName('')
    }
    setSelectedFieldName(field.fieldName)
    setActiveSection(field.sectionKey)
    return true
  }

  const startEditField = (field) => {
    if (!canEdit) return
    setEditingFieldName(field.fieldName)
  }

  const action = async (key, callback, successMessage, reload = true) => {
    setBusy(key)
    setErrorMessage('')
    try {
      await callback()
      setNotice(successMessage)
      if (reload) await loadWorkspace(true)
      onSaved?.()
    } catch (error) {
      setErrorMessage(error.response?.data?.message || error.message || 'The action could not be completed')
    } finally {
      setBusy('')
    }
  }

  // Phase 5 (P2): merges a partial caseForm patch into local state without a
  // GET /workspace round trip - used only by statusAction below.
  const mergeFormState = useCallback((patch) => {
    setWorkspace((prev) => (prev ? { ...prev, caseForm: { ...prev.caseForm, ...patch } } : prev))
  }, [])

  // Approve / reject / request-changes / generate-PDF / lock / unlock only
  // ever change a handful of caseForm status fields - never template fields,
  // page layout, or field values - so a full loadWorkspace(true) reload
  // (re-fetching and re-rendering the entire template + every field) after
  // one of these is pure redundant work that also causes a visible reload
  // flicker. The server's own response already carries the updated caseForm
  // (decideInteractiveForm/lockInteractiveForm return `data` as the full
  // CaseForm; the PDF generate endpoint returns `data.caseForm`) - merge that
  // in directly. `statePatch` is applied first as a synchronous optimistic
  // update so the UI reflects the action immediately, then overwritten by
  // whatever the server actually returned once the request resolves. Any
  // action that DOES change field values or template state (refresh, reset,
  // rollback, resolve-conflict, section review) keeps using `action()` with
  // its full reload, unchanged.
  const statusAction = async (key, callback, successMessage, statePatch = {}) => {
    setBusy(key)
    setErrorMessage('')
    mergeFormState(statePatch)
    try {
      const response = await callback()
      const serverForm = response?.data?.data?.caseForm || response?.data?.data || response?.data?.form
      if (serverForm) {
        mergeFormState({
          status: serverForm.status,
          approvedBy: serverForm.approvedBy,
          approvalDate: serverForm.approvalDate,
          reviewState: serverForm.reviewState,
          generatedPdfDocument: serverForm.generatedPdfDocument,
          generatedPdfVersions: serverForm.generatedPdfVersions,
          filledPdfPath: serverForm.filledPdfPath,
          filledPdfUrl: serverForm.filledPdfUrl,
          isLocked: serverForm.isLocked,
          lockedAt: serverForm.lockedAt,
          lockedBy: serverForm.lockedBy,
        })
      }
      setNotice(successMessage)
      onSaved?.()
    } catch (error) {
      setErrorMessage(error.response?.data?.message || error.message || 'The action could not be completed')
      // The optimistic patch above may now be wrong (the action failed) -
      // fall back to a real reload to recover the authoritative state.
      await loadWorkspace(true)
    } finally {
      setBusy('')
    }
  }

  const updateField = (field, nextValue) => {
    const previousValue = getByPath(values, field.fieldName)
    if (!sameValue(previousValue, nextValue)) {
      setUndoStack((current) => [...current.slice(-49), { fieldName: field.fieldName, value: previousValue, sectionKey: field.sectionKey }])
      setRedoStack([])
      dirtyFieldsRef.current.add(field.fieldName)
      setDirtyCount(dirtyFieldsRef.current.size)
      setSaveState('dirty')
      setValues((current) => {
        const next = setByPath(current, field.fieldName, nextValue)
        valuesRef.current = next
        return next
      })
    }
  }

  const saveField = async (field, explicitValue, options = {}) => {
    if (!field || !canEdit) return
    const value = explicitValue !== undefined ? explicitValue : getByPath(values, field.fieldName)
    if (explicitValue !== undefined) valuesRef.current = setByPath(valuesRef.current, field.fieldName, explicitValue)
    const previous = getByPath(lastSaved.current, field.fieldName)
    if (sameValue(previous, value)) {
      dirtyFieldsRef.current.delete(field.fieldName)
      setDirtyCount(dirtyFieldsRef.current.size)
      return
    }
    dirtyFieldsRef.current.add(field.fieldName)
    setDirtyCount(dirtyFieldsRef.current.size)
    await savePendingChanges(options.reason || 'Interactive USCIS form review', { reload: options.reload !== false })
  }

  // Closes the overlay's inline editor and persists via the SAME saveField
  // path a flat-list row's onBlur already used - clicking a field on the
  // rendered page and editing it really does write through to the backend
  // (verifiable via save + reload), not just local visual state.
  const blurEditingField = async (field) => {
    setEditingFieldName('')
    await saveField(field)
  }

  const commitEditingField = async (field) => {
    await saveField(field)
    setEditingFieldName('')
  }

  const undo = async () => {
    const entry = undoStack[undoStack.length - 1]
    if (!entry) return
    const field = allFields.find((item) => item.fieldName === entry.fieldName)
    const currentValue = getByPath(values, entry.fieldName)
    setUndoStack((current) => current.slice(0, -1))
    setRedoStack((current) => [...current, { ...entry, value: currentValue }])
    dirtyFieldsRef.current.add(entry.fieldName)
    setDirtyCount(dirtyFieldsRef.current.size)
    setSaveState('dirty')
    setValues((current) => {
      const next = setByPath(current, entry.fieldName, entry.value)
      valuesRef.current = next
      return next
    })
    await saveField(field, entry.value)
  }

  const redo = async () => {
    const entry = redoStack[redoStack.length - 1]
    if (!entry) return
    const field = allFields.find((item) => item.fieldName === entry.fieldName)
    const currentValue = getByPath(values, entry.fieldName)
    setRedoStack((current) => current.slice(0, -1))
    setUndoStack((current) => [...current, { ...entry, value: currentValue }])
    dirtyFieldsRef.current.add(entry.fieldName)
    setDirtyCount(dirtyFieldsRef.current.size)
    setSaveState('dirty')
    setValues((current) => {
      const next = setByPath(current, entry.fieldName, entry.value)
      valuesRef.current = next
      return next
    })
    await saveField(field, entry.value)
  }

  const saveSection = async (section) => {
    const fieldValues = Object.fromEntries((section.fields || []).map((field) => [field.fieldName, getByPath(values, field.fieldName)]))
    await action(`section:${section.key}`, () => uscisFormsApi.saveWorkspaceSection(caseId, caseForm._id, { sectionKey: section.key, fieldValues }), `${section.title} saved`)
  }

  const reviewField = async (status) => {
    if (!selectedField) return
    if (!(await savePendingChanges('Auto-save before field review'))) return
    action(`review:${selectedField.fieldName}`, () => uscisFormsApi.reviewWorkspaceField(caseId, caseForm._id, {
      fieldName: selectedField.fieldName,
      sectionKey: selectedField.sectionKey,
      status,
      comment: comment || undefined,
    }), `Field marked ${labelize(status).toLowerCase()}`)
  }

  const reviewSection = async (status) => {
    const section = sections.find((item) => item.key === activeSection)
    if (!section) return
    if (!(await savePendingChanges('Auto-save before section review'))) return
    action(`section-review:${section.key}`, () => uscisFormsApi.reviewWorkspaceSection(caseId, caseForm._id, {
      sectionKey: section.key,
      status,
      comment: comment || undefined,
    }), `${section.title} marked ${labelize(status).toLowerCase()}`)
  }

  const decideForm = async (decision) => {
    if (!(await savePendingChanges('Auto-save before form decision'))) return
    const statePatch = {
      approve: { status: 'ready_for_pdf' },
      reject: { status: 'rejected' },
      request_changes: { status: 'needs_revision' },
      return_to_case_manager: { status: 'needs_revision' },
    }[decision] || {}
    statusAction(`decision:${decision}`, () => uscisFormsApi.decideWorkspaceForm(caseId, caseForm._id, {
      action: decision,
      reason: decisionReason || undefined,
      approvalStatement: decision === 'approve' ? 'I reviewed this form and approve it for official PDF generation.' : undefined,
    }), decision === 'approve' ? 'Form approved and ready for PDF generation' : 'Review decision saved', statePatch)
  }

  const addComment = async () => {
    if (!comment.trim()) return
    if (!(await savePendingChanges('Auto-save before adding comment'))) return
    action('comment', () => uscisFormsApi.addWorkspaceComment(caseId, caseForm._id, {
      scope: selectedField ? 'field' : 'section',
      fieldName: selectedField?.fieldName,
      sectionKey: selectedField?.sectionKey || activeSection,
      comment,
      internalOnly: true,
    }), 'Internal review comment added')
    setComment('')
  }

  const createTask = async () => {
    if (!selectedField) return
    if (!(await savePendingChanges('Auto-save before creating task'))) return
    action('task', () => uscisFormsApi.createWorkspaceTask(caseId, caseForm._id, {
      title: `Review ${selectedField.label || selectedField.fieldLabel}`,
      description: `Verify ${selectedField.fieldName} in ${workspace.template.formCode}.`,
      assignedTo: workspace.caseForm.lastModifiedBy || undefined,
      priority: validationErrors[selectedField.fieldName]?.length ? 'high' : 'medium',
      fieldName: selectedField.fieldName,
      sectionKey: selectedField.sectionKey,
    }), 'Review task created')
  }

  const resetField = async () => {
    if (!selectedField) return
    if (!(await savePendingChanges('Auto-save before reset'))) return
    action('reset', () => uscisFormsApi.resetWorkspace(caseId, caseForm._id, { fieldName: selectedField.fieldName }), 'Field reset to the latest canonical value')
  }

  // Phase 3 (§I.4) - resolves the NEWER per-field sync-state CONFLICT via the dedicated
  // resolve-conflict endpoint. Deliberately separate from useCanonicalValue below, which resolves
  // the OLDER canonical-merge conflict type through a different endpoint entirely.
  const resolveFieldConflict = async (direction) => {
    if (!selectedField) return
    if (!(await savePendingChanges('Auto-save before conflict resolution'))) return
    action(`conflict:${selectedField.fieldName}`, () => uscisFormsApi.resolveFieldConflict(caseId, caseForm._id, {
      fieldName: selectedField.fieldName,
      sectionKey: selectedField.sectionKey,
      direction,
    }), direction === 'canonical' ? 'Updated to the canonical value' : 'Your edit was confirmed')
  }

  const useCanonicalValue = async () => {
    if (!selectedField) return
    if (!(await savePendingChanges('Auto-save before conflict resolution'))) return
    action('resolve-conflict', () => uscisFormsApi.resolveWorkspaceConflict(caseId, caseForm._id, {
      fieldName: selectedField.fieldName,
      sectionKey: selectedField.sectionKey,
      sourceField: selectedField.sourceField,
      resolution: 'canonical',
      reason: 'Reviewer selected canonical profile value',
    }), 'Conflict resolved with the canonical value')
  }

  const refreshForm = async () => {
    if (!(await savePendingChanges('Auto-save before refresh'))) return
    action('refresh', () => uscisFormsApi.refreshWorkspace(caseId, caseForm._id), 'Form refreshed from canonical data')
  }

  const generatePdf = async () => {
    if (!(await savePendingChanges('Auto-save before PDF generation'))) return
    statusAction('generate-pdf', () => formGenerationApi.generatePdf(caseForm._id, { watermark: 'FINAL', flatten: true }), 'Official USCIS PDF generated', { status: 'generated' })
  }

  const openPdf = async () => {
    const hadPendingChanges = dirtyFieldsRef.current.size > 0
    if (!(await savePendingChanges('Auto-save before PDF preview'))) return
    setBusy('preview-pdf')
    setErrorMessage('')
    try {
      if (hadPendingChanges) await formGenerationApi.generatePdf(caseForm._id, { watermark: 'FINAL', flatten: true })
      const response = await formGenerationApi.previewPdf(caseForm._id)
      const url = URL.createObjectURL(response.data)
      window.open(url, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (error) {
      setErrorMessage(error.response?.data?.message || 'Unable to preview the generated PDF')
    } finally {
      setBusy('')
    }
  }

  const downloadPdf = async () => {
    const hadPendingChanges = dirtyFieldsRef.current.size > 0
    if (!(await savePendingChanges('Auto-save before PDF download'))) return
    setBusy('download-pdf')
    setErrorMessage('')
    try {
      if (hadPendingChanges) await formGenerationApi.generatePdf(caseForm._id, { watermark: 'FINAL', flatten: true })
      const response = await formGenerationApi.downloadPdf(caseForm._id)
      const url = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = `${caseForm.formCode || 'uscis-form'}-${caseForm._id}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (error) {
      setErrorMessage(error.response?.data?.message || 'Unable to download the generated PDF')
    } finally {
      setBusy('')
    }
  }

  // The single official download action (Forms Download overhaul). Saves any
  // pending edits, then fetches the real, authentic, watermark-free USCIS PDF
  // with all current values - available at any status, not just approved/locked.
  const downloadOfficialForm = async () => {
    if (!(await savePendingChanges('Auto-save before downloading official form'))) return
    setBusy('download-official')
    setErrorMessage('')
    try {
      const response = await formGenerationApi.downloadForm(caseForm._id)
      const url = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      const date = new Date().toISOString().slice(0, 10)
      link.download = `${caseForm.formCode || 'uscis-form'}_${caseForm.caseId || caseId}_${date}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
      const formWarnings = readFormWarnings(response)
      if (formWarnings.length) setNotice(`Form downloaded. Please double-check these fields on the PDF: ${formWarnings.join('; ')}`)
    } catch (error) {
      setErrorMessage(error.response?.data?.message || 'Unable to download the official form. Please try again.')
    } finally {
      setBusy('')
    }
  }

  const nextProblem = async () => {
    if (!(await savePendingChanges('Auto-save before moving to next issue'))) return
    const problemFields = allFields.filter((field) => validationErrors[field.fieldName]?.length || !hasValue(getByPath(values, field.fieldName)) && field.required)
    if (!problemFields.length) return
    const currentIndex = problemFields.findIndex((field) => field.fieldName === selectedFieldName)
    const next = problemFields[(currentIndex + 1) % problemFields.length]
    setSelectedFieldName(next.fieldName)
    setActiveSection(next.sectionKey)
    setEditingFieldName(canEdit ? next.fieldName : '')
    document.getElementById(`uscis-field-${escapeSelector(next.fieldName)}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const handleClose = async () => {
    if (!(await savePendingChanges('Auto-save before closing form'))) return
    onClose?.()
  }

  const renderWidthForPage = useCallback((dims = {}) => {
    const pdfWidth = dims.width || MIN_PAGE_RENDER_WIDTH
    const pdfHeight = dims.height || 792
    const availableWidth = Math.max(MIN_PAGE_RENDER_WIDTH, viewerSize.width - 32)
    const availableHeight = Math.max(360, viewerSize.height - 120)
    if (zoomMode === '100') return pdfWidth
    if (zoomMode === 'fit-page') return Math.max(280, Math.min(availableWidth, pdfWidth * (availableHeight / pdfHeight)))
    return Math.max(pdfWidth, availableWidth) * zoomScale
  }, [viewerSize.height, viewerSize.width, zoomMode, zoomScale])

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (canEdit) savePendingChanges('Manual keyboard save')
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo()
      }
      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || event.shiftKey && event.key.toLowerCase() === 'z')) {
        event.preventDefault()
        redo()
      }
      if (event.key === 'F8') {
        event.preventDefault()
        nextProblem()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  if (loading) {
    return <div className="flex min-h-[520px] items-center justify-center rounded-xl border border-slate-200 bg-card text-slate-500"><RefreshCw className="mr-2 h-5 w-5 animate-spin" />Opening interactive USCIS form...</div>
  }
  if (!workspace) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">{errorMessage || 'Unable to load this form.'}</div>
  }
  if (!workspace.template || !workspace.caseForm || !workspace.caseSummary || !workspace.permissions) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">This form's data is incomplete and can't be displayed. Please refresh, or contact support if the problem continues.</div>
  }

  const selectedComments = (workspace.comments || []).filter((item) => !selectedField || item.fieldName === selectedField.fieldName || item.sectionKey === selectedField.sectionKey && item.scope === 'section')

  return (
    <div className="overflow-hidden rounded-xl border border-slate-300 bg-slate-100 shadow-sm">
      <header className="border-b border-slate-300 bg-card px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={handleClose} className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-50" aria-label="Back to forms"><ArrowLeft className="h-4 w-4" /></button>
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground"><FileText className="h-5 w-5" /></div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-bold text-slate-950">{workspace.template.formCode} · {workspace.template.title}</h2>
                <StatusBadge status={workspace.caseForm.status} />
                {locked && <StatusBadge status="locked"><Lock className="mr-1 h-3 w-3" />Locked</StatusBadge>}
              </div>
              <p className="text-xs text-slate-500">Edition {workspace.template.version || 'Current'} · Case {workspace.caseSummary.caseNumber} · {(permissions.mode || 'review').replaceAll('_', ' ')} review</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Phase 3 (§I.5): 'retrying' is new (amber, mirrors 'dirty''s tone - a save is in
                progress, just not on the first attempt); 'error' is unchanged in appearance but is
                now a button - clicking it retries via savePendingChanges, which naturally retries
                whatever is still in dirtyFieldsRef (a failed save is never cleared from it). */}
            {saveState === 'error' ? (
              <button
                type="button"
                onClick={() => savePendingChanges('Manual retry after save failure')}
                className="rounded-full bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100"
                title="Click to retry the failed save"
              >
                ⚠ Save failed — click to retry
              </button>
            ) : (
              <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${saveState === 'saving' ? 'bg-primary-50 text-primary' : saveState === 'retrying' ? 'bg-amber-50 text-amber-700' : saveState === 'dirty' ? 'bg-amber-50 text-amber-700' : 'bg-primary-50 text-primary'}`}>
                {saveState === 'saving' ? 'Saving...' : saveState === 'retrying' ? 'Retrying save…' : saveState === 'dirty' ? `${dirtyCount || 1} unsaved` : 'Saved ✓'}
              </span>
            )}
            <button type="button" onClick={undo} disabled={!undoStack.length || !canEdit} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40">Undo</button>
            <button type="button" onClick={redo} disabled={!redoStack.length || !canEdit} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40">Redo</button>
            <button
              type="button"
              onClick={downloadOfficialForm}
              disabled={busy === 'download-official' || busy === 'auto-save'}
              className="flex items-center gap-1 rounded-md bg-primary text-primary-foreground hover:opacity-90 px-3 py-2 text-xs font-semibold disabled:opacity-50"
              title="Download the official USCIS PDF with all current field values"
            >
              <Download className="h-3.5 w-3.5" />
              {busy === 'download-official' ? 'Preparing…' : 'Download Official Form'}
            </button>
            {permissions.canApprove && !locked && <button type="button" onClick={() => decideForm('approve')} className="flex items-center gap-1 rounded-md bg-primary text-primary-foreground hover:opacity-90 px-3 py-2 text-xs font-semibold"><ShieldCheck className="h-4 w-4" />Approve Form</button>}
            {['approved', 'ready_for_pdf', 'locked'].includes(workspace.caseForm.status) && <button type="button" onClick={generatePdf} disabled={busy === 'generate-pdf'} className="flex items-center gap-1 rounded-md bg-primary text-primary-foreground hover:opacity-90 px-3 py-2 text-xs font-semibold disabled:opacity-50"><FileCheck2 className="h-4 w-4" />{busy === 'generate-pdf' ? 'Generating…' : 'Generate PDF'}</button>}
            {workspace.caseForm.generatedPdfDocument && <button type="button" onClick={openPdf} disabled={busy === 'preview-pdf'} className="rounded-md border border-primary-300 bg-primary-50 px-3 py-2 text-xs font-semibold text-primary">Preview PDF</button>}
            {workspace.caseForm.generatedPdfDocument && <button type="button" onClick={downloadPdf} disabled={busy === 'download-pdf'} className="flex items-center gap-1 rounded-md border border-primary-300 bg-primary-50 px-3 py-2 text-xs font-semibold text-primary disabled:opacity-50"><Download className="h-3.5 w-3.5" />{busy === 'download-pdf' ? 'Downloading…' : 'Download PDF'}</button>}
            {permissions.canLock && !locked && ['approved', 'ready_for_pdf', 'generated'].includes(workspace.caseForm.status) && <button type="button" onClick={async () => { if (await savePendingChanges('Auto-save before lock')) statusAction('lock', () => uscisFormsApi.lockWorkspaceForm(caseId, caseForm._id, { locked: true }), 'Form locked', { isLocked: true, status: 'locked' }) }} className="rounded-md border border-slate-800 px-3 py-2 text-xs font-semibold text-slate-800"><Lock className="inline h-3.5 w-3.5" /> Lock</button>}
            {permissions.canUnlock && locked && <button type="button" onClick={async () => { if (await savePendingChanges('Auto-save before unlock')) statusAction('unlock', () => uscisFormsApi.lockWorkspaceForm(caseId, caseForm._id, { locked: false, reason: decisionReason }), 'Form unlocked', { isLocked: false }) }} className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800"><Unlock className="inline h-3.5 w-3.5" /> Unlock</button>}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-primary transition-all" style={{ width: `${completion.percent || 0}%` }} /></div>
          <span className="text-xs font-bold text-slate-700">{completion.percent || 0}% complete</span>
          <span className="hidden text-xs text-slate-500 sm:inline">{completion.missingRequiredFields || 0} required fields missing</span>
        </div>
        {(notice || errorMessage) && <div className={`mt-2 rounded-md px-3 py-2 text-xs ${errorMessage ? 'bg-red-50 text-red-700' : 'bg-primary-50 text-primary'}`}>{errorMessage || notice}</div>}
      </header>

      <div className="relative min-h-[680px]">


        <main ref={viewerRef} className="max-h-[calc(100vh-11rem)] min-h-[680px] min-w-0 overflow-auto bg-slate-200/60 p-2 sm:p-3">
          {selectedField && (
            <div className="mx-auto mb-4 flex max-w-[900px] items-start justify-between gap-3 rounded-md border border-primary-200 bg-primary-50 px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide text-primary">Selected field</p>
                <p className="truncate text-sm font-semibold text-primary">{selectedField.label || selectedField.fieldLabel}{selectedField.required && <span className="ml-1 text-red-600">*</span>}</p>
              </div>
              {comparison && selectedField.canonicalValue !== undefined && !sameValue(getByPath(values, selectedField.fieldName), selectedField.canonicalValue) && (
                <div className="grid shrink-0 grid-cols-2 gap-2 text-[11px]">
                  <div><span className="block font-semibold text-amber-900">Canonical</span>{displayValue(selectedField.canonicalValue)}</div>
                  <div><span className="block font-semibold text-amber-900">Current</span>{displayValue(getByPath(values, selectedField.fieldName))}</div>
                </div>
              )}
            </div>
          )}
          {templatePdfError && (
            <div className="mx-auto mb-4 max-w-[900px] rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">{templatePdfError}</div>
          )}
          <div className="sticky top-0 z-20 mb-3 flex min-w-max items-center justify-between gap-3 border-b border-slate-300 bg-slate-100/95 px-2 py-2 backdrop-blur">
            <div className="flex items-center gap-1 rounded-md border border-slate-300 bg-card p-1">
              {[
                ['fit-width', 'Fit Width'],
                ['fit-page', 'Fit Page'],
                ['100', '100%'],
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => { setZoomMode(mode); setZoomScale(1) }}
                  className={`rounded px-2 py-1 text-[11px] font-semibold ${zoomMode === mode ? 'bg-primary text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 rounded-md border border-slate-300 bg-card p-1">
              <button type="button" onClick={() => { setZoomMode('fit-width'); setZoomScale((current) => Math.max(0.5, Number((current - 0.1).toFixed(2)))) }} className="rounded p-1 text-slate-700 hover:bg-slate-100" aria-label="Zoom out"><Minus className="h-3.5 w-3.5" /></button>
              <span className="w-12 text-center text-[11px] font-semibold text-slate-600">{zoomMode === '100' ? '100%' : `${Math.round(zoomScale * 100)}%`}</span>
              <button type="button" onClick={() => { setZoomMode('fit-width'); setZoomScale((current) => Math.min(2.5, Number((current + 0.1).toFixed(2)))) }} className="rounded p-1 text-slate-700 hover:bg-slate-100" aria-label="Zoom in"><Plus className="h-3.5 w-3.5" /></button>
            </div>
          </div>
          {(viewerPageConstraint?.error || pageMismatchMessage) && (
            <div className="mx-auto mb-3 max-w-[900px] rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-900">
              {viewerPageConstraint?.error
                ? `This supplement's page layout could not be resolved: ${viewerPageConstraint.error.message}`
                : `This form's page layout may be out of date: ${pageMismatchMessage}`}
            </div>
          )}
          {templatePdfUrl ? (
            <Document
              file={templatePdfUrl}
              loading={<div className="flex h-[600px] items-center justify-center text-sm text-slate-400">Loading the official USCIS form pages…</div>}
              error={<div className="flex h-[300px] items-center justify-center text-sm font-semibold text-red-600">Unable to load the official USCIS PDF - field data is still shown below once pages render.</div>}
              onLoadSuccess={handlePdfLoadSuccess}
            >
              {!annotationsReady && (
                <div className="flex h-[300px] items-center justify-center text-sm text-slate-400">Preparing form fields…</div>
              )}
              {annotationsReady && pageSlots.map(({ slot, parentPage }) => {
                const dims = pageDimensionsByNumber.get(parentPage) || {}
                const { total, filled } = pageCompletion(parentPage)
                const renderWidth = renderWidthForPage(dims)
                return (
                  <div key={parentPage} className="mx-auto mb-2" style={{ width: renderWidth }}>
                    <div className="mb-1 flex items-center justify-between px-1 text-[11px] font-semibold text-slate-600">
                      <span>Page {parentPage}</span>
                      <span className={filled === total && total > 0 ? 'text-primary' : 'text-slate-500'}>{total ? `${filled} of ${total} fields filled` : 'No fillable fields on this page'}</span>
                    </div>
                    <PdfFormPage
                      pdfPageNumber={slot}
                      displayPageNumber={parentPage}
                      pdfPageWidth={dims.width || 612}
                      pdfPageHeight={dims.height || 792}
                      renderWidth={renderWidth}
                      fields={fieldsByPage.get(parentPage) || []}
                      fieldsByName={fieldsByName}
                      values={values}
                      validationErrors={validationErrors}
                      canEdit={canEdit}
                      selectedFieldName={selectedFieldName}
                      onSelectField={selectField}
                      onNativeFieldInput={handleNativeFieldInput}
                      onNativeFieldCommit={handleNativeFieldCommit}
                      registerPageRef={registerPageRef}
                      sessionEditedFields={sessionEditedFields}
                      fieldSaveStatus={fieldSaveStatus}
                    />
                  </div>
                )
              })}
            </Document>
          ) : templatePdfError ? (
            pageNumbers.length ? (
              pageSlots.map(({ parentPage }) => {
                const dims = pageDimensionsByNumber.get(parentPage) || {}
                const { total, filled } = pageCompletion(parentPage)
                const renderWidth = renderWidthForPage(dims)
                return (
                  <div key={parentPage} className="mx-auto mb-2" style={{ width: renderWidth }}>
                    <div className="mb-1 flex items-center justify-between px-1 text-[11px] font-semibold text-slate-600">
                      <span>Page {parentPage}</span>
                      <span className={filled === total && total > 0 ? 'text-primary' : 'text-slate-500'}>{total ? `${filled} of ${total} fields filled` : 'No fillable fields on this page'}</span>
                    </div>
                    <PdfFormPage
                      pdfPageNumber={parentPage}
                      displayPageNumber={parentPage}
                      pdfPageWidth={dims.width || 612}
                      pdfPageHeight={dims.height || 792}
                      renderWidth={renderWidth}
                      fields={fieldsByPage.get(parentPage) || []}
                      fieldsByName={fieldsByName}
                      values={values}
                      validationErrors={validationErrors}
                      canEdit={canEdit}
                      selectedFieldName={selectedFieldName}
                      onSelectField={selectField}
                      onNativeFieldInput={handleNativeFieldInput}
                      onNativeFieldCommit={handleNativeFieldCommit}
                      registerPageRef={registerPageRef}
                      showBackground={false}
                      sessionEditedFields={sessionEditedFields}
                      fieldSaveStatus={fieldSaveStatus}
                    />
                  </div>
                )
              })
            ) : (
              <div className="flex h-[300px] items-center justify-center text-sm text-slate-400">No field layout is available for this form yet.</div>
            )
          ) : (
            <div className="flex h-[300px] items-center justify-center text-sm text-slate-400">Loading the official USCIS form pages…</div>
          )}
          {selectedField && (
            <div className="mx-auto mt-2 flex max-w-[900px] items-center justify-between gap-3 rounded-md border border-slate-300 bg-card px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={selectedField.review?.status || selectedField.verificationStatus} />
                {/* Phase 3 (§I.3): prefers the explicit syncState when present; falls back to the
                    older manualOverride check only for a hypothetical response with no syncState
                    at all (buildFieldView always computes one now, so this fallback is dormant in
                    practice, not dead code removed - see docs/forms/PHASE3_BASELINE.md). */}
                {(selectedField.syncState === 'MANUAL_OVERRIDE' || (!selectedField.syncState && selectedField.manualOverride)) && <StatusBadge status="manual_override">Manual</StatusBadge>}
                {selectedField.syncState === 'CONFLICT' && <StatusBadge status="needs_revision">Field Conflict</StatusBadge>}
                {/* Older, distinct concept: multiple candidate SOURCES disagreeing on this
                    canonical field (CanonicalMergeService/rebuild), independent of the Phase 2/3
                    per-field sync conflict above - both can be true at once, so both render. */}
                {selectedField.conflicts?.length > 0 && <StatusBadge status="needs_revision">Conflict</StatusBadge>}
                <span className="text-[11px] text-slate-500">{selectedField.source || 'Unmapped source'}</span>
                {busy === `field:${selectedField.fieldName}` && <span className="text-[11px] text-primary">Saving…</span>}
              </div>
              {permissions.canReview && (
                <div className="flex gap-2">
                  <button type="button" onClick={() => reviewSection('approved')} className="rounded border border-primary-300 bg-primary-50 px-2.5 py-1.5 text-[11px] font-semibold text-primary">Approve Section</button>
                  <button type="button" onClick={() => reviewSection('needs_revision')} className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800">Needs Revision</button>
                </div>
              )}
            </div>
          )}
          {(validationErrors[selectedFieldName] || []).map((item) => (
            <p key={String(item)} className="mx-auto mt-1.5 flex max-w-[900px] items-center gap-1 text-[11px] font-medium text-red-700"><AlertTriangle className="h-3 w-3" />{typeof item === 'string' ? item : item.message}</p>
          ))}
        </main>

      </div>
    </div>
  )
}

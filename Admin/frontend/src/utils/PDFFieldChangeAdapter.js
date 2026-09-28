const CHECKBOX_TYPES = new Set(['checkbox', 'radio'])

const unwrapStoredValue = (entry) => {
  if (entry && typeof entry === 'object' && !Array.isArray(entry) && Object.prototype.hasOwnProperty.call(entry, 'value')) {
    return entry.value
  }
  return entry
}

const findAttribute = (target, name) => {
  if (!target?.getAttribute) return ''
  return target.getAttribute(name) || ''
}

const closestAttribute = (target, name) => {
  if (!target?.closest) return ''
  const match = target.closest(`[${name}]`)
  return match?.getAttribute?.(name) || ''
}

export function extractFieldName(input) {
  const target = input?.target || input
  if (!target) return ''
  return String(
    input?.fieldName ||
    target.fieldName ||
    target.name ||
    findAttribute(target, 'name') ||
    findAttribute(target, 'data-field-name') ||
    closestAttribute(target, 'data-field-name') ||
    findAttribute(target, 'id') ||
    target.id ||
    findAttribute(target, 'data-annotation-id') ||
    closestAttribute(target, 'data-annotation-id') ||
    findAttribute(target, 'aria-label') ||
    target.ariaLabel ||
    ''
  ).trim()
}

const fieldTypeOf = (input) => {
  const target = input?.target || input || {}
  return String(
    input?.fieldType ||
    target.fieldType ||
    target.type ||
    findAttribute(target, 'data-field-type') ||
    ''
  ).trim()
}

const exportValueOf = (input) => {
  const target = input?.target || input || {}
  const value = input?.exportValue ??
    input?.buttonValue ??
    target.exportValue ??
    target.buttonValue ??
    findAttribute(target, 'data-export-value') ??
    findAttribute(target, 'data-button-value')
  if (value !== undefined && value !== null && value !== '') return value
  if (target.value !== undefined && target.value !== null && target.value !== '' && target.value !== 'on') return target.value
  return 'Yes'
}

export function normalizePdfFieldValue(input) {
  const target = input?.target || input || {}
  const type = fieldTypeOf(input).toLowerCase()
  const isButton = String(input?.fieldType || target.fieldType || '').toLowerCase() === 'btn'
  const isChoice = String(input?.fieldType || target.fieldType || '').toLowerCase() === 'ch'

  if (CHECKBOX_TYPES.has(type) || isButton) {
    return target.checked ? String(exportValueOf(input)) : ''
  }

  const rawValue = input?.value ?? target.value
  if (Array.isArray(rawValue)) return rawValue.map((item) => item == null ? '' : String(item))
  if (isChoice && rawValue == null) return ''
  if (rawValue == null) return ''
  return String(rawValue)
}

const buildKnownFieldSet = (existingFieldValues, options) => {
  const names = [
    ...(options?.knownFieldNames || []),
    ...Object.keys(options?.fieldMetaByName || {}),
  ]
  if (names.length) return new Set(names)
  const existing = existingFieldValues && typeof existingFieldValues === 'object' ? Object.keys(existingFieldValues) : []
  return existing.length ? new Set(existing) : null
}

export function convert(event, caseFormId, existingFieldValues = {}, options = {}) {
  const fieldName = extractFieldName(event)
  if (!fieldName) {
    return { error: 'INVALID_EVENT', message: 'Unable to identify the PDF field name from this edit event.' }
  }

  const knownFields = buildKnownFieldSet(existingFieldValues, options)
  if (knownFields && !knownFields.has(fieldName)) {
    return {
      error: 'FIELD_NOT_IN_MAPPING',
      fieldName,
      message: 'This PDF field is not present in the workspace field mapping.',
    }
  }

  const fieldMeta = options?.fieldMetaByName?.[fieldName] || {}
  return {
    caseFormId,
    fieldName,
    fieldId: fieldName,
    sectionKey: fieldMeta.sectionKey,
    occurrenceId: fieldMeta.occurrenceId || options?.occurrenceId,
    source: 'case_manager_override',
    reason: options?.reason || 'Native PDF field edit',
    value: normalizePdfFieldValue(event),
  }
}

// Deprecated: pdf.js's real AnnotationStorage keys every stored value by the
// widget's own ANNOTATION ID (e.g. "1234R"), never by field name, so
// annotationStorage.setValue(fieldName, ...) was silently a no-op against a
// real PDF - it only ever appeared to work in a test that stubs
// annotationStorage as a bare spy. Use buildWidgetIndex + prePopulateById
// instead. Kept only so an old call site that hasn't migrated yet doesn't
// throw; it now always returns 0.
export function prePopulateFields() {
  return 0
}

// pdf.js's real per-widget id for a field name, e.g.
// getFieldObjects() -> { "form1[0]...Line3[0]": [{ id: "1234R", type: "text" }] }.
// A field can have more than one widget (a radio group's siblings, or the
// same field name repeated across pages) - every widget id for that name is
// tracked, each with its own type/exportValue so a checkbox/radio value can
// be written per-widget rather than assuming one id per name.
export function buildWidgetIndex(fieldObjects) {
  const index = new Map()
  if (!fieldObjects || typeof fieldObjects !== 'object') return index
  Object.entries(fieldObjects).forEach(([fieldName, entries]) => {
    if (!Array.isArray(entries)) return
    index.set(fieldName, entries
      .filter((entry) => entry && entry.id != null)
      .map((entry) => ({ id: entry.id, type: entry.type, exportValue: entry.exportValues })))
  })
  return index
}

// Writes a field's stored value into pdf.js's real, id-keyed annotation
// storage for every widget that field name resolves to, encoded per pdf.js's
// own per-type contract (confirmed against the installed pdfjs-dist's
// annotation_layer.js render() for each widget class):
//   text/combobox/listbox -> { value: String(v) }
//   checkbox               -> { value: v === exportValue || v === true }
//   radiobutton             -> { value: String(v) === String(exportValue) }
// Names with no matching widget (not on this document, or a component
// slice's field never made it into the sliced PDF) are silently skipped -
// not every mapped field name is guaranteed to exist in every render.
export function prePopulateById(annotationStorage, widgetIndex, fieldValues = {}) {
  if (!annotationStorage || !widgetIndex || !fieldValues || typeof fieldValues !== 'object') return 0
  if (typeof annotationStorage.setValue !== 'function') return 0
  let populated = 0
  Object.entries(fieldValues).forEach(([fieldName, entry]) => {
    const widgets = widgetIndex.get(fieldName)
    if (!widgets || !widgets.length) return
    const value = unwrapStoredValue(entry)
    widgets.forEach((widget) => {
      if (widget.type === 'checkbox') {
        annotationStorage.setValue(widget.id, { value: value === widget.exportValue || value === true })
      } else if (widget.type === 'radiobutton') {
        annotationStorage.setValue(widget.id, { value: String(value) === String(widget.exportValue) })
      } else {
        annotationStorage.setValue(widget.id, { value: value == null ? '' : String(value) })
      }
      populated += 1
    })
  })
  return populated
}

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

export function prePopulateFields(annotationStorage, fieldValues = {}) {
  if (!annotationStorage || !fieldValues || typeof fieldValues !== 'object') return 0
  let populated = 0
  Object.entries(fieldValues).forEach(([fieldName, entry]) => {
    const value = unwrapStoredValue(entry)
    if (typeof annotationStorage.setValue === 'function') {
      annotationStorage.setValue(fieldName, { value: value == null ? '' : value })
      populated += 1
    }
  })
  return populated
}

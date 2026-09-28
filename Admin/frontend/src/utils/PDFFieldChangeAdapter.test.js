import { describe, expect, it, vi } from 'vitest'
import { convert, extractFieldName, normalizePdfFieldValue, prePopulateFields, buildWidgetIndex, prePopulateById } from './PDFFieldChangeAdapter'

const fieldMetaByName = {
  'form1[0].#subform[0].Line3_CompanyorOrgName[0]': { sectionKey: 'part-1' },
  'form1[0].#subform[0].CheckBox_YN[0]': { sectionKey: 'part-1' },
  'form1[0].#subform[0].CheckBox_YN[1]': { sectionKey: 'part-1' },
  'form1[0].#subform[0].SelectClassification[0]': { sectionKey: 'part-2' },
}

describe('PDFFieldChangeAdapter', () => {
  it('converts a text edit into the workspace field payload shape', () => {
    const event = {
      target: {
        name: 'form1[0].#subform[0].Line3_CompanyorOrgName[0]',
        value: 'Acme Immigration LLC',
      },
    }

    expect(convert(event, 'case-form-1', {}, { fieldMetaByName })).toMatchObject({
      caseFormId: 'case-form-1',
      fieldName: 'form1[0].#subform[0].Line3_CompanyorOrgName[0]',
      fieldId: 'form1[0].#subform[0].Line3_CompanyorOrgName[0]',
      sectionKey: 'part-1',
      source: 'case_manager_override',
      reason: 'Native PDF field edit',
      value: 'Acme Immigration LLC',
    })
  })

  it('preserves checkbox export strings instead of coercing them to booleans', () => {
    const event = {
      target: {
        name: 'form1[0].#subform[0].CheckBox_YN[0]',
        type: 'checkbox',
        checked: true,
        value: ' Y ',
      },
    }

    expect(normalizePdfFieldValue(event)).toBe(' Y ')
    expect(convert(event, 'case-form-1', {}, { fieldMetaByName }).value).toBe(' Y ')
  })

  it('treats paired yes/no style checkboxes as independent fields', () => {
    const yes = convert({
      target: { name: 'form1[0].#subform[0].CheckBox_YN[0]', type: 'checkbox', checked: true, value: 'Y' },
    }, 'case-form-1', {}, { fieldMetaByName })
    const no = convert({
      target: { name: 'form1[0].#subform[0].CheckBox_YN[1]', type: 'checkbox', checked: false, value: 'N' },
    }, 'case-form-1', {}, { fieldMetaByName })

    expect(yes).toMatchObject({ fieldName: 'form1[0].#subform[0].CheckBox_YN[0]', value: 'Y' })
    expect(no).toMatchObject({ fieldName: 'form1[0].#subform[0].CheckBox_YN[1]', value: '' })
  })

  it('handles AcroForm choice fields as strings', () => {
    const event = {
      fieldType: 'Ch',
      fieldName: 'form1[0].#subform[0].SelectClassification[0]',
      value: 'H-1B',
    }

    expect(convert(event, 'case-form-1', {}, { fieldMetaByName }).value).toBe('H-1B')
  })

  it('returns a non-throwing error for an unmapped PDF field', () => {
    const result = convert(
      { target: { name: 'unmapped.acroform.field', value: 'value' } },
      'case-form-1',
      {},
      { knownFieldNames: Object.keys(fieldMetaByName) },
    )

    expect(result).toMatchObject({ error: 'FIELD_NOT_IN_MAPPING', fieldName: 'unmapped.acroform.field' })
  })

  it('returns a non-throwing error for invalid events', () => {
    expect(convert(null, 'case-form-1')).toMatchObject({ error: 'INVALID_EVENT' })
  })

  it('extracts field names from annotation-layer data attributes', () => {
    const target = {
      getAttribute: (name) => name === 'data-field-name' ? 'native.field' : '',
    }

    expect(extractFieldName({ target })).toBe('native.field')
  })

  // RC4: pdf.js's real AnnotationStorage keys every stored value by the
  // widget's own annotation id, never by field name - a fieldName-keyed
  // setValue call is a no-op against a real PDF. prePopulateFields is kept
  // only so a stale call site doesn't throw, and now always returns 0.
  it('prePopulateFields is a deprecated no-op (use buildWidgetIndex + prePopulateById)', () => {
    const annotationStorage = { setValue: vi.fn() }
    expect(prePopulateFields(annotationStorage, { 'some.field': 'value' })).toBe(0)
    expect(annotationStorage.setValue).not.toHaveBeenCalled()
    expect(prePopulateFields(null, {})).toBe(0)
  })

  it('buildWidgetIndex resolves pdf.js getFieldObjects() output into a name -> widgets map', () => {
    const fieldObjects = {
      'form1[0].#subform[0].Line3_CompanyorOrgName[0]': [{ id: '10R', type: 'text' }],
      'form1[0].#subform[0].CheckBox_YN[0]': [{ id: '11R', type: 'checkbox', exportValues: 'Yes' }],
      'form1[0].#subform[0].RadioGroup[0]': [
        { id: '12R', type: 'radiobutton', exportValues: 'A' },
        { id: '13R', type: 'radiobutton', exportValues: 'B' },
      ],
      'ignored.no.id': [{ type: 'text' }],
    }
    const index = buildWidgetIndex(fieldObjects)
    expect(index.get('form1[0].#subform[0].Line3_CompanyorOrgName[0]')).toEqual([{ id: '10R', type: 'text', exportValue: undefined }])
    expect(index.get('form1[0].#subform[0].CheckBox_YN[0]')).toEqual([{ id: '11R', type: 'checkbox', exportValue: 'Yes' }])
    expect(index.get('form1[0].#subform[0].RadioGroup[0]')).toHaveLength(2)
    expect(index.get('ignored.no.id')).toEqual([])
    expect(buildWidgetIndex(null).size).toBe(0)
  })

  it('prePopulateById writes id-keyed values per pdf.js widget-type contract', () => {
    const annotationStorage = { setValue: vi.fn() }
    const widgetIndex = buildWidgetIndex({
      'text.field': [{ id: '10R', type: 'text' }],
      'checkbox.field': [{ id: '11R', type: 'checkbox', exportValues: 'Yes' }],
      'radio.field': [
        { id: '12R', type: 'radiobutton', exportValues: 'A' },
        { id: '13R', type: 'radiobutton', exportValues: 'B' },
      ],
    })
    const count = prePopulateById(annotationStorage, widgetIndex, {
      'text.field': 'Acme',
      'checkbox.field': 'Yes',
      'radio.field': 'B',
      'unknown.field': 'ignored - not on this document',
    })
    expect(count).toBe(4)
    expect(annotationStorage.setValue).toHaveBeenCalledWith('10R', { value: 'Acme' })
    expect(annotationStorage.setValue).toHaveBeenCalledWith('11R', { value: true })
    expect(annotationStorage.setValue).toHaveBeenCalledWith('12R', { value: false })
    expect(annotationStorage.setValue).toHaveBeenCalledWith('13R', { value: true })
  })

  it('prePopulateById skips names with no matching widget and handles a false checkbox value', () => {
    const annotationStorage = { setValue: vi.fn() }
    const widgetIndex = buildWidgetIndex({ 'checkbox.field': [{ id: '11R', type: 'checkbox', exportValues: 'Yes' }] })
    const count = prePopulateById(annotationStorage, widgetIndex, { 'checkbox.field': '', 'not.present': 'x' })
    expect(count).toBe(1)
    expect(annotationStorage.setValue).toHaveBeenCalledWith('11R', { value: false })
    expect(prePopulateById(null, widgetIndex, {})).toBe(0)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { convert, extractFieldName, normalizePdfFieldValue, prePopulateFields } from './PDFFieldChangeAdapter'

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

  it('pre-populates PDF annotation storage without requiring React', () => {
    const annotationStorage = { setValue: vi.fn() }
    const count = prePopulateFields(annotationStorage, {
      'form1[0].#subform[0].Line3_CompanyorOrgName[0]': 'Acme',
      'form1[0].#subform[0].CheckBox_YN[0]': { value: ' Y ' },
    })

    expect(count).toBe(2)
    expect(annotationStorage.setValue).toHaveBeenCalledWith('form1[0].#subform[0].Line3_CompanyorOrgName[0]', { value: 'Acme' })
    expect(annotationStorage.setValue).toHaveBeenCalledWith('form1[0].#subform[0].CheckBox_YN[0]', { value: ' Y ' })
    expect(prePopulateFields(null, {})).toBe(0)
  })
})

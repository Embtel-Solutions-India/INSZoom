// POC diagnostic ONLY. Scans the FULL widget-annotation set (not just 5
// samples/type) to pick concrete, real field candidates for each of the 7
// field-type tests in docs/forms/PHASE_POC_REPORT.md §H - a radio group, a
// dropdown, and a repeated canonical field (same label appearing on 2+
// distinct widgets), using the same real stored I-129 artifact.
const path = require('path')
const mongoose = require('mongoose')
const env = require('../src/config/env')
const USCISFormTemplate = require('../src/models/USCISFormTemplate')
const storageService = require('../src/modules/uploads/storage.service')

const NESTED_PDFJS_ROOT = path.join(
  __dirname, '..', '..', 'INSZoom', 'frontend', 'node_modules', 'react-pdf', 'node_modules', 'pdfjs-dist'
)
const NESTED_PDFJS = path.join(NESTED_PDFJS_ROOT, 'legacy', 'build', 'pdf.mjs')

async function main() {
  await mongoose.connect(env.mongoUri)
  const template = await USCISFormTemplate.findOne({ formCode: /^I-129$/i, status: 'active' }).lean()
  const key = template.artifacts?.form?.storageKey || template.pdfStorageKey
  const buffer = await storageService.readBuffer(key)

  const pdfjsLib = await import('file://' + NESTED_PDFJS.replace(/\\/g, '/'))
  const pdfDocument = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), disableWorker: true, isEvalSupported: false }).promise

  const allWidgets = []
  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber)
    const annotations = await page.getAnnotations({ intent: 'display' })
    annotations.filter((a) => a.subtype === 'Widget').forEach((a) => allWidgets.push({ pageNumber, ...a }))
  }

  const radioButtons = allWidgets.filter((w) => w.radioButton)
  const checkboxesWithRealExport = allWidgets.filter((w) => w.checkBox && w.exportValue && w.exportValue !== 'Yes' && w.exportValue !== 'On')
  const dropdowns = allWidgets.filter((w) => w.fieldType === 'Ch' && !w.combo === false).slice(0, 5)
  const familyNameFields = allWidgets.filter((w) => /familyname/i.test(w.fieldName || '') || /family name/i.test(w.alternativeText || ''))

  // Group radio buttons by their shared parent field name (radio groups in
  // AcroForm share a partial field name up to the last segment, or pdfjs
  // exposes fieldName identically for every option in the group).
  const radioGroups = {}
  radioButtons.forEach((rb) => {
    const groupKey = rb.fieldName
    if (!radioGroups[groupKey]) radioGroups[groupKey] = []
    radioGroups[groupKey].push({ pageNumber: rb.pageNumber, exportValue: rb.exportValue, alternativeText: rb.alternativeText, rect: rb.rect })
  })

  console.log(JSON.stringify({
    totalWidgets: allWidgets.length,
    radioButtonCount: radioButtons.length,
    radioGroupsSample: Object.entries(radioGroups).slice(0, 3).map(([k, v]) => ({ fieldName: k, options: v })),
    checkboxesWithNonTrivialExportSample: checkboxesWithRealExport.slice(0, 5).map((w) => ({ pageNumber: w.pageNumber, fieldName: w.fieldName, exportValue: w.exportValue, alternativeText: w.alternativeText })),
    dropdownSample: dropdowns.map((w) => ({ pageNumber: w.pageNumber, fieldName: w.fieldName, options: w.options, alternativeText: w.alternativeText })),
    familyNameFieldOccurrences: familyNameFields.map((w) => ({ pageNumber: w.pageNumber, fieldName: w.fieldName, alternativeText: w.alternativeText })),
  }, null, 2))

  await mongoose.disconnect()
}

main().catch((error) => { console.error('POC_SCRIPT_ERROR', error); process.exit(1) })

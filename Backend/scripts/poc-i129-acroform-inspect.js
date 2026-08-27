// POC diagnostic ONLY - not wired into any route or production path.
// Connects to the real MongoDB, loads the active I-129 USCISFormTemplate,
// reads its real stored PDF bytes via storageService.readBuffer (same code
// path getTemplatePdf uses), and inspects the AcroForm annotation layer
// directly with react-pdf's OWN nested pdfjs-dist (5.4.296) running in
// Node's legacy build - this validates PDF STRUCTURE (does the AcroForm
// layer exist, what widget types/field names/export values it has) ahead
// of the separate browser-DOM interactivity test that requires a live
// browser and is out of this script's reach.
const path = require('path')
const crypto = require('crypto')
const mongoose = require('mongoose')
const env = require('../src/config/env')
const USCISFormTemplate = require('../src/models/USCISFormTemplate')
const storageService = require('../src/modules/uploads/storage.service')

const NESTED_PDFJS_ROOT = path.join(
  __dirname, '..', '..', 'INSZoom', 'frontend', 'node_modules', 'react-pdf', 'node_modules', 'pdfjs-dist'
)
const NESTED_PDFJS = path.join(NESTED_PDFJS_ROOT, 'legacy', 'build', 'pdf.mjs')
const NESTED_PDFJS_WORKER = path.join(NESTED_PDFJS_ROOT, 'legacy', 'build', 'pdf.worker.mjs')

async function main() {
  await mongoose.connect(env.mongoUri)

  const template = await USCISFormTemplate.findOne({ formCode: /^I-129$/i, status: 'active' })
    .sort({ editionDate: -1, version: -1 })
    .lean()

  if (!template) {
    console.log(JSON.stringify({ error: 'No active I-129 template found' }))
    await mongoose.disconnect()
    process.exit(1)
  }

  const key = template.artifacts?.form?.storageKey || template.pdfStorageKey
  const identity = {
    formCode: template.formCode,
    editionDate: template.editionDate,
    templateId: String(template._id),
    version: template.version,
    status: template.status,
    storageKey: key,
    declaredPageCount: template.pdfMetadata?.pageCount,
    declaredFormFieldsCount: (template.formFields || []).length,
  }

  if (!key) {
    console.log(JSON.stringify({ identity, error: 'Template has no stored PDF artifact key' }, null, 2))
    await mongoose.disconnect()
    process.exit(1)
  }

  const buffer = await storageService.readBuffer(key)
  identity.sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
  identity.byteLength = buffer.length
  identity.magicBytes = buffer.subarray(0, 5).toString('utf8')
  identity.hasXFAMarker = buffer.includes(Buffer.from('/XFA'))
  identity.hasAcroFormMarker = buffer.includes(Buffer.from('/AcroForm'))

  const pdfjsLib = await import('file://' + NESTED_PDFJS.replace(/\\/g, '/'))
  identity.pdfjsVersion = pdfjsLib.version
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'file://' + NESTED_PDFJS_WORKER.replace(/\\/g, '/')

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    disableWorker: true,
  })
  const pdfDocument = await loadingTask.promise
  identity.pagesRendered = pdfDocument.numPages

  const fieldTypeCounts = {}
  const fieldSamplesByType = {}
  let totalWidgetAnnotations = 0
  const perPage = []

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber)
    const annotations = await page.getAnnotations({ intent: 'display' })
    const widgets = annotations.filter((a) => a.subtype === 'Widget')
    totalWidgetAnnotations += widgets.length
    if (widgets.length) perPage.push({ pageNumber, widgetCount: widgets.length })

    widgets.forEach((annotation) => {
      const type = annotation.fieldType || 'unknown'
      fieldTypeCounts[type] = (fieldTypeCounts[type] || 0) + 1
      if (!fieldSamplesByType[type]) fieldSamplesByType[type] = []
      if (fieldSamplesByType[type].length < 5) {
        fieldSamplesByType[type].push({
          pageNumber,
          fieldName: annotation.fieldName,
          alternativeText: annotation.alternativeText,
          rect: annotation.rect,
          exportValue: annotation.exportValue,
          buttonValue: annotation.buttonValue,
          fieldValue: annotation.fieldValue,
          checkBoxValue: annotation.checkBox ? annotation.fieldValue : undefined,
          radioButton: annotation.radioButton,
          options: annotation.options,
          readOnly: annotation.readOnly,
          required: annotation.required,
        })
      }
    })
  }

  console.log(JSON.stringify({
    identity,
    totalWidgetAnnotations,
    fieldTypeCounts,
    pagesWithWidgets: perPage.length,
    fieldSamplesByType,
  }, null, 2))

  await mongoose.disconnect()
}

main().catch((error) => {
  console.error('POC_SCRIPT_ERROR', error)
  process.exit(1)
})

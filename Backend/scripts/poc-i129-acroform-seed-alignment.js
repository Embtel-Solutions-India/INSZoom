// POC diagnostic ONLY - not wired into any route or production path.
// F-POC Proof 4: verifies that the raw AcroForm field names pdfjs exposes
// at runtime (via the same real stored I-129 PDF the other two
// poc-i129-acroform-*.js scripts already validated) match the field names
// the reviewed i129-h1b-crosswalk.js (consumed by
// form-mapping/seeds/i129-h1b-mapping.seed.js) was authored against.
const path = require('path')
const mongoose = require('mongoose')
const env = require('../src/config/env')
const USCISFormTemplate = require('../src/models/USCISFormTemplate')
const storageService = require('../src/modules/uploads/storage.service')
const { MAPPED_EDGES } = require('../src/modules/form-mapping/config/i129-h1b-crosswalk')

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

  const runtimeNames = new Set()
  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber)
    const annotations = await page.getAnnotations({ intent: 'display' })
    annotations.filter((a) => a.subtype === 'Widget').forEach((a) => { if (a.fieldName) runtimeNames.add(a.fieldName) })
  }

  const seedNames = MAPPED_EDGES.map((edge) => edge.fieldName)
  const matched = seedNames.filter((name) => runtimeNames.has(name))
  const missing = seedNames.filter((name) => !runtimeNames.has(name))

  console.log(JSON.stringify({
    runtimeUniqueFieldNameCount: runtimeNames.size,
    seedFieldCount: seedNames.length,
    matchedCount: matched.length,
    matchRate: `${((matched.length / seedNames.length) * 100).toFixed(1)}%`,
    missing,
    sampleMatched: matched.slice(0, 10),
  }, null, 2))

  await mongoose.disconnect()
}

main().catch((error) => { console.error('POC_SCRIPT_ERROR', error); process.exit(1) })

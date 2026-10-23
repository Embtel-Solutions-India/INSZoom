// Phase 7.8: a built-in sample of the failures the real pipeline recorded (plan section A, E1-E7), as { formCode, stage, state, message, code, status }. replayPipelineHistory.js replays a
// real export of the job history through the same code; this sample lets the replay run (and be tested) with no database. Messages are the real wording of the error sources.
const corpus = [
  { formCode: "I-129", stage: "import", state: "dead_letter", message: 'qpdf binary not found (looked for "C:\\Program Files\\qpdf 12.3.2\\bin\\qpdf.exe")', code: "QPDF_NOT_FOUND" },
  { formCode: "I-131", stage: "import", state: "dead_letter", message: 'qpdf could not be started (tried "qpdf"; the configured path does not exist). Set QPDF_PATH to a working qpdf', code: "QPDF_NOT_FOUND" },
  ...["I-485J", "I-539A", "I-485A", "I-130A", "I-864A", "I-918SUPA"].map((formCode) => ({ formCode, stage: "detect", state: "dead_letter", message: "USCIS page fetch failed: 404", code: "USCIS_FETCH_FAILED", status: 404 })),
  { formCode: "I-765", stage: "import", state: "dead_letter", message: "Could not locate a current PDF for I-765 on its official page", code: "USCIS_PDF_UNRESOLVED", status: 422 },
  { formCode: "I-90", stage: "detect", state: "dead_letter", message: "USCIS page fetch failed: 503", status: 503 },
  { formCode: "I-130", stage: "import", state: "dead_letter", message: "Failed to download USCIS PDF: 502", code: "PDF_DOWNLOAD_FAILED", status: 502 },
  { formCode: "I-140", stage: "import", state: "dead_letter", message: "uscis.gov timed out", code: "ETIMEDOUT" },
  { formCode: "I-751", stage: "import", state: "dead_letter", message: "read ECONNRESET", code: "ECONNRESET" },
  { formCode: "I-864", stage: "import", state: "dead_letter", message: "Downloaded resource is not a PDF", code: "DOWNLOADED_RESOURCE_NOT_PDF", status: 400 },
  { formCode: "N-400", stage: "import", state: "dead_letter", message: "Normalized PDF scan found zero AcroForm fields — aborting import; the form was not stored.", code: "NORMALIZED_SCAN_EMPTY_FIELDS", status: 422 },
  { formCode: "G-639", stage: "import", state: "dead_letter", message: "This PDF is an XFA-only (dynamic) form: it has no fillable AcroForm fields, so it cannot be imported as is.", code: "XFA_ONLY_PDF", status: 422 },
  { formCode: "I-212", stage: "import", state: "dead_letter", message: "The downloaded PDF is incomplete (no end-of-file marker) after a second download", code: "PDF_TRUNCATED", status: 502 },
  { formCode: "I-693", stage: "import", state: "dead_letter", message: "qpdf normalization failed: Command failed: qpdf --object-streams=disable --stream-data=uncompress --decrypt in.pdf out.pdf\nqpdf: in.pdf: file is damaged", code: 2 },
  { formCode: "I-485", stage: "import", state: "dead_letter", message: "BSONObj size: 16801234 (0x1005C32) is invalid. Size must be between 0 and 16793600(16MB)", code: "BSON_TOO_LARGE" },
  { formCode: "I-129", stage: "import", state: "dead_letter", message: "The form template would be 15.20 MB, over the 14.5 MB limit (largest parts: formFields 6.10 MB)", code: "TEMPLATE_TOO_LARGE", status: 413 },
  { formCode: "I-131", stage: "promote", state: "dead_letter", message: "Another promotion of I-131 is in progress", code: "PROMOTION_BUSY", status: 503 },
  { formCode: "I-539", stage: "certify", state: "dead_letter", message: "Certification failed: filled round trip: value not found in the generated PDF", code: "CERTIFICATION_FAILED" },
  { formCode: "I-765", stage: "migrate", state: "dead_letter", message: "case form migration failed for 3 case form(s)", code: "MIGRATION_FAILED" },
  { formCode: "I-907", stage: "map", state: "dead_letter", message: "TypeError: Cannot read properties of undefined (reading 'fieldId')", code: undefined },
  { formCode: "I-824", stage: "map", state: "dead_letter", message: "x is not a function", code: undefined },
  { formCode: "I-129F", stage: "import", state: "dead_letter", message: "Something nobody has seen before happened in the importer", code: "WEIRD_ONE" },
];

module.exports = { corpus };

const { v1: documentai } = require("@google-cloud/documentai");

let client = null;
let clientInitError = null;

function configError(message, code) {
  const error = new Error(message);
  error.statusCode = 503;
  error.code = code || "DOCUMENT_AI_NOT_CONFIGURED";
  return error;
}

function buildCredentials() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL;
  const rawPrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!clientEmail || !rawPrivateKey) return null;
  // .env files can't hold real newlines, so the key is stored with literal
  // "\n" sequences — the SDK needs an actual multi-line PEM string.
  return { client_email: clientEmail, private_key: rawPrivateKey.replace(/\\n/g, "\n") };
}

// Lazy singleton — constructing the client does no network I/O, but this
// still ensures it (and any config-error) only happens on the first actual
// document-processing call, never at module require time / app startup.
function getClient() {
  if (client) return client;
  if (clientInitError) throw clientInitError;
  const credentials = buildCredentials();
  const location = process.env.GOOGLE_CLOUD_LOCATION;
  if (!credentials) {
    clientInitError = configError("Google Document AI service account credentials are not configured");
    throw clientInitError;
  }
  if (!location) {
    clientInitError = configError("GOOGLE_CLOUD_LOCATION is not configured");
    throw clientInitError;
  }
  try {
    client = new documentai.DocumentProcessorServiceClient({
      credentials,
      // Document AI processors are regional — requests must hit the
      // matching regional endpoint or Google returns NOT_FOUND for a
      // processor that otherwise exists.
      apiEndpoint: `${location}-documentai.googleapis.com`,
    });
    return client;
  } catch (error) {
    clientInitError = configError(`Failed to initialize Google Document AI client: ${error.message}`);
    throw clientInitError;
  }
}

function processorName() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const location = process.env.GOOGLE_CLOUD_LOCATION;
  const processorId = process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID;
  if (!projectId || !location || !processorId) {
    throw configError("Google Document AI project/location/processor id is not configured");
  }
  return `projects/${projectId}/locations/${location}/processors/${processorId}`;
}

const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/tiff",
  "image/gif",
  "image/bmp",
  "image/webp",
]);

// Translates a google-gax/gRPC error (numeric .code, not an HTTP status)
// into the { message, statusCode, code } shape errorHandler.js expects.
function translateError(error) {
  const grpcCode = error.code;
  const message = error.details || error.message || "Google Document AI request failed";
  const wrapped = new Error(message);
  switch (grpcCode) {
    case 3: // INVALID_ARGUMENT
      wrapped.statusCode = 422;
      wrapped.code = "DOCUMENT_AI_INVALID_DOCUMENT";
      break;
    case 5: // NOT_FOUND
      wrapped.statusCode = 503;
      wrapped.code = "DOCUMENT_AI_PROCESSOR_NOT_FOUND";
      break;
    case 7: // PERMISSION_DENIED
    case 16: // UNAUTHENTICATED
      wrapped.statusCode = 503;
      wrapped.code = "DOCUMENT_AI_PERMISSION_DENIED";
      break;
    case 4: // DEADLINE_EXCEEDED
      wrapped.statusCode = 504;
      wrapped.code = "DOCUMENT_AI_TIMEOUT";
      break;
    case 8: // RESOURCE_EXHAUSTED
      wrapped.statusCode = 429;
      wrapped.code = "DOCUMENT_AI_QUOTA_EXCEEDED";
      break;
    default:
      wrapped.statusCode = 502;
      wrapped.code = "DOCUMENT_AI_REQUEST_FAILED";
  }
  return wrapped;
}

// Document AI's native response is OCR text + (processor-dependent) typed
// entities — not "answer this prompt as JSON" the way Gemini's
// generateContent is. There's no generic way to turn arbitrary OCR into the
// specific documentType/fields shape a hand-written passport or resume
// prompt expects, so this maps what Document AI actually returns (full text,
// and entities if the configured processor extracts them) into the same
// envelope the registry contract requires, and is conservative about
// confidence when it can't determine a real document type — that pushes the
// result into manual review (see confidenceBand in document-intelligence
// schema) rather than silently mis-classifying.
// Resolves a Document AI TextAnchor (a set of {startIndex, endIndex} offsets
// into the document's own full text) back to the literal substring. Form
// Parser's formFields carry their field name/value this way rather than as
// resolved strings.
function resolveTextAnchor(fullText, textAnchor) {
  if (!textAnchor?.textSegments?.length) return "";
  return textAnchor.textSegments
    .map((segment) => fullText.slice(Number(segment.startIndex || 0), Number(segment.endIndex || 0)))
    .join("");
}

// A "Form Parser" processor (FORM_PARSER_PROCESSOR type, configured by
// pointing GOOGLE_DOCUMENT_AI_PROCESSOR_ID at one in Google Cloud Console -
// no separate env var, no training required) returns page.formFields[] key-
// value pairs instead of (or alongside) document-level entities. A generic
// OCR processor's response simply has no formFields on any page, so this is
// a no-op for that case rather than a second, competing extraction path.
//
// Field keys here are the document's OWN printed label, normalized (lower-
// cased, whitespace collapsed to underscores) - Form Parser has no way to
// know that a passport's printed "Given Names" means this app's canonical
// "firstName", so mapping a specific document type's printed labels to
// canonical field keys is left to that document type's own extractor
// (see passport-extractor.service.js's MRZ path for the one canonical
// mapping this codebase has actually verified end-to-end so far).
function extractFormParserFields(document, rawText) {
  const fields = {};
  for (const page of document?.pages || []) {
    for (const formField of page.formFields || []) {
      const rawKey = resolveTextAnchor(rawText, formField.fieldName?.textAnchor).trim();
      const rawValue = resolveTextAnchor(rawText, formField.fieldValue?.textAnchor).trim();
      if (!rawKey) continue;
      const normalizedKey = rawKey.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
      if (!normalizedKey) continue;
      const confidence = Math.round((formField.fieldValue?.confidence || 0) * 100);
      // Form Parser can emit the same printed label more than once on a
      // multi-page document (e.g. a repeated header) - keep the
      // highest-confidence occurrence rather than the last one seen.
      if (!fields[normalizedKey] || confidence > fields[normalizedKey].confidence) {
        fields[normalizedKey] = { value: rawValue, confidence, rawKey };
      }
    }
  }
  return fields;
}

function shapeResult(document) {
  const rawText = document?.text || "";
  const entities = (document?.entities || []).map((entity) => ({
    type: entity.type,
    mentionText: entity.mentionText || entity.textAnchor?.content || "",
    confidence: Math.round((entity.confidence || 0) * 100),
  }));

  const fields = { ...extractFormParserFields(document, rawText) };
  entities.forEach((entity) => {
    if (!entity.type) return;
    fields[entity.type] = { value: entity.mentionText, confidence: entity.confidence };
  });

  const typeEntity = entities.find((entity) => /^(document_type|type|doc_type)$/i.test(entity.type || ""));
  const overallConfidence = entities.length
    ? Math.round(entities.reduce((sum, entity) => sum + entity.confidence, 0) / entities.length)
    : rawText
      ? 50
      : 0;

  return {
    documentType: typeEntity?.mentionText,
    confidence: typeEntity ? Math.max(typeEntity.confidence, 60) : Math.min(overallConfidence, 60),
    reasoning: typeEntity
      ? `Document type entity "${typeEntity.type}" extracted by the configured Document AI processor.`
      : "Google Document AI processor did not return a document-type entity; classification defaults to manual review.",
    fields,
    entities,
    rawText,
    evidenceCategories: [],
    overallConfidence,
  };
}

async function generateStructuredJson({ buffer, mimeType }) {
  const resolvedMimeType = mimeType || "application/pdf";
  if (!SUPPORTED_MIME_TYPES.has(resolvedMimeType)) {
    const error = new Error(`Unsupported MIME type for Google Document AI: ${resolvedMimeType}`);
    error.statusCode = 422;
    error.code = "DOCUMENT_AI_UNSUPPORTED_MIME_TYPE";
    throw error;
  }
  if (!buffer) {
    const error = new Error("No document buffer supplied to the Document AI provider");
    error.statusCode = 400;
    error.code = "DOCUMENT_AI_MISSING_BUFFER";
    throw error;
  }

  const docAiClient = getClient();
  const name = processorName();

  let result;
  try {
    [result] = await docAiClient.processDocument({
      name,
      rawDocument: { content: Buffer.from(buffer).toString("base64"), mimeType: resolvedMimeType },
    });
  } catch (error) {
    throw translateError(error);
  }

  return shapeResult(result.document);
}

module.exports = {
  generateStructuredJson,
  // Exported for unit testing only (see tests/google-document-ai.form-parser.test.js)
  // - no network I/O, pure response-shaping, safe to call directly against a
  // hand-built fake Document AI response.
  shapeResult,
};

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { shapeResult } = require("../providers/google-document-ai.provider");

// Builds a minimal fake Document AI Document proto shape with one formField,
// resolved via textAnchor offsets into `text` exactly like the real API.
function fakeFormParserDocument() {
  const text = "Given Names\nJOHN\nSurname\nSMITH\n";
  return {
    text,
    entities: [],
    pages: [
      {
        formFields: [
          {
            fieldName: { textAnchor: { textSegments: [{ startIndex: "0", endIndex: "11" }] } },
            fieldValue: { textAnchor: { textSegments: [{ startIndex: "12", endIndex: "16" }] }, confidence: 0.92 },
          },
          {
            fieldName: { textAnchor: { textSegments: [{ startIndex: "17", endIndex: "24" }] } },
            fieldValue: { textAnchor: { textSegments: [{ startIndex: "25", endIndex: "30" }] }, confidence: 0.88 },
          },
        ],
      },
    ],
  };
}

test("shapeResult extracts normalized key/value pairs from Form Parser's formFields", () => {
  const result = shapeResult(fakeFormParserDocument());
  assert.equal(result.fields.given_names.value, "JOHN");
  assert.equal(result.fields.given_names.confidence, 92);
  assert.equal(result.fields.given_names.rawKey, "Given Names");
  assert.equal(result.fields.surname.value, "SMITH");
  assert.equal(result.fields.surname.confidence, 88);
});

test("shapeResult is a no-op for formFields when the response has no pages (generic OCR processor)", () => {
  const result = shapeResult({ text: "just raw OCR text, no structure", entities: [] });
  assert.deepEqual(result.fields, {});
  assert.equal(result.rawText, "just raw OCR text, no structure");
});

test("shapeResult keeps the highest-confidence occurrence when a label repeats across pages", () => {
  const text = "Name\nLOW\nName\nHIGH\n";
  const document = {
    text,
    entities: [],
    pages: [
      { formFields: [{
        fieldName: { textAnchor: { textSegments: [{ startIndex: "0", endIndex: "4" }] } },
        fieldValue: { textAnchor: { textSegments: [{ startIndex: "5", endIndex: "8" }] }, confidence: 0.3 },
      }] },
      { formFields: [{
        fieldName: { textAnchor: { textSegments: [{ startIndex: "9", endIndex: "13" }] } },
        fieldValue: { textAnchor: { textSegments: [{ startIndex: "14", endIndex: "18" }] }, confidence: 0.95 },
      }] },
    ],
  };
  const result = shapeResult(document);
  assert.equal(result.fields.name.value, "HIGH");
  assert.equal(result.fields.name.confidence, 95);
});

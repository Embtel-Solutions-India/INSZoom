// DB-free: the decisions of the form-identity guard (which form a PDF's footers say it is, and when that contradicts the form asked for).
const assert = require("node:assert/strict");
const test = require("node:test");
const { judge, footerNumbers, normalizeFormNumber } = require("../services/FormIdentityService");
const { classifyError } = require("../../form-pipeline/errorClassifier");

test("form numbers are compared in one spelling: supplements fold into a suffix letter", () => {
  assert.equal(normalizeFormNumber("I-485 Supplement J"), "I-485J");
  assert.equal(normalizeFormNumber("I-485SUPPLEMENT J"), "I-485J");
  assert.equal(normalizeFormNumber("I-918SUPA"), "I-918A");
  assert.equal(normalizeFormNumber("g-28"), "G-28");
  assert.equal(normalizeFormNumber("EOIR-29"), "EOIR-29");
});

test("footers are read as form numbers, with the supplement letter", () => {
  const counts = footerNumbers(["Form I-130 Edition 04/01/24 Page 1 of 12", "Form I-130 Edition 04/01/24 Page 2 of 12", "Form I-485 Supplement J Edition 09/18/26 Page 3"]);
  assert.equal(counts.get("I-130"), 2);
  assert.equal(counts.get("I-485J"), 1);
  // the live I-485J prints "Form I-485 Sup J": an abbreviation must read as the same supplement
  const abbreviated = footerNumbers(["Form I-485 Sup J Edition 09/18/26 Page 1 of 8", "Form I-485 Supp. J Edition 09/18/26 Page 2 of 8"]);
  assert.equal(abbreviated.get("I-485J"), 2);
  assert.equal(judge(abbreviated, "I-485J").ok, true);
});

test("a PDF that clearly is another form is refused; a matching or silent one is accepted", () => {
  const eoir = new Map([["EOIR-29", 5]]);
  const refused = judge(eoir, "G-28");
  assert.equal(refused.ok, false);
  assert.equal(refused.found, "EOIR-29");
  assert.equal(judge(eoir, "EOIR-29").ok, true);
  // the main I-485 file stored as its Supplement A is wrong, a Supplement J file stored as I-485J is right
  assert.equal(judge(new Map([["I-485", 6]]), "I-485A").ok, false);
  assert.equal(judge(new Map([["I-485J", 3]]), "I-485 SUPPLEMENT J").ok, true);
  assert.equal(judge(new Map([["I-918A", 4]]), "I-918SUPA").ok, true);
  // no footer number at all: inconclusive, the import goes on
  assert.deepEqual(judge(new Map(), "I-130"), { ok: true, inconclusive: true });
  // a bundle printing its parent's number as well is fine; one stray footer among several is not enough to refuse
  assert.equal(judge(new Map([["I-129", 3], ["I-129CW", 1]]), "I-129CW").ok, true);
  assert.equal(judge(new Map([["I-130", 5], ["I-485", 1]]), "I-765").ok, false);
  assert.equal(judge(new Map([["I-485", 1], ["I-130", 1]]), "I-765").ok, true);
});

test("the pipeline treats a wrong-form PDF as a permanent block, never a retry", () => {
  const error = Object.assign(new Error("The downloaded PDF is Form EOIR-29, not G-28"), { code: "FORM_PDF_MISMATCH", status: 422 });
  const result = classifyError(error);
  assert.equal(result.retryable, false);
  assert.equal(result.code, "FORM_PDF_MISMATCH");
});

test("reading a PDF's footers and parsing it with pdf-parse in ONE process never clash (one pdfjs version)", async () => {
  const { PDFDocument, StandardFonts } = require("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= 2; index += 1) doc.addPage([612, 792]).drawText(`Form I-485 Sup A Edition 09/18/26 Page ${index} of 2`, { x: 40, y: 30, size: 9, font });
  const bytes = await doc.save();
  const { check } = require("../services/FormIdentityService");
  assert.deepEqual(await check(Buffer.from(bytes), "I-485 SUPPLEMENT A"), { ok: true });
  assert.equal((await check(Buffer.from(bytes), "I-485")).ok, false);
  const { PDFParse } = require("pdf-parse");
  const text = await new PDFParse({ data: new Uint8Array(bytes) }).getText(); // would throw "API version ... does not match the Worker version" with two pdfjs versions
  assert.match(String(text.text), /I-485 Sup A/);
  assert.equal((await check(Buffer.from(bytes), "I-485SUPA")).ok, true); // and mine still works after pdf-parse has run
});

test("footer wording in any case, with Sup / Supp / Supp. / Supplement, reads as the same form", () => {
  for (const footer of ["form i-485 sup j edition 09/18/26", "FORM I-485 SUPP. J EDITION 09/18/26", "Form I-485 Supp J Edition 09/18/26", "Form I-485 supplement j Edition 09/18/26"]) {
    assert.equal(judge(footerNumbers([footer, footer]), "I-485 Supplement J").ok, true, footer);
    assert.equal(judge(footerNumbers([footer, footer]), "i-485 sup j").ok, true, footer);
    assert.equal(judge(footerNumbers([footer, footer]), "I-485").ok, false, footer);
  }
});

test("the edition date printed in the footers: two- or four-digit year, most frequent wins", () => {
  const { footerEditionOf } = require("../services/FormIdentityService");
  assert.equal(footerEditionOf(["Form G-325R Edition 09/04/26 Page 1 of 4", "Form G-325R Edition 09/04/26 Page 2 of 4"]), "2026-09-04");
  assert.equal(footerEditionOf(["Form G-639 Edition 12/12/2024 Page 1"]), "2024-12-12");
  assert.equal(footerEditionOf(["Form X-1 Edition 1/2/25", "Form X-1 Edition 1/2/25", "Edition 03/03/20"]), "2025-01-02");
  assert.equal(footerEditionOf(["no edition printed here"]), null);
  assert.equal(footerEditionOf(["Edition 13/45/26"]), null);
});

// Phase 7.8 simulation: damaged / unusual PDFs and pages the fake uscis.gov can serve. Everything is built in memory (pdf-lib); the password-protected file needs the qpdf the project
// already uses (it is skipped with a reason when qpdf is not installed).
const os = require("os");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { PDFDocument, PDFName, PDFString } = require("pdf-lib");

const exec = promisify(execFile);

/** A PDF whose only form is a dynamic XFA layer: an /XFA entry, an empty /Fields list, no fillable boxes. */
async function buildXfaOnly() {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]).drawText("Form SIM-1 (dynamic form: open in Adobe Reader)", { x: 40, y: 740, size: 10 });
  const xfa = doc.context.stream("<xdp:xdp xmlns:xdp=\"http://ns.adobe.com/xdp/\"><template/></xdp:xdp>");
  const acroForm = doc.context.obj({ Fields: [], XFA: [PDFString.of("template"), doc.context.register(xfa)] });
  doc.catalog.set(PDFName.of("AcroForm"), doc.context.register(acroForm));
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/** The same bytes with the tail cut off: no %%EOF near the end (a transfer that stopped early). */
function truncate(buffer, cut = 2600) {
  if (buffer.length <= cut + 64) throw new Error("the PDF is too small to cut");
  return buffer.subarray(0, buffer.length - cut);
}

/** The PDF behind a leading banner (junk before %PDF-). */
const withJunk = (buffer, junk = "\r\n<!-- cdn banner -->\r\n") => Buffer.concat([Buffer.from(junk), buffer]);

/** A password-protected PDF (a real user password; nothing here knows it). null when qpdf is not available. */
async function buildPasswordProtected(buffer, qpdfBinary) {
  if (!qpdfBinary) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "edition-sim-pw-"));
  try {
    const input = path.join(dir, "in.pdf");
    const output = path.join(dir, "out.pdf");
    fs.writeFileSync(input, buffer);
    await exec(qpdfBinary, ["--encrypt", "user-secret", "owner-secret", "256", "--", input, output], { timeout: 30000 });
    return fs.readFileSync(output);
  } catch {
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const page = (body) => `<!doctype html><html><head><title>USCIS</title></head><body>${body}</body></html>`;
const link = (href, text) => `<a href="${href}">${text}</a>`;

module.exports = { buildXfaOnly, truncate, withJunk, buildPasswordProtected, page, link };

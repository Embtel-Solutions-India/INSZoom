// Runs in its OWN child process (started by pdfSlicer.js with child_process.fork), never in the web server process: parsing a 200 MB,
// 700-page petition and copying pages out of it is CPU- and memory-heavy, and a separate process keeps every web request fast while a scan
// runs. It is a process and not a worker thread on purpose: terminating a worker thread that has run pdf.js crashes the whole Node process
// (segmentation fault, seen while building this), and a crash or out-of-memory here must never take the server down.
//
// Two readers, so a petition is always readable in some form (every error has a backup):
//   - "pdf"  mode: pdf-lib copies pages into small PDF slices (the AI then sees the real page: typed AND scanned)
//   - "text" mode: when pdf-lib cannot read the file (password / permission encryption, damaged structure) pdf.js - which decrypts
//                  owner-password PDFs and tolerates broken files - extracts each page's text instead
// pdf.js text is ALSO available in "pdf" mode (request "text"), used when the AI refuses a PDF slice and the same pages are re-sent as text.
//
// Messages (each carries an `id`, answered with { id, ok, ... }; failures answer { ok: false, code, message }):
//   { type: "load", bytes }       -> { pages, mode: "pdf" | "text", fallbackReason }
//   { type: "slice", from, to }   -> { bytes }                       pdf mode only
//   { type: "text", from, to }    -> { pages: [{ page, text }] }     both modes
//   { type: "close" }             -> {}
// IPC with the parent process (fork, serialization "advanced": Buffers / typed arrays travel as binary)
const send = (message) => { if (process.connected) process.send(message); };
const { PDFDocument } = require("pdf-lib");
const { PDF_ERROR } = require("./constants");

let raw = null; // the petition bytes (kept for the pdf.js reader, opened only if text is needed)
let source = null; // pdf-lib document ("pdf" mode)
let textDoc = null; // pdf.js document (opened lazily)
let mode = null;

function fail(code, message) {
  return Object.assign(new Error(message || code), { code });
}

async function openTextReader() {
  if (textDoc) return textDoc;
  const { loadPdfjs } = require("../../utils/pdfjsShared");
  const pdfjs = await loadPdfjs();
  // a copy: pdf.js may take ownership of the array it is given
  textDoc = await pdfjs.getDocument({ data: raw.slice(), verbosity: 0, isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise;
  return textDoc;
}

async function load(bytes, forceText = false) {
  raw = bytes;
  source = null;
  textDoc = null;
  mode = null;
  let primaryError = forceText ? fail(PDF_ERROR.UNREADABLE, "pdf-lib hung or crashed on this file") : null;
  if (!forceText) try {
    source = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
    const pages = source.getPageCount();
    if (pages > 0) {
      mode = "pdf";
      return { pages, mode, fallbackReason: null };
    }
    primaryError = fail(PDF_ERROR.EMPTY, "The petition PDF has no pages.");
  } catch (error) {
    primaryError = /encrypted/i.test(error.message)
      ? fail(PDF_ERROR.ENCRYPTED, "The petition PDF is encrypted.")
      : fail(PDF_ERROR.UNREADABLE, `pdf-lib could not read the petition: ${String(error.message || "").slice(0, 200)}`);
  }
  source = null;
  // backup reader
  try {
    const doc = await openTextReader();
    if (doc.numPages > 0) {
      mode = "text";
      return { pages: doc.numPages, mode, fallbackReason: primaryError.code };
    }
  } catch (fallbackError) {
    if (/password/i.test(fallbackError?.message || "") || fallbackError?.name === "PasswordException") {
      throw fail(PDF_ERROR.ENCRYPTED, "The petition PDF is protected by an opening password and cannot be read. Upload an unprotected copy.");
    }
  }
  raw = null;
  if (primaryError.code === PDF_ERROR.EMPTY) throw primaryError;
  throw fail(primaryError.code === PDF_ERROR.ENCRYPTED ? PDF_ERROR.ENCRYPTED : PDF_ERROR.UNREADABLE, primaryError.code === PDF_ERROR.ENCRYPTED
    ? "The petition PDF is encrypted and neither reader could open it. Upload an unprotected copy."
    : "The petition PDF is damaged and neither reader could open it. Upload the file again.");
}

function pageCount() {
  if (mode === "pdf") return source.getPageCount();
  if (mode === "text") return textDoc.numPages;
  return 0;
}

function checkRange(from, to) {
  if (!mode) throw fail(PDF_ERROR.NOT_LOADED, "No petition is loaded in the reader.");
  const total = pageCount();
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > total) {
    throw fail(PDF_ERROR.BAD_RANGE, `Pages ${from}-${to} are outside 1-${total}.`);
  }
}

async function slice(from, to) {
  checkRange(from, to);
  if (mode !== "pdf") throw fail(PDF_ERROR.UNREADABLE, "This petition can only be read as text.");
  const out = await PDFDocument.create();
  const indices = [];
  for (let page = from; page <= to; page += 1) indices.push(page - 1);
  const copied = await out.copyPages(source, indices);
  copied.forEach((page) => out.addPage(page));
  return out.save({ useObjectStreams: true });
}

async function text(from, to) {
  checkRange(from, to);
  const doc = await openTextReader();
  const pages = [];
  for (let page = from; page <= to; page += 1) {
    try {
      const pdfPage = await doc.getPage(page);
      const content = await pdfPage.getTextContent();
      pages.push({ page, text: content.items.map((item) => (item.hasEOL ? `${item.str}\n` : item.str)).join(" ").replace(/[ \t]+/g, " ").trim() });
      pdfPage.cleanup();
    } catch (_error) {
      pages.push({ page, text: "" }); // one unreadable page never fails the others; an empty page becomes an `unreadable_page` finding
    }
  }
  return pages;
}

process.on("disconnect", () => process.exit(0)); // the parent went away: never linger

process.on("message", async (message) => {
  const { id, type } = message || {};
  try {
    if (type === "load") {
      send({ id, ok: true, ...(await load(message.bytes, Boolean(message.forceText))) });
    } else if (type === "slice") {
      const bytes = await slice(message.from, message.to);
      send({ id, ok: true, bytes });
    } else if (type === "text") {
      send({ id, ok: true, pages: await text(message.from, message.to) });
    } else if (type === "close") {
      if (textDoc) await textDoc.destroy().catch(() => {});
      raw = null;
      source = null;
      textDoc = null;
      mode = null;
      send({ id, ok: true });
    } else {
      send({ id, ok: false, code: PDF_ERROR.BAD_RANGE, message: `Unknown request "${type}"` });
    }
  } catch (error) {
    send({ id, ok: false, code: error.code || PDF_ERROR.UNREADABLE, message: String(error.message || "PDF error").slice(0, 500) });
  }
});

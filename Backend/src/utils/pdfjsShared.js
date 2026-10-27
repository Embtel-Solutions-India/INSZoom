// The ONE pdfjs build the pdf-parse package (used by the form importer, component discovery and the component checks) runs on.
//
// pdfjs registers its worker globally for the whole Node process, and two different versions in one process refuse to work together ("The API version 5.4.296 does not match the
// Worker version 6.2.108"). pdf-parse carries its own nested pdfjs-dist; the project's top-level pdfjs-dist is a different version. Anything that reads a PDF's text layer directly
// (page headings, printed labels, form identity) must therefore load pdfjs from pdf-parse's own location, never `import("pdfjs-dist/...")`, so there is only ever one version.
const path = require("path");
const { createRequire } = require("module");
const { pathToFileURL } = require("url");

let cached = null;

function resolvePdfjsFile() {
  // resolve "pdfjs-dist" the way pdf-parse itself does (its nested copy when it has one, else the shared one)
  const fromPdfParse = createRequire(require.resolve("pdf-parse"));
  try {
    return fromPdfParse.resolve("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (_error) {
    return path.join(path.dirname(fromPdfParse.resolve("pdfjs-dist/package.json")), "legacy", "build", "pdf.mjs");
  }
}

/** The pdfjs module (legacy build, Node-safe). Cached; the same module object every time. */
async function loadPdfjs() {
  if (!cached) cached = import(pathToFileURL(resolvePdfjsFile()).href);
  return cached;
}

module.exports = { loadPdfjs, resolvePdfjsFile };

// Tests only. PDFRenderer reads official template bytes from managed storage ONLY (never from a path on disk - see
// PDFRenderer.loadTemplateBuffer), so a DB-free test hands it a template through a storage key instead of pdfTemplatePath.
// useLocalTemplateStorage(test) swaps storage reads for keys made by storedTemplate(path) to read that local file, and turns
// every storage WRITE into an in-memory record (the renderer stores a normalized copy back) so a test can never touch the real
// bucket. Everything is restored after the test file.
const fs = require("node:fs/promises");
const storageService = require("../../../uploads/storage.service");

const PREFIX = "test-local-file:";

function useLocalTemplateStorage(test) {
  const originalRead = storageService.readBuffer;
  const originalStore = storageService.storeBuffer;
  const stored = new Map();
  storageService.readBuffer = async (key, ...rest) => {
    const name = String(key || "");
    if (stored.has(name)) return stored.get(name);
    if (name.startsWith(PREFIX)) return fs.readFile(name.slice(PREFIX.length));
    return originalRead.call(storageService, key, ...rest);
  };
  storageService.storeBuffer = async (key, buffer) => {
    stored.set(String(key || ""), Buffer.from(buffer));
    return { key, stored: "memory" };
  };
  test.after(() => {
    storageService.readBuffer = originalRead;
    storageService.storeBuffer = originalStore;
  });
  return stored;
}

/** Template fields that point the renderer at a local PDF through storage. */
const storedTemplate = (filePath) => ({ pdfStorageKey: `${PREFIX}${filePath}` });

module.exports = { useLocalTemplateStorage, storedTemplate };

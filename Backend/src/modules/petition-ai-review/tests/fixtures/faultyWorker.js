// Test-only reader process: the real petition reader (pdfSliceWorker.js) with a fault injected, to prove the automatic backups.
//   PETITION_TEST_FAULT=crash-once  -> the first "slice" request (across workers, tracked by a marker file) kills the worker
//   PETITION_TEST_FAULT=crash-always -> every "slice" request kills the worker
//   PETITION_TEST_FAULT=hang-load    -> a normal "load" hangs forever (a forced text load works)
const fs = require("fs");

const fault = process.env.PETITION_TEST_FAULT || "";
const marker = process.env.PETITION_TEST_MARKER || "";

// registered BEFORE the real worker, so it sees each message first
process.on("message", (message) => {
  if (message?.type === "slice" && fault === "crash-always") process.exit(3);
  if (message?.type === "slice" && fault === "crash-once" && marker && !fs.existsSync(marker)) {
    fs.writeFileSync(marker, "crashed");
    process.exit(3);
  }
  if (message?.type === "load" && fault === "hang-load" && !message.forceText) {
    for (;;) { /* never answers: the main thread's load timeout must fire */ }
  }
});

require("../../pdfSliceWorker");

// Server side of the petition page reader (Petition AI Review). All PDF work happens in a separate child process (pdfSliceWorker.js), so the
// API stays responsive while a 500-700 page petition is processed, and a crash / out-of-memory in the reader can never take the server down.
//
//   const reader = await PdfSlicer.open(buffer)   // parses once; reader.pages, reader.mode ("pdf" | "text"), reader.fallbackReason
//   await reader.slice(5, 8)                      // Buffer: a small PDF with pages 5-8          (pdf mode)
//   await reader.text(5, 8)                       // [{ page, text }] for pages 5-8              (both modes)
//   await reader.close()                          // always (finally): ends the reader process and frees its memory
//
// Backups built in (no failure needs a person):
//   - pdf-lib cannot read the file (encrypted / damaged) -> the reader switches to the pdf.js text reader ("text" mode)
//   - pdf-lib hangs or crashes while opening the file    -> a fresh reader process opens it with the pdf.js text reader at once
//   - the reader process crashes, hangs or runs out of memory -> a fresh one is started and the request retried (up to `restarts` times)
// Every remaining failure is a PdfSliceError with a PDF_ERROR code.
const path = require("path");
const { fork } = require("child_process");
const { PDF_ERROR } = require("./constants");

const WORKER_FILE = path.join(__dirname, "pdfSliceWorker.js");
const RESTARTABLE = new Set([PDF_ERROR.SLICER_CRASHED, PDF_ERROR.SLICER_TIMEOUT]);

class PdfSliceError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "PdfSliceError";
    this.code = code;
  }
}

// One reader child process and its pending requests.
class WorkerChannel {
  constructor({ timeoutMs, maxMemoryMb, workerFile }) {
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.nextId = 1;
    this.closed = false;
    this.exited = false;
    // "advanced" serialization carries Buffers / typed arrays as binary; the heap cap keeps a pathological PDF from eating the machine's memory
    this.child = fork(workerFile, [], {
      serialization: "advanced",
      execArgv: [`--max-old-space-size=${maxMemoryMb}`],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true,
    });
    this.exitPromise = new Promise((resolve) => this.child.once("exit", resolve));
    this.child.on("message", (message) => this.settle(message));
    this.child.on("error", (error) => this.failAll(new PdfSliceError(PDF_ERROR.SLICER_CRASHED, `The PDF reader stopped: ${error.message}`)));
    this.child.on("exit", (code, signal) => {
      this.exited = true;
      this.closed = true;
      this.failAll(new PdfSliceError(PDF_ERROR.SLICER_CRASHED, `The PDF reader exited (${signal || `code ${code}`}).`));
    });
  }

  request(payload, timeoutMs = this.timeoutMs) {
    if (this.closed) return Promise.reject(new PdfSliceError(PDF_ERROR.SLICER_CRASHED, "The PDF reader is closed."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new PdfSliceError(PDF_ERROR.SLICER_TIMEOUT, `The PDF reader did not answer within ${Math.round(timeoutMs / 1000)} s.`));
        this.close().catch(() => {});
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child.send({ ...payload, id });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new PdfSliceError(PDF_ERROR.SLICER_CRASHED, `The PDF reader could not be reached: ${error.message}`));
      }
    });
  }

  settle(message) {
    const entry = this.pending.get(message?.id);
    if (!entry) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message);
    else entry.reject(new PdfSliceError(message.code || PDF_ERROR.UNREADABLE, message.message));
  }

  failAll(error) {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }

  async close() {
    this.closed = true;
    this.failAll(new PdfSliceError(PDF_ERROR.SLICER_CRASHED, "The PDF reader was closed."));
    if (this.exited) return;
    try {
      this.child.kill();
    } catch (_error) {
      /* already gone */
    }
    // wait (bounded) for the process to be gone, so nothing outlives a scan
    await Promise.race([this.exitPromise, new Promise((resolve) => setTimeout(resolve, 5000).unref())]);
  }
}

class PdfSlicer {
  constructor(buffer, options) {
    this.buffer = buffer; // the caller's buffer; only ever copied (never detached or changed)
    this.options = options;
    this.channel = null;
    this.closed = false;
    this.restartsLeft = options.restarts;
    this.pages = 0;
    this.mode = null;
    this.fallbackReason = null;
  }

  /**
   * Starts a reader process, parses the petition and returns a ready reader.
   * options: timeoutMs (per request), maxMemoryMb (reader heap), restarts (automatic reader restarts allowed), workerFile (tests only)
   */
  static async open(buffer, { timeoutMs = 5 * 60 * 1000, loadTimeoutMs = 2 * 60 * 1000, maxMemoryMb = 1536, restarts = 2, workerFile = WORKER_FILE } = {}) {
    if (!buffer || !buffer.length) throw new PdfSliceError(PDF_ERROR.EMPTY, "The petition file is empty.");
    const reader = new PdfSlicer(buffer, { timeoutMs, loadTimeoutMs, maxMemoryMb, restarts, workerFile });
    try {
      await reader.start();
      return reader;
    } catch (error) {
      await reader.close();
      throw error;
    }
  }

  // Parses the petition in a fresh reader process. If pdf-lib hangs or crashes on this file, a second fresh process opens it
  // with the backup text reader straight away (a restart that re-tried pdf-lib would just hang again). A reader already in text mode
  // restarts in text mode.
  async load(forceText) {
    if (this.channel) await this.channel.close();
    this.channel = new WorkerChannel(this.options);
    // a copy (structured clone), so the cached petition buffer the rest of the app uses stays intact
    return this.channel.request({ type: "load", bytes: new Uint8Array(this.buffer), forceText }, this.options.loadTimeoutMs);
  }

  async start() {
    let reply;
    try {
      reply = await this.load(this.mode === "text");
    } catch (error) {
      if (!RESTARTABLE.has(error.code) || this.mode === "text") throw error;
      reply = await this.load(true);
    }
    this.pages = reply.pages;
    this.mode = reply.mode;
    this.fallbackReason = reply.fallbackReason || null;
  }

  // Runs a request; when the reader process crashed or hung, starts a fresh one (bounded) and asks again.
  async run(payload) {
    if (this.closed) throw new PdfSliceError(PDF_ERROR.SLICER_CRASHED, "The PDF reader is closed.");
    for (;;) {
      try {
        return await this.channel.request(payload);
      } catch (error) {
        if (this.closed || !RESTARTABLE.has(error.code) || this.restartsLeft <= 0) throw error;
        this.restartsLeft -= 1;
        await this.start();
      }
    }
  }

  /** A small PDF (Buffer) with pages from..to, 1-based and inclusive. Only in "pdf" mode. */
  async slice(from, to) {
    const reply = await this.run({ type: "slice", from, to });
    return Buffer.from(reply.bytes);
  }

  /** The text of pages from..to: [{ page, text }] (a page that cannot be read has text ""). Works in both modes. */
  async text(from, to) {
    const reply = await this.run({ type: "text", from, to });
    return reply.pages;
  }

  /** Ends the reader process. Safe to call more than once. */
  async close() {
    this.closed = true;
    this.buffer = null;
    if (this.channel) await this.channel.close();
  }
}

module.exports = { PdfSlicer, PdfSliceError };

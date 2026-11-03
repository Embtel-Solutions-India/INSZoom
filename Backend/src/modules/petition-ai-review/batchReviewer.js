// Reviews ONE batch of petition pages with every automatic backup applied (Petition AI Review). Used by the Phase 3 worker.
//
//   const reviewer = createBatchReviewer({ reader, caller, fallbackCaller, systemInstruction });
//   const result = await reviewer.review({ from: 5, to: 8 });
//   // result: { findings, gaps, diagnostics, calls, tokens, models, requeue, usedFallback }
//
// Backups, applied in code - no failure needs a person:
//   answer cut off (TRUNCATED)              -> batch halved and re-sent, down to one page; a single page then goes as text
//   blocked / empty answer for a PDF slice  -> same pages re-sent as extracted TEXT; if still blocked, halved to find the page;
//                                              a single page that still fails becomes an `unreadable_page` finding (never skipped)
//   answer is not valid JSON                -> re-asked once with a stricter repair prompt; then halved; then the batch is re-queued
//   slice too large to attach / slicer fails -> halved, then text mode
//   5xx / timeout (after the caller's own backoff retries) -> `requeue: true`: the worker comes back to these pages at the end
//   billing 402 / quota 429 / rejected request / no key -> the backup provider (text mode), if one is configured;
//                                              otherwise a PetitionAiError with `stopsRun: true` (the worker pauses and resumes itself)
// review() only ever resolves with a result or rejects with a stopsRun PetitionAiError - nothing else escapes.
const { AI_ERROR, RUN_STOPPING_ERRORS } = require("./constants");
const { splitBatch } = require("./batchPlanner");
const { PetitionAiError } = require("./petitionGemini");
const { RESPONSE_SCHEMA, buildBatchPrompt, buildRepairPrompt } = require("./prompt");
const { parseAnswer, validateAnswer, dedupeFindings, unreadableFinding } = require("./findingValidator");

const MAX_INLINE_BYTES = 15 * 1024 * 1024; // Gemini's inline request limit is 20 MB including base64 growth (x 1.34)
const FALLBACK_ON = new Set([...RUN_STOPPING_ERRORS]);

function createBatchReviewer({ reader, caller, fallbackCaller = null, systemInstruction = "", maxInlineBytes = MAX_INLINE_BYTES }) {
  let useFallback = false; // once Gemini stopped for billing / quota, the rest of this scan goes to the backup straight away

  async function review(batch) {
    const out = { findings: [], gaps: [], diagnostics: [], calls: 0, tokens: 0, models: new Set(), requeue: false, usedFallback: false };
    try {
      await reviewPart(batch, reader?.mode === "text" ? "text" : "pdf", out);
    } catch (error) {
      if (error instanceof PetitionAiError && error.stopsRun) throw error;
      // Anything unexpected (a bug, a reader that vanished): the pages come back at the end instead of failing the scan.
      out.diagnostics.push(diag(batch, "UNEXPECTED", { note: String(error?.message || error).slice(0, 300) }));
      out.requeue = true;
      out.gaps.push({ from: batch.from, to: batch.to, reason: "unexpected error - will retry", retry: true });
    }
    out.findings = dedupeFindings(out.findings);
    out.models = [...out.models];
    return out;
  }

  async function reviewPart(batch, mode, out) {
    let parts;
    if (mode === "pdf") {
      let bytes;
      try {
        bytes = await reader.slice(batch.from, batch.to);
      } catch (error) {
        out.diagnostics.push(diag(batch, error?.code || "PDF_ERROR", { note: `slice failed, using text: ${error?.message || error}` }));
        return reviewPart(batch, "text", out);
      }
      if (bytes.length > maxInlineBytes) {
        const halves = splitBatch(batch);
        out.diagnostics.push(diag(batch, "SLICE_TOO_LARGE", { note: `${Math.round(bytes.length / 1048576)} MB - ${halves ? "halved" : "sent as text"}` }));
        if (halves) { for (const half of halves) await reviewPart(half, "pdf", out); return; }
        return reviewPart(batch, "text", out);
      }
      parts = [{ inlineData: { mimeType: "application/pdf", data: Buffer.from(bytes).toString("base64") } }, { text: buildBatchPrompt({ batch, mode }) }];
    } else {
      let pagesText;
      try {
        pagesText = await reader.text(batch.from, batch.to);
      } catch (error) {
        return markUnreadable(batch, `the page text could not be read (${error?.code || "error"})`, out);
      }
      // Pages with no text at all (a scanned image read in text mode) cannot be reviewed as text: flagged, not sent.
      const empty = pagesText.filter((item) => !String(item?.text || "").trim()).map((item) => item.page);
      if (empty.length === pagesText.length) return markUnreadable(batch, "no readable text on the page", out);
      for (const page of empty) markUnreadable({ from: page, to: page }, "no readable text on the page", out);
      parts = [{ text: buildBatchPrompt({ batch, mode, pagesText }) }];
    }
    return send(batch, mode, parts, out);
  }

  async function send(batch, mode, parts, out) {
    const active = useFallback && fallbackCaller ? fallbackCaller : caller;
    if (active === fallbackCaller && mode === "pdf") return reviewPart(batch, "text", out); // the backup takes text only
    let reply;
    try {
      reply = await callAndCount(active, { parts, systemInstruction, responseSchema: RESPONSE_SCHEMA }, batch, out);
    } catch (error) {
      return recover(error, batch, mode, out, active);
    }
    let answer = parseAnswer(reply.text);
    if (!answer) {
      try {
        const repaired = await callAndCount(active, { parts: [{ text: buildRepairPrompt(reply.text) }], systemInstruction, responseSchema: RESPONSE_SCHEMA }, batch, out, "repair");
        answer = parseAnswer(repaired.text);
      } catch (error) {
        if (error instanceof PetitionAiError && error.stopsRun) throw error;
      }
    }
    if (!answer) return recover(new PetitionAiError(AI_ERROR.BAD_OUTPUT, "answer was not valid JSON after a repair attempt"), batch, mode, out, active);
    const { findings, unreadablePages, dropped } = validateAnswer(answer, batch);
    out.findings.push(...findings);
    for (const page of unreadablePages) markUnreadable({ from: page, to: page }, "the AI reported the page as unreadable", out);
    if (dropped.outOfRange || dropped.invalid) out.diagnostics.push(diag(batch, "DROPPED", { note: `${dropped.outOfRange} outside the pages sent, ${dropped.invalid} incomplete` }));
  }

  async function callAndCount(active, request, batch, out, label = "") {
    try {
      const reply = await active.call(request);
      out.calls += reply.attempts || 1;
      out.tokens += reply.tokens || 0;
      out.models.add(reply.model);
      if (active === fallbackCaller) out.usedFallback = true;
      out.diagnostics.push(diag(batch, "OK", { finishReason: reply.finishReason, model: reply.model, tokens: reply.tokens, latencyMs: reply.latencyMs, note: [label, active === fallbackCaller ? "backup AI" : ""].filter(Boolean).join(", ") }));
      return reply;
    } catch (error) {
      if (!(error instanceof PetitionAiError)) throw new PetitionAiError(AI_ERROR.UPSTREAM, String(error?.message || error));
      out.calls += error.attempts || 1;
      out.tokens += error.tokens || 0;
      out.diagnostics.push(diag(batch, error.code, { finishReason: error.finishReason, model: error.model, tokens: error.tokens, latencyMs: error.latencyMs, note: String(error.note || "").slice(0, 300) }));
      throw error;
    }
  }

  async function recover(error, batch, mode, out, active) {
    const code = error?.code;
    if (FALLBACK_ON.has(code)) {
      if (active !== fallbackCaller && fallbackCaller) {
        useFallback = true;
        return reviewPart(batch, "text", out);
      }
      throw new PetitionAiError(code, error.note, { stopsRun: true, httpStatus: error.httpStatus });
    }
    const halves = splitBatch(batch);
    if (code === AI_ERROR.TRUNCATED) {
      if (halves) { for (const half of halves) await reviewPart(half, mode, out); return; }
      if (mode === "pdf") return reviewPart(batch, "text", out);
      return markUnreadable(batch, "the AI's answer for this page was too long", out);
    }
    if (code === AI_ERROR.BLOCKED || code === AI_ERROR.EMPTY_RESPONSE) {
      if (mode === "pdf") return reviewPart(batch, "text", out);
      if (halves) { for (const half of halves) await reviewPart(half, "text", out); return; }
      return markUnreadable(batch, code === AI_ERROR.BLOCKED ? "the AI refused to read this page" : "the AI returned nothing for this page", out);
    }
    if (code === AI_ERROR.BAD_OUTPUT && halves) { for (const half of halves) await reviewPart(half, mode, out); return; }
    // UPSTREAM / TIMEOUT (already retried by the caller), BAD_OUTPUT on one page: come back to these pages at the end of the scan.
    out.requeue = true;
    out.gaps.push({ from: batch.from, to: batch.to, reason: `${code || "error"} - will retry`, retry: true });
  }

  function markUnreadable(batch, reason, out) {
    for (let page = batch.from; page <= batch.to; page += 1) out.findings.push(unreadableFinding(page, reason));
    out.gaps.push({ from: batch.from, to: batch.to, reason });
  }

  return { review, get usingFallback() { return useFallback; } };
}

function diag(batch, outcome, extra = {}) {
  return { from: batch.from, to: batch.to, outcome, finishReason: extra.finishReason || undefined, model: extra.model || undefined, tokens: extra.tokens || 0, latencyMs: extra.latencyMs || 0, note: extra.note || "", at: new Date() };
}

module.exports = { createBatchReviewer, MAX_INLINE_BYTES };

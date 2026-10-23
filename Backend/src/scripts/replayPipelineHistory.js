#!/usr/bin/env node
// Phase 7.8: REPLAY of recorded pipeline failures against the error-resolution engine. READ-ONLY: it never writes to any database, never calls uscis.gov and sends nothing.
// For each recorded failure (stage + stored message + code) it asks the real Diagnoser and the real Resolver what the engine would do NOW, and gives a verdict:
//   strategies_planned  the engine has one or more verified alternatives to try, then a documented hold (nothing ends "dead and unexplained")
//   backoff_retry       a passing blip with no alternative (a busy promotion): the job's own backoff retries it, then it becomes a documented hold
//   own_code_bug        a programming error in our own code: the only thing that stays dead-letter (its signature is kept)
//   uncovered           no strategy is planned and it is not a programming error: a gap to close by adding a catalog strategy
//
//   node src/scripts/replayPipelineHistory.js                    the built-in sample of real failures (test-utils/editionSim/historyCorpus.js)
//   node src/scripts/replayPipelineHistory.js --file export.json an export: an array of { formCode, stage, message, code, status } or of raw job documents
//   node src/scripts/replayPipelineHistory.js --db               reads the job history of the CONFIGURED database (find only; a read, never a write)
//   add --json for machine-readable output. Exit code 1 when any record is "uncovered".
const fs = require("fs");
const path = require("path");

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

/** A stored failure -> an Error shaped like the original (name from a "TypeError: ..." prefix, code, status). */
function toError(record) {
  const message = String(record.message || record.error?.message || "");
  const named = /^(TypeError|ReferenceError|RangeError|SyntaxError):\s*(.*)$/s.exec(message);
  const error = named ? new ({ TypeError, ReferenceError, RangeError, SyntaxError })[named[1]](named[2]) : new Error(message);
  const code = record.code ?? record.error?.code;
  const status = record.status ?? record.error?.status;
  if (code !== undefined && code !== null) error.code = code;
  if (status) { error.status = status; error.statusCode = status; }
  return error;
}

/** Raw FormPipelineJob documents -> flat records (its last error, and every stage that failed). Pure. */
function recordsFromJobs(jobs) {
  const out = [];
  for (const job of jobs || []) {
    if (job.message !== undefined && job.stage !== undefined) { out.push(job); continue; } // already flat
    const base = { formCode: job.formCode, state: job.state };
    if (job.lastError?.message) out.push({ ...base, stage: job.lastError.stage || job.currentStage || null, message: job.lastError.message, code: job.lastError.code });
    for (const [stage, info] of Object.entries(job.stages || {})) if (info?.status === "failed" && info.error?.message) out.push({ ...base, stage, message: info.error.message, code: info.error.code });
  }
  return out;
}

async function replayRecord(record, resolver) {
  const { diagnose } = require("../modules/form-pipeline/resolution");
  const { classifyError } = require("../modules/form-pipeline/errorClassifier");
  const error = toError(record);
  const stage = record.stage || null;
  const planned = await resolver.plan({ error, stage, job: { formCode: record.formCode, attempts: 1 }, ctx: {} }).catch((failure) => ({ diagnosis: diagnose({ error, stage }), planned: [], failure: failure.message }));
  const diagnosis = planned.diagnosis;
  const classification = classifyError(error, diagnosis);
  const verdict = diagnosis.cause === "programming_error" ? "own_code_bug" : planned.planned.length ? "strategies_planned" : diagnosis.retryFirst ? "backoff_retry" : "uncovered";
  return { formCode: record.formCode, stage, cause: diagnosis.cause, signature: diagnosis.signature, class: classification.class, code: classification.code, planned: planned.planned, verdict };
}

function summarize(results) {
  const count = (key) => results.reduce((acc, item) => ({ ...acc, [item[key]]: (acc[item[key]] || 0) + 1 }), {});
  const uncovered = results.filter((item) => item.verdict === "uncovered");
  return { total: results.length, byCause: count("cause"), byVerdict: count("verdict"), uncovered: uncovered.map((item) => ({ formCode: item.formCode, stage: item.stage, signature: item.signature, cause: item.cause })), ok: uncovered.length === 0 };
}

function createReplayResolver() {
  const { createResolver, createMemoryStore, loadCatalog } = require("../modules/form-pipeline/resolution");
  return createResolver({ catalog: loadCatalog({ log: quiet }), store: createMemoryStore(), log: quiet, diagnoseDeps: { configuredToolPath: () => null } });
}

async function replay(records, { resolver = createReplayResolver() } = {}) {
  const results = [];
  for (const record of records) results.push(await replayRecord(record, resolver));
  return { results, summary: summarize(results) };
}

async function loadFromDb() {
  const mongoose = require("mongoose");
  const env = require("../config/env");
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 8000 });
  try {
    const FormPipelineJob = require("../models/FormPipelineJob");
    const jobs = await FormPipelineJob.find({ $or: [{ state: { $in: ["dead_letter", "held", "blocked"] } }, { "lastError.message": { $exists: true } }] }).select("formCode state lastError stages currentStage").lean(); // a read
    return recordsFromJobs(jobs);
  } finally {
    await mongoose.disconnect();
  }
}

async function main(argv = process.argv.slice(2)) {
  const json = argv.includes("--json");
  const fileAt = argv.indexOf("--file");
  let records;
  let source;
  if (argv.includes("--db")) { records = await loadFromDb(); source = "the configured database (read-only)"; }
  else if (fileAt >= 0) { records = recordsFromJobs(JSON.parse(fs.readFileSync(path.resolve(argv[fileAt + 1]), "utf8"))); source = argv[fileAt + 1]; }
  else { records = require("../test-utils/editionSim/historyCorpus").corpus; source = "the built-in sample of real failures"; }
  const { results, summary } = await replay(records);
  if (json) console.log(JSON.stringify({ source, summary, results }, null, 2));
  else {
    console.log(`Replayed ${summary.total} recorded failure(s) from ${source}`);
    console.log("by cause:  ", JSON.stringify(summary.byCause));
    console.log("by verdict:", JSON.stringify(summary.byVerdict));
    for (const item of summary.uncovered) console.log(`  UNCOVERED  ${item.formCode} @ ${item.stage}  cause=${item.cause} signature=${item.signature}`);
    console.log(summary.ok ? "Every failure is covered by a strategy (or is a programming error that stays dead-letter by design)." : "Some failures have no strategy: add a catalog entry for each.");
  }
  process.exitCode = summary.ok ? 0 : 1;
}

if (require.main === module) main().catch((error) => { console.error(error); process.exit(2); });

module.exports = { toError, recordsFromJobs, replayRecord, replay, summarize, createReplayResolver };

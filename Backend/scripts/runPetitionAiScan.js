#!/usr/bin/env node
// Petition AI Review - Phase 6: scan ONE uploaded petition from the command line, with the exact same code the server's worker uses
// (scanService + scanRunner + the Gemini caller, every backup included), and report the findings, the token use and the cost in US dollars.
//
//   node scripts/runPetitionAiScan.js --document <documentId>             dry run: reads the PDF, prints the page count and a cost
//                                                                          ESTIMATE. Nothing is sent to the AI, nothing is written.
//   node scripts/runPetitionAiScan.js --document <documentId> --confirm   runs the real scan: the scan + findings are stored exactly as
//                                                                          an upload-triggered scan would be (visible in Admin's AI Review)
//   --out <file.json>                                                      also writes the full result (scan, findings, usage) to a file
//
// It works while the server's PETITION_AI_REVIEW switch is off (the switch only controls the server's automatic worker). Only the named
// scan is claimed, never another one. Ctrl+C hands the scan back unchanged (run the command again to resume it).
// The API key is never printed.
const path = require("path");
const fs = require("fs");
const os = require("os");

require(path.join(__dirname, "..", "src", "config", "env"));
const mongoose = require("mongoose");

const MODULE = path.join(__dirname, "..", "src", "modules", "petition-ai-review");
const PETITION_DOCUMENT_TYPE = "petition_manual_upload";

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : undefined;
}
const money = (usd) => (usd === null || usd === undefined ? "unknown" : `$${Number(usd).toFixed(4)}`);
const n = (value) => Number(value || 0).toLocaleString("en-US");

async function loadPetition(documentId) {
  const Document = require("../src/models/Document");
  const document = await Document.findById(documentId).select("_id documentType storageKey filePath deletedAt originalName caseId").lean();
  if (!document) throw new Error(`No document ${documentId}.`);
  if (document.deletedAt) throw new Error("That document is deleted.");
  if (document.documentType !== PETITION_DOCUMENT_TYPE) throw new Error(`That document is a "${document.documentType}", not an uploaded petition.`);
  return document;
}

async function dryRun(document, config) {
  const { readDocumentBuffer } = require("../src/modules/documents/document.service");
  const { PdfSlicer } = require(path.join(MODULE, "pdfSlicer"));
  const { loadCaseFacts } = require(path.join(MODULE, "caseFacts"));
  const { loadRules } = require(path.join(MODULE, "rules"));
  const { buildSystemInstruction } = require(path.join(MODULE, "prompt"));
  const { estimateScan } = require(path.join(MODULE, "costEstimate"));
  const started = Date.now();
  const buffer = await readDocumentBuffer(document);
  console.log(`Read ${(buffer.length / 1048576).toFixed(1)} MB in ${Math.round((Date.now() - started) / 1000)} s`);
  const reader = await PdfSlicer.open(buffer);
  let pages;
  let mode;
  try {
    pages = Math.min(reader.pages, config.maxPages);
    mode = reader.mode;
  } finally {
    await reader.close().catch(() => null);
  }
  const instruction = buildSystemInstruction({ facts: await loadCaseFacts(document.caseId), ruleSet: await loadRules() });
  const estimate = estimateScan({ pages, pagesPerCall: config.pagesPerCall, instructionChars: instruction.length });
  console.log(`Pages: ${pages} (read as ${mode}) | ${config.pagesPerCall} pages per AI call -> about ${estimate.calls} calls`);
  console.log(`Estimated tokens: input ${n(estimate.usage.input)}, output ${n(estimate.usage.output)}, thinking up to ${n(estimate.usage.thinking)}`);
  console.log(`Estimated cost: about ${money(estimate.costUsd)} (at $${estimate.pricing.inputPerMillion} / $${estimate.pricing.outputPerMillion} per 1M input / output tokens)`);
  console.log("Dry run: nothing was sent to the AI and nothing was written. Add --confirm to run the real scan.");
}

async function realScan(document, config) {
  const { createScanService } = require(path.join(MODULE, "scanService"));
  const { buildRunner } = require(MODULE);
  const scanService = createScanService();
  const { scan: queued, created } = await scanService.enqueue({
    caseId: document.caseId, documentId: document._id, documentName: document.originalName || "", trigger: "manual", batchSize: config.pagesPerCall,
  });
  console.log(`${created ? "New scan" : "Resuming the open scan"} ${queued._id}`);
  const claim = await scanService.claimNext({ workerId: `cli:${os.hostname()}:${process.pid}`, scanId: queued._id });
  if (!claim) throw new Error("The scan is busy (another worker holds it) or waiting for its next retry time. Try again later.");

  let stopping = false;
  process.once("SIGINT", () => { stopping = true; console.log("\nStopping after the current pages (the scan is handed back unchanged)..."); });
  const started = Date.now();
  const runScan = buildRunner({
    scanService,
    shouldStop: () => stopping,
    overrides: {
      onProgress: (_scan, { pagesDone, lastPage }) => console.log(`  pages ${pagesDone} / ${lastPage}  (${Math.round((Date.now() - started) / 1000)} s)`),
      onFinished: () => null, // a command-line run does not ring the bell or push to the screens; the result is printed below
    },
  });
  const outcome = await runScan(claim);
  console.log(`Finished: ${outcome?.state || "unknown"} in ${Math.round((Date.now() - started) / 1000)} s`);
  return claim.scan._id;
}

async function report(scanId, outFile) {
  const Scan = require("../src/models/PetitionAiScan");
  const Finding = require("../src/models/PetitionAiFinding");
  const { scanView, findingView } = require(path.join(MODULE, "reviewApi.service"));
  const scan = await Scan.findById(scanId).lean();
  const view = scanView(scan, { detail: true });
  const findings = (await Finding.find({ scanId }).sort({ page: 1, severity: 1 }).lean()).map(findingView);
  const counts = view.counts || {};
  console.log(`\nStatus: ${view.status} | pages ${view.pagesDone} / ${view.lastPage} | findings: ${counts.error || 0} to fix, ${counts.warning || 0} to check, ${counts.info || 0} minor`);
  if (view.summary?.text) console.log(`Summary: ${view.summary.text}`);
  for (const finding of findings) {
    console.log(`  p.${finding.page} [${finding.severity}/${finding.category}] ${finding.found}${finding.excerpt ? `  | "${finding.excerpt}"` : ""}${finding.suggestion ? `  -> ${finding.suggestion}` : ""}`);
  }
  if (view.gaps?.length) console.log(`Unread ranges: ${view.gaps.map((gap) => `${gap.from}-${gap.to} (${gap.reason})`).join("; ")}`);
  const usage = view.usage;
  console.log(`\nModel: ${view.modelUsed}${view.modelVersion ? ` (answered by ${view.modelVersion})` : ""}${view.usedFallback ? " + backup AI" : ""}`);
  console.log(`AI calls: ${usage.calls} | tokens: input ${n(usage.input)}, output ${n(usage.output)}, thinking ${n(usage.thinking)} | total ${n(usage.tokens)}`);
  console.log(`Cost: ${money(usage.costUsd)} (at $${usage.pricing.inputPerMillion} / $${usage.pricing.outputPerMillion} per 1M input / output tokens; thinking billed as output)`);
  if (outFile) {
    fs.writeFileSync(outFile, JSON.stringify({ scan: view, findings }, null, 2));
    console.log(`Full result written to ${outFile}`);
  }
}

async function main() {
  const documentId = argValue("--document");
  if (!documentId || !/^[a-f0-9]{24}$/i.test(documentId)) {
    console.log("Usage: node scripts/runPetitionAiScan.js --document <documentId> [--confirm] [--out result.json]");
    process.exitCode = 1;
    return;
  }
  const { readConfig } = require(path.join(MODULE, "config"));
  const config = readConfig();
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const document = await loadPetition(documentId);
    console.log(`Petition: ${document.originalName} | case ${document.caseId} | model ${config.model} | key ${config.keyConfigured ? `from ${config.keySource}` : "MISSING"}`);
    if (!process.argv.includes("--confirm")) return await dryRun(document, config);
    const scanId = await realScan(document, config);
    await report(scanId, argValue("--out"));
  } finally {
    await mongoose.disconnect().catch(() => null);
  }
}

main().catch((error) => {
  console.error(`Stopped: ${error?.message || error}`);
  process.exitCode = 1;
});

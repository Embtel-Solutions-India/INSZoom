#!/usr/bin/env node
// Standalone form-pipeline worker: the same worker the API embeds, as its OWN process, so heavy PDF work (pdf-lib, certification, qpdf) never shares the API's
// event loop and a crash or memory blow-up here cannot take the API down (plan decision 14).
//
//   node src/workers/formPipelineWorker.js
//   API process:    FORM_PIPELINE_WORKER=external   (the API no longer starts an embedded worker)
//                   FORM_PIPELINE_MODE=queued       (entry points enqueue and answer immediately)
//
// PM2 (a production change that needs its own approval and a deploy-workflow change that restarts BOTH apps together, with max_memory_restart):
//   { name: "form-pipeline-worker", script: "src/workers/formPipelineWorker.js", max_memory_restart: "1500M", env: { NODE_ENV: "production" } }
//
// On SIGTERM / SIGINT it stops claiming, lets the running job finish (up to 30 s; otherwise its lease simply expires and another worker recovers it), and exits.
require("dotenv").config();
const connectDB = require("../config/database");
const { disconnectDB } = connectDB;
const logger = require("../utils/logger");

async function main() {
  await connectDB();
  const { buildWorker } = require("../modules/form-pipeline");
  const worker = buildWorker();
  worker.start();
  logger.info("form_pipeline_worker_process_started", { workerId: worker.workerId, mode: process.env.FORM_PIPELINE_MODE || "inline" });
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("form_pipeline_worker_process_stopping", { signal });
    try {
      await worker.stop(30000);
      await disconnectDB();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

if (require.main === module) {
  main().catch((error) => {
    logger.fatal("form_pipeline_worker_process_failed", { error });
    process.exit(1);
  });
}

module.exports = { main };

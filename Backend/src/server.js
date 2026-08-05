const app = require("./app");
const connectDB = require("./config/database");
const env = require("./config/env");
const http = require("http");
const logger = require("./utils/logger");
const appointmentService = require("./modules/appointments/appointment.service");
const realtimeGateway = require("./modules/realtime/realtime.gateway");
const notificationService = require("./modules/notifications/notification.service");
const workflowService = require("./modules/workflows/workflow.service");
const paymentService = require("./modules/payments/payment.service");
const questionnaireService = require("./modules/questionnaires/questionnaire.service");
const { startUSCISMonitoringJob } = require("./modules/uscis-lifecycle/jobs/USCISMonitoringJob");
const reminderGenerationService = require("./modules/notifications/reminder-generation.service");
const aiOrchestrationService = require("./modules/ai/ai-orchestration.service");
const reportService = require("./modules/reports/report.service");

process.on("uncaughtException", (error) => {
  logger.fatal("uncaught_exception", { error });
});

process.on("unhandledRejection", (reason) => {
  logger.fatal("unhandled_rejection", {
    error: reason instanceof Error ? reason : undefined,
    reason: reason instanceof Error ? undefined : reason,
  });
});

function startWorkflowMaintenance() {
  const intervalMs = Number(process.env.WORKFLOW_MAINTENANCE_INTERVAL_MS || 5 * 60 * 1000);
  const run = async () => {
    await Promise.all([
      workflowService.checkSlaBreaches(),
      workflowService.processScheduledWorkflows(),
      workflowService.retryFailedActions(),
    ]).catch((error) => logger.error("workflow_maintenance_failed", { error }));
  };
  run();
  return setInterval(run, intervalMs);
}

function startNotificationMaintenance() {
  const intervalMs = Number(process.env.NOTIFICATION_MAINTENANCE_INTERVAL_MS || 60 * 1000);
  const run = async () => {
    await Promise.all([
      notificationService.processScheduled(100),
      notificationService.retryFailed(100),
    ]).catch((error) => logger.error("notification_maintenance_failed", { error }));
  };
  run();
  return setInterval(run, intervalMs);
}

function startAppointmentMaintenance() {
  const intervalMs = Number(process.env.APPOINTMENT_REMINDER_INTERVAL_MS || 60 * 1000);
  const run = async () => {
    await appointmentService.sendDueReminders().catch((error) => logger.error("appointment_reminder_processing_failed", { error }));
  };
  run();
  return setInterval(run, intervalMs);
}

function startPaymentMaintenance() {
  const intervalMs = Number(process.env.PAYMENT_RECONCILIATION_INTERVAL_MS || 2 * 60 * 1000);
  const run = async () => {
    await paymentService.reconcilePendingPayments(
      Number(process.env.PAYMENT_RECONCILIATION_BATCH_SIZE || 50)
    ).catch((error) => logger.error("payment_reconciliation_failed", { error }));
  };
  run();
  return setInterval(run, intervalMs);
}

function startReminderGeneration() {
  const intervalMs = Number(process.env.REMINDER_GENERATION_INTERVAL_MS || 60 * 60 * 1000);
  const run = async () => {
    await reminderGenerationService.runAll().catch((error) => logger.error("reminder_generation_failed", { error }));
  };
  run();
  return setInterval(run, intervalMs);
}

function startAIMaintenance() {
  const intervalMs = Number(process.env.AI_JOB_RECOVERY_INTERVAL_MS || 60 * 1000);
  const run = async () => {
    await aiOrchestrationService.recoverQueuedJobs().catch((error) => logger.error("ai_job_recovery_failed", { error }));
  };
  run();
  return setInterval(run, intervalMs);
}

function startEodReportMaintenance() {
  const intervalMs = Number(process.env.EOD_REPORT_CHECK_INTERVAL_MS || 5 * 60 * 1000);
  const generationHour = Math.min(Math.max(Number(process.env.EOD_REPORT_GENERATION_HOUR_IST || 6), 0), 23);
  const backfillDays = Math.min(Math.max(Number(process.env.EOD_REPORT_BACKFILL_DAYS || 7), 1), 31);
  let lastSuccessfulRun = "";
  const run = async () => {
    const now = new Date();
    const istNow = new Date(now.getTime() + 330 * 60 * 1000);
    if (istNow.getUTCHours() < generationHour) return;
    const runKey = istNow.toISOString().slice(0, 10);
    if (lastSuccessfulRun === runKey) return;
    try {
      for (let daysAgo = backfillDays; daysAgo >= 1; daysAgo -= 1) {
        await reportService.generateAutomaticEodReports({
          reportDate: reportService.startOfIstDay(now, -daysAgo),
        });
      }
      lastSuccessfulRun = runKey;
    } catch (error) {
      logger.error("automatic_eod_report_generation_failed", { error });
    }
  };
  run();
  return setInterval(run, intervalMs);
}

connectDB()
  .then(() => {
    if (process.env.SEED_QUESTIONNAIRE_TEMPLATES_ON_STARTUP === "true") {
      questionnaireService.ensureDefaultVisaTemplates(undefined, undefined, { force: true })
        .catch((error) => logger.error("questionnaire_template_initialization_failed", { error }));
    }
    const seedI129 = require("./modules/uscis-form-import/seeds/i129.seed");
    const seedI129F = require("./modules/uscis-form-import/seeds/i129f.seed");
    const seedI130 = require("./modules/uscis-form-import/seeds/i130.seed");
    const seedI134 = require("./modules/uscis-form-import/seeds/i134.seed");
    const seedI539 = require("./modules/uscis-form-import/seeds/i539.seed");
    const seedI539A = require("./modules/uscis-form-import/seeds/i539a.seed");
    const seedI907 = require("./modules/uscis-form-import/seeds/i907.seed");

    [
      ["I-129", seedI129],
      ["I-129F", seedI129F],
      ["I-130", seedI130],
      ["I-134", seedI134],
      ["I-539", seedI539],
      ["I-539A", seedI539A],
      ["I-907", seedI907],
    ].forEach(([code, seed]) => {
      seed().then(({ template, fieldCount }) => {
        console.log(`[startup] ${code} template ready: ${template._id}, ${fieldCount} fields, visaTypes: [${(template.visaTypes || []).join(", ")}]`);
      }).catch((err) => {
        console.error(`[startup] ${code} seed warning (non-fatal):`, err.message);
      });
    });
    const server = http.createServer(app);
    realtimeGateway.init(server, { origins: env.clientOrigins });
    const workflowMaintenance = startWorkflowMaintenance();
    const notificationMaintenance = startNotificationMaintenance();
    const appointmentMaintenance = startAppointmentMaintenance();
    const paymentMaintenance = startPaymentMaintenance();
    const reminderGeneration = startReminderGeneration();
    const aiMaintenance = startAIMaintenance();
    const eodReportMaintenance = startEodReportMaintenance();
    const uscisMonitoring = startUSCISMonitoringJob();
    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        logger.fatal("port_in_use", { port: env.port, error });
        process.exit(1);
      }
      logger.fatal("shared_backend_server_error", { error });
      process.exit(1);
    });
    server.listen(env.port, () => {
      logger.info("shared_backend_started", { port: env.port, nodeEnv: env.nodeEnv });
    });
    const shutdown = () => {
      clearInterval(workflowMaintenance);
      clearInterval(notificationMaintenance);
      clearInterval(appointmentMaintenance);
      clearInterval(paymentMaintenance);
      clearInterval(reminderGeneration);
      clearInterval(aiMaintenance);
      clearInterval(eodReportMaintenance);
      if (uscisMonitoring) clearInterval(uscisMonitoring);
      server.close(() => process.exit(0));
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  })
  .catch((error) => {
    logger.fatal("failed_to_start_shared_backend", { error });
    process.exit(1);
  });

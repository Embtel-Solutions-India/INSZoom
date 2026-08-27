/**
 * PHASE 3 MIGRATION SCRIPT — Account-to-Case Linkage
 *
 * Purpose: Links existing client User accounts to their Cases by populating
 * the Phase 2 schema fields (primaryCaseId, caseIds, migrationStatus,
 * legacyNoCaseAccount) on each User document.
 *
 * Safety guarantees:
 * - NEVER deletes any document (User, Case, or any other model)
 * - NEVER modifies any Case document
 * - NEVER modifies any CaseForm, canonical data, or form mapping
 * - Fully idempotent: can be run multiple times safely
 * - Every action is logged before it is committed
 * - Failed individual user updates are logged and skipped — they do not
 *   abort the entire migration
 *
 * Run with (from Backend/):
 *   node scripts/migrateAccounts.js
 *
 * Output log:
 *   migrations/legacy-account-migration.log (at the project root)
 *
 * After running, check the log file and confirm:
 *   - Every client User has migrationStatus of 'linked' or 'flagged'
 *   - No User has migrationStatus of 'pending' remaining
 *   - No Case document was modified (confirm with a separate query)
 */

"use strict";

const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
// env.js itself calls dotenv.config() internally (matching every other
// standalone script in this codebase, e.g. seeds/seedUsers.js and the
// form-mapping mapping seeds) — requiring it loads Backend/.env with no
// separate dotenv setup needed here.
const env = require("../src/config/env");

// ─── Log Setup ────────────────────────────────────────────────────────────

// __dirname is Backend/scripts/ — two levels up is the project root.
const LOG_DIR = path.join(__dirname, "../../migrations");
const LOG_FILE = path.join(LOG_DIR, "legacy-account-migration.log");

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });

function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    level,
    message,
    ...(data ? { data } : {}),
  };
  const line = JSON.stringify(entry);
  logStream.write(line + "\n");
  console.log(`[${timestamp}] [${level}] ${message}`, data ? JSON.stringify(data) : "");
}

// ─── Database Connection ────────────────────────────────────────────────────

async function connectDatabase() {
  log("INFO", "Connecting to database", { uri: env.mongoUri.replace(/\/\/.*@/, "//***@") });
  await mongoose.connect(env.mongoUri);
  log("INFO", "Database connected");
}

// ─── Main Migration ────────────────────────────────────────────────────────

async function migrate() {
  // Loaded after connecting, matching this codebase's other standalone
  // scripts (avoids any model-not-registered ordering issue).
  const User = require("../src/models/User");
  const Case = require("../src/models/Case");

  log("INFO", "Starting Phase 3 account migration");
  log("INFO", "THIS SCRIPT NEVER MODIFIES CASE DOCUMENTS. READ-ONLY ON CASES.");

  // ── Count scope ─────────────────────────────────────────────────────────
  const totalClients = await User.countDocuments({ role: "client" });
  const alreadyMigrated = await User.countDocuments({
    role: "client",
    migrationStatus: { $in: ["linked", "flagged"] },
  });
  const pendingMigration = totalClients - alreadyMigrated;

  log("INFO", "Migration scope determined", {
    totalClientAccounts: totalClients,
    alreadyMigrated,
    pendingMigration,
  });

  if (pendingMigration === 0) {
    log("INFO", "All client accounts already migrated. Migration is complete. Exiting.");
    return { linked: 0, flagged: 0, skipped: alreadyMigrated, errors: 0 };
  }

  // ── Process each unmigrated client ──────────────────────────────────────
  const stats = { linked: 0, flagged: 0, skipped: 0, errors: 0 };

  // Use a cursor to avoid loading all users into memory at once.
  const cursor = User.find(
    { role: "client", migrationStatus: { $nin: ["linked", "flagged"] } },
    { _id: 1, email: 1, name: 1, migrationStatus: 1, primaryCaseId: 1, caseIds: 1, legacyNoCaseAccount: 1 }
  ).cursor();

  for await (const user of cursor) {
    try {
      // IDEMPOTENCY CHECK: if this user already has caseIds populated, skip.
      if (user.caseIds && user.caseIds.length > 0) {
        log("INFO", "User already has caseIds — skipping", { userId: user._id, email: user.email });
        stats.skipped++;
        continue;
      }

      // Find all Cases linked to this User. `user` is the confirmed field
      // name on Case that links to the client User (Case.user — the Phase 1
      // audit's "clientUserId" candidate does not exist on Case; this was
      // re-confirmed directly against Case.js during this Phase 3 pass).
      const linkedCases = await Case.find(
        { user: user._id },
        { _id: 1, caseNumber: 1, createdAt: 1 }
      ).sort({ createdAt: -1 }).lean();

      if (linkedCases.length > 0) {
        // User has one or more linked Cases → mark as linked.
        const caseIds = linkedCases.map((c) => c._id);
        const primaryCaseId = linkedCases[0]._id; // most recently created case
        const caseNumbers = linkedCases.map((c) => c.caseNumber);

        log("INFO", "Linking user to cases", {
          userId: user._id,
          email: user.email,
          caseCount: linkedCases.length,
          caseNumbers,
          primaryCaseNumber: linkedCases[0].caseNumber,
        });

        // Update the User — never the Case.
        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              primaryCaseId,
              caseIds,
              migrationStatus: "linked",
              legacyNoCaseAccount: false,
            },
          }
        );

        stats.linked++;
        log("INFO", "User linked successfully", { userId: user._id, email: user.email });
      } else {
        // User has no linked Cases → flag for manual review.
        log("INFO", "No cases found for user — flagging", {
          userId: user._id,
          email: user.email,
        });

        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              migrationStatus: "flagged",
              legacyNoCaseAccount: true,
              caseIds: [],
              primaryCaseId: null,
            },
          }
        );

        stats.flagged++;
        log("INFO", "User flagged successfully", { userId: user._id, email: user.email });
      }
    } catch (err) {
      // Individual errors do not abort the migration.
      stats.errors++;
      log("ERROR", "Failed to migrate user — skipping", {
        userId: user._id,
        email: user.email,
        error: err.message,
        stack: err.stack,
      });
    }
  }

  return stats;
}

// ─── Verification Pass ────────────────────────────────────────────────────

async function verify() {
  const User = require("../src/models/User");

  const remainingPending = await User.countDocuments({
    role: "client",
    migrationStatus: "pending",
  });
  const linked = await User.countDocuments({ role: "client", migrationStatus: "linked" });
  const flagged = await User.countDocuments({ role: "client", migrationStatus: "flagged" });

  log("INFO", "Post-migration verification", { remainingPending, linked, flagged });

  if (remainingPending > 0) {
    log("WARN", `${remainingPending} client accounts still have migrationStatus:'pending'. Re-run the script.`);
  } else {
    log("INFO", "All client accounts have been processed. Migration complete.");
  }

  return { remainingPending, linked, flagged };
}

// ─── Entry Point ────────────────────────────────────────────────────────────

async function main() {
  try {
    await connectDatabase();
    const stats = await migrate();
    log("INFO", "Migration run complete", stats);
    const verification = await verify();

    if (verification.remainingPending === 0) {
      log("INFO", "MIGRATION SUCCESSFUL — All accounts processed");
      process.exitCode = 0;
    } else {
      log("WARN", "MIGRATION INCOMPLETE — Some accounts remain unprocessed");
      process.exitCode = 1;
    }
  } catch (err) {
    log("ERROR", "Fatal migration error", { error: err.message, stack: err.stack });
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    logStream.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { migrate, verify };

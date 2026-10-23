#!/usr/bin/env node
// Phase 6: run the backend test suite WITHOUT ever touching the shared/real database.
//
// `npm test` runs every *.test.js, and a few of them connect through config/database (the application's own, shared database) and create real records.
// This runner sorts every test file into one of three groups by what it contains:
//   pure         - no database at all, or only the throwaway local databases of src/test-utils/pipelineDb.js        -> RUN
//   local-db     - src/test-utils/db.js (a fixed local database "immigrationcrm_test" with protected master data)    -> SKIPPED unless --include-local-db
//   real-db      - connects to the application's own database (config/database, env.mongoUri, a raw mongoose.connect) -> NEVER RUN here
//
//   node src/scripts/runSafeTests.js                       run the pure group
//   node src/scripts/runSafeTests.js --list                print the three groups and exit
//   node src/scripts/runSafeTests.js --include-local-db    also run the fixed-local-database group
//   node src/scripts/runSafeTests.js <path-filter>...      only files whose path contains one of the filters
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const SRC = path.resolve(__dirname, "..");

// The tests must not depend on what a developer has switched on in their own .env: with the master e-mail / notification switches ON the real-send-path tests (which stub the provider) see
// every send skipped and fail. dotenv never overrides a variable that is already set, so these win over the .env file.
const TEST_ENV = { ...process.env, EMAIL_SUPPRESS_ALL: "false", NOTIFICATIONS_SUPPRESS_ALL: "false" };

const REAL_DB_REFERENCE = /config\/database|env\.mongoUri|\bmongoUri\b|MONGO_URI|MONGODB_URI/;
const RAW_CONNECT = /mongoose\.connect\(/;
const LOCAL_DB = /test-utils\/db["'`]|MONGODB_TEST_URI/;
const THROWAWAY = /test-utils\/pipelineDb|MONGODB_PIPELINE_TEST_URI/;

/** Pure. "pure" | "local-db" | "real-db" for the source text of a test file. Anything that reaches the application's own database wins over the other two. */
function classify(source) {
  const text = String(source || "");
  if (REAL_DB_REFERENCE.test(text)) return "real-db";
  if (LOCAL_DB.test(text)) return "local-db";
  if (RAW_CONNECT.test(text) && !THROWAWAY.test(text)) return "real-db"; // a raw connect we cannot vouch for is treated as the shared database
  return "pure";
}

function listTestFiles(dir = SRC, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listTestFiles(full, out);
    else if (/\.test\.js$/.test(entry.name)) out.push(full);
  }
  return out;
}

function groups(files = listTestFiles()) {
  const result = { pure: [], "local-db": [], "real-db": [] };
  for (const file of files) result[classify(fs.readFileSync(file, "utf8"))].push(path.relative(path.resolve(SRC, ".."), file).split(path.sep).join("/"));
  return result;
}

function main(argv) {
  const args = argv.filter((a) => !a.startsWith("--"));
  const all = groups();
  if (argv.includes("--list")) {
    for (const [name, files] of Object.entries(all)) console.log(`\n${name} (${files.length})\n${files.map((f) => `  ${f}`).join("\n")}`);
    return 0;
  }
  let run = [...all.pure, ...(argv.includes("--include-local-db") ? all["local-db"] : [])];
  if (args.length) run = run.filter((f) => args.some((a) => f.includes(a)));
  console.log(`running ${run.length} test files; skipped: ${all["local-db"].length} fixed-local-database files (--include-local-db) and ${all["real-db"].length} real-database files (never run here)`);
  if (!run.length) return 0;
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=spec", ...run], { cwd: path.resolve(SRC, ".."), stdio: "inherit", env: TEST_ENV });
  return result.status === null ? 1 : result.status;
}

module.exports = { classify, listTestFiles, groups };

if (require.main === module) process.exit(main(process.argv.slice(2)));

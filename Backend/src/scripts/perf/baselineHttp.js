#!/usr/bin/env node
// HTTP baseline / comparison runner for the plan's performance budget (decision 15). It is a MEASURING tool and, by design, does nothing unless told exactly where to point:
//   node baselineHttp.js --plan                      (default) print the workload that WOULD run; sends no request
//   node baselineHttp.js --apply --base-url <url> --token <jwt> --case-id <id> --form-id <id> --out baseline.json
// `--apply` needs an explicit --base-url (there is no default - this tool never guesses a server) and refuses a URL that is not http(s). Standing rule: load runs against the
// shared database need the user's explicit approval first; the runner only issues the GET/POST requests listed in ENDPOINTS, sequentially (>= 200 after a 20-request warm-up)
// and then 10 concurrent workers for the given duration. Results are written as JSON in the shape budget.compareToBaseline() reads.
// Server-side event-loop delay and DB-call counts come from the server process (lagMeter / dbCallCounter), not from this client.
const fs = require("node:fs");
const { summarize } = require("./stats");

const WARMUP = 20;
const SEQUENTIAL = 200;
const CONCURRENCY = 10;
const CONCURRENT_MS = 5 * 60 * 1000;

// path templates; {caseId}/{formId} are filled from the arguments. No endpoint here creates or changes a case: "case creation" needs a dedicated approved test account and is
// listed in the plan but intentionally left out of this default list.
const ENDPOINTS = Object.freeze([
  { name: "case read", method: "GET", path: "/api/cases/{caseId}" },
  { name: "form load", method: "GET", path: "/api/forms/{formId}" },
]);

function parseArgs(argv) {
  const args = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--plan") args.apply = false;
    else if (arg.startsWith("--")) { args[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[i + 1]; i += 1; }
  }
  return args;
}

function describePlan(args = {}) {
  return {
    sends: false,
    warmupPerEndpoint: WARMUP,
    sequentialPerEndpoint: SEQUENTIAL,
    concurrency: CONCURRENCY,
    concurrentMinutes: CONCURRENT_MS / 60000,
    endpoints: ENDPOINTS.map((item) => `${item.method} ${item.path}`),
    note: "Dry run: nothing was sent. Pass --apply with --base-url, --token, --case-id, --form-id and --out to measure (needs the user's approval when the target uses the shared database).",
    given: { baseUrl: args.baseUrl || null },
  };
}

function validateApply(args) {
  const problems = [];
  if (!args.baseUrl) problems.push("--base-url is required (there is no default server)");
  else if (!/^https?:\/\//i.test(args.baseUrl)) problems.push("--base-url must be an http(s) URL");
  for (const key of ["token", "caseId", "formId", "out"]) if (!args[key]) problems.push(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`);
  return problems;
}

async function timeOne(fetchImpl, base, endpoint, args, clock) {
  const url = base + endpoint.path.replace("{caseId}", encodeURIComponent(args.caseId)).replace("{formId}", encodeURIComponent(args.formId));
  const started = clock();
  const response = await fetchImpl(url, { method: endpoint.method, headers: { Authorization: `Bearer ${args.token}` } });
  await response.arrayBuffer();
  return { ms: clock() - started, ok: response.ok };
}

/** Runs the workload against `args.baseUrl`. fetchImpl / clock are injectable so the sequencing is testable without a network. */
async function run(args, { fetchImpl = fetch, clock = () => performance.now(), concurrentMs = CONCURRENT_MS, sequential = SEQUENTIAL, warmup = WARMUP } = {}) {
  const base = args.baseUrl.replace(/\/+$/, "");
  const endpoints = {};
  for (const endpoint of ENDPOINTS) {
    for (let i = 0; i < warmup; i += 1) await timeOne(fetchImpl, base, endpoint, args, clock);
    const times = [];
    let failures = 0;
    for (let i = 0; i < sequential; i += 1) { const sample = await timeOne(fetchImpl, base, endpoint, args, clock); times.push(sample.ms); if (!sample.ok) failures += 1; }
    endpoints[endpoint.name] = { ...summarize(times), failures };
  }
  const concurrent = {};
  const deadline = clock() + concurrentMs;
  await Promise.all(Array.from({ length: CONCURRENCY }, async (_, worker) => {
    const endpoint = ENDPOINTS[worker % ENDPOINTS.length];
    const times = (concurrent[endpoint.name] ||= []);
    while (clock() < deadline) times.push((await timeOne(fetchImpl, base, endpoint, args, clock)).ms);
  }));
  return { endpoints, concurrent: Object.fromEntries(Object.entries(concurrent).map(([name, times]) => [name, summarize(times)])) };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (!args.apply) { console.log(JSON.stringify(describePlan(args), null, 2)); return 0; }
  const problems = validateApply(args);
  if (problems.length) { console.error(`Refusing to run:\n- ${problems.join("\n- ")}`); return 2; }
  const result = await run(args);
  fs.writeFileSync(args.out, JSON.stringify({ recordedAt: new Date().toISOString(), baseUrl: args.baseUrl, ...result }, null, 2));
  console.log(`Wrote ${args.out}`);
  return 0;
}

if (require.main === module) main(process.argv.slice(2)).then((code) => process.exit(code), (error) => { console.error(error.message); process.exit(1); });

module.exports = { parseArgs, describePlan, validateApply, run, ENDPOINTS };

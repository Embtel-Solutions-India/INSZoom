#!/usr/bin/env node
// Release 0a (docs/FORM_PIPELINE_RELIABILITY_PLAN.md, Rule H) - READ-ONLY redirect-chain crawl of every tracked form page / PDF URL.
// Writes NOTHING to the database or the application. It only reads the template URLs from the database and sends GET requests to uscis.gov.
//
// Why: the existing fetchers (USCISScannerService.fetchPage, the importer's fetchPdf) validate only the FIRST url and then follow redirects
// automatically, so a redirect to another host would be followed unchecked. Before those fetchers are hardened (a later release) this shows what
// the real chains look like: any chain that leaves uscis.gov, drops to http or loops BLOCKS that hardening until it is understood.
//
// Every hop is validated BEFORE it is requested (https only, host uscis.gov or *.uscis.gov, no credentials in the url, no IP literal, default
// port only, no loop, at most N hops). Redirects are never followed automatically (redirect: "manual"); no cookies or credentials are sent; the
// response body is never read (it is cancelled as soon as the headers are in); each request has a timeout.
//
//   node src/scripts/formSourceRedirectCrawl.js                     # crawl every tracked url (2 at a time, small pause between starts)
//   node src/scripts/formSourceRedirectCrawl.js --url https://www.uscis.gov/i-131   # crawl one url, no database
//   options: --json  --out <file>  --concurrency 2  --delay-ms 250  --timeout-ms 15000  --max-hops 5  --limit N

const fs = require("fs");
const { readOnlyDb } = require("./lib/readOnlyDb");

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_CONTENT_TYPES = ["text/html", "application/pdf"];
const DEFAULTS = { maxHops: 5, timeoutMs: 15000, maxBytes: 50 * 1024 * 1024, concurrency: 2, delayMs: 250 };
const USER_AGENT = "Immiglance-FormPipeline-Crawl/0a (read-only)";

// ---- url validation: the ONE shared definition (what the crawl proved safe is exactly what the evidence fetcher enforces)
const { checkUrl, normalizeUrl: normalize } = require("../modules/form-edition-policy/officialUrl");

// ---- one url -----------------------------------------------------------------------------------------------------------------------------------

/**
 * Follows one url's redirect chain by hand and reports it. `fetchImpl` is injectable (tests use a fake; the CLI uses the global fetch).
 * Resolves with a record and never throws.
 */
async function crawlUrl(raw, { fetchImpl = globalThis.fetch, maxHops = DEFAULTS.maxHops, timeoutMs = DEFAULTS.timeoutMs, maxBytes = DEFAULTS.maxBytes, now = Date.now } = {}) {
  const startedAt = now();
  const record = { url: raw, outcome: null, finalUrl: null, finalStatus: null, contentType: null, contentLength: null, hops: [], violations: [], leavesUscis: false, error: null, ms: 0 };
  const violate = (type, url, hop) => {
    record.violations.push({ type, url, hop });
    if (["host_not_uscis", "not_https", "ip_literal", "non_default_port", "credentials_in_url", "invalid_url"].includes(type)) record.leavesUscis = hop > 0 || record.leavesUscis;
  };

  const visited = new Set();
  let current = raw;
  try {
    for (let hop = 0; hop <= maxHops; hop += 1) {
      const check = checkUrl(current);
      if (!check.ok) {
        // rejected BEFORE any request is made to it
        check.violations.forEach((type) => violate(type, current, hop));
        record.outcome = "blocked";
        break;
      }
      const key = normalize(check.url);
      if (visited.has(key)) {
        violate("redirect_loop", current, hop);
        record.outcome = "blocked";
        break;
      }
      visited.add(key);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(current, {
          method: "GET",
          redirect: "manual",
          credentials: "omit",
          signal: controller.signal,
          headers: { "user-agent": USER_AGENT, accept: "text/html,application/pdf" },
        });
      } finally {
        clearTimeout(timer);
      }

      const status = response.status;
      const location = response.headers?.get?.("location") || null;
      record.hops.push({ url: current, status, location });
      // the body is never read - only the headers matter here
      try { await response.body?.cancel?.(); } catch { /* nothing to cancel */ }

      if (REDIRECT_STATUSES.has(status)) {
        if (!location) { violate("redirect_without_location", current, hop); record.outcome = "blocked"; break; }
        if (hop === maxHops) { violate("too_many_hops", current, hop); record.outcome = "blocked"; break; }
        try {
          current = new URL(location, current).toString();
        } catch {
          violate("invalid_url", location, hop + 1);
          record.outcome = "blocked";
          break;
        }
        continue;
      }

      record.finalUrl = current;
      record.finalStatus = status;
      record.contentType = (response.headers?.get?.("content-type") || "").split(";")[0].trim().toLowerCase() || null;
      const length = Number(response.headers?.get?.("content-length"));
      record.contentLength = Number.isFinite(length) && length >= 0 ? length : null;
      if (status < 400 && record.contentType && !ALLOWED_CONTENT_TYPES.includes(record.contentType)) violate("content_type_not_allowed", current, hop);
      if (record.contentLength !== null && record.contentLength > maxBytes) violate("size_over_cap", current, hop);
      record.outcome = status >= 400 ? "http_error" : record.violations.length ? "blocked" : record.hops.length > 1 ? "ok_redirected" : "ok_direct";
      break;
    }
  } catch (error) {
    record.outcome = "error";
    record.error = { name: error?.name || "Error", message: error?.name === "AbortError" ? `no response within ${timeoutMs} ms` : String(error?.message || error) };
  }
  record.ms = Math.max(0, now() - startedAt);
  return record;
}

// ---- many urls -----------------------------------------------------------------------------------------------------------------------------------

/** Every distinct source url stored on the templates, with the forms / editions / fields that use it. Pure. */
function collectTrackedUrls(templates = []) {
  const found = new Map();
  const add = (url, kind, template) => {
    if (!url || typeof url !== "string") return;
    if (!found.has(url)) found.set(url, { url, kinds: new Set(), forms: new Map() });
    const entry = found.get(url);
    entry.kinds.add(kind);
    entry.forms.set(`${template.formCode}|${template.version}|${template.status}`, { formCode: template.formCode, version: template.version, status: template.status });
  };
  for (const template of templates) {
    add(template.lifecycle?.sourcePageUrl, "form_page", template);
    add(template.lifecycle?.sourcePdfUrl, "form_pdf", template);
    add(template.officialPdfUrl, "form_pdf", template);
    add(template.artifacts?.form?.sourceUrl, "form_pdf", template);
    add(template.artifacts?.instructions?.sourceUrl, "instructions_pdf", template);
    add(template.instructionsPdfUrl, "instructions_pdf", template);
  }
  return [...found.values()]
    .map((entry) => ({ url: entry.url, kinds: [...entry.kinds].sort(), forms: [...entry.forms.values()].sort((a, b) => String(a.formCode).localeCompare(String(b.formCode))) }))
    .sort((a, b) => a.url.localeCompare(b.url));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Crawls the urls with a small, polite pool: at most `concurrency` in flight and `delayMs` between starts. Results keep the input order. */
async function crawlAll(entries, { concurrency = DEFAULTS.concurrency, delayMs = DEFAULTS.delayMs, onProgress, ...crawlOptions } = {}) {
  const results = new Array(entries.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= entries.length) return;
      const entry = entries[index];
      const record = await crawlUrl(entry.url, crawlOptions);
      results[index] = { ...record, kinds: entry.kinds, forms: entry.forms };
      done += 1;
      onProgress?.(done, entries.length, results[index]);
      if (delayMs) await sleep(delayMs);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, entries.length || 1)) }, () => worker()));
  return results;
}

/** Pure: totals, every redirected chain, every violation, and the verdict on whether hardening is blocked. */
function summarizeCrawl(results) {
  const outcomes = {};
  const statuses = {};
  const contentTypes = {};
  for (const result of results) {
    outcomes[result.outcome] = (outcomes[result.outcome] || 0) + 1;
    if (result.finalStatus !== null) statuses[result.finalStatus] = (statuses[result.finalStatus] || 0) + 1;
    if (result.contentType) contentTypes[result.contentType] = (contentTypes[result.contentType] || 0) + 1;
  }
  const redirected = results.filter((result) => result.hops.length > 1 || result.hops.some((hop) => REDIRECT_STATUSES.has(hop.status)));
  const violations = results.flatMap((result) => result.violations.map((violation) => ({ ...violation, requested: result.url, forms: (result.forms || []).map((form) => form.formCode) })));
  const leaving = results.filter((result) => result.leavesUscis);
  const failures = results.filter((result) => result.outcome === "error" || result.outcome === "http_error");
  const blocking = results.filter((result) => result.violations.some((violation) => ["host_not_uscis", "not_https", "redirect_loop", "too_many_hops", "ip_literal", "non_default_port", "credentials_in_url", "invalid_url", "redirect_without_location"].includes(violation.type)));
  return {
    urlsCrawled: results.length,
    outcomes,
    finalStatuses: statuses,
    contentTypes,
    redirectedCount: redirected.length,
    redirected: redirected.map((result) => ({ url: result.url, chain: result.hops.map((hop) => `${hop.status} ${hop.url}`), finalUrl: result.finalUrl, outcome: result.outcome })),
    violations,
    chainsLeavingUscis: leaving.map((result) => ({ url: result.url, chain: result.hops.map((hop) => `${hop.status} ${hop.url}`), forms: (result.forms || []).map((form) => form.formCode) })),
    failures: failures.map((result) => ({ url: result.url, outcome: result.outcome, finalStatus: result.finalStatus, error: result.error, forms: (result.forms || []).map((form) => form.formCode) })),
    blocksHardening: blocking.length > 0,
    verdict: blocking.length
      ? `${blocking.length} url(s) have a chain that leaves uscis.gov, uses http, loops or is otherwise unsafe: hardening the existing import fetchers is BLOCKED until each is understood`
      : "no chain leaves uscis.gov, drops to http or loops: per-hop validation will not break any tracked url",
  };
}

// ---- loading, output, CLI ----------------------------------------------------------------------------------------------------------------------

async function loadTemplates(db) {
  return readOnlyDb(db)
    .collection("uscisformtemplates")
    .find({}, { projection: { formCode: 1, version: 1, status: 1, officialPdfUrl: 1, instructionsPdfUrl: 1, "lifecycle.sourcePageUrl": 1, "lifecycle.sourcePdfUrl": 1, "artifacts.form.sourceUrl": 1, "artifacts.instructions.sourceUrl": 1 } })
    .toArray();
}

function renderText(report) {
  const s = report.summary;
  const out = [];
  out.push("OFFICIAL-SOURCE REDIRECT CRAWL (Release 0a, read-only)");
  out.push(`generated ${report.generatedAt}   urls crawled: ${s.urlsCrawled}   redirected: ${s.redirectedCount}`);
  out.push(`outcomes: ${Object.entries(s.outcomes).map(([key, count]) => `${key}=${count}`).join(", ")}`);
  out.push(`final statuses: ${Object.entries(s.finalStatuses).map(([key, count]) => `${key}=${count}`).join(", ") || "none"}   content types: ${Object.entries(s.contentTypes).map(([key, count]) => `${key}=${count}`).join(", ") || "none"}`);
  out.push(`VERDICT: ${s.verdict}`);
  if (s.redirected.length) { out.push(""); out.push("REDIRECTED URLS"); s.redirected.forEach((item) => { out.push(`  ${item.url} [${item.outcome}]`); item.chain.forEach((hop) => out.push(`      ${hop}`)); }); }
  if (s.chainsLeavingUscis.length) { out.push(""); out.push("CHAINS LEAVING uscis.gov"); s.chainsLeavingUscis.forEach((item) => out.push(`  ${item.url} (${item.forms.join(", ")}): ${item.chain.join(" -> ")}`)); }
  if (s.violations.length) { out.push(""); out.push("VIOLATIONS"); s.violations.forEach((item) => out.push(`  ${item.type} at hop ${item.hop}: ${item.url} (requested ${item.requested}; ${item.forms.join(", ")})`)); }
  if (s.failures.length) { out.push(""); out.push("FAILURES (not redirect problems)"); s.failures.forEach((item) => out.push(`  ${item.outcome} ${item.finalStatus ?? ""} ${item.url} (${item.forms.join(", ")}) ${item.error ? `${item.error.name}: ${item.error.message}` : ""}`)); }
  return out.join("\n");
}

function writeOutputFile(path, text) {
  fs.writeFileSync(path, text, "utf8");
}

function parseArgs(argv) {
  const args = { json: false, out: null, url: null, help: false, limit: null, concurrency: DEFAULTS.concurrency, delayMs: DEFAULTS.delayMs, timeoutMs: DEFAULTS.timeoutMs, maxHops: DEFAULTS.maxHops };
  const numbers = { "--concurrency": "concurrency", "--delay-ms": "delayMs", "--timeout-ms": "timeoutMs", "--max-hops": "maxHops", "--limit": "limit" };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--json") args.json = true;
    else if (flag === "--help" || flag === "-h") args.help = true;
    else if (flag === "--out" || flag === "--url") {
      args[flag.slice(2)] = argv[index + 1] || null;
      index += 1;
    } else if (numbers[flag]) {
      const value = Number(argv[index + 1]);
      if (Number.isFinite(value) && value >= 0) args[numbers[flag]] = value;
      index += 1;
    }
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log("usage: node src/scripts/formSourceRedirectCrawl.js [--url <url>] [--json] [--out <file>] [--concurrency 2] [--delay-ms 250] [--timeout-ms 15000] [--max-hops 5] [--limit N]\nRead-only. Sends GET requests to uscis.gov only; writes nothing to the database.");
    return 0;
  }
  let entries;
  if (args.url) {
    entries = [{ url: args.url, kinds: ["manual"], forms: [] }];
  } else {
    require("dotenv").config();
    const mongoose = require("mongoose");
    const env = require("../config/env");
    await mongoose.connect(env.mongoUri || process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
    try {
      entries = collectTrackedUrls(await loadTemplates(mongoose.connection.db));
    } finally {
      await mongoose.disconnect();
    }
  }
  if (args.limit) entries = entries.slice(0, args.limit);
  const results = await crawlAll(entries, {
    concurrency: args.concurrency, delayMs: args.delayMs, timeoutMs: args.timeoutMs, maxHops: args.maxHops,
    onProgress: (done, total) => { if (!args.json && (done % 10 === 0 || done === total)) process.stderr.write(`  crawled ${done}/${total}\n`); },
  });
  const report = { report: "form-source-redirect-crawl", release: "0a", readOnly: true, generatedAt: new Date().toISOString(), options: { maxHops: args.maxHops, timeoutMs: args.timeoutMs, concurrency: args.concurrency, delayMs: args.delayMs }, summary: summarizeCrawl(results), results };
  if (args.out) writeOutputFile(args.out, JSON.stringify(report, null, 2));
  console.log(args.json ? JSON.stringify(report, null, 2) : renderText(report));
  return 0;
}

module.exports = { checkUrl, crawlUrl, crawlAll, collectTrackedUrls, summarizeCrawl, loadTemplates, renderText, parseArgs, DEFAULTS, REDIRECT_STATUSES, ALLOWED_CONTENT_TYPES };

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((error) => { console.error(`redirect crawl failed: ${error.message}`); process.exit(1); });
}

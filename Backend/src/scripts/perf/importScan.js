// Static check for the plan's "no PDF parsing / certification / Gemini on the API thread" hard requirement: walks the require() graph from the hot-path files and reports any
// path that reaches a pipeline / AI-mapping / release module or a heavy library. It reads source text only (no code is executed, no database, no network). `require()` calls
// inside functions count too - a lazy require on the hot path is still a hot-path dependency.
const fs = require("node:fs");
const path = require("node:path");

const FORBIDDEN = Object.freeze([
  { name: "form pipeline", test: (file) => /[\\/]modules[\\/]form-pipeline[\\/]/.test(file) },
  { name: "AI mapping", test: (file) => /[\\/]modules[\\/]form-ai-mapping[\\/]/.test(file) },
  { name: "release gate / certification", test: (file) => /[\\/]modules[\\/]form-release[\\/]|FormCertificationService/.test(file) },
  { name: "AI orchestration (Gemini)", test: (file) => /[\\/]modules[\\/]ai[\\/]ai-orchestration/.test(file) },
]);
const FORBIDDEN_PACKAGES = Object.freeze(["@google/generative-ai", "@google/genai"]);

const REQUIRE = /require\(\s*["'`]([^"'`]+)["'`]\s*\)/g;

function resolveLocal(from, request) {
  const base = path.resolve(path.dirname(from), request);
  for (const candidate of [base, `${base}.js`, path.join(base, "index.js")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Returns [{ entry, via: [file, ... , offender], kind }] for every forbidden module reachable from the entry files. */
function scanHotPaths(entries, { read = (file) => fs.readFileSync(file, "utf8"), forbidden = FORBIDDEN } = {}) {
  const findings = [];
  for (const entry of entries) {
    const seen = new Set([entry]);
    const queue = [[entry, [entry]]];
    while (queue.length) {
      const [file, trail] = queue.shift();
      let source;
      try { source = read(file); } catch { continue; }
      for (const match of source.matchAll(REQUIRE)) {
        const request = match[1];
        if (!request.startsWith(".")) {
          if (FORBIDDEN_PACKAGES.includes(request)) findings.push({ entry, kind: `package ${request}`, via: [...trail, request] });
          continue;
        }
        const target = resolveLocal(file, request);
        if (!target || seen.has(target)) continue;
        seen.add(target);
        const hit = forbidden.find((rule) => rule.test(target));
        if (hit) { findings.push({ entry, kind: hit.name, via: [...trail, target] }); continue; } // do not walk past an offender
        queue.push([target, [...trail, target]]);
      }
    }
  }
  return findings;
}

module.exports = { scanHotPaths, FORBIDDEN };

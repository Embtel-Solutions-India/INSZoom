// READ-ONLY diagnostic for the two DOL ETA-9089 forms (uscis-form-import/config/externalForms.js). Resolves each form's official PDF exactly the way the pipeline does (way 1: the direct
// address; way 2: the current link on the official forms page), then reads it: identity, page / box count, content fingerprint. It touches NO database and NO storage and sends only the
// pipeline's own honest User-Agent. Use it to see what the server gets from dol.gov before / after a deploy.
//
//   node src/scripts/checkExternalFormSources.js [ETA-9089A|ETA-9089FD ...]
const { externalFormCodes } = require("../modules/uscis-form-import/config/externalForms");
const { resolveExternalPdf, USER_AGENT } = require("../modules/uscis-form-import/services/ExternalFormSource");
const Fingerprint = require("../modules/uscis-form-import/services/ExternalFormFingerprint");
const Identity = require("../modules/uscis-form-import/services/FormIdentityService");

async function main() {
  const wanted = process.argv.slice(2).map((code) => code.toUpperCase());
  console.log(`User-Agent sent: ${USER_AGENT}\n`);
  let failed = 0;
  for (const code of externalFormCodes().filter((item) => !wanted.length || wanted.includes(item))) {
    const resolved = await resolveExternalPdf({ formCode: code });
    console.log(`== ${code}`);
    for (const step of resolved.tried) console.log(`   ${step.route.padEnd(10)} ${String(step.status ?? "-").padEnd(4)} ${step.note}  ${step.url}`);
    if (!resolved.ok) { failed += 1; console.log(`   RESULT: NOT FETCHED - ${resolved.error}\n`); continue; }
    const identity = await Identity.check(resolved.bytes, code);
    const fingerprint = await Fingerprint.fingerprintOf(resolved.bytes);
    console.log(`   RESULT: fetched via ${resolved.via}: ${resolved.pdfUrl}`);
    console.log(`   identity ${JSON.stringify(identity)} | ${fingerprint.pageCount} pages, ${fingerprint.fieldCount} boxes | content ${fingerprint.content.slice(0, 16)} | sha256 ${fingerprint.sha256.slice(0, 16)} | OMB expiry (info only) ${fingerprint.ombExpiration}\n`);
  }
  process.exit(failed ? 1 : 0);
}
main().catch((error) => { console.error("failed:", error.message); process.exit(2); });

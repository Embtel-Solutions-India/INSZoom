// Catalog entry: the OFFICIAL source of a form published outside uscis.gov (the two DOL ETA-9089 forms, uscis-form-import/config/externalForms.js) refused the download (HTTP 401 / 403 / 429)
// or does not list the file. This is the linked solution for the error codes EXTERNAL_SOURCE_BLOCKED / EXTERNAL_SOURCE_UNRESOLVED (the Diagnoser maps both to the cause `source_not_found`).
// The first two strategies are the two ways the pipeline itself uses, re-run on their own so the evidence says which one works NOW (a direct link can be refused where the page's current link is
// not, and the other way round); a verified success asks the engine to retry the job. When neither works the job is a documented hold (NO_OFFICIAL_SOURCE) that re-checks every 12 hours; the
// remaining way is a person uploading the PDF through the admin upload (never automatic, never a bot-check workaround).
// Contract: { id, description, matches(diagnosis, error, ctx), strategies: [{ id, description, safe, run(ctx), verify(ctx, runResult) }] }.
const { externalFormFor, fileNameOf } = require("../../../uscis-form-import/config/externalForms");
const Source = require("../../../uscis-form-import/services/ExternalFormSource");

const isExternal = (error, ctx) => /^EXTERNAL_SOURCE_/.test(String(error?.code || "")) || Boolean(externalFormFor(ctx?.formCode || ctx?.job?.formCode));

function waysStrategy(id, description, only) {
  return {
    id, description, safe: true,
    async run(ctx) {
      const formCode = ctx.formCode || ctx.job?.formCode;
      const fetchImpl = ctx.deps?.fetchImpl;
      const resolved = await Source.resolveExternalPdf({ formCode, template: ctx.deps?.template, only, deps: fetchImpl ? { fetchImpl } : {} });
      if (resolved.ok) return { ok: true, retry: true, resolved: { pdfUrl: resolved.pdfUrl, via: resolved.via }, evidence: `${resolved.via}: ${resolved.pdfUrl} (200, %PDF- verified)` };
      return { ok: false, evidence: resolved.tried.map((step) => `${step.route} ${step.status ?? "-"} ${step.note}`).join("; ").slice(0, 400) || "nothing to try" };
    },
    // the run already downloaded the file and checked its %PDF- header; verify confirms the claim names an address of this very form
    async verify(ctx, run) {
      const entry = externalFormFor(ctx.formCode || ctx.job?.formCode);
      return Boolean(entry && run?.resolved?.pdfUrl && entry.filePrefix.test(fileNameOf(run.resolved.pdfUrl)));
    },
  };
}

module.exports = {
  id: "external_source",
  description: "The official source of a DOL ETA-9089 form refused the download or does not list the file: try the direct address, then the forms page's current link; otherwise hold and re-check (a person can upload the PDF)",
  matches(diagnosis, error, ctx) {
    return isExternal(error, ctx) && (diagnosis?.cause === "source_not_found" || /^EXTERNAL_SOURCE_/.test(String(error?.code || "")));
  },
  strategies: [
    waysStrategy("direct_address", "Way 1: the stored / known official file address", "direct"),
    waysStrategy("forms_page_current_link", "Way 2: the official forms page's current link for this form (also finds a renamed file after a renewal)", "forms_page"),
  ],
};

// Catalog entry (Phase 7.E): the official page / PDF address came back 404 or could not be located. Each strategy is one verified step of the SourceResolver;
// the first that finds a real PDF wins and asks the engine to retry (the learned address is written back by the integration, behind the autonomy switch).
// Contract: { id, description, matches(diagnosis, error, ctx), strategies: [{ id, description, safe, run(ctx), verify(ctx, runResult) }] }, ctx = { job, stage, formCode, error, diagnosis, attempt, deps }.
const { resolveSource } = require("../../../uscis-form-import/services/SourceResolver");

const looksUnresolved = (error) => /page fetch failed: 40[34]|USCIS_PDF_UNRESOLVED|could not locate a current pdf/i.test(`${error?.code || ""} ${error?.message || ""}`);

function strategy(id, description, steps) {
  return {
    id, description, safe: true,
    async run(ctx) {
      const resolved = await resolveSource({ formCode: ctx.formCode, template: ctx.deps?.template, registry: ctx.deps?.registry, deps: ctx.deps || {}, steps });
      const last = resolved.tried[resolved.tried.length - 1];
      return resolved.ok
        ? { ok: true, retry: true, resolved, evidence: `${resolved.via}: ${resolved.pdfUrl} (200)` }
        : { ok: false, evidence: resolved.tried.length ? `${resolved.tried.length} address(es) tried, last ${last.url} -> ${last.status ?? "no response"}` : "nothing to try" };
    },
    // the PDF was already fetched and checked for %PDF- by the resolver; verify re-checks the claim the run makes
    async verify(ctx, runResult) {
      const url = runResult?.resolved?.pdfUrl;
      if (!url) return false;
      const check = await resolveSource({ formCode: ctx.formCode, deps: { ...(ctx.deps || {}), fetch: ctx.deps?.fetch }, template: { officialPdfUrl: url }, steps: ["stored"] });
      return Boolean(check.ok);
    },
  };
}

module.exports = {
  id: "source_not_found",
  description: "The official page or PDF address answered 404 or could not be located; find the real address, verify it, and remember it",
  matches(diagnosis, error) {
    return diagnosis?.cause === "source_not_found" || (!diagnosis?.cause && looksUnresolved(error));
  },
  strategies: [
    strategy("stored_source_recheck", "Re-check the address saved on the template or registry", ["stored"]),
    strategy("alias_slugs", "Try the form's own page by alias data and the supplement slug pattern (I-485J -> /i-485supj)", ["alias"]),
    strategy("parent_page_scan", "Scan the parent form's page for this form's PDF link (I-539A on /i-539)", ["parent_page"]),
    strategy("stable_pdf_url", "Try the stable official PDF address /sites/default/files/document/forms/<slug>.pdf", ["stable_pdf"]),
    strategy("directory_entry", "Look the form up in the all-forms directory", ["directory"]),
  ],
};

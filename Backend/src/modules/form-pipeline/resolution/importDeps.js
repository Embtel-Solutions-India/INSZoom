// Phase 7.2: the real implementations of the injectable dependencies the generic error-resolution catalog calls (resolution/catalog/{network,notAPdf,pdfDamaged,xfaNoFields,
// templateTooLarge}.js). Each function receives the resolution context ({ job, stage, formCode, error, diagnosis, ... }) and answers { ok, evidence, retry? }:
//   ok:true means "I changed something that makes the next attempt different AND I checked that it works" - the resolver then verifies and the pipeline runs the work once more.
// None of them writes to the database or to storage; the only state they leave is an in-memory, expiring hint for the retry (services/PdfDownload.js): "use this address" or
// "normalize this form with the JavaScript normalizer". Every network call goes through the hardened official-source fetcher (https, uscis.gov, per-hop checks, timeout, size cap).
// Dependencies are injectable (createImportDeps({ fetcher, loadTemplate, resolveSource, ... })) so every strategy is unit-tested without a network or a database.
const HEADER = Buffer.from("%PDF-");

const slugsOf = (formCode) => {
  const base = String(formCode || "").trim().toLowerCase().replace(/\s+/g, "-");
  return [...new Set([base, base.replace(/-/g, "")].filter(Boolean))];
};

/** Was the failed work a timeout (slow server / no answer in time)? Only then does a longer wait help. */
function isTimeoutFailure(ctx) {
  const error = ctx?.error || {};
  const text = `${error.message || ""} ${error.code || ""} ${error.name || ""}`;
  return /timeout|timed out|etimedout|aborterror|aborted|no response within/i.test(text); // the official-source fetcher words its own deadline "no response within N ms"
}

function createImportDeps(options = {}) {
  const lazy = {
    fetcher: () => options.fetcher || require("../../form-edition-policy/OfficialSourceFetcher").fetchOfficialSource,
    pdfDownload: () => options.pdfDownload || require("../../uscis-form-import/services/PdfDownload"),
    fallback: () => options.normalizeFallback || require("../../../utils/normalizeFallback"),
    resolveSource: () => options.resolveSource || require("../../uscis-form-import/services/SourceResolver").resolveSource,
    loadTemplate: () => options.loadTemplate || (async (formCode) => require("../../../models/USCISFormTemplate")
      .findOne({ formCode: String(formCode || "").toUpperCase() }).sort({ createdAt: -1 }).select("formCode officialPdfUrl lifecycle.sourcePdfUrl lifecycle.sourcePageUrl").lean()),
  };

  /** The address that failed (carried by the error) or, failing that, the one stored on the form's newest template. */
  async function locate(ctx) {
    const template = await Promise.resolve(lazy.loadTemplate()(ctx?.formCode)).catch(() => null);
    const url = ctx?.error?.sourceUrl || ctx?.error?.url || template?.officialPdfUrl || template?.lifecycle?.sourcePdfUrl || null;
    return { url, template };
  }

  /** Downloads `address` and checks it is a complete PDF. { ok, buffer, evidence }. Never throws. */
  async function probe(address, extra = {}) {
    try {
      const PdfDownload = lazy.pdfDownload();
      const result = await lazy.fetcher()(address, { accept: "pdf", maxBytes: PdfDownload.maxBytes(), timeoutMs: extra.timeoutMs || PdfDownload.timeoutMs() });
      if (!result.ok) return { ok: false, evidence: `${address}: ${result.error || (result.violations?.[0]?.type) || "no response"}` };
      const seen = PdfDownload.inspect(result.bytes);
      if (!seen.header) return { ok: false, evidence: `${address}: not a PDF` };
      const trimmed = PdfDownload.trimLeadingJunk(result.bytes);
      if (!seen.complete) return { ok: false, evidence: `${address}: the PDF is cut off (no end-of-file marker)` };
      return { ok: true, buffer: trimmed.buffer, evidence: `${address}: complete PDF, ${trimmed.buffer.length} bytes` };
    } catch (error) {
      return { ok: false, evidence: `${address}: ${String(error?.message || error).slice(0, 120)}` };
    }
  }

  const noUrl = { ok: false, evidence: "the address of the failed download is not known" };

  return {
    /** network: the other host form (www. <-> apex) of the same official address. */
    async fetchVariant(ctx) {
      const { url } = await locate(ctx);
      if (!url) return noUrl;
      let parsed;
      try { parsed = new URL(url); } catch { return { ok: false, evidence: `not a valid address: ${url}` }; }
      const host = parsed.hostname.toLowerCase();
      const other = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
      parsed.hostname = other;
      const variant = parsed.toString();
      const found = await probe(variant);
      if (!found.ok) return { ok: false, evidence: found.evidence };
      lazy.pdfDownload().setUrlOverride(url, variant);
      return { ok: true, retry: true, evidence: `${found.evidence} (host form ${other})` };
    },

    /**
     * network: the same address with a much longer timeout. Honest on both sides: it only claims a fix when the failure WAS a timeout, and when it does it leaves the hint the retry of
     * the download reads (PdfDownload.setTimeoutHint), so the retry really waits longer. Any other failure: ok:false (a longer wait would change nothing).
     */
    async retryWithTimeout(ctx) {
      if (!isTimeoutFailure(ctx)) return { ok: false, evidence: "the failure was not a timeout; waiting longer changes nothing" };
      const { url } = await locate(ctx);
      if (!url) return noUrl;
      const PdfDownload = lazy.pdfDownload();
      const longer = 3 * PdfDownload.timeoutMs();
      const found = await probe(url, { timeoutMs: longer });
      if (!found.ok) return { ok: false, evidence: found.evidence };
      PdfDownload.setTimeoutHint(url, longer);
      return { ok: true, retry: true, evidence: `${found.evidence} (the retry waits up to ${longer} ms)` };
    },

    /** not a PDF / damaged: download the same address again with a cache-busting query; the retry uses that address. */
    async redownload(ctx) {
      const { url } = await locate(ctx);
      if (!url) return noUrl;
      let busted;
      try { busted = lazy.pdfDownload().withBuster(url, 2); } catch { return { ok: false, evidence: `not a valid address: ${url}` }; }
      const found = await probe(busted);
      if (!found.ok) return { ok: false, evidence: found.evidence };
      lazy.pdfDownload().setUrlOverride(url, busted);
      return { ok: true, retry: true, evidence: found.evidence };
    },

    /** not a PDF: find the official PDF link again (stored address, aliases, parent page, stable address) and use it when it is a different, verified address. */
    async reresolvePdfLink(ctx) {
      const { url, template } = await locate(ctx);
      const resolved = await lazy.resolveSource()({ formCode: ctx?.formCode, template });
      if (!resolved?.ok || !resolved.pdfUrl) return { ok: false, evidence: `no verified PDF link found (${(resolved?.tried || []).length} addresses tried)` };
      if (resolved.pdfUrl === url) return { ok: false, evidence: `the official link is the same address that failed (${url})` };
      if (url) lazy.pdfDownload().setUrlOverride(url, resolved.pdfUrl);
      return { ok: true, retry: true, evidence: `official PDF link ${resolved.pdfUrl} (via ${resolved.via})` };
    },

    /** damaged: qpdf could not read the file; prove the JavaScript normalizer can (same pages, same field names) and let the retry use it once. */
    async alternateNormalize(ctx) {
      const { url } = await locate(ctx);
      if (!url) return noUrl;
      const found = await probe(url);
      if (!found.ok) return { ok: false, evidence: found.evidence };
      try {
        const { report } = await lazy.fallback().normalizeVerified(found.buffer);
        lazy.pdfDownload().markFallbackNormalize(ctx?.formCode);
        return { ok: true, retry: true, evidence: `JavaScript normalizer keeps ${report.pages} pages and ${report.fields} fields` };
      } catch (error) {
        return { ok: false, evidence: `JavaScript normalizer not usable: ${String(error?.message || error).slice(0, 140)}` };
      }
    },

    /** XFA-only / no fields: a fillable (AcroForm) companion PDF linked on the official page, verified to really have fields. Never converts anything. */
    async findCompanionPdf(ctx) {
      const { url, template } = await locate(ctx);
      const pageUrl = template?.lifecycle?.sourcePageUrl || (await Promise.resolve(lazy.resolveSource()({ formCode: ctx?.formCode, template }).catch(() => null)))?.pageUrl;
      if (!pageUrl) return { ok: false, evidence: "the official page of this form is not known" };
      const page = await lazy.fetcher()(pageUrl, { accept: "html" }).catch(() => null);
      if (!page?.ok) return { ok: false, evidence: `the official page could not be read (${page?.error || "no response"})` };
      const html = Buffer.from(page.bytes).toString("utf8");
      const slugs = slugsOf(ctx?.formCode);
      const links = [...html.matchAll(/href="([^"#]+?\.pdf[^"]*)"/gi)].map((match) => { try { return new URL(match[1].replace(/&amp;/g, "&"), pageUrl).toString(); } catch { return null; } })
        .filter((link) => link && link !== url && /^https:\/\/([a-z0-9-]+\.)?uscis\.gov\//i.test(link) && !/instr/i.test(link) && slugs.some((slug) => link.toLowerCase().includes(slug)));
      for (const link of [...new Set(links)].slice(0, 5)) {
        const found = await probe(link);
        if (!found.ok) continue;
        try {
          const { names } = await lazy.fallback().describeBuffer(found.buffer);
          if (names.length > 0) {
            lazy.pdfDownload().setUrlOverride(url || ctx?.error?.sourceUrl, link);
            return { ok: true, retry: true, evidence: `fillable companion ${link} (${names.length} fields)` };
          }
        } catch { /* not readable as a form: next link */ }
      }
      return { ok: false, evidence: `no fillable companion PDF found on ${pageUrl} (${links.length} candidate link(s) checked)` };
    },

    /**
     * template too large: the importer already removes, by itself and only when proven identical to a top-level twin, the definition.* copies (TemplateSizeGuard.slim); an error
     * that still reaches here means that was not enough. Nothing else is removed (a structure that cannot be proven recomputable is never dropped) - the answer reports the sizes.
     */
    async shrinkTemplate(ctx) {
      const sizes = ctx?.error?.sizes || {};
      const top = Object.entries(sizes).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([key, bytes]) => `${key} ${(bytes / 1048576).toFixed(2)} MB`).join(", ");
      return { ok: false, evidence: `already stored once each (proven duplicates removed automatically); still too large: ${top || "sizes unknown"}; moving a large block to storage needs the owner's approval` };
    },

    trimLeadingJunk: (buffer) => {
      const at = Buffer.isBuffer(buffer) ? buffer.subarray(0, 1024).indexOf(HEADER) : -1;
      return at > 0 ? buffer.subarray(at) : null;
    },
  };
}

// the catalog calls the companion finder by this name in one place and the directive by another: both work
function withAliases(deps) { return { ...deps, acroformCompanion: deps.findCompanionPdf }; }

module.exports = { createImportDeps: (options) => withAliases(createImportDeps(options)), slugsOf };

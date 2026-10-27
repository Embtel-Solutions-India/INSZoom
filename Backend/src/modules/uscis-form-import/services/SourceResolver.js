// Phase 7.E - finds the REAL official address of a form and remembers it.
// The import path used to build the page address from the form code (I-485J -> /i-485j) and give up on a 404, although USCIS publishes that form at
// /i-485supj, and I-539A is only a link on the /i-539 page. This resolver tries, in order, and VERIFIES every candidate:
//   1. stored       the address saved on the template / registry from an earlier success
//   2. alias        the form's own page by alias data and by the code-derived slugs (supplement pattern included)
//   3. parent_page  the parent form's page, scanned for a link whose file name is this form's PDF
//   4. stable_pdf   https://www.uscis.gov/sites/default/files/document/forms/<slug>.pdf
//   5. directory    the all-forms directory entry for the form
// A page counts only on HTTP 200 whose text names the form or links its PDF; a PDF counts only as application/pdf starting with %PDF-.
// All network goes through the hardened OfficialSourceFetcher (https + uscis.gov only, per-hop checks, timeout, size cap), GET only, injectable as deps.fetch.
// Nothing here writes: rememberSource() is the single, injectable write-back and does nothing unless FORM_PIPELINE_AUTONOMY=on.
const { aliasFor } = require("../config/formSourceAliases");

const BASE = "https://www.uscis.gov";
const PDF_DIR = `${BASE}/sites/default/files/document/forms`;
const STEP_ORDER = Object.freeze(["stored", "alias", "parent_page", "stable_pdf", "directory"]);

const upper = (value) => String(value || "").toUpperCase().trim();
const alnum = (value) => upper(value).replace(/[^A-Z0-9]/g, "");

/** I-485J, "I-485 Supplement J", "I-918SUPA" ... -> { base: "I-485", letter: "J" | null } */
function splitCode(formCode) {
  // "Supplement", "Supp." and "Sup." are all "SUP"
  const compact = upper(formCode).replace(/\s+/g, "").replace(/SUPPLEMENT|SUPP\.?|SUP\./g, "SUP");
  const match = compact.match(/^([A-Z]{1,3}-\d{2,4})(?:SUP)?([A-Z]{1,2})?$/);
  return match ? { base: match[1], letter: match[2] || null } : { base: compact, letter: null };
}

/** Everything we know about how this form may be spelled: slugs (page + pdf), name variants, parent code. Pure. */
function describeForm(formCode) {
  const alias = aliasFor(formCode);
  const { base, letter } = splitCode(formCode);
  const lower = base.toLowerCase();
  const derived = [];
  if (letter) derived.push(`${lower}${letter.toLowerCase()}`, `${lower}sup${letter.toLowerCase()}`, `${lower.replace("-", "")}${letter.toLowerCase()}`);
  else derived.push(lower, lower.replace("-", ""));
  const pageSlugs = [...new Set([...(alias?.pageSlugs || []), ...derived])];
  const pdfSlugs = [...new Set([...(alias?.pdfSlugs || []), ...derived])];
  const parentCode = alias?.parent || (letter ? base : null);
  const nameVariants = new Set([alnum(formCode), alnum(`${base}${letter || ""}`), ...(letter ? [alnum(`${base}SUP${letter}`), alnum(`${base}SUPPLEMENT${letter}`)] : [])]);
  return { alias, base, letter, pageSlugs, pdfSlugs, parentCode, parentSlug: parentCode ? parentCode.toLowerCase() : null, nameVariants: [...nameVariants].filter(Boolean) };
}

const pageUrlOf = (slug) => `${BASE}/${slug}`;
const pdfUrlOf = (slug) => `${PDF_DIR}/${slug}.pdf`;
const fileSlug = (url) => String(url || "").split(/[?#]/)[0].split("/").pop().replace(/\.pdf$/i, "").toLowerCase();
const isOfficial = (url) => { try { const { protocol, hostname } = new URL(url); return protocol === "https:" && (hostname === "uscis.gov" || hostname.endsWith(".uscis.gov")); } catch { return false; } };

function anchorsOf(html, baseUrl) {
  const found = [];
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const href = match[1].match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    let url;
    try { url = new URL(href.replace(/&amp;/g, "&"), baseUrl).toString(); } catch { continue; }
    if (isOfficial(url)) found.push({ url, text: match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() });
  }
  return found;
}

function defaultFetch(url, { accept = "html" } = {}) {
  return require("../../form-edition-policy/OfficialSourceFetcher").fetchOfficialSource(url, { accept });
}

function createResolver(deps = {}) {
  const fetchOne = deps.fetch || defaultFetch;
  const tried = [];
  const note = (url, status, text) => tried.push({ url, status, note: text });

  async function getPdf(url) {
    if (!isOfficial(url)) { note(url, null, "not an official uscis.gov address"); return null; }
    const result = await fetchOne(url, { accept: "pdf" }).catch((error) => ({ ok: false, error: error?.message }));
    const bytes = result?.bytes;
    if (result?.ok && bytes && Buffer.from(bytes).subarray(0, 5).toString("latin1") === "%PDF-") { note(url, result.status ?? 200, "pdf verified"); return { url: result.finalUrl || url, bytes }; }
    note(url, result?.status ?? null, result?.ok ? "not a PDF" : (result?.error || "unreachable"));
    return null;
  }

  async function getPage(url, info) {
    if (!isOfficial(url)) { note(url, null, "not an official uscis.gov address"); return null; }
    const result = await fetchOne(url, { accept: "html" }).catch((error) => ({ ok: false, error: error?.message }));
    if (!result?.ok || !result.bytes) { note(url, result?.status ?? null, result?.error || "unreachable"); return null; }
    const html = Buffer.from(result.bytes).toString("utf8");
    const finalUrl = result.finalUrl || url;
    const anchors = anchorsOf(html, finalUrl);
    const text = alnum(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
    const linksOwnPdf = anchors.some((anchor) => /\.pdf(?:$|[?#])/i.test(anchor.url) && info.pdfSlugs.includes(fileSlug(anchor.url)));
    const namesForm = info.nameVariants.some((variant) => text.includes(variant));
    if (!linksOwnPdf && !namesForm) { note(url, result.status ?? 200, "page does not name or link this form"); return null; }
    note(url, result.status ?? 200, linksOwnPdf ? "page links the form's PDF" : "page names the form");
    return { url: finalUrl, html, anchors };
  }

  /** the PDF link on a page that belongs to this form (file name equals one of its slugs), instructions link when present */
  const ownPdfLink = (page, info) => page.anchors.find((anchor) => /\.pdf(?:$|[?#])/i.test(anchor.url) && info.pdfSlugs.includes(fileSlug(anchor.url)) && !/instruction/i.test(`${anchor.text} ${anchor.url}`));
  const instructionsLink = (page, info) => page.anchors.find((anchor) => /\.pdf(?:$|[?#])/i.test(anchor.url) && /instruction/i.test(`${anchor.text} ${anchor.url}`) && info.pdfSlugs.some((slug) => fileSlug(anchor.url).includes(slug)));
  const win = (via, pageUrl, pdf, instructionsUrl) => ({ ok: true, via, pageUrl: pageUrl || null, pdfUrl: pdf.url, ...(instructionsUrl ? { instructionsUrl } : {}) });

  const steps = {
    async stored({ info, template, registry }) {
      const lifecycle = template?.lifecycle || {};
      const pdfCandidates = [template?.officialPdfUrl, lifecycle.sourcePdfUrl, registry?.officialPdfUrl].filter(Boolean);
      const pageCandidates = [lifecycle.sourcePageUrl, template?.sourcePageUrl, registry?.sourcePageUrl, registry?.officialPageUrl].filter(Boolean);
      for (const url of [...new Set(pdfCandidates)]) {
        const pdf = await getPdf(url);
        if (pdf) return win("stored", pageCandidates[0], pdf);
      }
      for (const url of [...new Set(pageCandidates)]) {
        const page = await getPage(url, info);
        const link = page && ownPdfLink(page, info);
        const pdf = link && await getPdf(link.url);
        if (pdf) return win("stored", page.url, pdf, instructionsLink(page, info)?.url);
      }
      return null;
    },
    async alias({ info }) {
      for (const slug of info.pageSlugs) {
        const page = await getPage(pageUrlOf(slug), info);
        if (!page) continue;
        const link = ownPdfLink(page, info);
        const pdf = link ? await getPdf(link.url) : null;
        if (pdf) return win("alias", page.url, pdf, instructionsLink(page, info)?.url);
        for (const pdfSlug of info.pdfSlugs) { const stable = await getPdf(pdfUrlOf(pdfSlug)); if (stable) return win("alias", page.url, stable); }
      }
      return null;
    },
    async parent_page({ info }) {
      if (!info.parentSlug) return null;
      const page = await getPage(pageUrlOf(info.parentSlug), { ...info, nameVariants: [...info.nameVariants, alnum(info.parentCode)] });
      if (!page) return null;
      const link = ownPdfLink(page, info);
      const pdf = link ? await getPdf(link.url) : null;
      return pdf ? win("parent_page", page.url, pdf, instructionsLink(page, info)?.url) : null;
    },
    async stable_pdf({ info }) {
      for (const slug of info.pdfSlugs) {
        const pdf = await getPdf(pdfUrlOf(slug));
        if (pdf) return win("stable_pdf", null, pdf);
      }
      return null;
    },
    async directory({ info, formCode }) {
      const rows = await Promise.resolve(deps.directory ? deps.directory({ formCode, info }) : defaultDirectory(info)).catch(() => []);
      for (const row of rows || []) {
        if (!info.nameVariants.includes(alnum(row.formCode))) continue;
        if (row.pdfUrl) { const pdf = await getPdf(row.pdfUrl); if (pdf) return win("directory", row.pageUrl, pdf); }
        if (row.pageUrl) {
          const page = await getPage(row.pageUrl, info);
          const link = page && ownPdfLink(page, info);
          const pdf = link && await getPdf(link.url);
          if (pdf) return win("directory", page.url, pdf);
        }
      }
      return null;
    },
  };

  return { steps, tried };
}

async function defaultDirectory() {
  const Scanner = require("../../uscis-lifecycle/services/USCISScannerService");
  const html = await Scanner.fetchPage(Scanner.OFFICIAL_SOURCES?.formsDirectoryUrl || `${BASE}/forms/all-forms`);
  return Scanner.extractDirectoryForms(html);
}

/**
 * resolveSource({ formCode, template?, registry?, deps?, steps? }) -> { ok, via, pageUrl, pdfUrl, instructionsUrl?, tried: [{url,status,note}] }
 * `steps` limits the work to some of STEP_ORDER (the error-resolution catalog runs them one at a time). Never throws.
 */
async function resolveSource({ formCode, template = null, registry = null, deps = {}, steps = STEP_ORDER } = {}) {
  const resolver = createResolver(deps);
  const info = describeForm(formCode);
  try {
    for (const name of STEP_ORDER) {
      if (!steps.includes(name)) continue;
      const found = await resolver.steps[name]({ info, template, registry, formCode });
      if (found) return { ...found, tried: resolver.tried };
    }
  } catch (error) {
    resolver.tried.push({ url: null, status: null, note: `resolver error: ${String(error?.message || error).slice(0, 120)}` });
  }
  return { ok: false, via: null, pageUrl: null, pdfUrl: null, tried: resolver.tried };
}

/**
 * The learned solution: store the address that worked on the template so the next sync goes straight to it. Only when FORM_PIPELINE_AUTONOMY=on and the template
 * exists; `deps.saveSource(template, fields)` replaces the default write (tests). Resolves true when something was written; never throws.
 */
async function rememberSource({ template, resolved, deps = {}, env = process.env }) {
  try {
    if (!resolved?.ok || !template?._id) return false;
    if (require("../../../config/formPipelineAutonomy").mode(env) !== "on") return false;
    const fields = { officialPdfUrl: resolved.pdfUrl, "lifecycle.sourcePdfUrl": resolved.pdfUrl, ...(resolved.pageUrl ? { "lifecycle.sourcePageUrl": resolved.pageUrl } : {}) };
    if (deps.saveSource) { await deps.saveSource(template, fields); return true; }
    await require("../../../models/USCISFormTemplate").updateOne({ _id: template._id }, { $set: fields });
    return true;
  } catch {
    return false;
  }
}

module.exports = { resolveSource, rememberSource, describeForm, STEP_ORDER, pdfUrlOf, pageUrlOf };

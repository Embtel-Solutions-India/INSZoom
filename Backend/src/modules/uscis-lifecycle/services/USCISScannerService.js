const crypto = require("crypto");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const USCISFormSyncRun = require("../../../models/USCISFormSyncRun");
const FormComparisonService = require("./FormComparisonService");
const FormImportService = require("./FormImportService");
const VersionManagementService = require("./VersionManagementService");
const autonomy = require("../../../config/formPipelineAutonomy");
const codePatterns = require("../../uscis-form-import/config/formCodePattern");
const EditionAuthority = require("../../uscis-form-import/services/EditionAuthority");
const logger = require("../../../utils/logger");

const OFFICIAL_SOURCES = Object.freeze({
  provider: "uscis",
  formsDirectoryUrl: "https://www.uscis.gov/forms/all-forms",
  formsUpdatesUrl: "https://www.uscis.gov/forms/forms-updates",
});

const FORM_CODE_PATTERN = /\b([A-Z]{1,3}-\d{2,4}[A-Z]?(?:[\s_-]+SUPPLEMENT[\s_-]+[A-Z])?)\b/gi;
const MAX_SCAN_HISTORY = 50;

class USCISScannerService {
  static checksum(value = "") {
    return crypto.createHash("sha256").update(String(value)).digest("hex");
  }

  static normalizeFormCode(value = "") {
    const normalized = String(value).trim().toUpperCase();
    const supplement = normalized.match(/^([A-Z]{1,3}-\d{2,4}[A-Z]?)[\s_-]+SUPPLEMENT[\s_-]+([A-Z])$/);
    // BUG (fixed): this returned mixed-case "Supplement" (lowercase "upplement")
    // even though `normalized` itself, and every caller comparing this
    // return value, is uppercase throughout. Every caller that then does
    // `.replace(/[^A-Z0-9]/g, "")` for a case-sensitive comparison (e.g.
    // extractFormPageMetadata's own anchor-text match) silently drops those
    // lowercase letters - "I-918 Supplement A" collapsed to just "I918SA",
    // never matching the real anchor text's "I918SUPPLEMENTA...". Confirmed
    // live: this is exactly why I-918/I-485's Supplement A/B/J lookups kept
    // falling through to an unrelated "first PDF on the page" result no
    // matter what the caller passed in. All-uppercase here matches every
    // other branch of this same function.
    return supplement ? `${supplement[1]} SUPPLEMENT ${supplement[2]}` : normalized.replace(/\s+/g, "");
  }

  static assertOfficialUscisUrl(url) {
    const parsed = new URL(url);
    if (parsed.hostname !== "uscis.gov" && !parsed.hostname.endsWith(".uscis.gov")) {
      const error = new Error("Only official USCIS sources are supported for form synchronization");
      error.status = 400;
      throw error;
    }
    return parsed;
  }

  static absoluteUrl(url) {
    if (!url) return null;
    const absolute = /^https?:\/\//i.test(url) ? url : `https://www.uscis.gov${url.startsWith("/") ? "" : "/"}${url}`;
    this.assertOfficialUscisUrl(absolute);
    return absolute;
  }

  static htmlDecode(value = "") {
    return String(value)
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  static stripTags(value = "") {
    return this.htmlDecode(String(value).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  }

  static normalizeEditionDate(value) {
    if (!value) return null;
    const numeric = String(value).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (numeric) {
      const year = Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]);
      const parsed = new Date(Date.UTC(year, Number(numeric[1]) - 1, Number(numeric[2])));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  static editionVersion(editionDate, checksum) {
    if (editionDate) return editionDate.toISOString().slice(0, 10);
    return `official-${String(checksum || "").slice(0, 12)}`;
  }

  static extractEditionDate(text = "") {
    const patterns = [
      /Edition(?: Date)?[:\s-]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
      /Edition(?: Date)?[:\s-]*([A-Z][a-z]+ \d{1,2},?\s+\d{4})/i,
      /New Edition Dated[:\s-]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    ];
    for (const pattern of patterns) {
      const match = String(text).match(pattern);
      const editionDate = this.normalizeEditionDate(match?.[1]);
      if (editionDate) return editionDate;
    }
    return null;
  }

  /**
   * Phase 7.2 (FORM_PIPELINE_AUTONOMY=on): the page's own labelled "Edition Date <date>" wins over looser "edition ... <date>" mentions elsewhere in the text, and a date more
   * than a day in the future is rejected (EditionAuthority). Off / shadow keep extractEditionDate as it always was.
   */
  static pageEditionDate(text = "") {
    const labelled = String(text).match(/Edition Date[:\s-]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    const candidate = this.normalizeEditionDate(labelled?.[1]) || this.extractEditionDate(text);
    return EditionAuthority.decide({ pageEditionDate: candidate }).editionDate;
  }

  /** The edition date for a page's text under the current switch (shadow computes the new answer and logs a difference; it never returns it). */
  static editionDateOf(text = "", context = {}) {
    const mode = autonomy.mode();
    const legacy = this.extractEditionDate(text);
    if (mode === "off") return legacy;
    let next = legacy;
    try { next = this.pageEditionDate(text); } catch (error) { next = legacy; }
    const day = (value) => (value ? value.toISOString().slice(0, 10) : null);
    if (mode === "shadow") {
      if (day(next) !== day(legacy)) logger.warn("uscis_scanner_would_change_edition", { ...context, current: day(legacy), would: day(next) });
      return legacy;
    }
    return next;
  }

  static extractRevisionDate(text = "") {
    const patterns = [
      /Last Reviewed\/Updated[:\s-]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
      /(?:Revision Date|Revised|Updated)[:\s-]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
      /(?:Revision Date|Revised|Updated)[:\s-]*([A-Z][a-z]+ \d{1,2},?\s+\d{4})/i,
    ];
    for (const pattern of patterns) {
      const match = String(text).match(pattern);
      const revisionDate = this.normalizeEditionDate(match?.[1]);
      if (revisionDate) return revisionDate;
    }
    return null;
  }

  static extractMetaContent(html = "", names = []) {
    for (const name of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const patterns = [
        new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["']`, "i"),
      ];
      for (const pattern of patterns) {
        const value = html.match(pattern)?.[1];
        if (value) return this.htmlDecode(value).trim();
      }
    }
    return null;
  }

  static extractFormPageMetadata(html = "", pageUrl, formCode) {
    const normalizedCode = this.normalizeFormCode(formCode);
    const text = this.stripTags(html);
    const anchors = this.anchorCandidates(html, pageUrl);
    const pdfAnchors = anchors.filter((anchor) => /\.pdf(?:$|[?#])/i.test(anchor.url));
    const legacyInstructions = pdfAnchors.find((anchor) => /instructions?/i.test(`${anchor.text} ${anchor.url}`));
    const legacyFormPdf = pdfAnchors.find((anchor) => (
      !/instructions?/i.test(`${anchor.text} ${anchor.url}`)
      && (
        this.normalizeFormCode(anchor.text).replace(/[^A-Z0-9]/g, "").includes(normalizedCode.replace(/[^A-Z0-9]/g, ""))
        || anchor.url.toUpperCase().replace(/[^A-Z0-9]/g, "").includes(normalizedCode.replace(/[^A-Z0-9]/g, ""))
      )
    )) || pdfAnchors.find((anchor) => !/instructions?/i.test(`${anchor.text} ${anchor.url}`));
    // Phase 7.2: judged by FILE NAME and link text START (the real I-9 page labels the form itself "... Download Instructions tab ...", which the old word test took for instructions)
    const chosenPdf = this.chooseFormPdf(pdfAnchors, normalizedCode, legacyFormPdf, { page: pageUrl, formCode: normalizedCode });
    const formPdf = chosenPdf.pdf;
    const instructions = chosenPdf.instructions === undefined ? legacyInstructions : (chosenPdf.instructions || legacyInstructions);
    const heading = this.stripTags(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
    const formName = heading || this.extractMetaContent(html, ["og:title", "twitter:title"]) || normalizedCode;
    const relatedForms = [...new Set(anchors.flatMap((anchor) => (
      [...`${anchor.text} ${anchor.url}`.matchAll(codePatterns.scanPattern())].map((match) => this.normalizeFormCode(match[1]))
    )).filter((code) => code !== normalizedCode))];
    const category = this.extractMetaContent(html, ["article:section", "uscis:form-category", "category"]);
    const description = this.extractMetaContent(html, ["description", "og:description"]);
    const editionDate = this.editionDateOf(text, { formCode: normalizedCode, page: pageUrl });
    const revisionDate = this.extractRevisionDate(text);
    const checksum = this.checksum(JSON.stringify({
      formCode: normalizedCode,
      formName,
      editionDate: editionDate?.toISOString(),
      revisionDate: revisionDate?.toISOString(),
      pdfUrl: formPdf?.url,
      instructionsPdfUrl: instructions?.url,
      relatedForms,
      category,
    }));
    return {
      formType: normalizedCode,
      formCode: normalizedCode,
      formName,
      description,
      editionDate,
      revisionDate,
      version: this.editionVersion(editionDate, checksum),
      pdfUrl: formPdf?.url || null,
      instructionsPdfUrl: instructions?.url || null,
      relatedForms,
      category,
      categories: category ? [category] : [],
      officialStatus: "current",
      pageUrl,
      sourceUrl: OFFICIAL_SOURCES.formsDirectoryUrl,
      checksum,
      detectedAt: new Date(),
    };
  }

  /**
   * Which PDF link is the form. off: the old answer. shadow: the old answer, a warning when the new rule would choose differently. on: EditionAuthority.choosePdf (never an
   * instructions PDF, the file name or link text must name the form; the first non-instructions PDF remains the last resort, as before).
   * Returns { pdf, instructions } - instructions undefined means "keep the old instructions rule".
   */
  static chooseFormPdf(pdfAnchors, formCode, legacyPdf, context = {}) {
    const mode = autonomy.mode();
    if (mode === "off") return { pdf: legacyPdf, instructions: undefined };
    let next = legacyPdf;
    let instructions;
    try {
      const aliasSlugs = (require("../../uscis-form-import/config/formSourceAliases").aliasFor(formCode)?.pdfSlugs) || [];
      next = EditionAuthority.choosePdf(pdfAnchors, formCode, { aliasSlugs, allowFirstResort: true }) || legacyPdf;
      instructions = pdfAnchors.find((anchor) => EditionAuthority.isInstructionsPdf(anchor)) || null;
    } catch (error) {
      return { pdf: legacyPdf, instructions: undefined };
    }
    if (mode === "shadow") {
      if ((next?.url || null) !== (legacyPdf?.url || null)) logger.warn("uscis_scanner_would_change_pdf", { ...context, current: legacyPdf?.url || null, would: next?.url || null });
      return { pdf: legacyPdf, instructions: undefined };
    }
    return { pdf: next, instructions };
  }

  static directoryPageUrls(html = "", sourceUrl = OFFICIAL_SOURCES.formsDirectoryUrl) {
    const source = new URL(sourceUrl);
    return [...new Set(this.anchorCandidates(html, sourceUrl)
      .map((anchor) => anchor.url)
      .filter((url) => {
        const parsed = new URL(url);
        return parsed.pathname === source.pathname && parsed.searchParams.has("page");
      }))];
  }

  static anchorCandidates(html = "", sourceUrl = OFFICIAL_SOURCES.formsDirectoryUrl) {
    const anchors = [];
    const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = anchorPattern.exec(html))) {
      const href = match[1].match(/\bhref=["']([^"']+)["']/i)?.[1];
      if (!href) continue;
      let url;
      try {
        url = this.absoluteUrl(this.htmlDecode(href));
      } catch (error) {
        continue;
      }
      const text = this.stripTags(match[2]);
      const contextStart = Math.max(0, match.index - 700);
      const contextEnd = Math.min(html.length, anchorPattern.lastIndex + 700);
      const context = this.stripTags(html.slice(contextStart, contextEnd));
      anchors.push({ url, text, context, sourceUrl });
    }
    return anchors;
  }

  static extractFormInfo(html = "", formType = "") {
    const normalizedFormType = this.normalizeFormCode(formType);
    const anchors = this.anchorCandidates(html).filter((anchor) => anchor.url.toLowerCase().includes(".pdf"));
    const legacyPdf = anchors.find((anchor) => anchor.url.toLowerCase().includes(normalizedFormType.toLowerCase())) || anchors[0] || null;
    const pdfUrl = this.chooseFormPdf(anchors, normalizedFormType, legacyPdf, { formCode: normalizedFormType }).pdf?.url || null;
    const editionDate = this.editionDateOf(this.stripTags(html), { formCode: normalizedFormType });
    const checksum = this.checksum(`${normalizedFormType}:${pdfUrl || ""}:${editionDate?.toISOString() || ""}`);
    return { formType: normalizedFormType, formCode: normalizedFormType, pdfUrl, editionDate, checksum, detectedAt: new Date() };
  }

  /**
   * The forms the all-forms directory lists. off: the old 700-character-window parser (extractDirectoryFormsLegacy, unchanged). on: one entry per directory ROW
   * (extractDirectoryFormsByRow) - a row's code, title, address and edition date come from that row only. shadow: the old result, with the difference logged. A page with no
   * recognisable rows (USCIS changed its markup) falls back to the old parser, so nothing is ever lost by switching on.
   */
  static extractDirectoryForms(html = "", sourceUrl = OFFICIAL_SOURCES.formsDirectoryUrl) {
    const mode = autonomy.mode();
    if (mode === "off") return this.extractDirectoryFormsLegacy(html, sourceUrl);
    let rows = null;
    try { rows = this.extractDirectoryFormsByRow(html, sourceUrl); } catch (error) { rows = null; }
    if (mode === "shadow") {
      try {
        const legacy = this.extractDirectoryFormsLegacy(html, sourceUrl);
        if (rows) {
          const a = new Set(legacy.map((item) => item.formCode));
          const b = new Set(rows.map((item) => item.formCode));
          const onlyNew = [...b].filter((code) => !a.has(code));
          const onlyOld = [...a].filter((code) => !b.has(code));
          if (onlyNew.length || onlyOld.length) logger.warn("uscis_directory_parse_would_differ", { legacyCodes: a.size, rowCodes: b.size, onlyInRows: onlyNew.slice(0, 40), onlyInLegacy: onlyOld.slice(0, 40) });
        }
        return legacy;
      } catch (error) {
        return this.extractDirectoryFormsLegacy(html, sourceUrl);
      }
    }
    return rows || this.extractDirectoryFormsLegacy(html, sourceUrl);
  }

  /** One entry per directory row (div.views-row). Returns null when the page has no rows. A row whose code is not a USCIS form (EOIR-29, "G-845 Supplement") keeps its OWN name: it is never merged into another form. */
  static extractDirectoryFormsByRow(html = "", sourceUrl = OFFICIAL_SOURCES.formsDirectoryUrl) {
    const marker = /<div\b[^>]*\bclass="[^"]*\bviews-row\b[^"]*"[^>]*>/gi;
    const starts = [];
    let found;
    while ((found = marker.exec(html))) starts.push(found.index);
    if (!starts.length) return null;
    const footer = html.search(/<footer\b[^>]*views__footer/i);
    const candidates = new Map();
    starts.forEach((start, index) => {
      const end = index + 1 < starts.length ? starts[index + 1] : (footer > start ? footer : html.length);
      const row = html.slice(start, end);
      const titleAnchor = row.match(/<a\b([^>]*\blink--form-title\b[^>]*)>([\s\S]*?)<\/a>/i) || row.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
      const href = titleAnchor?.[1].match(/\bhref=["']([^"']+)["']/i)?.[1];
      if (!href) return;
      let address;
      try { address = this.absoluteUrl(this.htmlDecode(href)); } catch (error) { return; }
      const title = this.stripTags(titleAnchor[2]);
      const prefix = title.split("|")[0].trim();
      const code = codePatterns.scanPattern("on").exec(prefix);
      let formCode;
      if (code && code.index === 0 && code[0].length === prefix.length) formCode = this.normalizeFormCode(code[1]);
      else if (/^[A-Z]{1,5}-\d/i.test(prefix)) formCode = this.normalizeFormCode(prefix);
      else return;
      const titleIsPdf = /\.pdf(?:$|[?#])/i.test(address);
      let pdfUrl = titleIsPdf ? address : null;
      if (!pdfUrl) {
        const pdfAnchor = this.anchorCandidates(row, sourceUrl).find((anchor) => /\.pdf(?:$|[?#])/i.test(anchor.url) && !EditionAuthority.isInstructionsPdf(anchor));
        pdfUrl = pdfAnchor?.url || null;
      }
      const pageUrl = titleIsPdf ? null : address;
      const editionDate = EditionAuthority.decide({ directoryDate: this.extractEditionDate(this.stripTags(row)) }).editionDate;
      const formName = title.includes("|") ? title.slice(title.indexOf("|") + 1).trim() || formCode : title || formCode;
      const signature = this.checksum(`${formCode}:${editionDate?.toISOString() || ""}:${pdfUrl || pageUrl || ""}`);
      const version = this.editionVersion(editionDate, signature);
      const key = `${formCode}:${version}:${pdfUrl || pageUrl || ""}`;
      if (!candidates.has(key)) {
        candidates.set(key, { formType: formCode, formCode, formName, editionDate, version, pdfUrl, pageUrl: pageUrl || sourceUrl, sourceUrl, checksum: signature, detectedAt: new Date() });
      }
    });
    return [...candidates.values()].sort((left, right) => left.formCode.localeCompare(right.formCode));
  }

  static extractDirectoryFormsLegacy(html = "", sourceUrl = OFFICIAL_SOURCES.formsDirectoryUrl) {
    const candidates = new Map();
    for (const anchor of this.anchorCandidates(html, sourceUrl)) {
      const directHaystack = `${anchor.text} ${anchor.url}`;
      const directCodes = [...new Set([...directHaystack.matchAll(codePatterns.scanPattern())].map((match) => this.normalizeFormCode(match[1])))];
      const haystack = directCodes.length ? directHaystack : anchor.context;
      const formCodes = [...new Set([...haystack.matchAll(codePatterns.scanPattern())].map((match) => this.normalizeFormCode(match[1])))];
      for (const formCode of formCodes) {
        const pdfUrl = anchor.url.toLowerCase().includes(".pdf") ? anchor.url : null;
        const pageUrl = pdfUrl ? null : anchor.url;
        const editionDate = this.extractEditionDate(anchor.context);
        const formName = anchor.text && !anchor.text.match(/^download|pdf$/i) ? anchor.text : formCode;
        const signature = this.checksum(`${formCode}:${editionDate?.toISOString() || ""}:${pdfUrl || pageUrl || ""}`);
        const version = this.editionVersion(editionDate, signature);
        const key = `${formCode}:${version}:${pdfUrl || pageUrl || ""}`;
        if (!candidates.has(key)) {
          candidates.set(key, {
            formType: formCode,
            formCode,
            formName,
            editionDate,
            version,
            pdfUrl,
            pageUrl: pageUrl || sourceUrl,
            sourceUrl,
            checksum: signature,
            detectedAt: new Date(),
          });
        }
      }
    }
    return [...candidates.values()].sort((left, right) => left.formCode.localeCompare(right.formCode));
  }

  static async fetchPage(url) {
    this.assertOfficialUscisUrl(url);
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; ImmigrationCRM-USCIS-Sync/1.0; +https://www.uscis.gov/forms/all-forms)",
        accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    if (!response.ok) {
      // Phase 7.E: the status and a code travel with the error, so the pipeline can tell "the page does not exist at this address" (404, try another address) from "uscis.gov is busy" (503)
      throw Object.assign(new Error(`USCIS page fetch failed: ${response.status}`), { status: response.status, code: "USCIS_PAGE_FETCH_FAILED", stage: "page_fetch", cause: "page_fetch", url });
    }
    return response.text();
  }

  /** sha256 of an official PDF (uscis.gov only, 60 s, at most 40 MB). The same kind of value as the checksum stored for the raw download. Throws on any failure. */
  static async fetchPdfSha256(url, { timeoutMs = 60000, maxBytes = 40 * 1024 * 1024 } = {}) {
    this.assertOfficialUscisUrl(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; ImmigrationCRM-USCIS-Sync/1.0; +https://www.uscis.gov/forms/all-forms)", accept: "application/pdf" } });
      if (!response.ok) throw Object.assign(new Error(`USCIS PDF fetch failed: ${response.status}`), { status: response.status });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > maxBytes) throw new Error("USCIS PDF is larger than the allowed size");
      if (bytes.subarray(0, 5).toString("utf8") !== "%PDF-") throw new Error("USCIS PDF address did not return a PDF");
      return crypto.createHash("sha256").update(bytes).digest("hex");
    } finally {
      clearTimeout(timer);
    }
  }

  static async enrichFormInfo(info, options = {}) {
    if (!info?.pageUrl || /\.pdf(?:$|[?#])/i.test(info.pageUrl) || info.pageUrl === info.sourceUrl) return info;
    try {
      const suppliedHtml = options.htmlByUrl?.[info.pageUrl];
      if (options.htmlByUrl && suppliedHtml === undefined) return info;
      const html = suppliedHtml || await this.fetchPage(info.pageUrl);
      return { ...info, ...this.extractFormPageMetadata(html, info.pageUrl, info.formCode), sourceUrl: info.sourceUrl };
    } catch (error) {
      return { ...info, metadataError: error.message };
    }
  }

  static async enrichDetectedForms(forms, options = {}) {
    const concurrency = Math.min(Math.max(Number(options.detailConcurrency || process.env.USCIS_SYNC_DETAIL_CONCURRENCY || 5), 1), 10);
    const enriched = [];
    for (let index = 0; index < forms.length; index += concurrency) {
      const batch = forms.slice(index, index + concurrency);
      enriched.push(...await Promise.all(batch.map((item) => this.enrichFormInfo(item, options))));
    }
    return enriched;
  }

  static consolidateDetectedForms(forms = []) {
    const grouped = new Map();
    for (const item of forms) {
      const key = `${item.formCode}:${item.version || this.editionVersion(item.editionDate, item.checksum)}`;
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, item);
        continue;
      }
      const preferred = [
        item.instructionsPdfUrl ? 4 : 0,
        item.editionDate ? 3 : 0,
        item.pdfUrl ? 2 : 0,
        item.pageUrl && item.pageUrl !== item.sourceUrl ? 1 : 0,
      ].reduce((sum, value) => sum + value, 0) >= [
        existing.instructionsPdfUrl ? 4 : 0,
        existing.editionDate ? 3 : 0,
        existing.pdfUrl ? 2 : 0,
        existing.pageUrl && existing.pageUrl !== existing.sourceUrl ? 1 : 0,
      ].reduce((sum, value) => sum + value, 0) ? item : existing;
      const secondary = preferred === item ? existing : item;
      grouped.set(key, {
        ...secondary,
        ...preferred,
        pdfUrl: preferred.pdfUrl || secondary.pdfUrl,
        instructionsPdfUrl: preferred.instructionsPdfUrl || secondary.instructionsPdfUrl,
        relatedForms: [...new Set([...(preferred.relatedForms || []), ...(secondary.relatedForms || [])])],
        categories: [...new Set([...(preferred.categories || []), ...(secondary.categories || [])])],
      });
    }
    return [...grouped.values()].sort((left, right) => left.formCode.localeCompare(right.formCode));
  }

  /** An address compared without its query, fragment, case or trailing slash. */
  static normalizeSourceUrl(url) {
    const text = String(url || "").trim();
    if (!text) return "";
    try {
      const parsed = new URL(text);
      return `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/+$/, "").toLowerCase()}`;
    } catch (_) {
      return text.split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase();
    }
  }

  /**
   * Is what uscis.gov shows NEWER or DIFFERENT from the installed edition? Phase 7.E: an unchanged form is NOT new.
   *   - a later edition date                                   -> new
   *   - a different official PDF address, when BOTH are known  -> new (an address we never stored is unknown, not different)
   *   - a different scan signature, only against a signature of the SAME kind (lifecycle.scanSignature). `info.checksum` is a signature of the page metadata; the
   *     stored sourceChecksum / importMetadata.checksum are hashes of the downloaded FILE - different things that never match, which used to make every check "new".
   */
  static hasNewEdition(activeTemplate, info) {
    if (!activeTemplate) return true;
    if (info.editionDate && activeTemplate.editionDate && new Date(info.editionDate) > new Date(activeTemplate.editionDate)) return true;
    const known = this.normalizeSourceUrl(activeTemplate.officialPdfUrl);
    const next = this.normalizeSourceUrl(info.pdfUrl);
    if (known && next && known !== next) return true;
    const sameKind = activeTemplate.lifecycle?.scanSignature;
    return Boolean(info.checksum && sameKind && info.checksum !== sameKind);
  }

  static async scanForm(formConfig, user, req) {
    const formType = String(formConfig.formType || formConfig.formCode || formConfig.formNumber).toUpperCase();
    const startedAt = Date.now();
    let step = "page_fetch";
    try {
      const html = formConfig.html || await this.fetchPage(formConfig.pageUrl);
      step = "extract";
      const info = this.extractFormInfo(html, formType);
      const activeTemplate = await USCISFormTemplate.findOne({ formCode: formType, status: "active" }).sort({ editionDate: -1, updatedAt: -1 });
      step = "compare";
      const hasChanged = this.hasNewEdition(activeTemplate, info);
      const scanEvent = { scannedAt: new Date(), formType, pageUrl: formConfig.pageUrl, hasChanged, info };
      if (activeTemplate) {
        activeTemplate.lifecycle = { ...(activeTemplate.lifecycle || {}), scanHistory: [...(activeTemplate.lifecycle?.scanHistory || []), scanEvent].slice(-25), detectedAt: info.detectedAt, ...(hasChanged ? {} : { scanSignature: info.checksum }) };
        activeTemplate.lastChecked = new Date();
        await activeTemplate.save();
      }
      if (!hasChanged) return { formType, action: "no_change_detected", durationMs: Date.now() - startedAt, info };

      step = "import";
      const imported = await FormImportService.importOfficialForm({
        formType,
        formName: formConfig.formName || formType,
        editionDate: info.editionDate,
        version: info.editionDate ? info.editionDate.toISOString().slice(0, 10) : info.checksum.slice(0, 12),
        pdfUrl: info.pdfUrl,
        pageUrl: formConfig.pageUrl,
        source: "uscis_scanner",
        importedByScanner: true,
      }, user, req);
      let comparisonReport = null;
      if (activeTemplate && imported._id.toString() !== activeTemplate._id.toString()) {
        comparisonReport = FormComparisonService.compare(activeTemplate.toObject(), imported.toObject());
        imported.lifecycle = { ...(imported.lifecycle || {}), comparisonReport, migrationSuggestions: comparisonReport.migrationSuggestions };
        await imported.save();
      }
      await VersionManagementService.audit("FORM_DETECTED", imported, user, req, { info, comparisonReport });
      await VersionManagementService.notify(["super_admin", "admin"], { title: "New USCIS form edition detected", message: `${formType} has a new draft edition awaiting review.`, metadata: { formType, versionId: imported._id } }, user, req);
      return { formType, action: "draft_version_created", durationMs: Date.now() - startedAt, templateId: imported._id, info, comparisonReport };
    } catch (error) {
      // Phase 7.E: `stage` / `code` / `cause` say which step failed. Only a failure of the page fetch means "uscis.gov could not be reached"; a normalize / import failure is ours.
      return { formType, action: "scan_failed", durationMs: Date.now() - startedAt, error: error.message, stage: error.stage || step, code: error.code || null, cause: error.cause && typeof error.cause === "string" ? error.cause : null, status: error.status || null };
    }
  }

  static async importDetectedForm(info, user, req) {
    const formCode = this.normalizeFormCode(info.formCode || info.formType);
    const version = info.version || this.editionVersion(info.editionDate, info.checksum);
    let existing = await USCISFormTemplate.findOne({ formCode, version });
    const scanEvent = {
      scannedAt: new Date(),
      syncRunId: info.syncRunId,
      sourceUrl: info.sourceUrl,
      pageUrl: info.pageUrl,
      pdfUrl: info.pdfUrl,
      checksum: info.checksum,
      detectedEditionDate: info.editionDate,
      detectedVersion: version,
    };
    if (existing) {
      const existingChecksum = existing.lifecycle?.sourceMetadataChecksum;
      if (info.checksum && existingChecksum && info.checksum !== existingChecksum) {
        return this.importDetectedForm({
          ...info,
          version: `${version}-rev-${String(info.checksum).slice(0, 8)}`,
        }, user, req);
      }
      const artifactRevalidationMs = Number(process.env.USCIS_PDF_REVALIDATE_INTERVAL_MS || 7 * 24 * 60 * 60 * 1000);
      const lastDownloadedAt = existing.artifacts?.form?.downloadedAt ? new Date(existing.artifacts.form.downloadedAt).getTime() : 0;
      const requiresArtifactRefresh = Boolean(
        info.pdfUrl
        && (
          !existing.pdfStorageKey
          || !existing.artifacts?.form?.checksum
          || (info.instructionsPdfUrl && !existing.instructionsStorageKey)
          || Date.now() - lastDownloadedAt >= artifactRevalidationMs
        )
      );
      if (requiresArtifactRefresh) {
        const refreshed = await FormImportService.importOfficialForm({
          formType: formCode,
          formName: info.formName || existing.formName || formCode,
          editionDate: info.editionDate || existing.editionDate,
          revisionDate: info.revisionDate || existing.revisionDate,
          version,
          pdfUrl: info.pdfUrl,
          instructionsPdfUrl: info.instructionsPdfUrl,
          pageUrl: info.pageUrl || info.sourceUrl,
          relatedForms: info.relatedForms,
          category: info.category,
          categories: info.categories,
          description: info.description,
          officialStatus: "current",
          source: "uscis_sync_revalidation",
          importedByScanner: true,
          status: "review",
          precomputedChecksum: info.checksum,
        }, user, req);
        if (refreshed._id.toString() !== existing._id.toString()) {
          return {
            formCode,
            action: "pending_version_created",
            kind: "updated_edition",
            templateId: refreshed._id,
            version: refreshed.version,
            editionDate: refreshed.editionDate,
            revisionDate: refreshed.revisionDate,
            artifacts: refreshed.artifacts,
          };
        }
        existing = refreshed;
      }
      existing.formName = info.formName || existing.formName;
      existing.title = info.formName || existing.title;
      existing.description = info.description || existing.description;
      existing.editionDate = info.editionDate || existing.editionDate;
      existing.revisionDate = info.revisionDate || existing.revisionDate;
      existing.officialPdfUrl = info.pdfUrl || existing.officialPdfUrl;
      existing.instructionsPdfUrl = info.instructionsPdfUrl || existing.instructionsPdfUrl;
      existing.relatedForms = info.relatedForms?.length ? info.relatedForms : existing.relatedForms;
      existing.category = info.category || existing.category;
      existing.categories = info.categories?.length ? info.categories : existing.categories;
      existing.officialStatus = "current";
      existing.lastChecked = new Date();
      existing.lifecycle = {
        ...(existing.lifecycle || {}),
        provider: "uscis",
        sourcePageUrl: info.pageUrl || existing.lifecycle?.sourcePageUrl,
        sourcePdfUrl: info.pdfUrl || existing.lifecycle?.sourcePdfUrl,
        sourceMetadataChecksum: info.checksum || existing.lifecycle?.sourceMetadataChecksum,
        detectionStatus: existing.status === "active" ? "active_seen" : "version_seen",
        consecutiveMisses: 0,
        lastSeenAt: new Date(),
        lastSeenSyncRun: info.syncRunId,
        scanHistory: [...(existing.lifecycle?.scanHistory || []), scanEvent].slice(-MAX_SCAN_HISTORY),
      };
      await existing.save();
      return { formCode, action: "existing_version_seen", kind: "unchanged", templateId: existing._id, version, artifacts: existing.artifacts };
    }

    const activeTemplate = await USCISFormTemplate.findOne({ formCode, status: "active" }).sort({ editionDate: -1, updatedAt: -1 });
    const imported = await FormImportService.importOfficialForm({
      formType: formCode,
      formName: info.formName || formCode,
      editionDate: info.editionDate,
      revisionDate: info.revisionDate,
      version,
      pdfUrl: info.pdfUrl,
      instructionsPdfUrl: info.instructionsPdfUrl,
      pageUrl: info.pageUrl || info.sourceUrl,
      relatedForms: info.relatedForms,
      category: info.category,
      categories: info.categories,
      description: info.description,
      officialStatus: "current",
      provider: "uscis",
      source: "uscis_sync",
      importedByScanner: true,
      status: "review",
      detectedAt: info.detectedAt,
      precomputedChecksum: info.checksum,
    }, user, req);
    imported.status = "review";
    imported.currentStatus = "review";
    imported.activeFlag = false;
    imported.lastChecked = new Date();
    imported.lastUpdateDetected = new Date();
    imported.lifecycle = {
      ...(imported.lifecycle || {}),
      provider: "uscis",
      sourcePageUrl: info.pageUrl || info.sourceUrl,
      sourcePdfUrl: info.pdfUrl,
      sourceChecksum: imported.lifecycle?.sourceChecksum || info.checksum,
      sourceMetadataChecksum: info.checksum,
      detectedAt: info.detectedAt || new Date(),
      importedByScanner: true,
      detectionStatus: "pending_admin_review",
      consecutiveMisses: 0,
      lastSeenAt: new Date(),
      lastSeenSyncRun: info.syncRunId,
      reviewRequestedAt: new Date(),
      scanHistory: [...(imported.lifecycle?.scanHistory || []), scanEvent].slice(-MAX_SCAN_HISTORY),
      changeEvents: [
        ...(imported.lifecycle?.changeEvents || []),
        { type: activeTemplate ? "new_edition_detected" : "new_form_detected", detectedAt: new Date(), sourceUrl: info.sourceUrl, version },
      ],
    };
    let comparisonReport = null;
    if (activeTemplate && imported._id.toString() !== activeTemplate._id.toString()) {
      comparisonReport = FormComparisonService.compare(activeTemplate.toObject(), imported.toObject());
      imported.lifecycle.comparisonReport = comparisonReport;
      imported.lifecycle.migrationSuggestions = comparisonReport.migrationSuggestions || [];
    }
    await imported.save();
    await VersionManagementService.audit(activeTemplate ? "USCIS_NEW_EDITION_DETECTED" : "USCIS_NEW_FORM_DETECTED", imported, user, req, { info, comparisonReport });
    await VersionManagementService.notify(["super_admin", "admin"], {
      title: activeTemplate ? "New USCIS form edition detected" : "New USCIS form detected",
      message: `${formCode} ${version} is awaiting administrator review.`,
      metadata: { formCode, versionId: imported._id, version },
    }, user, req);
    return {
      formCode,
      action: "pending_version_created",
      kind: activeTemplate ? "updated_edition" : "new_form",
      templateId: imported._id,
      version,
      editionDate: info.editionDate,
      revisionDate: info.revisionDate,
      comparisonReport,
      artifacts: imported.artifacts,
    };
  }

  static async markMissingOfficialForms(seenFormCodes, user, req, syncRunId) {
    const activeTemplates = await USCISFormTemplate.find({
      "lifecycle.provider": "uscis",
      status: "active",
      officialStatus: { $ne: "deprecated" },
    });
    const missing = [];
    for (const template of activeTemplates) {
      if (seenFormCodes.has(template.formCode)) continue;
      const consecutiveMisses = Number(template.lifecycle?.consecutiveMisses || 0) + 1;
      const deprecated = consecutiveMisses >= Number(process.env.USCIS_DEPRECATION_CONFIRMATION_RUNS || 2);
      template.lastChecked = new Date();
      template.officialStatus = deprecated ? "deprecated" : "missing_review";
      if (deprecated && !template.retirementDate) template.retirementDate = new Date();
      template.lifecycle = {
        ...(template.lifecycle || {}),
        detectionStatus: deprecated ? "deprecated_not_listed" : "not_seen_in_latest_sync",
        consecutiveMisses,
        lastSeenSyncRun: syncRunId,
        changeEvents: [
          ...(template.lifecycle?.changeEvents || []),
          { type: deprecated ? "official_form_deprecated" : "active_form_not_seen", detectedAt: new Date(), sourceUrl: OFFICIAL_SOURCES.formsDirectoryUrl, syncRunId },
        ].slice(-MAX_SCAN_HISTORY),
      };
      await template.save();
      await VersionManagementService.audit(deprecated ? "USCIS_FORM_DEPRECATED" : "USCIS_ACTIVE_FORM_NOT_SEEN", template, user, req, {
        sourceUrl: OFFICIAL_SOURCES.formsDirectoryUrl,
        consecutiveMisses,
        syncRunId,
      });
      missing.push({
        formCode: template.formCode,
        templateId: template._id,
        action: deprecated ? "deprecated" : "missing_review",
        consecutiveMisses,
      });
    }
    if (missing.length) {
      await VersionManagementService.notify(["super_admin", "admin"], {
        title: "USCIS form visibility changed",
        message: `${missing.length} active USCIS form version(s) were not seen in the latest official sync and need review.`,
        metadata: { missing },
      }, user, req);
    }
    return missing;
  }

  static async findMissingMappings(formCodes = []) {
    const match = {
      "lifecycle.provider": "uscis",
      officialStatus: { $ne: "deprecated" },
    };
    if (formCodes.length) match.formCode = { $in: formCodes };
    const templates = await USCISFormTemplate.find(match).sort({ formCode: 1, editionDate: -1, versionNumber: -1 }).lean();
    const latestByForm = new Map();
    templates.forEach((template) => {
      if (!latestByForm.has(template.formCode)) latestByForm.set(template.formCode, template);
    });
    return [...latestByForm.values()].filter((template) => {
      const configuredFields = (template.formFields || []).filter((field) => field.mappings?.length || field.mapping?.canonicalPath || field.mapping?.caseField);
      const graphMappings = template.mappingGraph?.mappings || template.mappingConfiguration?.mappings || [];
      return template.mappingStatus !== "active" || (!configuredFields.length && !graphMappings.length);
    }).map((template) => ({
      formCode: template.formCode,
      version: template.version,
      templateId: template._id,
      mappingStatus: template.mappingStatus,
      mappedFields: (template.formFields || []).filter((field) => field.mappings?.length || field.mapping?.canonicalPath || field.mapping?.caseField).length,
      totalFields: template.formFields?.length || 0,
    }));
  }

  static async scanAll(options = {}, user, req) {
    if (options.forms?.length) {
      const forms = options.forms;
      const results = [];
      for (const form of forms) results.push(await this.scanForm(form, user, req));
      return {
        scannedAt: new Date(),
        totalFormsScanned: results.length,
        changesDetected: results.filter((item) => item.action === "draft_version_created").length,
        failedScans: results.filter((item) => item.action === "scan_failed").length,
        results,
      };
    }

    const prepared = await this.beginScanRun(options, user, req);
    if (prepared.inProgress) return prepared;
    return this.executeScanRun(prepared, options, user, req);
  }

  // Split out of scanAll() so the full directory-crawl-and-import scan (real,
  // measured duration against the live uscis.gov site: 135s for a SINGLE
  // form's importOfficialForm call alone, dominated by PDF field-scanning of
  // the real hybrid XFA+AcroForm I-129 - not a network/User-Agent problem,
  // confirmed by direct fetch() calls with the exact same UA succeeding in
  // under a second) can be handed to the caller's HTTP response immediately
  // (this part alone - the lock check + USCISFormSyncRun row creation - is
  // fast) while the slow work runs after the response via executeScanRun().
  // Callers that want the old fully-synchronous behavior (scheduled job,
  // tests) still get it through scanAll() awaiting both halves in sequence.
  static async beginScanRun(options = {}, user, req) {
    const startedAt = Date.now();
    const sourceUrls = options.sourceUrls || [OFFICIAL_SOURCES.formsDirectoryUrl];
    sourceUrls.forEach((url) => {
      const parsed = this.assertOfficialUscisUrl(url);
      const allowedPaths = [new URL(OFFICIAL_SOURCES.formsDirectoryUrl).pathname, new URL(OFFICIAL_SOURCES.formsUpdatesUrl).pathname];
      if (!allowedPaths.includes(parsed.pathname)) {
        throw Object.assign(new Error("Synchronization sources must be an official USCIS forms directory or forms updates page"), { status: 400 });
      }
    });
    const lockWindowMs = Number(process.env.USCIS_SYNC_LOCK_TIMEOUT_MS || 60 * 60 * 1000);
    const activeRun = await USCISFormSyncRun.findOne({
      provider: "uscis",
      status: "running",
      startedAt: { $gte: new Date(Date.now() - lockWindowMs) },
    }).sort({ startedAt: -1 }).lean();
    if (activeRun) {
      return {
        inProgress: true,
        syncRunId: activeRun._id,
        scannedAt: activeRun.startedAt,
        officialSources: activeRun.sourceUrls,
        report: { status: "running", summary: activeRun.summary },
        results: [],
      };
    }
    await USCISFormSyncRun.updateMany(
      { provider: "uscis", status: "running", startedAt: { $lt: new Date(Date.now() - lockWindowMs) } },
      { $set: { status: "failed", completedAt: new Date(), "metadata.failureReason": "stale_sync_lock_recovered" } }
    );
    const syncRun = await USCISFormSyncRun.create({
      sourceUrls,
      triggeredBy: user?._id,
      trigger: options.trigger || (user ? "api" : "scheduled"),
      metadata: { force: Boolean(options.force) },
    });
    return { inProgress: false, syncRun, sourceUrls, startedAt };
  }

  static async executeScanRun(prepared, options = {}, user, req) {
    const { syncRun, sourceUrls, startedAt } = prepared;
    const results = [];
    const failures = [];
    const detectedByKey = new Map();
    let formsDiscovered = 0;
    try {
      const maxPages = Math.min(Math.max(Number(options.maxPages || process.env.USCIS_SYNC_MAX_PAGES || 30), 1), 100);
      for (const sourceUrl of sourceUrls) {
        const queue = [sourceUrl];
        const visited = new Set();
        while (queue.length && visited.size < maxPages) {
          const pageUrl = queue.shift();
          if (visited.has(pageUrl)) continue;
          visited.add(pageUrl);
          try {
            const html = options.htmlByUrl?.[pageUrl] || await this.fetchPage(pageUrl);
            const detectedForms = this.extractDirectoryForms(html, pageUrl);
            for (const info of detectedForms) {
              const key = `${info.formCode}:${info.pageUrl || info.pdfUrl || ""}`;
              if (!detectedByKey.has(key)) detectedByKey.set(key, info);
            }
            if (new URL(sourceUrl).pathname === new URL(OFFICIAL_SOURCES.formsDirectoryUrl).pathname) {
              this.directoryPageUrls(html, sourceUrl).forEach((url) => {
                if (!visited.has(url) && !queue.includes(url)) queue.push(url);
              });
            }
          } catch (error) {
            failures.push({ sourceUrl: pageUrl, action: "source_scan_failed", error: error.message });
          }
        }
        if (queue.length) {
          failures.push({ sourceUrl, action: "pagination_limit_reached", error: `USCIS synchronization stopped at the configured ${maxPages}-page safety limit` });
        }
      }
      const enrichedForms = await this.enrichDetectedForms([...detectedByKey.values()], options);
      const detectedForms = this.consolidateDetectedForms(enrichedForms);
      formsDiscovered = detectedForms.length;
      for (const info of detectedForms) {
        if (info.metadataError) {
          failures.push({ formCode: info.formCode, pageUrl: info.pageUrl, action: "form_detail_scan_failed", error: info.metadataError });
          if (!info.pdfUrl) continue;
        }
        try {
          const result = await this.importDetectedForm({ ...info, syncRunId: syncRun._id }, user, req);
          results.push(result);
          if (result.artifacts?.instructions?.status === "failed") {
            failures.push({
              formCode: info.formCode,
              sourceUrl: info.instructionsPdfUrl,
              action: "instructions_download_failed",
              error: result.artifacts.instructions.error,
              attempts: result.artifacts.instructions.downloadAttempts,
            });
          }
        } catch (error) {
          failures.push({
            formCode: info.formCode,
            sourceUrl: info.pdfUrl,
            action: "form_import_failed",
            error: error.message,
            code: error.code,
            attempts: error.attempts,
            artifactType: error.artifactType,
          });
        }
      }
    } catch (error) {
      failures.push({ action: "sync_failed", error: error.message });
    }
    results.push(...failures);
    const seenFormCodes = new Set(results.filter((item) => item.formCode).map((item) => item.formCode));
    const authoritativeDirectorySucceeded = !failures.length
      && formsDiscovered > 0
      && sourceUrls.some((url) => new URL(url).pathname === new URL(OFFICIAL_SOURCES.formsDirectoryUrl).pathname);
    const missingActiveForms = options.skipMissingDetection || !authoritativeDirectorySucceeded
      ? []
      : await this.markMissingOfficialForms(seenFormCodes, user, req, syncRun._id);
    const missingMappings = await this.findMissingMappings([...seenFormCodes]);
    const newForms = results.filter((item) => item.kind === "new_form");
    const updatedEditions = results.filter((item) => item.kind === "updated_edition");
    const deprecatedForms = missingActiveForms.filter((item) => item.action === "deprecated");
    const changesDetected = results.filter((item) => item.action === "pending_version_created").length;
    const failedScans = failures.length + results.filter((item) => item.action === "scan_failed").length;
    const completedAt = new Date();
    syncRun.status = failures.length ? (seenFormCodes.size ? "partial" : "failed") : "completed";
    syncRun.completedAt = completedAt;
    syncRun.durationMs = Date.now() - startedAt;
    syncRun.summary = {
      formsDiscovered,
      formsProcessed: seenFormCodes.size,
      newForms: newForms.length,
      updatedEditions: updatedEditions.length,
      deprecatedForms: deprecatedForms.length,
      missingMappings: missingMappings.length,
      unchangedForms: results.filter((item) => item.kind === "unchanged").length,
      failures: failures.length,
    };
    syncRun.newForms = newForms;
    syncRun.updatedEditions = updatedEditions;
    syncRun.deprecatedForms = deprecatedForms;
    syncRun.missingMappings = missingMappings;
    syncRun.failures = failures;
    syncRun.results = results;
    await syncRun.save();
    await VersionManagementService.notify(["super_admin", "admin"], {
      title: "USCIS form synchronization completed",
      message: `${newForms.length} new form(s), ${updatedEditions.length} updated edition(s), ${deprecatedForms.length} deprecated form(s), and ${missingMappings.length} mapping gap(s) detected.`,
      metadata: { syncRunId: syncRun._id, changesDetected, failedScans, summary: syncRun.summary },
    }, user, req).catch(() => null);
    return {
      syncRunId: syncRun._id,
      scannedAt: completedAt,
      durationMs: Date.now() - startedAt,
      officialSources: sourceUrls,
      totalFormsScanned: results.filter((item) => item.formCode).length,
      changesDetected,
      failedScans,
      missingActiveForms,
      report: {
        status: syncRun.status,
        summary: syncRun.summary,
        newForms,
        updatedEditions,
        deprecatedForms,
        missingMappings,
        failures,
      },
      results,
    };
  }

  static async sync(options = {}, user, req) {
    return this.scanAll(options, user, req);
  }

  static async syncHistory(query = {}) {
    const match = { "lifecycle.provider": "uscis" };
    if (query.formCode) match.formCode = this.normalizeFormCode(query.formCode);
    const limit = Math.min(Number(query.limit || 100), 500);
    const templates = await USCISFormTemplate.find(match)
      .select("formCode formName version status officialStatus editionDate revisionDate category categories officialPdfUrl instructionsPdfUrl relatedForms mappingStatus lastChecked lastUpdateDetected lifecycle.scanHistory lifecycle.changeEvents")
      .sort({ lastChecked: -1, updatedAt: -1 })
      .limit(limit)
      .lean();
    const runs = await USCISFormSyncRun.find({ provider: "uscis" })
      .sort({ startedAt: -1 })
      .limit(Math.min(limit, 100))
      .lean();
    const events = [];
    for (const template of templates) {
      for (const item of template.lifecycle?.scanHistory || []) {
        events.push({ type: "scan", formCode: template.formCode, version: template.version, status: template.status, ...item });
      }
      for (const item of template.lifecycle?.changeEvents || []) {
        events.push({ type: "change", formCode: template.formCode, version: template.version, status: template.status, ...item });
      }
    }
    events.sort((left, right) => new Date(right.scannedAt || right.detectedAt || 0) - new Date(left.scannedAt || left.detectedAt || 0));
    return { sources: OFFICIAL_SOURCES, runs, events: events.slice(0, limit), templates };
  }
}

USCISScannerService.OFFICIAL_SOURCES = OFFICIAL_SOURCES;

module.exports = USCISScannerService;

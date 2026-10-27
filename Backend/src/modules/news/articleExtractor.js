// Turns one uscis.gov newsroom article page into stored content WITHOUT rewriting it: the article container is located, its title / dates / body blocks are read as they are, and
// the body goes through a restrictive allowlist sanitizer (no LLM, no paraphrase, no style edits). The site's own header, footer, menus, banners and scripts are never copied.
//
// Fidelity guard: after sanitising, the visible text of the body must equal the visible text before - if it does not, the article is flagged "incomplete" with a warning
// instead of silently losing words. Anything that cannot be reproduced (an embedded video, an image from a host that is not uscis.gov, an unknown content block) is
// reported in `warnings`; "notice:" entries are informational and do not make the article incomplete.
const crypto = require("crypto");
const cheerio = require("cheerio");
const sanitizeHtml = require("sanitize-html");
const { safeUscisUrl } = require("./uscisHttp");
const { articleIdentity } = require("./feedParser");

class ExtractionError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExtractionError";
  }
}

const ALIGN_CLASSES = ["text-align-left", "text-align-center", "text-align-right", "text-align-justify", "align-left", "align-center", "align-right", "news-media-notice", "news-table-scroll"];

const ALLOWED_TAGS = [
  "p", "br", "hr", "h2", "h3", "h4", "h5", "h6", "blockquote", "q", "cite", "pre", "code", "div", "span", "section",
  "a", "abbr", "b", "strong", "i", "em", "u", "s", "del", "ins", "sub", "sup", "small", "mark", "time",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "caption", "colgroup", "col", "thead", "tbody", "tfoot", "tr", "th", "td",
  "figure", "figcaption", "img",
];

const numericAttr = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 4000 ? String(number) : undefined;
};

const collapse = (text) => String(text || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

// Elements whose content the sanitizer cannot carry over; finding one in the source body means something was left out.
const UNSUPPORTED_EMBEDS = ["iframe", "video", "audio", "object", "embed", "drupal-media", "svg", "canvas", "form", "map", "picture source"];

function buildSanitizer(canonicalUrl) {
  return (html) => sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "loading", "decoding", "referrerpolicy"],
      ol: ["type", "start", "reversed"],
      li: ["value"],
      td: ["colspan", "rowspan", "headers", "scope"],
      th: ["colspan", "rowspan", "headers", "scope", "abbr"],
      col: ["span"],
      colgroup: ["span"],
      time: ["datetime"],
      abbr: ["title"],
      q: ["cite"],
      blockquote: ["cite"],
      "*": ["class", "lang", "dir"],
    },
    allowedClasses: { "*": ALIGN_CLASSES },
    allowedSchemes: ["https", "http", "mailto", "tel"],
    allowedSchemesByTag: { img: ["https"] },
    allowProtocolRelative: false,
    disallowedTagsMode: "discard", // an unknown tag is unwrapped: its words stay, its markup goes
    transformTags: {
      h1: "h2", // the page's own title is the single h1
      a: (tagName, attribs) => {
        const out = {};
        if (attribs.title) out.title = attribs.title;
        const href = attribs.href ? String(attribs.href).trim() : "";
        if (href) {
          let absolute = "";
          try {
            const url = new URL(href, canonicalUrl);
            if (["https:", "http:", "mailto:", "tel:"].includes(url.protocol)) absolute = url.toString();
          } catch { /* an unparsable address is dropped, the link text stays */ }
          if (absolute) {
            out.href = absolute;
            if (/^https?:/i.test(absolute)) {
              out.target = "_blank";
              out.rel = "noopener noreferrer";
            }
          }
        }
        return { tagName: "a", attribs: out };
      },
      img: (tagName, attribs) => ({
        tagName: "img",
        attribs: {
          src: attribs.src,
          alt: attribs.alt || "",
          ...(attribs.title ? { title: attribs.title } : {}),
          ...(numericAttr(attribs.width) ? { width: numericAttr(attribs.width) } : {}),
          ...(numericAttr(attribs.height) ? { height: numericAttr(attribs.height) } : {}),
          loading: "lazy",
          decoding: "async",
          referrerpolicy: "no-referrer",
        },
      }),
    },
    // Blank spacer paragraphs and truly empty formatting shells (<p><strong><u><o:p></o:p></u></strong></p>) carry no words. An inline element holding only a space is KEPT: that space separates two words.
    exclusiveFilter: (frame) => (frame.tag === "p" ? !frame.text.trim() : ["strong", "b", "em", "i", "u", "span"].includes(frame.tag) && frame.text === "") && !(frame.mediaChildren || []).length,
  });
}

const BLOCK_ELEMENTS = "p, li, h1, h2, h3, h4, h5, h6, blockquote, div, section, tr, td, th, dt, dd, figcaption, caption, pre, br";

// Visible text of a piece of HTML with a space after every block, so two paragraphs never run together; inline elements add nothing, so a lost space INSIDE a sentence still shows.
// Used on both sides of the fidelity check and for the search text.
function spacedText(html, removeSelector) {
  const $x = cheerio.load(`<div id="root">${html}</div>`, null, false);
  if (removeSelector) $x("#root").find(removeSelector).remove();
  $x("#root").find(BLOCK_ELEMENTS).each((_, element) => { $x(element).after(" "); });
  return collapse($x("#root").text());
}

function parseIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * @returns {{ canonicalUrl, title, publishedAt, updatedAtSource, contentHtml, bodyText, images, contentHash, warnings, complete }}
 * @throws ExtractionError when the page has no recognisable article (nothing is invented in that case)
 */
function extractArticle(html, { requestUrl, imageMode = "link" } = {}) {
  const $ = cheerio.load(String(html || ""));
  const container = $("article.node--type-news-item").first().length ? $("article.node--type-news-item").first() : $("main article.node").first();
  if (!container.length) throw new ExtractionError("The article container was not found on the page");

  const warnings = [];
  let canonicalUrl = null;
  const identity = articleIdentity($('link[rel="canonical"]').attr("href"));
  if (identity) canonicalUrl = identity.canonicalUrl;
  else {
    const fallback = articleIdentity(requestUrl);
    if (!fallback) throw new ExtractionError("The page has no valid canonical address");
    canonicalUrl = fallback.canonicalUrl;
    warnings.push("notice: the page did not declare a canonical address; the requested address was used");
  }

  const title = collapse(container.find("h1").first().text()) || collapse($('meta[property="og:title"]').attr("content"));
  if (!title) throw new ExtractionError("The article title was not found");

  const publishedAt = parseIsoDate(container.find(".field--name-field-display-date time[datetime]").first().attr("datetime"));
  const updatedAtSource = parseIsoDate(container.find(".field--name-field-reviewed-updated-date time[datetime]").first().attr("datetime"));
  if (!publishedAt) warnings.push("notice: the page did not show a release date");

  const bodies = container.find(".field--name-body").filter((_, element) => !$(element).parents(".field--name-body").length);
  if (!bodies.length) throw new ExtractionError("The article body was not found");

  // content blocks of the article that this importer does not read: reported, never dropped silently
  container.find(".field").each((_, element) => {
    const field = $(element);
    const classes = field.attr("class") || "";
    if (/field--name-(body|field-display-date|field-reviewed-updated-date)\b/.test(classes)) return;
    if (field.parents(".field--name-body, .field--name-field-display-date, .field--name-field-reviewed-updated-date").length) return;
    if (field.find(".field").length && !field.children(".field__item").length) return; // a wrapper of other fields
    const name = (/field--name-([a-z0-9-]+)/.exec(classes) || [])[1] || "unknown";
    if (collapse(field.text()) || field.find("img, video, iframe, table").length) warnings.push(`unread content block "${name}" was not imported`);
  });

  let bodyHtml = bodies.map((_, element) => $(element).html() || "").get().join("\n");
  const $body = cheerio.load(`<div id="root">${bodyHtml}</div>`, null, false);
  const root = $body("#root");

  root.find("script, style, noscript, template").remove();
  for (const selector of UNSUPPORTED_EMBEDS) {
    const count = root.find(selector).length;
    if (count) warnings.push(`${count} embedded ${selector.split(" ")[0]} element(s) could not be reproduced`);
  }

  // the visible text before any change - the sanitised result must say exactly the same
  const textBefore = spacedText(root.html() || "");
  if (!textBefore) throw new ExtractionError("The article body is empty");
  if (textBefore.length < 40) warnings.push("notice: the article body is very short");

  // images: referenced at their uscis.gov address (never copied or re-hosted) or, when that is not possible, kept as caption + notice
  const images = [];
  root.find("img").each((_, element) => {
    const img = $body(element);
    const original = String(img.attr("src") || "").trim();
    const resolved = safeUscisUrl(original, canonicalUrl);
    const figure = img.closest("figure");
    const caption = collapse(figure.find("figcaption").first().text());
    const credit = collapse(figure.find("figcaption .credit, figcaption .photo-credit").first().text());
    const entry = {
      sequence: images.length + 1,
      alt: collapse(img.attr("alt")),
      caption,
      credit,
      ...(numericAttr(img.attr("width")) ? { width: Number(numericAttr(img.attr("width"))) } : {}),
      ...(numericAttr(img.attr("height")) ? { height: Number(numericAttr(img.attr("height"))) } : {}),
    };
    if (resolved && imageMode !== "omit") {
      img.attr("src", resolved);
      images.push({ ...entry, src: resolved, rights: "linked-from-source" });
    } else {
      const reason = imageMode === "omit" ? "image display is switched off" : "it is not hosted on uscis.gov";
      images.push({ ...entry, src: "", rights: "not-reproduced", originalSrc: original.slice(0, 500) });
      warnings.push(`image ${entry.sequence} was not reproduced (${reason}); see the original article`);
      img.replaceWith('<p class="news-media-notice">An image that appears in the original article is not reproduced here.</p>');
    }
  });
  root.find("table").each((_, element) => {
    if (!$body(element).parent().hasClass("news-table-scroll")) $body(element).wrap('<div class="news-table-scroll"></div>');
  });

  const sanitize = buildSanitizer(canonicalUrl);
  const contentHtml = sanitize(root.html() || "").trim();

  const bodyText = spacedText(contentHtml, ".news-media-notice");
  if (bodyText !== textBefore) warnings.push("the imported text differs from the source text after sanitising; see the original article");
  const contentHash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ title, publishedAt: publishedAt ? publishedAt.toISOString() : null, updatedAtSource: updatedAtSource ? updatedAtSource.toISOString() : null, contentHtml }))
    .digest("hex");

  return {
    canonicalUrl,
    title,
    publishedAt,
    updatedAtSource,
    contentHtml,
    bodyText,
    images,
    contentHash,
    warnings,
    complete: !warnings.some((warning) => !warning.startsWith("notice:")),
  };
}

module.exports = { extractArticle, ExtractionError };

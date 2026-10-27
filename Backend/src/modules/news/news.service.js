// Read side of the news module: what the public pages (and staff) see. It only ever reads stored articles - never the network - so USCIS being down changes nothing here.
const SOURCE = Object.freeze({ name: "U.S. Citizenship and Immigration Services (USCIS)", url: "https://www.uscis.gov/newsroom/all-news" });
const CATEGORY_LABELS = Object.freeze({ "news-release": "News Release", alert: "Alert", news: "News" });
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,199}$/;
const LIST_FIELDS = "slug title category publishedAt updatedAtSource excerpt syncStatus canonicalUrl";

const model = () => require("../../models/NewsArticle");

const clampInt = (value, fallback, min, max) => {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(Math.max(number, min), max) : fallback;
};

/** Pure: validates and bounds the public list parameters. */
function parseListParams(query = {}) {
  const q = typeof query.q === "string" ? query.q.replace(/\s+/g, " ").trim().slice(0, 100) : "";
  const category = typeof query.category === "string" && CATEGORY_LABELS[query.category] ? query.category : "";
  return { q, category, page: clampInt(query.page, 1, 1, 1000), limit: clampInt(query.limit, 12, 1, 50) };
}

const humanWarnings = (warnings = []) => warnings.filter((warning) => !String(warning).startsWith("notice:"));

function toListItem(doc) {
  return {
    slug: doc.slug,
    title: doc.title,
    category: doc.category,
    categoryLabel: CATEGORY_LABELS[doc.category] || "News",
    publishedAt: doc.publishedAt || null,
    updatedAtSource: doc.updatedAtSource || null,
    excerpt: doc.excerpt || "",
    fullTextAvailable: doc.syncStatus === "complete" || doc.syncStatus === "incomplete",
    complete: doc.syncStatus === "complete",
    sourceUrl: doc.canonicalUrl,
  };
}

function toDetail(doc) {
  const hasContent = Boolean(doc.contentHtml);
  return {
    slug: doc.slug,
    title: doc.title,
    category: doc.category,
    categoryLabel: CATEGORY_LABELS[doc.category] || "News",
    publishedAt: doc.publishedAt || null,
    updatedAtSource: doc.updatedAtSource || null,
    excerpt: doc.excerpt || "",
    contentHtml: hasContent ? doc.contentHtml : "",
    images: (doc.images || []).map((image) => ({ sequence: image.sequence, src: image.src || "", alt: image.alt || "", caption: image.caption || "", credit: image.credit || "", rights: image.rights })),
    fullTextAvailable: hasContent,
    complete: doc.syncStatus === "complete",
    // an explicit status instead of a silent partial import: "complete" | "incomplete" (imported, something could not be reproduced) | "unavailable" (excerpt only)
    contentStatus: !hasContent ? "unavailable" : doc.syncStatus === "complete" ? "complete" : "incomplete",
    warnings: humanWarnings(doc.syncWarnings),
    sourceUrl: doc.canonicalUrl,
    source: SOURCE,
    lastSyncedAt: doc.lastSyncedAt || null,
  };
}

async function list(query = {}, { articles = model() } = {}) {
  const { q, category, page, limit } = parseListParams(query);
  const filter = { listed: true };
  if (category) filter.category = category;
  if (q) filter.$text = { $search: q };
  const find = articles.find(filter, q ? { score: { $meta: "textScore" } } : undefined).select(LIST_FIELDS);
  const [rows, total] = await Promise.all([
    find.sort(q ? { score: { $meta: "textScore" }, publishedAt: -1 } : { publishedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    articles.countDocuments(filter),
  ]);
  const totalPages = Math.max(Math.ceil(total / limit), 1);
  return { items: rows.map(toListItem), page, limit, total, totalPages, hasMore: page < totalPages, query: q, category, source: SOURCE };
}

async function getBySlug(slug, { articles = model() } = {}) {
  if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) return null;
  const doc = await articles.findOne({ slug, listed: true }).lean();
  return doc ? toDetail(doc) : null;
}

async function latest({ articles = model() } = {}) {
  const doc = await articles.findOne({ listed: true }).sort({ publishedAt: -1, _id: -1 }).select("slug title publishedAt lastSyncedAt").lean();
  return doc ? { slug: doc.slug, title: doc.title, publishedAt: doc.publishedAt || null, lastSyncedAt: doc.lastSyncedAt || null } : null;
}

module.exports = { list, getBySlug, latest, parseListParams, toListItem, toDetail, SOURCE, CATEGORY_LABELS, SLUG_PATTERN };

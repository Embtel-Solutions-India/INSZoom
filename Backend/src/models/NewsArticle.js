const mongoose = require("mongoose");

// One USCIS newsroom article (news release or alert), imported verbatim from uscis.gov by modules/news. Never holds executable HTML: contentHtml is the
// output of the restrictive sanitizer. Source dates (publishedAt / updatedAtSource) are kept apart from the local timestamps (createdAt / updatedAt).
//
// syncStatus:
//   pending     feed entry seen, article page not imported yet (a stub: never shown publicly)
//   complete    the whole article body was imported and nothing in it had to be left out
//   incomplete  imported, but something could not be preserved (see syncWarnings) - shown with an explicit notice and the official link
//   failed      the article page could not be retrieved; the excerpt + official link is all there is (shown only while the link is known to work)
//   duplicate   the page turned out to be a second URL of an article already held; never shown
const SYNC_STATUSES = ["pending", "complete", "incomplete", "failed", "duplicate"];

const imageSchema = new mongoose.Schema(
  {
    sequence: { type: Number, required: true },
    src: { type: String, default: "" }, // the original USCIS URL (nothing is copied or re-hosted); "" when the image was not reproduced
    alt: { type: String, default: "" },
    caption: { type: String, default: "" },
    credit: { type: String, default: "" },
    width: Number,
    height: Number,
    // linked-from-source: referenced at its uscis.gov address, bytes never stored | not-reproduced: host not on the allowlist or image mode "omit" - only caption/credit are kept
    rights: { type: String, enum: ["linked-from-source", "not-reproduced"], default: "linked-from-source" },
    originalSrc: { type: String, default: "" }, // what the page referred to when the image was not reproduced
  },
  { _id: false }
);

const newsArticleSchema = new mongoose.Schema(
  {
    source: { type: String, default: "uscis", index: true },
    sourceUrl: { type: String, required: true }, // as listed in the feed
    canonicalUrl: { type: String, required: true, unique: true },
    sourceGuid: { type: String, default: "" },
    slug: { type: String, required: true, unique: true },
    category: { type: String, enum: ["news-release", "alert", "news"], required: true }, // from the URL section of uscis.gov, never guessed
    title: { type: String, required: true },
    publishedAt: { type: Date, default: null },
    updatedAtSource: { type: Date, default: null },
    excerpt: { type: String, default: "" }, // the feed's own description, plain text
    contentHtml: { type: String, default: "" },
    bodyText: { type: String, default: "", select: false }, // plain text of contentHtml, for search only
    images: { type: [imageSchema], default: [] },
    contentHash: { type: String, default: "" },
    syncStatus: { type: String, enum: SYNC_STATUSES, default: "pending", index: true },
    syncWarnings: { type: [String], default: [] },
    listed: { type: Boolean, default: false }, // the one flag the public API filters on
    lastSyncedAt: { type: Date, default: null }, // last time the article body was (re)imported
    lastCheckedAt: { type: Date, default: null }, // last time the article page was looked at (also when it had not changed)
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: "" },
    lastErrorPermanent: { type: Boolean, default: false },
    nextAttemptAt: { type: Date, default: null },
    needsRefresh: { type: Boolean, default: false }, // the feed's entry changed since the last import
    feedDigest: { type: String, default: "" }, // digest of the feed entry at the last import
    pendingFeedDigest: { type: String, default: "" }, // digest of the newest feed entry seen
    etag: { type: String, default: "" },
    lastModified: { type: String, default: "" },
  },
  { timestamps: true }
);

newsArticleSchema.index({ listed: 1, publishedAt: -1 });
newsArticleSchema.index({ listed: 1, category: 1, publishedAt: -1 });
newsArticleSchema.index({ syncStatus: 1, nextAttemptAt: 1 });
newsArticleSchema.index({ needsRefresh: 1 });
newsArticleSchema.index({ sourceGuid: 1 }, { sparse: true });
newsArticleSchema.index({ title: "text", excerpt: "text", bodyText: "text" }, { weights: { title: 10, excerpt: 4, bodyText: 1 }, name: "news_text" });

module.exports = mongoose.model("NewsArticle", newsArticleSchema);
module.exports.SYNC_STATUSES = SYNC_STATUSES;

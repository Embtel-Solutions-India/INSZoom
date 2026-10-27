// Configuration of the USCIS news synchronisation. Everything is environment-driven; nothing here is read at import time by anything but this file, and every value has a
// production-safe default. NEWS_SYNC_ENABLED=false switches the scheduled job off completely (the public read API keeps serving what is stored).
const num = (name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && process.env[name] !== "" && process.env[name] !== undefined ? Math.min(Math.max(value, min), max) : fallback;
};

// uscis.gov asks for "Crawl-delay: 10" in robots.txt - the pace between two requests never goes below that, whatever the environment says.
const MIN_REQUEST_DELAY_MS = 10 * 1000;

function getConfig() {
  return {
    enabled: String(process.env.NEWS_SYNC_ENABLED || "true").toLowerCase() !== "false",
    feedUrl: process.env.NEWS_SYNC_FEED_URL || "https://www.uscis.gov/news/rss-feed/59144",
    intervalMs: num("NEWS_SYNC_INTERVAL_MS", 30 * 60 * 1000, { min: 5 * 60 * 1000 }),
    backlogIntervalMs: num("NEWS_SYNC_BACKLOG_INTERVAL_MS", 2 * 60 * 1000, { min: 60 * 1000 }), // next run when articles are still waiting
    initialDelayMs: num("NEWS_SYNC_INITIAL_DELAY_MS", 2 * 60 * 1000),
    requestDelayMs: num("NEWS_SYNC_REQUEST_DELAY_MS", MIN_REQUEST_DELAY_MS, { min: MIN_REQUEST_DELAY_MS }),
    requestTimeoutMs: num("NEWS_SYNC_REQUEST_TIMEOUT_MS", 20 * 1000, { min: 2000, max: 120000 }),
    maxRetries: num("NEWS_SYNC_MAX_RETRIES", 3, { min: 0, max: 6 }), // retries of one request inside a run (transient failures)
    maxArticlesPerRun: num("NEWS_SYNC_MAX_ARTICLES_PER_RUN", 20, { min: 1, max: 100 }),
    maxArticleAttempts: num("NEWS_SYNC_MAX_ARTICLE_ATTEMPTS", 5, { min: 1, max: 20 }), // runs an article may fail before it is shown with the official-link fallback
    refreshAfterMs: num("NEWS_SYNC_REFRESH_AFTER_HOURS", 24 * 7, { min: 1 }) * 60 * 60 * 1000, // an unchanged article is looked at again after this long
    maxBytes: num("NEWS_SYNC_MAX_BYTES", 5 * 1024 * 1024, { min: 100 * 1024 }),
    imageMode: String(process.env.NEWS_SYNC_IMAGE_MODE || "link").toLowerCase() === "omit" ? "omit" : "link",
    userAgent: process.env.NEWS_SYNC_USER_AGENT || "ImmiglanceNewsSync/1.0 (+https://immiglance.com; reads the public USCIS newsroom RSS feed and articles)",
  };
}

// Only these hosts are ever requested (feed, articles) and only these may serve a referenced image.
const ALLOWED_HOSTS = Object.freeze(["www.uscis.gov", "uscis.gov"]);
// Only articles of these newsroom sections are imported; the section becomes the article's category.
const SECTIONS = Object.freeze({ "/newsroom/news-releases/": "news-release", "/newsroom/alerts/": "alert" });

module.exports = { getConfig, ALLOWED_HOSTS, SECTIONS, MIN_REQUEST_DELAY_MS };

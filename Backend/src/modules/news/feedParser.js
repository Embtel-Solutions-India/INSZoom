// Parses the USCIS newsroom RSS feed. The feed carries only an excerpt (the full article is read from the article page), a pubDate with a two-digit year and no categories,
// so this file does exactly three things: validates each entry's address (an allowlisted uscis.gov newsroom article), reads its date correctly, and gives the entry a
// stable identity. Entries it cannot trust are counted and skipped, never guessed.
const crypto = require("crypto");
const cheerio = require("cheerio");
const { safeUscisUrl } = require("./uscisHttp");
const { SECTIONS } = require("./news.config");

const RESERVED_NEWSROOM_SLUGS = new Set(["all-news", "news-releases", "alerts", "multimedia-resources", "news-releases", "outreach", "contact", "newsroom-archive"]);
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** "Mon, 26 Oct 26 11:44:18 -0400" (or a four-digit year, or GMT/Z) -> Date, or null. Date.parse would read "26" as 1926. */
function parseFeedDate(value) {
  const match = /^(?:[A-Za-z]{3},?\s+)?(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(Z|GMT|UT|[+-]\d{4})?$/.exec(String(value || "").trim());
  if (!match) return null;
  const [, day, mon, yearText, hour, minute, second = "0", zone = "Z"] = match;
  const month = MONTHS[mon.toLowerCase()];
  if (month === undefined) return null;
  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
  let offsetMinutes = 0;
  if (/^[+-]\d{4}$/.test(zone)) offsetMinutes = (zone[0] === "-" ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3, 5)));
  const time = Date.UTC(year, month, Number(day), Number(hour), Number(minute), Number(second)) - offsetMinutes * 60000;
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The article's address without query, fragment or trailing slash, or null when it is not an importable newsroom article. */
function articleIdentity(link) {
  const safe = safeUscisUrl(link);
  if (!safe) return null;
  const url = new URL(safe);
  url.search = "";
  url.hash = "";
  url.hostname = "www.uscis.gov";
  url.pathname = url.pathname.replace(/\/+$/, "");
  const section = Object.keys(SECTIONS).find((prefix) => url.pathname.startsWith(prefix) && url.pathname.length > prefix.length);
  if (section) {
    const slugSource = url.pathname.slice(section.length);
    return slugSource.includes("/") ? null : { canonicalUrl: url.toString(), category: SECTIONS[section], slugSource };
  }
  // a few older items sit directly under /newsroom/<slug>; their kind is not stated by the address, so they are plain "news" (listing pages are not articles and fail extraction)
  const direct = /^\/newsroom\/([a-z0-9][a-z0-9-]*)$/i.exec(url.pathname);
  if (direct && !RESERVED_NEWSROOM_SLUGS.has(direct[1].toLowerCase())) return { canonicalUrl: url.toString(), category: "news", slugSource: direct[1] };
  return null;
}

const plainText = (html) => cheerio.load(`<div>${html}</div>`).root().text().replace(/ /g, " ").replace(/\s+/g, " ").trim();

const digest = (parts) => crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);

function parseFeed(xml) {
  const $ = cheerio.load(String(xml || ""), { xmlMode: true });
  if (!$("rss > channel").length) throw new Error("The feed is not an RSS document");
  const items = [];
  const seen = new Set();
  let invalid = 0;
  $("rss > channel > item").each((_, element) => {
    const item = $(element);
    const title = item.children("title").first().text().replace(/\s+/g, " ").trim();
    const identity = articleIdentity(item.children("link").first().text());
    if (!title || !identity || seen.has(identity.canonicalUrl)) {
      if (!identity || !title) invalid += 1;
      return;
    }
    seen.add(identity.canonicalUrl);
    const excerpt = plainText(item.children("description").first().text());
    const pubDateText = item.children("pubDate").first().text().trim();
    const feedDate = parseFeedDate(pubDateText);
    items.push({
      ...identity,
      sourceUrl: item.children("link").first().text().trim(),
      sourceGuid: item.children("guid").first().text().trim(),
      title,
      excerpt,
      feedDate,
      digest: digest([title, excerpt, feedDate ? feedDate.toISOString() : pubDateText]),
    });
  });
  return { items, invalid };
}

module.exports = { parseFeed, parseFeedDate, articleIdentity, plainText };

// DB-free and network-free: the feed parser and the article extractor, against real USCIS markup (fixtures/) and constructed edge cases.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const cheerio = require("cheerio");
const { parseFeed, parseFeedDate, articleIdentity } = require("../feedParser");
const { extractArticle, ExtractionError } = require("../articleExtractor");

const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const textOf = (html) => cheerio.load(`<div>${html}</div>`).root().text().replace(/ /g, " ").replace(/\s+/g, " ").trim();
const CANONICAL = "https://www.uscis.gov/newsroom/news-releases/test-article";

// a page in the real USCIS structure around an arbitrary body
const page = (body, { title = "A Test Article", date = "2026-10-20T15:00:00Z", canonical = CANONICAL, extra = "" } = {}) => `<!doctype html><html><head><link rel="canonical" href="${canonical}" /></head><body>
<header>GLOBAL HEADER</header><main><article class="node node--type-news-item"><div class="container container--main"><h1 class="page-title"><span>${title}</span></h1>
<div><div class="field field--name-field-display-date field--label-inline"><div class="field__label">Release Date</div><div class="field__item"><time datetime="${date}" class="datetime">10/20/2026</time></div></div>
<div class="clearfix text-formatted field field--name-body field__item">${body}</div>${extra}
<div class="reviewed-date"><div class="field field--name-field-reviewed-updated-date field__item"><time datetime="2026-10-21T12:00:00Z" class="datetime">10/21/2026</time></div></div></div></div></article></main><footer>GLOBAL FOOTER</footer></body></html>`;

// ---------------------------------------------------------------- feed
test("the feed's two-digit-year dates are read as 20xx with their own offset (Date.parse would say 1926)", () => {
  assert.equal(parseFeedDate("Mon, 26 Oct 26 11:44:18 -0400").toISOString(), "2026-10-26T15:44:18.000Z");
  assert.equal(parseFeedDate("Wed, 27 Nov 24 09:39:08 -0500").toISOString(), "2024-11-27T14:39:08.000Z");
  assert.equal(parseFeedDate("Tue, 27 Oct 2026 17:09:00 GMT").toISOString(), "2026-10-27T17:09:00.000Z");
  assert.equal(parseFeedDate("not a date"), null);
  assert.equal(parseFeedDate(""), null);
});

test("only newsroom articles on uscis.gov are accepted; the address is normalised and the kind comes from the URL section", () => {
  assert.deepEqual(articleIdentity("https://www.uscis.gov/newsroom/alerts/some-alert/?utm=1#x"), { canonicalUrl: "https://www.uscis.gov/newsroom/alerts/some-alert", category: "alert", slugSource: "some-alert" });
  assert.equal(articleIdentity("https://www.uscis.gov/newsroom/news-releases/a-release").category, "news-release");
  assert.equal(articleIdentity("https://www.uscis.gov/newsroom/an-older-item").category, "news");
  for (const bad of [
    "http://www.uscis.gov/newsroom/alerts/x", // not https
    "https://evil.example/newsroom/alerts/x",
    "https://www.uscis.gov.evil.example/newsroom/alerts/x",
    "https://user:pw@www.uscis.gov/newsroom/alerts/x",
    "https://www.uscis.gov:8443/newsroom/alerts/x",
    "https://127.0.0.1/newsroom/alerts/x",
    "https://www.uscis.gov/humanitarian/asylum", // not news
    "https://www.uscis.gov/newsroom/all-news", // the listing page is not an article
    "https://www.uscis.gov/newsroom/alerts", // a section index
    "https://www.uscis.gov/newsroom/alerts/a/b", // deeper than a slug
    "javascript:alert(1)",
    "",
  ]) assert.equal(articleIdentity(bad), null, bad);
});

test("the real feed sample parses: excerpts only, correct dates, every entry identified, nothing guessed", () => {
  const { items, invalid } = parseFeed(fixture("uscis-feed-sample.xml"));
  assert.equal(invalid, 0);
  assert.equal(items.length, 7);
  assert.equal(items[0].category, "alert");
  assert.equal(items[0].feedDate.toISOString(), "2026-10-26T15:44:18.000Z");
  assert.match(items[0].title, /^Litigation-Related Update/);
  assert.ok(items.every((item) => item.excerpt.length > 0 && !/<\w+>/.test(item.excerpt)), "excerpts are plain text");
  assert.ok(items.every((item) => /^[0-9a-f]{32}$/.test(item.digest)));
  assert.ok(items.some((item) => item.category === "news"), "the item that sits directly under /newsroom/ is kept");
  assert.equal(new Set(items.map((item) => item.canonicalUrl)).size, items.length);
});

test("a feed entry with a foreign or non-article link is counted invalid and skipped; a duplicate entry is kept once; a non-RSS body is rejected", () => {
  const xml = `<rss version="2.0"><channel>
    <item><title>Good</title><link>https://www.uscis.gov/newsroom/alerts/good</link><description>d</description><pubDate>Mon, 26 Oct 26 11:44:18 -0400</pubDate></item>
    <item><title>Good again</title><link>https://www.uscis.gov/newsroom/alerts/good/</link><description>d</description></item>
    <item><title>Evil</title><link>https://evil.example/newsroom/alerts/evil</link></item>
    <item><title></title><link>https://www.uscis.gov/newsroom/alerts/untitled</link></item></channel></rss>`;
  const { items, invalid } = parseFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(invalid, 2);
  assert.throws(() => parseFeed("<html><body>maintenance</body></html>"), /not an RSS/);
});

test("the feed digest changes when the title, excerpt or date changes - the refresh signal", () => {
  const entry = (title, desc, date) => parseFeed(`<rss><channel><item><title>${title}</title><link>https://www.uscis.gov/newsroom/alerts/x</link><description>${desc}</description><pubDate>${date}</pubDate></item></channel></rss>`).items[0].digest;
  const base = entry("T", "d", "Mon, 26 Oct 26 11:44:18 -0400");
  assert.equal(entry("T", "d", "Mon, 26 Oct 26 11:44:18 -0400"), base);
  assert.notEqual(entry("T2", "d", "Mon, 26 Oct 26 11:44:18 -0400"), base);
  assert.notEqual(entry("T", "d2", "Mon, 26 Oct 26 11:44:18 -0400"), base);
  assert.notEqual(entry("T", "d", "Tue, 27 Oct 26 11:44:18 -0400"), base);
});

// ---------------------------------------------------------------- extraction: real pages
test("a real USCIS alert is imported with its exact words, order, lists and links - and none of the site shell", () => {
  const html = fixture("uscis-alert-sileiri-doe.html");
  const result = extractArticle(html, { requestUrl: "https://www.uscis.gov/newsroom/alerts/x" });
  assert.match(result.title, /^Litigation-Related Update: Sileiri Doe Class Members/);
  assert.equal(result.publishedAt.toISOString(), "2026-10-26T15:44:18.000Z");
  assert.equal(result.updatedAtSource.toISOString(), "2026-10-26T12:00:00.000Z");
  assert.equal(result.complete, true);
  assert.deepEqual(result.warnings, []);
  assert.doesNotMatch(result.contentHtml, /GLOBAL HEADER|GLOBAL FOOTER/);

  // the words: identical to the source body's visible text
  const $ = cheerio.load(html);
  const sourceText = textOf($("article .field--name-body").first().html());
  assert.equal(result.bodyText.split(" ").join(""), sourceText.split(" ").join(""), "every character of the source body is there, in order");

  const out = cheerio.load(result.contentHtml, null, false);
  assert.equal(out("ul > li").length, 3, "the bullet list survives");
  assert.equal(out('ol[type="i"] > li').length, 4, "the roman-numeral list keeps its type and items");
  const hrefs = out("a").map((_, a) => out(a).attr("href")).get();
  assert.ok(hrefs.includes("https://www.uscis.gov/i-589"), "a relative link became its original absolute destination");
  assert.ok(out("a").toArray().every((a) => out(a).attr("target") === "_blank" && /noopener/.test(out(a).attr("rel"))));
  assert.equal(out("em").first().text(), "Sileiri Doe v. DHS");
  // order: the first paragraph precedes the "Background" paragraph precedes "Appeals"
  const text = out.root().text();
  assert.ok(text.indexOf("On Sept. 28, 2026") < text.indexOf("Background") && text.indexOf("Background") < text.indexOf("Appeals"));
  assert.doesNotMatch(result.contentHtml, /data-list-item-id|data-entity/);
  assert.match(result.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(result.canonicalUrl, "https://www.uscis.gov/newsroom/alerts/litigation-related-update-sileiri-doe-class-members-may-request-reopening-or-reconsideration-of-an");
});

test("a second real page extracts too, and the same input always yields the same hash (change detection is stable)", () => {
  const html = fixture("uscis-release-idaho-voting.html");
  const a = extractArticle(html, {});
  const b = extractArticle(html, {});
  assert.equal(a.title, "Aliens in Idaho Charged for Illegal Voting");
  assert.equal(a.contentHash, b.contentHash);
  assert.equal(a.complete, true);
});

test("an edit of one word in the source changes the content hash; a changed date does too", () => {
  const original = extractArticle(page("<p>The application fee is $100 for this form.</p>"), {});
  assert.notEqual(extractArticle(page("<p>The application fee is $110 for this form.</p>"), {}).contentHash, original.contentHash);
  assert.notEqual(extractArticle(page("<p>The application fee is $100 for this form.</p>", { date: "2026-10-21T15:00:00Z" }), {}).contentHash, original.contentHash);
});

// ---------------------------------------------------------------- extraction: structure
test("headings, nested lists, tables (with their header cells), block quotes and alignment classes keep their order and meaning", () => {
  const body = `<p>Intro.</p><h2>First</h2><p>One.</p><h3>Sub</h3><ul><li>a<ul><li>nested</li></ul></li><li>b</li></ul>
    <table><caption>Fees</caption><thead><tr><th scope="col">Form</th><th>Fee</th></tr></thead><tbody><tr><td>I-90</td><td colspan="1">$455</td></tr></tbody></table>
    <blockquote><p>Quoted</p></blockquote><p class="text-align-center">- USCIS -</p><h2>Second</h2><p>Two.</p>`;
  const result = extractArticle(page(body), {});
  const out = cheerio.load(result.contentHtml, null, false);
  assert.deepEqual(out("h2, h3").map((_, e) => `${e.tagName}:${out(e).text()}`).get(), ["h2:First", "h3:Sub", "h2:Second"]);
  assert.equal(out("li > ul > li").text(), "nested");
  assert.equal(out("th").length, 2);
  assert.equal(out('th[scope="col"]').length, 1);
  assert.equal(out("caption").text(), "Fees");
  assert.equal(out(".news-table-scroll > table").length, 1, "wide tables get a scroll wrapper");
  assert.equal(out("blockquote p").text(), "Quoted");
  assert.equal(out("p.text-align-center").text(), "- USCIS -");
  assert.equal(result.complete, true);
  const order = ["Intro.", "First", "One.", "Sub", "nested", "Form", "I-90", "Quoted", "- USCIS -", "Second", "Two."];
  const flat = out.root().text();
  const positions = order.map((word) => flat.indexOf(word));
  assert.deepEqual([...positions].sort((x, y) => x - y), positions, "document order is untouched");
});

test("a space held by an otherwise empty inline element is kept (it separates two words); blank spacer paragraphs are dropped", () => {
  const result = extractArticle(page("<p>in the United<span> </span>States.</p><p><strong><u><o:p></o:p></u></strong></p><p>&nbsp;</p><p>Next</p>"), {});
  assert.match(result.contentHtml, /United<span> <\/span>States/);
  assert.equal(result.bodyText, "in the United States. Next");
  assert.equal((result.contentHtml.match(/<p>/g) || []).length, 2, "the two blank paragraphs are gone");
  assert.equal(result.complete, true);
});

test("a heading level 1 inside the body is shown as level 2 (the page's own title is the only h1)", () => {
  const result = extractArticle(page("<h1>Odd</h1><p>Text of the article body.</p>"), {});
  assert.match(result.contentHtml, /<h2>Odd<\/h2>/);
});

// ---------------------------------------------------------------- extraction: links
test("links: relative addresses resolve to USCIS, mailto/tel are kept, javascript: and data: are removed (text stays)", () => {
  const result = extractArticle(page(`<p><a href="/forms/i-90">rel</a> <a href="mailto:a@b.gov">mail</a> <a href="tel:+18003755283">tel</a> <a href="javascript:alert(1)">js</a> <a href="data:text/html,x">data</a> <a href="//evil.example/x">proto</a> <a href="https://example.org/p">ext</a></p>`), {});
  const out = cheerio.load(result.contentHtml, null, false);
  const byText = (text) => out("a").filter((_, a) => out(a).text() === text).first();
  assert.equal(byText("rel").attr("href"), "https://www.uscis.gov/forms/i-90");
  assert.equal(byText("mail").attr("href"), "mailto:a@b.gov");
  assert.equal(byText("mail").attr("target"), undefined, "mailto does not open a tab");
  assert.equal(byText("tel").attr("href"), "tel:+18003755283");
  assert.equal(byText("js").attr("href"), undefined);
  assert.equal(byText("data").attr("href"), undefined);
  assert.equal(byText("ext").attr("href"), "https://example.org/p");
  assert.equal(byText("ext").attr("rel"), "noopener noreferrer");
  assert.doesNotMatch(result.contentHtml, /javascript:/i);
  assert.equal(result.bodyText, "rel mail tel js data proto ext", "every link text is still there");
});

// ---------------------------------------------------------------- extraction: images
test("an image hosted on uscis.gov is referenced at its original address (never copied), in sequence, with caption, alt, size and lazy/no-referrer attributes", () => {
  const body = `<p>Before.</p><figure><img src="/sites/default/files/images/one.jpg" alt="Office" width="600" height="400" onerror="alert(1)"><figcaption>The new office</figcaption></figure><p>Middle.</p><img src="https://www.uscis.gov/sites/default/files/two.png" alt=""><p>After.</p>`;
  const result = extractArticle(page(body), {});
  assert.equal(result.images.length, 2);
  assert.deepEqual(result.images.map((image) => image.sequence), [1, 2]);
  assert.equal(result.images[0].src, "https://www.uscis.gov/sites/default/files/images/one.jpg");
  assert.equal(result.images[0].caption, "The new office");
  assert.equal(result.images[0].alt, "Office");
  assert.equal(result.images[0].width, 600);
  assert.equal(result.images[0].rights, "linked-from-source");
  const out = cheerio.load(result.contentHtml, null, false);
  const first = out("figure img");
  assert.equal(first.attr("width"), "600");
  assert.equal(first.attr("loading"), "lazy");
  assert.equal(first.attr("referrerpolicy"), "no-referrer");
  assert.equal(first.attr("onerror"), undefined);
  assert.equal(out("figcaption").text(), "The new office");
  assert.ok(result.contentHtml.indexOf("Before.") < result.contentHtml.indexOf("one.jpg") && result.contentHtml.indexOf("one.jpg") < result.contentHtml.indexOf("Middle.") && result.contentHtml.indexOf("Middle.") < result.contentHtml.indexOf("two.png"), "images stay where they were");
  assert.equal(result.complete, true);
});

test("an image from another host, a data: image or a plain-http image is NOT redistributed: caption kept, notice shown, article marked incomplete", () => {
  const body = `<p>Text of the article.</p><figure><img src="https://cdn.example.com/photo.jpg" alt="Photo"><figcaption>Photo: Someone</figcaption></figure><img src="data:image/png;base64,AAAA"><img src="http://www.uscis.gov/a.jpg">`;
  const result = extractArticle(page(body), {});
  assert.equal(result.images.length, 3);
  assert.ok(result.images.every((image) => image.rights === "not-reproduced" && image.src === ""));
  assert.equal(result.images[0].originalSrc, "https://cdn.example.com/photo.jpg");
  assert.doesNotMatch(result.contentHtml, /cdn\.example\.com|data:image|<img/);
  assert.match(result.contentHtml, /Photo: Someone/);
  assert.equal((result.contentHtml.match(/news-media-notice/g) || []).length, 3);
  assert.equal(result.complete, false);
  assert.equal(result.warnings.filter((warning) => /not reproduced/.test(warning)).length, 3);
});

test("with image display switched off (imageMode omit) no image is referenced at all", () => {
  const result = extractArticle(page(`<p>Text of the article.</p><img src="/sites/default/files/a.jpg" alt="x">`), { imageMode: "omit" });
  assert.doesNotMatch(result.contentHtml, /<img/);
  assert.equal(result.images[0].rights, "not-reproduced");
  assert.equal(result.complete, false);
});

// ---------------------------------------------------------------- extraction: hostile and unsupported input
test("malicious source HTML is neutralised: scripts, handlers, javascript: URLs, styles, forms, iframes and unknown tags can execute nothing", () => {
  const body = `<p>Safe text stays.</p><script>alert(1)</script><p onclick="steal()" style="position:fixed" id="x">Click</p><a href="javascript:alert(2)" onmouseover="x()">bad link</a>
    <img src="x" onerror="alert(3)"><iframe src="https://evil.example"></iframe><form action="/x"><input name="a"></form><style>body{display:none}</style><svg onload="alert(4)"><circle/></svg>
    <object data="x"></object><embed src="x"><custom-tag>kept words</custom-tag><meta http-equiv="refresh" content="0;url=https://evil.example"><link rel="stylesheet" href="https://evil.example/x.css">`;
  const result = extractArticle(page(body), {});
  const html = result.contentHtml;
  assert.doesNotMatch(html, /<script|<style|<iframe|<form|<input|<svg|<object|<embed|<meta|<link|onclick|onerror|onmouseover|onload|javascript:|style=|evil\.example|id="x"/i);
  assert.match(html, /Safe text stays\./);
  assert.match(html, /kept words/, "an unknown tag is unwrapped, its words stay");
  assert.equal(result.complete, false, "dropped embeds are reported, not silent");
  assert.ok(result.warnings.some((warning) => /iframe/.test(warning)));
});

test("an unread content block inside the article is reported instead of being silently ignored", () => {
  const extra = `<div class="field field--name-field-gallery field__item"><p>A gallery of results</p></div>`;
  const result = extractArticle(page("<p>The body of the article is here.</p>", { extra }), {});
  assert.equal(result.complete, false);
  assert.ok(result.warnings.some((warning) => /gallery/.test(warning)));
});

// ---------------------------------------------------------------- extraction: failures invent nothing
test("a page that is not an article is an extraction error, never a made-up article", () => {
  assert.throws(() => extractArticle("<html><body><h1>Maintenance</h1></body></html>", {}), ExtractionError);
  assert.throws(() => extractArticle(page("<p>  </p>"), {}), /empty/);
  assert.throws(() => extractArticle(page("<p>Body text of the article is long enough.</p>", { title: "" }), {}), /title/);
  assert.throws(() => extractArticle(`<html><body><article class="node node--type-news-item"><h1>T</h1></article></body></html>`, { requestUrl: CANONICAL }), /body/);
});

test("a page without a canonical link falls back to the requested address, with an informational notice that does not make it incomplete", () => {
  const html = page("<p>The body of the article is here.</p>").replace(/<link rel="canonical"[^>]*>/, "");
  const result = extractArticle(html, { requestUrl: CANONICAL });
  assert.equal(result.canonicalUrl, CANONICAL);
  assert.ok(result.warnings.some((warning) => warning.startsWith("notice:")));
  assert.equal(result.complete, true);
  assert.throws(() => extractArticle(html, { requestUrl: "https://evil.example/x" }), /canonical/);
});

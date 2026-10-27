import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// The news pages talk to the API only through services/api; it is replaced here, as is the footer (its artwork and links are not what is tested).
const get = vi.fn();
vi.mock("../../services/api", () => ({ api: { get: (...args) => get(...args) } }));
vi.mock("../../components/SiteFooter", () => ({ default: () => <footer data-testid="footer">FOOTER</footer> }));

const { default: News } = await import("./News");
const { default: NewsArticle } = await import("./NewsArticle");

const item = (slug, title, extra = {}) => ({ slug, title, category: "alert", categoryLabel: "Alert", publishedAt: "2026-10-26T15:44:18.000Z", excerpt: `Excerpt of ${title}`, fullTextAvailable: true, complete: true, sourceUrl: `https://www.uscis.gov/newsroom/alerts/${slug}`, ...extra });
const listResponse = (items, extra = {}) => ({ data: { items, page: 1, limit: 10, total: items.length, totalPages: 1, hasMore: false, query: "", category: "", ...extra } });
const renderNews = (path = "/news") => render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/news" element={<News />} /><Route path="/news/:slug" element={<NewsArticle />} /></Routes></MemoryRouter>);

afterEach(() => { cleanup(); get.mockReset(); });

describe("News listing", () => {
  it("shows the exact headline, a publication date, the source-provided excerpt, the official source link and a link to the in-site article", async () => {
    get.mockResolvedValue(listResponse([item("first-alert", "Litigation-Related Update: Class Members May Request Reopening")]));
    renderNews();
    expect(await screen.findByRole("heading", { name: "Litigation-Related Update: Class Members May Request Reopening" })).toBeTruthy();
    expect(screen.getByText("Excerpt of Litigation-Related Update: Class Members May Request Reopening")).toBeTruthy();
    expect(screen.getByText("October 26, 2026")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Litigation-Related Update/ }).getAttribute("href")).toBe("/news/first-alert");
    expect(screen.getByRole("heading", { level: 1, name: /USCIS News & Updates/ })).toBeTruthy();
    const official = screen.getByRole("link", { name: /official USCIS newsroom/ });
    expect(official.getAttribute("href")).toBe("https://www.uscis.gov/newsroom/all-news");
    expect(official.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText(/not affiliated with USCIS/)).toBeTruthy();
    expect(get).toHaveBeenCalledWith("/news?page=1&limit=10");
  });

  it("marks an article whose full text is not available as summary-only instead of pretending it is complete", async () => {
    get.mockResolvedValue(listResponse([item("short", "Only a Summary", { fullTextAvailable: false, complete: false })]));
    renderNews();
    expect(await screen.findByText(/Summary only/)).toBeTruthy();
  });

  it("searches after a short pause (database-side) and shows the matching total", async () => {
    get.mockResolvedValue(listResponse([item("a", "Alpha")]));
    renderNews();
    await screen.findByText("Alpha");
    get.mockResolvedValue(listResponse([item("h1b", "H-1B Cap Season")], { query: "h-1b" }));
    fireEvent.change(screen.getByRole("searchbox", { name: /search news/i }), { target: { value: "h-1b" } });
    await waitFor(() => expect(get).toHaveBeenLastCalledWith("/news?page=1&limit=10&q=h-1b"), { timeout: 2000 });
    expect(await screen.findByText("H-1B Cap Season")).toBeTruthy();
    expect(screen.getByText(/matching “h-1b”/)).toBeTruthy();
  });

  it("filters by type through the API and paginates with Previous / Next", async () => {
    get.mockResolvedValue(listResponse([item("a", "Alpha")], { total: 25, totalPages: 3, hasMore: true }));
    renderNews();
    await screen.findByText("Alpha");
    expect(screen.getByText("Page 1 of 3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous" }).disabled).toBe(true);

    get.mockResolvedValue(listResponse([item("b", "Bravo")], { page: 2, total: 25, totalPages: 3, hasMore: true }));
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith("/news?page=2&limit=10"));
    expect(await screen.findByText("Bravo")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Alerts" }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith("/news?page=1&limit=10&category=alert"));
  });

  it("shows an empty state, with a way out when a search found nothing", async () => {
    get.mockResolvedValue(listResponse([]));
    renderNews();
    expect(await screen.findByText("No news has been imported yet")).toBeTruthy();
    cleanup();
    get.mockResolvedValue(listResponse([], { query: "zzz" }));
    renderNews("/news?q=zzz");
    expect(await screen.findByText("No articles match your search")).toBeTruthy();
    expect(screen.getByRole("button", { name: /clear search and filters/i })).toBeTruthy();
  });

  it("shows an error state with a working retry when the API fails", async () => {
    get.mockRejectedValueOnce(new Error("Network down"));
    renderNews();
    expect(await screen.findByText("We could not load the news")).toBeTruthy();
    expect(screen.getByText("Network down")).toBeTruthy();
    get.mockResolvedValue(listResponse([item("a", "Alpha")]));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Alpha")).toBeTruthy();
  });
});

const detail = (extra = {}) => ({
  data: {
    slug: "the-article", title: "The Article Title", category: "alert", categoryLabel: "Alert", publishedAt: "2026-10-26T15:44:18.000Z", updatedAtSource: "2026-10-27T12:00:00.000Z",
    excerpt: "The summary.", contentHtml: '<h2>First heading</h2><p>Original paragraph with a <a href="https://www.uscis.gov/i-589" target="_blank" rel="noopener noreferrer">link</a>.</p><ul><li>One</li><li>Two</li></ul>',
    images: [], fullTextAvailable: true, complete: true, contentStatus: "complete", warnings: [], sourceUrl: "https://www.uscis.gov/newsroom/alerts/the-article", source: { name: "U.S. Citizenship and Immigration Services (USCIS)", url: "https://www.uscis.gov/newsroom/all-news" }, ...extra,
  },
});

describe("News article page", () => {
  it("shows the exact title, both source dates, the USCIS attribution, the imported body in order, and prominent links to the original", async () => {
    get.mockResolvedValue(detail());
    renderNews("/news/the-article");
    expect(await screen.findByRole("heading", { level: 1, name: "The Article Title" })).toBeTruthy();
    expect(screen.getByText("October 26, 2026")).toBeTruthy();
    expect(screen.getByText("October 27, 2026")).toBeTruthy();
    expect(screen.getByText(/U.S. Citizenship and Immigration Services \(USCIS\)/)).toBeTruthy();
    const body = document.querySelector(".news-article-body");
    expect(body.querySelector("h2").textContent).toBe("First heading");
    expect(body.querySelectorAll("li").length).toBe(2);
    expect(body.textContent.indexOf("First heading")).toBeLessThan(body.textContent.indexOf("Original paragraph"));
    const originals = screen.getAllByRole("link", { name: /(View the original|Read it) on USCIS\.gov/ });
    expect(originals.length).toBe(2);
    originals.forEach((link) => {
      expect(link.getAttribute("href")).toBe("https://www.uscis.gov/newsroom/alerts/the-article");
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
    });
    expect(screen.getAllByRole("link", { name: /Back to News & Updates/ })[0].getAttribute("href")).toBe("/news");
    expect(screen.queryByRole("note")).toBeNull();
    expect(get).toHaveBeenCalledWith("/news/the-article");
    expect(document.title).toContain("The Article Title");
  });

  it("states plainly when the import is incomplete, with the reasons, and points to the original", async () => {
    get.mockResolvedValue(detail({ contentStatus: "incomplete", complete: false, warnings: ["image 1 was not reproduced (it is not hosted on uscis.gov); see the original article"] }));
    renderNews("/news/the-article");
    const note = await screen.findByRole("note");
    expect(note.textContent).toContain("Some content of this article could not be reproduced here.");
    expect(note.textContent).toContain("image 1 was not reproduced");
  });

  it("when only the summary exists it says so, shows the summary and the official link - never a fake full article", async () => {
    get.mockResolvedValue(detail({ contentStatus: "unavailable", fullTextAvailable: false, complete: false, contentHtml: "" }));
    renderNews("/news/the-article");
    const note = await screen.findByRole("note");
    expect(note.textContent).toContain("The full article could not be loaded here yet.");
    expect(document.querySelector(".news-article-body")).toBeNull();
    expect(screen.getByText("The summary.")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /on USCIS\.gov/ }).length).toBeGreaterThan(0);
  });

  it("an unknown article shows a proper not-found page with a way back", async () => {
    get.mockRejectedValue(Object.assign(new Error("This news article was not found."), { status: 404 }));
    renderNews("/news/does-not-exist");
    expect(await screen.findByRole("heading", { name: "Article not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Browse all news" }).getAttribute("href")).toBe("/news");
  });

  it("a server error is an error state with retry, not a not-found", async () => {
    get.mockRejectedValueOnce(Object.assign(new Error("Server exploded"), { status: 500 }));
    renderNews("/news/the-article");
    expect(await screen.findByText("We could not load this article")).toBeTruthy();
    get.mockResolvedValue(detail());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "The Article Title" })).toBeTruthy();
  });
});

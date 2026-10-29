import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api from "../../services/api";
import { CATEGORY_FILTERS, OFFICIAL_ALL_NEWS_URL, formatNewsDate, isoDate } from "./newsFormat";

// Copied from the Immiglance landing site (Landing/src/Pages/News) so attorneys read the same USCIS news inside their portal.
// Differences: axios client, no public site footer, no page-title changes (the portal keeps its own), axios error shape.

const PAGE_SIZE = 10;

const Svg = ({ children, size = 18, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>{children}</svg>
);
const SearchIcon = (props) => <Svg {...props}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></Svg>;
const ArrowIcon = (props) => <Svg {...props}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
const ShieldIcon = (props) => <Svg {...props}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></Svg>;
const ExternalIcon = (props) => <Svg {...props}><path d="M14 3h7v7M10 14L21 3M19 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h5" /></Svg>;

function CategoryBadge({ children }) {
  return <span className="inline-flex items-center rounded-full border border-border bg-secondary px-2.5 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-secondary-foreground">{children}</span>;
}

function ArticleRow({ article }) {
  const date = formatNewsDate(article.publishedAt);
  return (
    <li>
      <article className="group relative rounded-2xl border border-border bg-card p-5 transition-colors duration-200 hover:border-primary/40 hover:bg-secondary/40 sm:p-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
          <CategoryBadge>{article.categoryLabel}</CategoryBadge>
          {date && <time dateTime={isoDate(article.publishedAt)}>{date}</time>}
          {!article.fullTextAvailable && <span className="text-xs">Summary only &middot; read the full text on USCIS.gov</span>}
        </div>
        <h2 className="mt-3 text-lg font-bold leading-snug tracking-tight text-foreground sm:text-xl">
          <Link to={`/news/${encodeURIComponent(article.slug)}`} className="no-underline after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-ring">
            {article.title}
          </Link>
        </h2>
        {article.excerpt && <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground sm:text-[0.9375rem]">{article.excerpt}</p>}
        <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
          Read article <ArrowIcon size={15} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </article>
    </li>
  );
}

function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;
  const buttonClass = "inline-flex h-10 items-center rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <nav className="mt-6 flex items-center justify-between gap-3" aria-label="News pages">
      <button type="button" className={buttonClass} disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
      <p className="text-sm text-muted-foreground" aria-live="polite">Page {page} of {totalPages}</p>
      <button type="button" className={buttonClass} disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Next</button>
    </nav>
  );
}

// USCIS News & Updates: the official USCIS newsroom, imported as published. Searchable and paginated database-side; each article opens inside Immiglance.
export default function News() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const category = CATEGORY_FILTERS.some((filter) => filter.value === params.get("category")) ? params.get("category") || "" : "";
  const page = Math.max(Number.parseInt(params.get("page") || "1", 10) || 1, 1);

  const [input, setInput] = useState(q);
  const [state, setState] = useState({ status: "loading", data: null, error: "" });
  const requestId = useRef(0);

  const update = useCallback((changes) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      Object.entries(changes).forEach(([key, value]) => {
        if (value === "" || value === null || value === undefined || (key === "page" && Number(value) <= 1)) next.delete(key);
        else next.set(key, String(value));
      });
      return next;
    }, { replace: true });
  }, [setParams]);

  // typing searches after a short pause, from page 1
  useEffect(() => {
    const trimmed = input.trim();
    if (trimmed === q) return undefined;
    const timer = setTimeout(() => update({ q: trimmed, page: 1 }), 350);
    return () => clearTimeout(timer);
  }, [input, q, update]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setState((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const query = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (q) query.set("q", q);
      if (category) query.set("category", category);
      const response = await api.get(`/news?${query.toString()}`);
      if (id !== requestId.current) return; // a newer request superseded this one
      setState({ status: "ready", data: response?.data?.data || null, error: "" }); // the API wraps its payload as { success, data }
    } catch (error) {
      if (id !== requestId.current) return;
      setState((current) => ({ status: "error", data: current.data, error: error?.message || "We could not load the news right now." }));
    }
  }, [q, category, page]);

  useEffect(() => { load(); }, [load]);

  const goToPage = (next) => {
    update({ page: next });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const data = state.data;
  const items = data?.items || [];
  const loading = state.status === "loading";
  const showSkeleton = loading && !items.length;

  return (
    <div>
      <div className="mx-auto w-full max-w-5xl">
        <header>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">USCIS News &amp; Updates</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            News releases and alerts published by U.S. Citizenship and Immigration Services, shown here exactly as USCIS published them and updated automatically.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-foreground">
              <ShieldIcon size={14} className="text-primary" /> Source: USCIS.gov
            </span>
            <a href={OFFICIAL_ALL_NEWS_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
              View the official USCIS newsroom <ExternalIcon size={14} />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
        </header>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search news</span>
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Search USCIS news (e.g., H-1B, asylum, fee rule...)"
              maxLength={100}
              className="h-11 w-full rounded-xl border border-border bg-card pl-11 pr-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/15"
            />
          </label>
          <div className="inline-flex shrink-0 overflow-hidden rounded-xl border border-border" role="group" aria-label="Filter by type">
            {CATEGORY_FILTERS.map((filter) => (
              <button
                key={filter.value || "all"}
                type="button"
                aria-pressed={category === filter.value}
                onClick={() => update({ category: filter.value, page: 1 })}
                className={`h-11 px-4 text-sm font-semibold transition-colors ${category === filter.value ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6" aria-busy={loading}>
          {showSkeleton ? (
            <ul className="space-y-3" aria-hidden="true">
              {Array.from({ length: 5 }, (_, index) => <li key={index} className="h-36 animate-pulse rounded-2xl border border-border bg-secondary/60" />)}
            </ul>
          ) : state.status === "error" && !items.length ? (
            <div role="alert" className="rounded-2xl border border-border bg-card p-10 text-center">
              <p className="font-semibold text-foreground">We could not load the news</p>
              <p className="mt-1 text-sm text-muted-foreground">{state.error}</p>
              <button type="button" onClick={load} className="mt-5 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Try again</button>
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
              <p className="font-semibold text-foreground">{q || category ? "No articles match your search" : "No news has been imported yet"}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {q || category ? "Try different words, or clear the filters." : "Articles appear here automatically once they are published by USCIS."}
              </p>
              {(q || category) && (
                <button type="button" onClick={() => { setInput(""); update({ q: "", category: "", page: 1 }); }} className="mt-4 text-sm font-semibold text-primary hover:underline">Clear search and filters</button>
              )}
            </div>
          ) : (
            <>
              {state.status === "error" && <p role="alert" className="mb-3 rounded-lg border border-border bg-card px-4 py-2 text-sm text-muted-foreground">{state.error} <button type="button" onClick={load} className="font-semibold text-primary hover:underline">Try again</button></p>}
              <ul className={`space-y-3 transition-opacity ${loading ? "opacity-60" : ""}`}>
                {items.map((article) => <ArticleRow key={article.slug} article={article} />)}
              </ul>
              <p className="mt-4 text-xs text-muted-foreground">
                {data.total} {data.total === 1 ? "article" : "articles"}{q ? ` matching “${q}”` : ""}
              </p>
              <Pagination page={data.page} totalPages={data.totalPages} onChange={goToPage} />
            </>
          )}
        </div>

        <p className="mt-10 border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground">
          Immiglance is not part of the U.S. government and is not affiliated with USCIS. This page reproduces public information from uscis.gov; the original on USCIS.gov is always the official version.
        </p>
      </div>
    </div>
  );
}

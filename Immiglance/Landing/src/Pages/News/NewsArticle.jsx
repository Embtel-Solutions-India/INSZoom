import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../services/api";
import SiteFooter from "../../components/SiteFooter";
import { OFFICIAL_ALL_NEWS_URL, formatNewsDate, isoDate } from "./newsFormat";
import "./news.css";

const Svg = ({ children, size = 18, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>{children}</svg>
);
const BackIcon = (props) => <Svg {...props}><path d="M19 12H5M11 6l-6 6 6 6" /></Svg>;
const ExternalIcon = (props) => <Svg {...props}><path d="M14 3h7v7M10 14L21 3M19 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h5" /></Svg>;
const InfoIcon = (props) => <Svg {...props}><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v5h1" /></Svg>;

function OfficialLink({ href, children, primary }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold no-underline transition ${primary ? "bg-primary text-primary-foreground hover:opacity-90" : "border border-border bg-card text-primary hover:bg-secondary"}`}
    >
      {children} <ExternalIcon size={15} />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function BackLink() {
  return (
    <Link to="/news" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary no-underline hover:underline">
      <BackIcon size={16} /> Back to News &amp; Updates
    </Link>
  );
}

function NotFound() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center" role="alert">
      <h1 className="text-2xl font-bold text-foreground">Article not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">This news article does not exist or is no longer available here.</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link to="/news" className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground no-underline hover:opacity-90">Browse all news</Link>
        <OfficialLink href={OFFICIAL_ALL_NEWS_URL}>USCIS newsroom</OfficialLink>
      </div>
    </div>
  );
}

// What the importer could and could not preserve is always stated - never a silent partial article.
function ContentNotice({ article }) {
  if (article.contentStatus === "complete") return null;
  const unavailable = article.contentStatus === "unavailable";
  return (
    <div role="note" className="mt-6 flex gap-3 rounded-xl border border-border bg-secondary/60 p-4 text-sm leading-relaxed text-foreground">
      <InfoIcon size={20} className="mt-0.5 shrink-0 text-primary" />
      <div>
        <p className="font-semibold">{unavailable ? "The full article could not be loaded here yet." : "Some content of this article could not be reproduced here."}</p>
        {unavailable ? (
          <p className="mt-1 text-muted-foreground">Only the summary USCIS published is shown. Please read the complete article on USCIS.gov.</p>
        ) : (
          <>
            {article.warnings.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">{article.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
            <p className="mt-1 text-muted-foreground">The original article on USCIS.gov has the complete content.</p>
          </>
        )}
      </div>
    </div>
  );
}

// One USCIS article, opened inside Immiglance. The body is the source's own text and structure, sanitised by the server (an allowlist of tags and attributes).
export default function NewsArticle() {
  const { slug } = useParams();
  const [state, setState] = useState({ status: "loading", article: null, error: "" });

  const load = useCallback(async () => {
    setState({ status: "loading", article: null, error: "" });
    try {
      const response = await api.get(`/news/${encodeURIComponent(slug || "")}`);
      setState({ status: "ready", article: response?.data || null, error: "" });
    } catch (error) {
      setState(error?.status === 404 ? { status: "notfound", article: null, error: "" } : { status: "error", article: null, error: error?.message || "We could not load this article." });
    }
  }, [slug]);

  useEffect(() => { load(); window.scrollTo(0, 0); }, [load]);

  const article = state.article;
  useEffect(() => {
    document.title = article ? `${article.title} | USCIS News | Immiglance` : "USCIS News & Updates | Immiglance";
  }, [article]);

  const published = formatNewsDate(article?.publishedAt);
  const updated = formatNewsDate(article?.updatedAtSource);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="mx-auto w-full max-w-3xl flex-1 px-5 py-10 sm:px-6">
        {state.status === "loading" ? (
          <div className="space-y-4" aria-busy="true" aria-label="Loading the article">
            <div className="h-4 w-40 animate-pulse rounded bg-secondary" />
            <div className="h-10 w-full animate-pulse rounded bg-secondary" />
            <div className="h-10 w-2/3 animate-pulse rounded bg-secondary" />
            {Array.from({ length: 6 }, (_, index) => <div key={index} className="h-4 w-full animate-pulse rounded bg-secondary/70" />)}
          </div>
        ) : state.status === "notfound" ? (
          <>
            <div className="mb-6"><BackLink /></div>
            <NotFound />
          </>
        ) : state.status === "error" ? (
          <>
            <div className="mb-6"><BackLink /></div>
            <div role="alert" className="rounded-2xl border border-border bg-card p-10 text-center">
              <p className="font-semibold text-foreground">We could not load this article</p>
              <p className="mt-1 text-sm text-muted-foreground">{state.error}</p>
              <button type="button" onClick={load} className="mt-5 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Try again</button>
            </div>
          </>
        ) : article ? (
          <>
            <div className="mb-6"><BackLink /></div>
            <article>
              <header className="border-b border-border pb-6">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
                  <span className="inline-flex items-center rounded-full border border-border bg-secondary px-2.5 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-secondary-foreground">{article.categoryLabel}</span>
                  {published && <span>Released <time dateTime={isoDate(article.publishedAt)}>{published}</time></span>}
                  {updated && updated !== published && <span>Last reviewed/updated <time dateTime={isoDate(article.updatedAtSource)}>{updated}</time></span>}
                </div>
                <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-foreground [overflow-wrap:anywhere] sm:text-4xl">{article.title}</h1>
                <p className="mt-4 text-sm text-muted-foreground">
                  Source: <span className="font-semibold text-foreground">{article.source?.name || "USCIS"}</span> &middot; published on USCIS.gov
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <OfficialLink href={article.sourceUrl} primary>View the original on USCIS.gov</OfficialLink>
                </div>
              </header>

              <ContentNotice article={article} />

              {article.fullTextAvailable ? (
                // contentHtml is sanitised on the server with a restrictive allowlist before it is stored
                <div className="news-article-body mt-8" dangerouslySetInnerHTML={{ __html: article.contentHtml }} />
              ) : (
                article.excerpt && <p className="mt-8 text-lg leading-relaxed text-foreground [overflow-wrap:anywhere]">{article.excerpt}</p>
              )}

              <footer className="mt-12 border-t border-border pt-6">
                <div className="flex flex-wrap items-center gap-3">
                  <OfficialLink href={article.sourceUrl} primary>Read it on USCIS.gov</OfficialLink>
                  <BackLink />
                </div>
                <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
                  This article was published by U.S. Citizenship and Immigration Services and is reproduced here as published. Immiglance is not part of the U.S. government and is not affiliated with USCIS;
                  the original on USCIS.gov is always the official version.
                </p>
              </footer>
            </article>
          </>
        ) : null}
      </div>
      <SiteFooter />
    </div>
  );
}

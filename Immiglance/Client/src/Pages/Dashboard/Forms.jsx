import { useEffect, useMemo, useState } from "react";
import { api, API_BASE_URL } from "../../services/api";

const VIEW_KEY = "immiglance-forms-view";

const formatEdition = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" });
};

// "I-129F" -> "I": the letter series USCIS files the form under.
const seriesOf = (formCode) => String(formCode || "").split(/[-\s]/)[0].toUpperCase();

const readStoredView = () => {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "cards" ? "cards" : "list";
  } catch {
    return "list";
  }
};

/* ── Icons ── */
const Svg = ({ children, size = 18, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>{children}</svg>
);
const DocIcon = (props) => <Svg {...props}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" /></Svg>;
const SearchIcon = (props) => <Svg {...props}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></Svg>;
const ArrowIcon = (props) => <Svg {...props}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
const ChevronIcon = (props) => <Svg {...props}><path d="M6 9l6 6 6-6" /></Svg>;
const ListIcon = (props) => <Svg {...props}><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></Svg>;
const GridIcon = (props) => <Svg {...props}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></Svg>;
const ShieldIcon = (props) => <Svg {...props}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></Svg>;
const RefreshIcon = (props) => <Svg {...props}><path d="M21 12a9 9 0 01-15.5 6.2M3 12A9 9 0 0118.5 5.8" /><path d="M21 4v5h-5M3 20v-5h5" /></Svg>;

function InfoChip({ icon: Icon, children }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[0.7rem] font-medium text-foreground">
      <Icon size={14} className="text-primary" /> {children}
    </span>
  );
}

function ViewToggle({ view, onChange }) {
  const option = (value, label, Icon) => (
    <button
      type="button"
      onClick={() => onChange(value)}
      aria-pressed={view === value}
      title={label}
      className={`inline-flex h-8 items-center gap-1.5 px-2.5 text-xs font-semibold transition-colors ${view === value ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
    >
      <Icon size={14} /> <span>{label}</span>
    </button>
  );
  return (
    <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-border" role="group" aria-label="Change view">
      {option("list", "List", ListIcon)}
      {option("cards", "Cards", GridIcon)}
    </div>
  );
}

// The latest official edition of every USCIS form: searchable, filterable by series, shown as a list or as cards. "Open form" opens the PDF in a new tab.
export default function Forms() {
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [series, setSeries] = useState("all");
  const [view, setView] = useState(readStoredView);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/public-forms");
      setForms(response?.data || []);
    } catch (err) {
      setError(err?.message || "Unable to load the forms.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const changeView = (next) => {
    setView(next);
    try { window.localStorage.setItem(VIEW_KEY, next); } catch { /* the choice just is not remembered */ }
  };

  const openForm = (formCode) => window.open(`${API_BASE_URL}/public-forms/${encodeURIComponent(formCode)}/pdf`, "_blank", "noopener");

  const seriesOptions = useMemo(() => [...new Set(forms.map((form) => seriesOf(form.formCode)))].sort(), [forms]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return forms.filter((form) => {
      if (series !== "all" && seriesOf(form.formCode) !== series) return false;
      if (!term) return true;
      return form.formCode.toLowerCase().includes(term) || (form.title || "").toLowerCase().includes(term);
    });
  }, [forms, search, series]);

  return (
    <div className="w-full px-4 pb-10 pt-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-foreground">USCIS Forms</h1>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">Access the latest official USCIS forms, fetched directly from uscis.gov.</p>
        </div>
        <ViewToggle view={view} onChange={changeView} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search forms</span>
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search forms (e.g., I-129, I-485, G-28...)"
            className="h-10 w-full rounded-xl border border-border bg-card pl-10 pr-4 text-[0.8125rem] text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/15"
          />
        </label>
        <div className="flex gap-3">
          <label className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
            <span className="sr-only">Filter by form series</span>
            <select
              value={series}
              onChange={(event) => setSeries(event.target.value)}
              className="h-10 w-full cursor-pointer appearance-none rounded-xl border border-border bg-card pl-4 pr-10 text-[0.8125rem] font-medium text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/15"
            >
              <option value="all">All Forms</option>
              {seriesOptions.map((code) => <option key={code} value={code}>{code} series</option>)}
            </select>
            <ChevronIcon className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          </label>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <InfoChip icon={DocIcon}>{loading ? "—" : forms.length} Forms Available</InfoChip>
        <InfoChip icon={RefreshIcon}>Always up to date</InfoChip>
        <InfoChip icon={ShieldIcon}>Official USCIS source</InfoChip>
      </div>

      <div className="mt-5">
        {loading ? (
          <div className="space-y-2" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => <div key={index} className="h-16 animate-pulse rounded-xl border border-border bg-secondary/60" />)}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-border bg-card p-10 text-center">
            <p className="font-semibold text-foreground">We could not load the forms</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            <button type="button" onClick={load} className="mt-5 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Try again</button>
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
            <DocIcon size={36} className="mx-auto text-muted-foreground" />
            <p className="mt-3 font-semibold text-foreground">{forms.length ? "No forms match your search" : "No forms are available yet"}</p>
            {forms.length > 0 && (
              <button type="button" onClick={() => { setSearch(""); setSeries("all"); }} className="mt-3 text-sm font-semibold text-primary hover:underline">Clear search and filter</button>
            )}
          </div>
        ) : view === "cards" ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {visible.map((form) => (
              <li key={form.formCode}>
                <button
                  type="button"
                  onClick={() => openForm(form.formCode)}
                  className="group flex h-full w-full items-start gap-3.5 rounded-2xl border border-border bg-card p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground"><DocIcon size={19} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold leading-tight text-foreground">{form.formCode}</span>
                    <span className="mt-1 line-clamp-2 block text-[0.8125rem] leading-snug text-muted-foreground">{form.title}</span>
                    {formatEdition(form.editionDate) && <span className="mt-2 block text-xs text-muted-foreground">Edition: {formatEdition(form.editionDate)}</span>}
                  </span>
                  <ArrowIcon size={18} className="mt-1 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,3fr)_minmax(0,1fr)_auto] items-center gap-4 border-b border-border bg-secondary/60 px-5 py-2.5 text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
              <span>Form Number</span><span>Form Title</span><span>Edition Date</span><span className="w-28 text-right">Action</span>
            </div>
            <ul className="divide-y divide-border">
              {visible.map((form) => (
                <li key={form.formCode} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-2.5 transition-colors hover:bg-secondary/50 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,3fr)_minmax(0,1fr)_auto]">
                  <span className="flex items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><DocIcon size={15} /></span>
                    <span className="text-sm font-semibold text-foreground">{form.formCode}</span>
                  </span>
                  <span className="order-3 col-span-2 text-[0.8125rem] leading-snug text-muted-foreground sm:order-0 sm:col-span-1" title={form.title}>{form.title}</span>
                  <span className="hidden text-[0.8125rem] text-muted-foreground sm:block">{formatEdition(form.editionDate)}</span>
                  <button
                    type="button"
                    onClick={() => openForm(form.formCode)}
                    className="inline-flex w-28 items-center justify-center gap-1.5 justify-self-end rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-primary transition hover:border-primary/40 hover:bg-primary/5"
                  >
                    Open form <ArrowIcon size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!loading && !error && visible.length > 0 && forms.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">Showing {visible.length} of {forms.length} forms</p>
        )}
      </div>
    </div>
  );
}

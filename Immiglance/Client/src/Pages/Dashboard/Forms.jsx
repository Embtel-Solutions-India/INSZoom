import { useEffect, useState } from "react";
import { api, API_BASE_URL } from "../../services/api";

const formatEdition = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" });
};

// The latest official edition of every USCIS form, as a plain list. "Open form" opens the PDF in a new browser tab.
export default function Forms() {
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  const openForm = (formCode) => window.open(`${API_BASE_URL}/public-forms/${encodeURIComponent(formCode)}/pdf`, "_blank", "noopener");

  return (
    <div className="mx-auto max-w-6xl px-4 pb-8 pt-8 sm:px-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Latest USCIS Forms</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The current official edition of each form, fetched directly from uscis.gov{loading ? "" : ` · ${forms.length} forms`}
        </p>
      </div>

      {loading ? (
        <p className="py-8 text-base text-muted-foreground">Loading forms...</p>
      ) : error ? (
        <p className="py-8 text-base text-muted-foreground">
          {error} <button type="button" onClick={load} className="font-semibold text-primary hover:underline">Retry</button>
        </p>
      ) : forms.length === 0 ? (
        <p className="py-8 text-base text-muted-foreground">No forms are available yet.</p>
      ) : (
        <div className="rounded-xl border border-border bg-card p-3 sm:p-4"><ul className="divide-y divide-border">
          {forms.map((form) => (
            <li key={form.formCode} className="flex items-center gap-4 rounded-lg px-4 py-2.5 text-base hover:bg-secondary/60">
              <span className="w-24 shrink-0 font-semibold text-foreground sm:w-28">{form.formCode}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground" title={form.title}>{form.title}</span>
              <span className="hidden shrink-0 text-sm text-muted-foreground sm:inline">{formatEdition(form.editionDate)}</span>
              <button
                type="button"
                onClick={() => openForm(form.formCode)}
                className="shrink-0 rounded-lg border border-border px-3.5 py-1.5 text-sm font-medium text-primary hover:bg-secondary"
              >
                Open form
              </button>
            </li>
          ))}
        </ul></div>
      )}
    </div>
  );
}

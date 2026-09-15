import { useEffect, useState } from "react";

// Generic, config-driven form over a canonicalData-shaped profile (see
// EmployerProfile/EmployeeProfile in Backend/src/models/) — used for both
// the employer questionnaire and each employee's own questionnaire. `fields`
// use dot-paths ("address.city") matching the backend's canonicalFieldWriter.
const inputClass = "w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 disabled:bg-slate-50 disabled:text-slate-500";

function getPath(obj, path) {
  return path.split(".").reduce((node, key) => (node == null ? node : node[key]), obj);
}

export default function CanonicalProfileForm({
  title,
  description,
  fieldGroups, // [{ label, fields: [{ path, label, type }] }]
  profile, // { canonicalData } from GET, or null
  onSave, // async (fields) => { applied, conflicted }
  readOnly = false,
  saveLabel = "Save",
}) {
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const initial = {};
    fieldGroups.forEach((group) => group.fields.forEach(({ path }) => {
      const field = getPath(profile?.canonicalData, path);
      initial[path] = field?.value ?? "";
    }));
    setValues(initial);
  }, [profile, fieldGroups]);

  const update = (path, value) => {
    setValues((prev) => ({ ...prev, [path]: value }));
    setMessage("");
    setError("");
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const fields = {};
      fieldGroups.forEach((group) => group.fields.forEach(({ path }) => { fields[path] = values[path]; }));
      const result = await onSave(fields);
      setMessage(
        result?.conflictedFields?.length
          ? `Saved. ${result.conflictedFields.length} field(s) were flagged for case manager review because they had a prior correction on file.`
          : "Saved."
      );
    } catch (err) {
      setError(err.message || "Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const renderField = ({ path, type = "text", options = [], placeholder }) => {
    if (type === "textarea") {
      return (
        <textarea
          className={`${inputClass} min-h-28 resize-y`}
          value={values[path] ?? ""}
          disabled={readOnly}
          placeholder={placeholder}
          onChange={(e) => update(path, e.target.value)}
        />
      );
    }
    if (type === "select") {
      return (
        <select
          className={inputClass}
          value={values[path] ?? ""}
          disabled={readOnly}
          onChange={(e) => update(path, e.target.value)}
        >
          <option value="">{placeholder || "Select"}</option>
          {options.map((option) => (
            <option key={option.value || option} value={option.value || option}>
              {option.label || option}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        type={type}
        className={inputClass}
        value={values[path] ?? ""}
        disabled={readOnly}
        placeholder={placeholder}
        onChange={(e) => update(path, e.target.value)}
      />
    );
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
      {title && (
        <div>
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          {description && <p className="text-sm text-slate-500 mt-1">{description}</p>}
        </div>
      )}

      {fieldGroups.map((group) => (
        <div key={group.label} className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{group.label}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {group.fields.map((field) => (
              <label key={field.path} className={`block ${field.span === "full" ? "sm:col-span-2" : ""}`}>
                <span className="mb-1 block text-xs font-medium text-slate-500">{field.label}</span>
                {renderField(field)}
                {field.help && <span className="mt-1 block text-[11px] leading-relaxed text-slate-400">{field.help}</span>}
              </label>
            ))}
          </div>
        </div>
      ))}

      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">{error}</p>
      )}

      {!readOnly && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-400">{message}</p>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : saveLabel}
          </button>
        </div>
      )}
    </div>
  );
}

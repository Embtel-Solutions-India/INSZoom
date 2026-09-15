import { useRef, useState } from "react";
import { documentIntelligenceApi } from "../../services/api";
import { IconSparkles } from "../../utils/iconComponents";
import {
  normalizeType,
  normalizeOptions,
  isEmptyValue,
  titleFromKey,
  unwrapApiData,
  AUTOFILL_LABELS,
} from "../../utils/questionnaireEngine";

const INPUT_CLASS =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 disabled:bg-slate-100 disabled:text-slate-500";

// Autofill-from-document button (resume/passport) — same OCR extraction path
// used everywhere else document intelligence runs; only shown for document
// types with a real field mapping (see matchingAutofillSources).
export function AutofillButton({ documentType, caseId, disabled, onUploaded }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const response = await documentIntelligenceApi.autofillFromDocument(caseId, documentType, file);
      onUploaded(documentType, unwrapApiData(response));
    } catch (error) {
      onUploaded(documentType, null, error);
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <input ref={inputRef} type="file" id={`autofill-${documentType}`} name={`autofill-${documentType}`} accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" className="hidden" onChange={handleFile} />
      <button
        type="button"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-extrabold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {uploading ? `Reading your ${AUTOFILL_LABELS[documentType]}...` : <><IconSparkles size={14} className="text-emerald-700" /> Autofill from {AUTOFILL_LABELS[documentType]}</>}
      </button>
    </>
  );
}

function RepeatableGroupInput({ question, value, disabled, onChange }) {
  const columns =
    question?.metadata?.columns ||
    question?.metadata?.fields ||
    question?.repeatableConfig?.fields ||
    question?.fields ||
    [];
  const rows = Array.isArray(value) ? value : [];
  const maxRows = Number(question?.repeatableConfig?.max || question?.metadata?.maxRows || 0);

  const updateRow = (rowIndex, fieldKey, fieldValue) => {
    onChange(rows.map((row, index) => (index === rowIndex ? { ...row, [fieldKey]: fieldValue } : row)));
  };

  const addRow = () => {
    if (maxRows && rows.length >= maxRows) return;
    onChange([...rows, {}]);
  };

  const removeRow = (rowIndex) => {
    onChange(rows.filter((_, index) => index !== rowIndex));
  };

  if (!columns.length) {
    return (
      <textarea
        id={question.key}
        name={question.key}
        className={`${INPUT_CLASS} min-h-28`}
        disabled={disabled}
        value={typeof value === "string" ? value : JSON.stringify(value || [], null, 2)}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row, rowIndex) => (
        <div key={`row-${rowIndex}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {columns.map((column) => {
              const fieldKey = column.key || column.field || column.name;
              return (
                <label key={fieldKey} className="space-y-1 text-xs font-bold text-slate-500">
                  {column.label || titleFromKey(fieldKey)}
                  <input
                    id={`${question.key}-${rowIndex}-${fieldKey}`}
                    name={`${question.key}.${rowIndex}.${fieldKey}`}
                    className={INPUT_CLASS}
                    type={column.type === "date" ? "date" : column.type === "number" ? "number" : "text"}
                    value={row?.[fieldKey] || ""}
                    disabled={disabled}
                    onChange={(event) => updateRow(rowIndex, fieldKey, event.target.value)}
                  />
                </label>
              );
            })}
          </div>
          {!disabled && (
            <button type="button" onClick={() => removeRow(rowIndex)} className="mt-3 text-xs font-extrabold text-rose-600">
              Remove entry
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button type="button" onClick={addRow} className="rounded-xl border border-emerald-200 px-4 py-2 text-sm font-extrabold text-emerald-700 hover:bg-emerald-50">
          Add entry
        </button>
      )}
    </div>
  );
}

// The one field+file+repeating-group renderer for every question type a
// Questionnaire template can define. Used exclusively by
// QuestionnaireRenderer — nothing else should hand-code per-type question JSX.
export default function QuestionInput({ question, value, disabled, saving, onChange, onFileChange }) {
  const type = normalizeType(question);
  const options = normalizeOptions(question.options);

  if (type === "textarea" || type === "rich_text") {
    return <textarea id={question.key} name={question.key} className={`${INPUT_CLASS} min-h-28 resize-y`} disabled={disabled} value={value || ""} placeholder={question.placeholder || ""} onChange={(event) => onChange(event.target.value)} />;
  }

  if (type === "select") {
    return (
      <select id={question.key} name={question.key} className={INPUT_CLASS} disabled={disabled} value={value || ""} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select an option</option>
        {options.map((option) => (
          <option key={String(option.value)} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (type === "multi_select") {
    const current = Array.isArray(value) ? value : [];
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label key={String(option.value)} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
            <input
              type="checkbox"
              id={`${question.key}-${option.value}`}
              name={question.key}
              disabled={disabled}
              checked={current.includes(option.value)}
              onChange={(event) => onChange(event.target.checked ? [...current, option.value] : current.filter((item) => item !== option.value))}
            />
            {option.label}
          </label>
        ))}
      </div>
    );
  }

  if (type === "radio" || type === "boolean") {
    const radioOptions = type === "boolean" && !options.length ? [{ label: "Yes", value: "Yes" }, { label: "No", value: "No" }] : options;
    return (
      <div className="flex flex-wrap gap-2">
        {radioOptions.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`rounded-xl border px-4 py-2 text-sm font-extrabold transition disabled:cursor-not-allowed disabled:opacity-60 ${
              value === option.value ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  }

  if (type === "checkbox") {
    if (options.length) {
      const current = Array.isArray(value) ? value : [];
      return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {options.map((option) => (
            <label key={String(option.value)} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                id={`${question.key}-${option.value}`}
                name={question.key}
                disabled={disabled}
                checked={current.includes(option.value)}
                onChange={(event) => onChange(event.target.checked ? [...current, option.value] : current.filter((item) => item !== option.value))}
              />
              {option.label}
            </label>
          ))}
        </div>
      );
    }
    return (
      <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
        <input type="checkbox" id={question.key} name={question.key} disabled={disabled} checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        Confirm
      </label>
    );
  }

  if (type === "address") {
    const current = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const updateAddress = (field, fieldValue) => onChange({ ...current, [field]: fieldValue });
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {["line1", "line2", "city", "state", "postalCode", "country"].map((field) => (
          <input
            key={field}
            id={`${question.key}-${field}`}
            name={`${question.key}.${field}`}
            className={INPUT_CLASS}
            disabled={disabled}
            value={current[field] || ""}
            placeholder={titleFromKey(field)}
            onChange={(event) => updateAddress(field, event.target.value)}
          />
        ))}
      </div>
    );
  }

  if (type === "file") {
    const multiple = question?.metadata?.requestedType === "file-multiple" || question?.metadata?.multiple || question?.fileConstraints?.maxFiles > 1;
    return (
      <div className="space-y-2">
        <input id={question.key} name={question.key} className={INPUT_CLASS} type="file" multiple={multiple} disabled={disabled} onChange={(event) => onFileChange(Array.from(event.target.files || []))} />
        {Array.isArray(value) && value.length > 0 && <p className="text-xs font-bold text-slate-500">{value.length} file{value.length === 1 ? "" : "s"} saved</p>}
        {saving && <p className="text-xs font-extrabold text-emerald-600">Uploading files...</p>}
      </div>
    );
  }

  if (type === "repeating_group") {
    return <RepeatableGroupInput question={question} value={value} disabled={disabled} onChange={onChange} />;
  }

  if (type === "computed") {
    return <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-bold text-slate-600">{isEmptyValue(value) ? "Calculated after related answers are saved" : String(value)}</div>;
  }

  const inputType = {
    number: "number",
    currency: "number",
    email: "email",
    phone: "tel",
    date: "date",
  }[type] || "text";

  return <input id={question.key} name={question.key} className={INPUT_CLASS} type={inputType} disabled={disabled} value={value || ""} placeholder={question.placeholder || ""} onChange={(event) => onChange(event.target.value)} />;
}

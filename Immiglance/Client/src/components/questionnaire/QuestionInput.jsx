import { useRef, useState } from "react";
import EntryFileList from "../checklist/EntryFileList";
import { documentIntelligenceApi } from "../../services/api";
import { isColumnHidden, isColumnRequired, validateRepeatingGroupRows } from "../../utils/repeatingGroup";
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
  "w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:bg-secondary disabled:text-muted-foreground";

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
        className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-accent px-3 py-1 text-xs font-bold text-accent-foreground transition hover:bg-accent/80 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {uploading ? `Reading your ${AUTOFILL_LABELS[documentType]}...` : <><IconSparkles size={14} className="text-accent-foreground" /> {documentType === "passport" ? "Scan passport" : `Autofill from ${AUTOFILL_LABELS[documentType]}`}</>}
      </button>
    </>
  );
}

function RepeatableColumnInput({ question, column, fieldKey, rowIndex, row, disabled, hasError, onChange, onBlur }) {
  const id = `${question.key}-${rowIndex}-${fieldKey}`;
  const name = `${question.key}.${rowIndex}.${fieldKey}`;
  const value = row?.[fieldKey];
  const className = `${INPUT_CLASS} ${hasError ? "border-destructive focus:border-destructive focus:ring-destructive/20" : ""}`;
  const options = normalizeOptions(column.options);

  if (column.type === "checkbox") {
    return (
      <input id={id} name={name} type="checkbox" className="h-4 w-4 rounded border-border text-primary" checked={value === true || value === "true"} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    );
  }
  if (column.type === "textarea") {
    return <textarea id={id} name={name} className={`${className} min-h-24 resize-y`} value={value || ""} disabled={disabled} onBlur={onBlur} onChange={(event) => onChange(event.target.value)} />;
  }
  if (column.type === "select") {
    return (
      <select id={id} name={name} className={className} value={value || ""} disabled={disabled} onBlur={onBlur} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select...</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    );
  }
  // combo: pick from the list or type your own (e.g. a non-US state/province)
  const listId = column.type === "combo" ? `${id}-list` : undefined;
  return (
    <>
      <input
        id={id}
        name={name}
        list={listId}
        className={className}
        type={column.type === "date" ? "date" : column.type === "number" ? "number" : column.type === "phone" ? "tel" : "text"}
        step={column.type === "number" ? column.step || "any" : undefined}
        min={column.type === "number" ? column.min : undefined}
        max={column.type === "number" ? column.max : undefined}
        value={value ?? ""}
        disabled={disabled}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
      />
      {listId && <datalist id={listId}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</datalist>}
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
  const itemLabel = question?.metadata?.itemLabel;
  const instructions = question?.metadata?.instructions || [];
  const [touched, setTouched] = useState({});
  const validation = validateRepeatingGroupRows(question, rows);

  const updateRow = (rowIndex, fieldKey, fieldValue) => {
    onChange(rows.map((row, index) => (index === rowIndex ? { ...row, [fieldKey]: fieldValue } : row)));
  };

  const addRow = () => {
    if (maxRows && rows.length >= maxRows) return;
    onChange([...rows, {}]);
  };

  const removeRow = (rowIndex) => {
    const message = question?.metadata?.confirmRemove || "Remove this entry? This cannot be undone.";
    if (typeof window !== "undefined" && !window.confirm(message)) return;
    onChange(rows.filter((_, index) => index !== rowIndex));
    setTouched({});
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

  const summaryFields = question?.metadata?.summaryFields || [];
  return (
    <div className="space-y-3">
      {instructions.length > 0 && (
        <div className="space-y-1 rounded-xl border border-border bg-accent/60 px-3.5 py-2.5 text-xs text-muted-foreground">
          {instructions.map((line) => <p key={line}>{line}</p>)}
        </div>
      )}
      {rows.map((row, rowIndex) => {
        const summary = summaryFields.map((key) => row?.[key]).filter(Boolean).join(" - ");
        return (
          <div key={`row-${rowIndex}`} className="rounded-2xl border border-border bg-secondary p-3">
            {itemLabel && (
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-bold text-foreground">{itemLabel} {rowIndex + 1}{summary ? <span className="font-medium text-muted-foreground"> - {summary}</span> : null}</p>
                {!disabled && (
                  <button type="button" onClick={() => removeRow(rowIndex)} className="text-xs font-bold text-destructive">Delete</button>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {columns.map((column) => {
                const fieldKey = column.key || column.field || column.name;
                if (isColumnHidden(column, row)) return null;
                const message = touched[`${rowIndex}.${fieldKey}`] ? validation.rowErrors[rowIndex]?.[fieldKey] : null;
                const wide = column.type === "textarea";
                const labelNode = <span>{column.label || titleFromKey(fieldKey)}{isColumnRequired(column, row) ? <span className="text-destructive"> *</span> : null}</span>;
                return (
                  <label key={fieldKey} className={`space-y-1 text-xs font-bold text-muted-foreground ${wide ? "md:col-span-2" : ""} ${column.type === "checkbox" ? "flex items-center gap-2 space-y-0 md:col-span-2" : ""}`}>
                    {column.type !== "checkbox" && labelNode}
                    <RepeatableColumnInput
                      question={question}
                      column={column}
                      fieldKey={fieldKey}
                      rowIndex={rowIndex}
                      row={row}
                      disabled={disabled}
                      hasError={Boolean(message)}
                      onBlur={() => setTouched((current) => ({ ...current, [`${rowIndex}.${fieldKey}`]: true }))}
                      onChange={(next) => updateRow(rowIndex, fieldKey, next)}
                    />
                    {column.type === "checkbox" && labelNode}
                    {message && <span className="block text-[11px] font-semibold text-destructive">{message}</span>}
                  </label>
                );
              })}
            </div>
            {!disabled && !itemLabel && (
              <button type="button" onClick={() => removeRow(rowIndex)} className="mt-3 text-xs font-bold text-destructive">
                Remove entry
              </button>
            )}
          </div>
        );
      })}
      {validation.warnings.map((warning) => <p key={warning} className="text-xs font-semibold text-muted-foreground">{warning}</p>)}
      {!disabled && (
        <button type="button" onClick={addRow} className="rounded-xl border border-border px-4 py-2 text-sm font-bold text-primary hover:bg-accent">
          {question?.metadata?.addLabel || "Add entry"}
        </button>
      )}
    </div>
  );
}

// The one field+file+repeating-group renderer for every question type a
// Questionnaire template can define. Used exclusively by
// QuestionnaireRenderer — nothing else should hand-code per-type question JSX.
export default function QuestionInput({ question, value, disabled, saving, onChange, onFileChange, files, onRemoveFile }) {
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
          <label key={String(option.value)} className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground">
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
            className={`rounded-xl border px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${
              value === option.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-secondary"
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
            <label key={String(option.value)} className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground">
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
      <label className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-foreground">
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
    // Every file question is multi-entry (max 10 files, 50 MB each): entries
    // come from the saved Answer.files; new uploads APPEND server-side.
    const entries = (Array.isArray(files) ? files : []).map((file) => ({
      id: file.storageKey || String(file.documentId || file.originalName),
      name: file.originalName || "Document",
      size: file.size,
      mimeType: file.mimeType,
      url: file.url,
      raw: file,
    }));
    return (
      <div className="space-y-2">
        <EntryFileList
          inputId={question.key}
          entries={entries}
          disabled={disabled}
          busy={Boolean(saving)}
          onAdd={(picked) => onFileChange(picked)}
          onRemove={(entry) => onRemoveFile?.(entry.raw)}
        />
        {!entries.length && Array.isArray(value) && value.length > 0 && <p className="text-xs font-bold text-muted-foreground">{value.length} file{value.length === 1 ? "" : "s"} saved</p>}
      </div>
    );
  }

  if (type === "repeating_group") {
    return <RepeatableGroupInput question={question} value={value} disabled={disabled} onChange={onChange} />;
  }

  if (type === "computed") {
    return <div className="rounded-xl border border-border bg-secondary px-3.5 py-2.5 text-sm font-bold text-muted-foreground">{isEmptyValue(value) ? "Calculated after related answers are saved" : String(value)}</div>;
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

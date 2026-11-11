// GuardedPDFRenderer - PDFRenderer plus the "no saved value is lost on download" safeguards, in its OWN file.
//
// Why a subclass and not edits inside PDFRenderer.js: PDFRenderer.js is edited by hand on the production server, so any commit that touches it makes `git pull` abort during a
// deploy ("local changes would be overwritten"). PDFRenderer.js is therefore left exactly as the server has it. The base render() writes every mapped box through
// `this.setFormField(...)`, so calling render()/renderFiling() on THIS class makes that loop use the safer version below - nothing in the base file changes.
//
// What the safeguards do (every one is generic: nothing here knows a form code):
//   * look boxes up in ONE name -> box map per form (pdf-lib's getField() scans every box on each call: a 980-box form rendered about twice as slowly);
//   * a mapping whose box name differs from the PDF's only by upper/lower case or stray spaces still finds its box (only when exactly one box matches);
//   * a dropdown / list value that is not one of the printed choices is added to the list so the entry is kept (radio groups cannot take a new choice: reported);
//   * text a standard PDF font cannot draw (a Chinese or Devanagari name, "Ṛ") made pdf.save() THROW, the render failed and the download fell to the BLANK form. Such text is
//     stored in the box exactly (UTF-16) WITHOUT drawing its look, so save() cannot fail (NeedAppearances makes viewers draw it);
//   * every written box is read back at once; one that did not keep its value is written once more, and reported if it still differs.
// Everything that still could not be placed is returned in renderReport.unplacedWrites (the download's data-completeness check, FormDataGuard, reads it).
// Behaviour for every value that already worked is identical to the base class.
const { AsyncLocalStorage } = require("node:async_hooks");
const PDFRenderer = require("./PDFRenderer");
const { fitTextValue, fitChoiceValue } = require("./FieldValueFitter");
const { isProtectedField } = require("./ProtectedFieldPolicy");

const renderContext = new AsyncLocalStorage();
const MAX_UNPLACED = 5000;
// characters the standard PDF fonts (WinAnsi) can draw: Latin-1 plus the cp1252 extras
const NOT_DRAWABLE = /[^\x00-\xFF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/;
const clean = (text) => String(text ?? "").replace(/\s+/g, "").toLowerCase();

const significant = (value) => {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === "string") return value.trim() !== "" && value.trim().toLowerCase() !== "false";
  if (Array.isArray(value)) return value.some(significant);
  return true;
};

class GuardedPDFRenderer extends PDFRenderer {
  // One name -> box map per form, built once. `exact` is by full name; `loose` ignores case and stray spaces and holds null for an ambiguous name (never guessed).
  static fieldIndex(form) {
    this._fieldIndex = this._fieldIndex || new WeakMap();
    let index = this._fieldIndex.get(form);
    if (!index) {
      index = { exact: new Map(), loose: new Map() };
      for (const field of form.getFields()) {
        const name = field.getName();
        if (!index.exact.has(name)) index.exact.set(name, field);
        const key = String(name).replace(/\s+/g, "").toLowerCase();
        index.loose.set(key, index.loose.has(key) ? null : field);
      }
      this._fieldIndex.set(form, index);
    }
    return index;
  }

  static findField(form, pdfField, mappedField) {
    let index;
    try { index = this.fieldIndex(form); } catch (_error) { index = null; }
    if (!index) { try { return form.getField(pdfField); } catch (_notFound) { return null; } }
    const exact = index.exact.get(pdfField);
    if (exact) return exact;
    const alias = index.loose.get(String(pdfField || "").replace(/\s+/g, "").toLowerCase()) || null;
    if (alias && mappedField) mappedField.resolvedPdfField = alias.getName();
    return alias;
  }

  // Same contract as the base class: true = written, false = not written (mappedField.renderError says why, when there is a reason).
  static setFormField(form, mappedField, formCode) {
    if (isProtectedField(mappedField.pdfField, formCode)) {
      mappedField.renderError = "protected field — never auto-populated (blocked at render layer)";
      return false;
    }
    const context = renderContext.getStore();
    const unplaced = (reason) => {
      if (context && context.unplaced.length < MAX_UNPLACED && significant(mappedField.value)) context.unplaced.push({ pdfField: mappedField.pdfField, caseField: mappedField.caseField, value: mappedField.value, reason });
    };
    const field = this.findField(form, mappedField.pdfField, mappedField);
    if (!field) { unplaced("pdf_field_missing"); return false; }

    let written = this.writeField(form, field, mappedField, context);
    if (written && !this.holdsValue(field, mappedField)) { // read it back: one more try, then report
      written = this.writeField(form, field, mappedField, context);
      if (written && !this.holdsValue(field, mappedField)) unplaced("readback_mismatch");
    }
    if (!written) {
      const error = String(mappedField.renderError || "");
      unplaced(!error ? "write_failed" : /not one of the choices/.test(error) ? "choice_not_available" : "write_failed");
    }
    return written;
  }

  static writeField(form, field, mappedField, context) {
    const value = mappedField.value;
    const constructorName = field.constructor?.name || "";
    try {
      if (constructorName.includes("CheckBox")) {
        value ? field.check() : field.uncheck();
        return true;
      }
      if (constructorName.includes("RadioGroup") || constructorName.includes("Dropdown") || constructorName.includes("OptionList")) {
        let choice = fitChoiceValue({ value, options: field.getOptions?.() || [] });
        if (choice.status === "empty") return true; // an empty answer just means "nothing selected"
        if (choice.status === "dropped" && !constructorName.includes("RadioGroup") && typeof field.addOptions === "function") {
          // not one of the printed choices: add it to the list so the entry is kept
          const wanted = (Array.isArray(value) ? value : [value]).map((item) => String(item ?? "").trim()).filter(Boolean);
          const existing = field.getOptions?.() || [];
          field.addOptions(wanted.filter((item) => !existing.includes(item)));
          const retry = fitChoiceValue({ value, options: field.getOptions?.() || [] });
          if (retry.status === "unchanged" || retry.status === "adjusted") {
            mappedField.adjustment = { from: wanted.join(", "), to: retry.values.join(", "), reason: "not one of the form's printed choices; added to the list so the entry is kept" };
            choice = { ...retry, status: "healed" };
          }
        }
        if (choice.status === "dropped") {
          mappedField.renderError = choice.reason;
          return false;
        }
        if (choice.status === "adjusted") {
          mappedField.adjustment = { from: String(Array.isArray(value) ? value[0] : value), to: choice.values.join(", "), reason: choice.reason };
        }
        if (constructorName.includes("OptionList")) field.select(choice.values);
        else field.select(choice.values[0]);
        return true;
      }
      // text box: fit the value (a limit is lifted by the base class before this runs; a value that cannot fit is kept whole)
      const fit = fitTextValue({ pdfField: mappedField.pdfField, value, maxLength: field.getMaxLength?.() });
      if (fit.status === "dropped") {
        mappedField.renderError = fit.reason;
        return false;
      }
      if (fit.status === "adjusted") mappedField.adjustment = { from: String(value), to: fit.value, reason: fit.reason };
      if (NOT_DRAWABLE.test(String(fit.value))) {
        // keep the exact text in the box but do not ask pdf-lib to draw it: drawing throws for these characters and would fail the whole save
        const { PDFHexString } = this.loadPdfLib();
        field.acroField.setValue(PDFHexString.fromText(String(fit.value)));
        if (context) context.notDrawable.push(mappedField.pdfField);
        return true;
      }
      field.setText(fit.value);
      return true;
    } catch (error) {
      mappedField.renderError = error.message;
      return false;
    }
  }

  // Does the box hold what was just written? Never throws; a box that cannot be read back counts as holding it.
  static holdsValue(field, mappedField) {
    const kind = field.constructor?.name || "";
    try {
      if (kind.includes("CheckBox")) return field.isChecked() === Boolean(mappedField.value);
      if (!significant(mappedField.value)) return true;
      const expected = mappedField.adjustment ? mappedField.adjustment.to : (Array.isArray(mappedField.value) ? mappedField.value.join(", ") : mappedField.value);
      if (kind.includes("TextField")) return clean(field.getText()) === clean(expected);
      if (kind.includes("RadioGroup") || kind.includes("Dropdown") || kind.includes("OptionList")) return [].concat(field.getSelected() || []).length > 0;
    } catch (_error) { /* cannot read it back */ }
    return true;
  }

  static async render(args) {
    const context = { unplaced: [], notDrawable: [] };
    const result = await renderContext.run(context, () => super.render(args));
    result.renderReport.unplacedWrites = context.unplaced;
    result.renderReport.notDisplayableFields = context.notDrawable;
    result.renderReport.appearanceFallback = context.notDrawable.length > 0;
    return result;
  }
}

module.exports = GuardedPDFRenderer;

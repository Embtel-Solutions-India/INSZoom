const {
  PDFCheckBox,
  PDFDropdown,
  PDFDocument,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
} = require("pdf-lib");
const crypto = require("crypto");
const _ = require("lodash");

const ANNOTATION_FLAGS = {
  invisible: 1,
  hidden: 2,
  noView: 32,
  readOnly: 64,
};

function asNumber(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : undefined;
}

function safeCall(fn, fallback) {
  try {
    const value = fn();
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

function normalizeToken(token = "") {
  return String(token)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/pt\s*([0-9]+)/i, "part $1")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function camelCase(value = "") {
  return _.camelCase(normalizeToken(value));
}

function normalizeSectionName(rawName = "", pageNumber) {
  const part = String(rawName).match(/(?:^|[^a-z0-9])(?:pt|part)[_\-. ]*0*([0-9]{1,2})/i);
  if (part) return `part${Number(part[1])}`;
  const supplement = String(rawName).match(/supp(?:lement)?[_\-. ]*([a-z0-9]+)/i);
  if (supplement) return `supplement${_.upperFirst(camelCase(supplement[1]))}`;
  const page = String(rawName).match(/(?:^|[^a-z0-9])p(?:age)?\s*0*([0-9]{1,2})/i);
  if (page) return `page${Number(page[1])}`;
  return pageNumber ? `page${pageNumber}` : "general";
}

function labelFromName(rawName = "") {
  const withoutPrefixes = String(rawName)
    .replace(/^form\d*\./i, "")
    .replace(/^(pt|part)[_\-. ]*0*[0-9]{1,2}[_\-. ]*/i, "")
    .replace(/^p(?:age)?\s*0*[0-9]{1,2}[_\-. ]*/i, "")
    .replace(/^line\s*[0-9a-z]+[_\-. ]*/i, "")
    .replace(/(?:^|[_\-. ])(?:txt|text|chk|check|radio|btn|field)(?:[_\-. ]|$)/gi, " ");
  return _.startCase(normalizeToken(withoutPrefixes || rawName)) || String(rawName);
}

function normalizeFieldId(rawName = "", index = 0, pageNumber) {
  const sectionId = normalizeSectionName(rawName, pageNumber);
  const cleaned = String(rawName)
    .replace(/^form\d*\./i, "")
    .replace(/^(pt|part)[_\-. ]*0*[0-9]{1,2}[_\-. ]*/i, "")
    .replace(/^p(?:age)?\s*0*[0-9]{1,2}[_\-. ]*/i, "")
    .replace(/^line\s*[0-9a-z]+[_\-. ]*/i, "")
    .replace(/(?:^|[_\-. ])(?:txt|text|chk|check|radio|btn|field)(?:[_\-. ]|$)/gi, " ");
  const normalized = camelCase(cleaned) || `field${index + 1}`;
  return `${sectionId}.${normalized}`;
}

function inferTextSemanticType(name = "", field) {
  const value = String(name).toLowerCase();
  if (/signature|sign here|sig_/.test(value)) return "signature";
  if (/initial/.test(value)) return "initial";
  if (/date|dob|birth|expiry|expires|issued|from|to/.test(value)) return "date";
  if (/email|e-mail/.test(value)) return "email";
  if (/phone|telephone|tel|mobile|cell|fax/.test(value)) return "phone";
  if (/currency|amount|fee|salary|wage|income|cost|price|dollar|\$/.test(value)) return "currency";
  if (/ssn|social security/.test(value)) return "ssn";
  if (/alien|a-number|anumber|a number/.test(value)) return "alienNumber";
  if (/receipt/.test(value)) return "uscisReceiptNumber";
  if (/passport/.test(value)) return "passport";
  if (/zip|postal|number|no$|apt|suite|floor|ein|tax id/.test(value)) return "number";
  return field?.isMultiline?.() ? "textarea" : "text";
}

function inferPdfFieldType(field) {
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFDropdown) return "dropdown";
  if (field instanceof PDFOptionList) return "multiselect";
  if (field instanceof PDFSignature) return "signature";
  if (field instanceof PDFTextField) return inferTextSemanticType(field.getName(), field);
  return field.constructor?.name?.replace(/^PDF/, "").replace(/Field$/, "").toLowerCase() || "text";
}

function actualPdfFieldType(field) {
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFDropdown) return "dropdown";
  if (field instanceof PDFOptionList) return "optionList";
  if (field instanceof PDFSignature) return "signature";
  if (field instanceof PDFTextField) return "text";
  return field.constructor?.name || "unknown";
}

function pageNumberForWidget(pdfDoc, widget) {
  const pageRef = safeCall(() => widget.P?.(), undefined);
  if (pageRef) {
    const index = pdfDoc.getPages().findIndex((page) => page.ref === pageRef);
    if (index >= 0) return index + 1;
  }
  const rectangle = safeCall(() => widget.getRectangle?.(), undefined);
  if (!rectangle) return undefined;
  return pdfDoc.getPages().findIndex((page) => {
    const { width, height } = page.getSize();
    return rectangle.x >= 0 && rectangle.y >= 0 && rectangle.x <= width && rectangle.y <= height;
  }) + 1 || undefined;
}

function parseDefaultAppearance(defaultAppearance = "") {
  const appearance = String(defaultAppearance || "");
  const fontMatch = appearance.match(/\/([A-Za-z0-9._-]+)\s+([\d.]+)\s+Tf/);
  const colorMatch = appearance.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/);
  return {
    raw: appearance || undefined,
    fontName: fontMatch?.[1],
    fontSize: fontMatch?.[2] ? Number(fontMatch[2]) : undefined,
    color: colorMatch ? colorMatch.slice(1, 4).map(Number) : undefined,
  };
}

// USCIS AcroForm PDFs carry a /TU (tooltip / "TU" = user name) entry on
// nearly every widget - confirmed empirically against the real seeded I-129
// template (980/980 fields had one, including the barcode field, whose /TU
// is just its own field name and is filtered out downstream). Checked on
// the widget annotation first (per-widget instruction, e.g. "Enter City or
// Town."), falling back to the field-level AcroField's own /TU (some PDFs
// only set it there) - never assumed present, always degrades to undefined.
function widgetTooltip(widget, acroField) {
  const widgetTu = safeCall(() => widget.dict.get(PDFName.of("TU"))?.decodeText?.(), undefined);
  if (widgetTu) return widgetTu;
  return safeCall(() => acroField?.dict.get(PDFName.of("TU"))?.decodeText?.(), undefined);
}

function extractWidget(pdfDoc, widget, index, acroField) {
  const rect = safeCall(() => widget.getRectangle?.(), {}) || {};
  const pageNumber = pageNumberForWidget(pdfDoc, widget);
  const page = pageNumber ? pdfDoc.getPage(pageNumber - 1) : undefined;
  const pageSize = page?.getSize?.();
  const flags = safeCall(() => widget.getFlags?.(), 0) || 0;
  const appearanceCharacteristics = safeCall(() => widget.getAppearanceCharacteristics?.(), undefined);
  const defaultAppearance = safeCall(() => widget.getDefaultAppearance?.(), undefined);
  const rotation = safeCall(() => appearanceCharacteristics?.getRotation?.(), page?.getRotation?.()?.angle || 0);
  const x = asNumber(rect.x);
  const y = asNumber(rect.y);
  const width = asNumber(rect.width);
  const height = asNumber(rect.height);
  return {
    widgetIndex: index,
    pageNumber,
    x,
    y,
    width,
    height,
    rotation: asNumber(rotation) || 0,
    boundingBox: {
      x,
      y,
      width,
      height,
      left: x,
      bottom: y,
      right: asNumber((rect.x || 0) + (rect.width || 0)),
      top: asNumber((rect.y || 0) + (rect.height || 0)),
    },
    coordinateSystem: {
      origin: "bottom-left",
      units: "pdf-points",
      pageWidth: asNumber(pageSize?.width),
      pageHeight: asNumber(pageSize?.height),
    },
    flags,
    hidden: Boolean(flags & (ANNOTATION_FLAGS.invisible | ANNOTATION_FLAGS.hidden | ANNOTATION_FLAGS.noView)),
    readOnly: Boolean(flags & ANNOTATION_FLAGS.readOnly),
    tooltip: widgetTooltip(widget, acroField),
    appearance: {
      ...parseDefaultAppearance(defaultAppearance),
      borderColor: safeCall(() => appearanceCharacteristics?.getBorderColor?.(), undefined),
      backgroundColor: safeCall(() => appearanceCharacteristics?.getBackgroundColor?.(), undefined),
      captions: safeCall(() => appearanceCharacteristics?.getCaptions?.(), undefined),
      appearanceState: safeCall(() => widget.getAppearanceState?.()?.decodeText?.() || widget.getAppearanceState?.()?.asString?.(), undefined),
      onValue: safeCall(() => widget.getOnValue?.()?.decodeText?.() || widget.getOnValue?.()?.asString?.(), undefined),
    },
  };
}

function extractWidgets(pdfDoc, field) {
  const widgets = safeCall(() => field.acroField?.getWidgets?.(), []) || [];
  return widgets.map((widget, index) => extractWidget(pdfDoc, widget, index, field.acroField));
}

function fieldOptions(field) {
  if (field instanceof PDFRadioGroup) {
    const options = safeCall(() => field.getOptions(), []);
    const exports = safeCall(() => field.acroField?.getExportValues?.()?.map((item) => item.decodeText?.() || item.asString?.() || String(item)), []);
    return options.map((option, index) => ({
      label: option,
      value: exports?.[index] || option,
      exportValue: exports?.[index] || option,
    }));
  }
  const options = safeCall(() => field.getOptions?.(), []);
  return (options || []).map((option) => ({ label: String(option), value: String(option), exportValue: String(option) }));
}

function defaultValue(field, type) {
  if (type === "checkbox") return safeCall(() => field.isChecked?.(), false);
  if (type === "radio" || type === "dropdown" || type === "multiselect") return safeCall(() => field.getSelected?.(), undefined);
  if (typeof field.getText === "function") return safeCall(() => field.getText(), undefined);
  return safeCall(() => field.acroField?.getValue?.()?.decodeText?.(), undefined);
}

function maxLength(field) {
  return safeCall(() => field.getMaxLength?.(), undefined);
}

function textFieldFlags(field) {
  if (!(field instanceof PDFTextField)) return {};
  return {
    multiline: safeCall(() => field.isMultiline?.(), false),
    password: safeCall(() => field.isPassword?.(), false),
    fileSelector: safeCall(() => field.isFileSelector?.(), false),
    spellCheck: safeCall(() => field.isSpellChecked?.(), undefined),
    scrollable: safeCall(() => field.isScrollable?.(), undefined),
    combed: safeCall(() => field.isCombed?.(), false),
    richText: safeCall(() => field.isRichFormatted?.(), false),
  };
}

function choiceFieldFlags(field) {
  if (!(field instanceof PDFDropdown) && !(field instanceof PDFOptionList)) return {};
  return {
    sorted: safeCall(() => field.isSorted?.(), false),
    multiselect: field instanceof PDFOptionList || safeCall(() => field.isMultiselect?.(), false),
    editable: safeCall(() => field.isEditable?.(), false),
    spellCheck: safeCall(() => field.isSpellChecked?.(), undefined),
    commitOnSelect: safeCall(() => field.isSelectOnClick?.(), undefined),
  };
}

function radioFieldFlags(field) {
  if (!(field instanceof PDFRadioGroup)) return {};
  return {
    mutuallyExclusive: safeCall(() => field.isMutuallyExclusive?.(), true),
    radiosInUnison: safeCall(() => field.isOffToggleable?.(), undefined) === false,
  };
}

function validationForField(field, type, fieldName) {
  const required = safeCall(() => field.isRequired?.(), false);
  const readOnly = safeCall(() => field.isReadOnly?.(), false);
  const max = maxLength(field);
  const validation = {
    required,
    readOnly,
  };
  if (max) validation.maxLength = max;
  if (["date"].includes(type)) validation.date = true;
  if (["number", "currency"].includes(type)) validation.numeric = true;
  if (type === "email") validation.regex = "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$";
  if (type === "phone") validation.regex = "^[0-9+()\\-\\s.]{7,}$";
  if (type === "ssn") validation.regex = "^(\\d{3}-?\\d{2}-?\\d{4})$";
  if (type === "alienNumber") validation.regex = "^A?\\d{7,9}$";
  if (type === "uscisReceiptNumber") validation.regex = "^[A-Z]{3}\\d{10}$";
  if (type === "passport") validation.regex = "^[A-Z0-9]{5,20}$";
  if (/zip|postal/i.test(fieldName)) validation.regex = "^[A-Z0-9\\-\\s]{3,12}$";
  return validation;
}

function detectGroupId(fieldName = "", fieldId = "", pageNumber) {
  const raw = String(fieldName);
  const sectionId = fieldId.split(".")[0] || normalizeSectionName(raw, pageNumber);
  const line = raw.match(/(?:line|ln)[_\-. ]*([0-9]+[a-z]?)/i) || raw.match(/(?:^|[^a-z0-9])l([0-9]+[a-z]?)(?:[^a-z0-9]|$)/i);
  if (line) return `${sectionId}.line${String(line[1]).toLowerCase()}`;
  const normalized = fieldId.split(".").slice(1).join(".");
  const root = normalized.replace(/[A-Z]?[a-z]*\d*$/g, "") || normalized.split(/[._-]/)[0] || "fields";
  return `${sectionId}.${camelCase(root) || "fields"}`;
}

function detectRepeatableKey(field = {}) {
  const source = `${field.fieldName || ""} ${field.fieldId || ""} ${field.label || ""}`.toLowerCase();
  const repeatableTerms = [
    "employment",
    "employer",
    "education",
    "school",
    "child",
    "children",
    "dependent",
    "address",
    "travel",
    "trip",
    "publication",
    "award",
    "membership",
    "patent",
    "spouse",
  ];
  const term = repeatableTerms.find((item) => source.includes(item));
  if (!term) return undefined;
  const index = source.match(/(?:^|[^0-9])([1-9][0-9]?)(?:[^0-9]|$)/)?.[1];
  return { key: term === "children" ? "child" : term, index: index ? Number(index) : undefined };
}

function inferDependencies(fields = []) {
  const dependencies = [];
  const byBase = new Map();
  fields.forEach((field) => {
    const base = String(field.normalizedName || field.fieldId || "")
      .replace(/(yes|no|other|explain|explanation|details|specify|describe)$/i, "")
      .replace(/[._-]+$/g, "");
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(field);
  });
  byBase.forEach((siblings) => {
    const trigger = siblings.find((field) => ["checkbox", "radio", "dropdown"].includes(field.type));
    if (!trigger) return;
    siblings
      .filter((field) => field.fieldId !== trigger.fieldId && /(explain|explanation|details|specify|describe|other)/i.test(`${field.fieldName} ${field.fieldId}`))
      .forEach((field) => {
        dependencies.push({
          type: "visibility",
          sourceFieldId: trigger.fieldId,
          targetFieldId: field.fieldId,
          condition: { operator: "hasValue", value: true },
          confidence: 0.7,
          reason: "Nearby explain/specify field shares the same PDF field stem.",
        });
      });
  });
  return dependencies;
}

function buildPages(pdfDoc, fields = []) {
  return pdfDoc.getPages().map((page, index) => {
    const { width, height } = page.getSize();
    const pageNumber = index + 1;
    const pageFields = fields.filter((field) => field.pageNumber === pageNumber);
    return {
      pageNumber,
      width: asNumber(width),
      height: asNumber(height),
      rotation: asNumber(page.getRotation?.()?.angle) || 0,
      coordinateSystem: { origin: "bottom-left", units: "pdf-points" },
      fieldIds: pageFields.map((field) => field.fieldId),
      fieldCount: pageFields.length,
      sectionIds: [...new Set(pageFields.map((field) => field.sectionId || "general"))],
      boundingBox: { x: 0, y: 0, width: asNumber(width), height: asNumber(height) },
    };
  });
}

function buildSections(fields = []) {
  const sections = new Map();
  fields.forEach((field) => {
    const sectionId = field.sectionId || "general";
    if (!sections.has(sectionId)) {
      sections.set(sectionId, {
        sectionId,
        key: sectionId,
        title: sectionId === "general" ? "General" : _.startCase(sectionId.replace(/^part/i, "Part ")),
        order: sections.size,
        fieldIds: [],
        fields: [],
        pages: new Set(),
        groups: new Set(),
        repeatable: false,
      });
    }
    const section = sections.get(sectionId);
    section.fieldIds.push(field.fieldId);
    section.fields.push(field.fieldId);
    section.groups.add(field.groupId);
    if (field.pageNumber) section.pages.add(field.pageNumber);
  });
  return [...sections.values()].map((section) => ({
    ...section,
    pages: [...section.pages].sort((a, b) => a - b),
    groups: [...section.groups].filter(Boolean),
    fieldCount: section.fieldIds.length,
  }));
}

function buildGroups(fields = []) {
  const groups = new Map();
  fields.forEach((field) => {
    const groupId = field.groupId || `${field.sectionId || "general"}.fields`;
    if (!groups.has(groupId)) {
      groups.set(groupId, {
        groupId,
        sectionId: field.sectionId || "general",
        title: _.startCase(groupId.split(".").pop()),
        fieldIds: [],
        pages: new Set(),
        order: groups.size,
        repeatable: false,
      });
    }
    const group = groups.get(groupId);
    group.fieldIds.push(field.fieldId);
    if (field.pageNumber) group.pages.add(field.pageNumber);
    if (field.repeatable) group.repeatable = true;
  });
  return [...groups.values()].map((group) => ({
    ...group,
    pages: [...group.pages].sort((a, b) => a - b),
    fieldCount: group.fieldIds.length,
  }));
}

function buildRepeatableGroups(fields = []) {
  const buckets = new Map();
  fields.forEach((field) => {
    if (!field.repeatableConfig?.key) return;
    const key = `${field.sectionId || "general"}.${field.repeatableConfig.key}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        repeatableGroupId: key,
        key: field.repeatableConfig.key,
        sectionId: field.sectionId || "general",
        fieldIds: [],
        detectedIndexes: new Set(),
        minItems: 0,
        maxItems: undefined,
      });
    }
    const bucket = buckets.get(key);
    bucket.fieldIds.push(field.fieldId);
    if (field.repeatableConfig.index) bucket.detectedIndexes.add(field.repeatableConfig.index);
  });
  return [...buckets.values()].map((group) => ({
    ...group,
    detectedIndexes: [...group.detectedIndexes].sort((a, b) => a - b),
    maxItems: group.detectedIndexes.size || undefined,
    fieldCount: group.fieldIds.length,
  }));
}

function buildFieldIndexes(fields = []) {
  return {
    byFieldId: Object.fromEntries(fields.map((field) => [field.fieldId, field.order])),
    byPdfName: Object.fromEntries(fields.map((field) => [field.fieldName, field.order])),
    byNormalizedName: fields.reduce((acc, field) => {
      acc[field.normalizedName] = acc[field.normalizedName] || [];
      acc[field.normalizedName].push(field.fieldId);
      return acc;
    }, {}),
    bySection: fields.reduce((acc, field) => {
      acc[field.sectionId] = acc[field.sectionId] || [];
      acc[field.sectionId].push(field.fieldId);
      return acc;
    }, {}),
    byPage: fields.reduce((acc, field) => {
      acc[field.pageNumber] = acc[field.pageNumber] || [];
      acc[field.pageNumber].push(field.fieldId);
      return acc;
    }, {}),
    byType: fields.reduce((acc, field) => {
      acc[field.type] = acc[field.type] || [];
      acc[field.type].push(field.fieldId);
      return acc;
    }, {}),
  };
}

function fieldFingerprint(fields = []) {
  const stable = fields.map((field) => ({
    fieldName: field.fieldName,
    fieldId: field.fieldId,
    type: field.type,
    pageNumber: field.pageNumber,
    x: field.coordinates?.x,
    y: field.coordinates?.y,
    width: field.width,
    height: field.height,
    options: field.options?.map((option) => option.value || option.label),
  }));
  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function duplicateNames(fields = [], property) {
  const seen = new Set();
  const duplicates = new Set();
  fields.forEach((field) => {
    const value = field[property];
    if (!value) return;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  });
  return [...duplicates];
}

class PDFFieldScannerService {
  async scan(buffer) {
    const warnings = [];
    const errors = [];
    let pdfDoc;
    try {
      pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
    } catch (error) {
      error.code = error.code || "PDF_SCAN_LOAD_FAILED";
      throw error;
    }

    const form = safeCall(() => pdfDoc.getForm(), undefined);
    const rawFields = safeCall(() => form?.getFields?.(), []) || [];
    if (!rawFields.length) warnings.push({ code: "NO_ACROFORM_FIELDS", message: "No fillable AcroForm metadata was detected; manual parser review is required." });
    const usedIds = new Map();

    const fields = rawFields.map((field, index) => {
      try {
        const fieldName = field.getName();
        const widgets = extractWidgets(pdfDoc, field);
        const primaryWidget = widgets[0] || {};
        const pageNumber = primaryWidget.pageNumber || 1;
        const type = inferPdfFieldType(field);
        const baseFieldId = normalizeFieldId(fieldName, index, pageNumber);
        const duplicateIndex = usedIds.get(baseFieldId) || 0;
        usedIds.set(baseFieldId, duplicateIndex + 1);
        const fieldId = duplicateIndex ? `${baseFieldId}_${duplicateIndex + 1}` : baseFieldId;
        const sectionId = fieldId.split(".")[0] || normalizeSectionName(fieldName, pageNumber);
        const normalizedName = fieldId.split(".").slice(1).join(".") || camelCase(fieldName);
        const repeatableConfig = detectRepeatableKey({ fieldName, fieldId, label: labelFromName(fieldName) });
        const validation = validationForField(field, type, fieldName);
        const options = fieldOptions(field);
        const appearance = {
          ...parseDefaultAppearance(safeCall(() => field.acroField?.getDefaultAppearance?.(), undefined)),
          widgets: widgets.map((widget) => widget.appearance).filter(Boolean),
        };
        const exportValue = safeCall(() => field.acroField?.getExportValues?.()?.map((value) => value.decodeText?.() || value.asString?.() || String(value)), undefined);
        const importValue = safeCall(() => field.acroField?.getValue?.()?.decodeText?.() || field.acroField?.getValue?.()?.asString?.(), undefined);
        const hidden = widgets.some((widget) => widget.hidden);
        const readOnly = Boolean(validation.readOnly || widgets.some((widget) => widget.readOnly));
        const pdfFieldType = actualPdfFieldType(field);
        const reviewReasons = [];
        if (pdfFieldType === "unknown") reviewReasons.push("unknown_pdf_field_type");
        if (!widgets.length) reviewReasons.push("field_has_no_widget_coordinates");
        const confidence = Math.max(0.4, 0.98 - (reviewReasons.length * 0.2));
        return {
          id: crypto.createHash("sha1").update(`${fieldName}:${index}`).digest("hex"),
          fieldId,
          uniqueId: fieldId,
          fieldName,
          originalName: fieldName,
          pdfFieldName: fieldName,
          normalizedName,
          normalizedPath: fieldId,
          type,
          fieldType: type,
          pdfFieldType,
          semanticType: type,
          label: labelFromName(fieldName),
          fieldLabel: labelFromName(fieldName),
          tooltip: primaryWidget.tooltip,
          sectionId,
          sectionKey: sectionId,
          sectionTitle: sectionId === "general" ? "General" : _.startCase(sectionId.replace(/^part/i, "Part ")),
          subsectionId: detectGroupId(fieldName, fieldId, pageNumber),
          groupId: detectGroupId(fieldName, fieldId, pageNumber),
          parentGroup: detectGroupId(fieldName, fieldId, pageNumber),
          pageNumber,
          required: Boolean(validation.required),
          optional: !validation.required,
          readOnly,
          hidden,
          calculated: false,
          defaultValue: defaultValue(field, type),
          currentValue: defaultValue(field, type),
          options,
          validation,
          validationRules: validation,
          validationNotes: Object.entries(validation).filter(([, value]) => value !== false && value !== undefined).map(([rule, value]) => ({ rule, value, source: "pdf_acroform" })),
          dependencies: [],
          conditionalLogic: {},
          showWhen: {},
          coordinates: {
            x: primaryWidget.x,
            y: primaryWidget.y,
            width: primaryWidget.width,
            height: primaryWidget.height,
            pageNumber,
            boundingBox: primaryWidget.boundingBox,
            coordinateSystem: primaryWidget.coordinateSystem,
          },
          position: {
            x: primaryWidget.x,
            y: primaryWidget.y,
            width: primaryWidget.width,
            height: primaryWidget.height,
          },
          widgets,
          width: primaryWidget.width,
          height: primaryWidget.height,
          rotation: primaryWidget.rotation || 0,
          boundingBox: primaryWidget.boundingBox,
          coordinateSystem: primaryWidget.coordinateSystem,
          tabOrder: index + 1,
          order: index,
          font: {
            name: appearance.fontName,
            size: appearance.fontSize,
          },
          appearance,
          exportValue,
          importValue,
          pdfFlags: safeCall(() => field.acroField?.getFlags?.(), 0),
          textFieldFlags: textFieldFlags(field),
          choiceFieldFlags: choiceFieldFlags(field),
          radioFieldFlags: radioFieldFlags(field),
          repeatable: Boolean(repeatableConfig),
          repeatableConfig,
          signatureArea: type === "signature",
          extraction: {
            source: "pdf_acroform",
            usedOcr: false,
            confidence,
            labelConfidence: 0.75,
            status: reviewReasons.length ? "needs_review" : "parsed",
            reviewReasons,
          },
          mappings: [],
          mapping: {},
          searchableText: `${fieldName} ${labelFromName(fieldName)} ${fieldId} ${type} ${sectionId}`.toLowerCase(),
        };
      } catch (error) {
        errors.push({ index, message: error.message });
        return null;
      }
    }).filter(Boolean);

    const dependencies = inferDependencies(fields);
    const dependencyMap = dependencies.reduce((acc, dependency) => {
      acc[dependency.targetFieldId] = acc[dependency.targetFieldId] || [];
      acc[dependency.targetFieldId].push(dependency);
      return acc;
    }, {});
    fields.forEach((field) => {
      field.dependencies = dependencyMap[field.fieldId] || [];
      if (field.dependencies.length) {
        field.showWhen = field.dependencies[0].condition;
        field.conditionalLogic = {
          source: "inferred_from_pdf_field_relationship",
          confidence: field.dependencies[0].confidence,
          requiresReview: true,
          ...field.dependencies[0].condition,
        };
        field.extraction.status = "needs_review";
        field.extraction.reviewReasons = [...new Set([...(field.extraction.reviewReasons || []), "conditional_logic_inferred"])];
      }
    });

    const pages = buildPages(pdfDoc, fields);
    const sections = buildSections(fields);
    const groups = buildGroups(fields);
    const repeatableGroups = buildRepeatableGroups(fields);
    const fieldIndexes = buildFieldIndexes(fields);
    const duplicateFieldNames = duplicateNames(fields, "fieldName");
    const duplicateFieldIds = duplicateNames(fields, "fieldId");
    if (duplicateFieldNames.length) warnings.push({ code: "DUPLICATE_PDF_FIELD_NAMES", names: duplicateFieldNames });
    if (duplicateFieldIds.length) warnings.push({ code: "DUPLICATE_NORMALIZED_FIELD_IDS", names: duplicateFieldIds });
    fields.forEach((field) => {
      if (duplicateFieldNames.includes(field.fieldName) || duplicateFieldIds.includes(field.fieldId)) {
        field.extraction.status = "needs_review";
        field.extraction.reviewReasons = [...new Set([...(field.extraction.reviewReasons || []), "duplicate_field_identity"])];
      }
    });
    const reviewItems = fields
      .filter((field) => field.extraction?.status === "needs_review")
      .map((field) => ({
        fieldId: field.fieldId,
        fieldName: field.fieldName,
        pageNumber: field.pageNumber,
        reasons: field.extraction.reviewReasons,
        confidence: field.extraction.confidence,
      }));
    if (!fields.length) reviewItems.push({
      code: "NO_ACROFORM_FIELDS",
      scope: "form",
      reasons: ["no_fillable_acroform_fields"],
      confidence: 0,
    });
    errors.forEach((error) => reviewItems.push({ fieldIndex: error.index, reasons: ["field_parse_failed"], message: error.message, confidence: 0 }));
    const overallConfidence = fields.length
      ? Number((fields.reduce((sum, field) => sum + Number(field.extraction?.confidence || 0), 0) / fields.length).toFixed(4))
      : 0;

    const layout = {
      pages,
      sections,
      groups,
      repeatableGroups,
      coordinateSystem: { origin: "bottom-left", units: "pdf-points" },
      fieldCount: fields.length,
      pageCount: pdfDoc.getPageCount(),
    };

    const structure = {
      form: {
        pageCount: pdfDoc.getPageCount(),
        fieldCount: fields.length,
      },
      pages,
      parts: sections,
      sections,
      subsections: groups,
      groups,
      repeatableGroups,
      dependencies,
      questions: fields.map((field) => ({
        fieldId: field.fieldId,
        fieldName: field.fieldName,
        label: field.label,
        type: field.type,
        fieldType: field.type,
        required: field.required,
        optional: field.optional,
        sectionId: field.sectionId,
        subsectionId: field.subsectionId,
        pageNumber: field.pageNumber,
        options: field.options,
        validationNotes: field.validationNotes,
        conditionalLogic: field.conditionalLogic,
        repeatable: field.repeatable,
        signatureArea: field.signatureArea,
        extraction: field.extraction,
      })),
      indexes: fieldIndexes,
    };

    return {
      pageCount: pdfDoc.getPageCount(),
      fields,
      fieldCount: fields.length,
      fieldFingerprint: fieldFingerprint(fields),
      duplicateNames: duplicateFieldNames,
      duplicateFieldIds,
      layout,
      structure,
      pages,
      sections,
      groups,
      repeatableGroups,
      dependencies,
      reviewItems,
      confidence: overallConfidence,
      parserStatus: reviewItems.length || warnings.length || errors.length ? "needs_review" : "parsed",
      usedOcr: false,
      validation: {
        requiredFields: fields.filter((field) => field.required).map((field) => field.fieldId),
        readOnlyFields: fields.filter((field) => field.readOnly).map((field) => field.fieldId),
        hiddenFields: fields.filter((field) => field.hidden).map((field) => field.fieldId),
        rulesByField: Object.fromEntries(fields.map((field) => [field.fieldId, field.validationRules || {}])),
      },
      indexes: fieldIndexes,
      warnings,
      errors,
      scannedAt: new Date(),
    };
  }
}

module.exports = PDFFieldScannerService;

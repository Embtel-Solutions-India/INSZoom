const COUNTRY_NAMES = {
  usa: "United States",
  us: "United States",
  "united states": "United States",
  india: "India",
  canada: "Canada",
  mexico: "Mexico",
  china: "China",
  uk: "United Kingdom",
  "united kingdom": "United Kingdom",
};

class MappingResolver {
  static normalizePath(path = "") {
    return String(path).replace(/\[(\d+)\]/g, ".$1").replace(/^\./, "");
  }

  static resolvePath(source, path, defaultValue = undefined) {
    if (!path) return source ?? defaultValue;
    const normalizedPath = this.normalizePath(path);
    return normalizedPath.split(".").reduce((current, segment) => {
      if (current === null || current === undefined) return defaultValue;
      return current[segment] !== undefined ? current[segment] : defaultValue;
    }, source);
  }

  static setPath(target, path, value) {
    const segments = this.normalizePath(path).split(".").filter(Boolean);
    if (!segments.length) return target;
    let cursor = target;
    segments.forEach((segment, index) => {
      if (index === segments.length - 1) {
        cursor[segment] = value;
        return;
      }
      const nextSegment = segments[index + 1];
      if (cursor[segment] === undefined || cursor[segment] === null) {
        cursor[segment] = /^\d+$/.test(nextSegment) ? [] : {};
      }
      cursor = cursor[segment];
    });
    return target;
  }

  static isEmpty(value) {
    return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
  }

  static resolveDefaultValue(mapping = {}) {
    if (mapping.defaultValue !== undefined) return mapping.defaultValue;
    if (mapping.default !== undefined) return mapping.default;
    if (mapping.staticValue !== undefined) return mapping.staticValue;
    return undefined;
  }

  static resolveArrayValue(canonicalData, path, index = 0) {
    const value = this.resolvePath(canonicalData, path);
    if (!Array.isArray(value)) return undefined;
    return value[index];
  }

  static compare(left, operator, right) {
    switch (operator || "equals") {
      case "not_equals":
      case "!=":
        return left !== right;
      case "in":
        return Array.isArray(right) && right.includes(left);
      case "not_in":
        return Array.isArray(right) && !right.includes(left);
      case "exists":
      case "hasValue":
        return !this.isEmpty(left);
      case "empty":
        return this.isEmpty(left);
      case "gt":
      case ">":
        return Number(left) > Number(right);
      case "gte":
      case ">=":
        return Number(left) >= Number(right);
      case "lt":
      case "<":
        return Number(left) < Number(right);
      case "lte":
      case "<=":
        return Number(left) <= Number(right);
      case "contains":
        return Array.isArray(left) ? left.includes(right) : String(left || "").includes(String(right));
      case "equals":
      case "==":
      default:
        return left === right;
    }
  }

  static resolveConditionalRule(rule, canonicalData, filledData = {}) {
    if (!rule) return true;
    if (Array.isArray(rule.all)) return rule.all.every((item) => this.resolveConditionalRule(item, canonicalData, filledData));
    if (Array.isArray(rule.any)) return rule.any.some((item) => this.resolveConditionalRule(item, canonicalData, filledData));

    const path = rule.field || rule.source || rule.path || rule.sourceFieldId || rule.questionKey;
    const scope = path?.startsWith("filledData.") ? { filledData } : canonicalData;
    const normalizedPath = path?.replace(/^canonicalData\./, "").replace(/^filledData\./, "");
    const currentValue = this.resolvePath(scope, normalizedPath);
    return this.compare(currentValue, rule.operator, rule.value);
  }

  static formatDate(value, format = "yyyy-mm-dd") {
    if (!value) return value;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const yyyy = String(date.getUTCFullYear());
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    if (format === "mm/dd/yyyy") return `${mm}/${dd}/${yyyy}`;
    if (format === "dd/mm/yyyy") return `${dd}/${mm}/${yyyy}`;
    return `${yyyy}-${mm}-${dd}`;
  }

  static calculateAge(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    const now = new Date();
    let age = now.getUTCFullYear() - date.getUTCFullYear();
    const monthDelta = now.getUTCMonth() - date.getUTCMonth();
    if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < date.getUTCDate())) age -= 1;
    return age;
  }

  static calculateYearsOfExperience(employmentHistory = []) {
    return employmentHistory.reduce((total, job) => {
      const start = new Date(job.startDate);
      const end = job.current ? new Date() : new Date(job.endDate);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return total;
      return total + Math.max(0, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
    }, 0);
  }

  static resolveDerivedValue(mapping = {}, canonicalData) {
    const transform = mapping.transform && typeof mapping.transform === "object" ? mapping.transform : {};
    const type = mapping.derived || mapping.derivedType || transform.type || mapping.transform;
    const config = { ...mapping, ...transform };
    if (!type) return undefined;
    if (type === "fullName" || type === "concat") {
      const fields = config.fields || ["beneficiary.firstName", "beneficiary.middleName", "beneficiary.lastName"];
      return fields.map((field) => this.resolvePath(canonicalData, field)).filter(Boolean).join(" ").trim();
    }
    if (type === "age") return this.calculateAge(this.resolvePath(canonicalData, config.source || config.path || "beneficiary.dateOfBirth"));
    if (type === "yearsOfExperience") return Math.round(this.calculateYearsOfExperience(this.resolvePath(canonicalData, config.source || "employmentHistory", [])));
    if (type === "countryName") {
      const value = this.resolvePath(canonicalData, config.source || config.path);
      return COUNTRY_NAMES[String(value || "").toLowerCase()] || value;
    }
    if (type === "dateFormat") return this.formatDate(this.resolvePath(canonicalData, config.source || config.path), config.format);
    if (["checkbox", "radio", "dropdown"].includes(type)) {
      const value = this.resolvePath(canonicalData, config.source || config.path);
      if (config.value !== undefined) return value === config.value;
      if (config.optionsMap && Object.prototype.hasOwnProperty.call(config.optionsMap, value)) return config.optionsMap[value];
      return value;
    }
    return undefined;
  }

  static applyTransform(value, mapping = {}, canonicalData) {
    const transform = mapping.transform && typeof mapping.transform === "object"
      ? mapping.transform
      : { type: mapping.transform };
    switch (transform.type) {
      case "date":
      case "dateFormat":
        return this.formatDate(value, transform.format || "mm/dd/yyyy");
      case "boolean":
        return Boolean(value);
      case "checkbox":
        if (transform.value !== undefined) return value === transform.value;
        if (transform.optionsMap && Object.prototype.hasOwnProperty.call(transform.optionsMap, value)) return transform.optionsMap[value];
        return Boolean(value);
      case "arrayItem": {
        const collection = this.resolvePath(canonicalData, transform.collection || mapping.sourceField || mapping.path);
        if (!Array.isArray(collection)) return value;
        const index = Number(mapping.repeatIndex ?? transform.index ?? 0);
        const item = collection[index];
        return transform.itemPath ? this.resolvePath(item, transform.itemPath) : item;
      }
      case "uppercase":
        return String(value ?? "").toUpperCase();
      case "lowercase":
        return String(value ?? "").toLowerCase();
      // Phase 4 (§I.3) - semantic-type format transforms. Each is opt-in per crosswalk edge
      // (transform.type must be set explicitly) - see docs/forms/PHASE4_BASELINE.md for which
      // real I-129 fields were and were NOT wired to these, and why: the standard USCIS-citation
      // dashed/prefixed formats below do not fit every widget's own validationRules (confirmed
      // empirically, not assumed - see the ledger). Only wire an edge to one of these after
      // checking that field's own maxLength/regex accepts the formatted output.
      case "ssn":
        // xxx-xx-xxxx. Only reformats a clean 9-digit value; anything else (already dashed,
        // partial, non-numeric) passes through unchanged rather than producing a malformed value.
        if (typeof value === "string") {
          const digits = value.replace(/\D/g, "");
          if (digits.length === 9) return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
        }
        return value;
      case "alienNumber":
        // A-xxxxxxxxx (9-digit number, A- prefix added if absent). Do not wire this to a widget
        // whose own pre-printed "A-"/maxLength can't accommodate the added prefix (e.g. I-129's
        // Line1_AlienNumber/Line10_AlienNumber - confirmed via their real validationRules
        // (`^A?\d{7,9}$`, maxLength 9) - a prefixed value would overflow and fail their own
        // validation; those stay MANUAL_ENTRY, see the ledger).
        if (typeof value === "string") {
          const digits = value.replace(/\D/g, "");
          if (digits.length === 9) return `A-${digits}`;
          if (digits.length > 0) return `A-${digits.padStart(9, "0")}`;
        }
        return value;
      case "uscisReceiptNumber":
        // XXX-xx-xxx-xxxxxx - already formatted at the source in every confirmed case; pass through.
        return value;
      case "phone":
        // (xxx) xxx-xxxx. Confirmed to fit real I-129 phone widgets (maxLength 15, regex allows
        // digits/+/()/-/space/period) before being wired to any edge - see the ledger.
        if (typeof value === "string") {
          const digits = value.replace(/\D/g, "");
          if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
          if (digits.length === 11 && digits[0] === "1") return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
        }
        return value;
      case "direct":
      case undefined:
      case "":
        return value;
      default:
        return value;
    }
  }

  static getSourcePath(mapping = {}) {
    if (mapping.sourceField) return mapping.sourceField;
    if (mapping.source === "canonical") return mapping.path || mapping.source;
    if (mapping.path && mapping.source && !String(mapping.path).startsWith(`${mapping.source}.`)) return `${mapping.source}.${mapping.path}`;
    if (mapping.path) return mapping.path;
    if (mapping.source) return mapping.source;
    return "";
  }

  static resolveMapping(mapping = {}, canonicalData, context = {}) {
    const warnings = [];
    if (mapping.condition && !this.resolveConditionalRule(mapping.condition, canonicalData, context.filledData)) {
      return { value: undefined, skipped: true, warnings };
    }

    let value = this.resolveDerivedValue(mapping, canonicalData);
    const sourceField = this.getSourcePath(mapping);
    if (value === undefined && sourceField) value = this.resolvePath(canonicalData, sourceField);
    if (value === undefined) value = this.resolveDefaultValue(mapping);
    if (value === undefined && mapping.fallback) value = this.resolvePath(canonicalData, mapping.fallback);
    if (value !== undefined) value = this.applyTransform(value, mapping, canonicalData);
    if (value === undefined) warnings.push({ code: "MISSING_SOURCE_VALUE", sourceField });

    return {
      value,
      source: mapping.source || sourceField.split(".")[0] || "default",
      sourceField,
      confidence: mapping.confidence || this.resolvePath(canonicalData, `${sourceField}.__confidence`) || 100,
      warnings,
    };
  }
}

module.exports = MappingResolver;

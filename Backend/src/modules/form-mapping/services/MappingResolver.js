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

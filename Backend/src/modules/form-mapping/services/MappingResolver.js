const AddressParser = require("./AddressParser");

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

  // Splits a calendar-date STRING without round-tripping it through Date, so
  // the result never depends on the server's timezone: "2020-01-15" and
  // "2020-01-15T00:00:00Z" (ISO) and "01/15/2020" (US) all keep their own
  // calendar day. (new Date("01/15/2020") is LOCAL midnight; reading it back
  // with getUTC* shifted the day for any server east of UTC.) Returns null
  // for anything else so the Date fallback below handles it as before.
  static calendarParts(value) {
    if (typeof value !== "string") return null;
    const text = value.trim();
    let match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(text);
    if (match) return { yyyy: match[1], mm: match[2], dd: match[3] };
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (match) return { yyyy: match[3], mm: match[1].padStart(2, "0"), dd: match[2].padStart(2, "0") };
    return null;
  }

  static formatDate(value, format = "yyyy-mm-dd") {
    if (!value) return value;
    let parts = this.calendarParts(value);
    if (!parts) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      parts = {
        yyyy: String(date.getUTCFullYear()),
        mm: String(date.getUTCMonth() + 1).padStart(2, "0"),
        dd: String(date.getUTCDate()).padStart(2, "0"),
      };
    }
    const { yyyy, mm, dd } = parts;
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
      // --- Family (K-1/K-3) crosswalk transforms. Each is opt-in per edge. ---
      // Digits only: SSN / A-Number widgets are maxLength 9 with the "A-" /
      // dashes pre-printed, so "111-22-3333" / "A123456789" would overflow
      // and be dropped (left blank) by FieldValueFitter at render time.
      case "digits": {
        const digits = String(value ?? "").replace(/\D/g, "");
        return digits || undefined;
      }
      // Part of ONE free-text address answer - see AddressParser (never
      // guesses; returns undefined when the text does not show the part).
      case "address":
        return AddressParser.addressPart(value, transform.part);
      // "USA" / "U.S." -> "United States" (other names pass through unchanged).
      case "country":
        return AddressParser.canonicalCountry(value);
      // "City, Country" answer -> city or country.
      case "cityCountry": {
        const parsed = AddressParser.parseCityCountry(value);
        return parsed ? parsed[transform.part] : undefined;
      }
      // A US-state dropdown only ever receives a recognised US state, and
      // only when the row's country (if any) is the United States - a
      // foreign province never lands in the State dropdown.
      case "usState": {
        if (transform.countryPath) {
          const country = this.resolvePath(canonicalData, transform.countryPath);
          if (!this.isEmpty(country) && !AddressParser.isUsCountry(country)) return undefined;
        }
        return AddressParser.stateCode(value);
      }
      // ...and the free-text Province widget only receives what is NOT a US
      // state of a US row.
      case "nonUsProvince": {
        const country = transform.countryPath ? this.resolvePath(canonicalData, transform.countryPath) : undefined;
        if (!this.isEmpty(country)) return AddressParser.isUsCountry(country) ? undefined : value;
        return AddressParser.stateCode(value) ? undefined : value;
      }
      // "5, 8" / "5 and 8" -> nth item (children's ages on I-129F Pt1 49).
      case "listItem": {
        const items = String(value ?? "").split(/\s*(?:,|;|\band\b|&)\s*/i).map((item) => item.trim()).filter(Boolean);
        return items[Number(transform.index ?? 0)];
      }
      // A fixed value, emitted only when the edge's own condition passed
      // (e.g. relationship "Child" beside a listed child's name).
      case "constant":
        return transform.value;
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
    if (this.isEmpty(value) && mapping.fallback) value = this.resolvePath(canonicalData, mapping.fallback);
    if (value !== undefined) value = this.applyTransform(value, mapping, canonicalData);
    if (value === undefined) warnings.push({ code: "MISSING_SOURCE_VALUE", sourceField });

    return {
      value,
      source: mapping.source || sourceField.split(".")[0] || "default",
      sourceField,
      profileOwner: mapping.profileOwner,
      allowsOccurrenceOverride: mapping.allowsOccurrenceOverride === true,
      confidence: mapping.confidence || this.resolvePath(canonicalData, `${sourceField}.__confidence`) || 100,
      warnings,
    };
  }
}

module.exports = MappingResolver;

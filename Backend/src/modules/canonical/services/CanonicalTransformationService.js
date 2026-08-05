const MappingResolver = require("../../form-mapping/services/MappingResolver");

const COUNTRY_NAMES = {
  us: "United States",
  usa: "United States",
  "u.s.": "United States",
  "united states": "United States",
  india: "India",
  canada: "Canada",
  mexico: "Mexico",
  china: "China",
  "united kingdom": "United Kingdom",
  uk: "United Kingdom",
};

const GENDER_MAP = {
  m: "male",
  male: "male",
  f: "female",
  female: "female",
  x: "other",
  other: "other",
};

class CanonicalTransformationService {
  static isEmpty(value) {
    return MappingResolver.isEmpty(value);
  }

  static cleanString(value) {
    if (value === undefined || value === null) return value;
    return String(value).replace(/\s+/g, " ").trim();
  }

  static name(value) {
    const cleaned = this.cleanString(value);
    if (!cleaned) return cleaned;
    return cleaned.split(" ").map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part).join(" ");
  }

  static email(value) {
    return this.cleanString(value)?.toLowerCase();
  }

  static phone(value) {
    const cleaned = this.cleanString(value);
    if (!cleaned) return cleaned;
    const hasPlus = cleaned.startsWith("+");
    const digits = cleaned.replace(/[^\d]/g, "");
    if (!digits) return cleaned;
    if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    return `${hasPlus ? "+" : ""}${digits}`;
  }

  static date(value, output = "iso") {
    if (!value) return value;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const yyyy = String(date.getUTCFullYear());
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    if (output === "uscis" || output === "us") return `${mm}/${dd}/${yyyy}`;
    return `${yyyy}-${mm}-${dd}`;
  }

  static country(value) {
    const cleaned = this.cleanString(value);
    if (!cleaned) return cleaned;
    return COUNTRY_NAMES[cleaned.toLowerCase()] || cleaned;
  }

  static state(value) {
    return this.cleanString(value)?.toUpperCase();
  }

  static passportNumber(value) {
    return this.cleanString(value)?.replace(/\s+/g, "").toUpperCase();
  }

  static receiptNumber(value) {
    return this.cleanString(value)?.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  }

  static alienNumber(value) {
    const cleaned = this.cleanString(value)?.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    if (!cleaned) return cleaned;
    return cleaned.startsWith("A") ? cleaned : `A${cleaned}`;
  }

  static boolean(value) {
    if (typeof value === "boolean") return value;
    const normalized = String(value || "").trim().toLowerCase();
    if (["yes", "true", "1", "y"].includes(normalized)) return true;
    if (["no", "false", "0", "n"].includes(normalized)) return false;
    return value;
  }

  static gender(value) {
    const cleaned = this.cleanString(value)?.toLowerCase();
    return GENDER_MAP[cleaned] || cleaned || value;
  }

  static normalizeByPath(path, value) {
    if (this.isEmpty(value)) return value;
    const normalizedPath = String(path || "").toLowerCase();
    if (/(firstname|middlename|lastname|name)$/.test(normalizedPath)) return this.name(value);
    if (/email/.test(normalizedPath)) return this.email(value);
    if (/phone|mobile|telephone/.test(normalizedPath)) return this.phone(value);
    if (/date|dob|expires|expiration|issued|birth/.test(normalizedPath)) return this.date(value);
    if (/country|citizenship|nationality/.test(normalizedPath)) return this.country(value);
    if (/(^|\.)(state|province)$/.test(normalizedPath)) return this.state(value);
    if (/passport.*number|passportnumber/.test(normalizedPath)) return this.passportNumber(value);
    if (/receipt/.test(normalizedPath)) return this.receiptNumber(value);
    if (/alien|a-number|anumber/.test(normalizedPath)) return this.alienNumber(value);
    if (/gender|sex/.test(normalizedPath)) return this.gender(value);
    if (/^(is|has|can|should)|\.is|\.has/.test(normalizedPath)) return this.boolean(value);
    return typeof value === "string" ? this.cleanString(value) : value;
  }

  static transformProfile(profile = {}) {
    const transformed = {};
    const visit = (value, path = "") => {
      if (Array.isArray(value)) return value.map((item, index) => visit(item, `${path}.${index}`));
      if (value && typeof value === "object" && !(value instanceof Date)) {
        return Object.entries(value).reduce((acc, [key, item]) => {
          acc[key] = visit(item, path ? `${path}.${key}` : key);
          return acc;
        }, {});
      }
      return this.normalizeByPath(path, value);
    };
    Object.entries(profile || {}).forEach(([key, value]) => {
      transformed[key] = visit(value, key);
    });
    return transformed;
  }

  static uscisDate(value) {
    return this.date(value, "uscis");
  }
}

module.exports = CanonicalTransformationService;

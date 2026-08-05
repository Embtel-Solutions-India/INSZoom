class CanonicalComparisonService {
  static flatten(value, prefix = "", output = {}) {
    if (Array.isArray(value)) {
      output[prefix] = value;
      return output;
    }
    if (value && typeof value === "object" && !(value instanceof Date)) {
      Object.entries(value).forEach(([key, item]) => this.flatten(item, prefix ? `${prefix}.${key}` : key, output));
      return output;
    }
    output[prefix] = value;
    return output;
  }

  static compare(previous = {}, next = {}) {
    const left = this.flatten(previous);
    const right = this.flatten(next);
    const paths = [...new Set([...Object.keys(left), ...Object.keys(right)])].filter(Boolean);
    const added = [];
    const removed = [];
    const modified = [];
    paths.forEach((path) => {
      const before = left[path];
      const after = right[path];
      if (before === undefined && after !== undefined) added.push({ path, value: after });
      else if (before !== undefined && after === undefined) removed.push({ path, value: before });
      else if (JSON.stringify(before) !== JSON.stringify(after)) modified.push({ path, oldValue: before, newValue: after });
    });
    return { added, removed, modified, changedFieldCount: added.length + removed.length + modified.length };
  }
}

module.exports = CanonicalComparisonService;

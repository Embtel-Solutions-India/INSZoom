class FieldDiffService {
  static normalizeField(field = {}) {
    return {
      id: field.fieldId || field.fieldName || field.pdfField || field.pdfFieldName || field.name,
      label: field.label || field.fieldLabel || field.name,
      type: field.type || field.fieldType || field.pdfType || "text",
      page: field.pageNumber || field.page,
      validation: field.validation || field.validationRules || {},
      mapping: field.mapping || field.mappings || field.pdfMapping || {},
    };
  }

  static similarity(left = "", right = "") {
    const a = String(left).toLowerCase().replace(/[^a-z0-9]/g, "");
    const b = String(right).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!a || !b) return 0;
    if (a === b) return 1;
    const common = [...new Set(a)].filter((char) => b.includes(char)).length;
    return common / Math.max(new Set(a).size, new Set(b).size);
  }

  static diff(oldFields = [], newFields = []) {
    const oldMap = new Map(oldFields.map((field) => [this.normalizeField(field).id, this.normalizeField(field)]).filter(([id]) => id));
    const newMap = new Map(newFields.map((field) => [this.normalizeField(field).id, this.normalizeField(field)]).filter(([id]) => id));
    const added = [];
    const removed = [];
    const modified = [];
    const renamed = [];

    for (const [id, oldField] of oldMap.entries()) {
      const newField = newMap.get(id);
      if (!newField) {
        const candidate = [...newMap.values()].find((field) => field.type === oldField.type && this.similarity(oldField.label || oldField.id, field.label || field.id) >= 0.8);
        if (candidate) renamed.push({ oldField, newField: candidate, confidence: Math.round(this.similarity(oldField.label || oldField.id, candidate.label || candidate.id) * 100) });
        else removed.push(oldField);
        continue;
      }
      const changes = {};
      if (oldField.type !== newField.type) changes.type = { old: oldField.type, new: newField.type };
      if (oldField.page !== newField.page) changes.page = { old: oldField.page, new: newField.page };
      if (JSON.stringify(oldField.validation || {}) !== JSON.stringify(newField.validation || {})) changes.validation = { old: oldField.validation, new: newField.validation };
      if (Object.keys(changes).length) modified.push({ fieldId: id, oldField, newField, changes });
    }

    for (const [id, newField] of newMap.entries()) {
      if (!oldMap.has(id) && !renamed.some((item) => item.newField.id === id)) added.push(newField);
    }

    return {
      added,
      removed,
      renamed,
      modified,
      summary: {
        added: added.length,
        removed: removed.length,
        renamed: renamed.length,
        modified: modified.length,
        totalChanges: added.length + removed.length + renamed.length + modified.length,
      },
    };
  }
}

module.exports = FieldDiffService;

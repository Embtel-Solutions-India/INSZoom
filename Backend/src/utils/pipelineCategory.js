// Which GoHighLevel pipeline a case belongs to: "immigrant" or "non_immigrant". Chosen when a case is created in the CRM
// (New case, lead conversion, Add employee, family, single-party filing); GHL-created cases carry it in integrations.ghl.category.
const CATEGORIES = ["immigrant", "non_immigrant"];

const normalizePipelineCategory = (value) => {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return CATEGORIES.includes(normalized) ? normalized : undefined;
};

// Spread into a Case.create payload: adds `pipelineCategory` only when the request chose one.
const pipelineCategoryFields = (body) => {
  const pipelineCategory = normalizePipelineCategory(body?.pipelineCategory);
  return pipelineCategory ? { pipelineCategory } : {};
};

module.exports = { CATEGORIES, normalizePipelineCategory, pipelineCategoryFields };

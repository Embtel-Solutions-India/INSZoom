const AIPromptTemplate = require("../../models/AIPromptTemplate");
const defaults = require("./prompt.defaults");
const { normalizeRole } = require("../authorization/roleHierarchy");

async function ensureDefaults(user) {
  for (const [key, definition] of Object.entries(defaults)) {
    const existing = await AIPromptTemplate.findOne({ key, status: "active" });
    if (!existing) {
      await AIPromptTemplate.create({
        key,
        ...definition,
        version: 1,
        status: "active",
        allowedRoles: ["super_admin", "admin", "team_lead", "case_manager", "attorney", "paralegal", "reviewer", "client", "employer"],
        createdBy: user?._id,
        updatedBy: user?._id,
      });
    }
  }
}

async function resolve(key, user) {
  await ensureDefaults(user);
  const template = await AIPromptTemplate.findOne({ key, status: "active" }).sort({ version: -1 });
  if (!template) throw Object.assign(new Error(`Active AI prompt template not found: ${key}`), { status: 503 });
  const role = normalizeRole(user?.role);
  if (template.allowedRoles?.length && !template.allowedRoles.includes(role)) throw Object.assign(new Error("AI prompt access denied"), { status: 403 });
  return template;
}

function render(template, variables = {}) {
  const replace = (source) => String(source || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const value = path.split(".").reduce((current, segment) => current?.[segment], variables);
    return typeof value === "string" ? value : JSON.stringify(value ?? "");
  });
  return { systemPrompt: replace(template.systemPrompt), userPrompt: replace(template.userPrompt) };
}

async function list(query = {}) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.purpose) filter.purpose = query.purpose;
  if (query.key) filter.key = query.key;
  return AIPromptTemplate.find(filter).sort({ key: 1, version: -1 });
}

async function createVersion(payload, user) {
  const latest = await AIPromptTemplate.findOne({ key: payload.key }).sort({ version: -1 });
  const version = Number(payload.version || (latest?.version || 0) + 1);
  if (payload.status === "active") await AIPromptTemplate.updateMany({ key: payload.key, status: "active" }, { $set: { status: "retired" } });
  return AIPromptTemplate.create({ ...payload, version, createdBy: user._id, updatedBy: user._id });
}

async function update(id, payload, user) {
  const template = await AIPromptTemplate.findById(id);
  if (!template) throw Object.assign(new Error("AI prompt template not found"), { status: 404 });
  if (template.status === "active" && (payload.systemPrompt || payload.userPrompt)) {
    return createVersion({ ...template.toObject(), ...payload, _id: undefined, version: template.version + 1, status: payload.status || "draft" }, user);
  }
  Object.assign(template, payload, { updatedBy: user._id });
  if (payload.status === "active") await AIPromptTemplate.updateMany({ key: template.key, status: "active", _id: { $ne: template._id } }, { $set: { status: "retired" } });
  await template.save();
  return template;
}

module.exports = { createVersion, ensureDefaults, list, render, resolve, update };

// The model behind the engine. A provider is { info(user) -> { model, promptVersion }, suggest(input, { user, req }) -> { data, model?, promptVersion?, usage? } }; tests inject a fake.
// The default goes through the AI platform (ai-orchestration "form_mapping" job): budget gate, per-user rate limit, redaction, audit trail and the job record all apply.
const { renderPayload } = require("./promptInput");

function createDefaultProvider({ orchestration = () => require("../ai/ai-orchestration.service"), promptService = () => require("../ai/ai-prompt.service"), providers = () => require("../ai/ai-provider.registry") } = {}) {
  return {
    async info(user) {
      const template = await promptService().resolve("form_mapping", user);
      const config = await providers().resolve(template.providerKey, user);
      return { model: config.model, promptVersion: template.version };
    },
    async suggest(input, { user, req } = {}) {
      return orchestration().runFormMapping({ payload: renderPayload(input) }, user, req);
    },
  };
}

/** The user an AI run acts as: the caller's own user, else the oldest admin (the same fallback the pipeline uses), else null (the stage is skipped). */
async function resolveAiUser(user, { User = () => require("../../models/User") } = {}) {
  if (user?._id) return user;
  try {
    return (await User().findOne({ role: { $in: ["super_admin", "admin"] }, isActive: { $ne: false } }).sort({ createdAt: 1 })) || null;
  } catch {
    return null;
  }
}

module.exports = { createDefaultProvider, resolveAiUser };

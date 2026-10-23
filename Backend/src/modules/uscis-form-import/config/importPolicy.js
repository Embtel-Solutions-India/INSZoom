// Phase 7.2 / plan section C: which of the forms USCIS publishes does the 12-hour catalog sync actually IMPORT?
//   FORM_CATALOG_IMPORT_POLICY = all        (default: today's behavior - every unseen standalone form is imported)
//                               | registry  (only forms the form registry knows: linked to a visa type or installed)
//                               | allowlist (only FORM_CATALOG_IMPORT_ALLOWLIST, a comma list, plus forms already installed)
// A form installed already is ALWAYS kept up to date, whatever the policy: the policy only decides about forms the software has never had. Excluded forms are not lost: the sync
// reports them as `discoveredNotImported` so a person can add one to the allow-list.
// Pure; the registry lookup is injected.
const POLICIES = Object.freeze(["all", "registry", "allowlist"]);

const policyOf = (env = process.env) => {
  const value = String(env.FORM_CATALOG_IMPORT_POLICY || "all").trim().toLowerCase();
  return POLICIES.includes(value) ? value : "all";
};

const allowListOf = (env = process.env) => String(env.FORM_CATALOG_IMPORT_ALLOWLIST || "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);

/**
 * @param {{ formCode: string, installed?: boolean, registry?: Set<string>|string[]|((code:string)=>boolean), allowList?: string[], policy?: string }} input
 * @returns {{ import: boolean, reason: string }}
 */
function shouldImport({ formCode, installed = false, registry = null, allowList = null, policy = null } = {}, env = process.env) {
  const active = POLICIES.includes(policy) ? policy : policyOf(env);
  const code = String(formCode || "").trim().toUpperCase();
  if (installed) return { import: true, reason: "already installed: always kept current" };
  if (active === "all") return { import: true, reason: "policy: all forms" };
  const list = (allowList || allowListOf(env)).map((item) => String(item).toUpperCase());
  if (list.includes(code)) return { import: true, reason: "on the allow-list" };
  if (active === "allowlist") return { import: false, reason: "not on the allow-list" };
  const known = typeof registry === "function" ? registry(code) : registry instanceof Set ? registry.has(code) : Array.isArray(registry) ? registry.map((item) => String(item).toUpperCase()).includes(code) : false;
  return known ? { import: true, reason: "known to the form registry" } : { import: false, reason: "not in the form registry or the allow-list" };
}

module.exports = { POLICIES, policyOf, allowListOf, shouldImport };

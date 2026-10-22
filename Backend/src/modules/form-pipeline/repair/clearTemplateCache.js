// Strategy clear_template_cache: a stale-cache symptom (the form cache named in the error, or the explicit TEMPLATE_CACHE_STALE code). Drops the in-process template cache and
// re-reads. It changes no stored document at all; verify() proves the cache now agrees with the database about which edition is live.
const { refuses, safe } = require("./guard");

const NAME = "clear_template_cache";
const STALE = /stale (?:template|form) cache|template cache is stale|cached template/i;

function defaults(deps = {}) {
  return {
    invalidate: deps.invalidate || (() => require("../../uscis-forms/uscis-form.service").invalidateTemplateCache?.()),
    cachedActive: deps.cachedActive || ((code) => require("../../uscis-forms/uscis-form.service").findLatestActiveTemplate(code)),
    storedActive: deps.storedActive || ((code) => require("../../../models/USCISFormTemplate").findOne({ formCode: code, status: "active" }).sort({ editionDate: -1, updatedAt: -1 }).select("_id version").lean()),
  };
}

function createClearTemplateCacheStrategy(deps = {}) {
  const d = () => defaults(deps);
  const matches = safe((error) => !refuses(error) && (error?.code === "TEMPLATE_CACHE_STALE" || STALE.test(String(error?.message || ""))));
  async function repair() { await d().invalidate(); }
  async function verify(error, context) {
    const code = error?.formCode || context?.formCode;
    if (!code) return "FAILED: no form code to check";
    const { cachedActive, storedActive } = d();
    const [cached, stored] = await Promise.all([cachedActive(code), storedActive(code)]);
    if (!stored && !cached) return `repaired: cache dropped; ${code} has no live edition in the cache or the database`;
    if (String(cached?._id) !== String(stored?._id)) return `FAILED: the cache still disagrees with the database about the live ${code} edition`;
    return `repaired: cache dropped; the cache and the database agree the live ${code} edition is ${stored.version || stored._id}`;
  }
  return { name: NAME, matches, repair, verify };
}

module.exports = { createClearTemplateCacheStrategy, NAME };

// Strategy rediscover_components: the components_slice check failed because component DISCOVERY itself broke (an error while reading the PDF text, a transient storage read),
// not because a supplement is really missing - a missing supplement ("could not be sliced from the new edition") needs a person and is never matched.
// repair() runs discovery again for the pending edition; verify() requires every component the previous edition served to be sliceable now (checkEditionReady), then
// re-certifies and requires components_slice to pass. If not, the component definitions this repair created are removed again - the edition is as it was.
const { refuses, failedChecksOf, safe } = require("./guard");

const NAME = "rediscover_components";
const DISCOVERY_BROKE = /component (?:slicing|check) failed/i;

function defaults(deps = {}) {
  return {
    Template: deps.Template || require("../../../models/USCISFormTemplate"),
    Definition: deps.Definition || require("../../../models/USCISFormComponentDefinition"),
    discover: deps.discover || ((code, options) => require("../../uscis-forms/services/USCISFormComponentDiscoveryService").discoverComponentsForParentForm(code, options)),
    editionReady: deps.editionReady || ((template, previous) => require("../../form-mapping/services/EditionMigrationService").checkEditionReady(template, previous)),
    previousEdition: deps.previousEdition || ((template) => require("../../form-mapping/services/EditionMigrationService").findPreviousEdition(template)),
    certify: deps.certify || ((template, previous) => require("../../form-mapping/services/FormCertificationService").certify(template, { previous })),
  };
}

function createRediscoverComponentsStrategy(deps = {}) {
  const state = new WeakMap();
  const d = () => defaults(deps);

  const matches = safe((error) => {
    if (refuses(error)) return false;
    return failedChecksOf(error).some((check) => check.name === "components_slice" && DISCOVERY_BROKE.test(check.detail));
  });

  async function repair(error, context) {
    const { Template, Definition, discover, previousEdition } = d();
    const id = error.templateId || context?.job?.artifacts?.newTemplateId;
    if (!id) throw new Error("no pending edition is recorded for this job, so there is nothing to repair");
    const template = await Template.findById(id);
    if (!template) throw new Error("the pending edition no longer exists");
    if (template.status === "active") throw new Error("refusing to repair a live edition");
    const before = new Set((await Definition.find({ parentTemplateId: template._id }).select("_id").lean()).map((item) => String(item._id)));
    state.set(error, { templateId: template._id, before, previous: await previousEdition(template) });
    const result = await discover(template.formCode, { templateId: template._id });
    if (result?.error) throw new Error(`discovery failed again: ${result.error}`);
  }

  async function undo(snapshot) {
    const { Definition } = d();
    const now = await Definition.find({ parentTemplateId: snapshot.templateId }).select("_id").lean();
    const created = now.filter((item) => !snapshot.before.has(String(item._id))).map((item) => item._id);
    if (created.length) await Definition.deleteMany({ _id: { $in: created } });
  }

  async function verify(error) {
    const snapshot = state.get(error);
    if (!snapshot) return "FAILED: repair() recorded nothing to verify";
    const { Template, editionReady, certify } = d();
    try {
      const template = await Template.findById(snapshot.templateId);
      const readiness = await editionReady(template, snapshot.previous);
      if (!readiness.ready) { await undo(snapshot); return `FAILED: ${readiness.problems.join("; ").slice(0, 200)}`; }
      const report = await certify(template, snapshot.previous);
      if (!(report.checks || []).find((check) => check.name === "components_slice" && check.passed)) { await undo(snapshot); return "FAILED: components_slice still fails after the repair"; }
      return `repaired: components_slice passes now; ${(readiness.components || []).length} component(s) sliceable from this edition`;
    } catch (failure) {
      await undo(snapshot).catch(() => null);
      return `FAILED: ${failure.message}`;
    }
  }

  return { name: NAME, matches, repair, verify };
}

module.exports = { createRediscoverComponentsStrategy, NAME, DISCOVERY_BROKE };

// A failed certification does not THROW (activateOrPromote records it and leaves the edition in review), so the runner could never offer it to a repair strategy. This reads
// what the run left behind - the pending edition's stored certification report - and, when it failed, returns a descriptive error the strategies can match on. It reads one
// small projection and changes nothing. Returns null when there is nothing to repair (the edition is live, held by the edition policy, or certified).
function createCertificationInspector({ Template = null } = {}) {
  return async function inspect(result) {
    if (!result || !result.requiresActivation) return null;
    if (result.activationBlockedCode === "EDITION_POLICY_HELD") return null; // waiting for a decision, not for a repair
    const id = result.newTemplateId || result.template?._id;
    if (!id) return null;
    const model = Template || require("../../../models/USCISFormTemplate");
    const template = await model.findById(id).select("formCode version status importMetadata.validationSummary.certification").lean();
    if (!template || template.status === "active") return null;
    const certification = template.importMetadata?.validationSummary?.certification;
    if (!certification || certification.passed !== false) return null;
    const failedChecks = (certification.checks || []).filter((check) => !check.passed).map((check) => ({ name: check.name, detail: String(check.detail || "") }));
    if (!failedChecks.length) return null;
    return Object.assign(new Error(`certification failed: ${failedChecks.map((check) => check.name).join(", ")}`), { name: "CertificationFailed", code: "CERTIFICATION_FAILED", templateId: template._id, formCode: template.formCode, failedChecks });
  };
}

module.exports = { createCertificationInspector };

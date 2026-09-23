// Phase 0 of the registry-wide USCIS forms closure work (see
// docs/plan "USCIS Forms: Provisioning Bug + Registry-Wide Supplement/
// Component Architecture", Part C). Walks the LIVE VisaFormMapping
// collection - not a hardcoded form list - and reports, per row, whether it
// resolves to a real, active template (and, for a component row, a real
// ACTIVE USCISFormComponentDefinition), or is explicitly excluded for a
// documented reason. This is the reusable engine for both the Phase 0
// baseline and the Phase 13 closure proof - same function, run twice.
const VisaFormMapping = require("../../../models/VisaFormMapping");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const USCISFormComponentDefinition = require("../../../models/USCISFormComponentDefinition");

// provisioningType values that are supposed to resolve to something real.
// LATER_STAGE/REFERENCE/NOT_APPLICABLE are legitimate documented exclusions,
// not defects, and are reported as such rather than being flagged.
const MUST_RESOLVE = new Set(["AUTO_CREATE", "CONDITIONAL"]);

// Only these componentTypes represent an actual USCIS PDF this system
// imports/fills - ONLINE_APPLICATION (e.g. DS-160, ETA-9035),
// GOVERNMENT_DOCUMENT and REFERENCE_DOCUMENT rows point at external
// government portals or reference material that never gets a
// USCISFormTemplate, by design, regardless of provisioningType.
const TEMPLATE_BACKED_TYPES = new Set(["STANDALONE_FORM", "SUPPLEMENT", "FORM_COMPONENT"]);

function normalizeFormCode(code) {
  return String(code || "").trim().toUpperCase();
}

async function buildClosureMatrix() {
  const mappings = await VisaFormMapping.find({ active: true }).lean();

  const templateFormCodes = new Set(
    (await USCISFormTemplate.find({ status: "active", activeFlag: true }).distinct("formCode"))
      .map(normalizeFormCode)
  );
  // Genuinely acquired from an official USCIS source and fillable, but not
  // yet promoted past "review" because no human has curated a full field-
  // mapping crosswalk for it (Constraint #3's deliberate human gate - see
  // OnDemandFormAcquisitionService.activateOrPromote). AutoFillService's
  // biographicFallback can already use these for basic biographic fields;
  // they are NOT counted as "provisionable" here (that still means fully
  // production-active), but are surfaced separately so the report doesn't
  // conflate "no template exists at all" with "acquired, pending review."
  const biographicOnlyFormCodes = new Set(
    (await USCISFormTemplate.find({ mappingStatus: "biographic_active", status: { $ne: "active" } }).distinct("formCode"))
      .map(normalizeFormCode)
  );

  const componentDefs = await USCISFormComponentDefinition.find({}).lean();
  const componentByCode = new Map(componentDefs.map((c) => [c.componentCode, c]));

  const rows = [];
  for (const mapping of mappings) {
    const isComponentRow = mapping.componentType === "SUPPLEMENT" || mapping.componentType === "FORM_COMPONENT";
    const isTemplateBacked = TEMPLATE_BACKED_TYPES.has(mapping.componentType);
    const mustResolve = MUST_RESOLVE.has(mapping.provisioningType) && isTemplateBacked;

    const templateFormCode = normalizeFormCode(mapping.formTemplateFormCode || mapping.parentForm || mapping.formNumber);
    const templateExists = templateFormCodes.has(templateFormCode);
    const templateAcquiredPendingReview = !templateExists && biographicOnlyFormCodes.has(templateFormCode);
    // Per-row override: templateAcquiredPendingReview above is computed
    // from templateFormCode, which falls back to the PARENT form's code
    // when this row has neither its own formTemplateFormCode nor
    // componentCode set - in that case the parent's acquisition status is
    // irrelevant to why THIS row can't resolve, so the reported flag is
    // reset to false for that specific branch below.
    let rowAcquiredPendingReview = templateAcquiredPendingReview;

    let componentExists = null;
    let componentActive = null;
    if (isComponentRow && mapping.componentCode) {
      const def = componentByCode.get(mapping.componentCode);
      componentExists = !!def;
      componentActive = def ? def.status === "ACTIVE" : false;
    }

    let provisionable;
    let reason;
    if (!isTemplateBacked) {
      provisionable = true;
      reason = `componentType=${mapping.componentType} (external/online, never USCISFormTemplate-backed)`;
    } else if (!mustResolve) {
      provisionable = true;
      reason = `provisioningType=${mapping.provisioningType} (documented exclusion, not required to resolve)`;
    } else if (isComponentRow) {
      // Type A (separate, independently-published sub-form, e.g. I-539A,
      // I-130A) resolves via formTemplateFormCode -> its OWN
      // USCISFormTemplate, exactly like a STANDALONE_FORM row - no
      // componentCode/component-definition involved at all. Type B
      // (genuinely embedded page-range section of the parent's own PDF,
      // e.g. I-129's H Classification Supplement) has no
      // formTemplateFormCode of its own and resolves via componentCode
      // instead. A row is one or the other, never both.
      if (mapping.formTemplateFormCode) {
        provisionable = templateExists;
        reason = templateExists
          ? `Type A supplement, resolves to its own active template ${templateFormCode}`
          : templateAcquiredPendingReview
            ? `Type A supplement, ${templateFormCode} acquired from uscis.gov but pending human mapping review (biographic_active only)`
            : `Type A supplement, no active USCISFormTemplate for ${templateFormCode}`;
      } else if (!mapping.componentCode) {
        // Neither Type A's own formTemplateFormCode nor Type B's own
        // componentCode is set - this row cannot resolve no matter what
        // state its PARENT form's template is in, so it is always a real,
        // genuine gap (never mislabeled as "acquired pending review" via
        // the parent's unrelated status - that flag is reset to false here
        // since it isn't this row's actual blocker).
        provisionable = false;
        rowAcquiredPendingReview = false;
        reason = "component row has neither formTemplateFormCode (Type A) nor componentCode (Type B) set - its own sub-form has not been acquired/wired yet";
      } else if (!templateExists) {
        provisionable = false;
        reason = templateAcquiredPendingReview
          ? `Type B component, parent template ${templateFormCode} acquired from uscis.gov but pending human mapping review (biographic_active only)`
          : `Type B component, parent template ${templateFormCode} is not active`;
      } else if (!componentExists) {
        provisionable = false;
        rowAcquiredPendingReview = false;
        reason = `Type B component, no USCISFormComponentDefinition found for componentCode ${mapping.componentCode}`;
      } else if (!componentActive) {
        provisionable = false;
        rowAcquiredPendingReview = false;
        reason = `Type B component ${mapping.componentCode} is REVIEW_REQUIRED, not ACTIVE`;
      } else {
        provisionable = true;
        reason = "Type B component, resolves to an active component definition";
      }
    } else {
      provisionable = templateExists;
      reason = templateExists
        ? `resolves to active template ${templateFormCode}`
        : templateAcquiredPendingReview
          ? `${templateFormCode} acquired from uscis.gov but pending human mapping review (biographic_active only)`
          : `no active USCISFormTemplate for ${templateFormCode}`;
    }

    rows.push({
      visaType: mapping.visaType,
      formNumber: mapping.formNumber,
      provisioningType: mapping.provisioningType,
      componentType: mapping.componentType,
      formTemplateFormCode: mapping.formTemplateFormCode || null,
      parentForm: mapping.parentForm || null,
      componentCode: mapping.componentCode || null,
      templateExists,
      templateAcquiredPendingReview: rowAcquiredPendingReview,
      componentExists,
      componentActive,
      mustResolve,
      provisionable,
      reason,
    });
  }

  const defects = rows.filter((r) => r.mustResolve && !r.provisionable);
  return {
    totalRows: rows.length,
    defectCount: defects.length,
    defects,
    rows,
  };
}

module.exports = { buildClosureMatrix };

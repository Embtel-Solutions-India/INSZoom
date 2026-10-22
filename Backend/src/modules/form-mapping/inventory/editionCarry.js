// Phase 7.4 hook for the edition carry-forward (EditionMigrationService.carryForwardGraph). Gated by FORM_PIPELINE_AUTONOMY and kept out of that file so the change there is one
// call:
//   off     nothing happens (this function returns null before touching anything);
//   shadow  the inventory is computed and the would-be decision is LOGGED; the graph is not changed;
//   on      the compact inventory summary is stored on the new graph (graph.inventory). The graph's `unmappedTargets` stays [] (so activation is exactly as before) while the
//           inventory gate is in REPORT mode (FORM_INVENTORY_GATE=report, the default); only with FORM_INVENTORY_GATE=enforce do the boxes the gate would hold on become
//           `unmappedTargets`, which the existing activation readiness check already refuses to activate with.
// Never throws: a failure here is logged and the carry-forward goes on exactly as it did before.
const autonomy = require("../../../config/formPipelineAutonomy");
const FieldInventory = require("./FieldInventory");
const logger = require("../../../utils/logger");

function inventoryForCarry({ template, graph, targetFields, previousGraph, previousTemplate, renamedEdges = [], lostEdges = [], mode = autonomy.mode(), gate = FieldInventory.gateMode(), log = logger }) {
  if (mode === "off") return null;
  try {
    const inventory = FieldInventory.build({ template, fields: targetFields, graph, previous: previousTemplate ? { template: previousTemplate, graph: previousGraph } : { graph: previousGraph }, renamedEdges, lostEdges });
    const summary = FieldInventory.summarize(inventory);
    if (mode === "shadow") {
      log.warn("form_inventory_shadow", { formCode: inventory.formCode, wouldBe: inventory.decision, holdCount: inventory.hold.length, counts: inventory.counts, newBoxes: inventory.previous.newIds?.length || 0 });
      return null;
    }
    const enforced = gate === "enforce";
    return { summary, unmappedTargets: enforced ? inventory.hold.map((entry) => entry.id).filter(Boolean) : null, enforced };
  } catch (error) {
    log.warn("form_inventory_failed", { error: error.message });
    return null;
  }
}

module.exports = { inventoryForCarry };

/**
 * The same inventory for the stored coverage report (MappingCoverageService.computeCoverage): null when the switch is off; shadow logs and returns null; on returns the
 * compact summary, re-using what the carry-forward recorded about the previous edition (`graph.inventory.previous`) because the coverage step does not see that edition.
 */
function inventoryForCoverage({ template, graph, fields, mode = autonomy.mode(), log = logger }) {
  if (mode === "off") return null;
  try {
    const inventory = FieldInventory.build({ template, fields, graph });
    const summary = FieldInventory.summarize(inventory);
    if (graph?.inventory?.previous) summary.previous = graph.inventory.previous;
    if (mode === "shadow") {
      log.warn("form_inventory_shadow", { formCode: inventory.formCode, wouldBe: inventory.decision, holdCount: inventory.hold.length, counts: inventory.counts, where: "coverage" });
      return null;
    }
    return summary;
  } catch (error) {
    log.warn("form_inventory_failed", { error: error.message });
    return null;
  }
}

module.exports.inventoryForCoverage = inventoryForCoverage;

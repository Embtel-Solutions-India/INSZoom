// The I-131 mapping graph = the PERM crosswalk (canonical paths: name, A-Number, DOB, countries, mailing / physical address) PLUS the edges that read the
// stand-alone I-131 checklist's own answers (i131-checklist-crosswalk.js). One graph, one edge per form box: the checklist-sourced edges only add boxes
// the PERM crosswalk leaves empty, so the PERM workflow's autofill is unchanged. The PERM test suite keeps asserting i131-perm-crosswalk.js on its own.
const perm = require("./i131-perm-crosswalk");
const { CHECKLIST_EDGES } = require("./i131-checklist-crosswalk");

const permFields = new Set(perm.MAPPED_EDGES.map((edge) => edge.fieldName));
const added = CHECKLIST_EDGES.filter((edge) => !permFields.has(edge.fieldName)); // never a second edge for a box the PERM graph already fills
const MAPPED_EDGES = [...perm.MAPPED_EDGES, ...added];
const BY_FIELD = new Map(MAPPED_EDGES.map((edge) => [edge.fieldName, edge]));

function classifyField(field) {
  const fieldName = field.fieldName || field.pdfFieldName || field.targetPdfField || field.fieldId;
  const mapped = BY_FIELD.get(fieldName);
  if (mapped) return { status: "mapped", edge: mapped };
  return perm.classifyField(field);
}

module.exports = { ...perm, MAPPED_EDGES, classifyField };

// An XFA-only PDF, or one that scans to zero fields.
const { depStrategy } = require("./_helpers");

module.exports = {
  id: "xfaNoFields",
  description: "the PDF has no AcroForm fields",
  matches: (diagnosis) => diagnosis.cause === "xfa_or_no_fields",
  strategies: [
    depStrategy({ id: "acroform_companion_pdf", description: "use the AcroForm (fillable) companion PDF linked on the official page", depName: "findCompanionPdf" }),
    depStrategy({ id: "scan_without_appearances", description: "scan the fields again without updating appearances", depName: "scanLoose" }),
    depStrategy({ id: "previous_edition_structure", description: "start from the previous edition field structure and keep the new PDF for rendering", depName: "previousEditionStructure", retry: false }),
  ],
};

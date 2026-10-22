// A damaged or hard-to-read PDF (qpdf exit 2, broken xref, truncated). Alternate normalizers are supplied by the import stage (7.2); each result is verified by the stage.
const { depStrategy } = require("./_helpers");

module.exports = {
  id: "pdfDamaged",
  description: "the PDF could not be normalized or read",
  matches: (diagnosis) => ["pdf_damaged", "pdf_encrypted"].includes(diagnosis.cause),
  strategies: [
    depStrategy({ id: "qpdf_recover", description: "qpdf in recovery mode (--qdf --recover)", depName: "recoverNormalize" }),
    depStrategy({ id: "pdf_lib_resave", description: "load with pdf-lib (ignoring encryption) and save without object streams", depName: "alternateNormalize" }),
    depStrategy({ id: "redownload_for_damage", description: "download the file again (a truncated transfer is the usual cause)", depName: "redownload" }),
  ],
};

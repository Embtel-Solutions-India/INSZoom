function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

const emptyDependent = () => ({
  name: "",
  relationship: "",
  passport: "",
  i94: "",
  previousApprovalNotices: "",
  marriageCertificate: "",
  birthCertificate: "",
  hasSsn: "",
  hasDriverLicense: "",
  // Per-dependent EAD (I-765) opt-in, Phase H6 - defaults to "" (not opted
  // in) so no dependent gets an I-765 unless explicitly requested; this is
  // the "default off in v1" flag the H6 spec calls for.
  wantsEad: "",
});

const emptyHLStay = () => ({ visaClassification: "", arrivalDate: "", departureDate: "" });

module.exports = { clean, emptyDependent, emptyHLStay };

// Shared paths the generic party mapping (PartyAliasService) reads and that employer-sponsored checklists (TN, O-1B, ...) write to, but that had no
// registry entry. Additive only; same extension mechanism as the other *CanonicalPaths.js files.
const t = (path, type = "text") => ({ path, aliases: [], type });
const PARTY_CANONICAL_FIELDS = Object.freeze([
  t("person.provinceOfBirth"),
  t("immigration.lastArrivalDate", "date"),
  t("contact.address.formatted"),
  t("contact.foreignAddress.formatted"),
  t("company.address.formatted"),
  t("company.industry"),
  t("company.yearEstablished"),
  t("company.numberOfEmployees"),
  t("company.grossAnnualIncome", "currency"),
  t("company.netAnnualIncome", "currency"),
  t("company.website"),
  t("company.authorizedRepresentative.firstName"),
  t("company.authorizedRepresentative.lastName"),
  t("company.authorizedRepresentative.title"),
  t("company.authorizedRepresentative.email", "email"),
  t("company.authorizedRepresentative.phone", "phone"),
  t("employment.jobTitle"),
  t("employment.wage", "currency"),
]);
module.exports = { PARTY_CANONICAL_FIELDS };

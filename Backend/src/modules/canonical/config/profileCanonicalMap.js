const EMPLOYER_PROFILE_TO_CANONICAL = Object.freeze({
  legalName: "company.name",
  dbaName: "company.dbaName",
  ein: "company.ein",
  businessType: "company.industry",
  businessDescription: "company.description",
  yearEstablished: "company.yearEstablished",
  grossAnnualIncome: "company.grossAnnualIncome",
  netAnnualIncome: "company.netAnnualIncome",
  numberOfEmployees: "company.numberOfEmployees",
  "address.street": "company.address.line1",
  "address.street2": "company.address.line2",
  "address.city": "company.address.city",
  "address.state": "company.address.state",
  "address.zipCode": "company.address.zip",
  "address.country": "company.address.country",
  "contact.name": "company.contact.name",
  "contact.title": "company.contact.title",
  "contact.phone": "company.contact.phone",
  "contact.email": "company.contact.email",
  "authorizedRepresentative.name": "company.authorizedRepresentative.name",
  "authorizedRepresentative.title": "company.authorizedRepresentative.title",
  "authorizedRepresentative.phone": "company.authorizedRepresentative.phone",
  "authorizedRepresentative.email": "company.authorizedRepresentative.email",
  lcaNumber: "employment.lcaNumber",
  lcaWageLevel: "employment.lcaWageLevel",
  prevailingWage: "employment.prevailingWage",
  actualWage: "employment.actualWage",
  "workSiteAddress.street": "employment.workSite.address.line1",
  "workSiteAddress.city": "employment.workSite.address.city",
  "workSiteAddress.state": "employment.workSite.address.state",
  "workSiteAddress.zipCode": "employment.workSite.address.zip",
  "workSiteAddress.county": "employment.workSite.address.county",
});

const EMPLOYEE_PROFILE_TO_CANONICAL = Object.freeze({
  firstName: "person.firstName",
  middleName: "person.middleName",
  lastName: "person.lastName",
  dateOfBirth: "person.dob",
  gender: "person.gender",
  countryOfBirth: "person.countryOfBirth",
  countryOfCitizenship: "person.citizenship",
  nationality: "person.citizenship",
  maritalStatus: "person.maritalStatus",
  email: "contact.email",
  phone: "contact.phone",
  "currentAddress.street": "contact.address.line1",
  "currentAddress.city": "contact.address.city",
  "currentAddress.state": "contact.address.state",
  "currentAddress.zipCode": "contact.address.zip",
  "currentAddress.country": "contact.address.country",
  "passport.number": "person.passport.number",
  "passport.country": "person.passport.country",
  "passport.issueDate": "person.passport.issueDate",
  "passport.expirationDate": "person.passport.expirationDate",
  "passport.placeOfIssue": "person.passport.placeOfIssue",
  currentVisaStatus: "immigration.currentStatus",
  currentVisaExpiry: "immigration.currentStatusExpirationDate",
  i94Number: "immigration.i94.number",
  i94ExpirationDate: "immigration.i94.expirationDate",
  alienRegistrationNumber: "person.alienNumber",
  sevisId: "immigration.sevis.id",
  positionTitle: "employment.positionTitle",
  positionSocCode: "employment.socCode",
  salary: "employment.salary",
  salaryUnit: "employment.salaryUnit",
  startDate: "employment.startDate",
  endDate: "employment.endDate",
  fullTime: "employment.fullTime",
  educationHistory: "education",
  employmentHistory: "employment.history",
  immigrationHistory: "immigrationHistory",
  travelHistory: "travelHistory",
  criminalRecord: "background.criminalRecord",
  visaDenial: "background.visaDenial",
  deportation: "background.deportation",
});

function invert(map) {
  return Object.freeze(Object.entries(map).reduce((acc, [profilePath, canonicalPath]) => {
    if (!acc[canonicalPath]) acc[canonicalPath] = profilePath;
    return acc;
  }, {}));
}

const CANONICAL_TO_EMPLOYER_PROFILE = invert(EMPLOYER_PROFILE_TO_CANONICAL);
const CANONICAL_TO_EMPLOYEE_PROFILE = invert(EMPLOYEE_PROFILE_TO_CANONICAL);

function profilePathForCanonical(canonicalPath, profileOwner) {
  if (profileOwner === "employer") return CANONICAL_TO_EMPLOYER_PROFILE[canonicalPath] || null;
  if (profileOwner === "employee" || profileOwner === "beneficiary") return CANONICAL_TO_EMPLOYEE_PROFILE[canonicalPath] || null;
  if (canonicalPath.startsWith("company.")) return CANONICAL_TO_EMPLOYER_PROFILE[canonicalPath] || null;
  if (canonicalPath.startsWith("person.") || canonicalPath.startsWith("contact.") || canonicalPath.startsWith("immigration.")) {
    return CANONICAL_TO_EMPLOYEE_PROFILE[canonicalPath] || null;
  }
  return null;
}

function ownerForCanonicalPath(canonicalPath) {
  if (CANONICAL_TO_EMPLOYER_PROFILE[canonicalPath] || canonicalPath.startsWith("company.")) return "employer";
  if (CANONICAL_TO_EMPLOYEE_PROFILE[canonicalPath] || canonicalPath.startsWith("person.") || canonicalPath.startsWith("contact.") || canonicalPath.startsWith("immigration.")) return "employee";
  return "case";
}

module.exports = {
  EMPLOYER_PROFILE_TO_CANONICAL,
  EMPLOYEE_PROFILE_TO_CANONICAL,
  CANONICAL_TO_EMPLOYER_PROFILE,
  CANONICAL_TO_EMPLOYEE_PROFILE,
  profilePathForCanonical,
  ownerForCanonicalPath,
};

// Field-group configs for CanonicalProfileForm — one entry per canonicalData
// leaf the client-facing questionnaire currently collects. Deliberately not
// exhaustive against the full EmployerProfile/EmployeeProfile schemas (see
// Backend/src/models/) — this is a first, working cut; adding a field later
// is just adding a row here, since the form and the backend's field-path
// validation are both already fully generic.

export const EMPLOYER_FIELD_GROUPS = [
  {
    label: "Company",
    fields: [
      { path: "legalName", label: "Legal company name" },
      { path: "dbaName", label: "DBA (if any)" },
      { path: "ein", label: "EIN" },
      { path: "businessType", label: "Business type" },
      { path: "numberOfEmployees", label: "Number of employees", type: "number" },
    ],
  },
  {
    label: "Address",
    fields: [
      { path: "address.street", label: "Street address" },
      { path: "address.city", label: "City" },
      { path: "address.state", label: "State" },
      { path: "address.zipCode", label: "ZIP code" },
      { path: "address.country", label: "Country" },
    ],
  },
  {
    label: "Contact",
    fields: [
      { path: "contact.name", label: "Contact name" },
      { path: "contact.title", label: "Contact title" },
      { path: "contact.phone", label: "Contact phone" },
      { path: "contact.email", label: "Contact email", type: "email" },
    ],
  },
];

export const EMPLOYEE_FIELD_GROUPS = [
  {
    label: "Identity",
    fields: [
      { path: "firstName", label: "First name" },
      { path: "middleName", label: "Middle name" },
      { path: "lastName", label: "Last name" },
      { path: "dateOfBirth", label: "Date of birth", type: "date" },
      { path: "countryOfBirth", label: "Country of birth" },
      { path: "countryOfCitizenship", label: "Country of citizenship" },
    ],
  },
  {
    label: "Contact",
    fields: [
      { path: "email", label: "Email", type: "email" },
      { path: "phone", label: "Phone" },
    ],
  },
  {
    label: "Passport",
    fields: [
      { path: "passport.number", label: "Passport number" },
      { path: "passport.country", label: "Issuing country" },
      { path: "passport.issueDate", label: "Issue date", type: "date" },
      { path: "passport.expirationDate", label: "Expiration date", type: "date" },
    ],
  },
  {
    label: "Position",
    fields: [
      { path: "positionTitle", label: "Job title" },
      { path: "startDate", label: "Start date", type: "date" },
    ],
  },
];

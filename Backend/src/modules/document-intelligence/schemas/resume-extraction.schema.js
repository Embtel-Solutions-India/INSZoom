// Enum matches the I-129 H-1B Data Collection Supplement's own Item 2
// "Beneficiary's Highest Level of Education" checkboxes exactly (see
// i129-h1b-crosswalk.js's new MAPPED_EDGES for the confirmed widget/onValue
// per option) - keeping the resume extractor's degreeType vocabulary
// identical to the PDF's own options is what lets deriveEducationScalarFields
// (extraction-mapping.service.js) and the crosswalk agree on one token set
// instead of needing a translation table between them.
const DEGREE_TYPES = [
  "no_diploma",
  "high_school",
  "some_college",
  "college_no_degree",
  "associates",
  "bachelors",
  "masters",
  "professional",
  "doctorate",
];

const RESUME_FIELDS = ["education", "employment", "skills"];

const RESUME_JSON_SCHEMA_EXAMPLE = {
  fields: {
    education: {
      value: [
        {
          institution: "string|null",
          degreeType: `one of: ${DEGREE_TYPES.join(", ")}, or null if not determinable`,
          major: "string|null",
          country: "string|null",
          awardDate: "YYYY-MM-DD|string|null",
          confidence: "number 0-100",
        },
      ],
      confidence: "number 0-100",
    },
    employment: {
      value: [
        {
          employer: "string|null",
          title: "string|null",
          startDate: "YYYY-MM-DD|string|null",
          endDate: "YYYY-MM-DD|string|null",
          current: "boolean",
          duties: "string|null",
          confidence: "number 0-100",
        },
      ],
      confidence: "number 0-100",
    },
    skills: { value: ["string"], confidence: "number 0-100" },
  },
  rawText: "string",
  overallConfidence: "number 0-100",
};

module.exports = {
  DEGREE_TYPES,
  RESUME_FIELDS,
  RESUME_JSON_SCHEMA_EXAMPLE,
};

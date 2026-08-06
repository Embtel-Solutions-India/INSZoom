const { RESUME_FIELDS, DEGREE_TYPES } = require("../schemas/resume-extraction.schema");

function normalizeConfidence(confidence, fallback = 70) {
  if (confidence === undefined || confidence === null || confidence === "") return fallback === undefined ? 0 : fallback;
  return Math.max(0, Math.min(100, Number(confidence) || 0));
}

function normalizeDate(value) {
  if (!value) return value === undefined ? null : value;
  const trimmed = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  // Date components are read in LOCAL time, not toISOString()'s UTC - "June
  // 2019" parses as local midnight on June 1st, and converting that to UTC
  // can roll it back to May 31st in any timezone west of UTC. Formatting
  // from the local getFullYear/getMonth/getDate keeps the visible date text
  // and the normalized output in agreement.
  const year = String(parsed.getFullYear()).padStart(4, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDegreeType(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
  return DEGREE_TYPES.includes(normalized) ? normalized : null;
}

function normalizeEducationEntry(entry = {}) {
  return {
    institution: entry.institution || null,
    degreeType: normalizeDegreeType(entry.degreeType),
    major: entry.major || null,
    country: entry.country || null,
    awardDate: normalizeDate(entry.awardDate),
    confidence: normalizeConfidence(entry.confidence),
  };
}

function normalizeEmploymentEntry(entry = {}) {
  return {
    employer: entry.employer || null,
    title: entry.title || null,
    startDate: normalizeDate(entry.startDate),
    endDate: normalizeDate(entry.endDate),
    current: Boolean(entry.current),
    duties: entry.duties || null,
    confidence: normalizeConfidence(entry.confidence),
  };
}

// Hallucinated-row guard: a resume LLM extraction that invents an empty
// {degreeType:null, confidence:0} entry when there's really only one degree
// on the page is a real, observed failure mode (same class of issue the
// passport DTO doesn't have to worry about, since passport fields are all
// scalar) - drop any entry missing its one required identifying field
// rather than let it become a phantom row a reviewer has to reject by hand.
function normalizeEducationArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeEducationEntry).filter((entry) => Boolean(entry.institution));
}

function normalizeEmploymentArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeEmploymentEntry).filter((entry) => Boolean(entry.employer));
}

function normalizeSkillsArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((skill) => String(skill || "").trim()).filter(Boolean);
}

function fieldContainer(sourceFields, key) {
  const raw = sourceFields[key];
  if (raw && typeof raw === "object" && !Array.isArray(raw) && Object.prototype.hasOwnProperty.call(raw, "value")) return raw;
  return { value: raw, confidence: raw === undefined || raw === null ? 0 : 70 };
}

function normalizeResumeExtractionDto(response = {}) {
  const sourceFields = response.fields || response.extractedData || response.resume || response;
  const educationContainer = fieldContainer(sourceFields, "education");
  const employmentContainer = fieldContainer(sourceFields, "employment");
  const skillsContainer = fieldContainer(sourceFields, "skills");

  const fields = {
    education: {
      value: normalizeEducationArray(educationContainer.value),
      confidence: normalizeConfidence(educationContainer.confidence),
    },
    employment: {
      value: normalizeEmploymentArray(employmentContainer.value),
      confidence: normalizeConfidence(employmentContainer.confidence),
    },
    skills: {
      value: normalizeSkillsArray(skillsContainer.value),
      confidence: normalizeConfidence(skillsContainer.confidence),
    },
  };

  return {
    fields,
    rawText: response.rawText || "",
    entities: {
      resume: {
        education: fields.education.value,
        employment: fields.employment.value,
        skills: fields.skills.value,
      },
      validation: response.validation || {},
    },
    evidenceCategories: ["Employment", "Education"],
    overallConfidence: normalizeConfidence(response.overallConfidence, averageConfidence(fields)),
    raw: response,
  };
}

function averageConfidence(fields) {
  const values = RESUME_FIELDS.map((key) => Number(fields[key]?.confidence) || 0);
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

module.exports = {
  normalizeResumeExtractionDto,
  normalizeDegreeType,
  normalizeDate,
};

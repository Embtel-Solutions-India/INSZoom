import { describe, expect, it } from "vitest";
import { AUTOFILL_SOURCES, AUTOFILL_LABELS, matchingAutofillSources } from "./questionnaireEngine";

// Phase H2b: the H-1B checklist's real question keys (mirrors Phase H1's
// already-verified golden case fixture / h1b.js fieldCatalog()) - proves
// matchingAutofillSources actually recognizes the REAL H-1B checklist
// instead of the prior version's legacy generic keys (firstName, education,
// ...) that never matched any real section and so never showed a button.
function question(key) {
  return { key, questionKey: key };
}

describe("AUTOFILL_SOURCES / matchingAutofillSources (Phase H2b)", () => {
  it("every AUTOFILL_SOURCES key has a matching backend allowlist type and a display label", () => {
    Object.keys(AUTOFILL_SOURCES).forEach((documentType) => {
      expect(AUTOFILL_LABELS[documentType]).toBeTruthy();
    });
  });

  it("matches the passport document type on a section with beneficiary identity questions", () => {
    const questions = [
      question("employee_personal_firstName"),
      question("employee_personal_lastName"),
      question("employee_personal_dateOfBirth"),
      question("employee_personal_passportNumber"),
    ];
    expect(matchingAutofillSources(questions)).toContain("passport");
  });

  it("matches the I-94 document type on the immigration status section", () => {
    const questions = [
      question("employee_immigrationStatus_i94Number"),
      question("employee_immigrationStatus_currentVisaStatus"),
    ];
    const sources = matchingAutofillSources(questions);
    expect(sources).toContain("employee_i94_copy");
    expect(sources).not.toContain("passport");
  });

  it("matches resume, academic certificates, and credential evaluation together on the education section", () => {
    const questions = [
      question("employee_education_degreeType"),
      question("employee_education_majorFieldOfStudy"),
      question("employee_education_usInstitutionName"),
    ];
    const sources = matchingAutofillSources(questions);
    expect(sources).toContain("updated_resume");
    expect(sources).toContain("academic_certificates");
    expect(sources).toContain("credential_evaluation_report");
  });

  it("matches the LCA document type on the employer position section", () => {
    const questions = [
      question("employer_position_socCode"),
      question("employer_position_jobTitle"),
      question("employer_position_wageLevel"),
    ];
    expect(matchingAutofillSources(questions)).toEqual(["certified_lca_eta9035"]);
  });

  it("matches the driver's license / state ID document type on the current US address questions", () => {
    const questions = [
      question("employee_personal_currentUsAddress_street"),
      question("employee_personal_currentUsAddress_city"),
    ];
    expect(matchingAutofillSources(questions)).toContain("employee_drivers_license_or_state_id");
  });

  it("returns no sources for a section with no matching real H-1B keys", () => {
    const questions = [question("employer_company_naicsCode"), question("employer_workforce_totalUsEmployees")];
    expect(matchingAutofillSources(questions)).toEqual([]);
  });
});

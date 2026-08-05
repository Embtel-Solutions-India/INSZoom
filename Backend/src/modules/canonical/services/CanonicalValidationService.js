const MappingResolver = require("../../form-mapping/services/MappingResolver");
const sectionValidators = require("./CanonicalSectionValidators");

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
}

function pendingConflicts(profileState = {}) {
  return (profileState.conflicts || []).filter((conflict) => conflict.status === "pending_review");
}

function splitIssues(sectionResults = []) {
  const errors = [];
  const warnings = [];
  const missingFields = [];
  sectionResults.forEach((section) => {
    (section.issues || []).forEach((issue) => {
      const item = { section: section.section, ...issue };
      if (issue.code === "FIELD_REQUIRED" || issue.code === "REQUIRED_DOCUMENT_MISSING") {
        missingFields.push({ path: issue.path, section: section.section, severity: issue.severity || "error", suggestedFix: issue.suggestedFix });
      }
      if ((issue.severity || "error") === "error") errors.push(item);
      else warnings.push(item);
    });
  });
  return { errors, warnings, missingFields };
}

function completeness(sectionResults = []) {
  const sectionCompleteness = sectionResults.reduce((acc, section) => {
    acc[section.section] = {
      percent: clamp(section.percent),
      completedFields: section.completedFields,
      totalFields: section.totalFields,
      missingFields: section.missingFields,
      requiredFields: section.requiredFields,
    };
    return acc;
  }, {});
  const totalFields = sectionResults.reduce((sum, section) => sum + (section.totalFields || 0), 0);
  const completedFields = sectionResults.reduce((sum, section) => sum + (section.completedFields || 0), 0);
  const documentSection = sectionCompleteness.documents || { percent: 0 };
  return {
    overall: totalFields ? clamp((completedFields / totalFields) * 100) : 100,
    sections: sectionCompleteness,
    totalFields,
    completedFields,
    missingPercent: totalFields ? clamp(((totalFields - completedFields) / totalFields) * 100) : 0,
    documentPercent: documentSection.percent,
  };
}

function readiness({ completenessScore, errors, warnings, conflicts }) {
  const blocking = errors.length;
  const conflictCount = conflicts.length;
  const warningPenalty = Math.min(20, warnings.length * 2);
  const conflictPenalty = Math.min(25, conflictCount * 5);
  const errorPenalty = Math.min(60, blocking * 12);
  const readinessScore = clamp(completenessScore - warningPenalty - conflictPenalty - errorPenalty);
  return {
    readinessScore,
    readyForQuestionnaireReview: completenessScore >= 60,
    readyForCaseManagerReview: completenessScore >= 75 && blocking === 0,
    readyForAttorneyReview: completenessScore >= 85 && blocking === 0 && conflictCount === 0,
    readyForForms: completenessScore >= 85 && blocking === 0 && conflictCount === 0,
    readyForUSCISForms: completenessScore >= 85 && blocking === 0 && conflictCount === 0,
    readyForFiling: completenessScore >= 95 && blocking === 0 && conflictCount === 0,
    readyForSubmission: completenessScore >= 98 && blocking === 0 && conflictCount === 0,
    readyForAIPetitionDrafting: completenessScore >= 80 && blocking === 0,
    readyForFilingPackageGeneration: completenessScore >= 90 && blocking === 0,
  };
}

function suggestedFixes(errors = [], warnings = [], missingFields = []) {
  const fixes = [...errors, ...warnings, ...missingFields]
    .map((item) => ({
      code: item.code || "SUGGESTED_FIX",
      section: item.section,
      path: item.path,
      message: item.suggestedFix || item.message,
      severity: item.severity || (errors.includes(item) ? "error" : "warning"),
    }))
    .filter((item) => item.path || item.message);
  const seen = new Set();
  return fixes.filter((fix) => {
    const key = `${fix.code}:${fix.path}:${fix.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function duplicateIdentityWarnings(profile = {}) {
  const warnings = [];
  const passport = MappingResolver.resolvePath(profile, "person.passport.number");
  const alienNumber = MappingResolver.resolvePath(profile, "person.alienNumber");
  const familyMembers = [
    ...(Array.isArray(profile.family?.members) ? profile.family.members : []),
    ...(Array.isArray(profile.family?.dependents) ? profile.family.dependents : []),
  ];
  if (passport && familyMembers.some((member) => member.passportNumber && String(member.passportNumber).toUpperCase() === String(passport).toUpperCase())) {
    warnings.push({ code: "DUPLICATE_PASSPORT", path: "person.passport.number", severity: "warning", message: "Passport number also appears on a family member record", suggestedFix: "Verify passport ownership" });
  }
  if (alienNumber && familyMembers.some((member) => member.alienNumber && String(member.alienNumber).toUpperCase() === String(alienNumber).toUpperCase())) {
    warnings.push({ code: "DUPLICATE_ALIEN_NUMBER", path: "person.alienNumber", severity: "warning", message: "Alien number also appears on a family member record", suggestedFix: "Verify alien number ownership" });
  }
  return warnings;
}

class CanonicalValidationService {
  // async: DocumentsValidator (CanonicalSectionValidators.js) awaits the
  // shared document-requirement resolver (DB-first, config-fallback) — every
  // other section validator here is a plain sync function, so wrapping them
  // all in Promise.all is a no-op for those and awaits only the one that
  // actually needs it.
  static async validate(profileState = {}, options = {}) {
    const profile = profileState.profile || profileState;
    const conflicts = pendingConflicts(profileState);
    const sectionResults = await Promise.all(sectionValidators.map((Validator) => Validator.validate(profile, profileState, options)));
    const duplicateWarnings = duplicateIdentityWarnings(profile);
    if (duplicateWarnings.length) {
      sectionResults.push({
        section: "conflictDetection",
        totalFields: duplicateWarnings.length,
        completedFields: 0,
        missingFields: 0,
        requiredFields: 0,
        percent: 0,
        issues: duplicateWarnings,
      });
    }
    const { errors, warnings, missingFields } = splitIssues(sectionResults);
    conflicts.forEach((conflict) => warnings.push({
      code: "CANONICAL_CONFLICT_PENDING",
      path: conflict.path,
      conflictId: conflict.conflictId,
      severity: "warning",
      message: `${conflict.path} has conflicting source values`,
      suggestedFix: "Resolve the field conflict",
    }));
    const completenessSummary = completeness(sectionResults);
    const readinessSummary = readiness({ completenessScore: completenessSummary.overall, errors, warnings, conflicts });
    const validationStatus = errors.length ? "invalid" : conflicts.length ? "needs_review" : "valid";
    return {
      valid: errors.length === 0,
      validationStatus,
      status: validationStatus,
      completeness: completenessSummary.overall,
      completenessSummary,
      sectionResults,
      sectionCompleteness: completenessSummary.sections,
      warnings,
      errors,
      blockingErrors: errors,
      missingFields,
      fieldConflicts: conflicts,
      conflicts,
      conflictCount: conflicts.length,
      suggestedFixes: suggestedFixes(errors, warnings, missingFields),
      readiness: readinessSummary,
      readinessScore: readinessSummary.readinessScore,
      readyForForms: readinessSummary.readyForForms,
      checkedAt: new Date(),
    };
  }
}

module.exports = CanonicalValidationService;

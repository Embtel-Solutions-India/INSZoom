const MappingResolver = require("../../form-mapping/services/MappingResolver");
const { evidenceCatalog } = require("../config/eligibilityRules");

class EvidenceAssessmentService {
  static isPresent(value) {
    if (value === undefined || value === null || value === "") return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return true;
  }

  static strengthFor(value) {
    if (!this.isPresent(value)) return "missing";
    if (Array.isArray(value) && value.length >= 3) return "strong";
    if (typeof value === "object" && (value.confidence >= 80 || value.value)) return value.confidence >= 80 ? "strong" : "available";
    return "available";
  }

  static assess(canonicalData = {}) {
    const evidence = {};
    Object.entries(evidenceCatalog).forEach(([key, paths]) => {
      const sources = paths
        .map((path) => ({ path, value: MappingResolver.resolvePath(canonicalData, path) }))
        .filter((item) => this.isPresent(item.value));
      evidence[key] = {
        key,
        available: sources.length > 0,
        strength: sources.some((item) => this.strengthFor(item.value) === "strong") ? "strong" : sources.length ? "available" : "missing",
        sources: sources.map((item) => item.path),
        sourceCount: sources.length,
      };
    });
    return evidence;
  }
}

module.exports = EvidenceAssessmentService;

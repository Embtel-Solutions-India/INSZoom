const Counter = require("../models/Counter");

/**
 * Generates human-readable case numbers.
 *
 * Format:
 *   Parent/single cases:  B001, B002, B003 ...
 *   Child cases:          B001-A, B001-B ... B001-Z, B001-AA, B001-AB ...
 *
 * IMPORTANT:
 * - caseNumber is for DISPLAY ONLY. All DB relationships use ObjectId.
 * - Never use caseNumber to infer relationships between cases.
 * - The 'B' prefix is configurable via CASE_NUMBER_PREFIX env var.
 */
class CaseNumberService {
  /**
   * Generates the next sequential parent/single case number.
   * @returns {Promise<string>} e.g. 'B001'
   */
  static async nextPrincipalCaseNumber() {
    const prefix = process.env.CASE_NUMBER_PREFIX || "B";
    const seq = await Counter.nextValue("caseNumber");
    return `${prefix}${String(seq).padStart(3, "0")}`;
  }

  /**
   * PHASE 4 — generates the next sequential Lead number.
   * Format: L-001, L-002, L-003 ...
   * Uses the same Counter collection as case numbers, with its own key
   * ('leadNumber') so the two sequences never collide or share a count.
   * Neither existing lead-creation path (lead.service.js's createLead() or
   * createQuizLead()) generates a leadNumber today — confirmed by reading
   * both functions before adding this — so this is purely additive.
   * @returns {Promise<string>} e.g. 'L-001'
   */
  static async nextLeadNumber() {
    const seq = await Counter.nextValue("leadNumber");
    return `L-${String(seq).padStart(3, "0")}`;
  }

  /**
   * Generates a child case number for a given parent case number and index.
   * @param {string} parentCaseNumber - e.g. 'B001'
   * @param {number} index - zero-based index (0 = 'A', 1 = 'B', ...)
   * @returns {string} e.g. 'B001-A'
   */
  static childCaseNumber(parentCaseNumber, index) {
    return `${parentCaseNumber}-${CaseNumberService.indexToSuffix(index)}`;
  }

  /**
   * Converts a zero-based index to an alphabetic suffix.
   * 0='A', 1='B' ... 25='Z', 26='AA', 27='AB', etc.
   * @param {number} index
   * @returns {string}
   */
  static indexToSuffix(index) {
    let suffix = "";
    let n = index;
    do {
      suffix = String.fromCharCode(65 + (n % 26)) + suffix;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return suffix;
  }
}

module.exports = CaseNumberService;

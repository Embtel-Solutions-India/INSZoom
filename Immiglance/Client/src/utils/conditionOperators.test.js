import { describe, it, expect } from "vitest";
import { compareValue, evaluateCondition } from "./questionnaireEngine";

// The server's condition evaluator (Backend condition-evaluator.js) accepts not_empty / empty. A rule using them used to
// never match here, so the portal hid a document the server still required ("Required questionnaire fields are incomplete").
describe("condition operators shared with the server", () => {
  it("not_empty / empty behave as exists / missing", () => {
    expect(compareValue("India", "not_empty")).toBe(true);
    expect(compareValue("", "not_empty")).toBe(false);
    expect(compareValue(undefined, "empty")).toBe(true);
    expect(compareValue("x", "empty")).toBe(false);
  });

  it("PERM's degree-evaluation rule is satisfied for a non-U.S. institution only", () => {
    const rule = { mode: "all", groups: [], rules: [
      { questionKey: "country", operator: "not_empty" },
      { questionKey: "country", operator: "not_equals", value: "United States" },
    ] };
    expect(evaluateCondition(rule, { country: "India" })).toBe(true);
    expect(evaluateCondition(rule, { country: "United States" })).toBe(false);
    expect(evaluateCondition(rule, {})).toBe(false);
  });
});

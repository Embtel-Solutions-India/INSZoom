import { describe, expect, it } from "vitest";
import { caseCategoryLabel } from "./caseCategoryLabel";

describe("caseCategoryLabel", () => {
  it("shows the subtype for an Indian Timeline case", () => {
    expect(caseCategoryLabel({ visaCategory: "indian_timeline", visaType: "INDIAN-PASSPORT-RENEWAL", petitionType: "Adult Indian Passport Holder" })).toBe("Adult Indian Passport Holder");
    expect(caseCategoryLabel({ visaCategory: "indian_timeline", visaType: "OCI", petitionType: "  OCI RENUNCIATION  " })).toBe("OCI RENUNCIATION");
  });

  it("falls back to the visa type name when the Indian Timeline case has no subtype", () => {
    expect(caseCategoryLabel({ visaCategory: "indian_timeline", visaType: "OCI", petitionType: "" })).toBe("OCI");
    expect(caseCategoryLabel({ visaCategory: "indian_timeline", visaType: "OCI" })).toBe("OCI");
    expect(caseCategoryLabel({ visaCategory: "indian_timeline", visaType: "OCI", petitionType: 42 })).toBe("OCI");
    expect(caseCategoryLabel({ visaCategory: "indian_timeline" })).toBe("");
  });

  it("returns every other visa category exactly as it was (no other visa is affected)", () => {
    for (const visaCategory of ["employment_based", "family_based", "non_immigrant", "Not Selected", "", undefined, null]) {
      expect(caseCategoryLabel({ visaCategory, visaType: "H-1B", petitionType: "New H-1B" })).toBe(visaCategory);
    }
  });

  it("never throws on missing data", () => {
    expect(caseCategoryLabel(undefined)).toBeUndefined();
    expect(caseCategoryLabel(null)).toBeUndefined();
    expect(caseCategoryLabel({})).toBeUndefined();
  });
});

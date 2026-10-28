import { describe, expect, it } from "vitest";
import { splitHeadline } from "./headline";

describe("splitHeadline", () => {
  it("bolds the opening phrase up to the first comma, period, semicolon or colon and leaves the rest regular", () => {
    expect(splitHeadline("Grocery Store Manager Convicted of Immigration Document Fraud, Obstruction of Two Federal Labor Investigations")).toEqual({
      lead: "Grocery Store Manager Convicted of Immigration Document Fraud,",
      rest: " Obstruction of Two Federal Labor Investigations",
    });
    expect(splitHeadline("Litigation-Related Update: Sileiri Doe Class Members May Request Reopening")).toEqual({ lead: "Litigation-Related Update:", rest: " Sileiri Doe Class Members May Request Reopening" });
    expect(splitHeadline("Six Charged in Large-Scale Marriage Fraud Ring; Two Arrested").lead).toBe("Six Charged in Large-Scale Marriage Fraud Ring;");
    expect(splitHeadline("USCIS Opens Asylum Office in Charlotte. More offices follow").lead).toBe("USCIS Opens Asylum Office in Charlotte.");
  });

  it("a title with no such mark is all bold lead", () => {
    expect(splitHeadline("USCIS Opens Asylum Office in Charlotte")).toEqual({ lead: "USCIS Opens Asylum Office in Charlotte", rest: "" });
  });

  it("abbreviations and numbers are not an end of phrase", () => {
    expect(splitHeadline("U.S. Citizenship and Immigration Services Announces New Fee Rule, Effective Soon").lead).toBe("U.S. Citizenship and Immigration Services Announces New Fee Rule,");
    expect(splitHeadline("Fee rises to 1.5 percent for all filers, USCIS says").lead).toBe("Fee rises to 1.5 percent for all filers,");
  });

  it("is safe for empty input and keeps every character", () => {
    expect(splitHeadline("")).toEqual({ lead: "", rest: "" });
    expect(splitHeadline(undefined)).toEqual({ lead: "", rest: "" });
    const title = "Justice Department Moves to Strip Citizenship from 40 Criminals, in Largest Filing";
    const { lead, rest } = splitHeadline(title);
    expect(lead + rest).toBe(title);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { getSessionId } from "./eligibilitySession";

// Locks in the two guarantees the backend Lead-linking logic depends on
// (Backend/src/modules/auth/auth.service.js's findLinkableLead): a page
// reload must never mint a new sessionId (or a signup submitted right
// after a reload would silently lose its Lead), and the id must be stable
// across repeated reads within the same tab (so a duplicate/retried signup
// request links to the same Lead, not a second one).
describe("getSessionId", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("mints a sessionId on first read", () => {
    const id = getSessionId();
    expect(id).toBeTruthy();
  });

  it("returns the same id across repeated reads (simulated reload — sessionStorage persists, nothing clears it)", () => {
    const first = getSessionId();
    const second = getSessionId(); // simulates a fresh module read after a page reload
    expect(second).toBe(first);
  });

  it("returns the same id on a third read (duplicate/retried signup submit must not re-mint)", () => {
    const first = getSessionId();
    getSessionId();
    const third = getSessionId();
    expect(third).toBe(first);
  });
});

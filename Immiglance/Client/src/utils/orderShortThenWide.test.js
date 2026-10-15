import { describe, expect, it } from "vitest";
import { orderShortThenWide } from "./questionnaireEngine";

// Short cards together first (they pair up two to a row), wide ones together after, requested items on top - no short card stranded between two wide ones.
const q = (key, extra = {}) => ({ key, label: key, type: "text", ...extra });
const longLabel = "Criterion 2: Evidence that the beneficiary has achieved national or international recognition for achievements evidenced by critical reviews";

describe("orderShortThenWide", () => {
  it("moves short questions together ahead of the wide ones, keeping each group's own order", () => {
    const list = [q("wide_a", { label: longLabel }), q("short_1"), q("wide_b", { type: "textarea" }), q("short_2"), q("wide_c", { type: "address" }), q("short_3")];
    expect(orderShortThenWide(list).map((x) => x.key)).toEqual(["short_1", "short_2", "short_3", "wide_a", "wide_b", "wide_c"]);
  });

  it("keeps items the case manager requested at the very top, whatever their size", () => {
    const requestedWide = q("req_wide", { label: longLabel, metadata: { requestedByStaff: { requestId: "r1" } } });
    const requestedShort = q("req_short", { metadata: { requestedByStaff: { requestId: "r2" } } });
    const list = [q("wide", { type: "textarea" }), q("short"), requestedWide, requestedShort];
    expect(orderShortThenWide(list).map((x) => x.key)).toEqual(["req_wide", "req_short", "short", "wide"]);
  });

  it("works on wrapper items through a getter, treats a missing question as short, and never mutates its input", () => {
    const items = [{ id: "a", question: q("x", { type: "textarea" }) }, { id: "b" }, { id: "c", question: q("y") }];
    const copy = [...items];
    expect(orderShortThenWide(items, (item) => item.question).map((item) => item.id)).toEqual(["b", "c", "a"]);
    expect(items).toEqual(copy);
    expect(orderShortThenWide(undefined)).toEqual([]);
  });
});

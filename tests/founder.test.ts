import { describe, expect, it } from "vitest";
import { isHiddenMaker, resolveFounder, type RawMaker } from "@/lib/founder";

const HIDDEN: RawMaker = { id: "0", name: "[REDACTED]", username: "[REDACTED]" };
const iris: RawMaker = { id: "9001", name: "Iris Tu", username: "iris_tu" };
const akash: RawMaker = { id: "55", name: "Akash Mandal", username: "see_akash" };

describe("hidden maker detection (PRD F11)", () => {
  it("C7: lower-case [redacted] is hidden", () => {
    expect(isHiddenMaker({ id: "12", name: "[redacted]", username: "x" })).toBe(true);
  });
  it("trims spaces around [REDACTED]", () => {
    expect(isHiddenMaker({ id: "12", name: "  [REDACTED] ", username: "x" })).toBe(true);
  });
  it("a redacted username alone hides the maker", () => {
    expect(isHiddenMaker({ id: "12", name: "Iris", username: "[REDACTED]" })).toBe(true);
  });
  it("C8: missing name is hidden", () => {
    expect(isHiddenMaker({ id: "12", name: null, username: "x" })).toBe(true);
  });
  it("empty name is hidden", () => {
    expect(isHiddenMaker({ id: "12", name: "   ", username: "x" })).toBe(true);
  });
  it("C9: id '0' (text) is hidden even with a real name", () => {
    expect(isHiddenMaker({ id: "0", name: "Iris Tu", username: "iris_tu" })).toBe(true);
  });
  it("id 0 as a number is hidden", () => {
    expect(isHiddenMaker({ id: 0, name: "Iris Tu", username: "iris_tu" })).toBe(true);
  });
  it("a normal maker is visible", () => {
    expect(isHiddenMaker(iris)).toBe(false);
  });
});

describe("founder display (PRD F12, test spec section C)", () => {
  it("C1: one visible maker", () => {
    const f = resolveFounder([iris]);
    expect(f.label).toBe("Iris Tu");
    expect(f.founderSource).toBe("named");
  });
  it("C2: first listed is hidden, first visible is used", () => {
    expect(resolveFounder([HIDDEN, iris]).label).toBe("Iris Tu +1 more");
  });
  it("C3: five makers, four hidden", () => {
    const f = resolveFounder([HIDDEN, HIDDEN, HIDDEN, HIDDEN, iris]);
    expect(f.label).toBe("Iris Tu +4 more");
    expect(f.hiddenCount).toBe(4);
  });
  it("C4: all hidden", () => {
    const f = resolveFounder([HIDDEN, HIDDEN, HIDDEN]);
    expect(f.label).toBe("Founder not listed");
    expect(f.founderSource).toBe("none");
    expect(f.hiddenCount).toBe(3);
  });
  it("C5: empty or missing list", () => {
    expect(resolveFounder([]).label).toBe("Founder not listed");
    expect(resolveFounder(null).label).toBe("Founder not listed");
    expect(resolveFounder(undefined).founderSource).toBe("none");
  });
  it("C6: two visible makers", () => {
    expect(resolveFounder([akash, iris]).label).toBe("Akash Mandal +1 more");
  });
  it("C10: the text [REDACTED] never appears in any output", () => {
    for (const makers of [[HIDDEN], [HIDDEN, iris], [], [HIDDEN, HIDDEN, akash]]) {
      expect(JSON.stringify(resolveFounder(makers)).toUpperCase()).not.toContain("REDACTED");
    }
  });
  it("only visible makers are kept in the output", () => {
    const f = resolveFounder([HIDDEN, akash, iris]);
    expect(f.visibleMakers.map((m) => m.name)).toEqual(["Akash Mandal", "Iris Tu"]);
  });
});

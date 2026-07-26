import { describe, expect, it } from "vitest";
import { titleFromId } from "../bookTitle";

describe("titleFromId", () => {
  it("title-cases a simple id", () => {
    expect(titleFromId("moby_dick")).toBe("Moby Dick");
  });

  it("title-cases a multi-word id", () => {
    expect(titleFromId("paradise_lost")).toBe("Paradise Lost");
  });

  it("handles a single-word id", () => {
    expect(titleFromId("inferno")).toBe("Inferno");
  });

  it("collapses stray double underscores", () => {
    expect(titleFromId("moby__dick")).toBe("Moby Dick");
  });
});

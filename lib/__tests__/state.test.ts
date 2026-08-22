import { describe, expect, it } from "vitest";
import { normalizeState, DEFAULT_STATE } from "../state";

describe("normalizeState", () => {
  it("produces the default state for null", () => {
    expect(normalizeState(null)).toEqual(DEFAULT_STATE);
  });

  it("produces the default state for an empty object", () => {
    expect(normalizeState({})).toEqual(DEFAULT_STATE);
  });

  it("produces the default state when accumulatedPauseMinutes is not a number", () => {
    expect(normalizeState({ accumulatedPauseMinutes: "NaN-string" })).toEqual(DEFAULT_STATE);
  });

  it("passes a valid state through unchanged", () => {
    const valid = {
      mode: { type: "single", book: "moby-dick" },
      pausedAt: "2026-01-01T12:00:00.000Z",
      accumulatedPauseMinutes: 42,
      intervalMinutes: 10,
      tickBase: 7,
      intervalSetAtAwakeMinutes: 123,
      epoch: "2026-07-06T09:45:56.000Z",
    };
    expect(normalizeState(valid)).toEqual(valid);
  });

  it("normalizes an unparseable pausedAt to null", () => {
    const state = normalizeState({ pausedAt: "garbage" });
    expect(state.pausedAt).toBeNull();
  });
});

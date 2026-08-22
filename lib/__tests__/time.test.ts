import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeAwakeMinutes, computeGlobalTick } from "../time";
import { normalizeState, type ControlState } from "../state";

const originalEnv = {
  START_TIME: process.env.START_TIME,
  BUILD_TIME: process.env.BUILD_TIME,
  INTERVAL_MINUTES: process.env.INTERVAL_MINUTES,
  QUIET_HOURS_START: process.env.QUIET_HOURS_START,
  QUIET_HOURS_END: process.env.QUIET_HOURS_END,
  QUIET_HOURS_TZ: process.env.QUIET_HOURS_TZ,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key as keyof typeof originalEnv];
    else process.env[key as keyof typeof originalEnv] = value;
  }
}

const START = "2026-01-01T00:00:00.000Z";

const baseState: ControlState = {
  mode: { type: "cycle" },
  pausedAt: null,
  accumulatedPauseMinutes: 0,
  intervalMinutes: null,
  tickBase: 0,
  intervalSetAtAwakeMinutes: null,
  epoch: null,
};

describe("computeGlobalTick", () => {
  beforeEach(() => {
    process.env.START_TIME = START;
    delete process.env.BUILD_TIME;
    delete process.env.QUIET_HOURS_START;
    delete process.env.QUIET_HOURS_END;
    delete process.env.QUIET_HOURS_TZ;
  });

  afterEach(() => {
    restoreEnv();
  });

  it("with no anchor, returns floor(awake / interval)", () => {
    process.env.INTERVAL_MINUTES = "5";
    const now = new Date("2026-01-01T00:37:00.000Z"); // 37 awake minutes
    expect(computeAwakeMinutes(now, baseState)).toBe(37);
    expect(computeGlobalTick(now, baseState)).toBe(Math.floor(37 / 5));
  });

  it("anchors the tick across a 5 -> 10 minute interval switch so position doesn't jump", () => {
    process.env.INTERVAL_MINUTES = "5";
    const switchMoment = new Date("2026-01-01T02:03:00.000Z"); // 123 awake minutes

    const stateBefore: ControlState = { ...baseState, intervalMinutes: 5 };
    const tickBefore = computeGlobalTick(switchMoment, stateBefore);

    // Mirror what applyFlags does in app/api/control/route.ts at the moment of the switch.
    const stateAfterSwitch: ControlState = {
      ...stateBefore,
      tickBase: computeGlobalTick(switchMoment, stateBefore),
      intervalSetAtAwakeMinutes: computeAwakeMinutes(switchMoment, stateBefore),
      intervalMinutes: 10,
    };

    // Continuity: the tick at the exact moment of the switch must not change.
    expect(computeGlobalTick(switchMoment, stateAfterSwitch)).toBe(tickBefore);

    // After 10 more awake minutes at the new 10-minute interval, exactly one more tick.
    const tenMinutesLater = new Date(switchMoment.getTime() + 10 * 60_000);
    expect(computeGlobalTick(tenMinutesLater, stateAfterSwitch)).toBe(tickBefore + 1);
  });

  // Regression: the board froze on a single frame for ~17 days. `accumulatedPauseMinutes`
  // persists in config/state.json, but the epoch it was measured against does not — with
  // START_TIME unset the epoch is BUILD_TIME, which is re-stamped on every deploy, and every
  // /api/control change commits to main and triggers a redeploy. The debt then exceeded the
  // elapsed time, the clamp in computeAwakeMinutes pinned awake to 0, and the tick stuck at 0.
  it("keeps advancing when a persisted pause debt outlives the epoch it was measured against", () => {
    process.env.INTERVAL_MINUTES = "5";
    delete process.env.START_TIME;
    process.env.BUILD_TIME = "2026-08-21T16:51:13.000Z"; // last redeploy

    const state: ControlState = { ...baseState, accumulatedPauseMinutes: 15164 };

    const now = new Date("2026-08-22T12:00:00.000Z");
    const anHourLater = new Date("2026-08-22T13:00:00.000Z");

    expect(computeAwakeMinutes(now, state)).toBeGreaterThan(0);
    expect(computeGlobalTick(anHourLater, state)).toBeGreaterThan(computeGlobalTick(now, state));
  });

  it("honours the pause debt normally when the epoch is old enough to have earned it", () => {
    process.env.INTERVAL_MINUTES = "5";
    delete process.env.START_TIME;
    delete process.env.BUILD_TIME;

    // Epoch pinned in the state file, well before the pause was taken.
    const state: ControlState = {
      ...baseState,
      epoch: "2026-07-06T09:45:56.000Z",
      accumulatedPauseMinutes: 15164,
    };
    const now = new Date("2026-08-22T12:00:00.000Z");

    const rawElapsed = Math.floor((now.getTime() - Date.parse(state.epoch!)) / 60_000);
    expect(computeAwakeMinutes(now, state)).toBe(rawElapsed - 15164);
  });

  it("prefers the state epoch over START_TIME and BUILD_TIME", () => {
    process.env.INTERVAL_MINUTES = "5";
    process.env.START_TIME = "2026-05-01T00:00:00.000Z";
    process.env.BUILD_TIME = "2026-08-21T16:51:13.000Z";

    const state: ControlState = { ...baseState, epoch: "2026-08-22T11:00:00.000Z" };
    const now = new Date("2026-08-22T12:00:00.000Z");

    expect(computeAwakeMinutes(now, state)).toBe(60);
  });

  it("falls back to START_TIME, then BUILD_TIME, when no epoch is pinned", () => {
    process.env.INTERVAL_MINUTES = "5";
    const now = new Date("2026-08-22T12:00:00.000Z");

    process.env.START_TIME = "2026-08-22T10:00:00.000Z";
    process.env.BUILD_TIME = "2026-08-22T11:00:00.000Z";
    expect(computeAwakeMinutes(now, baseState)).toBe(120);

    delete process.env.START_TIME;
    expect(computeAwakeMinutes(now, baseState)).toBe(60);
  });

  it("skips an unparseable epoch instead of poisoning the clock with NaN", () => {
    process.env.INTERVAL_MINUTES = "5";
    delete process.env.START_TIME;
    process.env.BUILD_TIME = "2026-08-22T11:00:00.000Z";

    const state: ControlState = { ...baseState, epoch: "not-a-date" };
    expect(computeAwakeMinutes(new Date("2026-08-22T12:00:00.000Z"), state)).toBe(60);
  });
});

describe("normalizeState — interval fields", () => {
  it("accepts intervalMinutes of 5 or 10", () => {
    expect(normalizeState({ intervalMinutes: 5 }).intervalMinutes).toBe(5);
    expect(normalizeState({ intervalMinutes: 10 }).intervalMinutes).toBe(10);
  });

  it("rejects invalid intervalMinutes values, falling back to null", () => {
    expect(normalizeState({ intervalMinutes: 7 }).intervalMinutes).toBeNull();
    expect(normalizeState({ intervalMinutes: "banana" }).intervalMinutes).toBeNull();
    expect(normalizeState({ intervalMinutes: -5 }).intervalMinutes).toBeNull();
  });

  it("accepts a finite non-negative tickBase, else defaults to 0", () => {
    expect(normalizeState({ tickBase: 42 }).tickBase).toBe(42);
    expect(normalizeState({ tickBase: -1 }).tickBase).toBe(0);
    expect(normalizeState({ tickBase: "banana" }).tickBase).toBe(0);
    expect(normalizeState({ tickBase: NaN }).tickBase).toBe(0);
  });

  it("accepts a parseable ISO epoch, else defaults to null", () => {
    expect(normalizeState({ epoch: "2026-07-06T09:45:56.000Z" }).epoch).toBe(
      "2026-07-06T09:45:56.000Z"
    );
    expect(normalizeState({ epoch: "banana" }).epoch).toBeNull();
    expect(normalizeState({ epoch: 12345 }).epoch).toBeNull();
    expect(normalizeState({}).epoch).toBeNull();
  });

  it("accepts a finite non-negative intervalSetAtAwakeMinutes, else defaults to null", () => {
    expect(normalizeState({ intervalSetAtAwakeMinutes: 100 }).intervalSetAtAwakeMinutes).toBe(100);
    expect(normalizeState({ intervalSetAtAwakeMinutes: -1 }).intervalSetAtAwakeMinutes).toBeNull();
    expect(
      normalizeState({ intervalSetAtAwakeMinutes: "banana" }).intervalSetAtAwakeMinutes
    ).toBeNull();
  });
});

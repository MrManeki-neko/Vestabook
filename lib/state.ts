import fs from "node:fs";
import path from "node:path";
import { pauseMinutesBetween } from "./quietHours";

export type BookMode = { type: "cycle" } | { type: "single"; book: string } | { type: "random" };

export interface ControlState {
  mode: BookMode;
  pausedAt: string | null;
  accumulatedPauseMinutes: number;
  intervalMinutes: number | null;
  tickBase: number;
  intervalSetAtAwakeMinutes: number | null;
  // Clock epoch, pinned here rather than read from the environment so it lives in the same
  // durable store as accumulatedPauseMinutes. See resolveEpoch in lib/time.ts.
  epoch: string | null;
}

export const DEFAULT_STATE: ControlState = {
  mode: { type: "cycle" },
  pausedAt: null,
  accumulatedPauseMinutes: 0,
  intervalMinutes: null,
  tickBase: 0,
  intervalSetAtAwakeMinutes: null,
  epoch: null,
};

// Coerce untrusted JSON (the state file may have been hand-edited) into a valid
// ControlState, substituting defaults for anything missing or malformed. This is the only
// gate between external state and the arithmetic in getPauseAdjustmentMinutes — it must
// guarantee pausedAt parses as a date and accumulatedPauseMinutes is a finite number.
export function normalizeState(raw: unknown): ControlState {
  const state: ControlState = {
    mode: { type: "cycle" },
    pausedAt: null,
    accumulatedPauseMinutes: 0,
    intervalMinutes: null,
    tickBase: 0,
    intervalSetAtAwakeMinutes: null,
    epoch: null,
  };
  if (!raw || typeof raw !== "object") return state;
  const r = raw as Record<string, unknown>;

  const mode = r.mode as Record<string, unknown> | null | undefined;
  if (mode && typeof mode === "object") {
    if (mode.type === "single" && typeof mode.book === "string") {
      state.mode = { type: "single", book: mode.book };
    } else if (mode.type === "random") {
      state.mode = { type: "random" };
    }
  }

  if (typeof r.pausedAt === "string" && !Number.isNaN(Date.parse(r.pausedAt))) {
    state.pausedAt = r.pausedAt;
  }

  if (
    typeof r.accumulatedPauseMinutes === "number" &&
    Number.isFinite(r.accumulatedPauseMinutes) &&
    r.accumulatedPauseMinutes >= 0
  ) {
    state.accumulatedPauseMinutes = r.accumulatedPauseMinutes;
  }

  if (r.intervalMinutes === 5 || r.intervalMinutes === 10) {
    state.intervalMinutes = r.intervalMinutes;
  }

  if (
    typeof r.tickBase === "number" &&
    Number.isFinite(r.tickBase) &&
    r.tickBase >= 0
  ) {
    state.tickBase = r.tickBase;
  }

  if (
    typeof r.intervalSetAtAwakeMinutes === "number" &&
    Number.isFinite(r.intervalSetAtAwakeMinutes) &&
    r.intervalSetAtAwakeMinutes >= 0
  ) {
    state.intervalSetAtAwakeMinutes = r.intervalSetAtAwakeMinutes;
  }

  if (typeof r.epoch === "string" && !Number.isNaN(Date.parse(r.epoch))) {
    state.epoch = r.epoch;
  }

  return state;
}

const STATE_PATH = path.join(process.cwd(), "config", "state.json");

let cached: ControlState | null = null;

export function getState(): ControlState {
  if (!cached) {
    try {
      cached = normalizeState(JSON.parse(fs.readFileSync(STATE_PATH, "utf-8")));
    } catch {
      cached = normalizeState(null);
    }
  }
  return cached;
}

export function isPausedNow(): boolean {
  return getState().pausedAt !== null;
}

// Minutes to subtract from raw elapsed time: everything accumulated from past pause/resume
// cycles, plus (if currently paused) the still-ongoing gap since `pausedAt`. Pure variant
// parameterized by state so callers (e.g. /api/control) can run this against a state fetched
// from GitHub rather than the locally-deployed one.
export function getPauseAdjustmentMinutesFor(now: Date, state: ControlState): number {
  let minutes = state.accumulatedPauseMinutes;
  if (state.pausedAt) {
    minutes += pauseMinutesBetween(new Date(state.pausedAt), now);
  }
  return minutes;
}

export function getPauseAdjustmentMinutes(now: Date): number {
  return getPauseAdjustmentMinutesFor(now, getState());
}

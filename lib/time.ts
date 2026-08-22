import { awakeMinutesElapsed, getQuietHoursConfig } from "./quietHours";
import { getPauseAdjustmentMinutesFor, getState, type ControlState } from "./state";

// A single integer clock, shared by every mode in lib/sequencer.ts: how many
// INTERVAL_MINUTES-sized ticks have elapsed since the clock epoch (see resolveEpoch below),
// excluding quiet-hours minutes and manually-paused minutes. This is the only place "now"
// enters the pagination logic.
//
// computeAwakeMinutes/computeGlobalTick are pure functions of (now, state) so /api/control
// can compute ticks against the GitHub-fetched state (which may be ahead of what's locally
// deployed) rather than only against the locally-cached getState().

// The epoch every awake-minute is counted from. `state.epoch` wins because it lives in the
// same git-committed file as accumulatedPauseMinutes/intervalSetAtAwakeMinutes: the debt and
// the epoch it was measured against must stay in one frame of reference. START_TIME is a
// stable env override. BUILD_TIME is a last resort only — next.config.mjs re-stamps it on
// every build, and /api/control commits to main, so every control action redeploys and moves
// it. Unparseable values are skipped rather than poisoning the clock with NaN.
export function resolveEpoch(state: ControlState): Date {
  for (const candidate of [state.epoch, process.env.START_TIME, process.env.BUILD_TIME]) {
    if (!candidate) continue;
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(0);
}

export function computeAwakeMinutes(now: Date, state: ControlState): number {
  const startTime = resolveEpoch(state);

  const quietCfg = getQuietHoursConfig();
  let elapsedMinutes = quietCfg
    ? awakeMinutesElapsed(startTime, now, quietCfg)
    : Math.floor((now.getTime() - startTime.getTime()) / 60_000);
  if (elapsedMinutes < 0) elapsedMinutes = 0;

  // A pause cannot have started before the epoch, so the debt can never legitimately exceed
  // the time since it. When it does, the epoch has moved (an unpinned BUILD_TIME) while the
  // debt persisted in config/state.json. Subtracting it would clamp the clock to zero and
  // freeze the board on frame 0 until the debt aged out — so drop the debt as stale instead.
  const pauseMinutes = getPauseAdjustmentMinutesFor(now, state);
  if (pauseMinutes > elapsedMinutes) return elapsedMinutes;

  return elapsedMinutes - pauseMinutes;
}

function effectiveIntervalMinutes(state: ControlState): number {
  if (state.intervalMinutes === 5 || state.intervalMinutes === 10) return state.intervalMinutes;
  const parsedInterval = Number(process.env.INTERVAL_MINUTES);
  return Number.isFinite(parsedInterval) && parsedInterval > 0 ? parsedInterval : 5;
}

export function computeGlobalTick(now: Date, state: ControlState): number {
  const interval = effectiveIntervalMinutes(state);
  const awake = computeAwakeMinutes(now, state);

  if (state.intervalSetAtAwakeMinutes === null) {
    return Math.floor(awake / interval);
  }

  return (
    state.tickBase + Math.floor(Math.max(0, awake - state.intervalSetAtAwakeMinutes) / interval)
  );
}

export function getGlobalTick(): number {
  return computeGlobalTick(new Date(), getState());
}

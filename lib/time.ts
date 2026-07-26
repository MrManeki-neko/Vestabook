import { awakeMinutesElapsed, getQuietHoursConfig } from "./quietHours";
import { getPauseAdjustmentMinutesFor, getState, type ControlState } from "./state";

// A single integer clock, shared by every mode in lib/sequencer.ts: how many
// INTERVAL_MINUTES-sized ticks have elapsed since START_TIME, excluding quiet-hours minutes
// and manually-paused minutes. This is the only place "now" enters the pagination logic.
//
// computeAwakeMinutes/computeGlobalTick are pure functions of (now, state) so /api/control
// can compute ticks against the GitHub-fetched state (which may be ahead of what's locally
// deployed) rather than only against the locally-cached getState().

export function computeAwakeMinutes(now: Date, state: ControlState): number {
  let startTime = new Date(process.env.START_TIME || process.env.BUILD_TIME || 0);
  if (Number.isNaN(startTime.getTime())) {
    // START_TIME was set but unparseable — fall back rather than poisoning the clock with NaN
    startTime = new Date(process.env.BUILD_TIME || 0);
  }
  if (Number.isNaN(startTime.getTime())) startTime = new Date(0);

  const quietCfg = getQuietHoursConfig();
  let elapsedMinutes = quietCfg
    ? awakeMinutesElapsed(startTime, now, quietCfg)
    : Math.floor((now.getTime() - startTime.getTime()) / 60_000);

  elapsedMinutes -= getPauseAdjustmentMinutesFor(now, state);
  if (elapsedMinutes < 0) elapsedMinutes = 0;

  return elapsedMinutes;
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

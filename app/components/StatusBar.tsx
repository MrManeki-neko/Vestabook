"use client";

import type { Mode } from "./types";

interface StatusBarProps {
  title: string;
  frameIndex: number;
  totalFrames: number;
  mode: Mode;
  paused: boolean;
  quietHours: boolean;
}

function modeLabel(mode: Mode): string {
  switch (mode) {
    case "single":
      return "Single";
    case "random":
      return "Shuffle";
    case "cycle":
    default:
      return "Cycle";
  }
}

export default function StatusBar({
  title,
  frameIndex,
  totalFrames,
  mode,
  paused,
  quietHours,
}: StatusBarProps) {
  const pct = totalFrames > 0 ? Math.min(100, Math.max(0, ((frameIndex + 1) / totalFrames) * 100)) : 0;

  return (
    <div className="status-bar">
      <div className="status-top">
        <div className="status-title">{title}</div>
        <div className="status-frame">
          Frame {(frameIndex + 1).toLocaleString()} of {totalFrames.toLocaleString()}
        </div>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="status-badges">
        {paused && <span className="badge badge-paused">⏸ PAUSED</span>}
        {quietHours && <span className="badge badge-quiet">🌙 QUIET HOURS</span>}
        <span className="badge badge-mode">{modeLabel(mode)}</span>
      </div>
    </div>
  );
}

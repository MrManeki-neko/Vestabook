"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Board from "./components/Board";
import StatusBar from "./components/StatusBar";
import Controls from "./components/Controls";
import SettingsSheet, { getStoredDongle, setStoredDongle } from "./components/SettingsSheet";
import Toast from "./components/Toast";
import type { StatusResponse } from "./components/types";

const STATUS_POLL_MS = 60_000;
const PENDING_POLL_MS = 5_000;
const PENDING_TIMEOUT_MS = 90_000;
const PENDING_SLOW_MS = 35_000;

type PendingCheck = (status: StatusResponse) => boolean;

interface PendingState {
  label: string;
  check: PendingCheck;
  startedAt: number;
  slow: boolean;
}

export default function Home() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingState | null>(null);

  const pendingRef = useRef<PendingState | null>(null);
  const pendingTimersRef = useRef<{ poll?: ReturnType<typeof setTimeout>; slow?: ReturnType<typeof setTimeout> }>(
    {}
  );
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const pendingActionRef = useRef<{ params: URLSearchParams; label: string; check: PendingCheck } | null>(null);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 4000);
  }, []);

  const fetchStatus = useCallback(async (): Promise<StatusResponse | null> => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as StatusResponse;
      setStatus(data);
      setLoading(false);
      return data;
    } catch {
      showToast("Couldn't reach the board — will keep retrying.");
      return null;
    }
  }, [showToast]);

  const clearPendingTimers = useCallback(() => {
    if (pendingTimersRef.current.poll) clearTimeout(pendingTimersRef.current.poll);
    if (pendingTimersRef.current.slow) clearTimeout(pendingTimersRef.current.slow);
    pendingTimersRef.current = {};
  }, []);

  const pollUntilApplied = useCallback(
    (check: PendingCheck, startedAt: number) => {
      const tick = async () => {
        const data = await fetchStatus();
        const elapsed = Date.now() - startedAt;
        if (data && check(data)) {
          clearPendingTimers();
          pendingRef.current = null;
          setPending(null);
          return;
        }
        if (elapsed >= PENDING_TIMEOUT_MS) {
          clearPendingTimers();
          pendingRef.current = null;
          setPending(null);
          showToast("Taking longer than usual — check back shortly.");
          return;
        }
        pendingTimersRef.current.poll = setTimeout(tick, PENDING_POLL_MS);
      };
      pendingTimersRef.current.poll = setTimeout(tick, PENDING_POLL_MS);
    },
    [fetchStatus, clearPendingTimers, showToast]
  );

  const beginPending = useCallback(
    (label: string, check: PendingCheck) => {
      clearPendingTimers();
      const startedAt = Date.now();
      const next: PendingState = { label, check, startedAt, slow: false };
      pendingRef.current = next;
      setPending(next);
      pendingTimersRef.current.slow = setTimeout(() => {
        setPending((cur) => (cur ? { ...cur, slow: true } : cur));
      }, PENDING_SLOW_MS);
      pollUntilApplied(check, startedAt);
    },
    [pollUntilApplied, clearPendingTimers]
  );

  const runControl = useCallback(
    async (params: URLSearchParams, label: string, check: PendingCheck) => {
      const dongle = getStoredDongle();
      if (!dongle) {
        pendingActionRef.current = { params, label, check };
        setSettingsError(null);
        setSettingsOpen(true);
        return;
      }
      params.set("dongle", dongle);
      try {
        const res = await fetch(`/api/control?${params.toString()}`, { cache: "no-store" });
        if (res.status === 401) {
          setSettingsError("Secret code incorrect");
          setSettingsOpen(true);
          return;
        }
        if (!res.ok) {
          showToast("That control request failed. Please try again.");
          return;
        }
        beginPending(label, check);
      } catch {
        showToast("Couldn't reach the control endpoint — check your connection.");
      }
    },
    [beginPending, showToast]
  );

  // Initial load + normal 60s poll + refresh on visibility/focus.
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => {
      if (!pendingRef.current) fetchStatus();
    }, STATUS_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && !pendingRef.current) fetchStatus();
    };
    const onFocus = () => {
      if (!pendingRef.current) fetchStatus();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      clearPendingTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectBook = (id: string) => {
    const params = new URLSearchParams({ book: id });
    runControl(params, `Switching to ${id}`, (s) => s.mode === "single" && s.bookId === id);
  };

  const handleShuffle = () => {
    const params = new URLSearchParams({ random: "true" });
    runControl(params, "Shuffling", (s) => s.mode === "random");
  };

  const handleCycle = () => {
    const params = new URLSearchParams({ random: "false" });
    runControl(params, "Auto-cycling", (s) => s.mode === "cycle");
  };

  const handleTogglePause = () => {
    const nextPaused = !(status?.paused ?? false);
    const params = new URLSearchParams({ pause: String(nextPaused) });
    runControl(params, nextPaused ? "Pausing" : "Resuming", (s) => s.paused === nextPaused);
  };

  const handleSetInterval = (minutes: 5 | 10) => {
    const params = new URLSearchParams({ interval: String(minutes) });
    runControl(
      params,
      `Setting ${minutes}-minute pace`,
      (s) => s.intervalMinutes === minutes
    );
  };

  const handleSettingsSave = (secret: string) => {
    setStoredDongle(secret);
    setSettingsOpen(false);
    setSettingsError(null);
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    if (action && secret) {
      // Re-run the control action that triggered the settings prompt.
      runControl(action.params, action.label, action.check);
    }
  };

  const activeBook = status?.books.find((b) => b.id === status.bookId);
  const title = activeBook?.title ?? status?.bookId ?? "Loading…";

  return (
    <div className="app-shell">
      <div className="top-bar">
        <h1>VESTABOOK</h1>
        <button
          type="button"
          className="gear-btn"
          aria-label="Settings"
          onClick={() => {
            setSettingsError(null);
            setSettingsOpen(true);
          }}
        >
          ⚙
        </button>
      </div>

      <Board frame={status?.frame ?? []} loading={loading} />

      {status ? (
        <StatusBar
          title={title}
          frameIndex={status.frameIndex}
          totalFrames={status.totalFrames}
          mode={status.mode}
          paused={status.paused}
          quietHours={status.quietHours}
        />
      ) : (
        <div className="status-bar">
          <div className="status-top">
            <div className="status-title">Loading…</div>
          </div>
        </div>
      )}

      {status && (
        <Controls
          books={status.books}
          mode={status.mode}
          activeBookId={status.bookId}
          paused={status.paused}
          intervalMinutes={status.intervalMinutes}
          pending={pending !== null}
          pendingSlow={pending?.slow ?? false}
          onSelectBook={handleSelectBook}
          onShuffle={handleShuffle}
          onCycle={handleCycle}
          onTogglePause={handleTogglePause}
          onSetInterval={handleSetInterval}
        />
      )}

      <p className="footer-note">
        Updates every {status?.intervalMinutes ?? "—"} min
      </p>

      <SettingsSheet
        open={settingsOpen}
        errorMessage={settingsError}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSettingsSave}
      />

      <Toast message={toastMessage} />
    </div>
  );
}

import { NextRequest, NextResponse } from "next/server";
import { listBookIds } from "@/lib/library";
import { normalizeState, type ControlState } from "@/lib/state";
import { pauseMinutesBetween } from "@/lib/quietHours";
import { secretMatches } from "@/lib/auth";
import { computeAwakeMinutes, computeGlobalTick, resolveEpoch } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_PATH = "config/state.json";
const MAX_ATTEMPTS = 3;

interface GithubContentResponse {
  content: string;
  sha: string;
}

async function githubContents(method: "GET" | "PUT", body?: Record<string, unknown>) {
  const repo = process.env.GITHUB_REPO;
  return fetch(`https://api.github.com/repos/${repo}/contents/${STATE_PATH}?ref=main`, {
    method,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
}

function applyFlags(
  current: ControlState,
  flags: { book: string | null; random: string | null; pause: string | null; interval: string | null },
  now: Date
): ControlState {
  const next: ControlState = { ...current };

  // Pin the clock epoch into the state file the first time we write it. Left unpinned it
  // falls back to BUILD_TIME, which is re-stamped on every build — and every write here
  // commits to main and redeploys — so the epoch would drift away from the pause debt
  // recorded below and strand the board on a single frame.
  if (!next.epoch) {
    next.epoch = resolveEpoch(current).toISOString();
  }

  if (flags.book) {
    next.mode = { type: "single", book: flags.book };
  } else if (flags.random === "true") {
    next.mode = { type: "random" };
  } else if (flags.random === "false") {
    next.mode = { type: "cycle" };
  }

  if (flags.pause === "true" && !next.pausedAt) {
    next.pausedAt = now.toISOString();
  } else if (flags.pause === "false" && next.pausedAt) {
    next.accumulatedPauseMinutes += pauseMinutesBetween(new Date(next.pausedAt), now);
    next.pausedAt = null;
  }

  if (flags.interval === "5" || flags.interval === "10") {
    const newInterval = Number(flags.interval);
    const envInterval = Number(process.env.INTERVAL_MINUTES) || 5;
    const currentEffective = current.intervalMinutes ?? envInterval;
    if (newInterval !== currentEffective) {
      next.tickBase = computeGlobalTick(now, current);
      next.intervalSetAtAwakeMinutes = computeAwakeMinutes(now, current);
      next.intervalMinutes = newInterval;
    }
  }

  return next;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const dongle = searchParams.get("dongle");
  if (!secretMatches(dongle, process.env.CONTROL_DONGLE_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const flags = {
    book: searchParams.get("book"),
    random: searchParams.get("random"),
    pause: searchParams.get("pause"),
    interval: searchParams.get("interval"),
  };

  if (!flags.book && !flags.random && !flags.pause && !flags.interval) {
    return NextResponse.json({ error: "no_flags_provided" }, { status: 400 });
  }

  for (const name of ["random", "pause"] as const) {
    const value = flags[name];
    if (value !== null && value !== "true" && value !== "false") {
      return NextResponse.json(
        { error: "invalid_flag_value", flag: name, allowed: ["true", "false"] },
        { status: 400 }
      );
    }
  }

  if (flags.interval !== null && flags.interval !== "5" && flags.interval !== "10") {
    return NextResponse.json(
      { error: "invalid_flag_value", flag: "interval", allowed: ["5", "10"] },
      { status: 400 }
    );
  }

  const validIds = listBookIds();
  if (flags.book && !validIds.includes(flags.book)) {
    return NextResponse.json({ error: "unknown_book", validIds }, { status: 400 });
  }

  // Optimistic-concurrency loop: the GitHub Contents API can reject a PUT with 409 if the
  // sha moved between our GET and PUT (another write landed, or a cache served a stale sha).
  // Re-reading and retrying is the standard fix rather than trusting a single sha round-trip.
  let lastFailure: NextResponse | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let getRes: Response;
    try {
      getRes = await githubContents("GET");
    } catch (err) {
      return NextResponse.json(
        { error: "github_unreachable", detail: String(err) },
        { status: 504 }
      );
    }
    if (!getRes.ok) {
      const body = await getRes.text();
      return NextResponse.json(
        { error: "github_read_failed", status: getRes.status, body },
        { status: 502 }
      );
    }
    const current = (await getRes.json()) as GithubContentResponse;
    const currentState = normalizeState(
      JSON.parse(Buffer.from(current.content, "base64").toString("utf-8"))
    );

    const nextState = applyFlags(currentState, flags, new Date());

    // Committing an unchanged state would trigger a pointless Vercel redeploy.
    if (JSON.stringify(nextState) === JSON.stringify(currentState)) {
      return NextResponse.json({ ok: true, unchanged: true, newState: nextState });
    }

    let putRes: Response;
    try {
      putRes = await githubContents("PUT", {
        message: "vestabook: update control state via /api/control",
        content: Buffer.from(JSON.stringify(nextState, null, 2) + "\n", "utf-8").toString(
          "base64"
        ),
        sha: current.sha,
        branch: "main",
      });
    } catch (err) {
      return NextResponse.json(
        { error: "github_unreachable", detail: String(err) },
        { status: 504 }
      );
    }

    if (putRes.ok) {
      return NextResponse.json({
        ok: true,
        newState: nextState,
        note: "Committed to main; Vercel will redeploy automatically (usually 15-30s) before this takes effect.",
      });
    }

    const body = await putRes.text();
    lastFailure = NextResponse.json(
      { error: "github_write_failed", status: putRes.status, body },
      { status: 502 }
    );
    if (putRes.status !== 409) break;
  }

  return lastFailure!;
}

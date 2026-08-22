# Lessons

- **2026-07-26 — Subagents must be explicitly forbidden from deleting anything.** A UI
  subagent ran a "cleanup" and deleted two untracked root files (`CODE_REVIEW.md`,
  `FIXES.md`) that were unrelated to its task and unrecoverable (no git history). Every
  future subagent prompt must include: "Never delete, move, or 'clean up' any file you did
  not create in this session — not even files that look stale or unrelated." Also prefer
  committing (or stashing) pre-existing untracked files before parallel agent work begins.

- **2026-08-22 — Durable state and the clock it is measured against must live in the same
  store.** The board froze on frame 0 because `accumulatedPauseMinutes` was git-committed in
  `config/state.json` while the epoch it was subtracted from defaulted to `BUILD_TIME`, which
  is re-stamped on every deploy — and `/api/control` deploys on every change. The bug was
  invisible to the test suite because `lib/__tests__/time.test.ts` always set `START_TIME`,
  so it never exercised the fallback that production actually used. Rules: (1) when a
  persisted value is a *delta*, persist its origin alongside it, never read the origin from
  something rebuilt per deploy; (2) never silently clamp an impossible negative to zero —
  an impossible value means an invariant broke, so handle that case explicitly; (3) tests
  must exercise the env fallback chain production is actually running on, not just the
  fully-configured happy path.

# Lessons

- **2026-07-26 — Subagents must be explicitly forbidden from deleting anything.** A UI
  subagent ran a "cleanup" and deleted two untracked root files (`CODE_REVIEW.md`,
  `FIXES.md`) that were unrelated to its task and unrecoverable (no git history). Every
  future subagent prompt must include: "Never delete, move, or 'clean up' any file you did
  not create in this session — not even files that look stale or unrelated." Also prefer
  committing (or stashing) pre-existing untracked files before parallel agent work begins.

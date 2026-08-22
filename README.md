# vestabook

Runs a whole book on a physical [Vestaboard](https://www.vestaboard.com/), advancing to the
next chunk of text on a timer. Deployed on Vercel, no database, no admin UI, no scheduler of
its own — a third-party cron service (cron-job.org) is what drives it forward.

Live: https://vestabook.vercel.app

## Remote control PWA

The home page is an installable, mobile-first remote control. Open the live URL on a phone
and add it to the home screen (iPhone: Safari → Share → **Add to Home Screen**; Android:
Chrome → ⋮ → **Add to Home screen** / "Install app") and it launches full-screen like a
native app.

It shows a live replica of the board — a 6×22 grid of split-flap tiles that flips when the
text changes — plus the current book, position ("Frame 214 of 4,880"), and PAUSED / QUIET
HOURS badges. Controls: pick a book, Shuffle (random book each time one finishes),
Auto-cycle, Pause/Resume, and page-turn pace (5 or 10 minutes).

All controls go through `/api/control` (below), so they need the dongle secret: tap the ⚙
gear and enter `CONTROL_DONGLE_SECRET` once — it's kept in the browser's localStorage.
Because control changes ride a git commit + Vercel redeploy, the app shows an "Applying…"
state and polls until the change lands (~15–30 s). The read-only view (board, status) needs
no secret at all.

There's a one-page manual for non-technical users in [`docs/USER_MANUAL.md`](docs/USER_MANUAL.md).

## Design: no database, no stored position

The current frame is computed purely from elapsed time:

```
frameIndex = floor((now - startTime) / (INTERVAL_MINUTES * 60_000)) % totalFrames
```

There's no row in a database saying "we're on frame 42." That means:

- Every instance (and every cold start) agrees on the current frame without coordination.
- Restarting the app, redeploying, or scaling to multiple instances doesn't lose your place.
- If quiet hours or a manual pause are active (see below), progression pauses during that
  window and resumes with the next section afterward — it does not skip ahead, because the
  "elapsed time" the frame index is based on excludes those minutes entirely (`lib/time.ts`).

Book *selection* (which book, or random, or forced) can't follow that same "purely
computed" rule, though — it's a choice made from outside, at an arbitrary moment, and has to
be remembered until it's changed again. See **Book library & `/api/control`** below for how
that's done without a database.

## How it works

1. **Pagination** (`lib/paginate.ts`, runs per book and is cached):
   - Each `content/<id>.txt` is read, smart quotes/dashes are normalized to ASCII, whitespace
     is collapsed, and the whole thing is uppercased (the physical board is uppercase-only).
   - Gutenberg footnote markers (e.g., `[1]`, `[2]`), underscore/asterisk emphasis markup,
     and accented capital letters (È, Æ, etc.) are stripped or transliterated to plain ASCII
     so they don't render as blank tiles on the board.
   - Text is word-wrapped to 22 characters per line (Vestaboard's column count). Words longer
     than 22 characters are wrapped across multiple lines instead of being truncated.
   - Lines are grouped into frames of up to 6 lines (Vestaboard's row count), but the cut
     point prefers the last line in the window that ends in `.`, `,`, or `;` — so a 5-minute
     refresh lands on a clause boundary instead of mid-sentence. Only falls back to a hard
     6-line cut when no such punctuation appears anywhere in the window. Frames with fewer
     than 6 lines are vertically centered: blank padding lines are split between the top and
     bottom of the frame rather than grouped only at the bottom.
2. **`GET /api/tick`** — the only endpoint that writes to the board:
   - Requires header `X-Tick-Secret` matching the `TICK_SECRET` env var; returns `401` if
     missing/wrong.
   - Skips (no push, no board change) if currently paused or in quiet hours — see below.
   - Otherwise resolves the current `(book, frame)` via `lib/sequencer.ts` and encodes each
     line into Vestaboard's character-code table (`lib/vestaboardCodes.ts`).
   - POSTs `{"characters": [...]}` to the Vestaboard Cloud API. Returns `502` with the
     upstream error body if Vestaboard rejects the request (e.g. bad `VESTABOARD_TOKEN`).
3. **`GET /api/preview`** — no auth, returns the current frame as 6 lines of plain text, plus
   `X-Book-Id` / `X-Frame-Index` / `X-Quiet-Hours` / `X-Paused` headers. Use this to
   sanity-check pagination or debug timing without touching the real board.
4. **`GET /api/status`** — no auth, everything the PWA renders in one JSON payload: current
   `bookId`/`frameIndex`/`totalFrames`, the frame's 6 lines, `mode` (`cycle`/`single`/`random`),
   `paused`, `quietHours`, the effective `intervalMinutes`, and the book list with titles and
   frame counts.
5. **`GET /api/control`** — dongle-gated, changes which book/mode is showing. See below.

## Book library & `/api/control`

Every `content/*.txt` file is a book, identified by its filename minus `.txt` (e.g.
`content/moby_dick.txt` → id `moby_dick`). Currently shipped: `paradise_lost`, `moby_dick`,
`inferno`. Add a book by committing a new `.txt` file — no code changes needed.

With no book forced, the app auto-cycles through every book in the library in order, looping
back to the first once the last one finishes. `GET /api/control` changes that:

```
GET /api/control?book=moby_dick&dongle=<CONTROL_DONGLE_SECRET>   # force one book, loops it forever
GET /api/control?random=true&dongle=<CONTROL_DONGLE_SECRET>      # reroll to a new random book each time one finishes
GET /api/control?random=false&dongle=<CONTROL_DONGLE_SECRET>     # back to auto-cycle
GET /api/control?pause=true&dongle=<CONTROL_DONGLE_SECRET>       # freeze progression
GET /api/control?pause=false&dongle=<CONTROL_DONGLE_SECRET>      # resume exactly where it paused
GET /api/control?interval=5&dongle=<CONTROL_DONGLE_SECRET>       # turn the page every 5 minutes
GET /api/control?interval=10&dongle=<CONTROL_DONGLE_SECRET>      # turn the page every 10 minutes
```

Flags can be combined in one request (e.g. `?book=moby_dick&pause=true&dongle=...`); only the
flags you pass are changed, everything else is left as-is. Invalid flag values (e.g. `?random=banana`
or `?interval=7`) return a `400` error. Requests that don't change the state skip the GitHub
commit, avoiding pointless redeploys.

Changing `interval` doesn't just swap the divisor in `floor(awakeMinutes / interval)` — that
would jump the board to a different point in the book the instant the new interval took effect.
Instead, `/api/control` anchors the switch: it records the current tick and the current
awake-minutes count at the moment of the change (`tickBase` / `intervalSetAtAwakeMinutes` in
`config/state.json`), and every tick after that is computed relative to that anchor. The board
lands on the exact same frame the moment the switch takes effect, then advances at the new pace.
This also means the cron job hitting `/api/tick` can keep firing every 5 minutes regardless of
the configured interval: at a 10-minute interval, every other tick just re-pushes the same frame
to the board, which is harmless.

**Why this needs a git commit, not just a request:** `/api/tick` deliberately takes no query
params — cron-job.org always hits the same bare URL, forever. So a choice made by visiting
`/api/control` has to be remembered independently, for an arbitrary amount of time, until
changed again. With no database and no API to edit Vercel env vars, the only "no database"
option left is the one this project already uses for the book text itself: a file tracked in
git. `/api/control` reads `config/state.json` via the GitHub Contents API, merges in your
flags, and commits it straight to `main` — which Vercel's git integration then redeploys
automatically, the same as pushing a new book file by hand. That means **changes take
15-30 seconds to actually reach the board** (the length of a redeploy), not instantly, and
every flag change adds a commit to the repo's history. `random` mode itself needs no state
beyond "random is on" — which book is "currently" showing is computed the same way frame
index is: deterministically from elapsed time, so every server instance agrees without
comparing notes (see `lib/sequencer.ts`).

## Env vars (set in Vercel dashboard — changes require a redeploy to take effect)

| Var | Required | Notes |
| --- | --- | --- |
| `VESTABOARD_TOKEN` | yes | Vestaboard Cloud API token (Read/Write scope) |
| `TICK_SECRET` | yes | Shared secret; cron-job.org must send it as `X-Tick-Secret` |
| `INTERVAL_MINUTES` | no | Defaults to `5`. Must match the cron-job.org schedule |
| `START_TIME` | no | ISO timestamp. Only a fallback — the clock epoch normally lives in `config/state.json` as `epoch` (see "The clock epoch" below). Last resort is `BUILD_TIME`, stamped into `next.config.mjs` at build |
| `QUIET_HOURS_START` | no | `HH:MM` (24h), local to `QUIET_HOURS_TZ`. Omit to disable quiet hours entirely |
| `QUIET_HOURS_END` | no | `HH:MM` (24h). Window can wrap midnight (e.g. `22:00`–`07:00`) |
| `QUIET_HOURS_TZ` | no | IANA timezone (e.g. `America/New_York`). Defaults to `UTC` |
| `CONTROL_DONGLE_SECRET` | yes (for `/api/control`) | Shared secret; must be passed as `?dongle=...` |
| `GITHUB_TOKEN` | yes (for `/api/control`) | Fine-grained PAT, Contents read/write scoped to this repo only |
| `GITHUB_REPO` | yes (for `/api/control`) | `MrManeki-neko/vestabook` |

## The clock epoch

Every frame index is `floor(awakeMinutesSinceEpoch / INTERVAL_MINUTES)`, and pausing the board
records a debt in `accumulatedPauseMinutes` that is subtracted from that count. Those two
numbers only agree if they are measured against the *same* epoch, so the epoch is pinned in
`config/state.json` as `epoch` — the same git-committed file the pause debt lives in.
`lib/time.ts:resolveEpoch` prefers `state.epoch`, then `START_TIME`, then `BUILD_TIME`.

**Do not rely on the `BUILD_TIME` fallback.** `next.config.mjs` re-stamps it on every build,
and `/api/control` commits to `main`, so every book/pause/interval change triggers a redeploy
that moves it forward. A pause debt persists across that reset, and once the debt exceeds the
time since the last deploy the clock is pinned at zero and the board freezes on frame 0 until
the debt ages out — silently, with `/api/tick` still returning `200`. That is exactly the
outage this field exists to prevent. `/api/control` pins `epoch` on its first write if it is
missing, and `computeAwakeMinutes` discards a pause debt larger than the elapsed time (which
is impossible unless the epoch has drifted) rather than clamping the clock to zero.

## cron-job.org setup

Create a job:
- **URL**: `https://<your-deployment>/api/tick` — use the real production domain, not a
  deleted/renamed project's old `*.vercel.app` alias (see Troubleshooting).
- **Method**: `GET`
- **Schedule**: every `INTERVAL_MINUTES` minutes
- **Headers**: `X-Tick-Secret: <TICK_SECRET>`

## Testing

Run `npm test` (vitest) to execute the test suite, which covers quiet-hours arithmetic,
pagination (word wrapping, punctuation-based framing, markup stripping), and state/env var
validation.

## Quiet hours / do-not-disturb

Set `QUIET_HOURS_START` / `QUIET_HOURS_END` / `QUIET_HOURS_TZ` to match whatever do-not-disturb
schedule you've configured in the Vestaboard app (there's no API to read that schedule back,
so it has to be entered here too). `lib/quietHours.ts` defines the window as a fixed daily
`HH:MM`–`HH:MM` range in that timezone.

With it configured:
- `GET /api/tick` checks the window first and, if it's currently quiet, returns
  `{"ok": true, "skipped": "quiet_hours"}` without calling the Vestaboard API at all.
- The shared clock (`getGlobalTick` in `lib/time.ts`) counts only "awake" minutes since
  `START_TIME` — quiet-hour minutes, on every day in the range, don't count toward advancing
  to the next frame. That's what makes it pause and resume with the next section rather than
  jumping ahead.
- `GET /api/preview` exposes the current state via an `X-Quiet-Hours: true/false` response
  header, for checking the window logic without waiting for a real quiet period.

Leave both unset (the default) to disable this — the app behaves as before, always awake.
Note: the awake/quiet calculation uses a single UTC-offset snapshot per request rather than
per-day DST-aware offsets, so there can be a few minutes of drift right around a DST
transition. Not worth the complexity for a hobby project.

## Manual pause (`/api/control?pause=true`)

Works the same way as quiet hours, but triggered by you instead of a fixed daily schedule:
`config/state.json` records a `pausedAt` timestamp when you pause, and accumulates the total
paused duration into `accumulatedPauseMinutes` when you unpause. `lib/time.ts` subtracts both
from elapsed time, so — like quiet hours — the board freezes on `pause=true` and resumes with
the exact next section on `pause=false`, rather than jumping ahead by however long it was
paused. `GET /api/tick` returns `{"ok": true, "skipped": "paused"}` while paused.

## Troubleshooting

- **`401` from `/api/tick`**: `X-Tick-Secret` header doesn't match `TICK_SECRET`. Check for
  trailing whitespace from copy-paste, and confirm you redeployed after setting/changing the
  env var (Vercel only applies env var changes on the next deploy).
- **`502` or `504` from `/api/tick`**: Vestaboard API error. A `502` means Vestaboard rejected
  the POST — usually a bad or expired `VESTABOARD_TOKEN`; the response body includes
  Vestaboard's error text. A `504` means the request timed out (10-second limit); check
  network connectivity or Vestaboard's API status.
- **`200` from `/api/tick` but the board doesn't update**: if the body is
  `{"skipped": "quiet_hours"}`, that's expected — it's currently inside the configured quiet
  window. Otherwise, double check the cron job's URL actually points at the current
  production domain — a renamed or deleted Vercel project can leave a stale `*.vercel.app`
  alias that still resolves and returns `200` without reaching this app at all.
- **Vercel build fails with `No Output Directory named "public" found"`**: the project's
  Framework Preset isn't set to Next.js. Settings → General → Build & Development Settings →
  Framework Preset → Next.js, then redeploy.
- **`401` from `/api/control`**: `?dongle=` doesn't match `CONTROL_DONGLE_SECRET`.
- **`400` from `/api/control`**: A flag was passed an invalid value (e.g., `?random=banana`).
  Valid values: `book=<id>` (any book ID in `content/`), `random=true/false`, `pause=true/false`.
- **`502` with `github_read_failed` or `github_write_failed` from `/api/control`**:
  `GITHUB_TOKEN` is missing/expired/wrong scope, or `GITHUB_REPO` doesn't match
  `owner/repo`. The token needs Contents read/write on this repo.
- **`502` with `github_write_failed` and a `409` status specifically**: the GitHub Contents
  API rejected the write because `config/state.json`'s sha moved between the read and the
  write (another control call landed first, or a cached read served a stale sha). The route
  already retries this automatically up to 3 times with a fresh `no-store` read each time
  (`app/api/control/route.ts`) — if you still see a 409 after that, something is writing to
  `config/state.json` very frequently, or GitHub's API is having a bad moment; just retry.
- **`/api/control` returns `ok: true` but the board doesn't reflect it yet**: expected for
  the first 15-30 seconds — it just committed to `main` and Vercel is redeploying. Check
  `/api/preview`'s `X-Book-Id` header once the new deployment is ready.

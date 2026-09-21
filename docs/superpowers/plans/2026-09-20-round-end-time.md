# Round End Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Every table in a round ends at the same instant, because EventTrinket
publishes the round end and every phone reads it.

**Architecture:** EventTrinket's existing timer writes its absolute
`expiryTime` to `/rounds/$sessionId`. The session id travels in the track
link. LifeTrinket subscribes and shows the wall-clock end time.

**Spec:** `docs/superpowers/specs/2026-09-19-eventtrinket-life-tracking-design.md` section 19

## Global Constraints

- Tracking must never degrade the life counter. No failure throws into React.
  No failure blocks a tap. Every failure path ends in no readout and silence.
- `useGameTracker.ts` is not modified by this plan. The subscription lives in
  a new hook. That file took four review rounds, and its effect dependency
  arrays and `eslint-disable` line are load bearing.
- Every new field on a persisted or transmitted schema is optional. A link or
  a game object written before this feature must keep working.
- Session id: 20 characters, the alphabet already in `trackIds.ts`.
- `/rounds/$sessionId` = `{ v: 1, end: <epoch ms>, exp: <epoch ms> }`.
- `end` and `exp` are both capped at `now + 43200000` in the rules.
- The phone compares `end` against server time via `.info/serverTimeOffset`.

## Rulings made before execution

1. **The subscription is a new hook, not an addition to `useGameTracker`.**
   `getTrackDatabase()` is a lazy singleton, so the second hook shares one
   socket. Cost: no extra connection. Benefit: the delicate file is untouched.
2. **A tracked round end ignores `settings.showTimer`.** Scanning the QR is an
   explicit opt in to the tournament's clock. A player who turned the timer
   off for a kitchen table game must still see when the round ends. This is
   the one place a tracked game overrides a device preference, and it is
   deliberate.
3. **Pause, Resume and Stop publish nothing.** Section 19.8.

---

### Task 1: The schemas (LifeTrinket)

**Files:** Modify `src/Types/Tracking.ts`, `src/Utils/tracking/trackLink.test.ts`

Add `r: z.string().length(TRACK_ID_LENGTH).optional()` to `trackLinkSchema`.
Add `roundNodeSchema`: `{ v: z.literal(1), end: z.number(), exp: z.number() }`.

Tests: a link with `r` round trips; a link without `r` still parses; an `r` of
the wrong length is rejected; `roundNodeSchema` rejects a missing `end`.

### Task 2: The rules (EventTrinket)

**Files:** Modify `database.rules.json`, `src/lib/databaseRules.test.ts`

A `rounds` block mirroring `live`: `.read` true per node, no listing,
`$other: false`, `v` fixed at 1, `end` and `exp` numbers capped at
`now + 43200000`, `.validate` requiring all three children.

Tests against the emulator: a read with the id succeeds; a list at `/rounds`
is denied; an unknown child is rejected; an `end` beyond the cap is rejected.

### Task 3: The session id (EventTrinket)

**Files:** Modify `src/types.ts`, `src/hooks/GameProvider.tsx`,
`src/lib/trackIds.ts`, `src/lib/trackIds.test.ts`

`gameSchema` gains `sessionId: z.optional(z.string())`. A tournament created
without one gets one minted on first use, and it persists with the game.
`buildTrackUrl` gains an optional `sessionId` that becomes the link's `r`.

### Task 4: The timer publishes (EventTrinket)

**Files:** Modify `src/Timer/Timer.tsx`, `src/lib/trackDb.ts` (or a new
`src/lib/roundEnd.ts`), tests for the pure part

`handleRestart` writes `{ v: 1, end: expiryTime, exp: end + margin }` to
`/rounds/$sessionId`. The session id comes from `?session=` first, then from
`GameProvider`. Neither present means no write and no error.

Keep the write out of the component: a pure `planRoundPublish(...)` that
returns the node or null, plus a thin writer. The pure part gets the tests.

### Task 5: The phone reads and shows it (LifeTrinket)

**Files:** Create `src/Hooks/useRoundEnd.ts`, modify
`src/Components/GameTimer/GameTimer.tsx`

`useRoundEnd(roundId)` returns `{ endAt: number | null }`. It subscribes to
`/rounds/$roundId` through the existing lazy database handle, corrects against
`.info/serverTimeOffset`, and returns null for every failure: no id, no node,
a node that does not parse, a denied read, a database that is not configured.

`GameTimer` shows the wall-clock end time when `endAt` is set, and removes the
countdown progress bar in that state. The expiry overlay fires at `endAt`.
With no `endAt` the component behaves exactly as it does today.

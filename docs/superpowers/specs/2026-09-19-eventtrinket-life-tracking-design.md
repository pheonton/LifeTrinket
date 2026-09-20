# EventTrinket live life tracking — design

**Date:** 2026-09-19
**Status:** Approved design. Not yet planned for implementation.
**Repositories:** `LifeTrinket` (writer) and `EventTrinket` (reader and archiver).

This spec lives in LifeTrinket. EventTrinket must link to it, because the
implementation changes both repositories.

---

## 1. Goal

EventTrinket must show how much life each player has in a tracked game, while
the game runs. The whole feature must stay inside the Firebase free tier, on a
project with no billing account.

### In scope

- EventTrinket mints one tracking ID per pairing and deep-links into LifeTrinket.
- LifeTrinket publishes coalesced life snapshots while the game runs.
- EventTrinket shows those snapshots live, and archives a record per finished game.
- Abandoned games archive after a grace period, and clean themselves up.

### Out of scope

- Authentication. Neither app has it, and this design does not add it.
- A spectator device that does not hold the tournament state.
- Automatic loss detection in LifeTrinket.
- Any Cloud Function. A function requires the Blaze plan and a billing card.

---

## 2. Cost analysis

The load is small, because only a deep-linked game syncs. The 47,000 weekly
Analytics events of LifeTrinket do not reach a database.

### Measured assumptions

| Quantity | Value |
|---|---|
| Tracked games at one time | under 10 |
| Players per tracked game | 2 |
| Life changes per game | about 150 |
| Writes per game, after a 3-second throttle | about 60 |
| Writes per event, 40 games | about 2,400 |
| Bytes per write | about 60 |

### Why the load splits across two products

Cloud Firestore bills each document read. A live listener costs one read per
change, per viewer. Realtime Database bills stored bytes and downloaded bytes
only, and counts no operations.

| | Firestore | Realtime Database |
|---|---|---|
| Writes | 20,000 / day | uncounted |
| Reads | 50,000 / day | uncounted |
| Storage | 1 GiB | 1 GB |
| Egress | 10 GiB / month | 10 GB / month |
| Connections | not limited | 100 simultaneous |

### The decision

- **Realtime Database holds the hot path.** High frequency, ephemeral, deleted after the game.
- **Firestore holds the cold path.** One permanent record per finished game.

Firestore therefore receives about 40 writes per event, not 2,400.

### Headroom

| Measure | Your load | Limit |
|---|---|---|
| Download per event, 5 listeners | about 2.4 MB | 10 GB / month |
| Events per day needed to exhaust it | about 137 | — |
| Connections, 10 tables plus organizer | 11 | 100 |
| Firestore writes per event | about 40 | 20,000 / day |
| Firestore storage per month | about 64 KB | 1 GiB |

The Firebase SDK multiplexes every listener over one websocket. The table count
therefore adds one connection per LifeTrinket device, and one for the organizer.

### The cost guarantee

The `draft-trinket` project has no billing account. The Spark plan rejects an
over-quota request. It cannot generate a charge.

---

## 3. Three Realtime Database features that decided the hot path

1. **`onDisconnect()`.** The server writes a value when a client drops. A closed
   tab marks the table offline with no client involved. Firestore has no equivalent.
2. **Partial-path writes.** `update({'p/1/l': 17})` sends and pushes only that
   field. A Firestore listener re-reads the whole document and pays a read.
3. **Latency.** Realtime Database is built for small frequent updates.

---

## 4. Code facts that shaped the design

These are properties of the current code. Verify them again before implementation.

| Fact | Location |
|---|---|
| `hasLost` is never set automatically. A human taps the lose button. | `LifeTrinket/src/Components/LifeCounter/LifeCounter.tsx:299` |
| A winner needs `settings.showMatchScore` and two or more players. | `LifeTrinket/src/Components/Views/Play.tsx:100-113` |
| `handleStay` clears every `hasLost` and the winner, so an end is reversible. | `LifeTrinket/src/Components/Views/Play.tsx` |
| The menu reset calls `resetCurrentGame()` and `setPlaying(false)`. | `LifeTrinket/src/Components/Players/PlayerMenu.tsx:159-162` |
| A URL hash already carries shared state through `lz-string`. | `LifeTrinket/src/Utils/shareState.ts` |
| Firebase is already initialized for Analytics only. | `LifeTrinket/src/Hooks/useAnalytics.ts` |
| The tournament lives in `localStorage`, not Firestore. | `EventTrinket/src/hooks/GameProvider.tsx` |
| A failed `gameSchema.safeParse` sets the game to `null`. | `EventTrinket/src/hooks/GameProvider.tsx` |
| Firestore holds only the `when` polls feature. | `EventTrinket/firestore.rules` |
| A pairing is identified by `player1.id` and `player2.id` in a match. | `EventTrinket/src/Matches.tsx` |

Two consequences:

- A game ends only when somebody taps. An abandoned game is common, so the
  design must reap it without human action.
- An end is reversible, so a node must survive an end for a while.

---

## 5. The tracking ID

EventTrinket mints it when the organizer starts tracking a pairing.

```ts
// 20 characters from a 55-character alphabet, about 115 bits of entropy
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const bytes = crypto.getRandomValues(new Uint8Array(20));
const gameId = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
```

The ID is the only secret. It is the Realtime Database node key and the
Firestore document ID.

The modulo introduces a small bias. At 115 bits the bias is immaterial, so
rejection sampling is not required.

---

## 6. The deep link

```
https://lifetrinket.web.app/#track=<lz-string payload>
```

Reuse `compressToEncodedURIComponent` from `src/Utils/shareState.ts`, for two
reasons:

1. It matches the existing `#game=` flow.
2. A URL fragment never reaches the server, so player names stay out of the
   Firebase Hosting logs.

```ts
type TrackLink = {
  v: 1;                    // link format version
  id: string;              // the tracking ID
  seats: string[];         // player names, in seat order
  life?: number;           // starting life, default 20
  label?: string;          // "Round 2 · Table 3", shown in LifeTrinket
};
```

Seat 0 is `player1` of the pairing. LifeTrinket seats the players in that order
and never reorders them.

`seats` holds 2 to 6 names. EventTrinket always sends 2, because a Swiss
pairing has two players. The node format supports 6, so a future pod format
needs no change here.

`life` overrides the local starting-life setting for a tracked game. If the link
omits it, LifeTrinket uses 20.

The database URL is **not** in the link. It is compiled into the LifeTrinket
build, so a link cannot point LifeTrinket at another database.

---

## 7. The live node

Path: `/live/{gameId}` in the `draft-trinket` Realtime Database, region
`europe-west1`. The region cannot be changed after creation.

```json
{
  "v": 1,
  "st": "live",
  "t0": 1758290000000,
  "exp": 1758300000000,
  "up": 1758290000000,
  "wr": "s7Kd2p",
  "p": [{ "l": 20 }, { "l": 17, "poi": 2 }]
}
```

| Key | Meaning |
|---|---|
| `v` | Node schema version |
| `st` | `live`, `offline` or `ended` |
| `t0` | Game start, server time. Written once, at node creation. |
| `exp` | Delete after this time. 6 hours while live, 30 minutes once ended. |
| `up` | Last update, server time |
| `off` | Time the client dropped. Written by `onDisconnect`. |
| `wr` | Writer session ID, for the two-writer guard |
| `w` | Winner seat index. Present only when `st` is `ended`. |
| `p` | Seat-indexed player state |

Per seat, `l` is the life total and is always present. `poi` (poison) and `cmd`
(highest commander damage received) appear only when that player has the counter
enabled. Both are lose conditions, so a board that shows only life can mislead.

**The node carries no names.** EventTrinket labels the seats from its own local
pairing data. No personal data reaches the server.

| Item | Size |
|---|---|
| Full node, 2 seats, life only | about 85 bytes |
| Full node, worst case the rules allow | about 350 bytes |
| One coalesced update | about 60 bytes |

---

## 8. The LifeTrinket write path

### 8.1 The write policy

A trailing-edge throttle, not a debounce. A debounce delays every change by the
full window, and that makes the board feel dead.

1. If more than 3 seconds passed since the last write, write at once.
2. Otherwise, schedule one write at the 3-second mark.
3. Collapse every change in that window into that one write.
4. If nothing changed, cancel the write.

The rate is capped at one write per 3 seconds per table. No heartbeat exists,
because `exp` is 6 hours and every write refreshes it. Idle traffic is zero.

### 8.2 The module interface

One hook holds every detail. Nothing else in the app touches Firebase.

```ts
// src/Hooks/useGameTracker.ts
export type TrackerStatus =
  | 'idle' | 'connecting' | 'live' | 'offline' | 'error';

export function useGameTracker(args: {
  gameId: string | null;
  players: Player[];
  winner: number | null;
}): {
  status: TrackerStatus;
  lastSentAt: number | null;
  forceUpdate: () => void;
};
```

`Play.tsx` calls it and passes its existing `winner` state.

### 8.3 New files

| File | Purpose |
|---|---|
| `src/Types/Tracking.ts` | Zod schemas for the link and the node |
| `src/Utils/tracking/trackLink.ts` | Parse and build `#track=` |
| `src/Utils/tracking/trackDb.ts` | Lazy Firebase app and database handle |
| `src/Utils/tracking/snapshot.ts` | `Player[]` to node payload, and the diff |
| `src/Hooks/useGameTracker.ts` | The hook above |

### 8.4 Changes to existing files

| File | Change |
|---|---|
| `src/Providers/GlobalSettingsProvider.tsx` | Read `#track=` on load, beside the `#game=` handling near line 146. Set up a two-player game from the link, then enter Play. |
| `src/Components/Views/Play.tsx` | Call `useGameTracker`. Render the status chip and the force button. |
| `.env.production` | Add the `draft-trinket` values. These are not secret. |
| `package.json` | Add vitest and a `test` script. |

### 8.5 The lazy import

`firebase/database` adds about 40 KB gzipped. Most users never track a game, and
the app must install and run offline. So `trackDb.ts` imports it dynamically,
and only when a game ID exists.

```ts
const { getDatabase } = await import('firebase/database');
const app = initializeApp(trackConfig, 'track');   // second named app
```

The existing `initializeApp` for `life-trinket` is untouched. The two apps
coexist, because the second one carries a name.

### 8.6 Server time

`exp` drives every cleanup, so a wrong device clock breaks it. Read the offset
once per connection.

```ts
onValue(ref(db, '.info/serverTimeOffset'), (s) => { offset = s.val() ?? 0; });
const serverNow = () => Date.now() + offset;
```

Every `exp` uses `serverNow()`. A wrong clock cannot plant an immortal node, and
cannot reap a live one.

### 8.7 Connection handling

Watch `.info/connected`. On every transition to `true`, do three things:

1. Re-register `onDisconnect`. A fired registration is consumed.
2. Write `st: 'live'` and refresh `exp`.
3. Send the full snapshot, because the node may have been reaped.

```ts
onDisconnect(node).update({ st: 'offline', off: serverNow() });
```

On `visibilitychange` to visible, write `st: 'live'`. This clears a spurious
offline state caused by a backgrounded mobile tab.

### 8.8 The end of a game

| Event | Write |
|---|---|
| `winner` becomes a seat index | `st: 'ended'`, `w: <seat>`, `exp: serverNow() + 30 min` |
| `handleStay` clears the winner | `st: 'live'`, `exp: serverNow() + 6 h` |
| The menu resets the game | `st: 'ended'`, `w: null`, then clear `trackedGame` locally |

Row two is the undo case. `hasLost` is a toggle, so an accidental lose tap must
be reversible on the board too.

On `pagehide`, flush the pending write. This is best effort, because a page
teardown can cut an async write. `onDisconnect` is the guarantee.

### 8.9 Resume

The hook persists `{ gameId, seats, label, t0, wr }` in `localStorage` under
`trackedGame`. `t0` must survive a reload, because every reconnect sends a full
snapshot and that snapshot must carry the original start time. LifeTrinket already keeps the full game state there. A reopened
tab reconnects to the same node and continues, with no link and no scan.

---

## 9. The EventTrinket read, grace and archive path

### 9.1 Where the tracking ID lives

```ts
export const pairingSchema = z.object({
  player1: gamePlayerSchema,
  player2: gamePlayerSchema,
  trackId: z.optional(z.string()),   // minted when tracking starts
});
```

**The field must be optional.** `GameProvider.tsx` runs `gameSchema.safeParse`
on the saved game, and a failed parse sets the game to `null`. A required field
would wipe a running tournament for every existing user on the next deploy.

### 9.2 The listener

EventTrinket subscribes to `/live/{trackId}` for every pairing in the current
round that holds a `trackId`.

### 9.3 The grace timer

```ts
const GRACE_MS = 15 * 60 * 1000;
```

A table is a candidate for archiving when either condition is true:

1. `st === 'ended'`.
2. `st === 'offline'` and `off + GRACE_MS < serverNow()`.

An interval evaluates condition 2 every 30 seconds, because no snapshot arrives
while a device is offline.

The board shows an offline table as greyed and **still live** during the grace.
It never shows it as finished.

The grace period is generous on purpose. A backgrounded mobile tab drops its
websocket, and iOS Safari does this aggressively. `onDisconnect` therefore fires
when a player answers a call or switches apps.

### 9.4 The archive record

Path: `/trackedGames/{trackId}` in the existing `draft-trinket` Firestore.

```ts
{
  v: 1,
  status: 'final' | 'abandoned',
  seats: [
    { name: 'Alice', tournamentPlayerId: 3 },
    { name: 'Bob',   tournamentPlayerId: 7 },
  ],
  life: [20, 0],
  poison: [0, 2] | null,
  commanderDamage: [0, 21] | null,
  winnerSeat: 0 | null,
  roundId: 1,
  startedAt: 1758290000000,   // copied from the node `t0`
  endedAt: 1758293600000,     // copied from the node `up` at archive time
  archivedAt: serverTimestamp(),
}
```

`roundId` comes from `match.id` in the EventTrinket game state. `seats` comes
from the local pairing. Every other field comes from the node.

The document ID is the tracking ID, so **the write is idempotent**. A resumed
game that later ends properly overwrites its own `abandoned` record with a
`final` one. EventTrinket keeps no local record of what it already archived.

Only EventTrinket writes this record, because only EventTrinket knows the round,
the pairing and the names. The Realtime Database never sees a name.

`trackedGames` has no TTL. At about 400 bytes per record and 160 records per
month, 1 GiB is never a constraint.

### 9.5 The sweep

Run it on app load and on each round change.

```ts
// EventTrinket holds every trackId in its own game state, on every pairing
// of every match. It never needs a query to find them.
for (const trackId of knownTrackIds) {
  const snap = await get(ref(rtdb, `live/${trackId}`));
  const node = snap.val();
  if (node && node.exp < serverNow()) {
    await remove(ref(rtdb, `live/${trackId}`));
  }
}
```

An ended game sets `exp` to 30 minutes, so it reaps inside the same session. An
abandoned game reaps after 6 hours, at the next organizer session. No server job
exists, and no orphan survives a later event.

### 9.6 New and changed files

| File | Change |
|---|---|
| `src/types.ts` | Add optional `trackId` to `pairingSchema` |
| `src/Matches.tsx` | Per-pairing "Track" button, and a live life readout per seat |
| `src/lib/trackDb.ts` | New. Realtime Database handle, beside the Firestore one |
| `src/hooks/useTrackedGames.ts` | New. Listeners, grace timer, archive and sweep |
| `firebase.json` | Add `database` rules and the emulator on port 9000 |
| `database.rules.json` | New. The rules in section 10.1 |
| `firestore.rules` | Add the `trackedGames` block from section 10.2 |

The "Track" button mints the ID, writes it to the pairing through the existing
`handleUpdatePairingStatsInMatch` path, builds the link, and opens it. Once the
ID exists, the button becomes a live life readout.

---

## 10. Security rules

### 10.1 Realtime Database

```json
{
  "rules": {
    ".read": false,
    ".write": false,

    "live": {
      "$gameId": {
        ".read": true,
        ".write": "newData.exists() || data.child('exp').val() < now",
        ".validate": "$gameId.length == 20 && newData.hasChildren(['v','st','t0','exp','up','wr','p'])",

        "v":   { ".validate": "newData.val() == 1" },
        "st":  { ".validate": "newData.val() == 'live' || newData.val() == 'offline' || newData.val() == 'ended'" },
        "exp": { ".validate": "newData.isNumber() && newData.val() > now && newData.val() <= now + 43200000" },
        "t0":  { ".validate": "newData.isNumber()" },
        "up":  { ".validate": "newData.isNumber()" },
        "off": { ".validate": "newData.isNumber()" },
        "wr":  { ".validate": "newData.isString() && newData.val().length <= 16" },
        "w":   { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 5" },

        "p": {
          ".validate": "newData.hasChildren()",
          "$seat": {
            ".validate": "$seat.matches(/^[0-5]$/) && newData.hasChild('l')",
            "l":   { ".validate": "newData.isNumber() && newData.val() >= -999 && newData.val() <= 9999" },
            "poi": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 999" },
            "cmd": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 999" },
            "$other": { ".validate": false }
          }
        },

        "$other": { ".validate": false }
      }
    }
  }
}
```

| Guarantee | The rule that gives it |
|---|---|
| A node is hard-bounded at about 350 bytes | `$other: false` plus every numeric range |
| Nobody can list live games | `live` has no read rule, so it inherits `false` |
| Nobody can delete a live game | The delete branch needs `exp < now` |
| Nobody can plant an immortal node | `exp <= now + 12 hours` |

Two consequences:

- `exp` can never move backwards, because `.validate` requires `exp > now`.
  Cleanup is purely time-driven, and no client can force an early delete.
- `.validate` runs against the merged result, so a partial-path update passes
  while the node exists. This is why every reconnect sends a full snapshot.

### 10.2 Firestore

Add beside the existing `polls` and `rate_limits` blocks:

```
match /trackedGames/{trackId} {
  // get, not read. In Firestore `read` covers get AND list, so
  // `allow read: if true` would let anyone enumerate every archived
  // game and every player name in it, with no ID at all.
  allow get: if true;
  allow list: if false;

  allow create, update: if trackId.size() == 20
    && request.resource.data.keys().hasAll([
         'v','status','seats','life','poison','commanderDamage',
         'winnerSeat','roundId','startedAt','endedAt','archivedAt'
       ])
    && request.resource.data.keys().hasOnly([
         'v','status','seats','life','poison','commanderDamage',
         'winnerSeat','roundId','startedAt','endedAt','archivedAt'
       ])
    && request.resource.data.v == 1
    && request.resource.data.status in ['final', 'abandoned']
    && request.resource.data.seats is list
    && request.resource.data.seats.size() >= 2
    && request.resource.data.seats.size() <= 6
    && request.resource.data.life is list
    && request.resource.data.life.size() == request.resource.data.seats.size()
    && (request.resource.data.poison == null
        || request.resource.data.poison is list)
    && (request.resource.data.commanderDamage == null
        || request.resource.data.commanderDamage is list)
    && (request.resource.data.winnerSeat == null
        || request.resource.data.winnerSeat is int)
    && request.resource.data.roundId is int
    && request.resource.data.startedAt is int
    && request.resource.data.endedAt is int
    && request.resource.data.archivedAt == request.time;
  allow delete: if false;
}
```

`archivedAt == request.time` forces a real `serverTimestamp()`. A client cannot
backdate a record. `create` and `update` share one rule, because the archive
must be idempotent.

### 10.3 What the rules do not protect against

Neither app uses authentication. EventTrinket already works this way, and this
design follows that precedent.

**Someone who learns a tracking ID can write false life totals.** The ID is
shared between two players and the organizer, so this is a table-level trust
problem. The value ranges cap the damage to plausible numbers.

**Someone who reads the bundle can create nodes with random IDs.** Each node is
under 350 bytes and expires within 12 hours. Filling 1 GB needs about 3 million
nodes. The attacker gains nothing, you pay nothing, and the feature stops
working until the quota resets.

A per-day counter in the style of `rate_limits/daily` would not fix this. A
global counter stops the attacker and the real users together. It caps a runaway
bug, not an adversary. It is deliberately left out.

### 10.4 Optional hardening

**Firebase App Check**, with the reCAPTCHA v3 provider. It is free, it applies
to both products, and it rejects any request that does not come from the two
registered web apps.

Enable it in monitoring mode first. Watch for a week. Only then enforce.
Enforcement on an offline-first PWA needs care, and section 11 covers what
happens when a token cannot be fetched.

---

## 11. Error handling and offline behavior

### 11.1 The governing rule

**Tracking must never degrade the life counter.** Every failure ends in the same
place: tracking stops, a chip says so, and the counter works as before. No
failure path throws into React. No failure path blocks a tap.

### 11.2 Do not use the SDK offline queue

The Realtime Database SDK queues writes while offline and replays them in order.
Twenty queued life changes replay as twenty writes, and the first nineteen are
stale.

Watch `.info/connected` instead:

1. While disconnected, skip every write and set a dirty flag.
2. On reconnect, send one full snapshot.

Twenty writes become one. This also repairs a node that the sweep reaped during
a long gap.

### 11.3 The recovery ladder

Every write rejection follows the same three steps, and never loops.

| Step | Action |
|---|---|
| 1 | Send a full snapshot once. This repairs a missing or drifted node. |
| 2 | If that also fails, set `status: 'error'` and stop writing. |
| 3 | Log once. Never retry on a timer. |

The force-update button is the manual retry.

### 11.4 The failure table

| Failure | Behavior |
|---|---|
| `import('firebase/database')` rejects | `status: 'error'`. Counter unaffected. |
| No network | Skip writes, set dirty, full snapshot on reconnect. |
| A rule rejects a write | The recovery ladder. |
| The node was reaped mid-game | Step 1 recreates it. |
| `.info/serverTimeOffset` unavailable | Offset falls back to 0. A clock more than 6 hours behind cannot write, and the chip shows the error. |
| Spark quota exhausted | Same as a rule rejection. Rejected, never billed. |
| App Check token unavailable offline | Same path. Enable monitoring mode first. |
| EventTrinket listener errors | That table shows "unavailable". Score entry keeps working. |
| EventTrinket archive write fails | Firestore `persistentLocalCache()` queues it and flushes on reconnect. |

### 11.5 The two-writer guard

A deep link can be opened twice. Two devices then write the same node, and the
board flickers.

Each LifeTrinket session writes a random `wr` value, and subscribes to its own
node over the connection it already holds. If `wr` comes back as another
session's value, LifeTrinket stops writing and shows "another device is tracking
this game".

Cost: about 3.6 KB of echo traffic per game.

### 11.6 What the user sees

LifeTrinket, one chip in the play view:

| Status | Chip |
|---|---|
| `connecting` | Grey dot |
| `live` | Green dot, "Synced 3s ago", force button |
| `offline` | Amber dot, "Not synced since 14:22" |
| `error` | Red dot, one line, tap to retry |

EventTrinket, per table: live, offline with "last seen 4 min ago", ended, or
unavailable.

---

## 12. Testing

### 12.1 LifeTrinket has no tests

`package.json` has no `test` script. Add vitest and cover the three pure
functions that carry the efficiency argument:

1. The throttle. It must write on the leading edge, collapse a burst, and cancel
   a no-op.
2. The diff. It must produce partial paths, and an empty result when nothing changed.
3. `snapshot.ts`. It must convert `Player[]` to a node payload, and include
   `poi` and `cmd` only when those counters are enabled.

This is targeted at the new code. It is not a wider change.

### 12.2 The Realtime Database emulator

EventTrinket runs the Firestore emulator on port 8085, and its `CLAUDE.md`
documents the workflow. Add the database emulator on port 9000 to the same
`firebase.json`.

Realtime Database rules are hard to verify by reading. The case that needs a
local test is `.validate` against a merged partial update.

Test these rule cases at minimum:

1. A full snapshot creates a node.
2. A partial update passes on an existing node.
3. A partial update fails on a missing node.
4. A delete fails while `exp > now`.
5. A delete passes once `exp < now`.
6. A write with `exp > now + 12 hours` fails.
7. An unknown key fails.
8. A list read of `live` fails.

---

## 13. Known limitations

These are accepted, not open questions.

1. **The grace timer runs only while EventTrinket is open.** If the organizer
   closes the app, the archive waits for the next session. A node survives 6
   hours, so a same-day reopen still archives it. Past 6 hours, the sweep reaps
   the node and that game is never archived.
2. **A second organizer device cannot label seats.** The tournament lives in
   `localStorage`, so a second device holds no pairing data. A spectator screen
   is out of scope.
3. **A game ends only when somebody taps.** LifeTrinket never detects a loss
   from life reaching zero. The grace period covers the gap.
4. **The offline signal is weak on mobile.** A backgrounded tab drops its
   websocket. This is why the grace is 15 minutes, and why `visibilitychange`
   clears the offline state.

---

## 14. Constants

| Name | Value | Where |
|---|---|---|
| Throttle window | 3 seconds | LifeTrinket |
| `exp` while live | 6 hours | LifeTrinket |
| `exp` once ended | 30 minutes | LifeTrinket |
| `exp` rule ceiling | 12 hours | Database rules |
| `GRACE_MS` | 15 minutes | EventTrinket |
| Grace evaluation interval | 30 seconds | EventTrinket |
| Tracking ID length | 20 characters | Both |
| `wr` length | at most 16 characters | Database rules |
| Database region | `europe-west1` | `draft-trinket` |

---

## 15. Addendum: the match game score

Added after the first live run. A best-of-three match already tracks a game
score in LifeTrinket, and the organizer's board should show it beside the life
totals.

**Superseded.** This section first specified display only. The user later asked
for the score to feed the tournament's own win counters, and that is now the
behaviour. Section 16 records the change and its cost.

The original reasoning, kept because the risk it names is real: EventTrinket
shows the score, the organizer still enters the match result by hand, and
LifeTrinket never writes into tournament standings, so a stray tap on a
player's phone cannot move a real result.

### The node gains one optional field

```
gs: [1, 0]      // games won, seat-indexed, same order as `p`
```

**The field must be optional, and the rules must allow it before any client
writes it.** The node rules carry `"$other": { ".validate": false }` at both
levels, so an unnamed key is rejected and every write fails. A named rule for
`gs` is what makes it legal. It stays out of the required-children list, so a
client that does not send it still writes successfully.

```json
"gs": {
  ".validate": "newData.hasChildren()",
  "$seat": {
    ".validate": "$seat.matches(/^[0-5]$/) && newData.isNumber()
                  && newData.val() >= 0 && newData.val() <= 99"
  }
}
```

### Only the full snapshot carries it

`gs` needs no place in `diffSeats`. The score changes exactly when a game ends
or is undone, and every one of those paths already runs a full snapshot through
`sendFull`. A diff path for it would be dead code.

### The archive is unchanged

`trackedGames` keeps its eleven keys. The Firestore rule uses `hasAll` together
with `hasOnly`, so adding a twelfth key means changing the rule, the record
builder and the rules tests. Display only does not need it, so it stays out.
Adding it later is a deliberate, separate change.

### Order of work

1. The database rules, with tests. Nothing may write `gs` until these allow it.
2. LifeTrinket publishes it in `sendFull`.
3. EventTrinket renders it, for example `19 – 19 (1–0)`.


---

## 16. The score feeds the tournament win counters

Asked for after the first live run, replacing the display-only rule in section
15. The organizer should not have to retype a score both apps already know.

### What it does

`gs` from the live node is written into `pairing.player1.wins` and
`pairing.player2.wins`, through the same `handleUpdatePairingStatsInMatch` path
the manual buttons already use. Those counters drive the standings.

### The cost, stated plainly

A stray tap on a player's phone now moves a real tournament result. So does a
mis-tapped "next game". This is the risk display only was protecting against,
and it is accepted deliberately.

### The guards that keep it survivable

1. **Write only when the value actually differs.** A re-render must not rewrite
   the same number, or the effect loops.
2. **Never exceed what the manual buttons allow.** They cap a player at 2 wins
   and the pairing at 3 games. A synced value outside that range is dropped, not
   clamped silently.
3. **Leave a pairing alone once a draw is recorded.** LifeTrinket has no concept
   of a draw, so its score cannot describe that pairing. The organizer owns it.
4. **The organizer can still override.** The manual buttons keep working, and a
   later identical `gs` does not undo their correction, because of guard 1.
5. **A synced score may never go backwards.** The life counter's own score
   only ever counts up while a match runs -- a game is won, the number goes
   up. It resets to 0-0 only when a genuinely new game begins, which in this
   feature means a new tracking ID, and therefore a different pairing. So a
   score lower than the high-water mark this pairing has already reached
   does not mean a game was un-won: it means the phone lost its state, most
   often a second device opening the same link with no saved game, a
   cleared browser, or a private window.

   The mark is `syncedScore`, not the live counters. The counters move on
   their own through the manual buttons (guard 4), so a device that has
   genuinely incremented past what it last sent must still write, even
   where a correction has since put a counter below it. Before a first sync
   there is no `syncedScore` to compare against, so the counters stand in
   for that one case, which keeps a first `0-0` from wiping a result the
   organizer already typed by hand.

   A rejected score writes nothing and is not settled onto the pairing.
   Settling it would pull the mark itself down to the stale value, and the
   next redelivery of the real, higher score would then read as an advance
   over that lowered mark rather than the repeat it is. Nothing needs
   settling for this to terminate: the same stale score loses the same
   comparison every time the planner runs, so leaving it alone is already
   stable -- unlike guard 2's drop, this case is reachable and ordinary, not
   a wrong number no button press could produce, so it earns no warning
   either.

### Where the settled score lives

Guard 1 needs somewhere to record the score the board has already acted on.
That place is the pairing: `pairingSchema` carries an optional
`syncedScore`, and `planWinSync` reads it off the pairing and writes it
back.

It may not be in-memory state. The organizer presses Back, or reloads, or
the tab is discarded, and an in-memory record is gone. The same `gs` then
arrives, reads as news, and is written over the correction -- into
`player.wins`, which drives the standings, for the six hours the node
lives. Guard 4 is a promise about a tournament, so it has to be kept by the
tournament.

The field is optional for the same reason `trackId` is: `GameProvider` sets
the game to `null` on a failed `safeParse`, so a required field would empty
every running tournament on deploy.

Recording a settle therefore costs a write. Every pairing the planner acts
on produces one, including a pairing whose counters already show the score
and a pairing whose score was dropped by guard 2. Both leave the counters
alone and carry only `syncedScore`. Without the first, a correction typed
over a score the counters already matched would be undone on the next
mount. Without the second, a dropped score would warn again on every mount.

### The display becomes redundant

The counters now show the score, so the readout stops repeating it. The life
totals split into each player's own column, above that player's counter:

```
        P2        vs        P7
        14                  20
     [-] 0 [+]         [-] 1 [+]
```

---

## 17. A device joining a game in progress adopts its score

Found by running the feature, and made dangerous by section 16: the published
score writes into real standings.

### The fault

`readTrackEntry` decides whether a link is new by comparing it against the
link stored on this device. A device with nothing stored therefore treats
every link as new: a second phone, a private window, cleared storage, or an
organizer's browser that has since tracked a different table, because
`trackedGame` is one key per origin.

A new link resets the match score to 0-0, publishes it, and the board takes
0-0 as news. **A player switching phones wipes their own match score from the
tournament.**

Guard 5 in section 16 contains this: a score below the high-water mark is
refused. It does not cure it. The new device still holds no score, so it
publishes nothing useful until it wins a game, and then publishes 1-0 for a
match that stood at 1-1.

### The cure

**Publish `gs` only after reading the node once, and adopt what is there.**

The hook already subscribes to the node for the two-writer guard, so the read
costs no extra connection. The rule is about ordering, not data: do not
publish a score you have not yet checked against the node.

On the first snapshot after connecting:

- The node carries a score and this device has none, so adopt it. This is a
  device joining a game already in progress.
- The node carries no score, or this device already has one, so change
  nothing.

Until that first snapshot arrives, every write omits `gs`. An omitted score is
already safe: the board skips a node without one and leaves its counters
alone.

### Why this and not something narrower

Refusing to publish a score from a device with no history stops the wipe but
leaves the new device permanently wrong, publishing 1-0 for a 1-1 match.
Adoption is what makes the new device correct rather than merely harmless.

### How the read is taken, and why not the listener

The listener the two-writer guard uses cannot answer this. Its first event is
usually this device's own write: `.info/connected` turns true before the
node's first server value arrives, so the connect handler's snapshot goes out
first, and the SDK raises that optimistic write to the listener straight away.
Settling the question on a value this device invented is the wipe again.

So the read is a one-shot `get` on the same connection -- no second socket,
and it reads the server's value rather than the local view.

That leaves one ordering hole, and it is closed in the writer rather than the
reader. A full snapshot is a `set`, which replaces the node; a `set` carrying
no `gs` therefore *deletes* the score the pending read is looking for. A write
queued while offline is flushed ahead of an outstanding read, so this is
reachable, not theoretical. Until the read resolves, the full snapshot merges
instead: the same children, written with `update`, with explicit nulls for the
two children a `set` would have dropped (`w` and `off`) and `gs` simply left
alone. From the resolution onwards it is a `set` again, carrying the score.

The rule this preserves is the one that matters: no write touches `gs` --
neither writing it nor deleting it -- before the node has been read.

### Life totals are adopted too

This section first said they were not, on the reasoning that a player moving
phones re-enters them and only the score feeds the standings.

**That was wrong, and reopening proved it.** A player scans the QR to rejoin
a game in progress and sees 20 and 20, while the organizer's board beside them
shows the real totals. The two disagree in front of the people playing, and
the feature that exists to let someone rejoin a game hands them a game that
has not started.

The rule is simpler than the one it replaces: **a device joining a node that
already exists and is live adopts everything that node knows.** Life totals
and score together. A fresh table is right only when there is no node.

The gate is the same one adoption already uses. A device that holds its own
game for this tracking id keeps it, so a reload mid-match still wins over the
node, and only a device with nothing takes what the node has.

#### The two gates are not the same test

"Holds its own game" and "holds its own score" look like one gate and are not.
A device reloading in the middle of the first game of a match holds no score
yet -- the match stands at 0-0 -- and its life totals are nevertheless the
real ones, fresher than anything the node has seen. Gating the totals on the
score would hand that device the node's reading and lose every tap since the
last publish.

So the score keeps the gate it was verified with, a result of this device's
own, and the life totals take the wider one: **has this device played this
game before?** The saved start time answers it. `trackedGameT0` is written by
the first snapshot of every tracked game and is keyed to the game id, so a
device with one for this id holds the game, and a device with none has just
arrived. It is read once, in the same place and at the same moment as `t0`
itself, because the first write puts one there a moment later.

The answer is latched. A reconnect re-reads the node, and by then the node is
this device's own writes, up to one throttle interval stale: adopting it a
second time would roll the game backwards.

#### What "everything that node knows" is, field by field

- **`l`**, the life total. One number to one number, always.
- **`poi`**, poison. One number to one number, and it switches the counter on
  for that seat: a node carrying poison is a game being played with poison,
  and a counter left hidden would be deleted from the node by this device's
  next snapshot.
- **`cmd`**, commander damage. Taken, and it overturns the format below. The
  node is the record of what is being played, and a device that joins a table
  and hides damage another device is tracking shows a false life state.
  Damage means a value above zero: `cmd` present and zero is a commander game
  with nothing dealt yet, `cmd` absent is not a commander game, and neither is
  damage. `cmd` is the one field that cannot be put back exactly -- it is the
  highest damage across every opponent and partner, so the total is faithful
  and its source is not recoverable. It goes on the lowest-indexed opponent:
  exact at the two-seat table every tournament pairing is, a placement rather
  than an attribution at a larger one.

**A node that seats a different number of players is refused whole**, and so
is a node carrying a single value the database rules could not hold. Seat `n`
of a four-seat node is not seat `n` of a two-seat one, and a table half from
this game and half from another is the disagreement this adoption exists to
end, not a repair. The device keeps the table it built and publishes it,
which repairs the node's shape.

### A tracked game is not a commander game

Found the same way: commander damage bars and a commander tax counter on a
Swiss tournament match, which is neither.

`startGameFromTrackLink` spreads the player's own saved settings and overrides
what the link decides. That is right for orientation and was wrong for
format: a commander player's saved `useCommanderDamage` carried into every
tracked game they opened.

**The format follows the event, and the orientation follows the player.** A
game built from a track link starts with `useCommanderDamage: false` and
`GameFormat.Standard`. Orientation is the other kind of preference entirely --
it says how the player holds their phone -- so it is still inherited, along
with everything else the link does not decide.

The override decides only how a game *starts*, and adoption can overturn it.
Real data beats a default: a node carrying damage turns commander damage back
on, for every seat, because the damage bar reads every opponent's flag and not
just its own. Nothing about the format is written back. The node carries game
state, and a device that adopts damage changes its own settings and nothing
else.

Note what the override does to the node: `toSeatStates` emits `cmd` only for a
player who has commander damage switched on, so a tracked game publishes no
`cmd` child at all rather than a zero. That is what keeps the rule above from
spreading the format -- a non-commander game cannot be mistaken for one where
nobody has dealt damage yet.

---

## 18. Reopening a tracked game

Once a pairing has a tracking ID, the Track button is replaced by the live
readout and there is no way back to the link. A player who closed the tab, or
who opened the link on the wrong phone, cannot rejoin, and the organizer has
nothing to hand them: the ID exists only inside the tournament's stored state.

### What it does

A control beside the readout opens a dialog holding the same link, as a QR
code and as a button.

**It reuses the existing tracking ID. It never mints a new one.** A new ID
would abandon the live node, lose the match score the board is reading, and
leave an orphan to expire.

The QR matters more than the button. The organizer's laptop is usually not
the device that needs the link — a player's phone is.

### The alignment constraint

The readout's life totals sit in a column above each player's win counter,
and that alignment was asked for explicitly. The reopen control must not
disturb it.

### What it cannot do in development

A QR encodes whatever `VITE_LIFETRINKET_URL` points at. In development that is
`http://localhost:5173`, which a phone cannot reach. Scanning from a phone
needs a production build, or a dev server started with `--host` and the URL
set to the machine's address on the network.

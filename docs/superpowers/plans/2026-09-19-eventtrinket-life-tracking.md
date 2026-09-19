# EventTrinket Live Life Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let EventTrinket show the live life total of each player in a tracked LifeTrinket game, and keep one permanent record per finished game, inside the Firebase free tier.

**Architecture:** EventTrinket mints a 20-character tracking ID per pairing and deep-links it into LifeTrinket through a URL fragment. LifeTrinket writes coalesced life snapshots to `/live/{gameId}` in the Realtime Database of the `draft-trinket` project. EventTrinket listens to that node, and writes one Firestore record per finished game. Cleanup is time-driven through an `exp` field plus a client sweep.

**Tech Stack:** TypeScript, React 19, Vite, Zod 4, Firebase Realtime Database, Cloud Firestore, vitest, `@firebase/rules-unit-testing`, lz-string.

**Spec:** `docs/superpowers/specs/2026-09-19-eventtrinket-life-tracking-design.md`

## Global Constraints

- **Two repositories.** Every task names its repository. `LifeTrinket` writes. `EventTrinket` reads and archives.
- **Package manager is pnpm.** `package.json` blocks npm and yarn through `engines`. Node >= 20.
- **Tracking must never degrade the life counter.** No tracking failure throws into React. No tracking failure blocks a tap.
- **No Cloud Functions.** A function requires the Blaze plan and a billing card.
- **Lazy-import `firebase/database`.** It adds about 40 KB gzipped, and most users never track a game.
- **`trackId` on `pairingSchema` must be optional.** `GameProvider.tsx` sets the game to `null` on a failed `safeParse`. A required field wipes every running tournament.
- **`pnpm lint` allows zero warnings.** Run it before every commit.

### Exact constants

| Name | Value |
|---|---|
| Throttle window | 3000 ms |
| `exp` while live | 6 hours (21600000 ms) |
| `exp` once ended | 30 minutes (1800000 ms) |
| `exp` rule ceiling | 12 hours (43200000 ms) |
| `GRACE_MS` | 15 minutes (900000 ms) |
| Grace evaluation interval | 30000 ms |
| Tracking ID length | 20 characters |
| `wr` maximum length | 16 characters |
| Tracking ID alphabet | `ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789` |
| Database region | `europe-west1` |
| Realtime Database emulator port | 9000 |
| Firestore emulator port | 8085 (already in use) |

---

## File Structure

### LifeTrinket (the writer)

| File | Responsibility |
|---|---|
| `src/Types/Tracking.ts` | Zod schemas and types for the link and the live node. No logic. |
| `src/Utils/tracking/trackLink.ts` | Encode, decode and read `#track=`. Pure except for `window.location`. |
| `src/Utils/tracking/snapshot.ts` | Convert `Player[]` to seat states, and diff two seat-state arrays. Pure. |
| `src/Utils/tracking/throttle.ts` | The trailing-edge throttle. Pure, with an injectable clock. |
| `src/Utils/tracking/trackDb.ts` | Lazy Firebase app and database handle. The only file that imports Firebase. |
| `src/Hooks/useGameTracker.ts` | The connection, the write policy and the status. |
| `src/Components/Tracking/TrackingChip.tsx` | The status chip and the force button. |

### EventTrinket (the reader and archiver)

| File | Responsibility |
|---|---|
| `database.rules.json` | Realtime Database rules. |
| `src/lib/trackIds.ts` | Mint a tracking ID, and build the LifeTrinket link. Pure. |
| `src/lib/trackDb.ts` | Realtime Database handle, beside the existing Firestore one. |
| `src/lib/archive.ts` | Convert a live node plus a pairing into a Firestore record. Pure. |
| `src/hooks/useTrackedGames.ts` | Listeners, grace timer, archive trigger and sweep. |

### One type is duplicated on purpose

`LiveNode` and `SeatState` exist twice: in `LifeTrinket/src/Types/Tracking.ts`
and in `EventTrinket/src/lib/archive.ts`. The two repositories share no package,
so the node shape is a wire contract, not a shared type. `database.rules.json`
in Task 1 is the single source of truth. If you change the node shape, change
the rules, both type files and the rules tests together.

### Branches

LifeTrinket is already on `feat/eventtrinket-life-tracking`. Create the same branch name in EventTrinket before Task 1.

---

## Task 1: Realtime Database rules and emulator

**Repository:** EventTrinket

**Files:**
- Create: `database.rules.json`
- Create: `src/lib/databaseRules.test.ts`
- Modify: `firebase.json`
- Modify: `scripts/emulators.sh`
- Modify: `package.json` (add `@firebase/rules-unit-testing`)
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the node contract every later task writes against. Required children are `v`, `st`, `t0`, `exp`, `up`, `wr`, `p`.

- [ ] **Step 1: Create the branch and install the test library**

```bash
cd EventTrinket
git checkout -b feat/eventtrinket-life-tracking
pnpm add -D @firebase/rules-unit-testing
```

- [ ] **Step 2: Write `database.rules.json`**

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
        "t0":  { ".validate": "newData.isNumber()" },
        "exp": { ".validate": "newData.isNumber() && newData.val() > now && newData.val() <= now + 43200000" },
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

- [ ] **Step 3: Register the rules and the emulator in `firebase.json`**

Add two top-level keys beside the existing `firestore` key:

```json
  "database": {
    "rules": "database.rules.json"
  },
```

And add one entry inside the existing `emulators` object, before `"ui"`:

```json
    "database": { "port": 9000 },
```

- [ ] **Step 4: Start the database emulator too**

In `scripts/emulators.sh`, change both `firebase emulators:start` lines. Replace `--only firestore` with `--only firestore,database` in each of the two branches.

- [ ] **Step 5: Write the failing rules test**

Create `src/lib/databaseRules.test.ts`:

```ts
import fs from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { get, ref, remove, set, update } from 'firebase/database';

const ID = 'AAAAAAAAAABBBBBBBBBB'; // exactly 20 characters
const HOUR = 60 * 60 * 1000;

let env: RulesTestEnvironment;

const node = (t0 = Date.now()) => ({
  v: 1,
  st: 'live',
  t0,
  exp: Date.now() + 6 * HOUR,
  up: t0,
  wr: 'sess01',
  p: [{ l: 20 }, { l: 20 }],
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'draft-trinket-rules-test',
    database: {
      rules: fs.readFileSync('database.rules.json', 'utf8'),
      host: '127.0.0.1',
      port: 9000,
    },
  });
});

afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

const db = () => env.unauthenticatedContext().database();

describe('live node writes', () => {
  it('accepts a full snapshot', async () => {
    await assertSucceeds(set(ref(db(), `live/${ID}`), node()));
  });

  it('accepts a partial update on an existing node', async () => {
    await set(ref(db(), `live/${ID}`), node());
    await assertSucceeds(
      update(ref(db(), `live/${ID}`), {
        'p/1/l': 17,
        up: Date.now(),
        exp: Date.now() + 6 * HOUR,
      }),
    );
  });

  it('rejects a partial update on a missing node', async () => {
    await assertFails(update(ref(db(), `live/${ID}`), { 'p/1/l': 17 }));
  });

  it('rejects an exp beyond 12 hours', async () => {
    await assertFails(set(ref(db(), `live/${ID}`), { ...node(), exp: Date.now() + 13 * HOUR }));
  });

  it('rejects an unknown key', async () => {
    await assertFails(set(ref(db(), `live/${ID}`), { ...node(), evil: 'x' }));
  });

  it('rejects a node whose id is not 20 characters', async () => {
    await assertFails(set(ref(db(), 'live/short'), node()));
  });
});

describe('live node deletes', () => {
  it('rejects a delete while the node is live', async () => {
    await set(ref(db(), `live/${ID}`), node());
    await assertFails(remove(ref(db(), `live/${ID}`)));
  });

  it('accepts a delete once the node expired', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(ctx.database(), `live/${ID}`), { ...node(), exp: Date.now() - 1000 });
    });
    await assertSucceeds(remove(ref(db(), `live/${ID}`)));
  });
});

describe('live node reads', () => {
  it('accepts a read by id', async () => {
    await set(ref(db(), `live/${ID}`), node());
    await assertSucceeds(get(ref(db(), `live/${ID}`)));
  });

  it('rejects an unrestricted list read', async () => {
    await assertFails(get(ref(db(), 'live')));
  });

});
```

- [ ] **Step 6: Run the test and watch it fail**

Terminal 1:
```bash
pnpm emulators
```
Terminal 2:
```bash
pnpm test src/lib/databaseRules.test.ts
```
Expected: every test fails, because `database.rules.json` is not yet loaded by a running emulator, or the emulator is not yet started with `--only firestore,database`.

- [ ] **Step 7: Restart the emulator and run the test again**

Stop the emulator in terminal 1. Start it again so it picks up the new `firebase.json`. Then run the test.

Expected: all 11 tests pass.

- [ ] **Step 8: Document the emulator change in `CLAUDE.md`**

In the section "The development server uses the emulator", add this paragraph:

```markdown
The Realtime Database emulator runs beside Firestore, on port 9000. It reads
`database.rules.json`. The live life tracking feature uses it. The port appears
in `firebase.json` and in `src/lib/trackDb.ts`. Change both together.
```

- [ ] **Step 9: Lint and commit**

```bash
pnpm lint && pnpm test
git add database.rules.json firebase.json scripts/emulators.sh package.json pnpm-lock.yaml src/lib/databaseRules.test.ts CLAUDE.md
git commit -m "feat: add Realtime Database rules for live game tracking"
```

---

## Task 2: Firestore rules for the archive

**Repository:** EventTrinket

**Files:**
- Modify: `firestore.rules`
- Create: `src/lib/firestoreTrackedGames.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the `trackedGames` document contract. Allowed keys are `v`, `status`, `seats`, `life`, `poison`, `commanderDamage`, `winnerSeat`, `roundId`, `startedAt`, `endedAt`, `archivedAt`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/firestoreTrackedGames.test.ts`:

```ts
import fs from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';

const ID = 'AAAAAAAAAABBBBBBBBBB';
let env: RulesTestEnvironment;

const record = () => ({
  v: 1,
  status: 'final',
  seats: [
    { name: 'Alice', tournamentPlayerId: 3 },
    { name: 'Bob', tournamentPlayerId: 7 },
  ],
  life: [20, 0],
  poison: null,
  commanderDamage: null,
  winnerSeat: 0,
  roundId: 1,
  startedAt: 1758290000000,
  endedAt: 1758293600000,
  archivedAt: serverTimestamp(),
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'draft-trinket-firestore-test',
    firestore: {
      rules: fs.readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8085,
    },
  });
});

afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const db = () => env.unauthenticatedContext().firestore();

describe('trackedGames', () => {
  it('accepts a valid record', async () => {
    await assertSucceeds(setDoc(doc(db(), 'trackedGames', ID), record()));
  });

  it('accepts an overwrite, because the archive is idempotent', async () => {
    await setDoc(doc(db(), 'trackedGames', ID), { ...record(), status: 'abandoned' });
    await assertSucceeds(setDoc(doc(db(), 'trackedGames', ID), record()));
  });

  it('rejects an unknown key', async () => {
    await assertFails(setDoc(doc(db(), 'trackedGames', ID), { ...record(), evil: 'x' }));
  });

  it('rejects an unknown status', async () => {
    await assertFails(setDoc(doc(db(), 'trackedGames', ID), { ...record(), status: 'draft' }));
  });

  it('rejects a client-supplied archivedAt', async () => {
    await assertFails(setDoc(doc(db(), 'trackedGames', ID), { ...record(), archivedAt: 1758290000000 }));
  });

  it('rejects a life array whose length does not match seats', async () => {
    await assertFails(setDoc(doc(db(), 'trackedGames', ID), { ...record(), life: [20] }));
  });

  it('rejects a document id that is not 20 characters', async () => {
    await assertFails(setDoc(doc(db(), 'trackedGames', 'short'), record()));
  });

  it('rejects a delete', async () => {
    await setDoc(doc(db(), 'trackedGames', ID), record());
    await assertFails(deleteDoc(doc(db(), 'trackedGames', ID)));
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm test src/lib/firestoreTrackedGames.test.ts
```
Expected: the first two tests fail with a permission error, because no `trackedGames` rule exists yet.

- [ ] **Step 3: Add the rule**

In `firestore.rules`, add this block inside `match /databases/{database}/documents {`, after the closing brace of `match /polls/{pollId}`:

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

- [ ] **Step 4: Run the test and verify it passes**

```bash
pnpm test src/lib/firestoreTrackedGames.test.ts
```
Expected: all 8 tests pass.

- [ ] **Step 5: Lint and commit**

```bash
pnpm lint && pnpm test
git add firestore.rules src/lib/firestoreTrackedGames.test.ts
git commit -m "feat: add Firestore rules for the tracked game archive"
```

---

## Task 3: LifeTrinket test setup and the track link

**Repository:** LifeTrinket

**Files:**
- Create: `src/Types/Tracking.ts`
- Create: `src/Utils/tracking/trackLink.ts`
- Create: `src/Utils/tracking/trackLink.test.ts`
- Modify: `package.json`
- Modify: `vite.config.ts`

**Interfaces:**
- Consumes: `compressToEncodedURIComponent` and `decompressFromEncodedURIComponent` from `lz-string`, already a dependency.
- Produces:
  - `TRACK_ID_LENGTH: 20`
  - `trackLinkSchema`, `type TrackLink = { v: 1; id: string; seats: string[]; life?: number; label?: string }`
  - `liveNodeSchema`, `type LiveNode`, `type SeatState = { l: number; poi?: number; cmd?: number }`
  - `encodeTrackLink(link: TrackLink): string`
  - `decodeTrackLink(encoded: string): TrackLink | null`
  - `getTrackLinkFromUrl(hash?: string): TrackLink | null`
  - `clearTrackLinkFromUrl(): void`

- [ ] **Step 1: Add vitest**

```bash
cd LifeTrinket
pnpm add -D vitest
```

Add one line to the `scripts` block in `package.json`, after `"lint"`:

```json
    "test": "vitest run",
```

Add a `test` block to the object returned by `defineConfig` in `vite.config.ts`, after the `define` block:

```ts
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
```

Add this line at the top of `vite.config.ts`, so the `test` key type-checks:

```ts
/// <reference types="vitest" />
```

- [ ] **Step 2: Write the types**

Create `src/Types/Tracking.ts`:

```ts
import { z } from 'zod';

export const TRACK_ID_LENGTH = 20;

export const trackLinkSchema = z.object({
  v: z.literal(1),
  id: z.string().length(TRACK_ID_LENGTH),
  seats: z.array(z.string()).min(2).max(6),
  life: z.number().int().positive().optional(),
  label: z.string().max(64).optional(),
});

export type TrackLink = z.infer<typeof trackLinkSchema>;

export const seatStateSchema = z.object({
  l: z.number(),
  poi: z.number().optional(),
  cmd: z.number().optional(),
});

export type SeatState = z.infer<typeof seatStateSchema>;

export const liveNodeSchema = z.object({
  v: z.literal(1),
  st: z.enum(['live', 'offline', 'ended']),
  t0: z.number(),
  exp: z.number(),
  up: z.number(),
  wr: z.string().max(16),
  off: z.number().optional(),
  w: z.number().optional(),
  p: z.array(seatStateSchema),
});

export type LiveNode = z.infer<typeof liveNodeSchema>;
export type TrackStatus = LiveNode['st'];
```

- [ ] **Step 3: Write the failing test**

Create `src/Utils/tracking/trackLink.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { encodeTrackLink, decodeTrackLink, getTrackLinkFromUrl } from './trackLink';
import type { TrackLink } from '../../Types/Tracking';

const link: TrackLink = {
  v: 1,
  id: 'AAAAAAAAAABBBBBBBBBB',
  seats: ['Alice', 'Bob'],
  life: 20,
  label: 'Round 2 · Table 3',
};

describe('encodeTrackLink and decodeTrackLink', () => {
  it('round-trips a link', () => {
    expect(decodeTrackLink(encodeTrackLink(link))).toEqual(link);
  });

  it('round-trips a link without the optional fields', () => {
    const minimal: TrackLink = { v: 1, id: link.id, seats: ['Alice', 'Bob'] };
    expect(decodeTrackLink(encodeTrackLink(minimal))).toEqual(minimal);
  });

  it('returns null for rubbish instead of throwing', () => {
    expect(decodeTrackLink('not-compressed')).toBeNull();
  });

  it('returns null for an id of the wrong length', () => {
    const bad = encodeTrackLink({ ...link, id: 'short' } as TrackLink);
    expect(decodeTrackLink(bad)).toBeNull();
  });

  it('returns null for a single seat', () => {
    const bad = encodeTrackLink({ ...link, seats: ['Alice'] } as TrackLink);
    expect(decodeTrackLink(bad)).toBeNull();
  });
});

describe('getTrackLinkFromUrl', () => {
  it('reads a track hash', () => {
    expect(getTrackLinkFromUrl(`#track=${encodeTrackLink(link)}`)).toEqual(link);
  });

  it('ignores the existing game hash', () => {
    expect(getTrackLinkFromUrl('#game=abc')).toBeNull();
  });

  it('ignores an empty hash', () => {
    expect(getTrackLinkFromUrl('')).toBeNull();
  });
});
```

- [ ] **Step 4: Run the test and verify it fails**

```bash
pnpm test src/Utils/tracking/trackLink.test.ts
```
Expected: FAIL with "Failed to resolve import ./trackLink".

- [ ] **Step 5: Write the implementation**

Create `src/Utils/tracking/trackLink.ts`:

```ts
import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from 'lz-string';
import { trackLinkSchema, type TrackLink } from '../../Types/Tracking';

export const TRACK_HASH_PREFIX = '#track=';

export function encodeTrackLink(link: TrackLink): string {
  return compressToEncodedURIComponent(JSON.stringify(link));
}

/**
 * Returns null for anything that does not decode to a valid link.
 * It never throws, because a bad link must not stop the life counter.
 */
export function decodeTrackLink(encoded: string): TrackLink | null {
  try {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json) {
      return null;
    }
    const parsed = trackLinkSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function getTrackLinkFromUrl(
  hash: string = typeof window === 'undefined' ? '' : window.location.hash
): TrackLink | null {
  if (!hash.startsWith(TRACK_HASH_PREFIX)) {
    return null;
  }
  return decodeTrackLink(hash.slice(TRACK_HASH_PREFIX.length));
}

export function clearTrackLinkFromUrl(): void {
  if (window.location.hash.startsWith(TRACK_HASH_PREFIX)) {
    history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search
    );
  }
}
```

- [ ] **Step 6: Run the test and verify it passes**

```bash
pnpm test src/Utils/tracking/trackLink.test.ts
```
Expected: all 8 tests pass.

- [ ] **Step 7: Lint and commit**

```bash
pnpm lint && pnpm test && pnpm build
git add package.json pnpm-lock.yaml vite.config.ts src/Types/Tracking.ts src/Utils/tracking/
git commit -m "feat: add vitest and the track link format"
```

---

## Task 4: LifeTrinket snapshot and diff

**Repository:** LifeTrinket

**Files:**
- Create: `src/Utils/tracking/snapshot.ts`
- Create: `src/Utils/tracking/snapshot.test.ts`

**Interfaces:**
- Consumes: `Player` and `CounterType` from `src/Types/Player.ts`. `SeatState` from `src/Types/Tracking.ts`.
- Produces:
  - `toSeatStates(players: Player[]): SeatState[]`
  - `diffSeats(prev: SeatState[] | null, next: SeatState[]): Record<string, number>`

- [ ] **Step 1: Write the failing test**

Create `src/Utils/tracking/snapshot.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toSeatStates, diffSeats } from './snapshot';
import { CounterType, Rotation, type Player } from '../../Types/Player';

const makePlayer = (over: Partial<Player> = {}): Player => ({
  lifeTotal: 20,
  index: 0,
  color: '#ffffff',
  iconTheme: 'dark',
  settings: {
    rotation: Rotation.Normal,
    useCommanderDamage: false,
    usePartner: false,
    usePoison: false,
    useEnergy: false,
    useExperience: false,
  },
  commanderDamage: [],
  extraCounters: [],
  isStartingPlayer: false,
  isMonarch: false,
  hasLost: false,
  isSide: false,
  name: 'Player',
  ...over,
});

describe('toSeatStates', () => {
  it('reports life only when no counter is enabled', () => {
    expect(toSeatStates([makePlayer(), makePlayer({ lifeTotal: 17 })])).toEqual([
      { l: 20 },
      { l: 17 },
    ]);
  });

  it('reports poison only when poison is enabled', () => {
    const player = makePlayer({
      settings: { ...makePlayer().settings, usePoison: true },
      extraCounters: [{ type: CounterType.Poison, value: 4 }],
    });
    expect(toSeatStates([player])).toEqual([{ l: 20, poi: 4 }]);
  });

  it('reports poison as 0 when the counter is enabled but absent', () => {
    const player = makePlayer({
      settings: { ...makePlayer().settings, usePoison: true },
    });
    expect(toSeatStates([player])).toEqual([{ l: 20, poi: 0 }]);
  });

  it('reports the highest commander damage across every source', () => {
    const player = makePlayer({
      settings: { ...makePlayer().settings, useCommanderDamage: true },
      commanderDamage: [
        { source: 1, damageTotal: 7, partnerDamageTotal: 2 },
        { source: 2, damageTotal: 3, partnerDamageTotal: 12 },
      ],
    });
    expect(toSeatStates([player])).toEqual([{ l: 20, cmd: 12 }]);
  });
});

describe('diffSeats', () => {
  const two = [{ l: 20 }, { l: 20 }];

  it('produces every path when there is no previous state', () => {
    expect(diffSeats(null, two)).toEqual({ 'p/0/l': 20, 'p/1/l': 20 });
  });

  it('produces nothing when nothing changed', () => {
    expect(diffSeats(two, [{ l: 20 }, { l: 20 }])).toEqual({});
  });

  it('produces only the path that changed', () => {
    expect(diffSeats(two, [{ l: 20 }, { l: 17 }])).toEqual({ 'p/1/l': 17 });
  });

  it('produces a poison path when poison changed', () => {
    expect(diffSeats([{ l: 20, poi: 1 }], [{ l: 20, poi: 2 }])).toEqual({ 'p/0/poi': 2 });
  });

  it('ignores a field that is absent from the next state', () => {
    expect(diffSeats([{ l: 20, poi: 1 }], [{ l: 20 }])).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm test src/Utils/tracking/snapshot.test.ts
```
Expected: FAIL with "Failed to resolve import ./snapshot".

- [ ] **Step 3: Write the implementation**

Create `src/Utils/tracking/snapshot.ts`:

```ts
import { CounterType, type Player } from '../../Types/Player';
import type { SeatState } from '../../Types/Tracking';

const TRACKED_KEYS = ['l', 'poi', 'cmd'] as const;

/**
 * Builds the seat state the live node carries. It holds no names, because
 * EventTrinket labels the seats from its own pairing data.
 */
export function toSeatStates(players: Player[]): SeatState[] {
  return players.map((player) => {
    const seat: SeatState = { l: player.lifeTotal };

    if (player.settings.usePoison) {
      seat.poi =
        player.extraCounters.find((c) => c.type === CounterType.Poison)?.value ?? 0;
    }

    if (player.settings.useCommanderDamage) {
      seat.cmd = player.commanderDamage.reduce(
        (highest, damage) =>
          Math.max(highest, damage.damageTotal, damage.partnerDamageTotal),
        0
      );
    }

    return seat;
  });
}

/**
 * Returns the Realtime Database paths that changed, ready for a
 * partial-path update. An empty result means no write is needed.
 */
export function diffSeats(
  prev: SeatState[] | null,
  next: SeatState[]
): Record<string, number> {
  const changes: Record<string, number> = {};

  next.forEach((seat, index) => {
    const before = prev?.[index];

    TRACKED_KEYS.forEach((key) => {
      const value = seat[key];
      if (value === undefined) {
        return;
      }
      if (before?.[key] !== value) {
        changes[`p/${index}/${key}`] = value;
      }
    });
  });

  return changes;
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
pnpm test src/Utils/tracking/snapshot.test.ts
```
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
pnpm lint && pnpm test
git add src/Utils/tracking/snapshot.ts src/Utils/tracking/snapshot.test.ts
git commit -m "feat: add the live node snapshot and diff"
```

---

## Task 5: LifeTrinket throttle

**Repository:** LifeTrinket

**Files:**
- Create: `src/Utils/tracking/throttle.ts`
- Create: `src/Utils/tracking/throttle.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Throttle = { request(): void; flush(): void; cancel(): void; readonly pending: boolean }`
  - `createThrottle(windowMs: number, run: () => void, now?: () => number): Throttle`

- [ ] **Step 1: Write the failing test**

Create `src/Utils/tracking/throttle.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createThrottle } from './throttle';

// The clock is injected, so the throttle never reads Date.now directly.
let clock = 0;
const now = () => clock;

beforeEach(() => {
  clock = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const advance = (ms: number) => {
  clock += ms;
  vi.advanceTimersByTime(ms);
};

describe('createThrottle', () => {
  it('runs the first request at once', () => {
    const run = vi.fn();
    createThrottle(3000, run, now).request();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('delays a second request to the end of the window', () => {
    const run = vi.fn();
    const throttle = createThrottle(3000, run, now);

    throttle.request();
    advance(1000);
    throttle.request();
    expect(run).toHaveBeenCalledTimes(1);

    advance(2000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('collapses a burst into one trailing run', () => {
    const run = vi.fn();
    const throttle = createThrottle(3000, run, now);

    throttle.request();
    advance(200); throttle.request();
    advance(200); throttle.request();
    advance(200); throttle.request();
    expect(run).toHaveBeenCalledTimes(1);

    advance(3000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('runs again at once after the window passed with no request', () => {
    const run = vi.fn();
    const throttle = createThrottle(3000, run, now);

    throttle.request();
    advance(5000);
    throttle.request();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('flush runs at once and clears the pending run', () => {
    const run = vi.fn();
    const throttle = createThrottle(3000, run, now);

    throttle.request();
    advance(500);
    throttle.request();
    expect(throttle.pending).toBe(true);

    throttle.flush();
    expect(run).toHaveBeenCalledTimes(2);
    expect(throttle.pending).toBe(false);

    advance(5000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('cancel prevents the trailing run', () => {
    const run = vi.fn();
    const throttle = createThrottle(3000, run, now);

    throttle.request();
    advance(500);
    throttle.request();
    throttle.cancel();

    advance(5000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(throttle.pending).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm test src/Utils/tracking/throttle.test.ts
```
Expected: FAIL with "Failed to resolve import ./throttle".

- [ ] **Step 3: Write the implementation**

Create `src/Utils/tracking/throttle.ts`:

```ts
export type Throttle = {
  /** Ask for a run. The first call runs at once. A later call inside the window waits. */
  request(): void;
  /** Run now, and clear any pending run. Used on pagehide and by the force button. */
  flush(): void;
  /** Drop any pending run. */
  cancel(): void;
  readonly pending: boolean;
};

/**
 * A trailing-edge throttle. A debounce delays every change by the full
 * window, and that makes the organizer board feel dead. This runs the
 * first change at once and caps the rate afterwards.
 */
export function createThrottle(
  windowMs: number,
  run: () => void,
  now: () => number = Date.now
): Throttle {
  let lastRunAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const fire = () => {
    timer = null;
    lastRunAt = now();
    run();
  };

  return {
    request() {
      if (timer !== null) {
        return;
      }
      const waited = now() - lastRunAt;
      if (waited >= windowMs) {
        fire();
        return;
      }
      timer = setTimeout(fire, windowMs - waited);
    },

    flush() {
      if (timer !== null) {
        clearTimeout(timer);
      }
      fire();
    },

    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },

    get pending() {
      return timer !== null;
    },
  };
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
pnpm test src/Utils/tracking/throttle.test.ts
```
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
pnpm lint && pnpm test
git add src/Utils/tracking/throttle.ts src/Utils/tracking/throttle.test.ts
git commit -m "feat: add the trailing-edge write throttle"
```

---

## Task 6: LifeTrinket database handle

**Repository:** LifeTrinket

**Files:**
- Create: `src/Utils/tracking/trackDb.ts`
- Create: `.env.production`
- Modify: `.env.example`
- Modify: `.gitignore` (confirm `.env.production` is not ignored)

**Interfaces:**
- Consumes: `firebase/app` and `firebase/database`, both already installed.
- Produces:
  - `getTrackDatabase(): Promise<Database | null>` — resolves to `null` when the configuration is absent or the import fails.
  - `isTrackingConfigured(): boolean`

- [ ] **Step 1: Add the configuration**

Create `.env.production`:

```
# The draft-trinket project hosts the shared tracking database. These values
# reach the browser inside the bundle, so none of them is a secret. The rules
# in EventTrinket/database.rules.json control access.
VITE_TRACK_DATABASE_URL=https://draft-trinket-default-rtdb.europe-west1.firebasedatabase.app
VITE_TRACK_PROJECT_ID=draft-trinket
VITE_TRACK_API_KEY=replace-with-the-draft-trinket-web-api-key
```

Add the same three keys to `.env.example`, with placeholder values and this comment:

```
# Live game tracking, read by EventTrinket. Leave these empty to disable it.
```

Confirm `.gitignore` does not ignore `.env.production`. If it does, add an exception line `!.env.production`.

- [ ] **Step 2: Write the implementation**

Create `src/Utils/tracking/trackDb.ts`:

```ts
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import type { Database } from 'firebase/database';

const TRACK_APP_NAME = 'track';

const config = {
  apiKey: import.meta.env.VITE_TRACK_API_KEY as string | undefined,
  projectId: import.meta.env.VITE_TRACK_PROJECT_ID as string | undefined,
  databaseURL: import.meta.env.VITE_TRACK_DATABASE_URL as string | undefined,
};

export function isTrackingConfigured(): boolean {
  return Boolean(config.apiKey && config.projectId && config.databaseURL);
}

let cached: Promise<Database | null> | null = null;

function trackApp(): FirebaseApp {
  const existing = getApps().find((app) => app.name === TRACK_APP_NAME);
  return existing ?? initializeApp(config, TRACK_APP_NAME);
}

/**
 * Loads firebase/database on demand. It adds about 40 KB gzipped, and most
 * users never track a game, so it must stay out of the main bundle.
 *
 * Returns null instead of throwing. Tracking must never stop the counter.
 */
export function getTrackDatabase(): Promise<Database | null> {
  if (!isTrackingConfigured()) {
    return Promise.resolve(null);
  }

  if (!cached) {
    cached = import('firebase/database')
      .then(({ getDatabase }) => getDatabase(trackApp()))
      .catch((error) => {
        console.warn('Live tracking is unavailable:', error);
        return null;
      });
  }

  return cached;
}

export const trackAppName = TRACK_APP_NAME;
```

- [ ] **Step 3: Verify the lazy import with a build**

```bash
pnpm build
```
Expected: the build succeeds, and `dist/assets/` contains a separate chunk whose name includes `firebase` or `database`. Confirm with:

```bash
ls dist/assets | grep -i -E 'database|firebase'
```
Expected: at least one chunk file. If the list is empty, the import was inlined. Check that the import inside `getTrackDatabase` uses `import(...)` and not a top-level `import`.

- [ ] **Step 4: Commit**

```bash
pnpm lint && pnpm test
git add .env.production .env.example .gitignore src/Utils/tracking/trackDb.ts
git commit -m "feat: add the lazy Realtime Database handle"
```

---

## Task 7: LifeTrinket tracker hook

**Repository:** LifeTrinket

**Files:**
- Create: `src/Hooks/useGameTracker.ts`

**Interfaces:**
- Consumes: `toSeatStates` and `diffSeats` from `src/Utils/tracking/snapshot.ts`. `createThrottle` from `src/Utils/tracking/throttle.ts`. `getTrackDatabase` from `src/Utils/tracking/trackDb.ts`. `SeatState` and `LiveNode` from `src/Types/Tracking.ts`.
- Produces:
  - `type TrackerStatus = 'idle' | 'connecting' | 'live' | 'offline' | 'error' | 'taken'`
  - `useGameTracker(args: { gameId: string | null; players: Player[]; winner: number | null }): { status: TrackerStatus; lastSentAt: number | null; forceUpdate: () => void }`

`'taken'` is the two-writer state from spec section 11.5.

- [ ] **Step 1: Write the hook**

Create `src/Hooks/useGameTracker.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Player } from '../Types/Player';
import type { SeatState } from '../Types/Tracking';
import { diffSeats, toSeatStates } from '../Utils/tracking/snapshot';
import { createThrottle, type Throttle } from '../Utils/tracking/throttle';
import { getTrackDatabase } from '../Utils/tracking/trackDb';

export const THROTTLE_MS = 3000;
export const EXP_LIVE_MS = 6 * 60 * 60 * 1000;
export const EXP_ENDED_MS = 30 * 60 * 1000;

export type TrackerStatus =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'offline'
  | 'error'
  | 'taken';

type Writer = {
  update: (values: Record<string, unknown>) => Promise<void>;
  set: (value: unknown) => Promise<void>;
  serverNow: () => number;
};

export function useGameTracker({
  gameId,
  players,
  winner,
}: {
  gameId: string | null;
  players: Player[];
  winner: number | null;
}): {
  status: TrackerStatus;
  lastSentAt: number | null;
  forceUpdate: () => void;
} {
  const [status, setStatus] = useState<TrackerStatus>('idle');
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);

  const writerRef = useRef<Writer | null>(null);
  const throttleRef = useRef<Throttle | null>(null);
  const sentRef = useRef<SeatState[] | null>(null);
  const playersRef = useRef<Player[]>(players);
  const connectedRef = useRef(false);
  const dirtyRef = useRef(false);
  const stoppedRef = useRef(false);
  // Spec 8.9: t0 and wr must survive a reload, because every reconnect sends
  // a full snapshot and that snapshot must carry the original start time.
  const sessionRef = useRef<string>('');
  const t0Ref = useRef<number>(0);

  if (sessionRef.current === '') {
    const saved = localStorage.getItem('trackedGameSession');
    sessionRef.current = saved ?? Math.random().toString(36).slice(2, 10);
    localStorage.setItem('trackedGameSession', sessionRef.current);
    t0Ref.current = Number(localStorage.getItem('trackedGameT0') ?? 0);
  }

  playersRef.current = players;

  // The full snapshot repairs a missing or drifted node. It is the first
  // step of the recovery ladder, and it runs on every reconnect.
  const sendFull = useCallback(async (state: 'live' | 'ended', w: number | null) => {
    const writer = writerRef.current;
    if (!writer || stoppedRef.current) {
      return;
    }
    const seats = toSeatStates(playersRef.current);
    const nowMs = writer.serverNow();
    const node: Record<string, unknown> = {
      v: 1,
      st: state,
      t0: t0Ref.current || nowMs,
      exp: nowMs + (state === 'ended' ? EXP_ENDED_MS : EXP_LIVE_MS),
      up: nowMs,
      wr: sessionRef.current,
      p: seats,
    };
    if (w !== null) {
      node.w = w;
    }
    t0Ref.current = node.t0 as number;
    localStorage.setItem('trackedGameT0', String(t0Ref.current));

    try {
      await writer.set(node);
      sentRef.current = seats;
      setLastSentAt(Date.now());
      setStatus('live');
    } catch (error) {
      console.warn('Live tracking stopped:', error);
      stoppedRef.current = true;
      setStatus('error');
    }
  }, []);

  // Step one of the ladder on failure, then stop. A retry loop against a
  // rejecting rule burns bandwidth and fixes nothing.
  const sendDiff = useCallback(async () => {
    const writer = writerRef.current;
    if (!writer || stoppedRef.current || !connectedRef.current) {
      dirtyRef.current = true;
      return;
    }
    const seats = toSeatStates(playersRef.current);
    const changes = diffSeats(sentRef.current, seats);
    if (Object.keys(changes).length === 0) {
      return;
    }
    const nowMs = writer.serverNow();
    try {
      await writer.update({ ...changes, up: nowMs, exp: nowMs + EXP_LIVE_MS });
      sentRef.current = seats;
      setLastSentAt(Date.now());
    } catch {
      await sendFull('live', null);
    }
  }, [sendFull]);

  const forceUpdate = useCallback(() => {
    stoppedRef.current = false;
    void sendFull(winner === null ? 'live' : 'ended', winner);
  }, [sendFull, winner]);

  // Connect once per game id.
  useEffect(() => {
    if (!gameId) {
      setStatus('idle');
      return;
    }

    let cancelled = false;
    setStatus('connecting');
    stoppedRef.current = false;
    sentRef.current = null;

    const cleanups: Array<() => void> = [];

    void (async () => {
      const db = await getTrackDatabase();
      if (!db || cancelled) {
        if (!cancelled) setStatus('error');
        return;
      }

      const { ref, onValue, onDisconnect, update, set } = await import('firebase/database');
      if (cancelled) return;

      let offset = 0;
      const node = ref(db, `live/${gameId}`);
      const serverNow = () => Date.now() + offset;

      writerRef.current = {
        update: (values) => update(node, values),
        set: (value) => set(node, value),
        serverNow,
      };

      throttleRef.current = createThrottle(THROTTLE_MS, () => void sendDiff());

      cleanups.push(
        onValue(ref(db, '.info/serverTimeOffset'), (snap) => {
          offset = (snap.val() as number | null) ?? 0;
        })
      );

      cleanups.push(
        onValue(ref(db, '.info/connected'), (snap) => {
          const connected = snap.val() === true;
          connectedRef.current = connected;

          if (!connected) {
            setStatus('offline');
            dirtyRef.current = true;
            return;
          }

          // A fired onDisconnect is consumed, so it must be set again.
          void onDisconnect(node).update({
            st: 'offline',
            off: serverNow(),
          });

          dirtyRef.current = false;
          void sendFull(winner === null ? 'live' : 'ended', winner);
        })
      );

      // The two-writer guard. Another device taking over stops this one.
      cleanups.push(
        onValue(node, (snap) => {
          const value = snap.val() as { wr?: string } | null;
          if (value?.wr && value.wr !== sessionRef.current) {
            stoppedRef.current = true;
            setStatus('taken');
          }
        })
      );
    })();

    return () => {
      cancelled = true;
      throttleRef.current?.cancel();
      cleanups.forEach((off) => off());
      writerRef.current = null;
      throttleRef.current = null;
    };
    // sendFull, sendDiff and winner are stable enough here. The hook
    // reconnects only when the game id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  // Ask for a write whenever the players change.
  useEffect(() => {
    if (!gameId || stoppedRef.current) {
      return;
    }
    throttleRef.current?.request();
  }, [gameId, players]);

  // The end of a game, and the undo of an end.
  useEffect(() => {
    if (!gameId || stoppedRef.current || !writerRef.current) {
      return;
    }
    void sendFull(winner === null ? 'live' : 'ended', winner);
  }, [gameId, winner, sendFull]);

  // A backgrounded mobile tab drops its socket, so returning must clear it.
  useEffect(() => {
    if (!gameId) return;

    const onVisible = () => {
      if (document.visibilityState === 'visible' && !stoppedRef.current) {
        void sendFull(winner === null ? 'live' : 'ended', winner);
      }
    };
    const onHide = () => throttleRef.current?.flush();

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onHide);
    };
  }, [gameId, sendFull, winner]);

  return { status, lastSentAt, forceUpdate };
}
```

- [ ] **Step 2: Verify it compiles and lints**

```bash
pnpm lint && pnpm build
```
Expected: no errors and no warnings.

- [ ] **Step 3: Commit**

```bash
git add src/Hooks/useGameTracker.ts
git commit -m "feat: add the LifeTrinket game tracker hook"
```

---

## Task 8: LifeTrinket link entry and status chip

**Repository:** LifeTrinket

**Files:**
- Create: `src/Components/Tracking/TrackingChip.tsx`
- Modify: `src/App.tsx`
- Modify: `src/Components/Views/Play.tsx:19-23`
- Modify: `src/Components/Players/PlayerMenu.tsx:159-162`

**Interfaces:**
- Consumes: `getTrackLinkFromUrl` and `clearTrackLinkFromUrl` from `src/Utils/tracking/trackLink.ts`. `useGameTracker` from `src/Hooks/useGameTracker.ts`.
- Produces: the `trackedGame` localStorage key, holding `{ gameId, seats, label, t0, wr }`.

- [ ] **Step 1: Read the track link in `App.tsx`**

Add these imports beside the existing `shareState` import:

```ts
import {
  getTrackLinkFromUrl,
  clearTrackLinkFromUrl,
} from './Utils/tracking/trackLink';
```

Also import the schema, which validates the value restored from localStorage:

```ts
import { trackLinkSchema } from './Types/Tracking';
```

Add this `useMemo` after the existing `sharedState` one:

```ts
  // A track link starts a two-player game that publishes life to EventTrinket.
  // A reopened tab restores the link from localStorage, so a resume needs
  // neither the link nor a scan.
  const trackLink = useMemo(() => {
    const fromUrl = getTrackLinkFromUrl();
    if (fromUrl) {
      localStorage.setItem('trackedGame', JSON.stringify(fromUrl));
      clearTrackLinkFromUrl();
      return fromUrl;
    }
    const saved = localStorage.getItem('trackedGame');
    if (!saved) {
      return null;
    }
    try {
      return trackLinkSchema.parse(JSON.parse(saved));
    } catch {
      localStorage.removeItem('trackedGame');
      return null;
    }
  }, []);
```

Pass it to both providers:

```tsx
    <GlobalSettingsProvider sharedState={sharedState} trackLink={trackLink}>
      <PlayersProvider sharedState={sharedState} trackLink={trackLink}>
```

- [ ] **Step 2: Build the game from the link**

In `src/Providers/GlobalSettingsProvider.tsx`, accept a new optional prop beside `sharedState`:

```ts
  trackLink,
}: {
  children: ReactNode;
  sharedState?: SharedGameState | null;
  trackLink?: TrackLink | null;
}) => {
```

In the `playing` initializer near line 49, treat a track link like shared state:

```ts
    if (sharedState || trackLink) {
      return true;
    }
```

Do the same in the `showPlay` initializer near line 67.

In `src/Providers/PlayersProvider.tsx`, accept the same prop and build the
players from the link. Add this helper above the component:

```ts
import type { TrackLink } from '../Types/Tracking';

/**
 * Seat order is fixed by the link. Seat 0 is player1 of the pairing, and
 * LifeTrinket never reorders the seats.
 */
const playersFromTrackLink = (
  link: TrackLink,
  settings: InitialGameSettings
): Player[] =>
  getInitialPlayers({
    ...settings,
    numberOfPlayers: link.seats.length,
    startingLife: link.life ?? 20,
  }).map((player, seat) => ({
    ...player,
    name: link.seats[seat],
    lifeTotal: link.life ?? 20,
  }));
```

Then use it in the `players` state initializer, before the localStorage branch
and after the `sharedState` branch:

```ts
    if (trackLink) {
      return playersFromTrackLink(trackLink, {
        ...defaultInitialGameSettings,
        numberOfPlayers: trackLink.seats.length,
        startingLife: trackLink.life ?? 20,
      });
    }
```

Check the exact signature of `getInitialPlayers` in `src/Data/getInitialPlayers.ts`
before you write this, and match its argument shape. The two fields that must
reach it are the player count and the starting life.

- [ ] **Step 3: Write the chip**

Create `src/Components/Tracking/TrackingChip.tsx`:

```tsx
import { twc } from 'react-twc';
import type { TrackerStatus } from '../../Hooks/useGameTracker';

const Chip = twc.button`
  absolute bottom-2 left-1/2 z-50 -translate-x-1/2
  flex items-center gap-2 rounded-full
  bg-black/60 px-3 py-1 text-xs text-white
`;

const Dot = twc.span`h-2 w-2 rounded-full`;

const DOT_CLASS: Record<TrackerStatus, string> = {
  idle: 'bg-gray-400',
  connecting: 'bg-gray-400',
  live: 'bg-green-500',
  offline: 'bg-amber-500',
  error: 'bg-red-500',
  taken: 'bg-red-500',
};

const LABEL: Record<TrackerStatus, string> = {
  idle: '',
  connecting: 'Connecting',
  live: 'Synced',
  offline: 'Not synced',
  error: 'Sync failed, tap to retry',
  taken: 'Another device is tracking this game',
};

export const TrackingChip = ({
  status,
  lastSentAt,
  onForce,
}: {
  status: TrackerStatus;
  lastSentAt: number | null;
  onForce: () => void;
}) => {
  if (status === 'idle') {
    return null;
  }

  const time = lastSentAt
    ? new Date(lastSentAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <Chip onClick={onForce} aria-label="Live tracking status. Tap to sync now.">
      <Dot className={DOT_CLASS[status]} />
      <span>
        {LABEL[status]}
        {status === 'live' && time ? ` ${time}` : ''}
      </span>
    </Chip>
  );
};
```

- [ ] **Step 4: Wire the chip into `Play.tsx`**

Add the imports:

```ts
import { useGameTracker } from '../../Hooks/useGameTracker';
import { TrackingChip } from '../Tracking/TrackingChip';
```

Add this after the existing `const [winner, setWinner] = useState<number | null>(null);`:

```ts
  const { trackedGameId } = useGlobalSettings();
  const tracker = useGameTracker({ gameId: trackedGameId, players, winner });
```

Add `trackedGameId: string | null` to `GlobalSettingsContextType` and to the provider value. It holds `trackLink?.id ?? null`.

Render the chip inside `MainWrapper`, after `<Players ... />`:

```tsx
      <TrackingChip
        status={tracker.status}
        lastSentAt={tracker.lastSentAt}
        onForce={tracker.forceUpdate}
      />
```

- [ ] **Step 5: Clear the tracked game on a menu reset**

In `src/Components/Players/PlayerMenu.tsx`, inside the handler at lines 159 to 162, add one line before `setPlaying(false)`:

```ts
    localStorage.removeItem('trackedGame');
```

- [ ] **Step 6: Verify against the emulator**

Start the EventTrinket emulator in that repository:

```bash
cd EventTrinket && pnpm emulators
```

In LifeTrinket, create `.env.local` with the emulator address:

```
VITE_TRACK_DATABASE_URL=http://127.0.0.1:9000/?ns=draft-trinket-default-rtdb
VITE_TRACK_PROJECT_ID=draft-trinket
VITE_TRACK_API_KEY=any-value-works-against-the-emulator
```

Run `pnpm dev`. Build a link by hand in the browser console:

```js
// Paste in the LifeTrinket tab
const { compressToEncodedURIComponent } = await import('lz-string');
location.hash = '#track=' + compressToEncodedURIComponent(JSON.stringify({
  v: 1, id: 'AAAAAAAAAABBBBBBBBBB', seats: ['Alice', 'Bob'], life: 20,
}));
location.reload();
```

Expected, in order:

1. A two-player game starts, with the names Alice and Bob.
2. The chip shows a green dot and a time.
3. The emulator UI at `http://127.0.0.1:4000/database` shows `live/AAAAAAAAAABBBBBBBBBB`.
4. Tapping life changes `p/0/l` in the emulator within 3 seconds.
5. Tapping ten times in a row produces at most one write every 3 seconds.
6. Closing the tab sets `st` to `offline` within about 30 seconds.

- [ ] **Step 7: Commit**

```bash
pnpm lint && pnpm test && pnpm build
git add src/App.tsx src/Providers/ src/Components/Views/Play.tsx src/Components/Tracking/ src/Components/Players/PlayerMenu.tsx src/Contexts/GlobalSettingsContext.tsx .env.local.example
git commit -m "feat: start a tracked game from a deep link and show sync status"
```

---

## Task 9: EventTrinket tracking IDs and the Track button

**Repository:** EventTrinket

**Files:**
- Create: `src/lib/trackIds.ts`
- Create: `src/lib/trackIds.test.ts`
- Modify: `src/types.ts`
- Modify: `src/Matches.tsx`

**Interfaces:**
- Consumes: `pairingSchema` from `src/types.ts`.
- Produces:
  - `TRACK_ID_LENGTH: 20`
  - `mintTrackId(random?: (n: number) => Uint8Array): string`
  - `buildTrackUrl(args: { baseUrl: string; id: string; seats: string[]; life?: number; label?: string }): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/trackIds.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mintTrackId, buildTrackUrl, TRACK_ID_LENGTH } from './trackIds';
import { decompressFromEncodedURIComponent } from 'lz-string';
import { pairingSchema } from '../types';

describe('mintTrackId', () => {
  it('returns an id of the agreed length', () => {
    expect(mintTrackId()).toHaveLength(TRACK_ID_LENGTH);
  });

  it('uses only the agreed alphabet', () => {
    expect(mintTrackId()).toMatch(/^[A-HJ-NP-Za-km-z2-9]{20}$/);
  });

  it('does not repeat itself', () => {
    const ids = new Set(Array.from({ length: 200 }, () => mintTrackId()));
    expect(ids.size).toBe(200);
  });
});

describe('buildTrackUrl', () => {
  it('builds a hash that decodes back to the link', () => {
    const url = buildTrackUrl({
      baseUrl: 'https://lifetrinket.web.app/',
      id: 'AAAAAAAAAABBBBBBBBBB',
      seats: ['Alice', 'Bob'],
      life: 20,
      label: 'Round 2 · Table 3',
    });

    const encoded = url.slice(url.indexOf('#track=') + '#track='.length);
    const decoded = JSON.parse(decompressFromEncodedURIComponent(encoded)!);

    expect(decoded).toEqual({
      v: 1,
      id: 'AAAAAAAAAABBBBBBBBBB',
      seats: ['Alice', 'Bob'],
      life: 20,
      label: 'Round 2 · Table 3',
    });
  });

  it('omits the optional fields when they are absent', () => {
    const url = buildTrackUrl({
      baseUrl: 'https://lifetrinket.web.app/',
      id: 'AAAAAAAAAABBBBBBBBBB',
      seats: ['Alice', 'Bob'],
    });
    const encoded = url.slice(url.indexOf('#track=') + '#track='.length);
    const decoded = JSON.parse(decompressFromEncodedURIComponent(encoded)!);
    expect(decoded).toEqual({
      v: 1,
      id: 'AAAAAAAAAABBBBBBBBBB',
      seats: ['Alice', 'Bob'],
    });
  });
});

describe('pairingSchema backward compatibility', () => {
  it('accepts a pairing saved before this feature existed', () => {
    const old = {
      player1: { id: 1, name: 'Alice', wins: 0, draws: 0, receivedBye: false },
      player2: { id: 2, name: 'Bob', wins: 0, draws: 0, receivedBye: false },
    };
    expect(pairingSchema.safeParse(old).success).toBe(true);
  });

  it('accepts a pairing that carries a trackId', () => {
    const next = {
      player1: { id: 1, name: 'Alice', wins: 0, draws: 0, receivedBye: false },
      player2: { id: 2, name: 'Bob', wins: 0, draws: 0, receivedBye: false },
      trackId: 'AAAAAAAAAABBBBBBBBBB',
    };
    expect(pairingSchema.safeParse(next).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm test src/lib/trackIds.test.ts
```
Expected: FAIL with "Failed to resolve import ./trackIds".

- [ ] **Step 3: Add `lz-string` and write the implementation**

```bash
pnpm add lz-string
```

Create `src/lib/trackIds.ts`:

```ts
import { compressToEncodedURIComponent } from 'lz-string';

export const TRACK_ID_LENGTH = 20;

// No 0, O, 1, I or l, so an id stays readable if a human ever copies it.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/**
 * About 115 bits of entropy. The modulo introduces a small bias, and at
 * that size the bias is immaterial, so rejection sampling is not required.
 */
export function mintTrackId(
  random: (n: number) => Uint8Array = (n) =>
    crypto.getRandomValues(new Uint8Array(n))
): string {
  return Array.from(random(TRACK_ID_LENGTH), (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/**
 * Builds the LifeTrinket deep link. The payload rides in the fragment, so
 * the player names never reach a server log.
 */
export function buildTrackUrl({
  baseUrl,
  id,
  seats,
  life,
  label,
}: {
  baseUrl: string;
  id: string;
  seats: string[];
  life?: number;
  label?: string;
}): string {
  const link: Record<string, unknown> = { v: 1, id, seats };
  if (life !== undefined) {
    link.life = life;
  }
  if (label !== undefined) {
    link.label = label;
  }
  return `${baseUrl}#track=${compressToEncodedURIComponent(JSON.stringify(link))}`;
}
```

- [ ] **Step 4: Add the optional field to `pairingSchema`**

In `src/types.ts`, replace `pairingSchema` with:

```ts
export const pairingSchema = z.object({
  player1: gamePlayerSchema,
  player2: gamePlayerSchema,
  // Optional on purpose. GameProvider sets the game to null on a failed
  // parse, so a required field would wipe every running tournament.
  trackId: z.optional(z.string()),
});
```

`matchesSchema` repeats the pairing shape inline. Replace its inner object with `pairings: z.array(pairingSchema)` so the two stay in step.

- [ ] **Step 5: Run the test and verify it passes**

```bash
pnpm test src/lib/trackIds.test.ts
```
Expected: all 7 tests pass.

- [ ] **Step 6: Add the Track button**

In `src/Matches.tsx`, add the imports:

```ts
import { mintTrackId, buildTrackUrl } from './lib/trackIds';
```

Add this handler beside `handleUpdatePairingStatsInMatch`:

```ts
  const LIFETRINKET_URL = 'https://lifetrinket.web.app/';

  const handleStartTracking = (pairing: Pairing, matchId: number) => {
    const trackId = mintTrackId();

    const updatedPairings: Pairing[] = game.matches[matchId].pairings.map((p) =>
      p.player1.id === pairing.player1.id && p.player2.id === pairing.player2.id
        ? { ...p, trackId }
        : p,
    );

    setGame({
      ...game,
      matches: game.matches.map((r) =>
        r.id === matchId ? { ...r, pairings: updatedPairings } : r,
      ),
    });

    window.open(
      buildTrackUrl({
        baseUrl: LIFETRINKET_URL,
        id: trackId,
        seats: [pairing.player1.name, pairing.player2.name],
        life: 20,
        label: `Round ${matchId + 1}`,
      }),
      '_blank',
      'noopener',
    );
  };
```

Inside the `match.pairings.map((pairing) => ...)` body, render a button when `!pairing.trackId` and the pairing is not a bye:

```tsx
                    {!pairing.trackId && !receivedBye && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleStartTracking(pairing, match.id)}
                      >
                        Track
                      </Button>
                    )}
```

- [ ] **Step 7: Lint, test and commit**

```bash
pnpm lint && pnpm test && pnpm build
git add src/lib/trackIds.ts src/lib/trackIds.test.ts src/types.ts src/Matches.tsx package.json pnpm-lock.yaml
git commit -m "feat: mint a tracking id per pairing and open LifeTrinket"
```

---

## Task 10: EventTrinket archive record builder

**Repository:** EventTrinket

**Files:**
- Create: `src/lib/archive.ts`
- Create: `src/lib/archive.test.ts`

**Interfaces:**
- Consumes: `Pairing` from `src/types.ts`.
- Produces:
  - `type LiveNode = { v: 1; st: 'live' | 'offline' | 'ended'; t0: number; exp: number; up: number; wr: string; off?: number; w?: number; p: Array<{ l: number; poi?: number; cmd?: number }> }`
  - `type ArchiveRecord` — the Firestore shape from Task 2.
  - `buildArchiveRecord(args: { node: LiveNode; pairing: Pairing; roundId: number; status: 'final' | 'abandoned' }): ArchiveRecord` — `archivedAt` is added by the caller, so it is not part of this type
  - `isReadyToArchive(node: LiveNode, nowMs: number, graceMs: number): 'final' | 'abandoned' | null`
  - `GRACE_MS: 900000`

- [ ] **Step 1: Write the failing test**

Create `src/lib/archive.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildArchiveRecord, isReadyToArchive, GRACE_MS, type LiveNode } from './archive';
import type { Pairing } from '../types';

const pairing: Pairing = {
  player1: { id: 3, name: 'Alice', wins: 0, draws: 0, receivedBye: false },
  player2: { id: 7, name: 'Bob', wins: 0, draws: 0, receivedBye: false },
};

const node = (over: Partial<LiveNode> = {}): LiveNode => ({
  v: 1,
  st: 'ended',
  t0: 1758290000000,
  exp: 1758300000000,
  up: 1758293600000,
  wr: 'sess01',
  w: 0,
  p: [{ l: 20 }, { l: 0 }],
  ...over,
});

describe('buildArchiveRecord', () => {
  it('maps a finished game', () => {
    expect(
      buildArchiveRecord({ node: node(), pairing, roundId: 1, status: 'final' }),
    ).toEqual({
      v: 1,
      status: 'final',
      seats: [
        { name: 'Alice', tournamentPlayerId: 3 },
        { name: 'Bob', tournamentPlayerId: 7 },
      ],
      life: [20, 0],
      poison: null,
      commanderDamage: null,
      winnerSeat: 0,
      roundId: 1,
      startedAt: 1758290000000,
      endedAt: 1758293600000,
    });
  });

  it('carries poison and commander damage when the node has them', () => {
    const record = buildArchiveRecord({
      node: node({ p: [{ l: 20, poi: 1, cmd: 0 }, { l: 5, poi: 10, cmd: 21 }] }),
      pairing,
      roundId: 0,
      status: 'final',
    });
    expect(record.poison).toEqual([1, 10]);
    expect(record.commanderDamage).toEqual([0, 21]);
  });

  it('reports no winner for an abandoned game', () => {
    const record = buildArchiveRecord({
      node: node({ st: 'offline', w: undefined }),
      pairing,
      roundId: 0,
      status: 'abandoned',
    });
    expect(record.winnerSeat).toBeNull();
    expect(record.status).toBe('abandoned');
  });
});

describe('isReadyToArchive', () => {
  it('reports final for an ended game', () => {
    expect(isReadyToArchive(node(), 1758293600000, GRACE_MS)).toBe('final');
  });

  it('reports nothing for a live game', () => {
    expect(isReadyToArchive(node({ st: 'live' }), 1758293600000, GRACE_MS)).toBeNull();
  });

  it('reports nothing while an offline game is inside the grace period', () => {
    const offline = node({ st: 'offline', off: 1758293600000, w: undefined });
    expect(isReadyToArchive(offline, 1758293600000 + GRACE_MS - 1, GRACE_MS)).toBeNull();
  });

  it('reports abandoned once the grace period passed', () => {
    const offline = node({ st: 'offline', off: 1758293600000, w: undefined });
    expect(isReadyToArchive(offline, 1758293600000 + GRACE_MS + 1, GRACE_MS)).toBe('abandoned');
  });

  it('falls back to up when off is absent', () => {
    const offline = node({ st: 'offline', up: 1758293600000, off: undefined, w: undefined });
    expect(isReadyToArchive(offline, 1758293600000 + GRACE_MS + 1, GRACE_MS)).toBe('abandoned');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm test src/lib/archive.test.ts
```
Expected: FAIL with "Failed to resolve import ./archive".

- [ ] **Step 3: Write the implementation**

Create `src/lib/archive.ts`:

```ts
import type { Pairing } from '../types';

export const GRACE_MS = 15 * 60 * 1000;

export type SeatState = { l: number; poi?: number; cmd?: number };

export type LiveNode = {
  v: 1;
  st: 'live' | 'offline' | 'ended';
  t0: number;
  exp: number;
  up: number;
  wr: string;
  off?: number;
  w?: number;
  p: SeatState[];
};

export type ArchiveStatus = 'final' | 'abandoned';

export type ArchiveRecord = {
  v: 1;
  status: ArchiveStatus;
  seats: Array<{ name: string; tournamentPlayerId: number }>;
  life: number[];
  poison: number[] | null;
  commanderDamage: number[] | null;
  winnerSeat: number | null;
  roundId: number;
  startedAt: number;
  endedAt: number;
};

const column = (seats: SeatState[], key: 'poi' | 'cmd'): number[] | null =>
  seats.some((seat) => seat[key] !== undefined)
    ? seats.map((seat) => seat[key] ?? 0)
    : null;

export function buildArchiveRecord({
  node,
  pairing,
  roundId,
  status,
}: {
  node: LiveNode;
  pairing: Pairing;
  roundId: number;
  status: ArchiveStatus;
}): ArchiveRecord {
  return {
    v: 1,
    status,
    seats: [
      { name: pairing.player1.name, tournamentPlayerId: pairing.player1.id },
      { name: pairing.player2.name, tournamentPlayerId: pairing.player2.id },
    ],
    life: node.p.map((seat) => seat.l),
    poison: column(node.p, 'poi'),
    commanderDamage: column(node.p, 'cmd'),
    winnerSeat: node.w ?? null,
    roundId,
    startedAt: node.t0,
    endedAt: node.up,
  };
}

/**
 * An offline table stays live on the board during the grace period. The
 * period is long on purpose, because a backgrounded mobile tab drops its
 * socket and fires onDisconnect.
 */
export function isReadyToArchive(
  node: LiveNode,
  nowMs: number,
  graceMs: number
): ArchiveStatus | null {
  if (node.st === 'ended') {
    return 'final';
  }
  if (node.st === 'offline' && (node.off ?? node.up) + graceMs < nowMs) {
    return 'abandoned';
  }
  return null;
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
pnpm test src/lib/archive.test.ts
```
Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
pnpm lint && pnpm test
git add src/lib/archive.ts src/lib/archive.test.ts
git commit -m "feat: add the archive record builder and the grace rule"
```

---

## Task 11: EventTrinket listeners, archive and sweep

**Repository:** EventTrinket

**Files:**
- Create: `src/lib/trackDb.ts`
- Create: `src/hooks/useTrackedGames.ts`
- Modify: `.env.production`
- Modify: `.env.local`

**Interfaces:**
- Consumes: `buildArchiveRecord`, `isReadyToArchive`, `GRACE_MS`, `LiveNode` from `src/lib/archive.ts`. `db` from `src/lib/firebase.ts`.
- Produces:
  - `rtdb: Database`
  - `type TrackedGameView = { node: LiveNode | null; error: boolean }`
  - `useTrackedGames(pairings: Array<{ pairing: Pairing; roundId: number; trackId: string }>): Record<string, TrackedGameView>`
  - `sweepExpired(trackIds: string[]): Promise<number>` — returns the number of nodes deleted

- [ ] **Step 1: Add the database to the Firebase handle**

Create `src/lib/trackDb.ts`:

```ts
import { getApp } from 'firebase/app';
import { connectDatabaseEmulator, getDatabase } from 'firebase/database';

// The development server talks to the emulator, exactly as Firestore does.
// See src/lib/firebase.ts for why the switch also tests import.meta.env.DEV.
const useEmulator = import.meta.env.DEV && import.meta.env.VITE_USE_LIVE_DB !== 'true';

const app = getApp(useEmulator ? 'emulator' : '[DEFAULT]');

export const rtdb = getDatabase(app, import.meta.env.VITE_TRACK_DATABASE_URL);

if (useEmulator) {
  connectDatabaseEmulator(rtdb, '127.0.0.1', 9000);
}
```

Add one line to `.env.production` and to `.env.local`:

```
VITE_TRACK_DATABASE_URL=https://draft-trinket-default-rtdb.europe-west1.firebasedatabase.app
```

Add `VITE_TRACK_DATABASE_URL` to the `REQUIRED_ENV` array in `vite.config.ts`, so a build without it stops instead of failing in the browser.

- [ ] **Step 2: Write the hook**

Create `src/hooks/useTrackedGames.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
import { onValue, ref, remove, get } from 'firebase/database';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { rtdb } from '../lib/trackDb';
import { db } from '../lib/firebase';
import {
  GRACE_MS,
  buildArchiveRecord,
  isReadyToArchive,
  type LiveNode,
} from '../lib/archive';
import type { Pairing } from '../types';

const GRACE_TICK_MS = 30 * 1000;

export type TrackedGameView = { node: LiveNode | null; error: boolean };

export type TrackedPairing = {
  pairing: Pairing;
  roundId: number;
  trackId: string;
};

/**
 * Deletes the expired nodes among the tracking ids this device knows.
 *
 * `/live` has no list read, because a relational comparison on `query.endAt`
 * is not supported in Realtime Database rules. That costs nothing here:
 * EventTrinket holds every tracking id in its own game state, on every
 * pairing of every match, so it never needed a query to find them.
 *
 * The rules permit a delete only on an expired node, so this cannot remove
 * a live game even if the check below were wrong. It replaces a scheduled
 * function, which would need the Blaze plan.
 */
export async function sweepExpired(trackIds: string[]): Promise<number> {
  let removed = 0;

  await Promise.all(
    trackIds.map(async (trackId) => {
      try {
        const snap = await get(ref(rtdb, `live/${trackId}`));
        const node = snap.val() as LiveNode | null;
        if (node && node.exp < Date.now()) {
          await remove(ref(rtdb, `live/${trackId}`));
          removed += 1;
        }
      } catch (error) {
        console.warn(`Sweep skipped ${trackId}:`, error);
      }
    })
  );

  return removed;
}

export function useTrackedGames(
  tracked: TrackedPairing[]
): Record<string, TrackedGameView> {
  const [views, setViews] = useState<Record<string, TrackedGameView>>({});
  const archivedRef = useRef<Set<string>>(new Set());
  const trackedRef = useRef<TrackedPairing[]>(tracked);
  const viewsRef = useRef<Record<string, TrackedGameView>>({});

  trackedRef.current = tracked;
  viewsRef.current = views;

  const ids = tracked.map((t) => t.trackId).sort().join(',');

  // One listener per tracked game. The SDK multiplexes them over one socket.
  useEffect(() => {
    const offs = trackedRef.current.map(({ trackId }) =>
      onValue(
        ref(rtdb, `live/${trackId}`),
        (snap) => {
          setViews((prev) => ({
            ...prev,
            [trackId]: { node: (snap.val() as LiveNode | null) ?? null, error: false },
          }));
        },
        () => {
          setViews((prev) => ({ ...prev, [trackId]: { node: null, error: true } }));
        }
      )
    );

    return () => offs.forEach((off) => off());
  }, [ids]);

  // An offline node sends no snapshot, so the grace needs its own tick.
  useEffect(() => {
    const archive = async () => {
      const now = Date.now();

      for (const { pairing, roundId, trackId } of trackedRef.current) {
        const node = viewsRef.current[trackId]?.node;
        if (!node) {
          continue;
        }

        const status = isReadyToArchive(node, now, GRACE_MS);
        if (!status) {
          // A resumed game clears its marker, so it archives again at the end.
          archivedRef.current.delete(trackId);
          continue;
        }
        if (archivedRef.current.has(trackId)) {
          continue;
        }

        try {
          await setDoc(doc(db, 'trackedGames', trackId), {
            ...buildArchiveRecord({ node, pairing, roundId, status }),
            archivedAt: serverTimestamp(),
          });
          archivedRef.current.add(trackId);
        } catch (error) {
          // Firestore persistentLocalCache queues the write. Retry next tick.
          console.warn('Archive deferred:', error);
        }
      }
    };

    void archive();
    const timer = setInterval(() => void archive(), GRACE_TICK_MS);
    return () => clearInterval(timer);
  }, [ids]);

  // The sweep runs on mount and whenever the tracked set changes, which
  // includes every round change.
  useEffect(() => {
    void sweepExpired(trackedRef.current.map((t) => t.trackId));
  }, [ids]);

  return views;
}
```

- [ ] **Step 3: Verify it compiles**

```bash
pnpm lint && pnpm build
```
Expected: no errors and no warnings.

- [ ] **Step 4: Commit**

```bash
git add src/lib/trackDb.ts src/hooks/useTrackedGames.ts .env.production .env.local vite.config.ts
git commit -m "feat: listen to tracked games, archive them and sweep expired nodes"
```

---

## Task 12: EventTrinket live readout

**Repository:** EventTrinket

**Files:**
- Modify: `src/Matches.tsx`

**Interfaces:**
- Consumes: `useTrackedGames` and `TrackedGameView` from `src/hooks/useTrackedGames.ts`.
- Produces: nothing for later tasks.

- [ ] **Step 1: Collect the tracked pairings**

In `src/Matches.tsx`, add this **above** the `if (!game) return;` guard, right
after `const { game, setGame } = useGame();`. A hook must never sit behind an
early return, so `tracked` handles the null game itself:

```ts
  const tracked = (game?.matches ?? []).flatMap((match) =>
    match.pairings
      .filter((pairing) => Boolean(pairing.trackId))
      .map((pairing) => ({ pairing, roundId: match.id, trackId: pairing.trackId! })),
  );

  const liveGames = useTrackedGames(tracked);
```

- [ ] **Step 2: Render the readout**

Replace the Track button block from Task 9 with this, inside the same `pairing` map:

```tsx
                    {!pairing.trackId && !receivedBye && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleStartTracking(pairing, match.id)}
                      >
                        Track
                      </Button>
                    )}
                    {pairing.trackId && (
                      <LifeReadout view={liveGames[pairing.trackId]} />
                    )}
```

Add this component at the bottom of `src/Matches.tsx`:

```tsx
const LifeReadout = ({ view }: { view?: TrackedGameView }) => {
  if (!view) {
    return <span className="text-xs text-muted-foreground">Waiting…</span>;
  }
  if (view.error) {
    return <span className="text-xs text-muted-foreground">Unavailable</span>;
  }
  if (!view.node) {
    return <span className="text-xs text-muted-foreground">Not started</span>;
  }

  const { st, p, up } = view.node;
  const seen = new Date(up).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <span className={st === 'offline' ? 'text-xs opacity-50' : 'text-xs'}>
      {p.map((seat) => seat.l).join(' – ')}
      {st === 'offline' ? ` (last seen ${seen})` : ''}
      {st === 'ended' ? ' (ended)' : ''}
    </span>
  );
};
```

Add the import:

```ts
import { useTrackedGames, type TrackedGameView } from './hooks/useTrackedGames';
```

- [ ] **Step 3: Verify against the emulator**

Start the emulator, then `pnpm dev`. Create a tournament with two players, generate a round, and press Track. Then run the LifeTrinket dev server from Task 8, Step 6, against the same emulator.

Expected, in order:

1. The readout shows `20 – 20` within a few seconds.
2. A tap in LifeTrinket changes the readout within 3 seconds.
3. Closing the LifeTrinket tab greys the readout and adds "last seen".
4. Tapping the lose button in LifeTrinket adds "(ended)".
5. The emulator UI at `http://127.0.0.1:4000/firestore` shows one `trackedGames` document with `status: "final"`.

- [ ] **Step 4: Commit**

```bash
pnpm lint && pnpm test && pnpm build
git add src/Matches.tsx
git commit -m "feat: show live life totals beside each tracked pairing"
```

---

## Task 13: Live verification and documentation

**Repository:** both

**Files:**
- Modify: `EventTrinket/CLAUDE.md`
- Modify: `EventTrinket/RELEASE.md`
- Modify: `LifeTrinket/CLAUDE.md`
- Modify: `LifeTrinket/docs/ROADMAP.md`

- [ ] **Step 1: Create the live database**

In the Firebase console, open the `draft-trinket` project. Create a Realtime Database instance in region `europe-west1`. The region cannot be changed afterwards.

Copy the instance URL into `LifeTrinket/.env.production` and `EventTrinket/.env.production`.

- [ ] **Step 2: Deploy the rules**

```bash
cd EventTrinket
firebase deploy --only database,firestore:rules
```

- [ ] **Step 3: Run the live check**

Deploy both apps. Track one real pairing, and confirm the six expectations from Task 8 Step 6 and the five from Task 12 Step 3 against the live database.

- [ ] **Step 4: Check the usage after the check**

Open the Firebase console, Realtime Database, Usage tab. Record the bytes downloaded and the peak connections. Compare them against the spec table in section 2.

Expected: well under 1 MB downloaded, and under 5 peak connections.

- [ ] **Step 5: Document it**

In `LifeTrinket/CLAUDE.md`, add a section after "Firebase Analytics Integration":

```markdown
## Live Game Tracking

A `#track=` deep link from EventTrinket starts a game that publishes life
totals to `/live/{gameId}` in the `draft-trinket` Realtime Database.

The write policy is a trailing-edge throttle of 3 seconds, in
`src/Utils/tracking/throttle.ts`. The node carries no player names.

Tracking must never degrade the counter. Every failure sets the tracker
status to `error` and stops. No failure throws into React.

The design is in `docs/superpowers/specs/2026-09-19-eventtrinket-life-tracking-design.md`.
```

In `EventTrinket/CLAUDE.md`, add a matching section that names `database.rules.json`, the emulator port 9000, and `src/hooks/useTrackedGames.ts`.

In `EventTrinket/RELEASE.md`, add one line: a rules change needs
`firebase deploy --only database,firestore:rules`.

In `LifeTrinket/docs/ROADMAP.md`, mark the relationship to "Multiplayer Sync" so a later reader knows this feature covers part of it.

- [ ] **Step 6: Commit in both repositories**

```bash
cd LifeTrinket && git add CLAUDE.md docs/ROADMAP.md .env.production
git commit -m "docs: document live game tracking"

cd ../EventTrinket && git add CLAUDE.md RELEASE.md .env.production
git commit -m "docs: document live game tracking"
```

---

## Optional follow-up: App Check

The spec recommends this, and it is not required for the feature to work.

Enable Firebase App Check on `draft-trinket` with the reCAPTCHA v3 provider.
Register both web apps. Run it in **monitoring mode for one week** before you
enforce it. Enforcement on an offline-first PWA can block a legitimate write
when a token cannot be fetched, and the tracker then shows `error`.

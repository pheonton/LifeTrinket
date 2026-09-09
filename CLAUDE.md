# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `pnpm run dev` - Start Vite development server with hot reload
- `pnpm run build` - TypeScript compilation followed by Vite production build
- `pnpm run preview` - Preview production build locally

### Code Quality
- `pnpm run lint` - Run ESLint with TypeScript parser

### Deployment & Assets
- Deployment is automatic: **Cloudflare Pages** builds and deploys on every push to `main` (build command `pnpm run build`, output `dist`). There is no deploy script.
- `pnpm run generate-icons` - Generate React components from SVG files in `src/Icons/svgs/`
- `pnpm run release` - Tag a new version; `.github/workflows/release.yml` bumps `package.json` and publishes a GitHub Release

### Requirements
- Node.js >= 20
- pnpm (yarn and npm are explicitly blocked via package.json engines)

## Architecture Overview

Life Trinket is a Magic the Gathering life counter PWA built with React 19, TypeScript, and Tailwind CSS v4. The application follows an offline-first architecture with localStorage as the primary persistence layer.

### Core Stack
- **React 19.2.0** with functional components and hooks
- **Vite** with SWC for fast compilation
- **Tailwind CSS v4** with `react-twc` for typed, styled components
- **TypeScript** in strict mode
- **Zod** for runtime validation of persisted data
- **No third-party analytics** (`useAnalytics` is a console-only no-op in this fork)
- **vite-plugin-pwa** with Workbox for offline functionality
- **Cloudflare Pages** for static hosting

### Application Flow
```
StartMenu → PreStart (optional mini-games) → Play → GameOver (optional) → repeat
```

View routing is controlled by `showPlay` and `playing` flags in GlobalSettingsContext.

## State Management Architecture

The application uses a **two-context architecture** for separation of concerns:

### PlayersContext (`src/Contexts/PlayersContext.tsx`)
Manages all game-specific player state:
- `players: Player[]` - Array of player game state
- `updatePlayer(player)` - Update individual player
- `updateLifeTotal(player, total)` - Update life and return difference for animations
- `resetCurrentGame()` - Reset to initial settings without clearing game score
- `startingPlayerIndex` - Tracks who goes first

**Player State Structure** (`src/Types/Player.ts`):
```typescript
{
  lifeTotal: number,
  color: string,                    // Hex color for card background
  iconTheme: 'light' | 'dark',      // Auto-calculated via WCAG contrast
  commanderDamage: CommanderDamage[], // Damage from each opponent
  extraCounters: ExtraCounter[],    // Poison, energy, experience
  isMonarch: boolean,
  hasLost: boolean,
  isSide: boolean,                  // 90° rotated in layout
  // ... other properties
}
```

### GlobalSettingsContext (`src/Contexts/GlobalSettingsContext.tsx`)
Manages application-wide state and navigation:
- `showPlay` / `playing` - View routing state
- `initialGameSettings` - Game setup configuration (player count, starting life, etc.)
- `settings` - User preferences
- `savedGame` - Full game snapshot for pause/resume functionality
- `gameScore` - Match score tracking across multiple games
- `fullscreen`, `wakeLock` - Device API wrappers
- `version` - Installed vs remote version comparison via GitHub API

### Custom Hooks Pattern
Access contexts through custom hooks that enforce proper provider nesting:
- `usePlayers()` - Access PlayersContext with error boundary
- `useGlobalSettings()` - Access GlobalSettingsContext with error boundary

These hooks throw descriptive errors if used outside their providers, preventing runtime context errors.

## Data Persistence

**LocalStorage Keys**:
- `players` - Current player state array
- `initialGameSettings` - Game setup configuration
- `settings` - User preferences
- `playing` / `showPlay` - View routing flags
- `savedGame` - Full game snapshot (cleared on resume)
- `gameScore` - Match score tracking
- `lifeHistory` - Per-game life change events
- `deckStats` - Cross-game per-deck stats (see Deck Stats below)
- `startingPlayerIndex`, `preStartComplete` - Misc game state

**Validation Strategy**:
1. All persisted data has Zod schemas defined in `src/Types/Settings.ts`
2. On hydration from localStorage, data is validated against schemas
3. Invalid data falls back to defaults rather than crashing
4. Type-safe at compile time, validated at runtime

**Saved Game Pattern**:
The `savedGame` mechanism allows users to pause and resume games. When saving, it captures `initialGameSettings`, `players` array, and optionally `gameScore`. When resuming, state is restored and `savedGame` is cleared from localStorage.

## Layout System

### Dynamic Grid Layouts
The application supports 1-6 players with automatic layout adjustment. All layouts are defined in `tailwind.config.ts` as `twGridTemplateAreas` with 15 predefined configurations for different player counts and orientations (portrait/landscape).

### Player Card Rotation
Player cards are rotated based on their position to face each player around a table:
- Rotation is calculated during player initialization in `src/Data/getInitialPlayers.ts`
- Each player has 4 possible rotation states: 0°, 90°, 180°, 270°
- The `isSide` flag indicates 90° rotations
- All major components (LifeCounter, Health, CommanderDamage, etc.) are rotation-aware

Example: In a 4-player game in portrait orientation:
- Player 0 (bottom): 0° rotation
- Player 1 (left): 90° rotation (`isSide: true`)
- Player 2 (top): 180° rotation
- Player 3 (right): 270° rotation (`isSide: true`)

### Responsive Font Sizing
The Health component uses ResizeObserver to dynamically calculate font sizes based on available container space, ensuring life totals are always legible regardless of player count or device orientation.

## Component Architecture

### Component Hierarchy
```
App
├── PlayersProvider
│   └── GlobalSettingsProvider
│       └── LifeTrinket (main router)
│           ├── StartMenu (setup and configuration)
│           │   ├── InfoDialog
│           │   ├── SettingsDialog
│           │   └── LayoutOptions
│           └── Play (active game view)
│               ├── PreStart (optional randomizers/mini-games)
│               ├── Players (grid container)
│               │   └── LifeCounter (per player)
│               │       ├── Health (life total + ±buttons)
│               │       ├── CommanderDamageBar
│               │       ├── ExtraCountersBar
│               │       ├── PlayerMenu (swipe-to-open)
│               │       └── LoseGameButton (conditional)
│               └── GameOver (when winner determined)
```

### Component Communication
- **Props**: Top-down data flow for display values
- **Context Hooks**: Bottom-up state updates via `usePlayers()` and `useGlobalSettings()`
- **Gesture Events**: Touch/click handlers with custom long-press detection

### Typed Tailwind Components
The codebase uses `react-twc` to create typed, styled components. This provides TypeScript autocomplete for Tailwind classes while maintaining component composition:

```typescript
import { twc } from 'react-twc';

const StyledDiv = twc.div`flex items-center justify-center`;
```

## Gesture Detection Patterns

### Life Counter Interactions
- **Tap**: ±1 life (immediate)
- **Long Press** (>300ms): ±10 life (defined by `lifeLongPressMultiplier` in `src/Data/constants.ts`)

Implementation uses custom touch event handlers with:
- Touch start/end tracking
- Movement threshold (20px max to still count as tap)
- Timer-based long press detection
- Prevention of scroll during interactions

### Counter Interactions
- **Tap**: Increment counter
- **Long Press**: Decrement counter

### Player Menu
Uses `react-swipeable` for swipe-to-open drawer on each player card. Accessible via swipe gesture or dedicated button.

## Color & Contrast Handling

The `src/Utils/checkContrast.ts` utility calculates WCAG contrast ratios to determine if icons should be light or dark on each player's background color:

1. Convert hex color to RGB
2. Calculate relative luminance
3. Compute contrast ratio against white/black
4. Set `iconTheme: 'light' | 'dark'` accordingly

This ensures all UI elements remain legible regardless of the player's chosen color.

## Player Initialization Logic

`src/Data/getInitialPlayers.ts` contains complex logic for creating player objects:

1. **Color Assignment**: Random colors from preset palette (8 colors, excluding duplicates)
2. **Rotation Calculation**: Based on player count, position, and device orientation
3. **Commander Damage Tracking**: Initializes damage tracking between all opponent pairs
4. **Extra Counters**: Sets up poison, energy, and experience counters per player
5. **Layout Flags**: Sets `isSide` for 90°/270° rotations

When modifying player initialization, ensure all rotation states are tested for 1-6 players in both portrait and landscape orientations.

## Platform-Specific Handling

The application detects iOS/iPad and stores flags on the window object:
```typescript
window.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
window.isIPad = /iPad/.test(navigator.userAgent)
```

These are used for platform-specific behaviors like wake lock handling and PWA detection.

## Deck Stats

Cross-game statistics keyed by deck name, persisted in `localStorage` under
`deckStats`.

- **Entry**: each player sets a deck name from the in-game player menu
  (`src/Components/Players/PlayerMenu.tsx`) via the deck-name dialog
  (`openDeckNameDialog` / `commitDeckName` / `pickDeck`). It has type-to-filter
  chips of previously-used deck names (from `deckStats` plus decks the other
  players in this game picked), most-recently-played first, and saves on close.
  The name lives on `Player.deckName` and persists across games within a match.
- **Recording**: `Play.tsx` calls `recordGame(players, winnerIndex)` from both
  `<GameOver>` exit handlers. Only runs when `settings.showMatchScore` is on and
  there are ≥2 players (that's what triggers game-over detection). Games
  abandoned via reset / back-to-start are not recorded.
- **Aggregation**: `recordGameToDeckStats` in `src/Types/DeckStats.ts` is a pure
  fold. Blank deck names are ignored; seats sharing a normalized name count as
  one deck for that game. Tracks `gamesPlayed`, `wins`, `losses`,
  `opponentsFaced` (cumulative), `lastPlayed`. Win % is derived, not stored.
- **Viewing**: `DeckStatsDialog` (`src/Components/Dialogs/DeckStatsDialog.tsx`),
  opened from the bar-chart button on the start menu. Supports per-deck delete
  and clear-all.
- **State**: `deckStats` / `recordGame` / `clearDeckStats` / `deleteDeck` on
  `GlobalSettingsContext`, implemented in `GlobalSettingsProvider`.

## Commander Art

Purely cosmetic: in Commander games (`player.settings.useCommanderDamage`) a
player card shows the commander's card art instead of the flat colour.

- **Entry**: a button next to the colour picker in the player menu
  (`src/Components/Players/PlayerMenu.tsx`), shown only for commander games,
  opening its own dialog with a live Scryfall search + thumbnail. The dialog
  saves on close (no Save button) - the `Check` icon in the header is the
  "done" affordance, and clicking the Scryfall result commits that commander
  (pinning the canonical card name) and closes, mirroring the deck-name chips.
  Committed to `player.commanderName`.
- **Colour**: picking a commander also sets `player.color` (and `iconTheme`)
  from a colour sampled off the art (`src/Utils/imageColor.ts` /
  `src/Hooks/useDerivedColor.ts`) - so colour isn't a second thing to set. The
  colour picker still works as a manual override and for non-commander games.
- **Lifetime**: local cosmetic only. It's on the player so a mid-game reload
  keeps it (`players` localStorage) and it lasts the match, but it is
  **stripped from the QR-share** (`encodeGameState` in `src/Utils/shareState.ts`)
  and the **pause/resume snapshot** (`handleGoToStart` in `PlayerMenu.tsx`).
  Cleared when a new game starts (`getInitialPlayers`).
- **Fetch**: `src/Utils/scryfall.ts` (`fetchCommanderArt`, fuzzy
  `api.scryfall.com/cards/named`, in-memory result + in-flight cache, never
  throws) behind `src/Hooks/useCommanderArt.ts` (debounced, derives state from
  the shared cache during render). The image URL is `art_crop`.
- **Render**: `LifeCounter` reads `useCommanderArt(player.commanderName)` and,
  when there's a URL, adds an inset art container as the first child of
  `LifeCounterWrapper` at `z-[-1] isolate` (behind everything),
  `[container-type:size]` + `overflow-hidden`. The container only spans the
  card *below/beside* the commander-damage bar (`top: 10vmin` non-side /
  `left: 6vmax` side), so the bar never overlaps the art. Inside is a single
  layer sized to that rectangle - `100cqw × 100cqh`, **swapped** to
  `100cqh × 100cqw` for side seats so it still covers after the turn - with
  `background-size: cover` and `background-position: 50% 20%` (this is what
  frames the crop; an over-scan square would centre-clip and make
  `background-position` inert). It is rotated `isSideRotation ? -90 : 0`.
  That angle matches the **net on-screen rotation of the life number**
  (`OutlinedText`: side seats get -90), *not* the wrapper's `calcRotation`
  (0/180) - the wrapper contributes the 0/180, side seats need the extra -90
  to face the player. Over the art `iconTheme` is forced to `'light'`
  (`displayPlayer`) and `Health` gets `hasCommanderArt` to firm up its label.
- **Damage bar**: each cell in `CommanderDamage` shows that opponent's
  commander art (`useCommanderArt(opponent.commanderName)`) with the identical
  layer treatment - own `[container-type:size]` wrapper, rect-sized/swapped,
  `rotate(isSideRotation ? -90 : 0)`, `background-position: 50% 20%`, same
  overlay - so a mini reads the same way as the big background. Framing on the
  minis is a known limitation: the cells are very wide-and-short, so one crop
  position can't suit every card.
- **Overlay** (same on the background art and every damage-bar cell): the
  relevant player's colour at `mix-blend-multiply` ~0.55 plus a light
  `bg-black/15` - dims for legibility and casts the art toward that player's
  hue while keeping it recognisable.
- **Fallback**: offline / not found / non-commander → no art layer → the
  existing flat `player.color`, unchanged.
- **PWA**: `vite.config.ts` `runtimeCaching` caches `cards.scryfall.io` images
  (CacheFirst) and `api.scryfall.com` lookups (NetworkFirst).
- A future CSP in `public/_headers` must allow `connect-src api.scryfall.com`
  and `img-src cards.scryfall.io`.

## Analytics

`src/Hooks/useAnalytics.ts` exposes `useAnalytics().trackEvent(name, params)`,
called from many components. This fork has **no analytics provider**: in
development `trackEvent` logs to the console, and in production it does nothing.
The call sites are left in place so a provider can be added by implementing the
body of `trackEvent`.

Grafana Faro telemetry (`src/Utils/telemetry.ts`) is also present but inert
unless `VITE_GRAFANA_FARO_URL` is set *and* the runtime origin is in that file's
`ALLOWED_ORIGINS` list.

## Version Management

The app checks for updates via GitHub API:
- Installed version from `package.json` via `import.meta.env.VITE_APP_VERSION`
- Remote version fetched from the latest GitHub Release of `pheonton/LifeTrinket` (see `checkForNewVersion` in `src/Providers/GlobalSettingsProvider.tsx`); if there is no release, the app treats itself as current
- Comparison uses `semver` library
- Update notification shown in UI if newer version available

## PWA Configuration

PWA settings in `vite.config.ts`:
- **Auto-update**: Service worker updates automatically
- **Skip Waiting**: New service worker activates immediately
- **Clients Claim**: Takes control of all clients immediately
- **Offline Support**: Full offline functionality after initial load

Manifest configuration in `index.html` includes theme colors, icons, and display settings.

## Important Considerations

### When Adding New Settings
1. Add Zod schema in `src/Types/Settings.ts`
2. Update localStorage key mapping
3. Add to appropriate context provider
4. Ensure validation fallback behavior is sensible

### When Modifying Layouts
1. Update `twGridTemplateAreas` in `tailwind.config.ts`
2. Test all player counts (1-6) in both orientations
3. Verify rotation calculations in `getInitialPlayers.ts`
4. Ensure font sizing remains legible

### When Adding New Counter Types
1. Update `ExtraCounter` type in `src/Types/Player.ts`
2. Add counter creation logic in `getInitialPlayers.ts`
3. Update `ExtraCountersBar` component rendering
4. Consider lose conditions (like poison at 10)

### When Modifying Commander Damage
Commander damage is bidirectional between all players. When adding/modifying:
1. Update in player's `commanderDamage` array
2. Index corresponds to opponent's index in `players` array
3. Each `CommanderDamage` object has `amount` and `isPartner` flag
4. Lose condition is ≥21 damage from any single commander

### Testing Gestures
Long-press and tap behaviors have specific timing and distance thresholds defined in `src/Data/constants.ts`. When modifying gesture detection:
- Test on actual touch devices (mouse events behave differently)
- Verify accidental scroll prevention
- Ensure long-press doesn't trigger tap
- Check that movement cancels long-press appropriately

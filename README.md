# 🏐 Bounce Court

A fast 1-versus-1 physics volleyball arcade game for the browser.
**Three buttons. Bottomless physics.**

Two soft-bodied creatures — *Bouncers* — face off across a net on a floating
court. There is no hit button: every shot emerges from where the ball touches
your body, how fast you're moving, and when you jump. Easy to read in five
seconds, hard to master over hundreds of rallies.

![Stack](https://img.shields.io/badge/stack-TypeScript%20%C2%B7%20Vite%20%C2%B7%20Three.js-blue)

## Running locally

```bash
npm install
npm run dev        # development server (http://localhost:5173)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

No accounts, no network calls, no analytics. Preferences and cosmetic
progression live in `localStorage`.

## Controls

| Action | Player 1 | Player 2 |
| --- | --- | --- |
| Move left | `A` | `←` |
| Move right | `D` | `→` |
| Jump | `W` or `Space` | `↑` |
| Pause | `Esc` | `Esc` |
| Debug panel | `` ` `` (backquote) | — |

All keys are remappable in **Settings → Controls** (persisted). Gamepads are
supported: pad 1 drives Player 1, pad 2 drives Player 2 (left stick / d-pad +
bottom face button to jump).

**There is no hit button.** Contact point, body velocity, and ball velocity
shape every shot: hit with your side to angle the ball, with your top to pop
it up, while rising in a jump to spike.

## Modes

- **Quick Match** — instantly starts vs AI with your last settings.
- **Single Player** — four AI levels: Relaxed, Standard, Skilled, Rival.
- **Local Versus** — two players, one keyboard, full simultaneous input.
- **Training Lab** — nine exercises with trajectory preview and landing
  markers (training-only aids).
- **Survival** — consecutive short matches against ever-sharper AI.

Rules: rally scoring, first to 5/11/15/21 (win-by-two optional, hard cap at
30), maximum 4 consecutive touches per side. The point winner serves next.

## Project architecture

```
src/
  config.ts            All gameplay tuning in one documented module
  main.ts              Bootstrap + mode orchestration (App)
  core/loop.ts         Fixed-timestep loop (120 Hz sim) + render interpolation
  physics/world.ts     Deterministic 2D physics, collision events, ball predictor
  game/match.ts        Match state machine, scoring, serve flow, stats
  game/training.ts     Training Lab exercises
  ai/ai.ts             AI controller (virtual player)
  input/input.ts       Keyboard/gamepad input, remapping, focus safety
  audio/audio.ts       Procedural Web Audio synthesis (no samples)
  render/renderer.ts   Three.js scene, court, quality presets, debug overlay
  render/bouncer.ts    Procedural character animation (squash/stretch/eyes)
  render/ballvis.ts    Ball, trail, blob shadow, accessibility outline
  render/effects.ts    Pooled rings/sparks/landing marker (zero alloc in loop)
  render/arenas.ts     Sunset Deck, Neon Rooftop, Garden Dome
  ui/ui.ts             DOM menus, HUD, results, settings
  settings.ts          localStorage persistence + cosmetic unlocks
  debug.ts             Developer panel (fps, vectors, AI intent, slow-mo)
```

Gameplay physics run on a fixed 2D plane; presentation is stylized 3D at
`z = 0` with a stable, centered camera (2.5D). The simulation is fixed-step
(1/120 s) and identical at any refresh rate; rendering interpolates between
the last two physics states.

## Physics tuning

Every constant lives in `src/config.ts` with doc comments — court and net
dimensions, movement acceleration/friction/air control, jump impulse and
buffer/coyote windows, ball gravity/restitution/max speed, and the character
hit model. The hit model in `world.ts#collidePlayer`:

```
out = playerVel · momentumTransfer
    + tangentialRelVel · tangentKeep
    + normal · (reflectedApproach · restitution + baseImpulse)
```

with a minimum outgoing normal speed (no sticking), a re-hit lockout until
the ball separates (no impulse pumping), a global speed clamp (no runaway
energy), and positional separation each step (no embedding). At 120 Hz the
fastest legal ball travels ~0.22 units/step — half a ball radius — so
tunneling through the floor, net, walls, or bodies is ruled out by
construction. The net top is a capsule cap, so balls roll off the tape
instead of jittering against a corner.

## The AI

The AI is a *virtual player*: it emits the same `{left, right, jump}` input a
human does, controls a body with identical stats, never reads your input, and
never touches physics. Per tick it:

1. **Perceives** — detects trajectory discontinuities (hits/bounces) and
   reacts only after a difficulty-scaled delay; its landing estimate carries
   a controlled per-volley Gaussian error.
2. **Predicts** — simulates the ball forward (`simulateBall`, the same rules
   as the real ball) for landing point and interception windows.
3. **Decides** — picks an intention: hold center, move under, defend, safe
   return, grounded attack, aerial attack, or serve. Attacks are only
   committed when the interception is reachable in time (whiffed jumps lose
   points). Rival additionally tracks where you tend to stand and aims for
   open space.
4. **Acts** — steers toward a contact offset (which shapes the shot angle)
   and times jumps by solving the jump-rise equation for the contact height.

Difficulty knobs (`AI_LEVELS` in config): reaction delay, prediction error,
decision cadence, aggression, placement skill, jumpiness, foresight,
targeting. Survival rounds tighten these asymptotically — never the physics.

## Global leaderboard (optional)

Survival runs (rounds cleared) can be submitted to a shared online
leaderboard — players enter a name (stored locally, one entry per name,
best run counts) and everyone sees the top 20 under **Leaderboard** in the
main menu.

It's powered by a single serverless function (`api/leaderboard.js`) and a
Redis store, and it is entirely optional — without it the game works
normally and the leaderboard screen just shows "unreachable".

To enable it on Vercel:

1. Deploy the repo to Vercel (framework preset: Vite — auto-detected).
2. In the Vercel project, open **Storage → Create Database → Upstash for
   Redis** (free tier is plenty) and connect it to the project. This
   injects the `KV_REST_API_URL` / `KV_REST_API_TOKEN` env vars the
   function reads (Upstash's `UPSTASH_REDIS_REST_*` names work too).
3. Redeploy. Done — `/api/leaderboard` now serves GET (top 20) and POST
   (submit `{name, score}`, validated and capped server-side).

## Accessibility

Remappable controls, reduced motion, ball outline, high-contrast court,
pattern-based side identification (stripes vs dots — never color alone),
P1/P2 badges over characters, screen-readable menu labels, visible keyboard
focus, per-channel volume + mute, background-animation and camera-impulse
toggles, pause at any time.

## Performance

Fixed 60 fps target: clamped device pixel ratio, pooled particles (no
allocations in the update loop), instanced background meshes, ≤2 lights, one
shadow map (off on Low), Low/Medium/High presets that never change physics,
court dimensions, or ball visibility. Arenas are built once per selection and
disposed on swap.

## Known limitations

- Gamepad mapping uses the standard layout; exotic controllers may need the
  keyboard.
- The interface is designed for desktop; there are no touch controls.
- Audio is fully procedural — if the browser blocks `AudioContext` before the
  first interaction, sound starts after your first click/keypress (the game
  is fully playable without sound).

# Fruit Blaster

A retro Breakout / Arkanoid-style browser game built around Pomptonian's produce
illustration system.

## Play locally

```bash
npm install
npm run dev
```

Controls:

- Mouse / trackpad: move the paddle
- Left / right arrows or A / D: move the paddle
- Space or click: launch the ball (a dotted guide shows the serve angle)
- P or Esc: pause
- M: mute
- R or Space: restart after game over

## V1 power-ups

Each power-up shows a HUD chip with a countdown bar (or remaining charges) while
it is active.

- Pepper — HOT BALL: next 3 brick hits explode into neighboring bricks
- Cherry — DOUBLE TROUBLE: splits each active ball into two
- Pea Pod — PEA SHOOTER: splits each active ball into three
- Carrot — TURBO PADDLE: faster paddle for 12 seconds
- Broccoli — BIG BAR: wider paddle for 12 seconds

## Scoring

Breaking bricks without touching the paddle builds a combo; every four breaks
adds a multiplier, up to ×5. The multiplier resets when the ball returns to the
paddle, so clearing a lot in one trip is worth more than a safe rally. The best
score is kept in `localStorage`.

## Levels

Six layout patterns (Frozen Wall, Honeycomb, Glacier, Colonnade, Diamond, Drift)
cycle as you climb. Rows and two-hit blocks are added with the level, and the
ball speeds up both per level and as the field empties.

## Dino habitat

Below the playfield is a habitat strip. Clearing a level has a 30% chance of
turning up a dinosaur egg, which incubates over 2–4 more cleared levels before
hatching into Stretch (sauropod), Spike (stego) or Chomp (rex). Hatched dinos
wander, idle and nap on their own, and the collection survives page refreshes
via `sessionStorage`. The habitat never touches the ball, the paddle or the
score — it is there to give you another reason to keep going.

## Assets

Produce artwork is copied into this repo as standalone SVG assets so the game
has no runtime dependency on the Pomptonian brand-system project. The dino and
egg vectors in `public/assets/pets/` are taken from the Dino Characters brand
sheet. Everything else — ice blocks, paddle, ball, particles — is generated into
the texture cache at boot, and all sound is synthesised at runtime, so there are
no other binary assets to keep in sync.

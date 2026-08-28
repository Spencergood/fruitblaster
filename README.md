# Fruit Blaster

A retro Breakout / Arkanoid-style browser game built around Pomptonian's produce illustration system.

## Play locally

```bash
npm install
npm run dev
```

Controls:

- Mouse / trackpad: move the paddle
- Left / right arrows or A / D: move the paddle
- Space: launch the ball
- R: restart after game over

## V1 power-ups

- Pepper — HOT BALL: next 3 brick hits explode into neighboring bricks
- Cherry — DOUBLE TROUBLE: splits each active ball into two
- Pea Pod — PEA SHOOTER: splits each active ball into three
- Carrot — TURBO PADDLE: faster paddle for 12 seconds
- Broccoli — BIG BAR: wider paddle for 12 seconds

Produce artwork is copied into this repo as standalone SVG assets so the game has no runtime dependency on the Pomptonian brand-system project.

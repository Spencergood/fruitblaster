import Phaser from "phaser";
import { BASE_PADDLE_WIDTH, COLORS, PADDLE_HEIGHT, WIDE_PADDLE_WIDTH } from "./theme";

export const BRICK_W = 72;
export const BRICK_H = 33;

type IceOptions = { cracked?: boolean; solid?: boolean };

/**
 * All runtime art is generated once into the texture cache. Regenerating on a
 * scene restart would just churn GPU uploads, so callers guard with a key test.
 */
export function createTextures(scene: Phaser.Scene) {
  if (scene.textures.exists("brick")) return;

  const g = scene.make.graphics({ x: 0, y: 0 });

  drawIceBlock(g, "brick", {});
  drawIceBlock(g, "brick-cracked", { cracked: true });
  drawIceBlock(g, "brick-solid", { solid: true });

  drawPaddle(g, "paddle", BASE_PADDLE_WIDTH);
  drawPaddle(g, "paddle-wide", WIDE_PADDLE_WIDTH);

  // Ball.
  g.clear();
  g.fillStyle(0xffffff, 1);
  g.fillCircle(9, 9, 8);
  g.lineStyle(2, 0xa8e7ff, 0.96);
  g.strokeCircle(9, 9, 7);
  g.fillStyle(0xe4faff, 0.94);
  g.fillCircle(6, 5, 2.3);
  g.generateTexture("ball", 18, 18);

  // Ice sliver used by the shatter emitter.
  g.clear();
  g.fillStyle(0xffffff, 1);
  g.fillTriangle(0, 2, 11, 0, 5, 8);
  g.generateTexture("shard", 12, 9);

  // Generic spark / dust mote.
  g.clear();
  g.fillStyle(0xffffff, 1);
  g.fillCircle(3, 3, 3);
  g.generateTexture("spark", 6, 6);

  g.destroy();
}

function drawIceBlock(g: Phaser.GameObjects.Graphics, key: string, options: IceOptions) {
  const { cracked = false, solid = false } = options;
  g.clear();

  // Deep rear volume. This is where the depth lives, instead of a dark box
  // around the fruit artwork.
  g.fillStyle(0x020914, 0.5);
  g.fillRoundedRect(4, 7, 67, 25, 6);
  g.fillStyle(0x0d3554, 0.6);
  g.fillRoundedRect(2, 4, 68, 26, 6);

  // Main translucent ice body. Two-hit blocks read as denser, colder ice.
  g.fillStyle(solid ? 0x3f9fd0 : 0x67c9f2, solid ? 0.82 : 0.7);
  g.fillRoundedRect(0, 0, 70, 28, 6);
  g.fillStyle(0xcff3ff, solid ? 0.16 : 0.22);
  g.fillRoundedRect(4, 4, 62, 20, 4);

  // Frosty volume and cloudy inclusions.
  g.fillStyle(0xffffff, solid ? 0.12 : 0.08);
  g.fillEllipse(20, 15, 21, 10);
  g.fillEllipse(50, 13, 18, 8);
  g.fillStyle(0xbcecff, 0.1);
  g.fillEllipse(35, 20, 28, 6);

  // Trapped bubbles.
  g.fillStyle(0xffffff, 0.2);
  g.fillCircle(14, 10, 1.2);
  g.fillCircle(22, 19, 0.9);
  g.fillCircle(42, 8, 1.1);
  g.fillCircle(54, 17, 1.3);
  g.fillCircle(61, 11, 0.8);

  // Faceted bevels make the block read as a chunk of ice.
  g.fillStyle(0xffffff, 0.42);
  g.fillTriangle(4, 4, 66, 4, 60, 9);
  g.fillTriangle(4, 4, 10, 9, 10, 23);

  g.fillStyle(0x123f63, 0.42);
  g.fillTriangle(10, 23, 60, 23, 66, 28);
  g.fillTriangle(60, 9, 66, 4, 66, 28);

  // Internal refraction streaks.
  g.lineStyle(2, 0xffffff, 0.68);
  g.lineBetween(9, 5, 30, 5);
  g.lineStyle(1, 0xffffff, 0.4);
  g.lineBetween(14, 20, 29, 9);
  g.lineBetween(39, 21, 51, 8);
  g.lineBetween(47, 8, 62, 12);

  // Crisp glass shell.
  g.lineStyle(1, 0xffffff, 0.98);
  g.strokeRoundedRect(0.5, 0.5, 69, 27, 6);
  g.lineStyle(1, 0xdaf8ff, 0.66);
  g.strokeRoundedRect(4.5, 4.5, 61, 19, 4);

  if (solid) {
    // Extra frost ribs so a two-hit block is legible at a glance.
    g.lineStyle(1, 0xffffff, 0.34);
    g.lineBetween(24, 5, 18, 23);
    g.lineBetween(46, 5, 52, 23);
  }

  if (cracked) {
    g.lineStyle(1.5, 0xffffff, 0.96);
    g.beginPath();
    g.moveTo(35, 2);
    g.lineTo(32, 9);
    g.lineTo(38, 14);
    g.lineTo(33, 22);
    g.lineTo(35, 29);
    g.moveTo(32, 9);
    g.lineTo(24, 13);
    g.lineTo(18, 22);
    g.moveTo(38, 14);
    g.lineTo(48, 10);
    g.lineTo(58, 15);
    g.strokePath();
  }

  g.generateTexture(key, BRICK_W, BRICK_H);
}

/**
 * The paddle is drawn per width rather than stretched, so the wide-bar
 * power-up keeps crisp corners and a centred highlight.
 */
function drawPaddle(g: Phaser.GameObjects.Graphics, key: string, width: number) {
  g.clear();
  g.fillStyle(0x020914, 0.64);
  g.fillRoundedRect(2, 5, width - 2, 19, 9);
  g.fillStyle(0x7dcff3, 0.97);
  g.fillRoundedRect(0, 0, width, 20, 9);
  g.fillStyle(0xeaf9ff, 0.44);
  g.fillRoundedRect(5, 3, width - 10, 11, 6);
  g.fillStyle(COLORS.blue, 0.94);
  g.fillRoundedRect(18, 8, width - 36, 7, 4);
  g.lineStyle(2, 0xffffff, 0.98);
  g.lineBetween(9, 3, width * 0.42, 3);
  g.lineStyle(1, 0xffffff, 0.8);
  g.strokeRoundedRect(0.5, 0.5, width - 1, 19, 9);
  g.generateTexture(key, width, PADDLE_HEIGHT);
}

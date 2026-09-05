export const WIDTH = 960;

/** Bottom of the playable field. Everything below it is the pet habitat. */
export const FIELD_BOTTOM = 640;
export const HABITAT_H = 68;
export const HEIGHT = FIELD_BOTTOM + HABITAT_H;
export const HABITAT_GROUND = HEIGHT - 8;
export const PADDLE_Y = FIELD_BOTTOM - 54;
export const BALL_RADIUS = 9;
export const BASE_PADDLE_WIDTH = 132;
export const WIDE_PADDLE_WIDTH = 202;
export const PADDLE_HEIGHT = 24;
export const FRUIT_SOURCE_SIZE = 256;

export const COLORS = {
  ink: 0x081735,
  blue: 0x143d88,
  cream: 0xf7f2e7,
  yellow: 0xf2c94c,
  red: 0xe4573d,
  green: 0x3f6949,
  ice: 0x7dcff3,
  iceLight: 0xd6f4ff,
};

export type PowerKind = "pepper" | "cherry" | "pea" | "carrot" | "broccoli";

export type PowerInfo = {
  /** Shout line used for the pickup callout. */
  label: string;
  /** Short HUD chip label. */
  chip: string;
  /** Brand accent pulled from the produce artwork itself. */
  accent: number;
};

export const POWERS: Record<PowerKind, PowerInfo> = {
  pepper: { label: "HOT BALL!", chip: "HOT BALL", accent: 0xe4573d },
  cherry: { label: "DOUBLE TROUBLE!", chip: "DOUBLE", accent: 0xbe4833 },
  pea: { label: "PEA SHOOTER ×3!", chip: "PEA ×3", accent: 0xf2c94c },
  carrot: { label: "TURBO PADDLE!", chip: "TURBO", accent: 0xef7a45 },
  broccoli: { label: "BIG BAR!", chip: "BIG BAR", accent: 0x6fa37d },
};

export const POWER_KINDS = Object.keys(POWERS) as PowerKind[];

export const FONT = "Arial Black, Arial Bold, Arial, sans-serif";

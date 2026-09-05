import { POWER_KINDS, PowerKind } from "./theme";

export const COLS = 11;

export type LevelCell = {
  row: number;
  col: number;
  hp: number;
  power?: PowerKind;
};

export type LevelPlan = {
  rows: number;
  cells: LevelCell[];
  /** Shown under the level banner so each layout has a bit of identity. */
  name: string;
};

type Pattern = {
  name: string;
  fill: (row: number, col: number, rows: number) => boolean;
};

const CENTER = (COLS - 1) / 2;

/**
 * Layouts cycle so consecutive levels never look identical. Every pattern is
 * symmetrical about the centre column, which keeps them readable and keeps the
 * ball from getting stranded in a one-sided pocket.
 */
const PATTERNS: Pattern[] = [
  { name: "FROZEN WALL", fill: () => true },
  { name: "HONEYCOMB", fill: (row, col) => !(row % 2 === 1 && col % 2 === 1) },
  { name: "GLACIER", fill: (row, col) => Math.abs(col - CENTER) <= Math.min(CENTER, 1 + row * 1.5) },
  { name: "COLONNADE", fill: (row, col) => row === 0 || row % 3 === 0 || col % 3 !== 1 },
  { name: "DIAMOND", fill: (row, col, rows) => Math.abs(col - CENTER) + Math.abs(row - (rows - 1) / 2) * 1.6 <= CENTER + 0.5 },
  { name: "DRIFT", fill: (row, col) => (col + row * 2) % 5 !== 3 },
];

// Multiball is the strongest effect in the game, so it stays the rarest.
const POWER_WEIGHTS: Record<PowerKind, number> = {
  pepper: 3,
  cherry: 2,
  pea: 1,
  carrot: 3,
  broccoli: 3,
};

export function buildLevel(level: number): LevelPlan {
  const pattern = PATTERNS[(level - 1) % PATTERNS.length];
  const rows = Math.min(5 + Math.floor(level / 3), 7);

  const cells: LevelCell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < COLS; col++) {
      if (!pattern.fill(row, col, rows)) continue;
      cells.push({ row, col, hp: hpFor(level, row) });
    }
  }

  assignPowers(cells, level);
  return { rows, cells, name: pattern.name };
}

function hpFor(level: number, row: number) {
  if (level < 3) return 1;
  const toughRows = Math.min(3, Math.floor(level / 3));
  return row < toughRows ? 2 : 1;
}

/**
 * Power-ups are spread across distinct columns so a single lucky corner run
 * cannot hoover up every pickup in the level.
 */
function assignPowers(cells: LevelCell[], level: number) {
  if (cells.length === 0) return;

  const count = Math.min(cells.length, 4 + Math.floor(level / 3));
  const pool = shuffle(cells.slice());
  const usedColumns = new Set<number>();
  const chosen: LevelCell[] = [];

  for (const cell of pool) {
    if (chosen.length >= count) break;
    if (usedColumns.has(cell.col)) continue;
    usedColumns.add(cell.col);
    chosen.push(cell);
  }
  // Small layouts may not have enough distinct columns; top up from anywhere.
  for (const cell of pool) {
    if (chosen.length >= count) break;
    if (!chosen.includes(cell)) chosen.push(cell);
  }

  chosen.forEach((cell) => {
    cell.power = pickPower();
  });
}

function pickPower(): PowerKind {
  const total = POWER_KINDS.reduce((sum, kind) => sum + POWER_WEIGHTS[kind], 0);
  let roll = Math.random() * total;
  for (const kind of POWER_KINDS) {
    roll -= POWER_WEIGHTS[kind];
    if (roll <= 0) return kind;
  }
  return "carrot";
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

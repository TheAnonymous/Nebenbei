/** The effect controls: each 0..10, except the filter, which runs from -5 (dull) over 0 (off) to 5 (thin). */
export interface Effects {
  /** How much of chords, melody and clap goes into the room. */
  hall: number;
  /** The melody's echo: how loud, and how often it repeats. */
  echo: number;
  /** The tape: wobble, hiss and crackle, saturation. */
  tape: number;
  /** How deep everything ducks under the kick. */
  pump: number;
  filter: number;
}

export const EFFECT_RANGES: Record<keyof Effects, readonly [number, number]> = { hall: [0, 10], echo: [0, 10], tape: [0, 10], pump: [0, 10], filter: [-5, 5] };
export const DEFAULT_EFFECTS: Effects = { hall: 4, echo: 4, tape: 5, pump: 6, filter: 0 };

/** Effects read from storage: every value that is not a whole number in its range falls back to the default. */
export function readEffects(value: unknown): Effects {
  const stored = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const effects = { ...DEFAULT_EFFECTS };
  for (const name of Object.keys(effects) as (keyof Effects)[]) {
    const [low, high] = EFFECT_RANGES[name];
    const setting = stored[name];
    if (Number.isInteger(setting) && (setting as number) >= low && (setting as number) <= high) effects[name] = setting as number;
  }
  return effects;
}

/*
 * The DJ: when it is on, it plays the effects around your settings, one move
 * per pass through the four bars. A move is a curve over the pass; it starts
 * where you left the sliders, and the next pass starts there again.
 */

export const MOVES = ["ruhe", "filterfahrt", "anlauf", "echowurf", "hallwelle", "leiern", "pumpen"] as const;
export type Move = (typeof MOVES)[number];

export const MOVE_NAMES: Record<Move, string> = {
  ruhe: "lässt laufen",
  filterfahrt: "Filterfahrt",
  anlauf: "Anlauf",
  echowurf: "Echo-Wurf",
  hallwelle: "Hallwelle",
  leiern: "Bandleiern",
  pumpen: "Pumpen",
};

const towards = (from: number, to: number, amount: number): number => from + (to - from) * amount;

/** The effects a move makes of your settings, `progress` (0..1) through the pass. */
export function djEffects(base: Effects, move: Move, progress: number): Effects {
  // Up and down again within the pass, gently at both ends.
  const swell = Math.sin(Math.PI * progress) ** 2;
  // Only over the last half: slow, then faster, and gone at the next pass.
  const build = Math.max(0, (progress - 0.5) / 0.5) ** 2;
  switch (move) {
    case "filterfahrt":
      return { ...base, filter: Math.min(base.filter, towards(base.filter, -4, swell)) };
    case "anlauf":
      return { ...base, filter: Math.max(base.filter, towards(base.filter, 4, build)), hall: Math.max(base.hall, towards(base.hall, 8, build)) };
    case "echowurf":
      // The last two beats into the echo; its tail rings on into the next pass.
      return { ...base, echo: Math.max(base.echo, towards(base.echo, 10, Math.min(1, Math.max(0, (progress - 0.86) / 0.04)))) };
    case "hallwelle":
      return { ...base, hall: Math.max(base.hall, towards(base.hall, 10, swell)) };
    case "leiern":
      return { ...base, tape: Math.max(base.tape, towards(base.tape, 10, swell)) };
    case "pumpen":
      return { ...base, pump: Math.max(base.pump, towards(base.pump, 9, swell)) };
    default:
      return base;
  }
}

/**
 * The move for the next pass. A calm groove is mostly left alone; the more
 * energy, the more the DJ does, and the more it builds up and pumps. A move
 * never comes twice in a row.
 */
export function pickMove(previous: Move, energy: number, rng: () => number): Move {
  const weights: Record<Move, number> = {
    ruhe: 1 + 3 * (1 - energy),
    filterfahrt: 1.2,
    anlauf: 0.4 + 1.6 * energy,
    echowurf: 1,
    hallwelle: 1,
    leiern: 0.6,
    pumpen: 0.2 + 1.4 * energy,
  };
  if (previous !== "ruhe") weights[previous] = 0;
  const total = MOVES.reduce((sum, move) => sum + weights[move], 0);
  let left = rng() * total;
  for (const move of MOVES) {
    left -= weights[move];
    if (left < 0) return move;
  }
  return "ruhe";
}

/*
 * The mixer: a level per track, 0..100. 80 is the track as the instrument
 * was measured; above it the track gets louder, up to about +4 dB. The
 * square makes the slider feel even: halfway down is clearly quieter.
 */

export type Levels = Record<"drums" | "bass" | "chords" | "melody", number>;

export const DEFAULT_LEVELS: Levels = { drums: 80, bass: 80, chords: 80, melody: 80 };

export const levelGain = (level: number): number => (level / 80) ** 2;

/** Track levels read from storage: anything that is not a whole number from 0 to 100 falls back to 80. */
export function readLevels(value: unknown): Levels {
  const stored = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const levels = { ...DEFAULT_LEVELS };
  for (const track of Object.keys(levels) as (keyof Levels)[]) {
    const level = stored[track];
    if (Number.isInteger(level) && (level as number) >= 0 && (level as number) <= 100) levels[track] = level as number;
  }
  return levels;
}

/*
 * The last stage before the speakers. Below 0.8 it passes the signal
 * untouched; above, it bends it smoothly towards 0.98 and never past it,
 * however loud the mix gets: nothing can clip. It works on half the signal,
 * so it covers inputs up to twice full scale.
 */

export const CEILING = 0.98;
const KNEE = 0.8;

export function softLimit(input: number): number {
  const size = Math.abs(input);
  if (size <= KNEE) return input;
  return Math.sign(input) * (KNEE + (CEILING - KNEE) * Math.tanh((size - KNEE) / (CEILING - KNEE)));
}

/** softLimit as a WaveShaper curve for an input that was halved before it (the curve spans -1..1, the signal -2..2). */
export const limitCurve = (): Float32Array<ArrayBuffer> => Float32Array.from({ length: 4097 }, (_, index) => softLimit(2 * (index / 2048 - 1)));

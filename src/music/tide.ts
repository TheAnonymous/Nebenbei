/*
 * The tides: when they are on, the music takes a long arc by itself, like a
 * set over the working hour. The energy rises, stays up for a while, falls
 * into a valley and rises again, around the energy you set; it starts right
 * where you are, halfway up a rise. Now and then the kick and clap pause for eight bars and come back
 * with a fill; small fills mark the end of other passes; every half hour or
 * so the key moves on. Everything is counted in bars, so it follows any
 * tempo; the engine advances it on every bar line.
 */

export type Rng = () => number;

export const PHASES = ["aufbau", "plateau", "abbau", "tal"] as const;
export type Phase = (typeof PHASES)[number];

export const PHASE_NAMES: Record<Phase, string> = {
  aufbau: "Aufbau",
  plateau: "Plateau",
  abbau: "Abbau",
  tal: "Tal",
};

/** Energy steps (of ten) above or below yours: the valley and the plateau. */
const LOW = -3;
const HIGH = 2;
/** How long each phase lasts, in bars (about 28 bars a minute). */
const LENGTHS: Record<Phase, readonly [number, number]> = { aufbau: [170, 280], plateau: [220, 390], abbau: [110, 200], tal: [110, 220] };
export const BREAKDOWN_BARS = 8;
/** The fewest bars between two breakdowns (about five minutes). */
export const BREAKDOWN_GAP = 140;
const BREAKDOWN_CHANCE = 0.12;
const FILL_CHANCE = 0.3;
/** Bars between key changes: about 25 to 35 minutes. */
const KEY_AFTER: readonly [number, number] = [700, 980];
/** Where the key may go, in semitones up: a fourth, a fifth, a whole step up or down, a minor third up or down. */
const KEY_STEPS = [5, 7, 2, 10, 3, 9] as const;

export interface Tide {
  phase: Phase;
  /** Bars into the phase, and how many it lasts. */
  bar: number;
  length: number;
  /** Bars of breakdown still to come (0: none), and bars since the last one ended. */
  breakdown: number;
  sinceBreakdown: number;
  sinceKey: number;
  keyAfter: number;
}

/** What the tides do on a bar. `fill` is set on the last bar of a pass that ends with a fill; `modulate` on the first bar of a pass that changes key. */
export interface TideBar {
  tide: Tide;
  fill: boolean;
  modulate: number | null;
}

const between = (rng: Rng, [low, high]: readonly [number, number]): number => Math.round(low + rng() * (high - low));

/** A fresh tide begins at your energy, where a rise passes it, so switching it on changes nothing at first. */
export function startTide(rng: Rng): Tide {
  const length = between(rng, LENGTHS.aufbau);
  // The point of the rise where its eased offset is zero.
  const bar = Math.round((length * Math.acos(1 - (2 * -LOW) / (HIGH - LOW))) / Math.PI);
  return { phase: "aufbau", bar, length, breakdown: 0, sinceBreakdown: BREAKDOWN_GAP, sinceKey: 0, keyAfter: between(rng, KEY_AFTER) };
}

/** Energy steps above or below yours, at this point of the arc: gently in and out of every phase. */
export function tideOffset(tide: Tide): number {
  const ease = (amount: number): number => (1 - Math.cos(Math.PI * Math.min(1, amount))) / 2;
  const progress = ease(tide.bar / tide.length);
  switch (tide.phase) {
    case "aufbau":
      return LOW + (HIGH - LOW) * progress;
    case "plateau":
      return HIGH;
    case "abbau":
      return HIGH + (LOW - HIGH) * progress;
    default:
      return LOW;
  }
}

/** Moves the tide on by one bar; `barInPass` (0..3) says where the bar lies in the four-bar pass. */
export function nextBar(previous: Tide, barInPass: number, rng: Rng): TideBar {
  const tide = { ...previous, bar: previous.bar + 1, sinceKey: previous.sinceKey + 1 };
  if (tide.bar >= tide.length) {
    tide.phase = PHASES[(PHASES.indexOf(tide.phase) + 1) % PHASES.length]!;
    tide.bar = 0;
    tide.length = between(rng, LENGTHS[tide.phase]);
  }
  if (tide.breakdown > 0) {
    tide.breakdown -= 1;
    if (tide.breakdown === 0) tide.sinceBreakdown = 0;
  } else {
    tide.sinceBreakdown += 1;
  }

  let modulate: number | null = null;
  if (barInPass === 0) {
    // Breakdowns belong to the high part of the arc, where a pause is felt.
    if (tide.breakdown === 0 && tide.phase === "plateau" && tide.sinceBreakdown >= BREAKDOWN_GAP && rng() < BREAKDOWN_CHANCE) tide.breakdown = BREAKDOWN_BARS;
    if (tide.sinceKey >= tide.keyAfter) {
      modulate = KEY_STEPS[Math.floor(rng() * KEY_STEPS.length)]!;
      tide.sinceKey = 0;
      tide.keyAfter = between(rng, KEY_AFTER);
    }
  }
  // The last bar of a breakdown always fills back into the groove.
  const fill = barInPass === 3 && (tide.breakdown === 1 || (tide.breakdown === 0 && rng() < FILL_CHANCE));
  return { tide, fill, modulate };
}

import { expect, it } from "vitest";
import type { Effects, Move } from "../src/audio/effects";
import { CEILING, DEFAULT_EFFECTS, djEffects, EFFECT_RANGES, levelGain, limitCurve, MOVES, pickMove, softLimit } from "../src/audio/effects";

/** mulberry32: the same seed gives the same moves. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const quiet: Effects = { hall: 0, echo: 0, tape: 0, pump: 0, filter: 0, chorus: 0, crush: 0, vinyl: 0 };
const loud: Effects = { hall: 10, echo: 10, tape: 10, pump: 10, filter: 5, chorus: 10, crush: 10, vinyl: 10 };

it("plays each move around your settings and starts every pass from them", () => {
  for (const base of [quiet, DEFAULT_EFFECTS, loud, { ...quiet, filter: -5 }]) {
    for (const move of MOVES) {
      expect(djEffects(base, move, 0)).toEqual(base);
      for (let progress = 0; progress < 1; progress += 0.01) {
        const effects = djEffects(base, move, progress);
        for (const name of Object.keys(EFFECT_RANGES) as (keyof Effects)[]) {
          const [low, high] = EFFECT_RANGES[name];
          expect(effects[name]).toBeGreaterThanOrEqual(low);
          expect(effects[name]).toBeLessThanOrEqual(high);
        }
      }
    }
  }
  // Each move does what its name says.
  expect(djEffects(DEFAULT_EFFECTS, "filterfahrt", 0.5).filter).toBeCloseTo(-4);
  expect(djEffects(DEFAULT_EFFECTS, "anlauf", 0.99).filter).toBeGreaterThan(3.8);
  expect(djEffects(DEFAULT_EFFECTS, "anlauf", 0.4)).toEqual(DEFAULT_EFFECTS);
  expect(djEffects(DEFAULT_EFFECTS, "echowurf", 0.95).echo).toBe(10);
  expect(djEffects(DEFAULT_EFFECTS, "echowurf", 0.8)).toEqual(DEFAULT_EFFECTS);
  expect(djEffects(DEFAULT_EFFECTS, "hallwelle", 0.5).hall).toBeCloseTo(10);
  expect(djEffects(DEFAULT_EFFECTS, "leiern", 0.5).tape).toBeCloseTo(10);
  expect(djEffects(DEFAULT_EFFECTS, "pumpen", 0.5).pump).toBeCloseTo(9);
  expect(djEffects(DEFAULT_EFFECTS, "kruemel", 0.99).crush).toBeGreaterThan(6.5);
  expect(djEffects(DEFAULT_EFFECTS, "kruemel", 0.4)).toEqual(DEFAULT_EFFECTS);
  expect(djEffects(DEFAULT_EFFECTS, "schwebe", 0.5).chorus).toBeCloseTo(10);
  for (let progress = 0; progress < 1; progress += 0.1) expect(djEffects(DEFAULT_EFFECTS, "ruhe", progress)).toEqual(DEFAULT_EFFECTS);
});

it("leaves a calm groove alone more often and never repeats a move", () => {
  const share = (energy: number, wanted: Move): number => {
    const rng = seeded(5);
    let move: Move = "ruhe";
    let count = 0;
    for (let pass = 0; pass < 3000; pass += 1) {
      const next = pickMove(move, energy, rng);
      if (next !== "ruhe") expect(next).not.toBe(move);
      if (next === wanted) count += 1;
      move = next;
    }
    return count / 3000;
  };
  expect(share(0, "ruhe")).toBeGreaterThan(0.4);
  expect(share(1, "ruhe")).toBeLessThan(0.2);
  expect(share(1, "anlauf")).toBeGreaterThan(share(0, "anlauf"));
  expect(share(1, "pumpen")).toBeGreaterThan(share(0, "pumpen"));
  for (const move of MOVES) expect(share(0.5, move)).toBeGreaterThan(0);
});

it("never lets the end of the chain past the ceiling", () => {
  // Quiet and normal signals pass untouched.
  for (const input of [0, 0.1, -0.5, 0.8, -0.8]) expect(softLimit(input)).toBe(input);
  // Above the knee it bends smoothly, keeps rising and never passes the ceiling, up to far past full scale.
  let before = softLimit(0.8);
  for (let input = 0.801; input <= 20; input += 0.001) {
    const output = softLimit(input);
    expect(output).toBeGreaterThanOrEqual(before);
    expect(output).toBeLessThanOrEqual(CEILING);
    expect(softLimit(-input)).toBe(-output);
    before = output;
  }
  // The WaveShaper curve: halved input from -1 to 1, the whole curve inside the ceiling, the middle untouched.
  const curve = limitCurve();
  expect(curve.length % 2).toBe(1);
  expect(Math.max(...curve.map(Math.abs))).toBeLessThanOrEqual(CEILING);
  expect(curve[(curve.length - 1) / 2]).toBe(0);
  expect(curve[Math.round(((0.5 / 2 + 1) * (curve.length - 1)) / 2)]).toBeCloseTo(0.5, 6);
});

it("sets the track levels with 80 as the measured level", () => {
  expect(levelGain(80)).toBe(1);
  expect(levelGain(0)).toBe(0);
  expect(levelGain(40)).toBe(0.25);
  expect(20 * Math.log10(levelGain(100))).toBeCloseTo(3.9, 1);
});

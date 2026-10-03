import { expect, it } from "vitest";
import type { Effects, Move } from "../src/audio/effects";
import { DEFAULT_EFFECTS, djEffects, EFFECT_RANGES, MOVES, pickMove } from "../src/audio/effects";

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

const quiet: Effects = { hall: 0, echo: 0, tape: 0, pump: 0, filter: 0 };
const loud: Effects = { hall: 10, echo: 10, tape: 10, pump: 10, filter: 5 };

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

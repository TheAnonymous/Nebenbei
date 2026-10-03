import { expect, it } from "vitest";
import type { Phase, Tide } from "../src/music/tide";
import { BREAKDOWN_BARS, BREAKDOWN_GAP, nextBar, PHASES, startTide, tideOffset } from "../src/music/tide";

/** mulberry32: the same seed gives the same arc. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

it("takes a long arc from a calm start, with pauses, fills and key changes now and then", () => {
  const rng = seeded(11);
  let tide: Tide = startTide(rng);
  // It starts at your energy, on the way up.
  expect(tide.phase).toBe("aufbau");
  expect(Math.abs(tideOffset(tide))).toBeLessThan(0.05);
  expect(tideOffset(nextBar(tide, 1, rng).tide)).toBeGreaterThan(tideOffset(tide));

  // About eight hours of bars.
  const bars = 8 * 60 * 28;
  const phases: Phase[] = [tide.phase];
  const breakdowns: number[] = [];
  const keyChanges: number[] = [];
  let fills = 0;
  let previousOffset = tideOffset(tide);
  for (let bar = 1; bar <= bars; bar += 1) {
    const barInPass = bar % 4;
    const before = tide.breakdown;
    const result = nextBar(tide, barInPass, rng);
    tide = result.tide;
    if (tide.phase !== phases.at(-1)) phases.push(tide.phase);
    if (before === 0 && tide.breakdown === BREAKDOWN_BARS) {
      // A breakdown starts on a pass's first bar, high up in the arc.
      expect(barInPass).toBe(0);
      expect(tide.phase).toBe("plateau");
      breakdowns.push(bar);
    }
    if (result.fill) {
      expect(barInPass).toBe(3);
      fills += 1;
    }
    // The last bar of every breakdown fills back into the groove.
    if (tide.breakdown === 1) expect(result.fill).toBe(true);
    if (result.modulate !== null) {
      expect(barInPass).toBe(0);
      expect([2, 3, 5, 7, 9, 10]).toContain(result.modulate);
      keyChanges.push(bar);
    }
    // The energy moves gently, at most a twelfth of a slider step from one bar to the next, and only within its range.
    const offset = tideOffset(tide);
    expect(offset).toBeGreaterThanOrEqual(-3);
    expect(offset).toBeLessThanOrEqual(2);
    expect(Math.abs(offset - previousOffset)).toBeLessThan(0.08);
    previousOffset = offset;
  }

  // The phases come round in order, about once every 22 to 39 minutes.
  for (let at = 1; at < phases.length; at += 1) expect(PHASES.indexOf(phases[at]!)).toBe((PHASES.indexOf(phases[at - 1]!) + 1) % 4);
  const rounds = phases.length / 4;
  expect(rounds).toBeGreaterThan(8 * 60 / 39 - 1);
  expect(rounds).toBeLessThan(8 * 60 / 22 + 1);
  // Breakdowns are rare and far apart; fills are occasional; the key moves about every half hour.
  expect(breakdowns.length).toBeGreaterThan(5);
  for (let at = 1; at < breakdowns.length; at += 1) expect(breakdowns[at]! - breakdowns[at - 1]!).toBeGreaterThanOrEqual(BREAKDOWN_GAP + BREAKDOWN_BARS);
  expect(fills / (bars / 4)).toBeGreaterThan(0.2);
  expect(fills / (bars / 4)).toBeLessThan(0.4);
  expect(keyChanges.length).toBeGreaterThanOrEqual(8 * 60 / 35 - 1);
  for (let at = 1; at < keyChanges.length; at += 1) expect(keyChanges[at]! - keyChanges[at - 1]!).toBeGreaterThanOrEqual(700);
});

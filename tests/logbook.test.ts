import { expect, it } from "vitest";
import { parseLogbook, parseSession } from "../src/logbook";
import { grooveName, isGroove, mutate, rollGroove } from "../src/music/groove";

// Math.random is fine here: every rolled or bred groove has to pass.
function bredGroove() {
  let groove = rollGroove(Math.random);
  for (let n = 0; n < 200; n += 1) groove = mutate(groove, Math.random).groove;
  return groove;
}

it("accepts every groove the app makes and rejects broken ones", () => {
  const groove = bredGroove();
  expect(isGroove(groove)).toBe(true);
  expect(isGroove(JSON.parse(JSON.stringify(groove)))).toBe(true);
  expect(isGroove(null)).toBe(false);
  expect(isGroove({})).toBe(false);
  expect(isGroove({ ...groove, bass: [] })).toBe(false);
  expect(isGroove({ ...groove, chords: { ...groove.chords, bars: groove.chords.bars.slice(1) } })).toBe(false);
  expect(isGroove({ ...groove, chords: { ...groove.chords, key: 12 } })).toBe(false);
  expect(isGroove({ ...groove, drums: [{ step: 0, voice: "cowbell", vel: 1, min: 0 }] })).toBe(false);
  expect(isGroove({ ...groove, drums: [{ step: 0, voice: "kick", vel: 40, min: 0 }] })).toBe(false);
  expect(isGroove({ ...groove, melody: [{ step: 64, len: 1, tone: 0, vel: 0.8, min: 0 }] })).toBe(false);
});

it("names a groove after its key, the same way every time", () => {
  const groove = bredGroove();
  expect(grooveName(groove)).toMatch(/^[a-zäöü]+, (c|cis|d|es|e|f|fis|g|gis|a|b|h)-Moll$/);
  expect(grooveName(JSON.parse(JSON.stringify(groove)))).toBe(grooveName(groove));
});

it("reads the logbook back and drops what is broken", () => {
  const entry = { at: 1, name: "staubig, d-Moll", groove: bredGroove() };
  expect(parseLogbook(null)).toEqual({ kept: [], trail: [] });
  expect(parseLogbook("{")).toEqual({ kept: [], trail: [] });
  expect(parseLogbook('"text"')).toEqual({ kept: [], trail: [] });
  const stored = JSON.stringify({ kept: [entry, { at: 2, name: "kaputt", groove: {} }, null], trail: "nope" });
  expect(parseLogbook(stored)).toEqual({ kept: [entry], trail: [] });
});

it("reads the running groove back, or starts fresh", () => {
  const groove = bredGroove();
  expect(parseSession(null)).toBeNull();
  expect(parseSession(JSON.stringify({ groove: {}, energy: 3 }))).toBeNull();
  expect(parseSession(JSON.stringify({ groove, energy: 3, volume: 55, held: ["bass", "tuba"] }))).toEqual({ groove, energy: 3, volume: 55, held: ["bass"] });
  // Odd settings fall back to the defaults; the groove still counts.
  expect(parseSession(JSON.stringify({ groove, energy: 99, volume: "laut" }))).toEqual({ groove, energy: 5, volume: 80, held: [] });
});

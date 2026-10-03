import { expect, it } from "vitest";
import { parseLogbook, parseSession } from "../src/logbook";
import { DEFAULT_LEVELS, readEffects, readLevels } from "../src/audio/effects";
import { grooveName, mutate, readGroove, rollGroove } from "../src/music/groove";

// Math.random is fine here: every rolled or bred groove has to pass.
function bredGroove() {
  let groove = rollGroove(Math.random);
  for (let n = 0; n < 200; n += 1) groove = mutate(groove, Math.random).groove;
  return groove;
}

it("accepts every groove the app makes and rejects broken ones", () => {
  const groove = bredGroove();
  expect(readGroove(groove)).toEqual(groove);
  expect(readGroove(JSON.parse(JSON.stringify(groove)))).toEqual(groove);
  expect(readGroove(null)).toBeNull();
  expect(readGroove({})).toBeNull();
  expect(readGroove({ ...groove, bass: [] })).toBeNull();
  expect(readGroove({ ...groove, chords: { ...groove.chords, bars: groove.chords.bars.slice(1) } })).toBeNull();
  expect(readGroove({ ...groove, chords: { ...groove.chords, key: 12 } })).toBeNull();
  expect(readGroove({ ...groove, drums: [{ step: 0, voice: "cowbell", vel: 1, min: 0 }] })).toBeNull();
  expect(readGroove({ ...groove, drums: [{ step: 0, voice: "kick", vel: 40, min: 0 }] })).toBeNull();
  expect(readGroove({ ...groove, melody: [{ step: 64, len: 1, tone: 0, vel: 0.8, min: 0 }] })).toBeNull();
});

it("plays grooves from before moods and instruments as they sounded then", () => {
  const groove = bredGroove();
  const { key, bars, stabs } = groove.chords;
  const old = { drums: groove.drums, bass: groove.bass, chords: { key, bars, stabs }, melody: groove.melody };
  const first = { drums: "staubig", bass: "sub", chords: "saege", melody: "glocke" };
  expect(readGroove(old)).toEqual({ ...old, chords: { key, mode: 0, bars, stabs }, sounds: first });
  // Instruments stored by number, from before the library: the second of each track then.
  expect(readGroove({ ...groove, sounds: { drums: 1, bass: 1, chords: 1, melody: 1 } })?.sounds).toEqual({ drums: "knackig", bass: "rund", chords: "epiano", melody: "floete" });
  // An instrument or mood that does not exist falls back the same way; a kit cannot play the bass.
  expect(readGroove({ ...groove, chords: { ...groove.chords, mode: 9 }, sounds: { drums: 7, bass: "tuba", chords: "tr808", melody: "chor" } })).toMatchObject({ chords: { mode: 0 }, sounds: { ...first, melody: "chor" } });
});

it("reads the effect controls back, each within its range", () => {
  expect(readEffects(undefined)).toEqual({ hall: 4, echo: 4, tape: 5, pump: 6, filter: 0 });
  expect(readEffects({ hall: 10, echo: 0, tape: 11, pump: 2.5, filter: -5, wah: 3 })).toEqual({ hall: 10, echo: 0, tape: 5, pump: 6, filter: -5 });
});

it("names a groove after its key, the same way every time", () => {
  const groove = bredGroove();
  expect(grooveName(groove)).toMatch(/^[a-zäöü]+, (c|cis|des|d|dis|es|e|f|fis|ges|g|gis|as|a|ais|b|h)-(Moll|Dorisch)$/);
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
  const effects = { hall: 1, echo: 2, tape: 3, pump: 4, filter: 5 };
  expect(parseSession(JSON.stringify({ groove, energy: 3, volume: 55, held: ["bass", "tuba"], effects, dj: false }))).toEqual({ groove, energy: 3, volume: 55, held: ["bass"], effects, levels: DEFAULT_LEVELS, dj: false, tides: false, calmSky: false });
  // Odd settings fall back to the defaults; the groove still counts.
  expect(parseSession(JSON.stringify({ groove, energy: 99, volume: "laut" }))).toEqual({ groove, energy: 5, volume: 80, held: [], effects: readEffects(null), levels: DEFAULT_LEVELS, dj: false, tides: false, calmSky: false });
  expect(parseSession(JSON.stringify({ groove, levels: { drums: 0, bass: 100, chords: 101, melody: "laut" } }))?.levels).toEqual({ drums: 0, bass: 100, chords: 80, melody: 80 });
  expect(readLevels(null)).toEqual(DEFAULT_LEVELS);
  expect(parseSession(JSON.stringify({ groove, dj: true, tides: true, calmSky: "ja" }))).toMatchObject({ dj: true, tides: true, calmSky: false });
});

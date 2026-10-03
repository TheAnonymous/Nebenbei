import assert from "node:assert/strict";
import { expect, it } from "vitest";
import type { Groove, Note, Rng } from "../src/music/groove";
import { BASS_STEPS, chordName, chordPitches, DRUM_STEPS, LOOP_STEPS, mutate, rollGroove, STAB_STEPS, tonePitch, TRACKS } from "../src/music/groove";

/** mulberry32: the same seed gives the same music. */
function seeded(seed: number): Rng {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];

// Plain asserts here: these run a few thousand times, and `expect` is slow at that.
function assertLine(notes: Note[], steps: number, tones: number[]): void {
  assert(notes.length >= 4 && notes.length <= 12, `${notes.length} notes`);
  assert(notes[0]!.step >= 0);
  notes.forEach((note, index) => {
    assert(tones.includes(note.tone), `tone ${note.tone}`);
    assert(note.len >= 1);
    // In order, and no note runs into the next or past the end.
    assert(note.step + note.len <= (notes[index + 1]?.step ?? steps), `note at ${note.step} overlaps`);
  });
}

function assertPlayable(groove: Groove): void {
  const has = (voice: string, step: number): boolean => groove.drums.some((hit) => hit.voice === voice && hit.step === step);
  for (let step = 0; step < DRUM_STEPS; step += 4) assert(has("kick", step), `kick missing at ${step}`);
  for (const step of [4, 12, 20, 28]) assert(has("clap", step), `clap missing at ${step}`);
  const places = groove.drums.map((hit) => `${hit.voice}@${hit.step}`);
  assert.equal(new Set(places).size, places.length, "two hits of one voice on one step");
  for (const hit of groove.drums) assert(hit.step >= 0 && hit.step < DRUM_STEPS);

  assertLine(groove.bass, BASS_STEPS, [0, 2, 3, 4]);
  assertLine(groove.melody, LOOP_STEPS, [0, 1, 2, 3, 4, 5]);

  const { key, bars, stabs } = groove.chords;
  assert.equal(bars.length, 4);
  assert(stabs.length >= 1 && stabs.length <= 5, `${stabs.length} stabs`);
  assert.equal(new Set(stabs.map((stab) => stab.step)).size, stabs.length);
  for (const stab of stabs) assert(stab.step >= 0 && stab.step < STAB_STEPS);
  for (const chord of bars) {
    assert.notEqual(chord.degree, 1, "the diminished chord");
    const pitches = chordPitches(key, chord);
    assert.equal(pitches.length, 4);
    for (const pitch of pitches) {
      assert(pitch >= 52 && pitch < 69, `chord pitch ${pitch}`);
      // Every chord note belongs to the key.
      assert(MINOR.includes((((pitch - key) % 12) + 12) % 12), `pitch ${pitch} outside the key`);
    }
  }
}

it("stays a playable groove through a long day of small changes", () => {
  for (const seed of [1, 2, 3]) {
    const rng = seeded(seed);
    let groove = rollGroove(rng);
    assertPlayable(groove);
    for (let n = 0; n < 1500; n += 1) {
      const before = JSON.stringify(groove);
      const result = mutate(groove, rng);
      // Exactly the named track changed, and the groove handed in is untouched.
      assert.deepEqual(TRACKS.filter((track) => JSON.stringify(result.groove[track]) !== JSON.stringify(groove[track])), [result.track]);
      assert.equal(JSON.stringify(groove), before);
      groove = result.groove;
      assertPlayable(groove);
    }
  }
});

it("turns chords and tones into the right pitches and names", () => {
  const a = 9;
  const tonic = { degree: 0, inversion: 0, ninth: false };
  expect(chordName(a, tonic)).toBe("Am7");
  expect(chordName(a, { degree: 5, inversion: 0, ninth: false })).toBe("Fmaj7");
  expect(chordName(a, { degree: 2, inversion: 0, ninth: true })).toBe("Cmaj9");
  expect(chordName(a, { degree: 6, inversion: 0, ninth: false })).toBe("G7");
  expect(chordName(11, tonic)).toBe("Hm7");
  // Am7 from E3 upwards: E G A C.
  expect(chordPitches(a, tonic)).toEqual([52, 55, 57, 60]);
  // Am9 leaves the root to the bass: E G H C.
  expect(chordPitches(a, { ...tonic, ninth: true })).toEqual([52, 55, 59, 60]);
  // The ninth above the fifth degree would be a semitone above its root, so it is not played.
  const fifth = { degree: 4, inversion: 0, ninth: true };
  expect(chordPitches(a, fifth)).toEqual(chordPitches(a, { ...fifth, ninth: false }));
  expect(chordName(a, fifth)).toBe("Em7");
  // Bass: root A1, fifth E2, the root an octave up.
  expect([0, 2, 4].map((tone) => tonePitch(a, tonic, tone, 33))).toEqual([33, 40, 45]);
});

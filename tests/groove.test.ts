import assert from "node:assert/strict";
import { expect, it } from "vitest";
import type { Groove, Note, Rng } from "../src/music/groove";
import { BASS_STEPS, chordName, chordPitches, DRUM_STEPS, feelOf, keyName, instrumentsFor, LOOP_STEPS, MODES, mutate, nextInstrument, plays, roll, rollGroove, STAB_STEPS, tonePitch, TRACKS } from "../src/music/groove";

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

  const { key, mode, bars, stabs } = groove.chords;
  const scale: readonly number[] = MODES[mode]!.scale;
  assert.equal(bars.length, 4);
  assert(stabs.length >= 1 && stabs.length <= 5, `${stabs.length} stabs`);
  assert.equal(new Set(stabs.map((stab) => stab.step)).size, stabs.length);
  for (const stab of stabs) assert(stab.step >= 0 && stab.step < STAB_STEPS);
  for (const track of TRACKS) assert(instrumentsFor(track).includes(groove.sounds[track]), `sound of ${track}`);
  for (const chord of bars) {
    const pitches = chordPitches(groove.chords, chord);
    // Never the diminished chord: its root and fifth would be six semitones apart.
    assert(!chordName(groove.chords, chord).includes("♭5"));
    assert.equal(pitches.length, 4);
    for (const pitch of pitches) {
      assert(pitch >= 50 && pitch < 71, `chord pitch ${pitch}`);
      // Every chord note belongs to the key.
      assert(scale.includes((((pitch - key) % 12) + 12) % 12), `pitch ${pitch} outside the key`);
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

it("rolls one track and leaves held tracks alone", () => {
  const rng = seeded(7);
  const groove = rollGroove(rng);
  for (const track of TRACKS) {
    const rolled = roll(groove, track, rng);
    assertPlayable(rolled);
    for (const other of TRACKS) if (other !== track) expect(rolled[other]).toBe(groove[other]);
    expect(rolled[track]).not.toEqual(groove[track]);
  }
  // A roll keeps the mood and the instruments.
  const happy = { ...groove, chords: { ...groove.chords, mode: 3 }, sounds: { drums: "tr909", bass: "reese", chords: "chor", melody: "kalimba" } };
  const rerolled = roll(happy, "chords", rng);
  expect(rerolled.chords.mode).toBe(3);
  expect(rerolled.sounds).toEqual(happy.sounds);
  assertPlayable(rerolled);

  // With drums and chords held, only bass and melody breed on.
  let bred = groove;
  for (let n = 0; n < 200; n += 1) bred = mutate(bred, rng, ["bass", "melody"]).groove;
  expect(bred.drums).toEqual(groove.drums);
  expect(bred.chords).toEqual(groove.chords);
  expect(bred.bass).not.toEqual(groove.bass);
});

it("offers many instruments, and steps through those that suit a track", () => {
  expect(instrumentsFor("drums").length).toBeGreaterThanOrEqual(6);
  expect(instrumentsFor("melody").length).toBeGreaterThanOrEqual(20);
  // Every instrument can go on bass, chords and melody alike.
  expect(instrumentsFor("bass")).toEqual(instrumentsFor("chords"));
  for (const track of TRACKS) {
    const seen = new Set<string>();
    let sound = instrumentsFor(track)[0]!;
    for (let step = 0; step < 40; step += 1) {
      sound = nextInstrument(track, sound);
      expect(instrumentsFor(track)).toContain(sound);
      seen.add(sound);
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
  }
  // From an instrument that does not suit the track, Q starts with the first that does.
  expect(nextInstrument("bass", "kalimba")).toBe("sub");
});

it("turns chords and tones into the right pitches and names", () => {
  const aMinor = { key: 9, mode: 0 };
  const tonic = { degree: 0, inversion: 0, ninth: false };
  expect(chordName(aMinor, tonic)).toBe("Am7");
  expect(chordName(aMinor, { degree: 5, inversion: 0, ninth: false })).toBe("Fmaj7");
  expect(chordName(aMinor, { degree: 2, inversion: 0, ninth: true })).toBe("Cmaj9");
  expect(chordName(aMinor, { degree: 6, inversion: 0, ninth: false })).toBe("G7");
  expect(chordName({ key: 11, mode: 0 }, tonic)).toBe("Hm7");
  // Sharps in g sharp minor, flats in f minor.
  expect(chordName({ key: 8, mode: 0 }, tonic)).toBe("G♯m7");
  expect(chordName({ key: 5, mode: 0 }, { degree: 5, inversion: 0, ninth: false })).toBe("D♭maj7");
  // Am7 in the saddest mood from D3 upwards: E G A C.
  expect(chordPitches(aMinor, tonic)).toEqual([52, 55, 57, 60]);
  // Am9 leaves the root to the bass: E G H C.
  expect(chordPitches(aMinor, { ...tonic, ninth: true })).toEqual([52, 55, 59, 60]);
  // Happier moods voice the chords a semitone higher per step: in dorian the lowest voice starts at E flat 3, the top inversion at A flat 3.
  expect(chordPitches({ key: 9, mode: 1 }, tonic)).toEqual([52, 55, 57, 60]);
  expect(chordPitches({ key: 9, mode: 1 }, { ...tonic, inversion: 2 })).toEqual([57, 60, 64, 67]);
  // The ninth above the fifth degree would be a semitone above its root, so it is not played.
  const fifth = { degree: 4, inversion: 0, ninth: true };
  expect(chordPitches(aMinor, fifth)).toEqual(chordPitches(aMinor, { ...fifth, ninth: false }));
  expect(chordName(aMinor, fifth)).toBe("Em7");
  // Bass: root A1, fifth E2, the root an octave up.
  expect([0, 2, 4].map((tone) => tonePitch(aMinor, tonic, tone, 33))).toEqual([33, 40, 45]);
  // The diminished chord on the second degree of minor gives way to the chord a third below.
  expect(chordName(aMinor, { degree: 1, inversion: 0, ninth: false })).toBe("G7");
});

it("moves from sad to happy one note at a time", () => {
  const tonic = { degree: 0, inversion: 0, ninth: false };
  const names = MODES.map((_, mode) => keyName({ key: 2, mode }));
  expect(names).toEqual(["d-Moll", "d-Dorisch", "D-Mixolydisch", "D-Dur", "D-Lydisch"]);
  expect(MODES.map((_, mode) => chordName({ key: 2, mode }, tonic))).toEqual(["Dm7", "Dm7", "D7", "Dmaj7", "Dmaj7"]);
  // Each mood differs from the one before it in exactly one note of the scale, raised by a semitone.
  for (let mode = 1; mode < MODES.length; mode += 1) {
    const raised = MODES[mode]!.scale.map((semitones, step) => semitones - MODES[mode - 1]!.scale[step]!);
    expect(raised.filter((difference) => difference !== 0)).toEqual([1]);
  }
  // The same four bars in D major: I, vi, iii and, instead of the diminished chord on the seventh degree, the dominant.
  const bars = [0, 5, 2, 6].map((degree) => ({ degree, inversion: 0, ninth: false }));
  expect(bars.map((chord) => chordName({ key: 2, mode: 3 }, chord))).toEqual(["Dmaj7", "Hm7", "F♯m7", "A7"]);
  // E flat major is written with flats, its bass note stays in the bass octave.
  expect(keyName({ key: 3, mode: 3 })).toBe("Es-Dur");
  expect(chordName({ key: 3, mode: 3 }, { degree: 3, inversion: 0, ninth: false })).toBe("A♭maj7");
  expect(tonePitch({ key: 3, mode: 3 }, tonic, 1, 33)).toBe(43);
});

it("lets the mood change more than the scale", () => {
  const sad = feelOf(0);
  const happy = feelOf(MODES.length - 1);
  // From sad to happy: faster, more swung, brighter, drier, punchier, busier, higher.
  expect(sad.tempo).toBe(104);
  expect(happy.tempo).toBe(126);
  for (let mode = 1; mode < MODES.length; mode += 1) {
    const before = feelOf(mode - 1);
    const after = feelOf(mode);
    expect(after.tempo).toBeGreaterThan(before.tempo);
    expect(after.swing).toBeGreaterThan(before.swing);
    expect(after.brightness).toBeGreaterThan(before.brightness);
    expect(after.space).toBeLessThan(before.space);
    expect(after.punch).toBeGreaterThan(before.punch);
    expect(after.wait).toBeLessThan(before.wait);
    expect(after.melodyLow).toBeGreaterThan(before.melodyLow);
  }
  // The kick (from energy 0.4) waits for more energy when sad and comes earlier when happy; the bass does not care.
  const kick = { min: 0.4 };
  expect([0, 2, 4].map((mode) => plays(kick, "drums", 0.4, mode))).toEqual([false, true, true]);
  expect([0, 2, 4].map((mode) => plays(kick, "drums", 0.3, mode))).toEqual([false, false, true]);
  expect([0, 2, 4].map((mode) => plays(kick, "bass", 0.4, mode))).toEqual([true, true, true]);
  // At energy 0 only what waits for nothing plays, in every mood.
  expect(MODES.some((_, mode) => plays({ min: 0.05 }, "melody", 0, mode))).toBe(false);
});

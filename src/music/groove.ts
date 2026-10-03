import { EXTRA_FITS, GENRE_FITS, KITS, PATCHES } from "../audio/instruments";

/*
 * The groove: four tracks that breed themselves. Everything here is plain
 * data and pure functions; the engine plays it, the page shows it.
 *
 * Bass and melody are written relative to the chord of their bar, so they
 * follow whatever happens to the chords.
 */

export type Rng = () => number;

export const STEPS_PER_BAR = 16;
export const LOOP_STEPS = 64;
/** How long each track's pattern is before it repeats, in sixteenths. */
export const DRUM_STEPS = 32;
export const BASS_STEPS = 32;
export const STAB_STEPS = 16;

export const TRACKS = ["drums", "bass", "chords", "melody"] as const;
export type TrackId = (typeof TRACKS)[number];

/** The genres: each has its own tempo, swing, drum backbone and ways of bass, chords and melody (STYLES). */
export const GENRES = ["house", "hiphop"] as const;
export type Genre = (typeof GENRES)[number];
export const GENRE_NAMES: Record<Genre, string> = { house: "Lo-Fi-House", hiphop: "Lo-Fi-Hip-Hop" };

export const DRUM_VOICES = ["kick", "clap", "hat", "open", "shaker", "rim"] as const;
/** The voices of an extra percussion track: hand drums, a clave, and two from the kit. */
export const PERC_VOICES = ["conga", "bongo", "clave", "rim", "shaker"] as const;
export type DrumVoice = (typeof DRUM_VOICES)[number] | (typeof PERC_VOICES)[number];

/** `min` is the energy (0..1) from which a hit, note or stab plays. */
export interface Hit {
  step: number;
  voice: DrumVoice;
  vel: number;
  min: number;
}

/** `tone` counts the chord's tones upwards from its root: 0 root, 1 third, 2 fifth, 3 seventh, 4 the root an octave up … */
export interface Note {
  step: number;
  len: number;
  tone: number;
  vel: number;
  min: number;
}

/** `degree` is the step of the scale the chord stands on, `inversion` (0..2) how high it is voiced. */
export interface Chord {
  degree: number;
  inversion: number;
  ninth: boolean;
}

export interface Stab {
  step: number;
  len: number;
  min: number;
}

/** `key` is the pitch class of the key note (0 = C), `mode` the mood: an index into MODES, from sad to happy. */
export interface Harmony {
  key: number;
  mode: number;
}

export interface Groove {
  genre: Genre;
  drums: Hit[];
  bass: Note[];
  /** One chord per bar, one bar of stab rhythm. */
  chords: Harmony & { bars: Chord[]; stabs: Stab[] };
  melody: Note[];
  /** The instrument of each track: a kit for the drums, an instrument (audio/instruments.ts) for the others. */
  sounds: Record<TrackId, string>;
  /** Up to four more tracks, below the four that every groove has. */
  extras: Extra[];
}

/*
 * The extra tracks. Each plays like one of the four core tracks (its role:
 * which instruments suit it, how the mood thins it out, its row in the sky)
 * and follows the chords like they do.
 */

export const EXTRA_KINDS = ["perkussion", "gegenstimme", "arpeggio", "flaeche"] as const;
export type ExtraKind = (typeof EXTRA_KINDS)[number];
export const EXTRA_NAMES: Record<ExtraKind, string> = { perkussion: "Perkussion", gegenstimme: "Gegenstimme", arpeggio: "Arpeggio", flaeche: "Fläche" };
export const EXTRA_ROLES: Record<ExtraKind, TrackId> = { perkussion: "drums", gegenstimme: "melody", arpeggio: "melody", flaeche: "chords" };
/** How long each kind's pattern is before it repeats, in sixteenths. */
export const EXTRA_STEPS: Record<ExtraKind, number> = { perkussion: 32, gegenstimme: LOOP_STEPS, arpeggio: 16, flaeche: 16 };
export const MAX_TRACKS = 8;

/**
 * Perkussion has hits; the others have notes. A Fläche's notes are held
 * chords (their tone does not matter), an Arpeggio's walk the chord's tones.
 * `level` is the track's level (0..100, 80 as measured), `sound` its kit or
 * instrument; `id` names it among the tracks.
 */
export type Extra = { id: string; sound: string; level: number } & ({ kind: "perkussion"; hits: Hit[] } | { kind: "gegenstimme" | "arpeggio" | "flaeche"; notes: Note[] });

/** The ids of all tracks of a groove, in their order on the page: the four core tracks, then the extras. */
export const trackIds = (groove: Groove): string[] => [...TRACKS, ...groove.extras.map((extra) => extra.id)];
export const isCore = (track: string): track is TrackId => (TRACKS as readonly string[]).includes(track);

/** Everything that can play a track: the kits for drums and percussion, every instrument for the others. */
export const instrumentsFor = (role: TrackId): readonly string[] => (role === "drums" ? Object.keys(KITS) : Object.keys(PATCHES));

/** The instrument after `current` among those that suit the track best in the genre. */
export function nextInstrument(track: TrackId, current: string, genre: Genre = "house"): string {
  const fits = GENRE_FITS[genre][track];
  return fits[(fits.indexOf(current) + 1) % fits.length]!;
}

/** Before the instrument library, each track had three instruments, stored by number. */
const FIRST_SOUNDS: Record<TrackId, readonly string[]> = {
  drums: ["staubig", "knackig", "weich"],
  bass: ["sub", "rund", "kantig"],
  chords: ["saege", "epiano", "orgel"],
  melody: ["glocke", "floete", "gezupft"],
};

const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;
const between = (rng: Rng, low: number, high: number): number => Math.round((low + rng() * (high - low)) * 100) / 100;

// ---- Pitches ---------------------------------------------------------------

/** The moods from sad to happy. Each one raises a single note of the scale before it, so a step on the slider is a small step in the music. */
export const MODES = [
  { name: "Moll", scale: [0, 2, 3, 5, 7, 8, 10] },
  { name: "Dorisch", scale: [0, 2, 3, 5, 7, 9, 10] },
  { name: "Mixolydisch", scale: [0, 2, 4, 5, 7, 9, 10] },
  { name: "Dur", scale: [0, 2, 4, 5, 7, 9, 11] },
  { name: "Lydisch", scale: [0, 2, 4, 6, 7, 9, 11] },
] as const;

/**
 * What a mood changes besides its scale. From sad to happy the music gets
 * faster and more swung, brighter and drier, busier in drums and melody,
 * and melody and chords move up.
 */
export interface Feel {
  /** Beats per minute. */
  tempo: number;
  /** How far the odd sixteenths lean back, in sixteenths. */
  swing: number;
  /** A factor on the filters: below 1 duller, above 1 brighter. */
  brightness: number;
  /** A factor on hall, echo and the chord bed: above 1 wider. */
  space: number;
  /** A factor on the drums' level. */
  punch: number;
  /** A factor on the energy that drums and melody notes wait for: above 1 fewer of them play. */
  wait: number;
  /** The octave of the melody: the lowest MIDI pitch a chord root can take there. */
  melodyLow: number;
}

export function feelOf(mode: number, genre: Genre = "house"): Feel {
  const happy = mode / (MODES.length - 1);
  const melodyLow = [55, 58, 60, 63, 65][mode]!;
  if (genre === "hiphop") {
    // Slow, heavily swung and a little darker: boom-bap at 72 to 88.
    return { tempo: 72 + 16 * happy, swing: 0.22 + 0.08 * happy, brightness: 0.6 + 0.5 * happy, space: 1.4 - 0.6 * happy, punch: 0.9 + 0.15 * happy, wait: 1.25 - 0.5 * happy, melodyLow };
  }
  return { tempo: 104 + 22 * happy, swing: 0.08 + 0.12 * happy, brightness: 0.7 + 0.6 * happy, space: 1.5 - 0.8 * happy, punch: 0.85 + 0.2 * happy, wait: 1.25 - 0.5 * happy, melodyLow };
}

/** Whether a hit, note or stab of a track plays at this energy (0..1) in this mood. */
export function plays(item: { min: number }, track: TrackId, energy: number, mode: number): boolean {
  return item.min * (track === "drums" || track === "melody" ? feelOf(mode).wait : 1) <= energy + 1e-9;
}

/** Semitones above the key note for a step of the mode's scale (7 is the octave). */
const scaleStep = (mode: number, step: number): number => 12 * Math.floor(step / 7) + MODES[mode]!.scale[((step % 7) + 7) % 7]!;

/** Moves a pitch by octaves into the twelve semitones from `low` upwards. */
const fold = (pitch: number, low: number): number => low + ((((pitch - low) % 12) + 12) % 12);

/**
 * The scale step a chord really stands on. Every mode has one diminished
 * chord, and it grates; the chord a third below shares three of its four
 * notes and plays in its place.
 */
const rootStep = (mode: number, chord: Chord): number => (scaleStep(mode, chord.degree + 4) - scaleStep(mode, chord.degree) === 6 ? (chord.degree + 5) % 7 : chord.degree);

/** A ninth only where it lies a whole tone above the root; a semitone above would grate. */
function hasNinth(mode: number, chord: Chord): boolean {
  const root = rootStep(mode, chord);
  return chord.ninth && scaleStep(mode, root + 1) - scaleStep(mode, root) === 2;
}

/**
 * The MIDI pitches of a chord, all folded into one octave so that changes
 * move the voices as little as possible. With a ninth the root is left to
 * the bass. Happier moods voice it a little higher.
 */
export function chordPitches({ key, mode }: Harmony, chord: Chord): number[] {
  const low = 50 + mode + [0, 3, 5][chord.inversion]!;
  const root = rootStep(mode, chord);
  return (hasNinth(mode, chord) ? [2, 4, 6, 8] : [0, 2, 4, 6]).map((third) => fold(key + scaleStep(mode, root + third), low)).sort((a, b) => a - b);
}

/** The MIDI pitch of a bass or melody note over a chord; the chord's root lies in the octave from `low`. */
export function tonePitch({ key, mode }: Harmony, chord: Chord, tone: number, low: number): number {
  const step = rootStep(mode, chord);
  const root = scaleStep(mode, step);
  return fold(key + root, low) + scaleStep(mode, step + 2 * (tone % 4)) - root + 12 * Math.floor(tone / 4);
}

// B flat and H as on German lead sheets.
const FLAT_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "H"];
const SHARP_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "H"];
/** How far above the key note the major key with the same notes lies, for each mode. */
const PARENT_MAJOR = [3, 10, 5, 0, 7];
/** Whether the key is written with sharps: its notes are those of G, D, A, E or B major. */
const usesSharps = ({ key, mode }: Harmony): boolean => [7, 2, 9, 4, 11].includes((key + PARENT_MAJOR[mode]!) % 12);

export function chordName(harmony: Harmony, chord: Chord): string {
  const { key, mode } = harmony;
  const root = rootStep(mode, chord);
  const above = (third: number): number => scaleStep(mode, root + third) - scaleStep(mode, root);
  const quality = above(2) === 3 ? "m" : above(6) === 11 ? "maj" : "";
  return (usesSharps(harmony) ? SHARP_NAMES : FLAT_NAMES)[(key + scaleStep(mode, root)) % 12]! + quality + (hasNinth(mode, chord) ? "9" : "7");
}

// ---- Drums -----------------------------------------------------------------

/** House: kick on every quarter, clap on two and four, hats off the beat, a shaker in eighths. Mutations never touch these. */
function houseBackbone(): Hit[] {
  const hits: Hit[] = [];
  for (let step = 0; step < DRUM_STEPS; step += 1) {
    const inBar = step % STEPS_PER_BAR;
    if (inBar % 4 === 0) hits.push({ step, voice: "kick", vel: 1, min: 0.4 });
    if (inBar === 4 || inBar === 12) hits.push({ step, voice: "clap", vel: 0.8, min: 0.5 });
    if (inBar % 4 === 2) hits.push({ step, voice: "hat", vel: 0.7, min: 0.3 });
    if (inBar % 2 === 0) hits.push({ step, voice: "shaker", vel: 0.3, min: 0.1 });
  }
  return hits;
}

/** Boom-bap: kick on one and on the and of three, snare (the clap's place) on two and four, hats in eighths. */
function hiphopBackbone(): Hit[] {
  const hits: Hit[] = [];
  for (let step = 0; step < DRUM_STEPS; step += 1) {
    const inBar = step % STEPS_PER_BAR;
    if (inBar === 0 || inBar === 10) hits.push({ step, voice: "kick", vel: inBar ? 0.85 : 1, min: inBar ? 0.35 : 0.3 });
    if (inBar === 4 || inBar === 12) hits.push({ step, voice: "clap", vel: 0.9, min: 0.4 });
    if (inBar % 2 === 0) hits.push({ step, voice: "hat", vel: inBar % 4 === 0 ? 0.55 : 0.4, min: 0.25 });
  }
  return hits;
}

/** The hits that may come and go around the backbone: where in a bar, how loud, from which energy, how many at most. */
const DRUM_EXTRAS: readonly { voice: DrumVoice; steps: readonly number[]; vel: number; min: number; max: number }[] = [
  { voice: "kick", steps: [3, 7, 10, 11, 14, 15], vel: 0.5, min: 0.7, max: 3 },
  { voice: "hat", steps: [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15], vel: 0.35, min: 0.5, max: 14 },
  { voice: "open", steps: [2, 6, 10, 14], vel: 0.5, min: 0.65, max: 6 },
  { voice: "shaker", steps: [1, 3, 5, 7, 9, 11, 13, 15], vel: 0.2, min: 0.3, max: 10 },
  { voice: "rim", steps: [3, 6, 7, 10, 11, 13, 15], vel: 0.5, min: 0.55, max: 5 },
];

/** Hip-hop's ghost notes around its backbone: a kick that drags, soft snares, sixteenth hats. */
const HIPHOP_EXTRAS: typeof DRUM_EXTRAS = [
  { voice: "kick", steps: [3, 7, 14, 15], vel: 0.6, min: 0.5, max: 3 },
  { voice: "clap", steps: [6, 9, 14, 15], vel: 0.3, min: 0.55, max: 3 },
  { voice: "hat", steps: [1, 3, 5, 7, 9, 11, 13, 15], vel: 0.25, min: 0.55, max: 8 },
  { voice: "open", steps: [6, 14], vel: 0.4, min: 0.6, max: 2 },
  { voice: "rim", steps: [3, 7, 11, 13], vel: 0.4, min: 0.45, max: 3 },
  { voice: "shaker", steps: [2, 6, 10, 14], vel: 0.2, min: 0.4, max: 4 },
];

/** The hits of an extra percussion track, none of them fixed. */
const PERC_HITS: typeof DRUM_EXTRAS = [
  { voice: "conga", steps: [0, 3, 6, 8, 10, 11, 14], vel: 0.6, min: 0.2, max: 6 },
  { voice: "bongo", steps: [2, 5, 7, 9, 12, 13, 15], vel: 0.55, min: 0.35, max: 6 },
  { voice: "clave", steps: [0, 3, 6, 10, 12], vel: 0.5, min: 0.3, max: 4 },
  { voice: "rim", steps: [4, 7, 11, 14], vel: 0.45, min: 0.5, max: 3 },
  { voice: "shaker", steps: [1, 3, 5, 7, 9, 11, 13, 15], vel: 0.3, min: 0.25, max: 8 },
];

/** Adds an extra hit, or takes away the one that is already there; at least `least` hits stay. */
function mutateDrums(hits: Hit[], rng: Rng, table = DRUM_EXTRAS, least = 0): boolean {
  const extra = pick(rng, table);
  const step = pick(rng, extra.steps) + STEPS_PER_BAR * Math.floor(rng() * (DRUM_STEPS / STEPS_PER_BAR));
  const at = hits.findIndex((hit) => hit.voice === extra.voice && hit.step === step);
  if (at >= 0) {
    if (hits.length <= least) return false;
    hits.splice(at, 1);
    return true;
  }
  const present = hits.filter((hit) => hit.voice === extra.voice && extra.steps.includes(hit.step % STEPS_PER_BAR));
  if (present.length >= extra.max) return false;
  hits.push({ step, voice: extra.voice, vel: between(rng, extra.vel * 0.7, extra.vel * 1.1), min: between(rng, extra.min, Math.min(0.95, extra.min + 0.25)) });
  return true;
}

function rollDrums(rng: Rng, style: Style): Hit[] {
  const hits = style.backbone();
  for (let n = 0; n < 40; n += 1) mutateDrums(hits, rng, style.drums);
  return hits;
}

// ---- Bass and melody -------------------------------------------------------

/** What a line may do: its length, the places in a bar, the tones, the note lengths, how many notes, from which energy. */
interface Line {
  steps: number;
  grid: readonly number[];
  tones: readonly number[];
  lens: readonly number[];
  count: readonly [number, number];
  min: readonly [number, number];
}

const BASS: Line = { steps: BASS_STEPS, grid: [0, 2, 3, 6, 7, 8, 10, 11, 14], tones: [0, 0, 0, 0, 2, 2, 3, 4], lens: [1, 2, 2, 3], count: [4, 12], min: [0.2, 0.6] };
const MELODY: Line = { steps: LOOP_STEPS, grid: [0, 2, 3, 4, 6, 8, 10, 11, 12, 14], tones: [0, 1, 2, 3, 4, 5], lens: [1, 2, 3, 4], count: [4, 12], min: [0.05, 0.6] };
/** Hip-hop: a bass that sits with the kick and holds, a melody with room between its notes. */
const HIPHOP_BASS: Line = { steps: BASS_STEPS, grid: [0, 3, 7, 10, 11, 14], tones: [0, 0, 0, 0, 2, 3, 4], lens: [3, 4, 6], count: [3, 8], min: [0.15, 0.5] };
const HIPHOP_MELODY: Line = { steps: LOOP_STEPS, grid: [0, 3, 6, 8, 10, 12, 14], tones: [0, 1, 2, 3, 4, 5], lens: [2, 3, 4, 6], count: [3, 9], min: [0.1, 0.6] };

function addNote(notes: Note[], rng: Rng, line: Line, withinSteps = line.steps): boolean {
  const step = STEPS_PER_BAR * Math.floor(rng() * (withinSteps / STEPS_PER_BAR)) + pick(rng, line.grid);
  if (notes.some((note) => note.step === step)) return false;
  notes.push({ step, len: pick(rng, line.lens), tone: pick(rng, line.tones), vel: between(rng, 0.65, 0.9), min: between(rng, ...line.min) });
  return true;
}

/** Keeps a line playable by one voice: in order, no note running into the next or past the end. */
function tidy(notes: Note[], steps: number): void {
  notes.sort((a, b) => a.step - b.step);
  notes.forEach((note, index) => {
    note.len = Math.min(note.len, (notes[index + 1]?.step ?? steps) - note.step);
  });
}

/** One small change: another tone, another place in the bar, or a note more or less. */
function mutateNotes(notes: Note[], rng: Rng, line: Line): boolean {
  const note = pick(rng, notes);
  const kind = rng();
  let changed = false;
  if (kind < 0.4) {
    const tone = pick(rng, line.tones);
    changed = tone !== note.tone;
    note.tone = tone;
  } else if (kind < 0.7) {
    const step = note.step - (note.step % STEPS_PER_BAR) + pick(rng, line.grid);
    changed = !notes.some((other) => other.step === step);
    if (changed) note.step = step;
  } else if (rng() < 0.5) {
    changed = notes.length > line.count[0];
    if (changed) notes.splice(notes.indexOf(note), 1);
  } else {
    changed = notes.length < line.count[1] && addNote(notes, rng, line);
  }
  tidy(notes, line.steps);
  return changed;
}

/** A short motif, repeated to fill the line, then varied a little so the repeats differ. */
function rollNotes(rng: Rng, line: Line, motifSteps: number, variations: number): Note[] {
  const motif: Note[] = [];
  const want = 3 + Math.floor(rng() * 3);
  while (motif.length < want) addNote(motif, rng, line, motifSteps);
  const notes: Note[] = [];
  for (let offset = 0; offset < line.steps; offset += motifSteps) notes.push(...motif.map((note) => ({ ...note, step: note.step + offset })));
  tidy(notes, line.steps);
  for (let n = 0; n < variations; n += 1) mutateNotes(notes, rng, line);
  return notes;
}

// ---- Chords ----------------------------------------------------------------

/** Four bars each, as steps of the scale (in minor: 0 = i, 2 = III, 3 = iv, 4 = v, 5 = VI, 6 = VII). */
const HOUSE_PROGRESSIONS: readonly (readonly number[])[] = [
  [0, 5, 2, 6],
  [0, 3, 5, 4],
  [5, 6, 0, 0],
  [0, 0, 3, 3],
  [3, 6, 2, 5],
  [0, 2, 5, 4],
  [0, 6, 5, 6],
  [5, 4, 0, 0],
];
/** Hip-hop leans on the subdominant and walks through more chords. */
const HIPHOP_PROGRESSIONS: readonly (readonly number[])[] = [
  [0, 3, 6, 2],
  [3, 6, 2, 5],
  [0, 5, 3, 4],
  [5, 4, 0, 0],
  [0, 3, 0, 4],
  [3, 4, 0, 0],
];

function addStab(stabs: Stab[], rng: Rng, style: Style): boolean {
  const step = stabs.length ? pick(rng, style.stabGrid) : style.stabGrid[0]!;
  if (stabs.some((stab) => stab.step === step)) return false;
  // The first stab comes in early, so the chords get a rhythm as soon as the kick is there.
  stabs.push({ step, len: Math.min(STAB_STEPS - step, pick(rng, style.stabLens)), min: stabs.length ? between(rng, 0.4, 0.7) : 0.35 });
  return true;
}

/** One small change: a chord moves to another inversion, gains or loses its ninth, the rhythm shifts, or (rarely) a chord gives way to a relative. */
function mutateChords(chords: Groove["chords"], rng: Rng, style: Style): boolean {
  const chord = pick(rng, chords.bars);
  const kind = rng();
  if (kind < 0.35) {
    chord.inversion = (chord.inversion + 1 + Math.floor(rng() * 2)) % 3;
    return true;
  }
  if (kind < 0.6) {
    chord.ninth = !chord.ninth;
    // Only a change if the ninth is really played on this chord.
    return hasNinth(chords.mode, { ...chord, ninth: true });
  }
  if (kind < 0.9) {
    if (rng() < 0.5) {
      if (chords.stabs.length <= 1) return false;
      chords.stabs.splice(Math.floor(rng() * chords.stabs.length), 1);
      return true;
    }
    return chords.stabs.length < style.maxStabs && addStab(chords.stabs, rng, style);
  }
  // The chord a third above or below shares three of the four notes.
  chord.degree = (chord.degree + pick(rng, [2, 5])) % 7;
  return true;
}

function rollChords(rng: Rng, style: Style): Groove["chords"] {
  const stabs: Stab[] = [];
  const want = style.stabCount[0] + Math.floor(rng() * (style.stabCount[1] - style.stabCount[0] + 1));
  while (stabs.length < want) addStab(stabs, rng, style);
  return {
    key: Math.floor(rng() * 12),
    // A fresh groove starts in minor or dorian, where both genres are at home.
    mode: Math.floor(rng() * 2),
    bars: pick(rng, style.progressions).map((degree) => ({ degree, inversion: Math.floor(rng() * 3), ninth: rng() < style.ninth })),
    stabs,
  };
}

/** Everything a genre decides about the patterns. */
interface Style {
  backbone: () => Hit[];
  drums: typeof DRUM_EXTRAS;
  bass: Line;
  melody: Line;
  progressions: readonly (readonly number[])[];
  /** How likely a chord carries its ninth. */
  ninth: number;
  /** Where chords may start (the first always on the first), how long they last, how many a bar. */
  stabGrid: readonly number[];
  stabLens: readonly number[];
  stabCount: readonly [number, number];
  maxStabs: number;
}

const STYLES: Record<Genre, Style> = {
  house: { backbone: houseBackbone, drums: DRUM_EXTRAS, bass: BASS, melody: MELODY, progressions: HOUSE_PROGRESSIONS, ninth: 0.5, stabGrid: [0, 3, 6, 8, 10, 11, 14], stabLens: [1, 2, 2, 3], stabCount: [2, 4], maxStabs: 5 },
  // Long, jazzy chords: one or two a bar, mostly with their ninth.
  hiphop: { backbone: hiphopBackbone, drums: HIPHOP_EXTRAS, bass: HIPHOP_BASS, melody: HIPHOP_MELODY, progressions: HIPHOP_PROGRESSIONS, ninth: 0.8, stabGrid: [0, 8, 10, 12, 14], stabLens: [4, 6, 8, 12, 16], stabCount: [1, 2], maxStabs: 3 },
};

/**
 * The answer to a four-bar progression, so that two passes make eight bars:
 * it starts the same, moves its third chord a third down (three of four
 * notes stay) and turns its last one towards the fifth, which leads home.
 */
export function turnaround(bars: readonly Chord[]): Chord[] {
  const [first, second, third, fourth] = bars as [Chord, Chord, Chord, Chord];
  return [first, second, { ...third, degree: (third.degree + 5) % 7 }, { ...fourth, degree: fourth.degree === 4 ? 6 : 4 }];
}

// ---- The extra tracks ------------------------------------------------------

/** A second voice under the melody: fewer, longer notes. */
const GEGEN: Line = { steps: LOOP_STEPS, grid: [0, 4, 6, 8, 10, 12, 14], tones: [0, 1, 2, 3, 4], lens: [2, 3, 4, 6], count: [3, 8], min: [0.15, 0.65] };
/** An arpeggio within one bar: it may sit on every sixteenth. */
const ARP: Line = { steps: 16, grid: Array.from({ length: 16 }, (_, step) => step), tones: [0, 1, 2, 3, 4], lens: [1, 2], count: [4, 16], min: [0.2, 0.65] };
/** The arpeggio's figures over the chord's tones. */
const ARP_SHAPES: readonly (readonly number[])[] = [
  [0, 1, 2, 3],
  [3, 2, 1, 0],
  [0, 1, 2, 3, 2, 1],
  [0, 2, 1, 3],
  [0, 1, 2, 4],
];
/** How a Fläche holds its chord through the bar. */
const HOLDS: readonly (readonly [number, number][])[] = [
  [[0, 16]],
  [[0, 8], [8, 8]],
  [[0, 12], [12, 4]],
  [[0, 6], [6, 10]],
  [[2, 14]],
];

function rollArpeggio(rng: Rng): Note[] {
  const rate = pick(rng, [1, 2]);
  const shape = pick(rng, ARP_SHAPES);
  const notes: Note[] = [];
  for (let step = 0, at = 0; step < 16; step += rate, at += 1) {
    // On the beat from little energy, in between only with more.
    const onBeat = step % 4 === 0;
    notes.push({ step, len: rate, tone: shape[at % shape.length]!, vel: onBeat ? 0.8 : between(rng, 0.55, 0.7), min: onBeat ? 0.2 : between(rng, 0.3, 0.65) });
  }
  return notes;
}

const holdNotes = (rng: Rng, hold: readonly [number, number][]): Note[] => hold.map(([step, len], index) => ({ step, len, tone: 0, vel: 0.8, min: index ? between(rng, 0.3, 0.6) : 0 }));

/** A fresh pattern of a kind. */
function rollPattern(kind: ExtraKind, rng: Rng): { hits: Hit[] } | { notes: Note[] } {
  switch (kind) {
    case "perkussion": {
      const hits: Hit[] = [];
      for (let n = 0; n < 30; n += 1) mutateDrums(hits, rng, PERC_HITS, 3);
      return { hits };
    }
    case "gegenstimme":
      return { notes: rollNotes(rng, GEGEN, 2 * STEPS_PER_BAR, 1) };
    case "arpeggio":
      return { notes: rollArpeggio(rng) };
    default:
      return { notes: holdNotes(rng, pick(rng, HOLDS)) };
  }
}

/** A new extra track of a kind, at the measured level, with an instrument that suits it. */
export function rollExtra(kind: ExtraKind, rng: Rng): Extra {
  const id = `x${Math.floor(rng() * 36 ** 6).toString(36)}`;
  return { id, kind, sound: pick(rng, EXTRA_FITS[kind]), level: 80, ...rollPattern(kind, rng) } as Extra;
}

/** One small change on an extra track, in place. */
function mutateExtra(extra: Extra, rng: Rng): boolean {
  switch (extra.kind) {
    case "perkussion":
      return mutateDrums(extra.hits, rng, PERC_HITS, 3);
    case "gegenstimme":
      return mutateNotes(extra.notes, rng, GEGEN);
    case "arpeggio":
      return mutateNotes(extra.notes, rng, ARP);
    default: {
      // A Fläche changes how it holds the bar.
      const hold = pick(rng, HOLDS);
      const now = extra.notes.map((note) => `${note.step}:${note.len}`).join();
      if (hold.map(([step, len]) => `${step}:${len}`).join() === now) return false;
      extra.notes = holdNotes(rng, hold);
      return true;
    }
  }
}

/** Adds an extra track (and returns the groove unchanged when it already has eight tracks). */
export function addExtra(groove: Groove, kind: ExtraKind, rng: Rng): Groove {
  if (TRACKS.length + groove.extras.length >= MAX_TRACKS) return groove;
  return { ...groove, extras: [...groove.extras, rollExtra(kind, rng)] };
}

export const removeExtra = (groove: Groove, id: string): Groove => ({ ...groove, extras: groove.extras.filter((extra) => extra.id !== id) });

/** Changes one extra track by id with `change`, leaving the others alone. */
export const withExtra = (groove: Groove, id: string, change: (extra: Extra) => Extra): Groove => ({ ...groove, extras: groove.extras.map((extra) => (extra.id === id ? change(extra) : extra)) });

// ---- The whole groove ------------------------------------------------------

export function rollGroove(rng: Rng, genre: Genre = "house"): Groove {
  const style = STYLES[genre];
  const sound = (track: TrackId): string => pick(rng, GENRE_FITS[genre][track]);
  return {
    genre,
    drums: rollDrums(rng, style),
    bass: rollNotes(rng, style.bass, STEPS_PER_BAR, 1),
    chords: rollChords(rng, style),
    melody: rollNotes(rng, style.melody, 2 * STEPS_PER_BAR, 2),
    sounds: { drums: sound("drums"), bass: sound("bass"), chords: sound("chords"), melody: sound("melody") },
    extras: [],
  };
}

const FLAT_KEYS = ["c", "des", "d", "es", "e", "f", "ges", "g", "as", "a", "b", "h"];
const SHARP_KEYS = ["c", "cis", "d", "dis", "e", "f", "fis", "g", "gis", "a", "ais", "h"];
const MOODS = ["staubig", "warm", "verschlafen", "samtig", "neblig", "golden", "verregnet", "körnig", "weich", "sonnig", "dämmrig", "milchig", "gemütlich", "verträumt", "rauchig", "mild"];

/** The key as musicians say it: "d-Moll", "d-Dorisch", "D-Dur". */
export function keyName(harmony: Harmony): string {
  const name = (usesSharps(harmony) ? SHARP_KEYS : FLAT_KEYS)[harmony.key]!;
  // Keys with a major third are written with a capital letter.
  return `${harmony.mode >= 2 ? name[0]!.toUpperCase() + name.slice(1) : name}-${MODES[harmony.mode]!.name}`;
}

/** A name for the logbook, like "staubig, d-Moll". The same groove always gets the same name. */
export function grooveName(groove: Groove): string {
  let hash = 0;
  for (const char of JSON.stringify(groove)) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `${MOODS[Math.abs(hash) % MOODS.length]}, ${keyName(groove.chords)}`;
}

type Fields = Record<string, unknown>;
const whole = (value: unknown, low: number, high: number): value is number => Number.isInteger(value) && (value as number) >= low && (value as number) <= high;
const unit = (value: unknown): boolean => typeof value === "number" && value >= 0 && value <= 1;
const listOf = (value: unknown, item: (fields: Fields) => boolean, least = 0): boolean =>
  Array.isArray(value) && value.length >= least && value.every((entry) => entry !== null && typeof entry === "object" && item(entry as Fields));

/**
 * Checks something read from storage and returns it as a groove the engine
 * can play and the mutations can work on, or null. Grooves stored before
 * moods and instruments existed get the ones they were played with, and
 * instruments stored by number get the instrument that number meant.
 */
export function readGroove(value: unknown): Groove | null {
  if (value === null || typeof value !== "object") return null;
  const { genre, drums, bass, chords, melody, sounds, extras } = value as Fields;
  if (chords === null || typeof chords !== "object") return null;
  const { key, mode, bars, stabs } = chords as Fields;
  const line = (notes: unknown, steps: number): boolean =>
    listOf(notes, (note) => whole(note.step, 0, steps - 1) && whole(note.len, 1, steps) && whole(note.tone, 0, 7) && unit(note.vel) && unit(note.min), 1);
  const sound = (track: TrackId): string => {
    const stored = sounds !== null && typeof sounds === "object" ? (sounds as Fields)[track] : undefined;
    if (typeof stored === "string" && instrumentsFor(track).includes(stored)) return stored;
    return FIRST_SOUNDS[track][whole(stored, 0, 2) ? stored : 0]!;
  };
  const playable =
    listOf(drums, (hit) => whole(hit.step, 0, DRUM_STEPS - 1) && DRUM_VOICES.includes(hit.voice as (typeof DRUM_VOICES)[number]) && unit(hit.vel) && unit(hit.min)) &&
    line(bass, BASS_STEPS) &&
    line(melody, LOOP_STEPS) &&
    whole(key, 0, 11) &&
    listOf(bars, (chord) => whole(chord.degree, 0, 6) && whole(chord.inversion, 0, 2) && typeof chord.ninth === "boolean", 4) &&
    (bars as unknown[]).length === 4 &&
    listOf(stabs, (stab) => whole(stab.step, 0, STAB_STEPS - 1) && whole(stab.len, 1, STAB_STEPS) && unit(stab.min));
  if (!playable) return null;
  return {
    // Grooves from before the genres are house.
    genre: GENRES.includes(genre as Genre) ? (genre as Genre) : "house",
    drums: drums as Hit[],
    bass: bass as Note[],
    chords: { key: key as number, mode: whole(mode, 0, MODES.length - 1) ? mode : 0, bars: bars as Chord[], stabs: stabs as Stab[] },
    melody: melody as Note[],
    sounds: { drums: sound("drums"), bass: sound("bass"), chords: sound("chords"), melody: sound("melody") },
    extras: readExtras(extras, line),
  };
}

/** The extra tracks of a stored groove: the playable ones, at most four, each id once. Grooves from before extras have none. */
function readExtras(value: unknown, line: (notes: unknown, steps: number) => boolean): Extra[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const extras: Extra[] = [];
  for (const entry of value as unknown[]) {
    if (entry === null || typeof entry !== "object") continue;
    const { id, kind, sound, level, hits, notes } = entry as Fields;
    if (typeof id !== "string" || !/^x[0-9a-z]{1,8}$/.test(id) || seen.has(id) || !EXTRA_KINDS.includes(kind as ExtraKind)) continue;
    const extraKind = kind as ExtraKind;
    const steps = EXTRA_STEPS[extraKind];
    const pattern =
      extraKind === "perkussion"
        ? listOf(hits, (hit) => whole(hit.step, 0, steps - 1) && PERC_VOICES.includes(hit.voice as (typeof PERC_VOICES)[number]) && unit(hit.vel) && unit(hit.min), 1)
        : line(notes, steps);
    if (!pattern) continue;
    const role = EXTRA_ROLES[extraKind];
    seen.add(id);
    extras.push({
      id,
      kind: extraKind,
      sound: typeof sound === "string" && instrumentsFor(role).includes(sound) ? sound : EXTRA_FITS[extraKind][0]!,
      level: whole(level, 0, 100) ? level : 80,
      ...(extraKind === "perkussion" ? { hits: hits as Hit[] } : { notes: notes as Note[] }),
    } as Extra);
    if (TRACKS.length + extras.length >= MAX_TRACKS) break;
  }
  return extras;
}

const MUTATORS: Record<TrackId, (groove: Groove, rng: Rng) => boolean> = {
  drums: (groove, rng) => mutateDrums(groove.drums, rng, STYLES[groove.genre].drums),
  bass: (groove, rng) => mutateNotes(groove.bass, rng, STYLES[groove.genre].bass),
  chords: (groove, rng) => mutateChords(groove.chords, rng, STYLES[groove.genre]),
  melody: (groove, rng) => mutateNotes(groove.melody, rng, STYLES[groove.genre].melody),
};

/**
 * The groove in another genre: drums, bass, melody and the chords' rhythm
 * start anew in its style, with instruments that suit it; key, mood and
 * progression stay, and so do held tracks and the extra tracks.
 */
export function switchGenre(groove: Groove, genre: Genre, rng: Rng, held: ReadonlySet<string> = new Set()): Groove {
  if (groove.genre === genre) return groove;
  const fresh = rollGroove(rng, genre);
  const keep = (track: TrackId): boolean => held.has(track);
  return {
    ...groove,
    genre,
    drums: keep("drums") ? groove.drums : fresh.drums,
    bass: keep("bass") ? groove.bass : fresh.bass,
    melody: keep("melody") ? groove.melody : fresh.melody,
    chords: keep("chords") ? groove.chords : { ...groove.chords, stabs: fresh.chords.stabs },
    sounds: { drums: keep("drums") ? groove.sounds.drums : fresh.sounds.drums, bass: keep("bass") ? groove.sounds.bass : fresh.sounds.bass, chords: keep("chords") ? groove.sounds.chords : fresh.sounds.chords, melody: keep("melody") ? groove.sounds.melody : fresh.sounds.melody },
  };
}

/**
 * Returns a copy of the groove with a fresh pattern on one track (a core
 * track or an extra's id). New chords take the others along; the mood, the
 * instruments and an extra's level stay.
 */
export function roll(groove: Groove, track: string, rng: Rng): Groove {
  if (!isCore(track)) return withExtra(groove, track, (extra) => ({ ...extra, ...rollPattern(extra.kind, rng) }) as Extra);
  const fresh = rollGroove(rng, groove.genre);
  return track === "chords" ? { ...groove, chords: { ...fresh.chords, mode: groove.chords.mode } } : { ...groove, [track]: fresh[track] };
}

/** Returns a copy of the groove with one small change on one of `tracks` (core tracks or extras' ids, at least one), and says which. */
export function mutate(groove: Groove, rng: Rng, tracks: readonly string[] = trackIds(groove)): { groove: Groove; track: string } {
  // An attempt can come up empty (a full bar, a place already taken); the next one succeeds soon enough.
  for (;;) {
    const track = pick(rng, tracks);
    const next = structuredClone(groove);
    const extra = next.extras.find((candidate) => candidate.id === track);
    if (isCore(track) ? MUTATORS[track](next, rng) : extra !== undefined && mutateExtra(extra, rng)) return { groove: next, track };
  }
}

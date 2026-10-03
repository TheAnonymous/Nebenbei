import { FITS, KITS, PATCHES } from "../audio/instruments";

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

export const DRUM_VOICES = ["kick", "clap", "hat", "open", "shaker", "rim"] as const;
export type DrumVoice = (typeof DRUM_VOICES)[number];

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
  drums: Hit[];
  bass: Note[];
  /** One chord per bar, one bar of stab rhythm. */
  chords: Harmony & { bars: Chord[]; stabs: Stab[] };
  melody: Note[];
  /** The instrument of each track: a kit for the drums, an instrument (audio/instruments.ts) for the others. */
  sounds: Record<TrackId, string>;
}

/** Everything that can play a track: the kits for the drums, every instrument for the others. */
export const instrumentsFor = (track: TrackId): readonly string[] => (track === "drums" ? Object.keys(KITS) : Object.keys(PATCHES));

/** The instrument after `current` among those that suit the track best. */
export function nextInstrument(track: TrackId, current: string): string {
  const fits = FITS[track];
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

export function feelOf(mode: number): Feel {
  const happy = mode / (MODES.length - 1);
  return { tempo: 104 + 22 * happy, swing: 0.08 + 0.12 * happy, brightness: 0.7 + 0.6 * happy, space: 1.5 - 0.8 * happy, punch: 0.85 + 0.2 * happy, wait: 1.25 - 0.5 * happy, melodyLow: [55, 58, 60, 63, 65][mode]! };
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

/** Kick on every quarter, clap on two and four, hats off the beat, a shaker in eighths. Mutations never touch these. */
function backbone(): Hit[] {
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

/** The hits that may come and go around the backbone: where in a bar, how loud, from which energy, how many at most. */
const DRUM_EXTRAS: readonly { voice: DrumVoice; steps: readonly number[]; vel: number; min: number; max: number }[] = [
  { voice: "kick", steps: [3, 7, 10, 11, 14, 15], vel: 0.5, min: 0.7, max: 3 },
  { voice: "hat", steps: [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15], vel: 0.35, min: 0.5, max: 14 },
  { voice: "open", steps: [2, 6, 10, 14], vel: 0.5, min: 0.65, max: 6 },
  { voice: "shaker", steps: [1, 3, 5, 7, 9, 11, 13, 15], vel: 0.2, min: 0.3, max: 10 },
  { voice: "rim", steps: [3, 6, 7, 10, 11, 13, 15], vel: 0.5, min: 0.55, max: 5 },
];

/** Adds an extra hit, or takes away the one that is already there. */
function mutateDrums(hits: Hit[], rng: Rng): boolean {
  const extra = pick(rng, DRUM_EXTRAS);
  const step = pick(rng, extra.steps) + STEPS_PER_BAR * Math.floor(rng() * (DRUM_STEPS / STEPS_PER_BAR));
  const at = hits.findIndex((hit) => hit.voice === extra.voice && hit.step === step);
  if (at >= 0) {
    hits.splice(at, 1);
    return true;
  }
  const present = hits.filter((hit) => hit.voice === extra.voice && extra.steps.includes(hit.step % STEPS_PER_BAR));
  if (present.length >= extra.max) return false;
  hits.push({ step, voice: extra.voice, vel: between(rng, extra.vel * 0.7, extra.vel * 1.1), min: between(rng, extra.min, Math.min(0.95, extra.min + 0.25)) });
  return true;
}

function rollDrums(rng: Rng): Hit[] {
  const hits = backbone();
  for (let n = 0; n < 40; n += 1) mutateDrums(hits, rng);
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
const PROGRESSIONS: readonly (readonly number[])[] = [
  [0, 5, 2, 6],
  [0, 3, 5, 4],
  [5, 6, 0, 0],
  [0, 0, 3, 3],
  [3, 6, 2, 5],
  [0, 2, 5, 4],
  [0, 6, 5, 6],
  [5, 4, 0, 0],
];
const STAB_GRID = [0, 3, 6, 8, 10, 11, 14];
const MAX_STABS = 5;

function addStab(stabs: Stab[], rng: Rng): boolean {
  const step = pick(rng, STAB_GRID);
  if (stabs.some((stab) => stab.step === step)) return false;
  // The first stab comes in early, so the chords get a rhythm as soon as the kick is there.
  stabs.push({ step, len: pick(rng, [1, 2, 2, 3]), min: stabs.length ? between(rng, 0.4, 0.7) : 0.35 });
  return true;
}

/** One small change: a chord moves to another inversion, gains or loses its ninth, the rhythm shifts, or (rarely) a chord gives way to a relative. */
function mutateChords(chords: Groove["chords"], rng: Rng): boolean {
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
    return chords.stabs.length < MAX_STABS && addStab(chords.stabs, rng);
  }
  // The chord a third above or below shares three of the four notes.
  chord.degree = (chord.degree + pick(rng, [2, 5])) % 7;
  return true;
}

function rollChords(rng: Rng): Groove["chords"] {
  const stabs: Stab[] = [];
  const want = 2 + Math.floor(rng() * 3);
  while (stabs.length < want) addStab(stabs, rng);
  return {
    key: Math.floor(rng() * 12),
    // A fresh groove starts in minor or dorian, where Lo-Fi-House is at home.
    mode: Math.floor(rng() * 2),
    bars: pick(rng, PROGRESSIONS).map((degree) => ({ degree, inversion: Math.floor(rng() * 3), ninth: rng() < 0.5 })),
    stabs,
  };
}

/**
 * The answer to a four-bar progression, so that two passes make eight bars:
 * it starts the same, moves its third chord a third down (three of four
 * notes stay) and turns its last one towards the fifth, which leads home.
 */
export function turnaround(bars: readonly Chord[]): Chord[] {
  const [first, second, third, fourth] = bars as [Chord, Chord, Chord, Chord];
  return [first, second, { ...third, degree: (third.degree + 5) % 7 }, { ...fourth, degree: fourth.degree === 4 ? 6 : 4 }];
}

// ---- The whole groove ------------------------------------------------------

export function rollGroove(rng: Rng): Groove {
  const sound = (track: TrackId): string => pick(rng, FITS[track]);
  return {
    drums: rollDrums(rng),
    bass: rollNotes(rng, BASS, STEPS_PER_BAR, 1),
    chords: rollChords(rng),
    melody: rollNotes(rng, MELODY, 2 * STEPS_PER_BAR, 2),
    sounds: { drums: sound("drums"), bass: sound("bass"), chords: sound("chords"), melody: sound("melody") },
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
  const { drums, bass, chords, melody, sounds } = value as Fields;
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
    listOf(drums, (hit) => whole(hit.step, 0, DRUM_STEPS - 1) && DRUM_VOICES.includes(hit.voice as DrumVoice) && unit(hit.vel) && unit(hit.min)) &&
    line(bass, BASS_STEPS) &&
    line(melody, LOOP_STEPS) &&
    whole(key, 0, 11) &&
    listOf(bars, (chord) => whole(chord.degree, 0, 6) && whole(chord.inversion, 0, 2) && typeof chord.ninth === "boolean", 4) &&
    (bars as unknown[]).length === 4 &&
    listOf(stabs, (stab) => whole(stab.step, 0, STAB_STEPS - 1) && whole(stab.len, 1, STAB_STEPS) && unit(stab.min));
  if (!playable) return null;
  return {
    drums: drums as Hit[],
    bass: bass as Note[],
    chords: { key: key as number, mode: whole(mode, 0, MODES.length - 1) ? mode : 0, bars: bars as Chord[], stabs: stabs as Stab[] },
    melody: melody as Note[],
    sounds: { drums: sound("drums"), bass: sound("bass"), chords: sound("chords"), melody: sound("melody") },
  };
}

const MUTATORS: Record<TrackId, (groove: Groove, rng: Rng) => boolean> = {
  drums: (groove, rng) => mutateDrums(groove.drums, rng),
  bass: (groove, rng) => mutateNotes(groove.bass, rng, BASS),
  chords: (groove, rng) => mutateChords(groove.chords, rng),
  melody: (groove, rng) => mutateNotes(groove.melody, rng, MELODY),
};

/** Returns a copy of the groove with a fresh pattern on one track. New chords take bass and melody along; the mood and the instruments stay. */
export function roll(groove: Groove, track: TrackId, rng: Rng): Groove {
  const fresh = rollGroove(rng);
  return track === "chords" ? { ...groove, chords: { ...fresh.chords, mode: groove.chords.mode } } : { ...groove, [track]: fresh[track] };
}

/** Returns a copy of the groove with one small change on one of `tracks` (at least one), and says which. */
export function mutate(groove: Groove, rng: Rng, tracks: readonly TrackId[] = TRACKS): { groove: Groove; track: TrackId } {
  // An attempt can come up empty (a full bar, a place already taken); the next one succeeds soon enough.
  for (;;) {
    const track = pick(rng, tracks);
    const next = structuredClone(groove);
    if (MUTATORS[track](next, rng)) return { groove: next, track };
  }
}

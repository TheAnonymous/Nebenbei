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

/** `degree` is the step of the minor scale the chord stands on, `inversion` (0..2) how high it is voiced. */
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

export interface Groove {
  drums: Hit[];
  bass: Note[];
  /** `key` is the pitch class of the minor key (0 = C); one chord per bar, one bar of stab rhythm. */
  chords: { key: number; bars: Chord[]; stabs: Stab[] };
  melody: Note[];
}

const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;
const between = (rng: Rng, low: number, high: number): number => Math.round((low + rng() * (high - low)) * 100) / 100;

// ---- Pitches ---------------------------------------------------------------

const MINOR = [0, 2, 3, 5, 7, 8, 10];

/** Semitones above the key note for a step of the minor scale (7 is the octave). */
const scaleStep = (step: number): number => 12 * Math.floor(step / 7) + MINOR[((step % 7) + 7) % 7]!;

/** Moves a pitch by octaves into the twelve semitones from `low` upwards. */
const fold = (pitch: number, low: number): number => low + ((((pitch - low) % 12) + 12) % 12);

/** A ninth only where it lies a whole tone above the root; a semitone above would grate. */
const hasNinth = (chord: Chord): boolean => chord.ninth && scaleStep(chord.degree + 1) - scaleStep(chord.degree) === 2;

/**
 * The MIDI pitches of a chord, all folded into one octave so that changes
 * move the voices as little as possible. With a ninth the root is left to
 * the bass.
 */
export function chordPitches(key: number, chord: Chord): number[] {
  const low = 52 + [0, 3, 5][chord.inversion]!;
  return (hasNinth(chord) ? [2, 4, 6, 8] : [0, 2, 4, 6]).map((third) => fold(key + scaleStep(chord.degree + third), low)).sort((a, b) => a - b);
}

/** The MIDI pitch of a bass or melody note over a chord; the chord's root lies in the octave from `low`. */
export function tonePitch(key: number, chord: Chord, tone: number, low: number): number {
  const root = scaleStep(chord.degree);
  return fold(key + root, low) + scaleStep(chord.degree + 2 * (tone % 4)) - root + 12 * Math.floor(tone / 4);
}

// B flat and H as on German lead sheets; sharps in the keys that are written with sharps.
const FLAT_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "H"];
const SHARP_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "H"];
/** c sharp, e, f sharp, g sharp, a and b minor. */
const SHARP_KEYS = [1, 4, 6, 8, 9, 11];
const QUALITIES = ["m7", "m7♭5", "maj7", "m7", "m7", "maj7", "7"];

export function chordName(key: number, chord: Chord): string {
  const quality = QUALITIES[chord.degree]!;
  return (SHARP_KEYS.includes(key) ? SHARP_NAMES : FLAT_NAMES)[(key + scaleStep(chord.degree)) % 12]! + (hasNinth(chord) ? quality.replace("7", "9") : quality);
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

/** Four bars each, as steps of the minor scale (0 = i, 2 = III, 3 = iv, 4 = v, 5 = VI, 6 = VII). */
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
    return hasNinth({ ...chord, ninth: true });
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
  const degree = (chord.degree + pick(rng, [2, 5])) % 7;
  if (degree === 1) return false; // the diminished chord stays out
  chord.degree = degree;
  return true;
}

function rollChords(rng: Rng): Groove["chords"] {
  const stabs: Stab[] = [];
  const want = 2 + Math.floor(rng() * 3);
  while (stabs.length < want) addStab(stabs, rng);
  return {
    key: Math.floor(rng() * 12),
    bars: pick(rng, PROGRESSIONS).map((degree) => ({ degree, inversion: Math.floor(rng() * 3), ninth: rng() < 0.5 })),
    stabs,
  };
}

// ---- The whole groove ------------------------------------------------------

const KEY_NAMES = ["c", "cis", "d", "es", "e", "f", "fis", "g", "gis", "a", "b", "h"];
const MOODS = ["staubig", "warm", "verschlafen", "samtig", "neblig", "golden", "verregnet", "körnig", "weich", "sonnig", "dämmrig", "milchig", "gemütlich", "verträumt", "rauchig", "mild"];

/** A name for the logbook, like "staubig, d-Moll". The same groove always gets the same name. */
export function grooveName(groove: Groove): string {
  let hash = 0;
  for (const char of JSON.stringify(groove)) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `${MOODS[Math.abs(hash) % MOODS.length]}, ${KEY_NAMES[groove.chords.key]}-Moll`;
}

type Fields = Record<string, unknown>;
const whole = (value: unknown, low: number, high: number): boolean => Number.isInteger(value) && (value as number) >= low && (value as number) <= high;
const unit = (value: unknown): boolean => typeof value === "number" && value >= 0 && value <= 1;
const listOf = (value: unknown, item: (fields: Fields) => boolean, least = 0): boolean =>
  Array.isArray(value) && value.length >= least && value.every((entry) => entry !== null && typeof entry === "object" && item(entry as Fields));

/** Whether something read from storage is a groove the engine can play and the mutations can work on. */
export function isGroove(value: unknown): value is Groove {
  if (value === null || typeof value !== "object") return false;
  const { drums, bass, chords, melody } = value as Fields;
  if (chords === null || typeof chords !== "object") return false;
  const { key, bars, stabs } = chords as Fields;
  const line = (notes: unknown, steps: number): boolean =>
    listOf(notes, (note) => whole(note.step, 0, steps - 1) && whole(note.len, 1, steps) && whole(note.tone, 0, 7) && unit(note.vel) && unit(note.min), 1);
  return (
    listOf(drums, (hit) => whole(hit.step, 0, DRUM_STEPS - 1) && DRUM_VOICES.includes(hit.voice as DrumVoice) && unit(hit.vel) && unit(hit.min)) &&
    line(bass, BASS_STEPS) &&
    line(melody, LOOP_STEPS) &&
    whole(key, 0, 11) &&
    listOf(bars, (chord) => whole(chord.degree, 0, 6) && whole(chord.inversion, 0, 2) && typeof chord.ninth === "boolean", 4) &&
    (bars as unknown[]).length === 4 &&
    listOf(stabs, (stab) => whole(stab.step, 0, STAB_STEPS - 1) && whole(stab.len, 1, STAB_STEPS) && unit(stab.min))
  );
}

export function rollGroove(rng: Rng): Groove {
  return { drums: rollDrums(rng), bass: rollNotes(rng, BASS, STEPS_PER_BAR, 1), chords: rollChords(rng), melody: rollNotes(rng, MELODY, 2 * STEPS_PER_BAR, 2) };
}

const MUTATORS: Record<TrackId, (groove: Groove, rng: Rng) => boolean> = {
  drums: (groove, rng) => mutateDrums(groove.drums, rng),
  bass: (groove, rng) => mutateNotes(groove.bass, rng, BASS),
  chords: (groove, rng) => mutateChords(groove.chords, rng),
  melody: (groove, rng) => mutateNotes(groove.melody, rng, MELODY),
};

/** Returns a copy of the groove with a fresh pattern on one track. New chords take bass and melody along. */
export function roll(groove: Groove, track: TrackId, rng: Rng): Groove {
  return { ...groove, [track]: rollGroove(rng)[track] };
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

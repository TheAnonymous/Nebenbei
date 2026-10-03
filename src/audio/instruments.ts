import type { TrackId } from "../music/groove";

/*
 * The instruments, as data: the engine plays every one of them with the same
 * small synthesizer. Any instrument can go on bass, chords or melody; the
 * drums have their own kits. `level` is for one note played as a melody; the
 * engine evens out the roles (a bass note, a chord of four). The levels were
 * set by measuring loudness (K-weighted, as LUFS does) on each instrument's
 * home track: held sounds a little louder than plucked ones, which carry by
 * their attack.
 */

export interface Kit {
  name: string;
  /** Fall and length of the kick; `click` adds a short noise on top. */
  kick: { from: number; to: number; drop: number; attack: number; decay: number; level: number; click: number };
  clap: { tone: number; decay: number; level: number };
  hat: { tone: number; decay: number; level: number };
  open: { decay: number; level: number };
  rim: { tone: number; level: number };
}

export interface Wave {
  type: OscillatorType;
  /** Frequency as a multiple of the note's. */
  ratio?: number;
  /** In cents. */
  detune?: number;
  level?: number;
}

export interface Patch {
  name: string;
  group: string;
  waves: readonly Wave[];
  level: number;
  /** `hold` in seconds makes a pluck that ignores the note's length; without it the note is held. */
  amp: { attack: number; hold?: number; release: number };
  /**
   * The cutoff settles at `to + open × energy` (times the note's frequency when
   * `relative`), after starting `peak` times higher and falling within `decay`.
   */
  filter?: { type?: BiquadFilterType; to: number; open?: number; peak?: number; decay?: number; q: number; relative?: boolean };
  /** A second sine bends the first: its depth, as a multiple of the note's frequency, falls from `from + open × energy` to `to`. */
  fm?: { ratio: number; from: number; open?: number; to: number; decay: number };
  /** Depth in cents, coming in after `delay` seconds. */
  vibrato?: { rate: number; depth: number; delay: number };
  /** The level dips by `depth` (0..1) `rate` times a second. */
  tremolo?: { rate: number; depth: number };
}

export const KITS: Record<string, Kit> = {
  staubig: { name: "Staubig", kick: { from: 125, to: 45, drop: 0.1, attack: 0.002, decay: 0.25, level: 0.6, click: 0 }, clap: { tone: 1300, decay: 0.2, level: 1 }, hat: { tone: 7500, decay: 0.05, level: 0.35 }, open: { decay: 0.3, level: 0.24 }, rim: { tone: 900, level: 0.35 } },
  knackig: { name: "Knackig", kick: { from: 190, to: 50, drop: 0.05, attack: 0.001, decay: 0.2, level: 0.62, click: 0.2 }, clap: { tone: 1900, decay: 0.16, level: 1.15 }, hat: { tone: 9000, decay: 0.035, level: 0.42 }, open: { decay: 0.22, level: 0.28 }, rim: { tone: 1250, level: 0.4 } },
  weich: { name: "Weich", kick: { from: 95, to: 42, drop: 0.12, attack: 0.006, decay: 0.3, level: 0.52, click: 0 }, clap: { tone: 950, decay: 0.09, level: 0.6 }, hat: { tone: 6000, decay: 0.07, level: 0.22 }, open: { decay: 0.35, level: 0.14 }, rim: { tone: 620, level: 0.25 } },
  tr808: { name: "808", kick: { from: 70, to: 47, drop: 0.08, attack: 0.002, decay: 0.55, level: 0.6, click: 0 }, clap: { tone: 1100, decay: 0.25, level: 0.95 }, hat: { tone: 8500, decay: 0.04, level: 0.3 }, open: { decay: 0.4, level: 0.2 }, rim: { tone: 1700, level: 0.32 } },
  tr909: { name: "909", kick: { from: 220, to: 52, drop: 0.035, attack: 0.001, decay: 0.22, level: 0.64, click: 0.3 }, clap: { tone: 1500, decay: 0.22, level: 1.2 }, hat: { tone: 10000, decay: 0.045, level: 0.45 }, open: { decay: 0.35, level: 0.32 }, rim: { tone: 1000, level: 0.4 } },
  kiste: { name: "Kiste", kick: { from: 110, to: 60, drop: 0.04, attack: 0.004, decay: 0.12, level: 0.55, click: 0 }, clap: { tone: 800, decay: 0.07, level: 0.7 }, hat: { tone: 4500, decay: 0.03, level: 0.25 }, open: { decay: 0.15, level: 0.12 }, rim: { tone: 520, level: 0.3 } },
};

/** The order of the groups in the instrument menu. */
export const GROUPS = ["Bass", "Tasten", "Flächen", "Glocken & Hölzer", "Melodie"] as const;

export const PATCHES: Record<string, Patch> = {
  sub: { name: "Sub", group: "Bass", waves: [{ type: "sine" }, { type: "triangle", level: 0.35 }], level: 0.177, amp: { attack: 0.01, release: 0.12 } },
  rund: { name: "Rund", group: "Bass", waves: [{ type: "sawtooth" }], level: 0.213, amp: { attack: 0.008, release: 0.12 }, filter: { to: 3, peak: 2.3, decay: 0.1, q: 2, relative: true } },
  reese: { name: "Reese", group: "Bass", waves: [{ type: "sawtooth", detune: -14 }, { type: "sawtooth", detune: 14 }], level: 0.164, amp: { attack: 0.01, release: 0.1 }, filter: { to: 4, q: 1.2, relative: true } },
  kontrabass: { name: "Kontrabass", group: "Bass", waves: [{ type: "triangle" }, { type: "sine", ratio: 2, level: 0.25 }], level: 0.29, amp: { attack: 0.006, hold: 0.06, release: 0.35 }, filter: { to: 2.5, peak: 3, decay: 0.08, q: 0.8, relative: true } },
  kantig: { name: "Kantig", group: "Bass", waves: [{ type: "square" }], level: 0.28, amp: { attack: 0.003, hold: 0.02, release: 0.3 }, filter: { to: 2, peak: 6, decay: 0.05, q: 1, relative: true } },
  epiano: { name: "E-Piano", group: "Tasten", waves: [{ type: "sine" }], level: 0.185, amp: { attack: 0.004, release: 0.5 }, fm: { ratio: 1, from: 1, open: 2, to: 0.3, decay: 0.12 } },
  kassettenpiano: { name: "Kassettenpiano", group: "Tasten", waves: [{ type: "sine" }], level: 0.17, amp: { attack: 0.004, release: 0.6 }, fm: { ratio: 1, from: 0.8, open: 1.5, to: 0.25, decay: 0.15 }, vibrato: { rate: 0.7, depth: 16, delay: 0 } },
  orgel: { name: "Orgel", group: "Tasten", waves: [{ type: "sine" }, { type: "sine", ratio: 2, level: 0.6 }, { type: "sine", ratio: 3, level: 0.3 }], level: 0.13, amp: { attack: 0.003, release: 0.08 }, filter: { to: 1200, open: 4000, q: 0.7 } },
  m1orgel: { name: "House-Orgel", group: "Tasten", waves: [{ type: "square" }, { type: "sine", ratio: 2, level: 0.5 }], level: 0.19, amp: { attack: 0.002, hold: 0.09, release: 0.2 }, filter: { to: 900, open: 2500, peak: 2.5, decay: 0.12, q: 1 } },
  clav: { name: "Clavinet", group: "Tasten", waves: [{ type: "square" }, { type: "sawtooth", ratio: 2, level: 0.3 }], level: 0.32, amp: { attack: 0.001, hold: 0.03, release: 0.15 }, filter: { to: 3, peak: 4, decay: 0.04, q: 3, relative: true } },
  saege: { name: "Säge", group: "Flächen", waves: [{ type: "sawtooth", detune: -7 }, { type: "sawtooth", detune: 7 }], level: 0.19, amp: { attack: 0.006, release: 0.3 }, filter: { to: 500, open: 2600, peak: 1.8, decay: 0.08, q: 1.5 } },
  streicher: { name: "Streicher", group: "Flächen", waves: [{ type: "sawtooth", detune: -9 }, { type: "sawtooth", level: 0.7 }, { type: "sawtooth", detune: 11 }], level: 0.19, amp: { attack: 0.25, release: 0.7 }, filter: { to: 1400, open: 1200, q: 0.6 }, vibrato: { rate: 4.5, depth: 6, delay: 0.4 } },
  chor: { name: "Chor", group: "Flächen", waves: [{ type: "sawtooth", detune: -6 }, { type: "sawtooth", detune: 6 }], level: 0.45, amp: { attack: 0.18, release: 0.5 }, filter: { type: "bandpass", to: 900, open: 300, q: 2.5 }, vibrato: { rate: 5, depth: 8, delay: 0.2 } },
  glocke: { name: "Glocke", group: "Glocken & Hölzer", waves: [{ type: "sine" }], level: 0.2, amp: { attack: 0.004, hold: 0.02, release: 0.6 }, fm: { ratio: 2, from: 1.2, to: 0, decay: 0.08 } },
  glasharfe: { name: "Glasharfe", group: "Glocken & Hölzer", waves: [{ type: "sine" }], level: 0.118, amp: { attack: 0.01, release: 1.2 }, fm: { ratio: 3.5, from: 0.8, to: 0.1, decay: 0.3 } },
  vibraphon: { name: "Vibraphon", group: "Glocken & Hölzer", waves: [{ type: "sine" }, { type: "sine", ratio: 4, level: 0.12 }], level: 0.235, amp: { attack: 0.003, hold: 0.05, release: 1.1 }, tremolo: { rate: 5.5, depth: 0.35 } },
  marimba: { name: "Marimba", group: "Glocken & Hölzer", waves: [{ type: "sine" }, { type: "sine", ratio: 4, level: 0.25 }], level: 0.31, amp: { attack: 0.002, hold: 0.01, release: 0.22 } },
  kalimba: { name: "Kalimba", group: "Glocken & Hölzer", waves: [{ type: "sine" }], level: 0.23, amp: { attack: 0.002, hold: 0.01, release: 0.5 }, fm: { ratio: 3, from: 0.6, to: 0, decay: 0.05 } },
  floete: { name: "Flöte", group: "Melodie", waves: [{ type: "triangle" }], level: 0.18, amp: { attack: 0.05, release: 0.3 }, filter: { to: 2400, q: 0.7 }, vibrato: { rate: 5.2, depth: 10, delay: 0.3 } },
  pfiff: { name: "Pfiff", group: "Melodie", waves: [{ type: "sine" }], level: 0.145, amp: { attack: 0.03, release: 0.15 }, vibrato: { rate: 6, depth: 14, delay: 0.15 } },
  gezupft: { name: "Gezupft", group: "Melodie", waves: [{ type: "sawtooth" }], level: 0.29, amp: { attack: 0.002, hold: 0.02, release: 0.45 }, filter: { to: 1.5, peak: 5.3, decay: 0.06, q: 2, relative: true } },
  gameboy: { name: "Gameboy", group: "Melodie", waves: [{ type: "square" }], level: 0.09, amp: { attack: 0.002, release: 0.06 }, filter: { to: 5000, q: 0.5 } },
};

/** The instruments that suit a track best: a fresh groove picks from these, and Q, W, E, R step through them. */
export const FITS: Record<TrackId, readonly string[]> = {
  drums: Object.keys(KITS),
  bass: ["sub", "rund", "reese", "kontrabass", "kantig", "clav"],
  chords: ["saege", "epiano", "kassettenpiano", "orgel", "m1orgel", "clav", "streicher", "chor", "vibraphon", "glasharfe"],
  melody: ["glocke", "glasharfe", "vibraphon", "marimba", "kalimba", "floete", "pfiff", "gezupft", "gameboy", "kassettenpiano", "streicher", "chor"],
};

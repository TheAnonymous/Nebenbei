import type { Effects, Levels } from "./audio/effects";
import { readEffects, readLevels } from "./audio/effects";
import type { Day } from "./day";
import { parseDay } from "./day";
import type { Groove, TrackId } from "./music/groove";
import { readGroove, TRACKS } from "./music/groove";

/*
 * What the browser keeps between visits: the groove that is playing, the
 * logbook and the day strip. Everything read back is checked first; an older version or a
 * broken entry must not stop the music.
 */

export interface Entry {
  /** When it was logged, in milliseconds since 1970. */
  at: number;
  name: string;
  groove: Groove;
}

/** `kept` are the grooves remembered on purpose; `trail` are the ones logged before each roll, newest last. */
export interface Logbook {
  kept: Entry[];
  trail: Entry[];
}

export interface Session {
  groove: Groove;
  energy: number;
  volume: number;
  held: TrackId[];
  effects: Effects;
  /** The level of each track, 0..100. */
  levels: Levels;
  /** Whether the DJ plays the effects. */
  dj: boolean;
}

const LOGBOOK_KEY = "nebenbei.logbuch";
const SESSION_KEY = "nebenbei.jetzt";
const DAY_KEY = "nebenbei.tag";

function parse(json: string | null): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(json ?? "null");
    return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The entries of a stored list that still hold a playable groove. */
function readEntries(list: unknown): Entry[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((value: unknown) => {
    if (value === null || typeof value !== "object") return [];
    const { at, name } = value as Record<string, unknown>;
    const groove = readGroove((value as Record<string, unknown>).groove);
    return typeof at === "number" && typeof name === "string" && groove ? [{ at, name, groove }] : [];
  });
}

export function parseLogbook(json: string | null): Logbook {
  const { kept, trail } = parse(json);
  return { kept: readEntries(kept), trail: readEntries(trail) };
}

export function parseSession(json: string | null): Session | null {
  const { groove: stored, energy, volume, held, effects, levels, dj } = parse(json);
  const groove = readGroove(stored);
  if (!groove) return null;
  return {
    groove,
    energy: Number.isInteger(energy) && (energy as number) >= 0 && (energy as number) <= 10 ? (energy as number) : 5,
    volume: typeof volume === "number" && volume >= 0 && volume <= 100 ? volume : 80,
    held: Array.isArray(held) ? TRACKS.filter((track) => held.includes(track)) : [],
    effects: readEffects(effects),
    levels: readLevels(levels),
    dj: dj === true,
  };
}

// The browser may refuse storage altogether (private windows, a full disk).
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadLogbook = (): Logbook => parseLogbook(read(LOGBOOK_KEY));
export const loadSession = (): Session | null => parseSession(read(SESSION_KEY));
export const loadDay = (): Day => parseDay(read(DAY_KEY), new Date());
/** These return whether the browser took it. */
export const saveLogbook = (logbook: Logbook): boolean => write(LOGBOOK_KEY, logbook);
export const saveSession = (session: Session): boolean => write(SESSION_KEY, session);
export const saveDay = (day: Day): boolean => write(DAY_KEY, day);

import type { Groove, TrackId } from "./music/groove";
import { isGroove, TRACKS } from "./music/groove";

/*
 * What the browser keeps between visits: the groove that is playing, and the
 * logbook. Everything read back is checked first; an older version or a
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
}

const LOGBOOK_KEY = "nebenbei.logbuch";
const SESSION_KEY = "nebenbei.jetzt";

function parse(json: string | null): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(json ?? "null");
    return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const isEntry = (value: unknown): value is Entry => {
  if (value === null || typeof value !== "object") return false;
  const { at, name, groove } = value as Record<string, unknown>;
  return typeof at === "number" && typeof name === "string" && isGroove(groove);
};

export function parseLogbook(json: string | null): Logbook {
  const { kept, trail } = parse(json);
  return { kept: Array.isArray(kept) ? kept.filter(isEntry) : [], trail: Array.isArray(trail) ? trail.filter(isEntry) : [] };
}

export function parseSession(json: string | null): Session | null {
  const { groove, energy, volume, held } = parse(json);
  if (!isGroove(groove)) return null;
  return {
    groove,
    energy: Number.isInteger(energy) && (energy as number) >= 0 && (energy as number) <= 10 ? (energy as number) : 5,
    volume: typeof volume === "number" && volume >= 0 && volume <= 100 ? volume : 80,
    held: Array.isArray(held) ? TRACKS.filter((track) => held.includes(track)) : [],
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
/** Both return whether the browser took it. */
export const saveLogbook = (logbook: Logbook): boolean => write(LOGBOOK_KEY, logbook);
export const saveSession = (session: Session): boolean => write(SESSION_KEY, session);

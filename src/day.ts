/*
 * The day strip: what the music did over the working day, in five-minute
 * bins. Every morning starts a new one.
 */

/** One five-minute bin in which music played: its energy, how often the groove was nudged (rolled, brought back) and kept. */
export interface Bin {
  energy: number;
  nudges: number;
  kept: number;
}

/** `date` is the local day (2026-10-03); `bins` are counted from midnight. */
export interface Day {
  date: string;
  bins: Record<number, Bin>;
}

const BIN_MINUTES = 5;
const BINS_PER_HOUR = 60 / BIN_MINUTES;
const BINS_PER_DAY = 24 * BINS_PER_HOUR;
/** The strip shows at least two hours, so the first minutes do not fill the whole width. */
const MIN_BINS = 2 * BINS_PER_HOUR;

const dateOf = (now: Date): string => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const binOf = (now: Date): number => Math.floor((now.getHours() * 60 + now.getMinutes()) / BIN_MINUTES);

/**
 * The day with what happens right now: the energy that plays and, with
 * `event`, one more nudge or kept groove. A new date starts a new strip.
 * Returns the same object when nothing changed.
 */
export function noted(day: Day, now: Date, energy: number, event?: "nudge" | "keep"): Day {
  const date = dateOf(now);
  const bins = day.date === date ? day.bins : {};
  const index = binOf(now);
  const before = bins[index];
  if (bins === day.bins && before?.energy === energy && !event) return day;
  const bin = { energy, nudges: (before?.nudges ?? 0) + (event === "nudge" ? 1 : 0), kept: (before?.kept ?? 0) + (event === "keep" ? 1 : 0) };
  return { date, bins: { ...bins, [index]: bin } };
}

/** Reads a stored day back. Anything that is not today's strip, or is broken, gives an empty one. */
export function parseDay(json: string | null, now: Date): Day {
  const day: Day = { date: dateOf(now), bins: {} };
  try {
    const value = JSON.parse(json ?? "null") as { date?: unknown; bins?: unknown } | null;
    if (value?.date !== day.date || value.bins === null || typeof value.bins !== "object") return day;
    const count = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;
    for (const [key, bin] of Object.entries(value.bins as Record<string, Partial<Bin> | null>)) {
      const index = Number(key);
      if (count(index) && index < BINS_PER_DAY && bin && count(bin.energy) && bin.energy <= 10 && count(bin.nudges) && count(bin.kept)) {
        day.bins[index] = { energy: bin.energy, nudges: bin.nudges, kept: bin.kept };
      }
    }
  } catch {
    // Not JSON: an empty day.
  }
  return day;
}

export interface Strip {
  /** Clock times of the left and right end, like "9:10". */
  from: string;
  to: string;
  /** One entry per five minutes from the first music of the day; null where nothing played. */
  bins: (Bin | null)[];
  minutes: number;
  nudges: number;
  kept: number;
}

export function stripOf(day: Day): Strip | null {
  const indices = Object.keys(day.bins).map(Number);
  if (!indices.length) return null;
  const first = Math.min(...indices);
  const last = Math.max(...indices, first + MIN_BINS - 1);
  const clock = (index: number): string => `${Math.floor(index / BINS_PER_HOUR) % 24}:${String((index % BINS_PER_HOUR) * BIN_MINUTES).padStart(2, "0")}`;
  const played = Object.values(day.bins);
  return {
    from: clock(first),
    to: clock(last + 1),
    bins: Array.from({ length: last - first + 1 }, (_, offset) => day.bins[first + offset] ?? null),
    minutes: played.length * BIN_MINUTES,
    nudges: played.reduce((sum, bin) => sum + bin.nudges, 0),
    kept: played.reduce((sum, bin) => sum + bin.kept, 0),
  };
}

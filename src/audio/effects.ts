/** The effect controls: each 0..10, except the filter, which runs from -5 (dull) over 0 (off) to 5 (thin). */
export interface Effects {
  /** How much of chords, melody and clap goes into the room. */
  hall: number;
  /** The melody's echo: how loud, and how often it repeats. */
  echo: number;
  /** The tape: wobble, hiss and crackle, saturation. */
  tape: number;
  /** How deep everything ducks under the kick. */
  pump: number;
  filter: number;
}

export const EFFECT_RANGES: Record<keyof Effects, readonly [number, number]> = { hall: [0, 10], echo: [0, 10], tape: [0, 10], pump: [0, 10], filter: [-5, 5] };
export const DEFAULT_EFFECTS: Effects = { hall: 4, echo: 4, tape: 5, pump: 6, filter: 0 };

/** Effects read from storage: every value that is not a whole number in its range falls back to the default. */
export function readEffects(value: unknown): Effects {
  const stored = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const effects = { ...DEFAULT_EFFECTS };
  for (const name of Object.keys(effects) as (keyof Effects)[]) {
    const [low, high] = EFFECT_RANGES[name];
    const setting = stored[name];
    if (Number.isInteger(setting) && (setting as number) >= low && (setting as number) <= high) effects[name] = setting as number;
  }
  return effects;
}

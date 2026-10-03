import { expect, it } from "vitest";
import { noted, parseDay, stripOf } from "../src/day";

const at = (hours: number, minutes: number, day = 3): Date => new Date(2026, 9, day, hours, minutes);

it("collects the day in five-minute bins and starts over the next morning", () => {
  let day = parseDay(null, at(9, 12));
  expect(stripOf(day)).toBeNull();

  day = noted(day, at(9, 12), 5);
  // Nothing new: the very same object, so nothing is saved again.
  expect(noted(day, at(9, 14), 5)).toBe(day);
  day = noted(day, at(9, 14), 5, "nudge");
  day = noted(day, at(9, 14), 7, "nudge");
  day = noted(day, at(9, 31), 3, "keep");
  expect(day.bins).toEqual({ 110: { energy: 7, nudges: 2, kept: 0 }, 114: { energy: 3, nudges: 0, kept: 1 } });

  const strip = stripOf(day)!;
  // From the first music of the day, at least two hours wide; pauses are gaps.
  expect(strip).toMatchObject({ from: "9:10", to: "11:10", minutes: 10, nudges: 2, kept: 1 });
  expect(strip.bins).toHaveLength(24);
  expect(strip.bins.slice(0, 5)).toEqual([{ energy: 7, nudges: 2, kept: 0 }, null, null, null, { energy: 3, nudges: 0, kept: 1 }]);

  // A long day grows the strip to the right.
  expect(stripOf(noted(day, at(17, 44), 6))).toMatchObject({ from: "9:10", to: "17:45", minutes: 15 });

  // What was stored survives the same day and is gone the next.
  expect(parseDay(JSON.stringify(day), at(18, 0))).toEqual(day);
  expect(parseDay(JSON.stringify(day), at(8, 0, 4)).bins).toEqual({});
  expect(noted(day, at(8, 0, 4), 4)).toEqual({ date: "2026-10-04", bins: { 96: { energy: 4, nudges: 0, kept: 0 } } });
});

it("drops broken bins when reading the day back", () => {
  const now = at(12, 0);
  const good = { energy: 4, nudges: 1, kept: 0 };
  const stored = { date: "2026-10-03", bins: { 100: good, 101: { energy: 99, nudges: 0, kept: 0 }, 999: good, x: good, 102: null, 103: { energy: 2 } } };
  expect(parseDay(JSON.stringify(stored), now)).toEqual({ date: "2026-10-03", bins: { 100: good } });
  expect(parseDay("{", now)).toEqual({ date: "2026-10-03", bins: {} });
  expect(parseDay(JSON.stringify({ date: "2026-10-03", bins: "nope" }), now)).toEqual({ date: "2026-10-03", bins: {} });
});

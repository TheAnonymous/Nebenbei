<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch, watchEffect } from "vue";
import type { Effects, Levels } from "./audio/effects";
import { DEFAULT_EFFECTS, DEFAULT_LEVELS, EFFECT_RANGES, MOVE_NAMES } from "./audio/effects";
import { Engine } from "./audio/engine";
import { GROUPS, KITS, PATCHES } from "./audio/instruments";
import { noted, stripOf } from "./day";
import type { Entry } from "./logbook";
import { loadDay, loadLogbook, loadSession, saveDay, saveLogbook, saveSession } from "./logbook";
import { mediaKeysPlaying, setUpMediaKeys } from "./media-keys";
import type { Groove, TrackId } from "./music/groove";
import type { ExtraKind } from "./music/groove";
import { addExtra, BASS_STEPS, chordName, DRUM_STEPS, DRUM_VOICES, EXTRA_KINDS, EXTRA_NAMES, EXTRA_ROLES, EXTRA_STEPS, feelOf, grooveName, isCore, LOOP_STEPS, MAX_TRACKS, MODES, mutate, nextInstrument, PERC_VOICES, plays, removeExtra, roll, rollGroove, STAB_STEPS, trackIds, TRACKS, turnaround, withExtra } from "./music/groove";
import { PHASE_NAMES } from "./music/tide";
import { applyUpdate, install, installable, setUpApp, updateReady } from "./pwa";
import { versionLabel } from "./version";
import { ROWS, startVisual } from "./visual";

/** One small change every eight bars (about 16 seconds). */
const MUTATE_EVERY_LOOPS = 2;
const MAX_ENERGY = 10;
/** How many grooves from before a roll the trail keeps. */
const MAX_TRAIL = 20;

// The page picks up where the last visit stopped.
const session = loadSession();
// Shallow refs: grooves and the logbook are replaced as a whole with every change, never edited in place.
const groove = shallowRef(session?.groove ?? rollGroove(Math.random));
const logbook = shallowRef(loadLogbook());
const day = shallowRef(loadDay());
const energy = ref(session?.energy ?? 5);
/** The mood slider. The groove follows it on the next bar line, and it follows the groove when one comes back from the logbook. */
const mood = ref(groove.value.chords.mode);
const effects = reactive<Effects>(session?.effects ?? { ...DEFAULT_EFFECTS });
const dj = ref(session?.dj ?? false);
const tides = ref(session?.tides ?? false);
/** A quieter sky for focused work: slower, no flashes on the drums. */
const calmSky = ref(session?.calmSky ?? false);
/** What sounds right now, from the engine: the energy the tides have taken it to, their phase, a pause of the drums, the answering pass. */
const liveEnergy = ref(0.5);
const tidePhase = ref("");
const breakdown = ref(false);
const answering = ref(false);
const levels = reactive<Levels>(session?.levels ?? { ...DEFAULT_LEVELS });
/** What the DJ does right now, as the page says it. */
const djMove = ref(MOVE_NAMES.ruhe);
const sky = ref<HTMLCanvasElement | null>(null);
const volume = ref(session?.volume ?? 80);
const playing = ref(false);
const step = ref(-1);
/** Tracks are named by id: the four core tracks by their names, the extras by theirs. */
const held = ref(new Set<string>(session?.held));
const saveFailed = ref(false);
/** Tracks whose roll waits for the bar line. */
const waiting = ref(new Set<string>());
/** Tracks that have just changed and glow for a moment. */
const changed = ref(new Set<string>());

const engine = new Engine(groove.value);
watch(energy, (value) => (engine.energy = value / MAX_ENERGY), { immediate: true });
watch(volume, (value) => (engine.volume = value / 100), { immediate: true });
watch(effects, (value) => (engine.effects = value), { deep: true, immediate: true });
watch(dj, (on) => (engine.dj = on), { immediate: true });
watch(tides, (on) => (engine.tides = on), { immediate: true });
watch(levels, (value) => (engine.levels = value), { deep: true, immediate: true });
watch(groove, (value) => (mood.value = value.chords.mode));
watch(mood, (mode) => {
  if (mode === groove.value.chords.mode) return;
  onBarLine(() => show({ ...groove.value, chords: { ...groove.value.chords, mode } }, ["chords"]));
});
watchEffect(() => {
  if (!saveSession({ groove: groove.value, energy: energy.value, volume: volume.value, held: [...held.value], effects: { ...effects }, levels: { ...levels }, dj: dj.value, tides: tides.value, calmSky: calmSky.value })) saveFailed.value = true;
});
watch(logbook, (value) => {
  if (!saveLogbook(value)) saveFailed.value = true;
});
watch(day, (value) => {
  if (!saveDay(value)) saveFailed.value = true;
});
watchEffect(() => {
  // In a row of tabs the playing one is easy to find.
  document.title = playing.value ? "▶ Nebenbei" : "Nebenbei";
});

/** Writes into the day strip: the energy that plays now (where the tides took it) and, with `event`, a nudge or a kept groove. */
function note(event?: "nudge" | "keep"): void {
  day.value = noted(day.value, new Date(), Math.round(engine.liveEnergy * MAX_ENERGY), event);
}

let changedTimer = 0;
function show(next: Groove, tracks: readonly string[]): void {
  groove.value = engine.groove = next;
  changed.value = new Set(tracks);
  clearTimeout(changedTimer);
  changedTimer = window.setTimeout(() => (changed.value = new Set()), 5000);
}

/** While the music plays, changes wait for the next bar line; nothing jumps in mid-bar. */
let atBarLine: (() => void)[] = [];
function onBarLine(change: () => void): void {
  if (playing.value) atBarLine.push(change);
  else change();
}

let loops = 0;
engine.onBar = (bar, modulate) => {
  const changes = atBarLine;
  atBarLine = [];
  for (const change of changes) change();
  if (bar !== 0) return;
  note();
  // The tides move the key on; held chords stay where they are. Bass and melody follow the chords.
  if (modulate !== null && !held.value.has("chords")) {
    const { chords } = groove.value;
    show({ ...groove.value, chords: { ...chords, key: (chords.key + modulate) % 12 } }, ["chords"]);
  }
  loops += 1;
  const free = trackIds(groove.value).filter((track) => !held.value.has(track));
  if (loops === 1 || loops % MUTATE_EVERY_LOOPS !== 1 || !free.length) return;
  const result = mutate(groove.value, Math.random, free);
  show(result.groove, [result.track]);
};

// Two entries never share a time: the list is keyed by it.
let lastEntryAt = 0;
function entryNow(): Entry {
  lastEntryAt = Math.max(Date.now(), lastEntryAt + 1);
  return { at: lastEntryAt, name: grooveName(groove.value), groove: groove.value };
}

/** Logs the running groove on the trail, just before something replaces it. */
function leaveTrail(): void {
  const { kept, trail } = logbook.value;
  logbook.value = { kept, trail: [...trail, entryNow()].slice(-MAX_TRAIL) };
}

/** Remembers the running groove for good. */
function keep(): void {
  const { kept, trail } = logbook.value;
  const now = JSON.stringify(groove.value);
  if (kept.some((entry) => JSON.stringify(entry.groove) === now)) return;
  logbook.value = { kept: [...kept, entryNow()], trail };
  note("keep");
}

function forget(list: "kept" | "trail", entry: Entry): void {
  logbook.value = { ...logbook.value, [list]: logbook.value[list].filter((other) => other !== entry) };
}

/** New patterns for the tracks that are not held. What was there before goes on the trail. */
function rollTracks(tracks: readonly string[]): void {
  const free = tracks.filter((track) => !held.value.has(track) && !waiting.value.has(track));
  if (!free.length) return;
  for (const track of free) waiting.value.add(track);
  onBarLine(() => {
    leaveTrail();
    note("nudge");
    let next = groove.value;
    for (const track of free) {
      next = roll(next, track, Math.random);
      waiting.value.delete(track);
    }
    show(next, free);
  });
}

/** Plays a groove from the logbook, with its instruments and its extra tracks. Held tracks stay as they are. */
function bringBack(source: Groove): void {
  const free = TRACKS.filter((track) => !held.value.has(track));
  const next = { ...groove.value, sounds: { ...groove.value.sounds } };
  for (const track of free) {
    Object.assign(next, { [track]: source[track] });
    next.sounds[track] = source.sounds[track];
  }
  // Held extras stay; the others make room for the source's, up to eight tracks in all.
  const kept = groove.value.extras.filter((extra) => held.value.has(extra.id));
  const room = MAX_TRACKS - TRACKS.length - kept.length;
  next.extras = [...kept, ...source.extras.filter((extra) => !kept.some((other) => other.id === extra.id)).slice(0, room)];
  show(next, [...free, ...next.extras.map((extra) => extra.id)]);
}

/** Puts an instrument on a track, from the very next note. */
function setSound(track: string, sound: string): void {
  groove.value = engine.groove = isCore(track) ? { ...groove.value, sounds: { ...groove.value.sounds, [track]: sound } } : withExtra(groove.value, track, (extra) => ({ ...extra, sound }));
}

/** A track's level: the core tracks' in the mix, an extra's in the groove. */
function setLevel(track: string, event: Event): void {
  const level = Number((event.target as HTMLInputElement).value);
  if (isCore(track)) levels[track] = level;
  else groove.value = engine.groove = withExtra(groove.value, track, (extra) => ({ ...extra, level }));
}

/** Adds an extra track (on the next bar line); like a roll, what was there before goes on the trail. */
function addTrack(event: Event): void {
  const menu = event.target as HTMLSelectElement;
  const kind = menu.value as ExtraKind;
  menu.value = "";
  menu.blur();
  if (!EXTRA_KINDS.includes(kind)) return;
  onBarLine(() => {
    const next = addExtra(groove.value, kind, Math.random);
    if (next === groove.value) return;
    leaveTrail();
    note("nudge");
    show(next, [next.extras.at(-1)!.id]);
  });
}

function removeTrack(id: string): void {
  onBarLine(() => {
    leaveTrail();
    note("nudge");
    held.value.delete(id);
    show(removeExtra(groove.value, id), []);
  });
}

/** The next of the instruments that suit the track. */
function cycleSound(track: TrackId): void {
  setSound(track, nextInstrument(track, groove.value.sounds[track]));
}

/** The menu of a track: the kits for drums and percussion, every instrument in its group for the others. */
const KIT_MENU = [{ group: "Kits", options: Object.entries(KITS).map(([id, kit]) => ({ id, name: kit.name })) }];
const INSTRUMENT_MENU = GROUPS.map((group) => ({
  group,
  options: Object.entries(PATCHES)
    .filter(([, patch]) => patch.group === group)
    .map(([id, patch]) => ({ id, name: patch.name })),
}));

function chooseSound(track: string, event: Event): void {
  const menu = event.target as HTMLSelectElement;
  setSound(track, menu.value);
  // Back to the page's keys: the arrows are energy and mood again, not the menu.
  menu.blur();
}

function recall(entry: Entry): void {
  onBarLine(() => {
    leaveTrail();
    note("nudge");
    bringBack(entry.groove);
  });
}

/** Undoes the last roll or recall: the newest groove on the trail comes back and leaves the trail. */
function back(): void {
  onBarLine(() => {
    const { kept, trail } = logbook.value;
    const previous = trail.at(-1);
    if (!previous) return;
    logbook.value = { kept, trail: trail.slice(0, -1) };
    note("nudge");
    bringBack(previous.groove);
  });
}

function toggleHold(track: string): void {
  if (!held.value.delete(track)) held.value.add(track);
}

// What moves every frame is moved straight in the page, past Vue: the lines over the lanes, the glow behind
// them, the pulse of the Start button. Only the sixteenth that sounds goes through Vue, for the marks.
const heads: (HTMLElement | null)[] = [];
const glows: (HTMLElement | null)[] = [];
const playButton = ref<HTMLElement | null>(null);
/** The dots on the effect sliders that show where the DJ has them, and the one on the energy that shows the tides. */
const djDots: (HTMLElement | null)[] = [];
const tideDot = ref<HTMLElement | null>(null);
const keepElement = (list: (HTMLElement | null)[], index: number) => (element: unknown): void => {
  list[index] = element instanceof HTMLElement ? element : null;
};

let frame = 0;
function follow(): void {
  const position = engine.position();
  // Each line is a sixty-fourth of its lane wide, so its own width is one sixteenth.
  for (const head of heads) if (head) head.style.transform = `translateX(${Math.max(0, position) * 100}%)`;
  step.value = Math.floor(position);
  const mix = engine.heardMix();
  if (mix && dj.value) {
    EFFECT_CONTROLS.forEach(({ id }, index) => {
      const [low, high] = EFFECT_RANGES[id];
      djDots[index]?.style.setProperty("--at", ((mix.effects[id] - low) / (high - low)).toFixed(4));
    });
    djMove.value = MOVE_NAMES[mix.move];
  }
  if (mix) {
    // Only what changes reaches Vue; most of these change once a bar or less.
    if (mix.energy !== liveEnergy.value) liveEnergy.value = mix.energy;
    tidePhase.value = mix.breakdown ? "Pause der Drums" : mix.phase ? PHASE_NAMES[mix.phase] : "";
    breakdown.value = mix.breakdown;
    answering.value = mix.answer;
    tideDot.value?.style.setProperty("--at", mix.energy.toFixed(4));
  }
  frame = requestAnimationFrame(follow);
}

/** The sky reports how strongly each track sounds; the page glows along, every extra track with the core track it plays like. */
function glow(levels: readonly number[], kick: number): void {
  lanes.value.forEach((lane, index) => {
    const element = glows[index];
    if (element) element.style.opacity = levels[ROWS[lane.role]]!.toFixed(3);
  });
  if (playButton.value) playButton.value.style.scale = (1 + 0.05 * kick).toFixed(4);
}

async function toggle(): Promise<void> {
  playing.value = await engine.toggle();
  mediaKeysPlaying(playing.value);
  cancelAnimationFrame(frame);
  if (playing.value) follow();
}

function setPlaying(on: boolean): void {
  if (on !== playing.value) void toggle();
}

function onKey(event: KeyboardEvent): void {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target instanceof HTMLElement ? event.target.tagName : "";
  // An open instrument menu keeps its keys.
  if (target === "SELECT") return;
  const energyStep = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
  const moodStep = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
  // The physical keys, so Shift+1 and the row below the digits work on every keyboard layout. 1 to 8 are the tracks in their order.
  const digit = /^Digit(\d)$/.exec(event.code)?.[1];
  const track = digit && digit !== "0" ? trackIds(groove.value)[Number(digit) - 1] : undefined;
  const soundTrack = TRACKS[["KeyQ", "KeyW", "KeyE", "KeyR"].indexOf(event.code)];
  if (energyStep || moodStep) {
    // A focused slider moves by itself.
    if (target === "INPUT") return;
    energy.value = Math.min(MAX_ENERGY, Math.max(0, energy.value + energyStep));
    mood.value = Math.min(MODES.length - 1, Math.max(0, mood.value + moodStep));
  } else if (event.repeat) return;
  else if (track && event.shiftKey) toggleHold(track);
  else if (track) rollTracks([track]);
  else if (soundTrack) cycleSound(soundTrack);
  else if (digit === "0") rollTracks(trackIds(groove.value));
  else if (event.key.toLowerCase() === "z") back();
  else if (event.key.toLowerCase() === "m") keep();
  else if (event.code === "KeyD") dj.value = !dj.value;
  else if (event.code === "KeyG") tides.value = !tides.value;
  else if (event.code === "KeyH") calmSky.value = !calmSky.value;
  // A focused button is pressed by the space bar itself.
  else if (event.code === "Space" && target !== "BUTTON") void toggle();
  else return;
  event.preventDefault();
}

/** After a mouse click the control lets go of the keyboard, so space stays Start/Pause and the arrows stay the energy. */
function releaseFocus(event: MouseEvent): void {
  // The click may have hit a label inside the button.
  const control = event.target instanceof Element ? event.target.closest("button, input") : null;
  if (event.detail > 0 && control instanceof HTMLElement) control.blur();
}

let stopVisual = (): void => undefined;
onMounted(() => {
  setUpApp();
  if (sky.value) {
    stopVisual = startVisual(sky.value, () => ({ playing: playing.value, energy: shownEnergy.value, mood: groove.value.chords.mode / (MODES.length - 1), calm: calmSky.value, open: breakdown.value, pulses: () => engine.takePulses() }), glow);
  }
  window.addEventListener("keydown", onKey);
  setUpMediaKeys({ play: () => setPlaying(true), pause: () => setPlaying(false), next: () => rollTracks(trackIds(groove.value)), previous: back });
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  stopVisual();
  cancelAnimationFrame(frame);
  clearTimeout(changedTimer);
  engine.dispose();
});

interface Mark {
  step: number;
  len: number;
  row: number;
  on: boolean;
}

/** Lays a pattern that is shorter than the loop out over all four bars. */
function across<T extends { step: number }>(items: T[], length: number): T[] {
  return Array.from({ length: LOOP_STEPS / length }, (_, pass) => items.map((item) => ({ ...item, step: item.step + pass * length }))).flat();
}

const EXTRA_HINTS: Record<ExtraKind, string> = {
  perkussion: "Conga, Bongo, Clave, Shaker",
  gegenstimme: "eine zweite, tiefere Melodie",
  arpeggio: "läuft durch die Akkordtöne",
  flaeche: "gehaltene Akkorde",
};

interface Lane {
  id: string;
  name: string;
  /** The core track it is, or plays like: its colour (for the core tracks), its menu, its row in the sky. */
  role: TrackId;
  /** For an extra track, its kind (it gets its own colour). */
  kind: ExtraKind | null;
  rows: number;
  marks: Mark[];
  labels: string[];
  sound: string;
  level: number;
  menu: typeof KIT_MENU;
}

const lanes = computed((): Lane[] => {
  const { drums, bass, chords, melody, sounds, extras } = groove.value;
  // In a breakdown kick and clap pause: their marks wait too.
  const on = (item: { min: number; voice?: string }, track: TrackId): boolean =>
    plays(item, track, shownEnergy.value, chords.mode) && !(breakdown.value && (item.voice === "kick" || item.voice === "clap"));
  const lane = (id: TrackId, name: string, rows: number, marks: Mark[], labels: string[] = []): Lane => ({ id, name, role: id, kind: null, rows, marks, labels, sound: sounds[id], level: levels[id], menu: id === "drums" ? KIT_MENU : INSTRUMENT_MENU });
  return [
    lane("drums", "Drums", DRUM_VOICES.length, across(drums, DRUM_STEPS).map((hit) => ({ step: hit.step, len: 1, row: DRUM_VOICES.indexOf(hit.voice as (typeof DRUM_VOICES)[number]), on: on(hit, "drums") }))),
    lane("bass", "Bass", 5, across(bass, BASS_STEPS).map((note) => ({ step: note.step, len: note.len, row: 4 - note.tone, on: on(note, "bass") }))),
    lane("chords", "Akkorde", 1, across(chords.stabs, STAB_STEPS).map((stab) => ({ step: stab.step, len: stab.len, row: 0, on: on(stab, "chords") })), (answering.value ? turnaround(chords.bars) : chords.bars).map((chord) => chordName(chords, chord))),
    lane("melody", "Melodie", 6, melody.map((note) => ({ step: note.step, len: note.len, row: 5 - note.tone, on: on(note, "melody") }))),
    ...extras.map((extra): Lane => {
      const role = EXTRA_ROLES[extra.kind];
      const steps = EXTRA_STEPS[extra.kind];
      const marks =
        extra.kind === "perkussion"
          ? across(extra.hits, steps).map((hit) => ({ step: hit.step, len: 1, row: PERC_VOICES.indexOf(hit.voice as (typeof PERC_VOICES)[number]), on: on(hit, role) }))
          : across(extra.notes, steps).map((note) => ({ step: note.step, len: note.len, row: extra.kind === "flaeche" ? 0 : 4 - Math.min(4, note.tone), on: on(note, role) }));
      const rows = extra.kind === "perkussion" ? PERC_VOICES.length : extra.kind === "flaeche" ? 1 : 5;
      // Two tracks of a kind are told apart by number.
      const same = extras.filter((other) => other.kind === extra.kind);
      const name = same.length > 1 ? `${EXTRA_NAMES[extra.kind]} ${same.indexOf(extra) + 1}` : EXTRA_NAMES[extra.kind];
      return { id: extra.id, name, role, kind: extra.kind, rows, marks, labels: [], sound: extra.sound, level: extra.level, menu: role === "drums" ? KIT_MENU : INSTRUMENT_MENU };
    }),
  ];
});

const percent = (part: number, whole: number): string => `${(part / whole) * 100}%`;

/** The energy that plays: yours, or with the tides on and the music running, where they have taken it. */
const shownEnergy = computed(() => (tides.value && playing.value ? liveEnergy.value : energy.value / MAX_ENERGY));

const sections = computed(() => [
  { id: "kept" as const, title: "Gemerkt", empty: "Noch nichts gemerkt. M hält fest, was gerade läuft.", entries: [...logbook.value.kept].reverse() },
  { id: "trail" as const, title: "Verlauf", empty: "Vor jedem Würfeln landet der alte Groove hier.", entries: [...logbook.value.trail].reverse() },
]);
const when = (at: number): string => new Date(at).toLocaleString("de-DE", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

const strip = computed(() => stripOf(day.value));
const summary = computed(() => {
  if (!strip.value) return "";
  const { minutes, nudges, kept } = strip.value;
  const hours = Math.floor(minutes / 60);
  return `${hours ? `${hours} h ` : ""}${minutes % 60} min Musik · ${nudges}× eingegriffen · ${kept} gemerkt`;
});
const binTitle = (index: number): string => {
  const bin = strip.value?.bins[index];
  return bin ? `Energie ${bin.energy}${bin.nudges ? ` · ${bin.nudges}× eingegriffen` : ""}${bin.kept ? ` · ${bin.kept} gemerkt` : ""}` : "";
};
const chordsOf = (entry: Entry): string => entry.groove.chords.bars.map((chord) => chordName(entry.groove.chords, chord)).join(" · ");

const EFFECT_CONTROLS: { id: keyof Effects; name: string; hint: string }[] = [
  { id: "hall", name: "Hall", hint: "Wie viel Raum um Akkorde, Melodie und Clap liegt" },
  { id: "echo", name: "Echo", hint: "Das Echo der Melodie: lauter und mit mehr Wiederholungen" },
  { id: "tape", name: "Band", hint: "Leiern, Rauschen, Knistern und Sättigung wie von einer alten Kassette" },
  { id: "pump", name: "Pumpen", hint: "Wie tief alles unter der Kick wegtaucht" },
  { id: "filter", name: "Filter", hint: "Links dumpf, rechts dünn, in der Mitte aus" },
];
</script>

<template>
  <canvas ref="sky" class="sky" aria-hidden="true" />
  <main @click="releaseFocus">
    <div class="player">
    <header>
      <h1>Nebenbei</h1>
      <p>Lo-Fi-House, der von allein läuft und sich langsam verändert.</p>
    </header>

    <div class="actions">
      <button ref="playButton" class="play" type="button" @click="toggle">
        <span :key="String(playing)" class="swap">{{ playing ? "Pause" : "Start" }}</span>
      </button>
      <button type="button" @click="rollTracks(TRACKS)">Alles würfeln <kbd>0</kbd></button>
      <button type="button" :disabled="!logbook.trail.length" @click="back">Zurück <kbd>Z</kbd></button>
      <button type="button" @click="keep">Merken <kbd>M</kbd></button>
      <button type="button" class="switch sky-switch" :aria-pressed="calmSky" title="Ein ruhigerer Himmel zum Konzentrieren: langsamer, ohne Blitze auf den Drums" @click="calmSky = !calmSky">Ruhiger Himmel <kbd>H</kbd></button>
      <button v-if="installable" type="button" @click="install">Als App installieren</button>
    </div>

    <section class="tracks" aria-label="Spuren">
      <div v-for="(lane, index) in lanes" :key="lane.id" class="track" :class="[lane.kind ? ['extra', lane.kind] : lane.id, { changed: changed.has(lane.id), held: held.has(lane.id), silent: !lane.level }]">
        <span class="name">
          <span class="title"><kbd>{{ index + 1 }}</kbd> {{ lane.name }}</span>
          <select :key="lane.sound" class="sound swap" :value="lane.sound" :aria-label="`Instrument der Spur ${lane.name}`" @change="chooseSound(lane.id, $event)">
            <optgroup v-for="group in lane.menu" :key="group.group" :label="group.group">
              <option v-for="option in group.options" :key="option.id" :value="option.id">{{ option.name }}</option>
            </optgroup>
          </select>
          <input :value="lane.level" class="level" type="range" min="0" max="100" :aria-label="`Lautstärke ${lane.name}`" :title="`Lautstärke ${lane.level}`" @input="setLevel(lane.id, $event)" />
        </span>
        <div class="lane-box">
          <span :ref="keepElement(glows, index)" class="glow" />
          <div class="lane">
            <!-- Marks come and go softly when the pattern changes, and light up while they sound. -->
            <TransitionGroup name="mark">
              <i
                v-for="mark in lane.marks"
                :key="`${mark.step}:${mark.row}`"
                :class="{ off: !mark.on, hit: mark.on && step >= mark.step && step < mark.step + mark.len }"
                :style="{ left: percent(mark.step, LOOP_STEPS), width: percent(mark.len, LOOP_STEPS), top: percent(mark.row, lane.rows), height: percent(1, lane.rows) }"
              />
            </TransitionGroup>
            <span v-for="(label, bar) in lane.labels" :key="`${bar}:${label}`" class="chord" :style="{ left: percent(bar, lane.labels.length) }">{{ label }}</span>
            <b v-show="step >= 0" :ref="keepElement(heads, index)" />
          </div>
        </div>
        <button type="button" :class="{ waiting: waiting.has(lane.id) }" :disabled="held.has(lane.id)" :aria-label="`${lane.name} würfeln`" @click="rollTracks([lane.id])">Würfeln</button>
        <button type="button" class="hold" :aria-pressed="held.has(lane.id)" :aria-label="`${lane.name} festhalten`" @click="toggleHold(lane.id)">{{ held.has(lane.id) ? "Gehalten" : "Halten" }}</button>
        <button v-if="lane.kind" type="button" class="remove" :aria-label="`Spur ${lane.name} entfernen`" title="Spur entfernen" @click="removeTrack(lane.id)">×</button>
      </div>
      <div class="add-track">
        <select class="add" aria-label="Spur hinzufügen" :disabled="lanes.length >= MAX_TRACKS" @change="addTrack">
          <option value="" selected>{{ lanes.length >= MAX_TRACKS ? "Acht Spuren, mehr gehen nicht" : "+ Spur hinzufügen" }}</option>
          <option v-for="kind in EXTRA_KINDS" :key="kind" :value="kind">{{ EXTRA_NAMES[kind] }}: {{ EXTRA_HINTS[kind] }}</option>
        </select>
      </div>
    </section>

    <div class="moods">
      <div class="energy" :class="{ tides }">
        <span class="head">
          <label for="energy">Energie</label> <output>{{ energy }}</output>
          <button type="button" class="switch" :aria-pressed="tides" title="Die Energie nimmt über die Arbeitsstunde einen langen Bogen um deine Einstellung, mit Pausen der Drums, Fills, achttaktigen Akkorden und gelegentlich einer neuen Tonart" @click="tides = !tides">Gezeiten <kbd>G</kbd></button>
          <span v-if="tides && playing && tidePhase" :key="tidePhase" class="move swap">{{ tidePhase }}</span>
        </span>
        <span class="slider">
          <input id="energy" v-model.number="energy" type="range" min="0" :max="MAX_ENERGY" step="1" />
          <i ref="tideDot" class="dj-dot" />
        </span>
        <span class="ends"><span>ruhig</span><span>voller Groove</span></span>
      </div>
      <label class="energy mood">
        <span>Stimmung <output :key="mood" class="swap">{{ MODES[mood]!.name }} · {{ Math.round(feelOf(mood).tempo) }} BPM</output></span>
        <input v-model.number="mood" type="range" min="0" :max="MODES.length - 1" step="1" />
        <span class="ends"><span>traurig</span><span>fröhlich</span></span>
      </label>
    </div>

    <fieldset class="effects" :class="{ dj }">
      <legend>
        Effekte
        <button type="button" class="dj-switch" :aria-pressed="dj" title="Der DJ spielt die Effekte um deine Einstellungen herum, ein Griff pro vier Takte" @click="dj = !dj">DJ <kbd>D</kbd></button>
        <span v-if="dj && playing" :key="djMove" class="move swap">{{ djMove }}</span>
      </legend>
      <label v-for="(control, index) in EFFECT_CONTROLS" :key="control.id" :title="control.hint">
        <span>{{ control.name }} <output>{{ effects[control.id] }}</output></span>
        <span class="slider">
          <input v-model.number="effects[control.id]" type="range" :min="EFFECT_RANGES[control.id][0]" :max="EFFECT_RANGES[control.id][1]" step="1" />
          <i :ref="keepElement(djDots, index)" class="dj-dot" />
        </span>
      </label>
      <label class="volume">
        <span>Lautstärke</span>
        <input v-model.number="volume" type="range" min="0" max="100" />
      </label>
    </fieldset>

    <section class="day" aria-label="Tagesstreifen">
      <h2>Heute</h2>
      <p v-if="!strip" class="empty">Hier wächst über den Tag ein Streifen: wie viel Energie lief, wo du eingegriffen und was du dir gemerkt hast.</p>
      <template v-else>
        <p class="empty">{{ summary }}</p>
        <div class="strip" :style="{ gridTemplateColumns: `repeat(${strip.bins.length}, 1fr)` }">
          <span
            v-for="(bin, index) in strip.bins"
            :key="index"
            :class="{ nudged: bin?.nudges, kept: bin?.kept }"
            :style="bin ? { height: percent(bin.energy + 2, MAX_ENERGY + 2) } : undefined"
            :title="binTitle(index)"
          />
        </div>
        <span class="ends"><span>{{ strip.from }}</span><span>{{ strip.to }}</span></span>
      </template>
    </section>

    <p class="keys">
      <kbd>Leertaste</kbd> Start/Pause · <kbd>1</kbd>–<kbd>8</kbd> Spur würfeln · <kbd>Shift</kbd>+<kbd>1</kbd>–<kbd>8</kbd> Spur festhalten · <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>R</kbd> Instrument wechseln · <kbd>0</kbd> alles würfeln · <kbd>Z</kbd> zurück · <kbd>M</kbd> merken · <kbd>D</kbd> DJ · <kbd>G</kbd> Gezeiten · <kbd>H</kbd> ruhiger Himmel ·
      <kbd>↑</kbd> <kbd>↓</kbd> Energie · <kbd>←</kbd> <kbd>→</kbd> Stimmung<br />
      Medientasten, auch wenn der Tab im Hintergrund ist: Play/Pause · Weiter würfelt alles, was nicht gehalten ist · Zurück holt den Groove vor dem letzten Würfeln wieder
    </p>

    <p v-if="updateReady" class="update" role="status">Eine neue Version ist da. <button type="button" @click="applyUpdate">Neu laden</button></p>
    <footer>{{ versionLabel() }}</footer>
    </div>

    <aside class="logbook" aria-label="Logbuch">
      <h2>Logbuch</h2>
      <p v-if="saveFailed" class="warning">Der Browser hat das Speichern abgelehnt. Was du jetzt merkst, ist nach dem Schließen der Seite weg.</p>
      <template v-for="section in sections" :key="section.id">
        <h3>{{ section.title }}</h3>
        <TransitionGroup tag="ul" name="entry">
          <li v-for="entry in section.entries" :key="entry.at">
            <button type="button" class="entry" @click="recall(entry)">
              <span>{{ when(entry.at) }} · {{ entry.name }}</span>
              <small>{{ chordsOf(entry) }}</small>
            </button>
            <button type="button" class="forget" :aria-label="`${entry.name} löschen`" @click="forget(section.id, entry)">×</button>
          </li>
        </TransitionGroup>
        <p v-if="!section.entries.length" class="empty">{{ section.empty }}</p>
      </template>
    </aside>
  </main>
</template>

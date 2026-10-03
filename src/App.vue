<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch, watchEffect } from "vue";
import type { Effects } from "./audio/effects";
import { DEFAULT_EFFECTS, EFFECT_RANGES } from "./audio/effects";
import { Engine } from "./audio/engine";
import { noted, stripOf } from "./day";
import type { Entry } from "./logbook";
import { loadDay, loadLogbook, loadSession, saveDay, saveLogbook, saveSession } from "./logbook";
import { mediaKeysPlaying, setUpMediaKeys } from "./media-keys";
import type { Groove, TrackId } from "./music/groove";
import { BASS_STEPS, chordName, DRUM_STEPS, DRUM_VOICES, grooveName, LOOP_STEPS, MODES, mutate, roll, rollGroove, SOUNDS, STAB_STEPS, TRACKS } from "./music/groove";
import { versionLabel } from "./version";
import { startVisual } from "./visual";

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
const sky = ref<HTMLCanvasElement | null>(null);
const volume = ref(session?.volume ?? 80);
const playing = ref(false);
const step = ref(-1);
const held = ref(new Set<TrackId>(session?.held));
const saveFailed = ref(false);
/** Tracks whose roll waits for the bar line. */
const waiting = ref(new Set<TrackId>());
/** Tracks that have just changed and glow for a moment. */
const changed = ref(new Set<TrackId>());

const engine = new Engine(groove.value);
watch(energy, (value) => (engine.energy = value / MAX_ENERGY), { immediate: true });
watch(volume, (value) => (engine.volume = value / 100), { immediate: true });
watch(effects, (value) => (engine.effects = value), { deep: true, immediate: true });
watch(groove, (value) => (mood.value = value.chords.mode));
watch(mood, (mode) => {
  if (mode === groove.value.chords.mode) return;
  onBarLine(() => show({ ...groove.value, chords: { ...groove.value.chords, mode } }, ["chords"]));
});
watchEffect(() => {
  if (!saveSession({ groove: groove.value, energy: energy.value, volume: volume.value, held: [...held.value], effects: { ...effects } })) saveFailed.value = true;
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

/** Writes into the day strip: the energy that plays now and, with `event`, a nudge or a kept groove. */
function note(event?: "nudge" | "keep"): void {
  day.value = noted(day.value, new Date(), energy.value, event);
}

let changedTimer = 0;
function show(next: Groove, tracks: readonly TrackId[]): void {
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
engine.onBar = (bar) => {
  const changes = atBarLine;
  atBarLine = [];
  for (const change of changes) change();
  if (bar !== 0) return;
  note();
  loops += 1;
  const free = TRACKS.filter((track) => !held.value.has(track));
  if (loops === 1 || loops % MUTATE_EVERY_LOOPS !== 1 || !free.length) return;
  const result = mutate(groove.value, Math.random, free);
  show(result.groove, [result.track]);
};

const entryNow = (): Entry => ({ at: Date.now(), name: grooveName(groove.value), groove: groove.value });

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
function rollTracks(tracks: readonly TrackId[]): void {
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

/** Plays a groove from the logbook, with its instruments. Held tracks stay as they are. */
function bringBack(source: Groove): void {
  const free = TRACKS.filter((track) => !held.value.has(track));
  const next = { ...groove.value, sounds: { ...groove.value.sounds } };
  for (const track of free) {
    Object.assign(next, { [track]: source[track] });
    next.sounds[track] = source.sounds[track];
  }
  show(next, free);
}

/** The next instrument of a track, from the very next note. */
function cycleSound(track: TrackId): void {
  const sounds = { ...groove.value.sounds, [track]: (groove.value.sounds[track] + 1) % SOUNDS[track].length };
  groove.value = engine.groove = { ...groove.value, sounds };
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

function toggleHold(track: TrackId): void {
  if (!held.value.delete(track)) held.value.add(track);
}

let frame = 0;
function follow(): void {
  step.value = engine.position();
  frame = requestAnimationFrame(follow);
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
  const energyStep = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
  const moodStep = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
  // The physical keys, so Shift+1 and the row below the digits work on every keyboard layout.
  const digit = /^Digit(\d)$/.exec(event.code)?.[1];
  const track = digit ? TRACKS[Number(digit) - 1] : undefined;
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
  else if (digit === "0") rollTracks(TRACKS);
  else if (event.key.toLowerCase() === "z") back();
  else if (event.key.toLowerCase() === "m") keep();
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
  if (sky.value) {
    stopVisual = startVisual(sky.value, () => ({ playing: playing.value, energy: energy.value / MAX_ENERGY, mood: groove.value.chords.mode / (MODES.length - 1), pulses: engine.takePulses() }));
  }
  window.addEventListener("keydown", onKey);
  setUpMediaKeys({ play: () => setPlaying(true), pause: () => setPlaying(false), next: () => rollTracks(TRACKS), previous: back });
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

const lanes = computed(() => {
  const { drums, bass, chords, melody, sounds } = groove.value;
  const on = (item: { min: number }): boolean => item.min <= energy.value / MAX_ENERGY + 1e-9;
  const lane = (id: TrackId, name: string, rows: number, marks: Mark[], labels: string[] = []) => ({ id, name, rows, marks, labels, sound: SOUNDS[id][sounds[id]]! });
  return [
    lane("drums", "Drums", DRUM_VOICES.length, across(drums, DRUM_STEPS).map((hit) => ({ step: hit.step, len: 1, row: DRUM_VOICES.indexOf(hit.voice), on: on(hit) }))),
    lane("bass", "Bass", 5, across(bass, BASS_STEPS).map((note) => ({ step: note.step, len: note.len, row: 4 - note.tone, on: on(note) }))),
    lane("chords", "Akkorde", 1, across(chords.stabs, STAB_STEPS).map((stab) => ({ step: stab.step, len: stab.len, row: 0, on: on(stab) })), chords.bars.map((chord) => chordName(chords, chord))),
    lane("melody", "Melodie", 6, melody.map((note) => ({ step: note.step, len: note.len, row: 5 - note.tone, on: on(note) }))),
  ];
});

const percent = (part: number, whole: number): string => `${(part / whole) * 100}%`;

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
      <button class="play" type="button" @click="toggle">{{ playing ? "Pause" : "Start" }}</button>
      <button type="button" @click="rollTracks(TRACKS)">Alles würfeln <kbd>0</kbd></button>
      <button type="button" :disabled="!logbook.trail.length" @click="back">Zurück <kbd>Z</kbd></button>
      <button type="button" @click="keep">Merken <kbd>M</kbd></button>
    </div>

    <section class="tracks" aria-label="Spuren">
      <div v-for="(lane, index) in lanes" :key="lane.id" class="track" :class="[lane.id, { changed: changed.has(lane.id), held: held.has(lane.id) }]">
        <span class="name">
          <span><kbd>{{ index + 1 }}</kbd> {{ lane.name }}</span>
          <button type="button" class="sound" :aria-label="`${lane.name}: Instrument ${lane.sound}, zum nächsten wechseln`" @click="cycleSound(lane.id)">{{ lane.sound }}</button>
        </span>
        <div class="lane">
          <i
            v-for="(mark, at) in lane.marks"
            :key="at"
            :class="{ off: !mark.on }"
            :style="{ left: percent(mark.step, LOOP_STEPS), width: percent(mark.len, LOOP_STEPS), top: percent(mark.row, lane.rows), height: percent(1, lane.rows) }"
          />
          <span v-for="(label, bar) in lane.labels" :key="bar" class="chord" :style="{ left: percent(bar, lane.labels.length) }">{{ label }}</span>
          <b v-if="step >= 0" :style="{ left: percent(step, LOOP_STEPS) }" />
        </div>
        <button type="button" :class="{ waiting: waiting.has(lane.id) }" :disabled="held.has(lane.id)" :aria-label="`${lane.name} würfeln`" @click="rollTracks([lane.id])">Würfeln</button>
        <button type="button" class="hold" :aria-pressed="held.has(lane.id)" :aria-label="`${lane.name} festhalten`" @click="toggleHold(lane.id)">{{ held.has(lane.id) ? "Gehalten" : "Halten" }}</button>
      </div>
    </section>

    <div class="moods">
      <label class="energy">
        <span>Energie <output>{{ energy }}</output></span>
        <input v-model.number="energy" type="range" min="0" :max="MAX_ENERGY" step="1" />
        <span class="ends"><span>ruhig</span><span>voller Groove</span></span>
      </label>
      <label class="energy mood">
        <span>Stimmung <output>{{ MODES[mood]!.name }}</output></span>
        <input v-model.number="mood" type="range" min="0" :max="MODES.length - 1" step="1" />
        <span class="ends"><span>traurig</span><span>fröhlich</span></span>
      </label>
    </div>

    <fieldset class="effects">
      <legend>Effekte</legend>
      <label v-for="control in EFFECT_CONTROLS" :key="control.id" :title="control.hint">
        <span>{{ control.name }} <output>{{ effects[control.id] }}</output></span>
        <input v-model.number="effects[control.id]" type="range" :min="EFFECT_RANGES[control.id][0]" :max="EFFECT_RANGES[control.id][1]" step="1" />
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
      <kbd>Leertaste</kbd> Start/Pause · <kbd>1</kbd>–<kbd>4</kbd> Spur würfeln · <kbd>Shift</kbd>+<kbd>1</kbd>–<kbd>4</kbd> Spur festhalten · <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>R</kbd> Instrument wechseln · <kbd>0</kbd> alles würfeln · <kbd>Z</kbd> zurück · <kbd>M</kbd> merken ·
      <kbd>↑</kbd> <kbd>↓</kbd> Energie · <kbd>←</kbd> <kbd>→</kbd> Stimmung<br />
      Medientasten, auch wenn der Tab im Hintergrund ist: Play/Pause · Weiter würfelt alles, was nicht gehalten ist · Zurück holt den Groove vor dem letzten Würfeln wieder
    </p>

    <footer>{{ versionLabel() }}</footer>
    </div>

    <aside class="logbook" aria-label="Logbuch">
      <h2>Logbuch</h2>
      <p v-if="saveFailed" class="warning">Der Browser hat das Speichern abgelehnt. Was du jetzt merkst, ist nach dem Schließen der Seite weg.</p>
      <template v-for="section in sections" :key="section.id">
        <h3>{{ section.title }}</h3>
        <p v-if="!section.entries.length" class="empty">{{ section.empty }}</p>
        <ul v-else>
          <li v-for="(entry, index) in section.entries" :key="`${entry.at}-${index}`">
            <button type="button" class="entry" @click="recall(entry)">
              <span>{{ when(entry.at) }} · {{ entry.name }}</span>
              <small>{{ chordsOf(entry) }}</small>
            </button>
            <button type="button" class="forget" :aria-label="`${entry.name} löschen`" @click="forget(section.id, entry)">×</button>
          </li>
        </ul>
      </template>
    </aside>
  </main>
</template>

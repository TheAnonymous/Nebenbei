<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { Engine } from "./audio/engine";
import { mediaKeysPlaying, setUpMediaKeys } from "./media-keys";
import type { Groove, TrackId } from "./music/groove";
import { BASS_STEPS, chordName, DRUM_STEPS, DRUM_VOICES, LOOP_STEPS, mutate, roll, rollGroove, STAB_STEPS, TRACKS } from "./music/groove";
import { versionLabel } from "./version";

/** One small change every eight bars (about 16 seconds). */
const MUTATE_EVERY_LOOPS = 2;
const MAX_ENERGY = 10;
// ponytail: the way back lives in memory and ends with the page; the logbook (step 3) keeps it.
const MAX_HISTORY = 50;

// Shallow refs: a groove is replaced as a whole with every change, never edited in place.
const groove = shallowRef(rollGroove(Math.random));
const history = shallowRef<Groove[]>([]);
const energy = ref(5);
const volume = ref(80);
const playing = ref(false);
const step = ref(-1);
const held = ref(new Set<TrackId>());
/** Tracks whose roll waits for the bar line. */
const waiting = ref(new Set<TrackId>());
/** Tracks that have just changed and glow for a moment. */
const changed = ref(new Set<TrackId>());

const engine = new Engine(groove.value);
watch(energy, (value) => (engine.energy = value / MAX_ENERGY), { immediate: true });
watch(volume, (value) => (engine.volume = value / 100), { immediate: true });

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
  loops += 1;
  const free = TRACKS.filter((track) => !held.value.has(track));
  if (loops === 1 || loops % MUTATE_EVERY_LOOPS !== 1 || !free.length) return;
  const result = mutate(groove.value, Math.random, free);
  show(result.groove, [result.track]);
};

/** New patterns for the tracks that are not held. What was there before stays within reach of `back`. */
function rollTracks(tracks: readonly TrackId[]): void {
  const free = tracks.filter((track) => !held.value.has(track) && !waiting.value.has(track));
  if (!free.length) return;
  for (const track of free) waiting.value.add(track);
  onBarLine(() => {
    history.value = [...history.value, groove.value].slice(-MAX_HISTORY);
    let next = groove.value;
    for (const track of free) {
      next = roll(next, track, Math.random);
      waiting.value.delete(track);
    }
    show(next, free);
  });
}

/** Brings back the groove from before the last roll. Held tracks stay as they are. */
function back(): void {
  onBarLine(() => {
    const previous = history.value.at(-1);
    if (!previous) return;
    history.value = history.value.slice(0, -1);
    const free = TRACKS.filter((track) => !held.value.has(track));
    const next = { ...groove.value };
    for (const track of free) Object.assign(next, { [track]: previous[track] });
    show(next, free);
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
  const arrow = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
  // The physical digit keys, so Shift+1 works on every keyboard layout.
  const digit = /^Digit(\d)$/.exec(event.code)?.[1];
  const track = digit ? TRACKS[Number(digit) - 1] : undefined;
  if (arrow) {
    // A focused slider moves by itself.
    if (target === "INPUT") return;
    energy.value = Math.min(MAX_ENERGY, Math.max(0, energy.value + arrow));
  } else if (event.repeat) return;
  else if (track && event.shiftKey) toggleHold(track);
  else if (track) rollTracks([track]);
  else if (digit === "0") rollTracks(TRACKS);
  else if (event.key.toLowerCase() === "z") back();
  // A focused button is pressed by the space bar itself.
  else if (event.code === "Space" && target !== "BUTTON") void toggle();
  else return;
  event.preventDefault();
}

/** After a mouse click the control lets go of the keyboard, so space stays Start/Pause and the arrows stay the energy. */
function releaseFocus(event: MouseEvent): void {
  if (event.detail > 0 && (event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement)) event.target.blur();
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
  setUpMediaKeys({ play: () => setPlaying(true), pause: () => setPlaying(false), next: () => rollTracks(TRACKS), previous: back });
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
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
  const { drums, bass, chords, melody } = groove.value;
  const on = (item: { min: number }): boolean => item.min <= energy.value / MAX_ENERGY + 1e-9;
  const lane = (id: TrackId, name: string, rows: number, marks: Mark[], labels: string[] = []) => ({ id, name, rows, marks, labels });
  return [
    lane("drums", "Drums", DRUM_VOICES.length, across(drums, DRUM_STEPS).map((hit) => ({ step: hit.step, len: 1, row: DRUM_VOICES.indexOf(hit.voice), on: on(hit) }))),
    lane("bass", "Bass", 5, across(bass, BASS_STEPS).map((note) => ({ step: note.step, len: note.len, row: 4 - note.tone, on: on(note) }))),
    lane("chords", "Akkorde", 1, across(chords.stabs, STAB_STEPS).map((stab) => ({ step: stab.step, len: stab.len, row: 0, on: on(stab) })), chords.bars.map((chord) => chordName(chords.key, chord))),
    lane("melody", "Melodie", 6, melody.map((note) => ({ step: note.step, len: note.len, row: 5 - note.tone, on: on(note) }))),
  ];
});

const percent = (part: number, whole: number): string => `${(part / whole) * 100}%`;
</script>

<template>
  <main @click="releaseFocus">
    <header>
      <h1>Nebenbei</h1>
      <p>Lo-Fi-House, der von allein läuft und sich langsam verändert.</p>
    </header>

    <div class="actions">
      <button class="play" type="button" @click="toggle">{{ playing ? "Pause" : "Start" }}</button>
      <button type="button" @click="rollTracks(TRACKS)">Alles würfeln <kbd>0</kbd></button>
      <button type="button" :disabled="!history.length" @click="back">Zurück <kbd>Z</kbd></button>
    </div>

    <section class="tracks" aria-label="Spuren">
      <div v-for="(lane, index) in lanes" :key="lane.id" class="track" :class="[lane.id, { changed: changed.has(lane.id), held: held.has(lane.id) }]">
        <span class="name"><kbd>{{ index + 1 }}</kbd> {{ lane.name }}</span>
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

    <label class="energy">
      <span>Energie <output>{{ energy }}</output></span>
      <input v-model.number="energy" type="range" min="0" :max="MAX_ENERGY" step="1" />
      <span class="ends"><span>ruhig</span><span>voller Groove</span></span>
    </label>

    <label class="volume">
      <span>Lautstärke</span>
      <input v-model.number="volume" type="range" min="0" max="100" />
    </label>

    <p class="keys">
      <kbd>Leertaste</kbd> Start/Pause · <kbd>1</kbd>–<kbd>4</kbd> Spur würfeln · <kbd>Shift</kbd>+<kbd>1</kbd>–<kbd>4</kbd> Spur festhalten · <kbd>0</kbd> alles würfeln · <kbd>Z</kbd> zurück ·
      <kbd>↑</kbd> <kbd>↓</kbd> Energie<br />
      Medientasten, auch wenn der Tab im Hintergrund ist: Play/Pause · Weiter würfelt alles, was nicht gehalten ist · Zurück holt den Groove vor dem letzten Würfeln wieder
    </p>

    <footer>{{ versionLabel() }}</footer>
  </main>
</template>

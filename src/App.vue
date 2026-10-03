<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { Engine } from "./audio/engine";
import type { TrackId } from "./music/groove";
import { BASS_STEPS, chordName, DRUM_STEPS, DRUM_VOICES, LOOP_STEPS, mutate, rollGroove, STAB_STEPS } from "./music/groove";
import { versionLabel } from "./version";

/** One small change every eight bars (about 16 seconds). */
const MUTATE_EVERY_LOOPS = 2;

// A shallow ref: the groove is replaced as a whole with every change, never edited in place.
const groove = shallowRef(rollGroove(Math.random));
const energy = ref(5);
const volume = ref(80);
const playing = ref(false);
const step = ref(-1);
const changed = ref<TrackId | null>(null);

const engine = new Engine(groove.value);
watch(energy, (value) => (engine.energy = value / 10), { immediate: true });
watch(volume, (value) => (engine.volume = value / 100), { immediate: true });

let loops = 0;
let changedTimer = 0;
engine.onLoop = () => {
  loops += 1;
  if (loops % MUTATE_EVERY_LOOPS !== 1 || loops === 1) return;
  const result = mutate(groove.value, Math.random);
  groove.value = engine.groove = result.groove;
  changed.value = result.track;
  clearTimeout(changedTimer);
  changedTimer = window.setTimeout(() => (changed.value = null), 5000);
};

let frame = 0;
function follow(): void {
  step.value = engine.position();
  frame = requestAnimationFrame(follow);
}

async function toggle(): Promise<void> {
  playing.value = await engine.toggle();
  cancelAnimationFrame(frame);
  if (playing.value) follow();
}

onBeforeUnmount(() => {
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
  const on = (item: { min: number }): boolean => item.min <= energy.value / 10 + 1e-9;
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
  <main>
    <header>
      <h1>Nebenbei</h1>
      <p>Lo-Fi-House, der von allein läuft und sich langsam verändert.</p>
    </header>

    <button class="play" type="button" @click="toggle">{{ playing ? "Pause" : "Start" }}</button>

    <section class="tracks" aria-label="Spuren">
      <div v-for="lane in lanes" :key="lane.id" class="track" :class="[lane.id, { changed: changed === lane.id }]">
        <span class="name">{{ lane.name }}</span>
        <div class="lane">
          <i
            v-for="(mark, index) in lane.marks"
            :key="index"
            :class="{ off: !mark.on }"
            :style="{ left: percent(mark.step, LOOP_STEPS), width: percent(mark.len, LOOP_STEPS), top: percent(mark.row, lane.rows), height: percent(1, lane.rows) }"
          />
          <span v-for="(label, bar) in lane.labels" :key="bar" class="chord" :style="{ left: percent(bar, lane.labels.length) }">{{ label }}</span>
          <b v-if="step >= 0" :style="{ left: percent(step, LOOP_STEPS) }" />
        </div>
      </div>
    </section>

    <label class="energy">
      <span>Energie <output>{{ energy }}</output></span>
      <input v-model.number="energy" type="range" min="0" max="10" step="1" />
      <span class="ends"><span>ruhig</span><span>voller Groove</span></span>
    </label>

    <label class="volume">
      <span>Lautstärke</span>
      <input v-model.number="volume" type="range" min="0" max="100" />
    </label>

    <footer>{{ versionLabel() }}</footer>
  </main>
</template>

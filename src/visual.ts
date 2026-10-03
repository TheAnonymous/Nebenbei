import type { Pulse } from "./audio/engine";

/*
 * The sky behind the page: four bands of northern light, one per track, that
 * swell with what their track plays. The kick sends a glow up from below,
 * melody notes become lights, hats flicker as sparks. The mood colours it
 * (blue night when sad, golden evening when happy) and turns the lights: they
 * sink like rain when sad and rise when happy. The energy makes it brighter
 * and faster. It stays dark enough to read the page on top of it.
 *
 * The canvas is small and stretched over the window; that softens it and
 * keeps the work light. Everything that reacts to the music follows it with
 * a short glide instead of jumping, so the picture stays calm.
 */

export interface Scene {
  playing: boolean;
  /** 0 (calm) to 1 (full groove). */
  energy: number;
  /** 0 (sad) to 1 (happy). */
  mood: number;
  /** What has sounded since the last frame. */
  pulses: Pulse[];
}

/** How strongly each track sounds right now (0..1; melody, chords, bass, drums) and the kick on its own. */
export type Feedback = (levels: readonly number[], kick: number) => void;

/** Canvas pixels per screen pixel. */
const SCALE = 1 / 4;
const TAU = Math.PI * 2;
/** The colour of each mood, as a hue: blue, violet, pink, orange, gold (past 360 the circle starts again). */
const MOOD_HUES = [225, 262, 320, 378, 398];
/** How many upright strips a band is painted in. */
const STRIPS = 120;
/** Top to bottom: melody, chords, bass, drums. */
export const ROWS = { melody: 0, chords: 1, bass: 2, drums: 3 } as const;
/** Seconds a band takes to follow its track up, and to fade again. */
const ATTACK = 0.07;
const RELEASE = 0.45;

interface Light {
  x: number;
  y: number;
  size: number;
  age: number;
  life: number;
  /** How far it rises over its life, as a share of the height; below zero it sinks. */
  rise: number;
}

const hsla = (hue: number, saturation: number, lightness: number, alpha: number): string => `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;

/** Starts painting; returns the function that stops it. */
export function startVisual(canvas: HTMLCanvasElement, scene: () => Scene, feedback: Feedback): () => void {
  const context = canvas.getContext("2d");
  if (!context) return () => undefined;
  // Whoever asked for less motion gets the colours, standing still.
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** What the music asks for, and what is shown: the shown values glide after the asked ones. */
  const asked = [0, 0, 0, 0];
  const levels = [0, 0, 0, 0];
  let kickAsked = 0;
  let kick = 0;
  let flash = 0;
  let energy = 0.5;
  let mood = 0;
  let tint = 0;
  let tintGoal = 0;
  let clock = 0;
  let orbs: Light[] = [];
  let sparks: Light[] = [];
  const dust = Array.from({ length: 36 }, () => ({ x: Math.random(), y: Math.random(), speed: 0.004 + Math.random() * 0.012, size: 0.5 + Math.random() * 1.2 }));

  const resize = (): void => {
    canvas.width = Math.ceil(window.innerWidth * SCALE);
    canvas.height = Math.ceil(window.innerHeight * SCALE);
  };
  resize();
  window.addEventListener("resize", resize);

  const take = (pulse: Pulse): void => {
    const row = ROWS[pulse.track];
    if (pulse.bar) {
      // Every bar's chord shifts the colour a little.
      tintGoal = (Math.random() - 0.5) * 36;
    } else if (pulse.track === "melody") {
      asked[row] = Math.max(asked[row]!, pulse.vel);
      const high = Math.min(1, Math.max(0, ((pulse.pitch ?? 72) - 55) / 34));
      // Sad lights start high and sink, happy ones start low and rise.
      orbs.push({ x: 0.12 + 0.76 * high, y: 0.25 + 0.4 * mood - 0.15 * high, size: 0.02 + 0.03 * pulse.vel, age: 0, life: 2.6, rise: -0.22 + 0.5 * mood + 0.08 * Math.random() });
    } else if (pulse.voice === "kick") {
      kickAsked = Math.max(kickAsked, pulse.vel);
      asked[row] = Math.max(asked[row]!, 0.5 * pulse.vel);
    } else if (pulse.voice === "clap") {
      flash = 1;
      asked[row] = 1;
    } else if (pulse.voice) {
      asked[row] = Math.min(1, asked[row]! + 0.2 * pulse.vel);
      sparks.push({ x: Math.random(), y: Math.random() * 0.55, size: pulse.voice === "open" || pulse.voice === "rim" ? 0.012 : 0.007, age: 0, life: pulse.voice === "open" ? 0.7 : 0.4, rise: 0 });
    } else {
      asked[row] = Math.max(asked[row]!, pulse.vel);
    }
  };

  const paint = (): void => {
    const { width, height } = canvas;
    const place = mood * (MOOD_HUES.length - 1);
    const from = Math.min(MOOD_HUES.length - 2, Math.floor(place));
    const hue = MOOD_HUES[from]! + (MOOD_HUES[from + 1]! - MOOD_HUES[from]!) * (place - from) + tint;

    context.globalCompositeOperation = "source-over";
    const sky = context.createLinearGradient(0, 0, 0, height);
    // Neighbouring colours above and below: towards indigo in the blue night, towards red in the golden evening.
    sky.addColorStop(0, hsla(hue + 20 - 50 * mood, 45, 5 + 2 * energy, 1));
    sky.addColorStop(1, hsla(hue - 12, 55, 8 + 5 * energy, 1));
    context.fillStyle = sky;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = "lighter";

    // The kick: a glow that spreads from below the horizon.
    if (kick > 0.005) {
      const glow = context.createRadialGradient(width / 2, height * 1.05, 0, width / 2, height * 1.05, height * (0.4 + 0.9 * (1 - kick)));
      glow.addColorStop(0, hsla(hue - 6, 90, 58, 0.4 * kick));
      glow.addColorStop(1, hsla(hue - 6, 90, 58, 0));
      context.fillStyle = glow;
      context.fillRect(0, 0, width, height);
    }
    if (flash > 0.005) {
      context.fillStyle = hsla(hue + 10, 70, 75, 0.05 * flash);
      context.fillRect(0, 0, width, height);
    }

    // The bands: each is painted in narrow upright strips that fade out above and below, so it has no edge.
    // Whole pixels: strips that overlap or leave a gap would show as upright lines.
    const edge = (at: number): number => Math.round((at * width) / STRIPS);
    for (let row = 0; row < 4; row += 1) {
      const level = levels[row]!;
      const center = height * (0.2 + 0.2 * row);
      const swing = height * (0.035 + 0.03 * energy + 0.03 * level) * (1 + 0.25 * kick);
      const half = height * (0.1 + 0.12 * level + 0.05 * energy);
      const colour = hue + (row - 2.5) * 14;
      const alpha = 0.09 + 0.1 * energy + 0.34 * level;
      for (let at = 0; at < STRIPS; at += 1) {
        const x = (edge(at) + edge(at + 1)) / 2;
        const y = center + swing * (Math.sin(((1.3 + row * 0.35) * TAU * x) / width + clock * (0.5 + row * 0.13) + row * 1.7) + 0.5 * Math.sin(((2.9 - row * 0.3) * TAU * x) / width - clock * 0.8 + row));
        const fade = context.createLinearGradient(0, y - half, 0, y + half);
        fade.addColorStop(0, hsla(colour, 80, 56, 0));
        fade.addColorStop(0.5, hsla(colour, 80, 56, alpha));
        fade.addColorStop(1, hsla(colour, 80, 56, 0));
        context.fillStyle = fade;
        context.fillRect(edge(at), y - half, edge(at + 1) - edge(at), half * 2);
      }
    }

    // Melody notes become lights that drift and fade.
    for (const orb of orbs) {
      const done = orb.age / orb.life;
      const x = orb.x * width;
      const y = (orb.y - orb.rise * (1 - (1 - done) ** 2)) * height;
      const radius = orb.size * height * (1 + done);
      // It comes up quickly and leaves slowly.
      const shine = Math.min(1, orb.age / 0.08) * (1 - done) ** 2;
      const light = context.createRadialGradient(x, y, 0, x, y, radius);
      light.addColorStop(0, hsla(hue + 30 - 20 * mood, 95, 78, 0.9 * shine));
      light.addColorStop(1, hsla(hue + 30 - 20 * mood, 95, 78, 0));
      context.fillStyle = light;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    for (const spark of sparks) {
      const done = spark.age / spark.life;
      const radius = spark.size * height * 2.5;
      const light = context.createRadialGradient(spark.x * width, spark.y * height, 0, spark.x * width, spark.y * height, radius);
      light.addColorStop(0, hsla(hue + 10, 60, 88, 0.8 * (1 - done) ** 2));
      light.addColorStop(1, hsla(hue + 10, 60, 88, 0));
      context.fillStyle = light;
      context.fillRect(spark.x * width - radius, spark.y * height - radius, radius * 2, radius * 2);
    }
    // Dust in the light, always.
    context.fillStyle = hsla(hue + 10, 50, 80, 0.14 + 0.1 * energy);
    for (const speck of dust) {
      context.beginPath();
      context.arc(((speck.x + clock * speck.speed) % 1) * width, (speck.y + 0.02 * Math.sin(clock * 0.3 + speck.x * 9)) * height, speck.size, 0, TAU);
      context.fill();
    }
  };

  let handle = 0;
  let frame = 0;
  let last = performance.now();
  const loop = (now: number): void => {
    handle = requestAnimationFrame(loop);
    const { playing, energy: energyGoal, mood: moodGoal, pulses } = scene();
    frame += 1;
    // Paused, the sky only drifts slowly: every other frame is smooth enough.
    if ((!playing || still) && frame % 2) return;
    const seconds = Math.min(0.1, (now - last) / 1000);
    last = now;

    if (!still) {
      pulses.forEach(take);
      clock += seconds * (playing ? 0.25 + 0.7 * energy + 0.25 * mood : 0.12);
    }
    const glide = (shown: number, goal: number, time: number): number => shown + (goal - shown) * (1 - Math.exp(-seconds / time));
    for (let row = 0; row < 4; row += 1) {
      asked[row] = glide(asked[row]!, 0, RELEASE);
      levels[row] = glide(levels[row]!, asked[row]!, ATTACK);
    }
    kickAsked = glide(kickAsked, 0, 0.22);
    kick = glide(kick, kickAsked, 0.03);
    flash = glide(flash, 0, 0.12);
    energy = glide(energy, energyGoal, 0.6);
    mood = glide(mood, moodGoal, 0.9);
    tint = glide(tint, tintGoal, 1.4);
    for (const light of [...orbs, ...sparks]) light.age += seconds;
    orbs = orbs.filter((orb) => orb.age < orb.life).slice(-40);
    sparks = sparks.filter((spark) => spark.age < spark.life).slice(-60);

    paint();
    feedback(levels, kick);
  };
  handle = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(handle);
    window.removeEventListener("resize", resize);
  };
}

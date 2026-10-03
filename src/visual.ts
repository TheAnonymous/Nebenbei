import type { Pulse } from "./audio/engine";

/*
 * The sky behind the page: four bands of northern light, one per track, that
 * swell with what their track plays. The kick sends a glow up from below,
 * melody notes rise as lights, hats flicker as sparks. The mood colours it
 * (blue night when sad, golden evening when happy), the energy makes it
 * brighter and faster. It stays dark enough to read the page on top of it. The canvas is small and blurred by CSS: that is what
 * makes it glow, and it keeps the work light.
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

/** Canvas pixels per screen pixel. */
const SCALE = 1 / 3;
const TAU = Math.PI * 2;
/** The colour of each mood, as a hue: blue, violet, pink, orange, gold (past 360 the circle starts again). */
const MOOD_HUES = [225, 262, 320, 380, 405];
/** Top to bottom: melody, chords, bass, drums. */
const ROWS = { melody: 0, chords: 1, bass: 2, drums: 3 } as const;

interface Light {
  x: number;
  y: number;
  size: number;
  age: number;
  life: number;
  /** How far it rises over its life, as a share of the height. */
  rise: number;
}

const hsla = (hue: number, saturation: number, lightness: number, alpha: number): string => `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;

/** Starts painting; returns the function that stops it. */
export function startVisual(canvas: HTMLCanvasElement, scene: () => Scene): () => void {
  const context = canvas.getContext("2d");
  if (!context) return () => undefined;
  // Whoever asked for less motion gets the colours, standing still.
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const levels = [0, 0, 0, 0];
  let kick = 0;
  let flash = 0;
  let energy = 0.5;
  let mood = 0;
  let tint = 0;
  let tintGoal = 0;
  let clock = 0;
  let orbs: Light[] = [];
  let sparks: Light[] = [];
  const dust = Array.from({ length: 36 }, () => ({ x: Math.random(), y: Math.random(), speed: 0.004 + Math.random() * 0.012, size: 0.6 + Math.random() * 1.6 }));

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
      levels[row] = Math.max(levels[row]!, pulse.vel);
      const high = Math.min(1, Math.max(0, ((pulse.pitch ?? 72) - 60) / 28));
      orbs.push({ x: 0.12 + 0.76 * high, y: 0.6 - 0.2 * high, size: 0.02 + 0.03 * pulse.vel, age: 0, life: 2.4, rise: 0.2 + 0.15 * Math.random() });
    } else if (pulse.voice === "kick") {
      kick = Math.max(kick, pulse.vel);
      levels[row] = Math.max(levels[row]!, 0.5 * pulse.vel);
    } else if (pulse.voice === "clap") {
      flash = 1;
      levels[row] = 1;
    } else if (pulse.voice) {
      levels[row] = Math.min(1, levels[row]! + 0.2 * pulse.vel);
      sparks.push({ x: Math.random(), y: Math.random() * 0.55, size: pulse.voice === "open" || pulse.voice === "rim" ? 0.012 : 0.006, age: 0, life: pulse.voice === "open" ? 0.6 : 0.3, rise: 0 });
    } else {
      levels[row] = Math.max(levels[row]!, pulse.vel);
    }
  };

  const paint = (): void => {
    const { width, height } = canvas;
    const place = mood * (MOOD_HUES.length - 1);
    const from = Math.min(MOOD_HUES.length - 2, Math.floor(place));
    const hue = MOOD_HUES[from]! + (MOOD_HUES[from + 1]! - MOOD_HUES[from]!) * (place - from) + tint;

    context.globalCompositeOperation = "source-over";
    const sky = context.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, hsla(hue + 20, 45, 5 + 2 * energy, 1));
    sky.addColorStop(1, hsla(hue - 12, 55, 8 + 5 * energy, 1));
    context.fillStyle = sky;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = "lighter";

    // The kick: a glow that spreads from below the horizon.
    if (kick > 0.01) {
      const glow = context.createRadialGradient(width / 2, height * 1.05, 0, width / 2, height * 1.05, height * (0.4 + 0.9 * (1 - kick)));
      glow.addColorStop(0, hsla(hue + 12, 90, 58, 0.4 * kick));
      glow.addColorStop(1, hsla(hue + 12, 90, 58, 0));
      context.fillStyle = glow;
      context.fillRect(0, 0, width, height);
    }
    if (flash > 0.01) {
      context.fillStyle = hsla(hue + 30, 70, 75, 0.05 * flash);
      context.fillRect(0, 0, width, height);
    }

    // The bands: each is painted as a few layers that get thinner, so its edge is soft.
    const layers = 5;
    for (let row = 0; row < 4; row += 1) {
      const level = levels[row]!;
      const center = height * (0.2 + 0.2 * row);
      const swing = height * (0.035 + 0.03 * energy + 0.03 * level) * (1 + 0.25 * kick);
      const curve = (x: number): number =>
        center + swing * (Math.sin(((1.3 + row * 0.35) * TAU * x) / width + clock * (0.5 + row * 0.13) + row * 1.7) + 0.5 * Math.sin(((2.9 - row * 0.3) * TAU * x) / width - clock * 0.8 + row));
      context.fillStyle = hsla(hue + (row - 1.5) * 16, 80, 56, (0.07 + 0.09 * energy + 0.3 * level) / layers);
      for (let layer = 0; layer < layers; layer += 1) {
        const half = height * (0.07 + 0.1 * level + 0.04 * energy) * (1 - layer / layers);
        context.beginPath();
        for (let point = 0; point <= 40; point += 1) context.lineTo((point * width) / 40, curve((point * width) / 40) - half);
        for (let point = 40; point >= 0; point -= 1) context.lineTo((point * width) / 40, curve((point * width) / 40) + half);
        context.fill();
      }
    }

    // Melody notes rise as lights and fade.
    for (const orb of orbs) {
      const done = orb.age / orb.life;
      const x = orb.x * width;
      const y = (orb.y - orb.rise * (1 - (1 - done) ** 2)) * height;
      const radius = orb.size * height * (1 + done);
      const light = context.createRadialGradient(x, y, 0, x, y, radius);
      light.addColorStop(0, hsla(hue + 40, 95, 78, 0.9 * (1 - done) ** 2));
      light.addColorStop(1, hsla(hue + 40, 95, 78, 0));
      context.fillStyle = light;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    for (const spark of sparks) {
      context.fillStyle = hsla(hue + 50, 60, 88, 0.9 * (1 - spark.age / spark.life));
      context.beginPath();
      context.arc(spark.x * width, spark.y * height, spark.size * height, 0, TAU);
      context.fill();
    }
    // Dust in the light, always.
    context.fillStyle = hsla(hue + 40, 50, 80, 0.16 + 0.1 * energy);
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
    // Paused, the sky only drifts: a few frames a second are enough.
    if ((!playing || still) && frame % 6) return;
    const seconds = Math.min(0.2, (now - last) / 1000);
    last = now;

    if (!still) {
      pulses.forEach(take);
      clock += seconds * (playing ? 0.3 + 0.9 * energy : 0.12);
    }
    const fade = (value: number, time: number): number => value * Math.exp(-seconds / time);
    for (let row = 0; row < 4; row += 1) levels[row] = fade(levels[row]!, 0.4);
    kick = fade(kick, 0.22);
    flash = fade(flash, 0.12);
    energy += (energyGoal - energy) * Math.min(1, seconds * 2);
    mood += (moodGoal - mood) * Math.min(1, seconds * 1.5);
    tint += (tintGoal - tint) * Math.min(1, seconds * 0.8);
    for (const light of [...orbs, ...sparks]) light.age += seconds;
    orbs = orbs.filter((orb) => orb.age < orb.life).slice(-40);
    sparks = sparks.filter((spark) => spark.age < spark.life).slice(-60);

    paint();
  };
  handle = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(handle);
    window.removeEventListener("resize", resize);
  };
}

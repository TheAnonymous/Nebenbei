import type { Pulse } from "./audio/engine";

/*
 * The sky behind the page, painted on the graphics card. A slow nebula flows
 * through a palette of four colours per mood (deep night blue when sad,
 * golden evening when happy). In front of it hang four aurora curtains, one
 * per track, with a bright lower edge and rays rising from it; each flares
 * with what its track plays. Stars twinkle with the hats, the kick lets the
 * whole sky breathe and glows up from the horizon, melody notes become
 * lights that sink when sad and rise when happy, and now and then a star
 * falls. Fine grain keeps the gradients from banding, a vignette and a soft
 * tone curve keep it dark enough to read the page on top.
 *
 * The canvas is at most half the window's resolution and stretched over it,
 * which softens it; it is painted at most 30 times a second (20 with the calm
 * sky, 10 while paused). Everything that reacts to the music glides instead
 * of jumping. Without WebGL the page keeps its plain background, and the
 * lanes still glow with their tracks.
 */

export interface Scene {
  playing: boolean;
  /** 0 (calm) to 1 (full groove). */
  energy: number;
  /** 0 (sad) to 1 (happy). */
  mood: number;
  /** The calm sky, for focused work. */
  calm: boolean;
  /** Kick and clap pause (the tides' breakdown): the sky opens up a little. */
  open: boolean;
  /** Hands out what has sounded since the last painted frame; called only for frames that are painted, so nothing is lost. */
  pulses: () => Pulse[];
}

/** How strongly each track sounds right now (0..1; melody, chords, bass, drums) and the kick on its own. */
export type Feedback = (levels: readonly number[], kick: number) => void;

/** Order of the levels: melody, chords, bass, drums (top to bottom in the sky). */
export const ROWS = { melody: 0, chords: 1, bass: 2, drums: 3 } as const;
/** At most this many pictures a second: while playing, with the calm sky, while paused, when motion is reduced. */
const FRAME_RATES = { playing: 30, calm: 20, paused: 10, still: 2 } as const;
/** Canvas pixels per screen pixel, and the widest canvas. */
const SCALE = 0.5;
const MAX_WIDTH = 960;
/** Seconds a curtain takes to follow its track up, and to fade again. */
const ATTACK = 0.07;
const RELEASE = 0.45;
const MAX_LIGHTS = 12;

/**
 * Four colours per mood: the top of the sky, the depth of the nebula, the
 * glow at the horizon and in the curtains, the brightest light. Moll is a
 * night with a teal aurora, Lydisch a golden evening under a violet sky.
 */
const PALETTES: readonly (readonly [string, string, string, string])[] = [
  ["#03071a", "#0e2552", "#1f9aa8", "#aef3ff"],
  ["#070823", "#251e6a", "#4f7fd6", "#d2c4ff"],
  ["#10072a", "#4a1b68", "#d0508e", "#ffc2e2"],
  ["#140a2c", "#5a2350", "#f07048", "#ffd2b0"],
  ["#1a0f30", "#6a2d4c", "#ff9a3c", "#ffe7b0"],
];
const rgb = (hex: string): number[] => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
const PALETTE_RGB = PALETTES.map((palette) => palette.map(rgb));

/** The palette at a mood between 0 and 1, blended between its two neighbours. */
function paletteAt(mood: number): number[][] {
  const place = Math.min(1, Math.max(0, mood)) * (PALETTE_RGB.length - 1);
  const from = Math.min(PALETTE_RGB.length - 2, Math.floor(place));
  const amount = place - from;
  return PALETTE_RGB[from]!.map((colour, index) => colour.map((value, channel) => value + (PALETTE_RGB[from + 1]![index]![channel]! - value) * amount));
}

const VERTEX = `
attribute vec2 aCorner;
void main() { gl_Position = vec4(aCorner, 0.0, 1.0); }
`;

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uTime, uEnergy, uMood, uKick, uFlash, uSpark, uCalm, uOpen, uTint;
uniform vec4 uLevels;
uniform vec3 uC0, uC1, uC2, uC3;
uniform vec4 uLights[${MAX_LIGHTS}];
uniform vec4 uShoot;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amount = 0.5;
  mat2 turn = mat2(1.6, 1.2, -1.2, 1.6);
  for (int octave = 0; octave < 5; octave++) {
    sum += amount * noise(p);
    p = turn * p;
    amount *= 0.5;
  }
  return sum;
}

// Turns a colour's hue around the grey axis: each bar's chord shifts the palette a little.
vec3 tint(vec3 colour, float angle) {
  vec3 axis = vec3(0.57735);
  float c = cos(angle);
  return colour * c + cross(axis, colour) * sin(angle) + axis * dot(axis, colour) * (1.0 - c);
}

float level(int row) {
  if (row == 0) return uLevels.x;
  if (row == 1) return uLevels.y;
  if (row == 2) return uLevels.z;
  return uLevels.w;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  // The whole sky breathes in with the kick.
  p *= 1.0 - 0.02 * uKick;
  float t = uTime;
  vec3 c0 = tint(uC0, uTint);
  vec3 c1 = tint(uC1, uTint);
  vec3 c2 = tint(uC2, uTint);
  vec3 c3 = tint(uC3, uTint);

  // The nebula: noise folded into itself twice, which makes it flow like smoke.
  vec2 q = vec2(fbm(p * 1.3 + vec2(0.0, 0.05 * t)), fbm(p * 1.3 + vec2(5.2, -0.04 * t)));
  vec2 r = vec2(fbm(p * 1.5 + 3.0 * q + vec2(1.7, 9.2) + 0.03 * t), fbm(p * 1.5 + 3.0 * q + vec2(8.3, 2.8) - 0.025 * t));
  float n = fbm(p * 1.1 + 2.4 * r);
  // An evening gradient: the top of the sky above, a glow along the horizon.
  vec3 horizon = mix(c1, c2, 0.3 + 0.15 * uEnergy);
  vec3 colour = mix(horizon, c0, smoothstep(0.0, 0.75, uv.y));
  colour = mix(colour, c1, smoothstep(0.4, 0.95, n) * 0.5);
  colour += c2 * pow(smoothstep(0.55, 1.0, n), 2.0) * (0.12 + 0.25 * uEnergy + 0.25 * uOpen) * (0.5 + 0.5 * length(r));
  colour += c2 * 0.14 * exp(-uv.y * 6.0) * (0.6 + 0.4 * uEnergy);

  // The aurora: four curtains, melody at the top, drums at the bottom. Each hangs in folds,
  // shows in patches along the sky, is brightest at its lower edge and turns to a neighbouring
  // colour towards its top, like green northern lights turning violet.
  for (int row = 0; row < 4; row++) {
    float f = float(row);
    float lv = level(row);
    float fold = fbm(vec2(p.x * 1.3 + f * 3.1, 0.06 * t + f * 1.3));
    // Each curtain leans its own way, so their edges never run in parallel.
    float lean = (0.09 * f - 0.14) * p.x;
    float edge = 0.76 - 0.14 * f + lean + 0.18 * (fold - 0.5) + 0.04 * sin(p.x * 2.1 + 0.25 * t + f * 1.7);
    float above = uv.y - edge;
    float reach = 0.12 + 0.12 * lv + 0.05 * uEnergy;
    // A soft lower edge with a short glow below it, the rays fading upwards.
    float curtain = above > 0.0 ? exp(-above / reach) : exp(above * above / -0.0009);
    float rays = (0.25 + 0.75 * noise(vec2(p.x * 30.0 + f * 13.0 + 0.2 * t, 0.25 * t + f))) * (0.6 + 0.4 * noise(vec2(p.x * 9.0 - 0.15 * t, f * 7.0)));
    float patch = smoothstep(0.3, 0.62, fbm(vec2(p.x * 0.8 + f * 5.3 - 0.03 * t, f * 2.0 + 0.02 * t)));
    float strength = (0.16 + 0.18 * uEnergy + 0.75 * lv) * (1.0 - 0.45 * uCalm) + 0.15 * uOpen;
    vec3 band = mix(mix(c2, vec3(1.0), 0.15), tint(c3, 0.8), smoothstep(0.0, 2.0 * reach, above));
    colour += band * curtain * rays * patch * strength;
  }

  // Stars, fading towards the horizon, twinkling brighter with the hats.
  vec2 grid = p * 70.0;
  vec2 cell = floor(grid);
  float chance = hash(cell);
  if (chance > 0.97) {
    vec2 offset = vec2(hash(cell + 1.7), hash(cell + 3.1)) - 0.5;
    float star = smoothstep(0.22, 0.0, length(fract(grid) - 0.5 - offset * 0.5));
    float twinkle = 0.55 + 0.45 * sin(t * (1.5 + 3.0 * chance) + chance * 60.0);
    // Fewer stars in the golden evening than in the night.
    colour += mix(c3, vec3(1.0), 0.4) * star * twinkle * (0.5 + 1.1 * uSpark) * smoothstep(0.2, 0.6, uv.y) * (1.0 - 0.55 * uMood);
  }

  // A falling star: uShoot is where it starts, its angle and how far it has come (below 0: none).
  if (uShoot.w >= 0.0) {
    vec2 heading = vec2(cos(uShoot.z), sin(uShoot.z));
    vec2 head = uShoot.xy + heading * uShoot.w * 0.9;
    vec2 to = p - head;
    float behind = dot(to, -heading);
    float aside = length(to + heading * behind);
    float trail = smoothstep(0.005, 0.0, aside) * smoothstep(0.28, 0.0, behind) * step(0.0, behind);
    float glow = exp(-dot(to, to) / 0.0004);
    float fade = sin(3.14159 * clamp(uShoot.w, 0.0, 1.0));
    colour += (c3 * 1.1 + 0.3) * (trail + glow) * fade;
  }

  // The melody's lights.
  for (int index = 0; index < ${MAX_LIGHTS}; index++) {
    vec4 light = uLights[index];
    if (light.w <= 0.0) continue;
    vec2 away = (uv - light.xy) * vec2(aspect, 1.0);
    float near = dot(away, away) / (light.z * light.z);
    // A bright core in a wide halo of the mood's colour.
    colour += (mix(c3, vec3(1.0), 0.5) * exp(-near) + c2 * 0.35 * exp(-near * 0.08)) * light.w;
  }

  // The kick glows up from below, the clap lifts the whole sky a touch.
  colour += c2 * uKick * 0.3 * exp(-length(vec2(p.x * 0.8, uv.y + 0.1)) * 2.4) * (1.0 - uCalm);
  colour += c3 * uFlash * 0.035 * (1.0 - uCalm);

  // A vignette, a soft tone curve for the bright parts, and grain against banding.
  colour *= 1.0 - 0.45 * smoothstep(0.45, 1.2, length(p * vec2(0.85, 1.15)));
  colour = colour / (1.0 + 0.55 * colour);
  colour += (hash(gl_FragCoord.xy + fract(t * 7.3) * 91.0) - 0.5) * (0.018 + 0.012 * (1.0 - uCalm));
  gl_FragColor = vec4(max(colour, 0.0), 1.0);
}
`;

interface Light {
  x: number;
  y: number;
  size: number;
  age: number;
  life: number;
  /** How far it drifts over its life, as a share of the height; up when happy, down when sad. */
  drift: number;
}

/** The graphics card's side: the program and where its inputs go. */
interface Painter {
  gl: WebGLRenderingContext;
  uniform: (name: string) => WebGLUniformLocation | null;
}

function setUpPainter(canvas: HTMLCanvasElement): Painter | null {
  // The drawing stays readable after the frame (the tests compare frames); at this size it costs nothing.
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true, powerPreference: "low-power" });
  if (!gl) return null;
  const compile = (type: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    console.warn("Himmel: Shader nicht übersetzt", gl.getShaderInfoLog(shader));
    return null;
  };
  const vertex = compile(gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("Himmel: Programm nicht gebunden", gl.getProgramInfoLog(program));
    return null;
  }
  gl.useProgram(program);
  // One triangle that covers the whole canvas.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const corner = gl.getAttribLocation(program, "aCorner");
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
  const locations = new Map<string, WebGLUniformLocation | null>();
  return {
    gl,
    uniform: (name) => {
      if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
      return locations.get(name)!;
    },
  };
}

/** Starts painting; returns the function that stops it. */
export function startVisual(canvas: HTMLCanvasElement, scene: () => Scene, feedback: Feedback): () => void {
  // Whoever asked for less motion gets the colours, standing still.
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let painter = setUpPainter(canvas);
  const lost = (event: Event): void => {
    event.preventDefault();
    painter = null;
  };
  const restored = (): void => {
    painter = setUpPainter(canvas);
  };
  canvas.addEventListener("webglcontextlost", lost);
  canvas.addEventListener("webglcontextrestored", restored);

  /** What the music asks for, and what is shown: the shown values glide after the asked ones. */
  const asked = [0, 0, 0, 0];
  const levels = [0, 0, 0, 0];
  let kickAsked = 0;
  let kick = 0;
  let flash = 0;
  let spark = 0;
  let energy = 0.5;
  let mood = 0;
  let calm = 0;
  let open = 0;
  let tint = 0;
  let tintGoal = 0;
  let clock = 0;
  let lights: Light[] = [];
  /** The falling star: where it starts (in the shader's coordinates), its angle, how far it has come; null when there is none. */
  let shoot: { x: number; y: number; angle: number; progress: number } | null = null;
  const lightData = new Float32Array(MAX_LIGHTS * 4);

  const resize = (): void => {
    const scale = Math.min(SCALE, MAX_WIDTH / window.innerWidth);
    canvas.width = Math.max(1, Math.round(window.innerWidth * scale));
    canvas.height = Math.max(1, Math.round(window.innerHeight * scale));
  };
  resize();
  window.addEventListener("resize", resize);

  const take = (pulse: Pulse, quiet: boolean): void => {
    const row = ROWS[pulse.track];
    if (quiet) {
      // The calm sky only breathes with the tracks, gently; no lights, sparks or flashes.
      if (!pulse.bar) asked[row] = Math.max(asked[row]!, 0.35 * pulse.vel);
      return;
    }
    if (pulse.bar) {
      // Every bar's chord turns the palette a little.
      tintGoal = (Math.random() - 0.5) * 0.35;
    } else if (pulse.track === "melody") {
      asked[row] = Math.max(asked[row]!, pulse.vel);
      const high = Math.min(1, Math.max(0, ((pulse.pitch ?? 72) - 55) / 34));
      // Sad lights start high and sink, happy ones start low and rise; higher notes sit higher.
      lights.push({ x: 0.12 + 0.76 * high, y: 0.72 - 0.38 * mood + 0.14 * high, size: 0.012 + 0.014 * pulse.vel, age: 0, life: 2.6, drift: -0.22 + 0.5 * mood + 0.08 * Math.random() });
    } else if (pulse.voice === "kick") {
      kickAsked = Math.max(kickAsked, pulse.vel);
      asked[row] = Math.max(asked[row]!, 0.5 * pulse.vel);
    } else if (pulse.voice === "clap") {
      flash = 1;
      asked[row] = 1;
    } else if (pulse.voice) {
      asked[row] = Math.min(1, asked[row]! + 0.2 * pulse.vel);
      spark = Math.min(1, spark + (pulse.voice === "open" || pulse.voice === "rim" ? 0.5 : 0.25) * pulse.vel);
    } else {
      asked[row] = Math.max(asked[row]!, pulse.vel);
    }
  };

  const paint = (): void => {
    if (!painter) return;
    const { gl, uniform } = painter;
    gl.viewport(0, 0, canvas.width, canvas.height);
    const palette = paletteAt(mood);
    gl.uniform2f(uniform("uRes"), canvas.width, canvas.height);
    gl.uniform1f(uniform("uTime"), clock);
    gl.uniform1f(uniform("uEnergy"), energy);
    gl.uniform1f(uniform("uMood"), mood);
    gl.uniform1f(uniform("uKick"), kick);
    gl.uniform1f(uniform("uFlash"), flash);
    gl.uniform1f(uniform("uSpark"), spark);
    gl.uniform1f(uniform("uCalm"), calm);
    gl.uniform1f(uniform("uOpen"), open);
    gl.uniform1f(uniform("uTint"), tint);
    gl.uniform4f(uniform("uLevels"), levels[0]!, levels[1]!, levels[2]!, levels[3]!);
    ["uC0", "uC1", "uC2", "uC3"].forEach((name, index) => gl.uniform3fv(uniform(name), palette[index]!));
    lightData.fill(0);
    lights.slice(-MAX_LIGHTS).forEach((light, index) => {
      const done = light.age / light.life;
      // It comes up quickly and leaves slowly.
      lightData.set([light.x, light.y + light.drift * (1 - (1 - done) ** 2), light.size * (1 + done), 0.9 * Math.min(1, light.age / 0.08) * (1 - done) ** 2], index * 4);
    });
    gl.uniform4fv(uniform("uLights[0]"), lightData);
    gl.uniform4f(uniform("uShoot"), shoot?.x ?? 0, shoot?.y ?? 0, shoot?.angle ?? 0, shoot ? shoot.progress : -1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  let handle = 0;
  let last = performance.now();
  const loop = (now: number): void => {
    handle = requestAnimationFrame(loop);
    const current = scene();
    const { playing } = current;
    const rate = still ? FRAME_RATES.still : !playing ? FRAME_RATES.paused : current.calm ? FRAME_RATES.calm : FRAME_RATES.playing;
    // A frame of the screen comes every 7 to 17 ms; paint on the one closest to the rate.
    if (now - last < 1000 / rate - 4) return;
    // The first frame's time can lie a moment before the start: never let time run backwards.
    const seconds = Math.max(0, Math.min(0.2, (now - last) / 1000));
    last = now;

    if (!still) {
      for (const pulse of current.pulses()) take(pulse, current.calm);
      clock += seconds * (playing ? (0.25 + 0.7 * energy + 0.25 * mood) * (current.calm ? 0.35 : 1) : 0.12);
      // Now and then a star falls, about twice a minute at full energy.
      if (!shoot && playing && !current.calm && Math.random() < seconds * (0.01 + 0.025 * energy)) {
        const aspect = canvas.width / canvas.height;
        const left = Math.random() < 0.5;
        shoot = { x: (left ? -0.3 : 0.3) * aspect + (Math.random() - 0.5) * 0.3, y: 0.25 + 0.2 * Math.random(), angle: left ? -0.45 - 0.3 * Math.random() : Math.PI + 0.45 + 0.3 * Math.random(), progress: 0 };
      }
    }
    const glide = (shown: number, goal: number, time: number): number => shown + (goal - shown) * (1 - Math.exp(-seconds / time));
    for (let row = 0; row < 4; row += 1) {
      asked[row] = glide(asked[row]!, 0, RELEASE);
      levels[row] = glide(levels[row]!, asked[row]!, ATTACK);
    }
    kickAsked = glide(kickAsked, 0, 0.22);
    kick = glide(kick, kickAsked, 0.03);
    flash = glide(flash, 0, 0.12);
    spark = glide(spark, 0, 0.35);
    energy = glide(energy, current.energy, 0.6);
    mood = glide(mood, current.mood, 0.9);
    calm = glide(calm, current.calm ? 1 : 0, 0.8);
    open = glide(open, current.open ? 1 : 0, 2);
    tint = glide(tint, tintGoal, 1.4);
    for (const light of lights) light.age += seconds;
    lights = lights.filter((light) => light.age < light.life).slice(-40);
    if (shoot) {
      shoot.progress += seconds / 1.1;
      if (shoot.progress >= 1) shoot = null;
    }

    paint();
    feedback(levels, kick);
  };
  handle = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(handle);
    window.removeEventListener("resize", resize);
    canvas.removeEventListener("webglcontextlost", lost);
    canvas.removeEventListener("webglcontextrestored", restored);
  };
}

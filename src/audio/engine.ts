import type { DrumVoice, Groove, TrackId } from "../music/groove";
import { BASS_STEPS, chordPitches, DRUM_STEPS, LOOP_STEPS, STAB_STEPS, STEPS_PER_BAR, tonePitch } from "../music/groove";
import { Clock } from "./clock";
import type { Effects } from "./effects";
import { DEFAULT_EFFECTS } from "./effects";
import { playThroughSilentSwitch } from "./ios-audio";

/*
 * Plays the groove as Lo-Fi-House: sixteenths are scheduled a little ahead
 * on the audio clock, from a worker's heartbeat, so the music keeps going
 * while the tab is in the background. Everything is synthesised; every track
 * has three instruments to choose from. The whole mix runs through a tape (a
 * wobbling delay, saturation, a dull lowpass that the energy opens) and a
 * filter for the hand.
 */

const TEMPO = 118;
/** Seconds per sixteenth. */
const STEP = 15 / TEMPO;
/** How far the odd sixteenths lean back, in sixteenths. */
const SWING = 0.14;
const LOOKAHEAD_SECONDS = 0.2;
const BASS_LOW = 33;
const MELODY_LOW = 60;

const hz = (pitch: number): number => 440 * 2 ** ((pitch - 69) / 12);

/** Something that sounds, for the picture: when, which track, how strong. `bar` marks the chord of a new bar. */
export interface Pulse {
  time: number;
  track: TrackId;
  vel: number;
  voice?: DrumVoice;
  pitch?: number;
  bar?: boolean;
}

/** The drum kits (Staubig, Knackig, Weich): fall and length of the kick, colour and length of the noises. */
const KITS = [
  { kick: { from: 125, to: 45, drop: 0.1, attack: 0.002, decay: 0.25, level: 0.6, click: 0 }, clap: { tone: 1300, decay: 0.2, level: 1 }, hat: { tone: 7500, decay: 0.05, level: 0.35 }, open: { decay: 0.3, level: 0.24 }, rim: { tone: 900, level: 0.35 } },
  { kick: { from: 190, to: 50, drop: 0.05, attack: 0.001, decay: 0.2, level: 0.62, click: 0.2 }, clap: { tone: 1900, decay: 0.16, level: 1.15 }, hat: { tone: 9000, decay: 0.035, level: 0.42 }, open: { decay: 0.22, level: 0.28 }, rim: { tone: 1250, level: 0.4 } },
  { kick: { from: 95, to: 42, drop: 0.12, attack: 0.006, decay: 0.3, level: 0.52, click: 0 }, clap: { tone: 950, decay: 0.09, level: 0.6 }, hat: { tone: 6000, decay: 0.07, level: 0.22 }, open: { decay: 0.35, level: 0.14 }, rim: { tone: 620, level: 0.25 } },
] as const;

interface Graph {
  /** Where the drums go: straight onto the tape. */
  drums: GainNode;
  /** Where everything else goes; the kick ducks it. */
  music: GainNode;
  /** Sends into the room and into the echo. */
  room: GainNode;
  echo: GainNode;
  echoFeedback: GainNode;
  /** The tape's wobble depths, its hiss and how hard it is driven. */
  wow: GainNode;
  flutter: GainNode;
  dust: GainNode;
  drive: GainNode;
  tone: BiquadFilterNode;
  /** The filter for the hand: a lowpass and a highpass in a row. */
  dull: BiquadFilterNode;
  thin: BiquadFilterNode;
  master: GainNode;
  noise: AudioBuffer;
}

export class Engine {
  /** Called when a bar (0..3 of the loop) is about to be scheduled, a moment before it sounds: the place for changes. */
  onBar: ((bar: number) => void) | null = null;
  playing = false;

  private context: AudioContext | null = null;
  private graph: Graph | null = null;
  private readonly clock = new Clock(() => this.schedule());
  private startTime = 0;
  private nextStep = 0;
  private energyNow = 0.5;
  /** The energy the running bar was started with: instruments come and go on the bar line. */
  private barEnergy = 0.5;
  private volumeNow = 0.8;
  private effectsNow: Effects = { ...DEFAULT_EFFECTS };
  private pulses: Pulse[] = [];

  constructor(public groove: Groove) {}

  set energy(value: number) {
    this.energyNow = value;
    if (this.context && this.graph) this.graph.tone.frequency.setTargetAtTime(toneCutoff(value), this.context.currentTime, 0.4);
  }

  set volume(value: number) {
    this.volumeNow = value;
    if (this.context && this.graph) this.graph.master.gain.setTargetAtTime(value, this.context.currentTime, 0.03);
  }

  set effects(value: Effects) {
    this.effectsNow = { ...value };
    this.applyEffects(0.08);
  }

  /** Starts or pauses the music. The first call must come from a click: browsers only allow sound after one. */
  async toggle(): Promise<boolean> {
    if (!this.context) {
      playThroughSilentSwitch();
      this.context = new AudioContext({ latencyHint: "playback" });
      this.graph = this.build(this.context);
      this.applyEffects(0);
      this.startTime = this.context.currentTime + 0.1;
    }
    // The audio clock stands still while suspended, so a pause picks up exactly where it stopped.
    this.playing = !this.playing;
    if (this.playing) {
      await this.context.resume();
      // A second call may have paused again in the meantime.
      if (this.playing) this.clock.start();
    } else {
      this.clock.stop();
      await this.context.suspend();
    }
    return this.playing;
  }

  /** The sixteenth of the loop that sounds right now, or -1 before the first start. */
  position(): number {
    if (!this.context) return -1;
    const step = Math.floor((this.heardTime() - this.startTime) / STEP);
    return ((step % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS;
  }

  /** Hands out everything that has sounded since the last call, for the picture. */
  takePulses(): Pulse[] {
    const now = this.heardTime();
    const due = this.pulses.filter((pulse) => pulse.time <= now);
    this.pulses = this.pulses.filter((pulse) => pulse.time > now);
    return due;
  }

  dispose(): void {
    this.clock.dispose();
    void this.context?.close();
  }

  /** Where the listener is: the audio clock minus what is still on its way to the speaker. */
  private heardTime(): number {
    return this.context ? this.context.currentTime - (this.context.outputLatency || 0) : 0;
  }

  private schedule(): void {
    const context = this.context;
    if (!context) return;
    for (;;) {
      const time = this.startTime + this.nextStep * STEP;
      if (time > context.currentTime + LOOKAHEAD_SECONDS) return;
      // After a long stall (the laptop slept) the missed steps are counted but not played.
      this.step(this.nextStep % LOOP_STEPS, time, time >= context.currentTime);
      this.nextStep += 1;
    }
  }

  private step(index: number, time: number, audible: boolean): void {
    const inBar = index % STEPS_PER_BAR;
    if (inBar === 0) {
      this.onBar?.(index / STEPS_PER_BAR);
      this.barEnergy = this.energyNow;
    }
    if (!audible) return;

    const { drums, bass, chords, melody } = this.groove;
    const energy = this.barEnergy;
    const chord = chords.bars[Math.floor(index / STEPS_PER_BAR)]!;
    const at = time + (index % 2 ? SWING * STEP : 0);
    const plays = (item: { step: number; min: number }, length: number): boolean => item.step === index % length && item.min <= energy + 1e-9;

    if (inBar === 0) {
      this.pad(chordPitches(chords, chord), time, energy);
      this.pulse({ time, track: "chords", vel: 0.3, bar: true });
    }
    for (const hit of drums) {
      if (!plays(hit, DRUM_STEPS)) continue;
      this.drum(hit.voice, hit.vel, at);
      this.pulse({ time: at, track: "drums", vel: hit.vel, voice: hit.voice });
    }
    for (const note of bass) {
      if (!plays(note, BASS_STEPS)) continue;
      const pitch = tonePitch(chords, chord, note.tone, BASS_LOW);
      this.bass(pitch, note.len, note.vel, at);
      this.pulse({ time: at, track: "bass", vel: note.vel, pitch });
    }
    for (const stab of chords.stabs) {
      if (!plays(stab, STAB_STEPS)) continue;
      this.stab(chordPitches(chords, chord), stab.len, at, energy);
      this.pulse({ time: at, track: "chords", vel: 0.8 });
    }
    for (const note of melody) {
      if (!plays(note, LOOP_STEPS)) continue;
      const pitch = tonePitch(chords, chord, note.tone, MELODY_LOW);
      this.lead(pitch, note.len, note.vel, at);
      this.pulse({ time: at, track: "melody", vel: note.vel, pitch });
    }
  }

  private pulse(pulse: Pulse): void {
    // Nobody may be looking (a background tab): keep only the last moments.
    if (this.pulses.length > 200) this.pulses = this.pulses.slice(-100);
    this.pulses.push(pulse);
  }

  // ---- Voices --------------------------------------------------------------

  private drum(voice: DrumVoice, vel: number, time: number): void {
    const { drums, music, room } = this.graph!;
    const kit = KITS[this.groove.sounds.drums]!;
    switch (voice) {
      case "kick": {
        const { from, to, drop, attack, decay, level, click } = kit.kick;
        const osc = this.osc("sine", from, time, 0.6);
        osc.frequency.setValueAtTime(from, time);
        osc.frequency.exponentialRampToValueAtTime(to, time + drop);
        osc.connect(this.envelope(time, vel * level, attack, 0.06, decay)).connect(drums);
        if (click) this.noise(time, vel * click, "highpass", 2500, 0.0005, 0.012);
        // The pumping: everything else ducks under the kick and swells back.
        music.gain.setTargetAtTime(1 - 0.1 * this.effectsNow.pump * vel, time, 0.005);
        music.gain.setTargetAtTime(1, time + 0.04, 0.1);
        break;
      }
      case "clap": {
        const { tone, decay, level } = kit.clap;
        this.noise(time, vel * 0.45 * level, "bandpass", tone, 0.001, 0.012);
        this.noise(time + 0.011, vel * 0.45 * level, "bandpass", tone, 0.001, 0.012);
        this.noise(time + 0.022, vel * 0.6 * level, "bandpass", tone, 0.001, decay).connect(room);
        break;
      }
      case "hat":
        this.noise(time + jitter(), vel * kit.hat.level, "highpass", kit.hat.tone, 0.001, kit.hat.decay);
        break;
      case "open":
        this.noise(time, vel * kit.open.level, "highpass", kit.hat.tone - 1000, 0.001, kit.open.decay);
        break;
      case "shaker":
        this.noise(time + jitter(), vel * 0.5, "bandpass", 4800, 0.012, 0.06);
        break;
      case "rim": {
        const amp = this.envelope(time, vel * kit.rim.level, 0.001, 0.004, 0.05);
        this.osc("triangle", kit.rim.tone, time, 0.2).connect(amp).connect(drums);
        amp.connect(room);
        break;
      }
    }
  }

  private bass(pitch: number, len: number, vel: number, time: number): void {
    const { music } = this.graph!;
    const frequency = hz(pitch);
    const hold = len * STEP * 0.9;
    switch (this.groove.sounds.bass) {
      case 1: {
        // Rund: a saw behind a low filter that closes a little after the attack.
        const filter = this.filter("lowpass", frequency * 3, 2);
        filter.frequency.setValueAtTime(frequency * 7, time);
        filter.frequency.setTargetAtTime(frequency * 3, time, 0.1);
        this.osc("sawtooth", frequency, time, hold + 0.4).connect(filter).connect(this.envelope(time, vel * 0.3, 0.008, hold, 0.12)).connect(music);
        break;
      }
      case 2: {
        // Zupf: a short square pluck.
        const filter = this.filter("lowpass", frequency * 2, 1);
        filter.frequency.setValueAtTime(frequency * 12, time);
        filter.frequency.setTargetAtTime(frequency * 2, time, 0.05);
        this.osc("square", frequency, time, 0.7).connect(filter).connect(this.envelope(time, vel * 0.26, 0.003, 0.02, 0.22 + 0.04 * len)).connect(music);
        break;
      }
      default: {
        // Sub: a sine, with a little triangle on top so small speakers can still tell the note.
        const amp = this.envelope(time, vel * 0.33, 0.01, hold, 0.12);
        this.osc("sine", frequency, time, hold + 0.4).connect(amp);
        const edge = this.context!.createGain();
        edge.gain.value = 0.35;
        this.osc("triangle", frequency, time, hold + 0.4).connect(edge).connect(amp);
        amp.connect(music);
      }
    }
  }

  /** A short chord. */
  private stab(pitches: number[], len: number, time: number, energy: number): void {
    const context = this.context!;
    const { music, room } = this.graph!;
    const hold = len * STEP;
    let amp: GainNode;
    switch (this.groove.sounds.chords) {
      case 1:
        // E-Piano: two sines per note, one bending the other; bright at the attack, mellow after.
        amp = this.envelope(time, 0.07, 0.004, hold, 0.5);
        for (const pitch of pitches) {
          const frequency = hz(pitch);
          const carrier = this.osc("sine", frequency, time, hold + 1.2);
          const bite = context.createGain();
          bite.gain.setValueAtTime(frequency * (1 + 2 * energy), time);
          bite.gain.setTargetAtTime(frequency * 0.3, time, 0.12);
          this.osc("sine", frequency, time, hold + 1.2).connect(bite).connect(carrier.frequency);
          carrier.connect(amp);
        }
        break;
      case 2: {
        // Orgel: three drawbars per note, on at once and off at once.
        amp = this.envelope(time, 0.033, 0.003, hold, 0.08);
        const filter = this.filter("lowpass", 1200 + 4000 * energy, 0.7);
        for (const pitch of pitches) {
          for (const [harmonic, level] of [[1, 1], [2, 0.6], [3, 0.3]] as const) {
            const drawbar = context.createGain();
            drawbar.gain.value = level;
            this.osc("sine", hz(pitch) * harmonic, time, hold + 0.4).connect(drawbar).connect(filter);
          }
        }
        filter.connect(amp);
        break;
      }
      default: {
        // Säge: two detuned saws per note behind a lowpass that the energy opens.
        const cutoff = 500 + 2600 * energy;
        const filter = this.filter("lowpass", cutoff, 1.5);
        filter.frequency.setValueAtTime(cutoff * 1.8, time);
        filter.frequency.setTargetAtTime(cutoff, time, 0.08);
        for (const pitch of pitches) {
          for (const detune of [-7, 7]) {
            const osc = this.osc("sawtooth", hz(pitch), time, hold + 0.8);
            osc.detune.value = detune;
            osc.connect(filter);
          }
        }
        amp = this.envelope(time, 0.075, 0.006, hold, 0.3);
        filter.connect(amp);
      }
    }
    amp.connect(music);
    amp.connect(room);
  }

  /** The chord of the bar as a soft bed; it steps back as the energy rises and the stabs take over. */
  private pad(pitches: number[], time: number, energy: number): void {
    const { music, room } = this.graph!;
    const bar = STEP * STEPS_PER_BAR;
    const filter = this.filter("lowpass", 380 + 700 * energy, 1);
    for (const pitch of pitches) {
      const osc = this.osc("sawtooth", hz(pitch), time, bar + 2.2);
      osc.detune.value = Math.random() * 12 - 6;
      osc.connect(filter);
    }
    const amp = this.envelope(time, 0.085 * (1 - 0.6 * energy), 0.5, bar, 0.9);
    filter.connect(amp).connect(music);
    amp.connect(room);
  }

  /** A melody note, into the room and the echo. */
  private lead(pitch: number, len: number, vel: number, time: number): void {
    const context = this.context!;
    const { music, room, echo } = this.graph!;
    const frequency = hz(pitch);
    let amp: GainNode;
    switch (this.groove.sounds.melody) {
      case 1: {
        // Flöte: a soft attack and a vibrato that comes in late.
        const hold = Math.max(len, 2) * STEP;
        amp = this.envelope(time, vel * 0.2, 0.05, hold, 0.3);
        const osc = this.osc("triangle", frequency, time, hold + 0.9);
        const vibrato = context.createGain();
        vibrato.gain.setValueAtTime(0, time);
        vibrato.gain.linearRampToValueAtTime(frequency * 0.006, time + 0.3);
        this.osc("sine", 5.2, time, hold + 0.9).connect(vibrato).connect(osc.frequency);
        osc.connect(this.filter("lowpass", 2400, 0.7)).connect(amp);
        break;
      }
      case 2: {
        // Zupf: a plucked string.
        amp = this.envelope(time, vel * 0.2, 0.002, 0.02, 0.35 + 0.05 * len);
        const filter = this.filter("lowpass", frequency * 1.5, 2);
        filter.frequency.setValueAtTime(frequency * 8, time);
        filter.frequency.setTargetAtTime(frequency * 1.5, time, 0.06);
        this.osc("sawtooth", frequency, time, 1.6).connect(filter).connect(amp);
        break;
      }
      default: {
        // Glocke: a small FM bell.
        amp = this.envelope(time, vel * 0.18, 0.004, 0.02, 0.5 + 0.1 * len);
        const carrier = this.osc("sine", frequency, time, 2);
        const brightness = context.createGain();
        brightness.gain.setValueAtTime(frequency * 1.2, time);
        brightness.gain.setTargetAtTime(0, time, 0.08);
        this.osc("sine", frequency * 2, time, 2).connect(brightness).connect(carrier.frequency);
        carrier.connect(amp);
      }
    }
    amp.connect(music);
    amp.connect(room);
    amp.connect(echo);
  }

  /** An oscillator that starts at `time` and is gone `seconds` later. */
  private osc(type: OscillatorType, frequency: number, time: number, seconds: number): OscillatorNode {
    const osc = this.context!.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;
    osc.start(time);
    osc.stop(time + seconds);
    return osc;
  }

  private filter(type: BiquadFilterType, frequency: number, q: number): BiquadFilterNode {
    const filter = this.context!.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    return filter;
  }

  /** A burst of filtered noise on the drum bus; returns its output for extra sends. */
  private noise(time: number, peak: number, type: BiquadFilterType, frequency: number, attack: number, release: number): GainNode {
    const { noise, drums } = this.graph!;
    const source = this.context!.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const amp = this.envelope(time, peak, attack, attack, release);
    source.connect(this.filter(type, frequency, 1)).connect(amp).connect(drums);
    source.start(time, Math.random() * (noise.duration - 0.1));
    source.stop(time + attack + release * 2);
    return amp;
  }

  /** A gain that rises to `peak` within `attack`, stays until `hold` after the start, then fades within about `release`. */
  private envelope(time: number, peak: number, attack: number, hold: number, release: number): GainNode {
    const amp = this.context!.createGain();
    amp.gain.value = 0;
    amp.gain.setValueAtTime(0, time);
    amp.gain.linearRampToValueAtTime(peak, time + attack);
    amp.gain.setTargetAtTime(0, time + Math.max(attack, hold), release / 3);
    return amp;
  }

  // ---- The fixed part of the sound -------------------------------------------

  /** Brings the effect controls to the sound, gliding there within about `seconds`. */
  private applyEffects(seconds: number): void {
    const { context, graph } = this;
    if (!context || !graph) return;
    const { hall, echo, tape, filter } = this.effectsNow;
    const glide = (param: AudioParam, value: number): void => {
      if (seconds) param.setTargetAtTime(value, context.currentTime, seconds);
      else param.value = value;
    };
    glide(graph.room.gain, 0.09 * hall);
    glide(graph.echo.gain, 0.1 * echo);
    glide(graph.echoFeedback.gain, 0.25 + 0.04 * echo);
    // The tape: about five cents of slow wow and a trace of flutter at the middle setting.
    glide(graph.wow.gain, 0.0003 * tape);
    glide(graph.flutter.gain, 0.000004 * tape);
    glide(graph.dust.gain, 0.2 * tape);
    glide(graph.drive.gain, 0.7 + 0.06 * tape);
    // Left of the middle the lowpass comes down to 300 Hz, right of it the highpass climbs to 2 kHz.
    glide(graph.dull.frequency, filter < 0 ? 20000 * (300 / 20000) ** (-filter / 5) : 20000);
    glide(graph.thin.frequency, filter > 0 ? 20 * (2000 / 20) ** (filter / 5) : 20);
  }

  private build(context: AudioContext): Graph {
    const gain = (value: number): GainNode => {
      const node = context.createGain();
      node.gain.value = value;
      return node;
    };
    // The effect controls set the depths and levels that start at zero here.
    const lfo = (frequency: number, target: AudioParam): GainNode => {
      const osc = context.createOscillator();
      osc.frequency.value = frequency;
      const depth = gain(0);
      osc.connect(depth).connect(target);
      osc.start();
      return depth;
    };

    // The tape: a delay whose length wobbles bends the pitch of everything on it,
    // then saturation and the lowpass of the energy.
    const wobble = context.createDelay(0.05);
    wobble.delayTime.value = 0.006;
    const wow = lfo(0.31, wobble.delayTime);
    const flutter = lfo(5.3, wobble.delayTime);
    const drive = gain(1);
    const saturation = context.createWaveShaper();
    saturation.curve = Float32Array.from({ length: 1024 }, (_, index) => Math.tanh(1.6 * (index / 511.5 - 1)));
    const tone = this.filter("lowpass", toneCutoff(this.energyNow), 0.5);
    const dull = this.filter("lowpass", 20000, 0.9);
    const thin = this.filter("highpass", 20, 0.9);
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.ratio.value = 4;
    limiter.attack.value = 0.01;
    limiter.release.value = 0.2;
    const master = gain(this.volumeNow);
    wobble.connect(drive).connect(saturation).connect(tone).connect(dull).connect(thin).connect(limiter).connect(master).connect(context.destination);

    const drums = gain(1);
    drums.connect(wobble);
    const music = gain(1);
    music.connect(wobble);

    const room = gain(0);
    const reverb = context.createConvolver();
    reverb.buffer = roomImpulse(context);
    room.connect(reverb).connect(music);

    // A dotted-eighth echo that gets duller with every repeat.
    const echo = gain(0);
    const delay = context.createDelay(1);
    delay.delayTime.value = STEP * 3;
    const damp = this.filter("lowpass", 1800, 0.5);
    const echoFeedback = gain(0);
    echo.connect(delay).connect(damp).connect(music);
    damp.connect(echoFeedback).connect(delay);

    // Dust: hiss and crackle, pumping along with the kick.
    const dust = gain(0);
    const record = context.createBufferSource();
    record.buffer = dustLoop(context);
    record.loop = true;
    record.connect(dust).connect(music);
    record.start();

    const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = noise.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;

    return { drums, music, room, echo, echoFeedback, wow, flutter, dust, drive, tone, dull, thin, master, noise };
  }
}

/** The lowpass over the whole mix: dull and far away when calm, open at full groove. */
const toneCutoff = (energy: number): number => 2600 + 11000 * energy * energy;

/** A few milliseconds off the grid, so hats and shaker are not machine-straight. */
const jitter = (): number => Math.random() * 0.004;

/** Eight seconds of quiet hiss with scattered crackles, like a worn record. */
function dustLoop(context: AudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate * 8, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) samples[index] = (Math.random() * 2 - 1) * 0.006;
  for (let crackle = 0; crackle < 70; crackle += 1) {
    const at = Math.floor(Math.random() * (samples.length - 64));
    const level = (0.02 + 0.2 * Math.random() ** 3) * (Math.random() < 0.5 ? -1 : 1);
    for (let index = 0; index < 64; index += 1) samples[at + index]! += level * Math.exp(-index / 5);
  }
  return buffer;
}

/** A small dark room: noise that fades and loses its highs. */
function roomImpulse(context: AudioContext): AudioBuffer {
  const length = Math.floor(context.sampleRate * 2.2);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const samples = buffer.getChannelData(channel);
    let smooth = 0;
    for (let index = 0; index < length; index += 1) {
      smooth += 0.3 * (Math.random() * 2 - 1 - smooth);
      samples[index] = smooth * (1 - index / length) ** 4;
    }
  }
  return buffer;
}

import type { DrumVoice, Groove } from "../music/groove";
import { BASS_STEPS, chordPitches, DRUM_STEPS, LOOP_STEPS, STAB_STEPS, STEPS_PER_BAR, tonePitch } from "../music/groove";
import { Clock } from "./clock";
import { playThroughSilentSwitch } from "./ios-audio";

/*
 * Plays the groove as Lo-Fi-House: sixteenths are scheduled a little ahead
 * on the audio clock, from a worker's heartbeat, so the music keeps going
 * while the tab is in the background. Everything is synthesised. The whole
 * mix runs through a tape: a wobbling delay, saturation and a dull lowpass
 * that the energy opens.
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

interface Graph {
  /** Where the drums go: straight onto the tape. */
  drums: GainNode;
  /** Where everything else goes; the kick ducks it. */
  music: GainNode;
  /** Sends into the room and into the echo. */
  room: GainNode;
  echo: GainNode;
  tone: BiquadFilterNode;
  master: GainNode;
  noise: AudioBuffer;
}

export class Engine {
  /** Called when a new pass through the four bars is about to be scheduled, a moment before it sounds. */
  onLoop: (() => void) | null = null;
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

  constructor(public groove: Groove) {}

  set energy(value: number) {
    this.energyNow = value;
    if (this.context && this.graph) this.graph.tone.frequency.setTargetAtTime(toneCutoff(value), this.context.currentTime, 0.4);
  }

  set volume(value: number) {
    this.volumeNow = value;
    if (this.context && this.graph) this.graph.master.gain.setTargetAtTime(value, this.context.currentTime, 0.03);
  }

  /** Starts or pauses the music. The first call must come from a click: browsers only allow sound after one. */
  async toggle(): Promise<boolean> {
    if (!this.context) {
      playThroughSilentSwitch();
      this.context = new AudioContext({ latencyHint: "playback" });
      this.graph = this.build(this.context);
      this.startTime = this.context.currentTime + 0.1;
    }
    // The audio clock stands still while suspended, so a pause picks up exactly where it stopped.
    if (this.playing) {
      this.clock.stop();
      await this.context.suspend();
    } else {
      await this.context.resume();
      this.clock.start();
    }
    this.playing = !this.playing;
    return this.playing;
  }

  /** The sixteenth of the loop that sounds right now, or -1 before the first start. */
  position(): number {
    if (!this.context) return -1;
    const step = Math.floor((this.context.currentTime - (this.context.outputLatency || 0) - this.startTime) / STEP);
    return ((step % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS;
  }

  dispose(): void {
    this.clock.dispose();
    void this.context?.close();
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
    if (index === 0) this.onLoop?.();
    const inBar = index % STEPS_PER_BAR;
    if (inBar === 0) this.barEnergy = this.energyNow;
    if (!audible) return;

    const { drums, bass, chords, melody } = this.groove;
    const energy = this.barEnergy;
    const chord = chords.bars[Math.floor(index / STEPS_PER_BAR)]!;
    const at = time + (index % 2 ? SWING * STEP : 0);
    const plays = (item: { step: number; min: number }, length: number): boolean => item.step === index % length && item.min <= energy + 1e-9;

    if (inBar === 0) this.pad(chordPitches(chords.key, chord), time, energy);
    for (const hit of drums) if (plays(hit, DRUM_STEPS)) this.drum(hit.voice, hit.vel, at);
    for (const note of bass) if (plays(note, BASS_STEPS)) this.bass(tonePitch(chords.key, chord, note.tone, BASS_LOW), note.len, note.vel, at);
    for (const stab of chords.stabs) if (plays(stab, STAB_STEPS)) this.stab(chordPitches(chords.key, chord), stab.len, at, energy);
    for (const note of melody) if (plays(note, LOOP_STEPS)) this.bell(tonePitch(chords.key, chord, note.tone, MELODY_LOW), note.len, note.vel, at);
  }

  // ---- Voices --------------------------------------------------------------

  private drum(voice: DrumVoice, vel: number, time: number): void {
    const { drums, music, room } = this.graph!;
    switch (voice) {
      case "kick": {
        const osc = this.osc("sine", 125, time, 0.6);
        osc.frequency.setValueAtTime(125, time);
        osc.frequency.exponentialRampToValueAtTime(45, time + 0.1);
        osc.connect(this.envelope(time, vel * 0.6, 0.002, 0.06, 0.25)).connect(drums);
        // The pumping: everything else ducks under the kick and swells back.
        music.gain.setTargetAtTime(1 - 0.6 * vel, time, 0.005);
        music.gain.setTargetAtTime(1, time + 0.04, 0.1);
        break;
      }
      case "clap":
        this.noise(time, vel * 0.45, "bandpass", 1300, 0.001, 0.012);
        this.noise(time + 0.011, vel * 0.45, "bandpass", 1300, 0.001, 0.012);
        this.noise(time + 0.022, vel * 0.6, "bandpass", 1300, 0.001, 0.2).connect(room);
        break;
      case "hat":
        this.noise(time + jitter(), vel * 0.35, "highpass", 7500, 0.001, 0.05);
        break;
      case "open":
        this.noise(time, vel * 0.24, "highpass", 6500, 0.001, 0.3);
        break;
      case "shaker":
        this.noise(time + jitter(), vel * 0.5, "bandpass", 4800, 0.012, 0.06);
        break;
      case "rim": {
        const amp = this.envelope(time, vel * 0.35, 0.001, 0.004, 0.05);
        this.osc("triangle", 900, time, 0.2).connect(amp).connect(drums);
        amp.connect(room);
        break;
      }
    }
  }

  private bass(pitch: number, len: number, vel: number, time: number): void {
    const hold = len * STEP * 0.9;
    const amp = this.envelope(time, vel * 0.33, 0.01, hold, 0.12);
    this.osc("sine", hz(pitch), time, hold + 0.4).connect(amp);
    // A little triangle on top so small speakers can still tell the note.
    const edge = this.context!.createGain();
    edge.gain.value = 0.35;
    this.osc("triangle", hz(pitch), time, hold + 0.4).connect(edge).connect(amp);
    amp.connect(this.graph!.music);
  }

  /** A short chord: two detuned saws per note behind a lowpass that the energy opens. */
  private stab(pitches: number[], len: number, time: number, energy: number): void {
    const { music, room } = this.graph!;
    const hold = len * STEP;
    const cutoff = 500 + 2600 * energy;
    const filter = this.context!.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 1.5;
    filter.frequency.setValueAtTime(cutoff * 1.8, time);
    filter.frequency.setTargetAtTime(cutoff, time, 0.08);
    for (const pitch of pitches) {
      for (const detune of [-7, 7]) {
        const osc = this.osc("sawtooth", hz(pitch), time, hold + 0.8);
        osc.detune.value = detune;
        osc.connect(filter);
      }
    }
    const amp = this.envelope(time, 0.075, 0.006, hold, 0.3);
    filter.connect(amp).connect(music);
    amp.connect(room);
  }

  /** The chord of the bar as a soft bed; it steps back as the energy rises and the stabs take over. */
  private pad(pitches: number[], time: number, energy: number): void {
    const { music, room } = this.graph!;
    const bar = STEP * STEPS_PER_BAR;
    const filter = this.context!.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 380 + 700 * energy;
    for (const pitch of pitches) {
      const osc = this.osc("sawtooth", hz(pitch), time, bar + 2.2);
      osc.detune.value = Math.random() * 12 - 6;
      osc.connect(filter);
    }
    const amp = this.envelope(time, 0.085 * (1 - 0.6 * energy), 0.5, bar, 0.9);
    filter.connect(amp).connect(music);
    amp.connect(room);
  }

  /** A small FM bell with an echo. */
  private bell(pitch: number, len: number, vel: number, time: number): void {
    const { music, room, echo } = this.graph!;
    const frequency = hz(pitch);
    const carrier = this.osc("sine", frequency, time, 2);
    const brightness = this.context!.createGain();
    brightness.gain.setValueAtTime(frequency * 1.2, time);
    brightness.gain.setTargetAtTime(0, time, 0.08);
    this.osc("sine", frequency * 2, time, 2).connect(brightness).connect(carrier.frequency);
    const amp = this.envelope(time, vel * 0.18, 0.004, 0.02, 0.5 + 0.1 * len);
    carrier.connect(amp).connect(music);
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

  /** A burst of filtered noise on the drum bus; returns its output for extra sends. */
  private noise(time: number, peak: number, type: BiquadFilterType, frequency: number, attack: number, release: number): GainNode {
    const { noise, drums } = this.graph!;
    const source = this.context!.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const filter = this.context!.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const amp = this.envelope(time, peak, attack, attack, release);
    source.connect(filter).connect(amp).connect(drums);
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

  private build(context: AudioContext): Graph {
    const gain = (value: number): GainNode => {
      const node = context.createGain();
      node.gain.value = value;
      return node;
    };
    const lowpass = (frequency: number): BiquadFilterNode => {
      const node = context.createBiquadFilter();
      node.type = "lowpass";
      node.frequency.value = frequency;
      node.Q.value = 0.5;
      return node;
    };
    const lfo = (frequency: number, depth: number, target: AudioParam): void => {
      const osc = context.createOscillator();
      osc.frequency.value = frequency;
      osc.connect(gain(depth)).connect(target);
      osc.start();
    };

    // The tape: a delay whose length wobbles bends the pitch of everything on it
    // (slow wow of about five cents, a trace of flutter), then saturation and the lowpass.
    const wobble = context.createDelay(0.05);
    wobble.delayTime.value = 0.006;
    lfo(0.31, 0.0015, wobble.delayTime);
    lfo(5.3, 0.00002, wobble.delayTime);
    const saturation = context.createWaveShaper();
    saturation.curve = Float32Array.from({ length: 1024 }, (_, index) => Math.tanh(1.6 * (index / 511.5 - 1)));
    const tone = lowpass(toneCutoff(this.energyNow));
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.ratio.value = 4;
    limiter.attack.value = 0.01;
    limiter.release.value = 0.2;
    const master = gain(this.volumeNow);
    wobble.connect(saturation).connect(tone).connect(limiter).connect(master).connect(context.destination);

    const drums = gain(1);
    drums.connect(wobble);
    const music = gain(1);
    music.connect(wobble);

    const room = gain(0.35);
    const reverb = context.createConvolver();
    reverb.buffer = roomImpulse(context);
    room.connect(reverb).connect(music);

    // A dotted-eighth echo that gets duller with every repeat.
    const echo = gain(0.4);
    const delay = context.createDelay(1);
    delay.delayTime.value = STEP * 3;
    const damp = lowpass(1800);
    echo.connect(delay).connect(damp).connect(music);
    damp.connect(gain(0.4)).connect(delay);

    // Dust: hiss and crackle, always there, pumping along with the kick.
    const dust = context.createBufferSource();
    dust.buffer = dustLoop(context);
    dust.loop = true;
    dust.connect(music);
    dust.start();

    const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = noise.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;

    return { drums, music, room, echo, tone, master, noise };
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

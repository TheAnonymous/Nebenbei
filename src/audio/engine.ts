import type { DrumVoice, Extra, Feel, Groove, TrackId } from "../music/groove";
import { BASS_STEPS, chordPitches, DRUM_STEPS, EXTRA_ROLES, EXTRA_STEPS, feelOf, LOOP_STEPS, plays, STAB_STEPS, STEPS_PER_BAR, tonePitch, turnaround } from "../music/groove";
import type { Phase, Tide } from "../music/tide";
import { nextBar, startTide, tideOffset } from "../music/tide";
import { Clock } from "./clock";
import type { Effects, Levels, Move } from "./effects";
import { DEFAULT_EFFECTS, DEFAULT_LEVELS, djEffects, levelGain, limitCurve, pickMove } from "./effects";
import type { Patch } from "./instruments";
import { KITS, PATCHES } from "./instruments";
import { playThroughSilentSwitch } from "./ios-audio";

/*
 * Plays the groove as Lo-Fi-House: sixteenths are scheduled a little ahead
 * on the audio clock, from a worker's heartbeat, so the music keeps going
 * while the tab is in the background. Everything is synthesised: the drums
 * from a kit, the other tracks from any instrument of the library. The whole
 * mix runs through a tape (a wobbling delay, saturation, a dull lowpass that
 * the energy opens) and a filter for the hand. The mood sets the feel:
 * tempo, swing, brightness, space; it changes on the bar line, and the tempo
 * glides there. The effects are set anew on every sixteenth, so the DJ can
 * play them from here, in time, even while the tab is in the background.
 * Every track has its own level, which also sets how much of it goes into
 * the room and the echo. The end of the chain cannot clip (softLimit). With
 * the tides on (music/tide.ts) the energy takes a long arc, kick and clap
 * pause now and then, fills end some passes, and every second pass answers
 * the progression, so the chords run over eight bars.
 */

const LOOKAHEAD_SECONDS = 0.2;
const BASS_LOW = 33;

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

/** The fills that end a pass: hits on the last bar's sixteenths, over whatever the drums play. */
const FILLS: readonly (readonly { step: number; voice: DrumVoice; vel: number }[])[] = [
  [{ step: 12, voice: "rim", vel: 0.5 }, { step: 14, voice: "rim", vel: 0.6 }, { step: 15, voice: "clap", vel: 0.7 }],
  [{ step: 12, voice: "open", vel: 0.45 }, { step: 14, voice: "hat", vel: 0.5 }, { step: 15, voice: "hat", vel: 0.6 }],
  [
    { step: 8, voice: "rim", vel: 0.4 },
    { step: 10, voice: "rim", vel: 0.45 },
    { step: 12, voice: "rim", vel: 0.5 },
    { step: 13, voice: "rim", vel: 0.55 },
    { step: 14, voice: "clap", vel: 0.6 },
    { step: 15, voice: "clap", vel: 0.7 },
  ],
  [{ step: 11, voice: "kick", vel: 0.6 }, { step: 14, voice: "kick", vel: 0.7 }, { step: 15, voice: "open", vel: 0.5 }],
];

/** How loud an instrument is on each track, against one melody note: a bass note, a chord of four. */
const ROLE_LEVEL = { bass: 1.6, chords: 0.4, melody: 1 } as const;

/** A track's level: one gain for what goes straight on, one for each send, all moved together. */
interface Strip {
  dry: GainNode;
  room: GainNode;
  echo: GainNode;
}

interface Graph {
  tracks: Record<TrackId, Strip>;
  /** A strip for an extra track that plays like `role`, at `level` (0..100). */
  newStrip: (role: TrackId, level: number) => Strip;
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
  /** Schweben: how much of the chorus is heard. */
  chorus: GainNode;
  /** Krümel: the sampler's crumbling (null where the browser has no AudioWorklet). */
  crush: AudioParam | null;
  /** Knistern: the record's crackle and rumble. */
  vinyl: GainNode;
  /** The echo's length: three sixteenths, so it follows the tempo. */
  echoTime: AudioParam;
  tone: BiquadFilterNode;
  /** The filter for the hand: a lowpass and a highpass in a row. */
  dull: BiquadFilterNode;
  thin: BiquadFilterNode;
  master: GainNode;
  noise: AudioBuffer;
}

export class Engine {
  /**
   * Called when a bar (0..3 of the loop) is about to be scheduled, a moment
   * before it sounds: the place for changes. `modulate` is set when the tides
   * move the key on, by that many semitones.
   */
  onBar: ((bar: number, modulate: number | null) => void) | null = null;
  playing = false;
  /** Whether the DJ plays the effects. It starts its first move on the next pass through the four bars. */
  dj = false;
  /** Whether the tides are on. They start on the next bar line, at your energy. */
  tides = false;

  private context: AudioContext | null = null;
  private graph: Graph | null = null;
  private readonly clock = new Clock(() => this.schedule());
  private nextStep = 0;
  /** When the next sixteenth sounds, and the last few that were scheduled, to tell where the music is. */
  private nextTime = 0;
  private scheduled: { index: number; time: number; effects: Effects; move: Move; energy: number; phase: Phase | null; breakdown: boolean; answer: boolean }[] = [];
  private tide: Tide | null = null;
  private fill: (typeof FILLS)[number] | null = null;
  /** Passes through the four bars so far; with the tides, every second one answers the progression. */
  private passes = 0;
  private feel: Feel;
  private tempo: number;
  /** Seconds per sixteenth at the tempo of the moment. */
  private stepSeconds: number;
  private energyNow = 0.5;
  /** The energy the running bar was started with: instruments come and go on the bar line. */
  private barEnergy = 0.5;
  private volumeNow = 0.8;
  private levelsNow: Levels = { ...DEFAULT_LEVELS };
  /** The extra tracks' strips, made when a track first plays, with the level they are set to. */
  private extraStrips = new Map<string, { strip: Strip; level: number }>();
  /** Your settings, and what plays on the sixteenth being scheduled: the same, or what the DJ makes of them. */
  private effectsNow: Effects = { ...DEFAULT_EFFECTS };
  private live: Effects = { ...DEFAULT_EFFECTS };
  private move: Move = "ruhe";
  private pulses: Pulse[] = [];

  constructor(public groove: Groove) {
    this.feel = feelOf(groove.chords.mode, groove.genre);
    this.tempo = this.feel.tempo;
    this.stepSeconds = 15 / this.tempo;
  }

  set energy(value: number) {
    this.energyNow = value;
    if (this.context && this.graph) this.graph.tone.frequency.setTargetAtTime(toneCutoff(value) * this.feel.brightness, this.context.currentTime, 0.4);
  }

  set volume(value: number) {
    this.volumeNow = value;
    if (this.context && this.graph) this.graph.master.gain.setTargetAtTime(value, this.context.currentTime, 0.03);
  }

  /** The tracks' levels (0..100 each), right away and smoothly. */
  set levels(value: Levels) {
    this.levelsNow = { ...value };
    const { context, graph } = this;
    if (!context || !graph) return;
    for (const track of Object.keys(value) as TrackId[]) {
      const strip = graph.tracks[track];
      for (const node of [strip.dry, strip.room, strip.echo]) node.gain.setTargetAtTime(levelGain(value[track]), context.currentTime, 0.03);
    }
  }

  /** Takes effect from the next sixteenth that is scheduled, a moment later. */
  set effects(value: Effects) {
    this.effectsNow = { ...value };
  }

  /** Starts or pauses the music. The first call must come from a click: browsers only allow sound after one. */
  async toggle(): Promise<boolean> {
    if (!this.context) {
      playThroughSilentSwitch();
      this.context = new AudioContext({ latencyHint: "playback" });
      // Krümel runs on the audio thread; without it the rest still plays.
      const crusher = await this.context.audioWorklet
        ?.addModule(new URL("./crusher-processor.js", import.meta.url))
        .then(() => true)
        .catch((error: unknown) => {
          console.warn("Krümel nicht verfügbar", error);
          return false;
        });
      this.graph = this.build(this.context, crusher === true);
      this.nextTime = this.context.currentTime + 0.1;
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

  /** Where in the loop the music is right now, in sixteenths with a fraction (0 up to 64), or -1 before the first start. */
  position(): number {
    const heard = this.heard();
    return heard ? heard.index + Math.min(0.999, (this.heardTime() - heard.time) / this.stepSeconds) : -1;
  }

  /** What sounds right now: the effects and the DJ's move, the energy and the tides' phase, a pause of the drums, the answering pass. */
  heardMix(): { effects: Effects; move: Move; energy: number; phase: Phase | null; breakdown: boolean; answer: boolean } | null {
    return this.heard() ?? null;
  }

  /** The energy (0..1) of the bar being scheduled: yours, or where the tides have taken it. */
  get liveEnergy(): number {
    return this.barEnergy;
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

  /** The sixteenth that sounds right now. */
  private heard(): (typeof this.scheduled)[number] | undefined {
    const now = this.heardTime();
    for (let at = this.scheduled.length - 1; at >= 0; at -= 1) if (this.scheduled[at]!.time <= now) return this.scheduled[at];
    return undefined;
  }

  /** Where the listener is: the audio clock minus what is still on its way to the speaker. */
  private heardTime(): number {
    return this.context ? this.context.currentTime - (this.context.outputLatency || 0) : 0;
  }

  private schedule(): void {
    const context = this.context;
    if (!context) return;
    while (this.nextTime <= context.currentTime + LOOKAHEAD_SECONDS) {
      // After a long stall (the laptop slept) the missed steps are counted but not played.
      this.step(this.nextStep % LOOP_STEPS, this.nextTime, this.nextTime >= context.currentTime);
      this.nextStep += 1;
      this.nextTime += this.stepSeconds;
    }
  }

  private step(index: number, time: number, audible: boolean): void {
    const inBar = index % STEPS_PER_BAR;
    if (inBar === 0) {
      const bar = index / STEPS_PER_BAR;
      if (bar === 0) this.passes += 1;
      let modulate: number | null = null;
      if (this.tides) {
        const result = nextBar(this.tide ?? startTide(Math.random), bar, Math.random);
        this.tide = result.tide;
        this.fill = result.fill ? FILLS[Math.floor(Math.random() * FILLS.length)]! : null;
        modulate = result.modulate;
      } else {
        this.tide = null;
        this.fill = null;
      }
      this.barEnergy = Math.min(1, Math.max(0, this.energyNow + (this.tide ? tideOffset(this.tide) / 10 : 0)));
      this.onBar?.(bar, modulate);
      this.feel = feelOf(this.groove.chords.mode, this.groove.genre);
      this.applyFeel(time);
    }
    if (index === 0) this.move = this.dj ? pickMove(this.move, this.barEnergy, Math.random) : "ruhe";
    // The tempo glides to the mood's within about a bar.
    this.tempo += (this.feel.tempo - this.tempo) * 0.15;
    this.stepSeconds = 15 / this.tempo;
    this.live = this.dj ? djEffects(this.effectsNow, this.move, index / LOOP_STEPS) : this.effectsNow;
    this.mix(this.live, time);
    const breakdown = (this.tide?.breakdown ?? 0) > 0;
    const answer = this.tides && this.passes % 2 === 0;
    this.scheduled = [...this.scheduled.slice(-15), { index, time, effects: this.live, move: this.dj ? this.move : "ruhe", energy: this.barEnergy, phase: this.tide?.phase ?? null, breakdown, answer }];
    if (!audible) return;

    const { drums, bass, chords, melody, extras } = this.groove;
    const energy = this.barEnergy;
    // Strips of tracks that were taken away go with them, on a bar line.
    if (inBar === 0) {
      for (const [id, { strip }] of this.extraStrips) {
        if (extras.some((extra) => extra.id === id)) continue;
        for (const node of [strip.dry, strip.room, strip.echo]) node.disconnect();
        this.extraStrips.delete(id);
      }
    }
    const chord = (answer ? turnaround(chords.bars) : chords.bars)[Math.floor(index / STEPS_PER_BAR)]!;
    const at = time + (index % 2 ? this.feel.swing * this.stepSeconds : 0);
    const due = (item: { step: number; min: number }, track: TrackId, length: number): boolean => item.step === index % length && plays(item, track, energy, chords.mode);

    if (inBar === 0) {
      this.pad(chordPitches(chords, chord), time, energy);
      this.pulse({ time, track: "chords", vel: 0.3, bar: true });
    }
    for (const hit of drums) {
      if (!due(hit, "drums", DRUM_STEPS)) continue;
      // A breakdown: kick and clap pause, the rest plays on.
      if (breakdown && (hit.voice === "kick" || hit.voice === "clap")) continue;
      this.drum(hit.voice, hit.vel, at);
      this.pulse({ time: at, track: "drums", vel: hit.vel, voice: hit.voice });
    }
    for (const hit of this.fill ?? []) {
      if (hit.step !== inBar) continue;
      this.drum(hit.voice, hit.vel, at);
      this.pulse({ time: at, track: "drums", vel: hit.vel, voice: hit.voice });
    }
    for (const note of bass) {
      if (!due(note, "bass", BASS_STEPS)) continue;
      const pitch = tonePitch(chords, chord, note.tone, BASS_LOW);
      this.play("bass", this.groove.sounds.bass, this.graph!.tracks.bass, [pitch], note.len, note.vel, at, energy);
      this.pulse({ time: at, track: "bass", vel: note.vel, pitch });
    }
    for (const stab of chords.stabs) {
      if (!due(stab, "chords", STAB_STEPS)) continue;
      this.play("chords", this.groove.sounds.chords, this.graph!.tracks.chords, chordPitches(chords, chord), stab.len, 1, at, energy);
      this.pulse({ time: at, track: "chords", vel: 0.8 });
    }
    for (const note of melody) {
      if (!due(note, "melody", LOOP_STEPS)) continue;
      const pitch = tonePitch(chords, chord, note.tone, this.feel.melodyLow);
      this.play("melody", this.groove.sounds.melody, this.graph!.tracks.melody, [pitch], note.len, note.vel, at, energy);
      this.pulse({ time: at, track: "melody", vel: note.vel, pitch });
    }
    for (const extra of extras) this.playExtra(extra, index, at, chord, energy);
  }

  /**
   * One sixteenth of an extra track. It plays like its role's core track and
   * follows the chord: a second melody an octave under the melody, an
   * arpeggio between the two, a Fläche holding the chord, percussion on the
   * drum bus with its own kit.
   */
  private playExtra(extra: Extra, index: number, at: number, chord: Groove["chords"]["bars"][number], energy: number): void {
    const { chords } = this.groove;
    const role = EXTRA_ROLES[extra.kind];
    const steps = EXTRA_STEPS[extra.kind];
    const strip = this.extraStrip(extra, role);
    const scale = levelGain(extra.level);
    const due = (item: { step: number; min: number }): boolean => item.step === index % steps && plays(item, role, energy, chords.mode);
    if (extra.kind === "perkussion") {
      for (const hit of extra.hits) {
        if (!due(hit)) continue;
        this.drum(hit.voice, hit.vel, at, extra.sound, strip);
        this.pulse({ time: at, track: role, vel: hit.vel, voice: hit.voice }, scale);
      }
      return;
    }
    for (const note of extra.notes) {
      if (!due(note)) continue;
      const low = extra.kind === "gegenstimme" ? this.feel.melodyLow - 12 : this.feel.melodyLow - 5;
      const pitches = extra.kind === "flaeche" ? chordPitches(chords, chord) : [tonePitch(chords, chord, note.tone, low)];
      this.play(extra.kind === "flaeche" ? "chords" : "melody", extra.sound, strip, pitches, note.len, note.vel, at, energy);
      this.pulse({ time: at, track: role, vel: note.vel, pitch: pitches[0]! }, scale);
    }
  }

  private extraStrip(extra: Extra, role: TrackId): Strip {
    let entry = this.extraStrips.get(extra.id);
    if (!entry) {
      entry = { strip: this.graph!.newStrip(role, extra.level), level: extra.level };
      this.extraStrips.set(extra.id, entry);
    } else if (entry.level !== extra.level) {
      for (const node of [entry.strip.dry, entry.strip.room, entry.strip.echo]) node.gain.setTargetAtTime(levelGain(extra.level), this.context!.currentTime, 0.03);
      entry.level = extra.level;
    }
    return entry.strip;
  }

  /** `scale` is the track's level when it is not one of the core tracks'. */
  private pulse(pulse: Pulse, scale?: number): void {
    // The picture shows what is heard: a silent track does not light up.
    const level = Math.min(1, scale ?? levelGain(this.levelsNow[pulse.track]));
    if (!level) return;
    pulse.vel *= level;
    // Nobody may be looking (a background tab): keep only the last moments.
    if (this.pulses.length > 200) this.pulses = this.pulses.slice(-100);
    this.pulses.push(pulse);
  }

  // ---- Voices --------------------------------------------------------------

  /** A drum hit, by default on the drums' kit and strip; an extra percussion track brings its own. */
  private drum(voice: DrumVoice, vel: number, time: number, kitId = this.groove.sounds.drums, strip = this.graph!.tracks.drums): void {
    const { music } = this.graph!;
    const { dry: drums, room } = strip;
    const kit = KITS[kitId] ?? KITS.staubig!;
    switch (voice) {
      case "kick": {
        const { from, to, drop, attack, decay, level, click } = kit.kick;
        const osc = this.osc("sine", from, time, Math.max(0.6, 2.5 * decay));
        osc.frequency.setValueAtTime(from, time);
        osc.frequency.exponentialRampToValueAtTime(to, time + drop);
        osc.connect(this.envelope(time, vel * level, attack, 0.06, decay)).connect(drums);
        if (click) this.noise(time, vel * click, "highpass", 2500, 0.0005, 0.012, drums);
        // The pumping: everything else ducks under the kick and swells back.
        music.gain.setTargetAtTime(1 - 0.1 * this.live.pump * vel, time, 0.005);
        music.gain.setTargetAtTime(1, time + 0.04, 0.1);
        break;
      }
      case "clap": {
        const { tone, decay, level } = kit.clap;
        if (this.groove.genre === "hiphop") {
          // Hip-hop's backbeat is a snare: a short drum tone that drops, and its rattle.
          const body = this.osc("triangle", (tone / 7) * 1.4, time, 0.3);
          body.frequency.setValueAtTime((tone / 7) * 1.4, time);
          body.frequency.exponentialRampToValueAtTime(tone / 7, time + 0.03);
          body.connect(this.envelope(time, vel * 0.35 * level, 0.001, 0.01, 0.09)).connect(drums);
          this.noise(time, vel * 0.55 * level, "highpass", 1800, 0.001, decay * 0.8, drums).connect(room);
          break;
        }
        this.noise(time, vel * 0.45 * level, "bandpass", tone, 0.001, 0.012, drums);
        this.noise(time + 0.011, vel * 0.45 * level, "bandpass", tone, 0.001, 0.012, drums);
        this.noise(time + 0.022, vel * 0.6 * level, "bandpass", tone, 0.001, decay, drums).connect(room);
        break;
      }
      case "hat":
        this.noise(time + jitter(), vel * kit.hat.level, "highpass", kit.hat.tone, 0.001, kit.hat.decay, drums);
        break;
      case "open":
        this.noise(time, vel * kit.open.level, "highpass", kit.hat.tone - 1000, 0.001, kit.open.decay, drums);
        break;
      case "shaker":
        this.noise(time + jitter(), vel * 0.5, "bandpass", 4800, 0.012, 0.06, drums);
        break;
      case "rim": {
        const amp = this.envelope(time, vel * kit.rim.level, 0.001, 0.004, 0.05);
        this.osc("triangle", kit.rim.tone, time, 0.2).connect(amp).connect(drums);
        amp.connect(room);
        break;
      }
      case "conga":
      case "bongo": {
        // A hand drum: a tone that drops a little, and the slap of the hand on top.
        const [from, to, decay, slap] = voice === "conga" ? [235, 200, 0.22, 1800] : [380, 340, 0.12, 2600];
        const osc = this.osc("sine", from, time, 0.5);
        osc.frequency.setValueAtTime(from, time);
        osc.frequency.exponentialRampToValueAtTime(to, time + 0.04);
        const amp = this.envelope(time, vel * 0.45, 0.002, 0.01, decay);
        osc.connect(amp).connect(drums);
        amp.connect(room);
        this.noise(time, vel * 0.08, "bandpass", slap, 0.001, 0.015, drums);
        break;
      }
      case "clave": {
        const amp = this.envelope(time, vel * 0.3, 0.001, 0.005, 0.06);
        this.osc("sine", 2500, time, 0.15).connect(amp).connect(drums);
        amp.connect(room);
        break;
      }
    }
  }

  /** The chord of the bar as a soft bed; it steps back as the energy rises and the stabs take over. */
  private pad(pitches: number[], time: number, energy: number): void {
    const { dry: music, room } = this.graph!.tracks.chords;
    const bar = this.stepSeconds * STEPS_PER_BAR;
    const filter = this.filter("lowpass", (380 + 700 * energy) * this.feel.brightness, 1);
    for (const pitch of pitches) {
      const osc = this.osc("sawtooth", hz(pitch), time, bar + 2.2);
      osc.detune.value = Math.random() * 12 - 6;
      osc.connect(filter);
    }
    // A sad mood leans on the bed.
    const amp = this.envelope(time, 0.085 * (1 - 0.6 * energy) * (0.6 + 0.4 * this.feel.space), 0.5, bar, 0.9);
    filter.connect(amp).connect(music);
    amp.connect(room);
  }

  /**
   * A note or a chord played by an instrument (`sound`) on a strip, in a role.
   * The bass stays dry, chords go into the room, the melody into the echo too.
   */
  private play(role: keyof typeof ROLE_LEVEL, sound: string, strip: Strip, pitches: number[], len: number, vel: number, time: number, energy: number): void {
    const context = this.context!;
    const { dry, room, echo } = strip;
    const patch: Patch = PATCHES[sound] ?? PATCHES.sub!;
    const { attack, hold = len * this.stepSeconds * 0.9, release } = patch.amp;
    const seconds = Math.max(attack, hold) + 3 * release + 0.05;
    const amp = this.envelope(time, patch.level * ROLE_LEVEL[role] * vel, attack, hold, release);
    let input: AudioNode = amp;

    if (patch.filter) {
      const { type = "lowpass", to, open = 0, peak = 1, decay = 0.1, q, relative } = patch.filter;
      const settle = (to + open * energy) * (relative ? hz(pitches[0]!) : 1) * this.feel.brightness;
      const filter = this.filter(type, Math.min(18000, settle), q);
      if (peak !== 1) {
        filter.frequency.setValueAtTime(Math.min(18000, settle * peak), time);
        filter.frequency.setTargetAtTime(Math.min(18000, settle), time, decay);
      }
      filter.connect(amp);
      input = filter;
    }

    // Vibrato bends every oscillator of the note at once, through their detune.
    let vibrato: GainNode | null = null;
    if (patch.vibrato) {
      vibrato = context.createGain();
      vibrato.gain.setValueAtTime(0, time);
      vibrato.gain.linearRampToValueAtTime(patch.vibrato.depth, time + Math.max(0.01, patch.vibrato.delay));
      this.osc("sine", patch.vibrato.rate, time, seconds).connect(vibrato);
    }

    for (const pitch of pitches) {
      const frequency = hz(pitch);
      let bend: GainNode | null = null;
      if (patch.fm) {
        const { ratio, from, open = 0, to, decay } = patch.fm;
        bend = context.createGain();
        bend.gain.setValueAtTime(frequency * (from + open * energy) * this.feel.brightness, time);
        bend.gain.setTargetAtTime(frequency * to, time, decay);
        this.osc("sine", frequency * ratio, time, seconds).connect(bend);
      }
      for (const wave of patch.waves) {
        const osc = this.osc(wave.type, frequency * (wave.ratio ?? 1), time, seconds);
        osc.detune.value = wave.detune ?? 0;
        bend?.connect(osc.frequency);
        vibrato?.connect(osc.detune);
        if (wave.level === undefined) {
          osc.connect(input);
        } else {
          const level = context.createGain();
          level.gain.value = wave.level;
          osc.connect(level).connect(input);
        }
      }
    }

    let output: AudioNode = amp;
    if (patch.tremolo) {
      const tremolo = context.createGain();
      tremolo.gain.value = 1 - patch.tremolo.depth / 2;
      const depth = context.createGain();
      depth.gain.value = patch.tremolo.depth / 2;
      this.osc("sine", patch.tremolo.rate, time, seconds).connect(depth).connect(tremolo.gain);
      output = amp.connect(tremolo);
    }
    output.connect(dry);
    if (role !== "bass") output.connect(room);
    if (role === "melody") output.connect(echo);
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

  /** A burst of filtered noise into `drums` (a drum strip); returns its output for extra sends. */
  private noise(time: number, peak: number, type: BiquadFilterType, frequency: number, attack: number, release: number, drums: AudioNode): GainNode {
    const { noise } = this.graph!;
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

  /** Brings the effects to the sound from the sixteenth at `time`, gliding there within it. */
  private mix(effects: Effects, time: number): void {
    const graph = this.graph;
    if (!graph) return;
    const { hall, echo, tape, filter, chorus, crush, vinyl } = effects;
    const glide = (param: AudioParam, value: number): void => {
      param.setTargetAtTime(value, time, this.stepSeconds / 3);
    };
    // A sad mood widens the room and lets the echo run longer.
    glide(graph.room.gain, 0.09 * hall * this.feel.space);
    glide(graph.echo.gain, 0.1 * echo);
    glide(graph.echoFeedback.gain, Math.min(0.75, (0.25 + 0.04 * echo) * (0.7 + 0.3 * this.feel.space)));
    // The tape: about five cents of slow wow and a trace of flutter at the middle setting.
    glide(graph.wow.gain, 0.0003 * tape);
    glide(graph.flutter.gain, 0.000004 * tape);
    glide(graph.dust.gain, 0.2 * tape);
    glide(graph.chorus.gain, 0.07 * chorus);
    if (graph.crush) glide(graph.crush, crush / 10);
    glide(graph.vinyl.gain, 0.07 * vinyl);
    // Half of it: the saturation curve spans twice full scale (see build).
    glide(graph.drive.gain, 0.5 * (0.7 + 0.06 * tape));
    // Left of the middle the lowpass comes down to 300 Hz, right of it the highpass climbs to 2 kHz.
    glide(graph.dull.frequency, filter < 0 ? 20000 * (300 / 20000) ** (-filter / 5) : 20000);
    glide(graph.thin.frequency, filter > 0 ? 20 * (2000 / 20) ** (filter / 5) : 20);
  }

  /** Brings the mood's feel to the fixed part of the sound, from the bar line at `time`. */
  private applyFeel(time: number): void {
    const graph = this.graph;
    if (!graph) return;
    graph.tone.frequency.setTargetAtTime(toneCutoff(this.energyNow) * this.feel.brightness, time, 0.4);
    graph.drums.gain.setTargetAtTime(this.feel.punch, time, 0.3);
    graph.echoTime.setTargetAtTime((15 / this.feel.tempo) * 3, time, 0.5);
  }

  private build(context: AudioContext, crusher: boolean): Graph {
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
    // then saturation and the lowpass of the energy. The saturation curve spans
    // twice full scale and the drive halves the signal, so a loud mix bends
    // further into it instead of hitting the curve's end.
    const wobble = context.createDelay(0.05);
    wobble.delayTime.value = 0.006;
    const wow = lfo(0.31, wobble.delayTime);
    const flutter = lfo(5.3, wobble.delayTime);
    const drive = gain(1);
    const saturation = context.createWaveShaper();
    saturation.curve = Float32Array.from({ length: 2048 }, (_, index) => Math.tanh(3.2 * (index / 1023.5 - 1)));
    const tone = this.filter("lowpass", toneCutoff(this.energyNow) * this.feel.brightness, 0.5);
    const dull = this.filter("lowpass", 20000, 0.9);
    const thin = this.filter("highpass", 20, 0.9);
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.ratio.value = 4;
    limiter.attack.value = 0.01;
    limiter.release.value = 0.2;
    const master = gain(this.volumeNow);
    // Chrome's compressor adds make-up gain and lets the start of a hit through, so it alone can clip.
    // The last stage cannot: it never goes past CEILING (effects.ts).
    const ceiling = context.createWaveShaper();
    ceiling.curve = limitCurve();
    // No oversampling: its resampling filter would ring past the curve's ceiling. The bend is gentle enough without.
    // Krümel comes after the energy's lowpass, which would otherwise take away the grit it adds.
    const crumble = crusher ? new AudioWorkletNode(context, "kruemel") : null;
    wobble.connect(drive).connect(saturation).connect(tone);
    (crumble ? tone.connect(crumble) : tone).connect(dull).connect(thin).connect(limiter).connect(master).connect(gain(0.5)).connect(ceiling).connect(context.destination);

    const drums = gain(this.feel.punch);
    drums.connect(wobble);
    const music = gain(1);
    music.connect(wobble);

    // Schweben: two copies of chords and melody on short delays that drift
    // slowly against each other, one to each side.
    const chorus = gain(0);
    for (const [rate, side] of [[0.27, -0.8], [0.41, 0.8]] as const) {
      const voice = context.createDelay(0.05);
      voice.delayTime.value = 0.014;
      const drift = context.createOscillator();
      drift.frequency.value = rate;
      drift.connect(gain(0.0035)).connect(voice.delayTime);
      drift.start();
      const pan = context.createStereoPanner();
      pan.pan.value = side;
      music.connect(voice).connect(pan).connect(chorus);
    }
    chorus.connect(wobble);

    const room = gain(0);
    const reverb = context.createConvolver();
    reverb.buffer = roomImpulse(context);
    room.connect(reverb).connect(music);

    // A dotted-eighth echo that gets duller with every repeat.
    const echo = gain(0);
    const delay = context.createDelay(1);
    delay.delayTime.value = this.stepSeconds * 3;
    const damp = this.filter("lowpass", 1800, 0.5);
    const echoFeedback = gain(0);
    echo.connect(delay).connect(damp).connect(music);
    damp.connect(echoFeedback).connect(delay);

    // Dust: the tape's hiss, pumping along with the kick.
    const dust = gain(0);
    const hiss = context.createBufferSource();
    hiss.buffer = dustLoop(context);
    hiss.loop = true;
    hiss.connect(dust).connect(music);
    hiss.start();

    // Knistern: a record's crackle and a low rumble. It joins after the kick's ducking and the
    // energy's lowpass, so it stays crisp; the filter for the hand still shapes it.
    const vinyl = gain(0);
    const record = context.createBufferSource();
    record.buffer = recordLoop(context);
    record.loop = true;
    record.connect(vinyl).connect(dull);
    record.start();

    const strip = (track: TrackId, setting = this.levelsNow[track]): Strip => {
      const level = levelGain(setting);
      const dry = gain(level);
      dry.connect(track === "drums" ? drums : music);
      const send = gain(level);
      send.connect(room);
      const toEcho = gain(level);
      toEcho.connect(echo);
      return { dry, room: send, echo: toEcho };
    };
    const tracks = { drums: strip("drums"), bass: strip("bass"), chords: strip("chords"), melody: strip("melody") };

    const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = noise.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;

    return { tracks, newStrip: strip, drums, music, room, echo, echoFeedback, wow, flutter, dust, drive, chorus, crush: crumble?.parameters.get("amount") ?? null, vinyl, echoTime: delay.delayTime, tone, dull, thin, master, noise };
  }
}

/** The lowpass over the whole mix: dull and far away when calm, open at full groove. */
const toneCutoff = (energy: number): number => 2600 + 11000 * energy * energy;

/** A few milliseconds off the grid, so hats and shaker are not machine-straight. */
const jitter = (): number => Math.random() * 0.004;

/** Eight seconds of a tape's quiet hiss. */
function dustLoop(context: AudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate * 8, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) samples[index] = (Math.random() * 2 - 1) * 0.006;
  return buffer;
}

/** Eleven seconds of a worn record: crackles big and small, and a low rumble. Not a multiple of the tape's loop, so they never line up. */
function recordLoop(context: AudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate * 11, context.sampleRate);
  const samples = buffer.getChannelData(0);
  let rumble = 0;
  for (let index = 0; index < samples.length; index += 1) {
    rumble += 0.004 * (Math.random() * 2 - 1 - rumble);
    samples[index] = rumble * 0.9;
  }
  for (let crackle = 0; crackle < 260; crackle += 1) {
    const at = Math.floor(Math.random() * (samples.length - 96));
    const size = Math.random() ** 4;
    const level = (0.05 + 0.6 * size) * (Math.random() < 0.5 ? -1 : 1);
    const length = 3 + 30 * size;
    for (let index = 0; index < 96; index += 1) samples[at + index]! += level * Math.exp(-index / length) * (index % 2 ? -0.4 : 1);
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

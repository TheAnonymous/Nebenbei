/*
 * The keyboard's media keys as a remote control while the tab is in the
 * background. Browsers hand those keys only to a page that plays a media
 * element of some length; Web Audio alone does not count. So a loop that
 * nobody can hear plays along with the music.
 */

export interface Remote {
  play(): void;
  pause(): void;
  next(): void;
  previous(): void;
}

let loop: HTMLAudioElement | null = null;

export function setUpMediaKeys(remote: Remote): void {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({ title: "Nebenbei", artist: "Musik zum Arbeiten, die von allein läuft" });
  navigator.mediaSession.setActionHandler("play", remote.play);
  navigator.mediaSession.setActionHandler("pause", remote.pause);
  navigator.mediaSession.setActionHandler("nexttrack", remote.next);
  navigator.mediaSession.setActionHandler("previoustrack", remote.previous);
}

/** Tells the browser whether music is playing. The first call must come from a click or key press. */
export function mediaKeysPlaying(playing: boolean): void {
  if (!("mediaSession" in navigator)) return;
  if (!loop) {
    loop = new Audio(URL.createObjectURL(quietWav()));
    loop.loop = true;
  }
  if (playing) void loop.play().catch(() => undefined);
  else loop.pause();
  navigator.mediaSession.playbackState = playing ? "playing" : "paused";
}

/**
 * Ten seconds of a 25 Hz square wave at the smallest step 16 bits can make
 * (-90 dB): far below hearing, but not digital silence, which Firefox would
 * not count as playing.
 */
export function quietWav(): Blob {
  const rate = 8_000;
  const samples = rate * 10;
  const view = new DataView(new ArrayBuffer(44 + samples * 2));
  const text = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let index = 0; index < samples; index += 1) view.setInt16(44 + index * 2, Math.floor(index / 160) % 2 ? 1 : -1, true);
  return new Blob([view], { type: "audio/wav" });
}

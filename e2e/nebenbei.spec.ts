import { expect, test, type Locator, type Page } from "@playwright/test";

const port = Number.parseInt(process.env.NEBENBEI_E2E_PORT ?? "4308", 10);

declare global {
  interface Window {
    __tap?: AnalyserNode;
  }
}

/** Collects what must not happen: page errors (the production CSP reports its blocks there), failed and external requests. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("requestfailed", (request) => errors.push(`Request fehlgeschlagen: ${request.url()} (${request.failure()?.errorText ?? "?"})`));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.origin !== `http://127.0.0.1:${port}`) errors.push(`Externer Request: ${request.url()}`);
  });
  return errors;
}

/** Listens in on what the page sends to the speakers. */
async function tapSound(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const connect = AudioNode.prototype.connect as (this: AudioNode, ...args: unknown[]) => unknown;
    AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
      if (args[0] instanceof AudioDestinationNode && !window.__tap) {
        window.__tap = this.context.createAnalyser();
        window.__tap.fftSize = 32768;
        connect.call(this, window.__tap);
      }
      return connect.apply(this, args);
    } as typeof AudioNode.prototype.connect;
  });
}

const loudest = (page: Page): Promise<number> =>
  page.evaluate(() => {
    if (!window.__tap) return 0;
    const samples = new Float32Array(window.__tap.fftSize);
    window.__tap.getFloatTimeDomainData(samples);
    return samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
  });

/** What each lane shows (drums, bass, chords, melody), to tell whether a track changed. */
const lanes = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...document.querySelectorAll(".track")].map((track) => [...track.querySelectorAll("i:not(.mark-leave-active)")].map((mark) => mark.getAttribute("style")).sort().join() + track.querySelector(".lane")!.textContent));

/** The four tracks of the groove as the page stores it, to tell changes that the lanes do not show (a chord's inversion). */
const storedTracks = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const { groove } = JSON.parse(localStorage.getItem("nebenbei.jetzt")!) as { groove: Record<string, unknown> };
    return ["drums", "bass", "chords", "melody"].map((track) => JSON.stringify(groove[track]));
  });

const play = (page: Page) => page.locator(".play");
const entries = (page: Page, title: string) => page.locator(`.logbook h3:text-is("${title}") + ul > li`);

test("plays by itself, changes without being touched and fills the day strip", async ({ page }) => {
  test.setTimeout(60_000);
  const errors = watchErrors(page);
  await tapSound(page);
  await page.goto("./");
  await expect(page).toHaveTitle("Nebenbei");
  await expect(page.locator(".track")).toHaveCount(4);
  const before = await storedTracks(page);

  await play(page).click();
  await expect(play(page)).toHaveText("Pause");
  await expect(page).toHaveTitle("▶ Nebenbei");
  await expect.poll(() => loudest(page)).toBeGreaterThan(0.05);
  // The media keys reach the page: the browser knows that music is playing.
  expect(await page.evaluate(() => `${navigator.mediaSession.playbackState} ${navigator.mediaSession.metadata?.title}`)).toBe("playing Nebenbei");
  await expect(page.locator(".strip span[style]")).toHaveCount(1);

  // After eight bars (about 16 seconds) one track changes a little and glows.
  await expect(page.locator(".track.changed")).toHaveCount(1, { timeout: 30_000 });
  const after = await storedTracks(page);
  expect(after.filter((track, index) => track !== before[index])).toHaveLength(1);
  // It never gets loud enough to clip.
  expect(await loudest(page)).toBeLessThan(0.99);

  // The sky behind the page moves with the music.
  const sky = (): Promise<string> => page.locator(".sky").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  const picture = await sky();
  await expect.poll(sky).not.toBe(picture);

  // The mood slider turns minor into major on the next bar line; the chords get new names.
  const chords = page.locator(".track.chords .lane");
  const sad = await chords.textContent();
  for (let press = 0; press < 4; press += 1) await page.keyboard.press("ArrowRight");
  await expect(page.locator(".mood output")).toHaveText("Lydisch · 126 BPM");
  await expect(chords).not.toHaveText(sad!, { timeout: 4_000 });
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem("nebenbei.jetzt")!) as { groove: { chords: { mode: number } } }).groove.chords.mode)).toBe(4);
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".mood output")).toHaveText("Dur · 121 BPM");

  // Everything all the way up, the loudest instruments, no ducking: the output still stays below full scale.
  const slide = async (input: Locator, value: string): Promise<void> =>
    input.evaluate((element: HTMLInputElement, to) => {
      element.value = to;
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  for (const input of await page.locator(".level").all()) await slide(input, "100");
  await slide(page.locator(".effects .volume input"), "100");
  await slide(page.locator(".energy:not(.mood) input"), "10");
  for (const [name, value] of [["Hall", "10"], ["Echo", "10"], ["Band", "10"], ["Pumpen", "0"]] as const) await slide(page.locator(".effects label", { hasText: name }).locator("input"), value);
  for (const [track, sound] of [["drums", "tr909"], ["bass", "sub"], ["chords", "saege"], ["melody", "chor"]] as const) await page.locator(`.track.${track} .sound`).selectOption(sound);
  let loudestAtFull = 0;
  for (let look = 0; look < 30; look += 1) {
    loudestAtFull = Math.max(loudestAtFull, await loudest(page));
    await page.waitForTimeout(200);
  }
  expect(loudestAtFull).toBeGreaterThan(0.5);
  expect(loudestAtFull).toBeLessThanOrEqual(0.981);
  // A track turned all the way down steps back.
  await slide(page.locator(".track.melody .level"), "0");
  await expect(page.locator(".track.melody")).toHaveClass(/silent/);

  await page.keyboard.press("Space");
  await expect(play(page)).toHaveText("Start");
  expect(await page.evaluate(() => navigator.mediaSession.playbackState)).toBe("paused");
  expect(errors).toEqual([]);
});

test("rolls, holds, goes back, keeps grooves and survives a reload", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("./");
  const start = await lanes(page);

  // Rolling the bass changes the bass alone; Z brings the old one back.
  await page.keyboard.press("2");
  const rolled = await lanes(page);
  expect(rolled.map((lane, index) => lane !== start[index])).toEqual([false, true, false, false]);
  await expect(entries(page, "Verlauf")).toHaveCount(1);
  await page.keyboard.press("z");
  expect(await lanes(page)).toEqual(start);
  await expect(entries(page, "Verlauf")).toHaveCount(0);

  // Held drums stay through "roll everything", and their own dice is off.
  await page.keyboard.press("Shift+1");
  await expect(page.getByRole("button", { name: "Drums würfeln" })).toBeDisabled();
  await page.keyboard.press("1");
  await page.keyboard.press("0");
  const second = await lanes(page);
  expect(second.map((lane, index) => lane !== start[index])).toEqual([false, true, true, true]);

  // M keeps a groove once, however often it is pressed.
  await page.keyboard.press("m");
  await page.keyboard.press("m");
  await expect(entries(page, "Gemerkt")).toHaveCount(1);
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".energy:not(.mood) output")).toHaveText("6");

  // Q takes the next kit of the drums and changes nothing else; any instrument can go on any other track.
  const drumSound = page.locator(".track.drums .sound");
  const firstKit = await drumSound.inputValue();
  await page.keyboard.press("q");
  await expect(drumSound).not.toHaveValue(firstKit);
  const secondKit = await drumSound.inputValue();
  expect(await lanes(page)).toEqual(second);
  const bassSound = page.locator(".track.bass .sound");
  expect(await bassSound.locator("option").count()).toBeGreaterThanOrEqual(20);
  await bassSound.selectOption({ label: "Vibraphon" });
  await expect(bassSound).toHaveValue("vibraphon");
  // The menu lets go of the keyboard: the arrows are the energy again.
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".energy:not(.mood) output")).toHaveText("5");
  await page.keyboard.press("ArrowUp");

  // D lets the DJ play the effects.
  const dj = page.getByRole("button", { name: /^DJ/ });
  await page.keyboard.press("d");
  await expect(dj).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".effects")).toHaveClass(/dj/);
  const hall = page.locator(".effects label", { hasText: "Hall" });
  await hall.locator("input").evaluate((input: HTMLInputElement) => {
    input.value = "9";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(hall.locator("output")).toHaveText("9");

  // The page picks up where it stopped.
  await page.reload();
  expect(await lanes(page)).toEqual(second);
  await expect(page.locator(".energy:not(.mood) output")).toHaveText("6");
  await expect(page.locator(".track.drums")).toHaveClass(/held/);
  await expect(drumSound).toHaveValue(secondKit);
  await expect(bassSound).toHaveValue("vibraphon");
  await expect(dj).toHaveAttribute("aria-pressed", "true");
  await expect(hall.locator("output")).toHaveText("9");
  await expect(entries(page, "Gemerkt")).toHaveCount(1);
  await expect(entries(page, "Verlauf")).toHaveCount(1);

  // A click on a kept groove plays it again, wherever the music has gone since.
  await page.getByRole("button", { name: "Alles würfeln" }).click();
  expect(await lanes(page)).not.toEqual(second);
  await entries(page, "Gemerkt").locator(".entry").click();
  expect(await lanes(page)).toEqual(second);
  await expect(entries(page, "Verlauf")).toHaveCount(3);

  // While the music plays, a roll waits for the bar line.
  await page.keyboard.press("Space");
  await expect(play(page)).toHaveText("Pause");
  // Early in a bar (the line over the lanes says where), so the next bar line is about a second away.
  await page.waitForFunction(() => {
    const position = Number(/translateX\(([\d.]+)%\)/.exec(document.querySelector<HTMLElement>(".lane b")?.style.transform ?? "")?.[1] ?? -100) / 100;
    return position % 16 >= 1 && position % 16 < 6;
  });
  await page.keyboard.press("3");
  const dice = page.getByRole("button", { name: "Akkorde würfeln" });
  await expect(dice).toHaveClass(/waiting/);
  expect((await lanes(page))[2]).toBe(second[2]);
  await expect(dice).not.toHaveClass(/waiting/, { timeout: 4_000 });
  expect((await lanes(page))[2]).not.toBe(second[2]);

  // The rolls and the kept groove are on the day strip.
  await expect(page.locator(".day")).toContainText("gemerkt");
  // One bar, or two when the test crossed a five-minute line of the clock.
  await expect(page.locator(".strip .nudged").first()).toBeVisible();
  expect(await page.locator(".strip .nudged").count()).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
});

test("starts fresh when the browser's storage is broken", async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("nebenbei.jetzt", "{kaputt");
    localStorage.setItem("nebenbei.logbuch", JSON.stringify({ kept: [{ at: 1, name: "alt", groove: { drums: "?" } }], trail: 7 }));
    localStorage.setItem("nebenbei.tag", JSON.stringify({ date: "gestern", bins: [1, 2] }));
  });
  await tapSound(page);
  await page.goto("./");
  await expect(page.locator(".track")).toHaveCount(4);
  await expect(entries(page, "Gemerkt")).toHaveCount(0);
  await play(page).click();
  await expect.poll(() => loudest(page)).toBeGreaterThan(0.05);
  expect(errors).toEqual([]);
});

test("tides: an eight-bar progression, the energy's arc on the slider, and a calm sky", async ({ page }) => {
  test.setTimeout(60_000);
  const errors = watchErrors(page);
  await page.goto("./");
  // Held chords do not breed, so any change of their names comes from the answering pass.
  await page.keyboard.press("Shift+3");
  const chords = page.locator(".track.chords .lane");
  const stored = (await chords.textContent())!;
  await page.keyboard.press("g");
  await expect(page.getByRole("button", { name: /^Gezeiten/ })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("h");
  await expect(page.getByRole("button", { name: /^Ruhiger Himmel/ })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Space");
  await expect(play(page)).toHaveText("Pause");

  // The tides name their phase, and their dot on the energy shows where they have taken it.
  await expect(page.locator(".energy .move")).toHaveText(/Aufbau|Plateau|Abbau|Tal|Pause der Drums/);
  await expect(page.locator(".energy.tides .dj-dot")).toBeVisible();
  // Every second pass answers the first: the chords run over eight bars, then come back.
  await expect(chords).not.toHaveText(stored, { timeout: 25_000 });
  await expect(chords).toHaveText(stored, { timeout: 15_000 });
  // The calm sky still moves.
  const sky = (): Promise<string> => page.locator(".sky").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  const picture = await sky();
  await expect.poll(sky).not.toBe(picture);

  await page.reload();
  await expect(page.getByRole("button", { name: /^Gezeiten/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /^Ruhiger Himmel/ })).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("installs as an app: manifest and icons load, and after one visit it starts offline", async ({ page, context }) => {
  const errors = watchErrors(page);
  await page.goto("./");
  const manifestUrl = await page.locator('link[rel="manifest"]').getAttribute("href");
  const manifest = (await (await page.request.get(manifestUrl!)).json()) as { start_url: string; scope: string; display: string; icons: { src: string; sizes: string; purpose: string }[] };
  expect(manifest).toMatchObject({ start_url: "/Nebenbei/", scope: "/Nebenbei/", display: "standalone" });
  expect(manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose}`)).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
  for (const icon of manifest.icons) {
    const response = await page.request.get(new URL(icon.src, new URL(manifestUrl!, page.url())).href);
    expect(response.headers()["content-type"]).toBe("image/png");
  }
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 10_000 });
  await page.keyboard.press("m");

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".track"), "offline aus dem Speicher des Laptops").toHaveCount(4);
  await expect(entries(page, "Gemerkt")).toHaveCount(1);
  await page.keyboard.press("Space");
  await expect(play(page)).toHaveText("Pause");
  await page.keyboard.press("Space");
  await context.setOffline(false);
  expect(errors).toEqual([]);
});

test("up to eight tracks: four more of their own kinds, each with its key, instrument and level", async ({ page }) => {
  const errors = watchErrors(page);
  await tapSound(page);
  await page.goto("./");
  const add = page.getByRole("combobox", { name: "Spur hinzufügen" });
  for (const kind of ["perkussion", "arpeggio", "flaeche", "gegenstimme"]) await add.selectOption(kind);
  await expect(page.locator(".track")).toHaveCount(8);
  await expect(page.locator(".track.extra")).toHaveCount(4);
  await expect(add).toBeDisabled();
  // Each new track has marks, an instrument and a level of its own.
  for (const kind of ["perkussion", "arpeggio", "flaeche", "gegenstimme"]) {
    const track = page.locator(`.track.${kind}`);
    expect(await track.locator(".lane i").count()).toBeGreaterThan(0);
    expect(await track.locator(".sound").inputValue()).not.toBe("");
  }
  await page.locator(".track.arpeggio .sound").selectOption("marimba");
  await page.locator(".track.flaeche .level").evaluate((input: HTMLInputElement) => {
    input.value = "30";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  // 5 to 8 roll the extra tracks, Shift holds them.
  const arpMarks = () => page.locator(".track.arpeggio .lane").evaluate((lane) => [...lane.querySelectorAll("i")].map((mark) => mark.getAttribute("style")).sort().join());
  await page.keyboard.press("Shift+5");
  await expect(page.locator(".track.perkussion")).toHaveClass(/held/);
  const before = await arpMarks();
  let changed = false;
  for (let tries = 0; tries < 5 && !changed; tries += 1) {
    await page.keyboard.press("6");
    changed = (await arpMarks()) !== before;
  }
  expect(changed).toBe(true);

  // The extra tracks play: with only the percussion up, there is sound.
  for (const input of await page.locator(".track:not(.perkussion) .level").all()) {
    await input.evaluate((element: HTMLInputElement) => {
      element.value = "0";
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  await page.keyboard.press("Space");
  await expect.poll(() => loudest(page), { timeout: 10_000 }).toBeGreaterThan(0.02);
  await page.keyboard.press("Space");

  // They come back after a reload, with their instrument, level and hold; one can be taken away again.
  await page.reload();
  await expect(page.locator(".track.extra")).toHaveCount(4);
  await expect(page.locator(".track.arpeggio .sound")).toHaveValue("marimba");
  await expect(page.locator(".track.flaeche .level")).toHaveValue("0");
  await expect(page.locator(".track.perkussion")).toHaveClass(/held/);
  await page.getByRole("button", { name: "Spur Fläche entfernen" }).click();
  await expect(page.locator(".track")).toHaveCount(7);
  await expect(add).toBeEnabled();
  expect(errors).toEqual([]);
});

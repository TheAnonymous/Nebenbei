import { expect, test, type Page } from "@playwright/test";

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
  await expect(page.locator(".strip .nudged")).toHaveCount(1);
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

# Nebenbei

Nebenbei ist eine Groovebox für den Laptop-Browser, die beim Arbeiten von
allein läuft: Lo-Fi-House aus vier Spuren (Drums, Bass, Akkorde, Melodie), die
sich langsam selbst verändern. Man programmiert nichts, man greift nur ab und
zu ein. Alles läuft im Browser, ohne Konto, Backend, Samples oder externe
Requests.

## Stand

Alle vier Bauschritte: **Klang und Selbstlauf, Festhalten und Würfeln, Logbuch,
Feinschliff.** Die App läuft unter <https://musik.jodie-oesterling.de/Nebenbei/>.

- Start/Pause. Die Musik läuft weiter, wenn der Tab im Hintergrund ist.
- Alle acht Takte (etwa 16 Sekunden) ändert sich an einer Spur eine
  Kleinigkeit; die Spur leuchtet dabei kurz auf. Kick auf den Vierteln und
  Clap auf zwei und vier bleiben immer stehen.
- **Energie** (0–10): von fast Ambient (nur Akkordfläche und Staub) bis voller
  Groove. Instrumente kommen und gehen auf dem Taktstrich; blasse Marken
  warten auf mehr Energie. Das Tempo bleibt bei 118 BPM.
- Bass und Melodie sind relativ zum Akkord ihres Takts notiert und folgen
  jeder Änderung der Akkorde.
- **Festhalten:** Eine gehaltene Spur bleibt, wie sie ist: keine Mutation, kein
  Würfeln, kein Zurück.
- **Würfeln:** Die Spur bekommt ein neues Muster. Läuft die Musik, setzt es am
  nächsten Taktstrich ein (höchstens zwei Sekunden später).
- **Logbuch.** „Gemerkt“ sind die Grooves, die man mit `M` festhält, mit
  Uhrzeit und einem Namen wie „staubig, d-Moll“. Im „Verlauf“ landet vor jedem
  Würfeln und Zurückholen von selbst der Groove, der gerade lief (die letzten
  20). Ein Klick auf einen Eintrag spielt ihn wieder, ab dem nächsten
  Taktstrich; gehaltene Spuren bleiben dabei stehen.
- **Zurück** nimmt das letzte Würfeln oder Zurückholen zurück: Der neueste
  Eintrag des Verlaufs kommt wieder und verlässt den Verlauf.
- **Heute.** Der Tagesstreifen zeigt den Arbeitstag in Fünf-Minuten-Balken: so
  hoch wie die Energie, mit heller Kappe, wo gewürfelt oder zurückgeholt wurde,
  und rosa, wo ein Groove gemerkt wurde. Er beginnt jeden Tag neu.
- Der laufende Groove, Energie, Lautstärke, gehaltene Spuren, das Logbuch und
  der Tagesstreifen liegen im Speicher des Browsers (`localStorage`) und
  überstehen das Neuladen. Was von dort zurückkommt, wird vor dem Abspielen
  geprüft.

| Eingabe | Wirkung |
|---|---|
| Leertaste | Start / Pause |
| `1`–`4` | Spur würfeln |
| `Shift` + `1`–`4` | Spur festhalten / loslassen |
| `0` | alles würfeln, was nicht gehalten ist |
| `Z` | zurück |
| `M` | Groove merken |
| `↑` / `↓` | Energie |
| Medientaste Play/Pause | Start / Pause, auch bei Tab im Hintergrund |
| Medientaste Weiter | alles würfeln, was nicht gehalten ist |
| Medientaste Zurück | zurück |

Für die Medientasten spielt neben der Musik eine unhörbare Schleife in einem
Audio-Element mit: Browser geben die Tasten nur an Seiten, die ein
Medienelement abspielen.

## Entwickeln

```bash
mise exec -- npm install
mise exec -- npm run dev      # http://localhost:5173/Nebenbei/
mise exec -- npm run verify   # Lint, Typprüfung, Tests, Build, Playwright
```

- `src/music/groove.ts`: der Groove als Daten, Würfeln und Mutieren (reine
  Funktionen, getestet in `tests/groove.test.ts`).
- `src/audio/engine.ts`: Taktgeber und Klangerzeugung (Web Audio).
- `src/day.ts`: der Tagesstreifen (getestet in `tests/day.test.ts`).
- `src/logbook.ts`: was der Browser behält, und die Prüfung beim Zurücklesen
  (getestet in `tests/logbook.test.ts`).
- `src/media-keys.ts`: Medientasten.
- `src/App.vue`: die Seite, Tasten, Festhalten, Würfeln, Zurück, Logbuch.
- `e2e/nebenbei.spec.ts`: die App im Browser, gegen den Build mit der
  Content-Security-Policy der Live-Seite.

Veröffentlicht wird aus dem Repository `server-infra-nixos`
(`./scripts/musik-release.sh Nebenbei`); es geht nur hinaus, was auf `main`
committet ist.

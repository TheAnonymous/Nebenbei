# Nebenbei

Nebenbei ist eine Groovebox für den Laptop-Browser, die beim Arbeiten von
allein läuft: Lo-Fi-House aus vier Spuren (Drums, Bass, Akkorde, Melodie), die
sich langsam selbst verändern. Man programmiert nichts, man greift nur ab und
zu ein. Alles läuft im Browser, ohne Konto, Backend, Samples oder externe
Requests.

## Stand

Bauschritt 1 von 4: **Klang und Selbstlauf.**

- Start/Pause. Die Musik läuft weiter, wenn der Tab im Hintergrund ist.
- Alle acht Takte (etwa 16 Sekunden) ändert sich an einer Spur eine
  Kleinigkeit; die Spur leuchtet dabei kurz auf. Kick auf den Vierteln und
  Clap auf zwei und vier bleiben immer stehen.
- **Energie** (0–10): von fast Ambient (nur Akkordfläche und Staub) bis voller
  Groove. Instrumente kommen und gehen auf dem Taktstrich; blasse Marken
  warten auf mehr Energie. Das Tempo bleibt bei 118 BPM.
- Bass und Melodie sind relativ zum Akkord ihres Takts notiert und folgen
  jeder Änderung der Akkorde.

Noch nicht gebaut: Festhalten und Würfeln, Tasten und Medientasten (Schritt 2),
Logbuch (Schritt 3), Feinschliff und Veröffentlichung auf
musik.jodie-oesterling.de (Schritt 4). Bis zum Logbuch beginnt jeder Seitenaufruf
mit einem neuen Groove.

## Entwickeln

```bash
mise exec -- npm install
mise exec -- npm run dev      # http://localhost:5173/Nebenbei/
mise exec -- npm run verify   # Typprüfung, Tests, Build
```

- `src/music/groove.ts`: der Groove als Daten, Würfeln und Mutieren (reine
  Funktionen, getestet in `tests/groove.test.ts`).
- `src/audio/engine.ts`: Taktgeber und Klangerzeugung (Web Audio).
- `src/App.vue`: die Seite.

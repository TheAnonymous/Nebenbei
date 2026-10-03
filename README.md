# Nebenbei

Nebenbei ist eine Groovebox für den Laptop-Browser, die beim Arbeiten von
allein läuft: Lo-Fi-House aus vier Spuren (Drums, Bass, Akkorde, Melodie), die
sich langsam selbst verändern. Man programmiert nichts, man greift nur ab und
zu ein. Alles läuft im Browser, ohne Konto, Backend, Samples oder externe
Requests.

## Stand

Bauschritte 1 und 2 von 4: **Klang und Selbstlauf, Festhalten und Würfeln.**

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
- **Zurück** holt den Groove von vor dem letzten Würfeln wieder (bis zu 50
  Schritte, nur bis zum Neuladen der Seite).

| Eingabe | Wirkung |
|---|---|
| Leertaste | Start / Pause |
| `1`–`4` | Spur würfeln |
| `Shift` + `1`–`4` | Spur festhalten / loslassen |
| `0` | alles würfeln, was nicht gehalten ist |
| `Z` | zurück |
| `↑` / `↓` | Energie |
| Medientaste Play/Pause | Start / Pause, auch bei Tab im Hintergrund |
| Medientaste Weiter | alles würfeln, was nicht gehalten ist |
| Medientaste Zurück | zurück |

Für die Medientasten spielt neben der Musik eine unhörbare Schleife in einem
Audio-Element mit: Browser geben die Tasten nur an Seiten, die ein
Medienelement abspielen.

Noch nicht gebaut: Logbuch (Schritt 3), Feinschliff und Veröffentlichung auf
musik.jodie-oesterling.de (Schritt 4). Bis zum Logbuch beginnt jeder
Seitenaufruf mit einem neuen Groove.

## Entwickeln

```bash
mise exec -- npm install
mise exec -- npm run dev      # http://localhost:5173/Nebenbei/
mise exec -- npm run verify   # Typprüfung, Tests, Build
```

- `src/music/groove.ts`: der Groove als Daten, Würfeln und Mutieren (reine
  Funktionen, getestet in `tests/groove.test.ts`).
- `src/audio/engine.ts`: Taktgeber und Klangerzeugung (Web Audio).
- `src/media-keys.ts`: Medientasten.
- `src/App.vue`: die Seite, Tasten, Festhalten, Würfeln, Zurück.

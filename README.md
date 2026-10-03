# Nebenbei

Nebenbei ist eine Groovebox für den Laptop-Browser, die beim Arbeiten von
allein läuft: Lo-Fi-House aus vier Spuren (Drums, Bass, Akkorde, Melodie), die
sich langsam selbst verändern. Man programmiert nichts, man greift nur ab und
zu ein. Alles läuft im Browser, ohne Konto, Backend, Samples oder externe
Requests.

## Stand

Alle vier Bauschritte (Klang und Selbstlauf, Festhalten und Würfeln, Logbuch,
Feinschliff), dazu Instrumente, Stimmung, Effekte, DJ, Gezeiten und der Himmel. Die App
läuft unter <https://musik.jodie-oesterling.de/Nebenbei/>.

- Start/Pause. Die Musik läuft weiter, wenn der Tab im Hintergrund ist.
- Alle acht Takte (etwa 16 Sekunden) ändert sich an einer Spur eine
  Kleinigkeit; die Spur leuchtet dabei kurz auf. Kick auf den Vierteln und
  Clap auf zwei und vier bleiben immer stehen.
- **Energie** (0–10): von fast Ambient (nur Akkordfläche und Staub) bis voller
  Groove. Instrumente kommen und gehen auf dem Taktstrich; blasse Marken
  warten auf mehr Energie. Die Energie ändert das Tempo nicht.
- Bass und Melodie sind relativ zum Akkord ihres Takts notiert und folgen
  jeder Änderung der Akkorde.
- **Stimmung** (traurig bis fröhlich): fünf Tonleitern von Moll über Dorisch,
  Mixolydisch und Dur bis Lydisch. Jede Stufe hebt genau einen Ton der
  Tonleiter, die Akkorde, der Bass und die Melodie gehen mit; gewechselt wird
  auf dem Taktstrich. Den verminderten Akkord jeder Tonleiter ersetzt der
  Akkord eine Terz tiefer. Mit der Tonleiter ändert sich das ganze Gefühl:
  traurig ist langsam (104 BPM), gerade, dumpf und weit, mit viel Hall, langem
  Echo, wenigen Drums und einer tiefen, sparsamen Melodie; fröhlich ist schnell
  (126 BPM), geswingt, hell und trocken, mit dichteren Drums und einer hohen,
  geschwätzigen Melodie. Das Tempo gleitet in etwa einem Takt hinüber.
- **Instrumente:** 22 Instrumente, und jedes kann auf Bass, Akkorde oder
  Melodie: Bass (Sub, Rund, Reese, Kontrabass, Kantig), Tasten (E-Piano,
  Kassettenpiano, Orgel, House-Orgel, Clavinet), Flächen (Säge, Streicher,
  Chor), Glocken & Hölzer (Glocke, Glasharfe, Vibraphon, Marimba, Kalimba),
  Melodie (Flöte, Pfiff, Gezupft, Gameboy). Die Drums haben sechs Kits
  (Staubig, Knackig, Weich, 808, 909, Kiste). Das Menü unter dem Spurnamen
  zeigt alle; `Q` `W` `E` `R` gehen die durch, die zur Spur am besten passen.
  Die Lautstärken sind auf der jeweiligen Stammspur gemessen angeglichen.
  Stimmung und Instrumente gehören zum Groove: Würfeln lässt sie stehen, das
  Logbuch merkt sie sich.
- **Bis zu acht Spuren:** Unter den vier festen Spuren fügt „+ Spur hinzufügen“
  bis zu vier weitere hinzu: **Perkussion** (Conga, Bongo, Clave, Rim und
  Shaker, ohne Kick und Clap, mit eigenem Kit), **Gegenstimme** (eine zweite
  Melodie eine Oktave tiefer, mit längeren Tönen), **Arpeggio** (läuft in
  Achteln oder Sechzehnteln durch die Akkordtöne) und **Fläche** (hält die
  Akkorde, etwa mit Streichern oder Chor). Sie folgen den Akkorden, der
  Stimmung und den Gezeiten, mutieren mit den anderen, haben ein eigenes
  Instrument, eine eigene Lautstärke und die Tasten `5`–`8` (würfeln, mit
  `Shift` festhalten); × nimmt eine wieder weg. Zusätzliche Spuren gehören zum
  Groove: Das Logbuch merkt sie sich, Zurück holt eine weggenommene wieder.
  Mit acht Spuren ist der Mix nur etwa 1 dB lauter als mit vier.
- **Lautstärke pro Spur:** der kleine Regler unter dem Instrument. Bei 80
  klingt die Spur so, wie das Instrument eingemessen ist, darüber bis etwa
  4 dB lauter, ganz unten ist sie stumm (die Spur wird dann blass). Er regelt
  auch, wie viel von der Spur in Hall und Echo geht.
- **Kein Übersteuern:** Die letzte Stufe vor den Lautsprechern lässt das Signal
  bis 0,8 unberührt und biegt alles darüber weich gegen 0,98, nie darüber,
  egal wie laut die Spuren, die Effekte und die Lautstärke stehen. Bei den
  Grundeinstellungen greift sie praktisch nie (gemessen: 0,01 % der Samples).
  Die Bandsättigung davor deckt das Doppelte des Vollausschlags ab, damit ein
  lauter Mix weich in sie hineinläuft statt an ihr Ende zu stoßen.
- **Genre:** Lo-Fi-House (104–126 BPM, Kick auf jedem Viertel, kurze
  Akkord-Stabs) oder Lo-Fi-Hip-Hop (72–88 BPM, starker Swing, Boom-Bap mit Kick
  auf der Eins und dem Und der Drei und Snare auf zwei und vier, längere
  Basstöne, gehaltene Nonen-Akkorde, eine sparsamere Melodie, Rhodes und
  E-Piano). Gewechselt wird am Taktstrich: Drums, Bass, Melodie und der
  Rhythmus der Akkorde fangen im neuen Stil neu an, mit passenden Instrumenten;
  Tonart, Stimmung und Akkordfolge bleiben, gehaltene und zusätzliche Spuren
  auch. Das Logbuch zeigt das Genre jedes Grooves.
- **Effekte:** Hall, Echo, Band (Leiern, Rauschen, Sättigung), Pumpen (wie tief
  alles unter der Kick wegtaucht), ein Filter (links dumpf, rechts dünn, Mitte
  aus), Schweben (ein Chorus, der Akkorde und Melodie breit ins Stereo legt),
  Krümel (weniger Bits und Samples wie ein alter Sampler, als AudioWorklet)
  und Knistern (Plattenknistern und Rumpeln).
- **DJ** (`D`): bedient die Effekte selbst, ein Griff pro Durchlauf der vier
  Takte, immer ausgehend von deinen Reglern: Filterfahrt (dumpf und zurück),
  Anlauf (Hochpass und Hall steigen, beim nächsten Durchlauf ist alles wieder
  da), Echo-Wurf (die letzten Schläge ins Echo), Hallwelle, Bandleiern,
  Pumpen, Krümelwurf (der Klang zerbröselt zum Ende hin), Schwebe, oder er
  lässt es laufen. Je ruhiger der Groove, desto öfter lässt er
  ihn in Ruhe; je mehr Energie, desto mehr Anläufe und Pumpen. Ein leuchtender
  Punkt auf jedem Regler zeigt, wo der DJ ihn gerade hat. Er spielt im
  Taktgeber mit und arbeitet deshalb auch, wenn der Tab im Hintergrund liegt.
- **Der Himmel** hinter der Seite wird auf der Grafikkarte gemalt (WebGL): ein
  langsam fließender Nebel in vier Farben je Stimmung (Moll eine Nacht mit
  türkisem Nordlicht, Dorisch blau, Mixolydisch magenta, Dur ein Sonnenuntergang,
  Lydisch ein goldener Abend unter violettem Himmel), davor vier
  Nordlicht-Vorhänge, einer pro Spur, mit heller Unterkante und aufsteigenden
  Strahlen, die mit ihrer Spur aufflammen, gefaltet und in Flecken über den
  Himmel verteilt. Sterne funkeln mit den Hi-Hats, der ganze Himmel atmet mit
  der Kick und glüht vom Horizont her, Melodietöne werden zu Lichtern, die
  traurig sinken und fröhlich steigen, ab und zu fällt eine Sternschnuppe. In
  der Pause der Drums (Gezeiten) öffnet sich der Himmel ein wenig. Feines Korn
  verhindert Farbstufen, eine Vignette und eine weiche Tonkurve halten ihn dunkel
  genug für die Seite. Er wird in halber Auflösung höchstens 30-mal pro Sekunde
  gemalt, pausiert 10-mal (gemessen: 1,4 ms je Bild auf einer integrierten
  AMD-Grafik); ohne WebGL bleibt der schlichte Hintergrund.
- **Ruhiger Himmel** (`H`): zum Konzentrieren langsamer und sanfter, ohne
  Lichter, Funken und Blitze auf den Drums, 20 Bilder pro Sekunde.
- **Die Seite bewegt sich mit:** Die Abspiellinie gleitet, Noten leuchten auf,
  wenn sie klingen, hinter jeder Spur glüht es im Takt ihrer Spur, der
  Start-Knopf pulst mit der Kick. Neue Noten springen ins Bild, alte zerplatzen,
  Logbuch-Einträge gleiten herein. Wer im System weniger Bewegung eingestellt
  hat, bekommt eine Seite, die stillsteht.
- **Gezeiten** (`G`): Die Musik nimmt von selbst einen langen Bogen über die
  Arbeitsstunde, um deine Energie herum: Aufbau, Plateau (zwei Stufen über
  deiner Einstellung), Abbau, Tal (drei darunter); ein Durchgang dauert 22 bis
  39 Minuten. Eingeschaltet beginnt sie genau bei deiner Energie, auf dem Weg
  nach oben. Auf dem Plateau pausieren Kick und Clap ab und zu acht Takte lang
  (höchstens alle fünf Minuten) und kommen mit einem Fill zurück; auch sonst
  endet etwa jeder dritte Durchlauf mit einem kleinen Fill. Jeder zweite
  Durchlauf beantwortet die Akkordfolge (gleicher Anfang, der dritte Akkord
  eine Terz tiefer, der vierte zur Quinte), so laufen die Akkorde über acht
  Takte. Etwa alle halbe Stunde wechselt die Tonart (Quarte, Quinte, Ganzton
  oder kleine Terz); gehaltene Akkorde bleiben, wo sie sind. Ein Punkt auf dem
  Energie-Regler zeigt, wo die Gezeiten gerade sind. Sie laufen im Taktgeber
  mit, also auch bei Tab im Hintergrund.
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
- **Als App:** Chrome und Edge bieten an, Nebenbei als App zu installieren
  (Knopf „Als App installieren“ oder im Adressfeld); sie startet dann in einem
  eigenen Fenster und auch offline. Eine neue Version meldet sich unten auf der
  Seite mit „Neu laden“.
- Der laufende Groove, Energie, Lautstärke, Spurlautstärken, Effekte, DJ, Gezeiten, Himmel, gehaltene Spuren, das Logbuch und
  der Tagesstreifen liegen im Speicher des Browsers (`localStorage`) und
  überstehen das Neuladen. Was von dort zurückkommt, wird vor dem Abspielen
  geprüft.

| Eingabe | Wirkung |
|---|---|
| Leertaste | Start / Pause |
| `1`–`8` | Spur würfeln |
| `Shift` + `1`–`8` | Spur festhalten / loslassen |
| `Q` `W` `E` `R` | nächstes passendes Instrument der Spur |
| `D` | DJ an / aus |
| `G` | Gezeiten an / aus |
| `H` | ruhiger Himmel an / aus |
| `0` | alles würfeln, was nicht gehalten ist |
| `Z` | zurück |
| `M` | Groove merken |
| `↑` / `↓` | Energie |
| `←` / `→` | Stimmung |
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
- `src/audio/engine.ts`: Taktgeber, Instrumente und Effekte (Web Audio).
- `src/visual.ts`: der Himmel (Canvas).
- `src/music/tide.ts`: die Gezeiten (getestet in `tests/tide.test.ts`).
- `src/pwa.ts`, `sw-template.js`: Installation und Offline-Start.
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

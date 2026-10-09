# Regnum Noctis 2026

Mobile Live-Rangliste für das Probeweekend der Guggenmusik Rosswöschwyber. Die Website enthält fünf Reiche, eine automatisch sortierte Rangliste, einzelne Spielresultate, einen geschützten Adminbereich, Freeze-Modus und Siegeransicht.

## Lokal testen

Die produktive Website verwendet Firebase Realtime Database. Es gibt keinen automatischen Rückfall auf lokale Demodaten. `index.html` über einen lokalen Webserver öffnen (ES-Module funktionieren nicht zuverlässig direkt über `file://`).

```bash
python3 -m http.server 8000
```

Danach `http://localhost:8000` beziehungsweise `/admin.html` öffnen. Auch die lokale Seite verwendet die konfigurierte Firebase-Datenbank; produktive Daten deshalb nicht für Testläufe verwenden. Der Adminbereich benötigt ein mit E-Mail und Passwort angemeldetes, ausdrücklich freigeschaltetes Konto.

## Firebase einmalig einrichten

Das bestehende Projekt heisst `regnum-noctis-2026`. `firebase-config.js` enthält exakt dessen öffentliche Web-Konfiguration. Die Datenbank-URL muss aus der Realtime-Database-Console übernommen werden; Region und Hostname werden nicht erraten. Firebase Hosting wird nicht verwendet.

Authentication benötigt **E-Mail/Passwort** für Admins und **Anonym** für die Teilnahme. Reine öffentliche Ranglistenbesucher benötigen keine Anmeldung. Der GitHub-Pages-Hostname `andi201andi201.github.io` muss in den autorisierten Authentication-Domains eingetragen sein. Nur Passwortkonten mit `true` unter `/admins/{uid}` erhalten Adminrechte; eine anonyme UID erhält selbst bei einer versehentlichen Allowlist-Freigabe keine Adminrechte. Die Allowlist lässt sich aus der Website nicht ändern. Admins verwenden Session-Persistenz; Abmelden beendet alle privaten Abonnements.

Die geprüften Regeln aus `database.rules.json` werden in der Console veröffentlicht. Vorbereitete Novitius-Lösungen und Challenge-Schätzfragen liegen ausschliesslich unter `novitiusAdmin` beziehungsweise `gameChallengesAdmin`, nicht in öffentlichen JavaScript-Dateien. Der getrennt bereitgestellte Startdaten-Import enthält diese Inhalte sowie beide Admin-UIDs. Vor jedem Import bestehende Daten exportieren und prüfen; einen Wurzelimport nur bei einer leeren Datenbank oder einem ausdrücklich gewollten vollständigen Neustart verwenden. Frühere Standardlösungen in der öffentlichen Git-Historie lassen sich durch diese Änderung nicht geheim machen; tatsächliche Wettkampflösungen bei Bedarf im geschützten Adminbereich ändern.

Firebase-Web-Konfiguration ist öffentlich. Schutz entsteht durch Authentication und Database Rules, nicht durch Verbergen des API-Keys. Passwörter und Service-Account-Schlüssel gehören nicht ins Repository oder in Datenbankdaten.

## GitHub Pages

Der Workflow in `.github/workflows/pages.yml` veröffentlicht `main` automatisch. Im Repository unter Settings → Pages als Source **GitHub Actions** auswählen. Danach ist die Seite typischerweise unter `https://andi201andi201.github.io/regnum-noctis-2026/` erreichbar. Diesen Link als QR-Code verteilen.

## Datenmodell

- `games/{id}`: Spielname, Runde, Kurzresultat, Punkte aller fünf Reiche, Zeitstempel
- `players/{uid}`: private, unveränderliche Zuordnung eines anonymen Geräts zu Name und Reich
- `adminOperationLock` / `adminOperationReceipt`: private technische Sperre und Operationsbeleg für konkurrierende Adminänderungen; enthalten keine Spielpunkte
- `songBattleAnswers/{teamId}/song-{nr}`: laufende Teamantworten; in der Teilnehmeransicht wird nur das eigene Reich abonniert
- `songBattleParticipants/{teamId}`: reserviert die Eingabe für genau eine Person beziehungsweise ein Gerät pro Reich
- `songBattleAdmin`: geschützte manuelle Bewertungen und interne Song-Battle-Punkte
- `novitiusParticipants/{uid}`: individuelle Anmeldung mit Name und Reich
- `novitiusAnswers/{uid}/question-{nr}`: genau eine geschützte Antwort pro Person und Frage; nach der Auflösung inklusive 3/2/1/0-Punkten
- `novitiusSubmissions/question-{nr}/{uid}`: öffentlicher Abgabemarker ohne Antwortinhalt für Live-Zähler und TV
- `novitiusAdmin/questions`: geschützter Fragenkatalog mit Lösungen und drei Toleranzbereichen
- `games/ballon-monster`: öffentlicher Spielstatus, serverseitige Auslosung, synchroner Timer, freigegebene Resultate und Endwertung
- `balloonMonsterAdmin`: geschützter Ballonvorrat und Ergebnisentwürfe; unveröffentlichte Zahlen sind öffentlich nicht lesbar
- `games/game-challenges`: öffentlicher Status, Timer, Rotation, freigegebene Runden und Endwertung der fünf Stationen
- `gameChallengesAdmin`: geschützte Rohresultate, Schätzfragen, Lösungen und Schätzungen aller Reiche
- `games/beer-pong`: öffentlicher Turnierstatus, veröffentlichte Matches, Gruppenrangliste, KO-Phase, Endrang und Enthüllungsstatus
- `beerPongAdmin`: geschützte Matchentwürfe und manuelle Stechen-Reihenfolge; nie öffentlich lesbar
- `settings/hunt`: öffentlicher Nachtjagd-Status und die für die laufende Runde eingefrorenen Hinweise
- `huntAdmin/targets`: geschützte Bearbeitung der internen Namen, KI-Erkennungsziele und Hinweise
- `games/hunt-{runde}-{reich}-{gegenstand}`: atomarer, eindeutig adressierter Fund mit genau einem Tagespunkt
- `settings/mode`: `live`, `frozen` oder `final`
- `admins/{uid}`: Freigabe für Schreibzugriff

Die Gesamtpunkte werden aus allen Spielresultaten berechnet. Korrekturen wirken dadurch sofort und ohne separate Summenpflege.

Countdowns und Auslosungsanimationen verwenden `.info/serverTimeOffset` und den zentral gespeicherten Endzeitpunkt. Teilnehmerzeitstempel entstehen mit `serverTimestamp()`. Adminänderungen werden auf allen Geräten serialisiert und durch Regeln gegen abgelaufene oder überholte Operationen geschützt. Offline- beziehungsweise Berechtigungsprobleme werden auf der Seite angezeigt.

## Ballon-Monster

Das Eröffnungsspiel läuft unter `games/ballon-monster`. Die Spielleitung legt
vor dem Start den identischen Ballonvorrat pro Reich fest. Jede Auslosung wird
atomar direkt am öffentlichen Spielzustand ausgeführt; bereits gezogene Reiche
werden aus der Auswahl entfernt und können deshalb auch bei gleichzeitigen
Adminaktionen nicht doppelt gezogen werden. Das letzte verbleibende Reich wird
automatisch angekündigt. Die TV-Ansicht zeigt die Wappen nacheinander, danach die Auslosung,
90-Sekunden-Countdown, Parcoursphase und das jeweils veröffentlichte Resultat.

Der Countdown basiert auf einem gespeicherten Ablaufzeitpunkt und läuft daher
nach einem Neuladen korrekt weiter. Pause, Fortsetzen, Zurücksetzen,
Auslosung zurücknehmen und Durchgang abbrechen sind im Adminbereich kontrolliert
möglich. Resultate landen zuerst nur als geschützte Entwürfe unter
`balloonMonsterAdmin`; erst die separate Veröffentlichung aktualisiert TV und
Spielrangliste. Noch nicht gespielte Reiche werden dort nicht mit null gewertet.

Nach fünf veröffentlichten Resultaten bestätigt die Spielleitung die
Endrangliste. Gleiche Ballonzahlen teilen sich Rang und Tagespunkte, der nächste
Rang wird übersprungen. Der Abschluss schreibt 5 / 4 / 3 / 2 / 1 in denselben
Spieleintrag. Spätere veröffentlichte Korrekturen ersetzen Resultat und Punkte
vollständig, sodass keine doppelte Buchung möglich ist. Auf den Handys erscheint
während des Spiels nur der kompakte Hinweis auf den Grossbildschirm; danach ist
die endgültige Rangliste in der Chronik sichtbar.

## Song Battle

Das Song Battle läuft als festes Spiel unter `games/song-battle`. Der Admin
startet das Spiel, öffnet oder sperrt pro Song die Antworten und wechselt durch
sechs Runden. Pro Reich reserviert die erste teilnehmende Person die Eingabe für
ihr Gerät. Teams können Titel und Interpret bis zur Sperre beliebig
korrigieren; mindestens eines der beiden Felder muss ausgefüllt sein. Die
Spielleitung bewertet beide Angaben je Reich bewusst manuell mit ✓ oder ✗.
Nach dem Sperren kann die Spielleitung den Song auflösen. Erst dann sehen alle
Teams die fünf Antworten und die jeweilige ✓/✗-Bewertung.

Nach Song 6 werden die internen Punkte (maximal 12) sortiert. Bei Gleichstand
teilen sich die betroffenen Teams den Platz und erhalten dieselben Rangpunkte;
zwei Erstplatzierte erhalten beispielsweise beide fünf Punkte, der nächste Rang
ist Platz drei. Das abschliessende Speichern schreibt genau einen
Resultateintrag mit 5 / 4 / 3 / 2 / 1 Gesamtpunkten. Korrekturen überschreiben
dieses Resultat und können deshalb keine Punkte doppelt addieren. Laufende
Antworten und Bewertungen bleiben bis zu einem bewussten Zurücksetzen erhalten.

## Wer kennt den Novitius?

Das Spiel läuft unter `games/novitius-quiz`. Beim Start wird zuerst die
Anmeldung geöffnet. Jede Person nimmt auf dem eigenen Handy mit ihrem bereits
gewählten Namen und Reich teil. Sobald Frage 1 gestartet wird, ist die
Teilnehmerliste geschlossen und die Teamgrösse als fester Divisor gespeichert.
Pro Frage darf jede Person genau eine Antwort absenden. Diese Antwort ist sofort
endgültig; nur die Spielleitung kann technische Fehler im Adminbereich
korrigieren. Zahlen werden als nicht negative Ganzzahlen gespeichert, Uhrzeiten
über ein einheitliches HH:MM-Feld eingegeben und auch über Mitternacht korrekt
verglichen.

Die zehn Fragen, Simons korrekte Antworten sowie drei aufsteigende
Toleranzbereiche für 3, 2 und 1 Punkt können im Adminbereich bearbeitet werden.
Frage 3 wird prozentual und Frage 8 als Uhrzeit bewertet. Beim Gummibärchen-
Livetest wird das tatsächliche Ergebnis erst nach dem Schliessen von Frage 10
eingetragen. **Lösung anzeigen** veröffentlicht erst danach Simons Antwort, die
eigene Punktzahl, den eigenen Teamwert der Runde und die interne Rangliste.
Fremde Einzelantworten werden nicht veröffentlicht. Fehlende Antworten zählen
als null Punkte.

Für jede Frage wird die Summe der individuellen Punkte durch die beim Start
fixierte Teamgrösse geteilt. Über zehn Fragen sind so maximal 30.00 interne
Punkte pro Reich möglich. Bei einem exakten Endgleichstand entscheidet zuerst
die auf Teamgrösse normalisierte Zahl der 3-Punkte-Antworten und danach bei
Bedarf eine zusätzliche Stechfrage im Adminbereich. Erst der Abschluss schreibt
5 / 4 / 3 / 2 / 1 in die Tagesrangliste. Ein erneuter Abschluss oder eine
Korrektur ersetzt denselben Spieleintrag und erzeugt keine doppelten Punkte.

Die TV-Ansicht zeigt während einer offenen Frage nur Frage und Abgabezahl. Nach
der bewussten Auflösung erscheinen richtige Antwort und aktuelle Teamrangliste.

## Game Challenges

Das Spiel läuft unter `games/game-challenges`. In fünf fixen Rotationsrunden
absolviert jedes Reich genau einmal Cup Tower, Pingpong, Darts, Gummiband Cups
und die Schätz-Challenge. Der gemeinsame Vier-Minuten-Timer wird über einen
Zeitstempel synchronisiert, kann pausiert oder zurückgesetzt werden und zeigt
auf der TV-Ansicht nach Ablauf gross **WECHSEL**. Auf dem Handy sieht jedes Reich
nur seine aktuelle Station, die Anleitung und den Timer.

Die Spielleitung erfasst sämtliche Resultate pro Runde. Erst der bewusste Button
zum Veröffentlichen schreibt eine kontrollierte öffentliche Kopie. Bei der
Schätzstation enthält diese Kopie bis zur separaten Auflösung nur den
Abgabestatus. Die eigentlichen Schätzungen und Lösungen liegen geschützt unter
`gameChallengesAdmin`. Jede Schätzfrage wird wegen unterschiedlicher Einheiten
separat nach prozentualer Abweichung rangiert und vergibt faire Unterpunkte; aus
deren Summe entsteht die Stationsrangliste.

Jede Station vergibt 5 / 4 / 3 / 2 / 1 interne Punkte. Gleiche Resultate teilen
sich Rang und Punkte, der Folgerang wird übersprungen. In der Gesamtwertung
entscheidet nach der Summe zuerst die Zahl gewonnener Stationen; bleibt der
Gleichstand bestehen, teilen sich die Reiche Rang und Tagespunkte. Der Abschluss
überschreibt immer denselben Spieleintrag. Spätere Korrekturen berechnen damit
Stationsrang, Gesamtwertung und Tagespunkte neu, ohne Punkte doppelt zu zählen.

## Beer Pong – Battle of the Five Realms

Das Abendturnier läuft unter `games/beer-pong`. Die Gruppenphase besteht aus drei
Zeitfenstern mit fünf fest geplanten Paarungen: In Runde 1 und 2 laufen jeweils
zwei Matches parallel, Runde 3 enthält das letzte Gruppenspiel. Auf dem TV wird
immer nur die von der Spielleitung aufgeschaltete Runde gross dargestellt. Pro
Match werden die getroffenen gegnerischen
Becher erfasst; ein Sieg gibt zwei Gruppenpunkte. Die Tabelle sortiert nach
Gruppenpunkten, Becherdifferenz und insgesamt getroffenen Bechern. Bleiben Reiche
exakt gleich, erfasst die Spielleitung nach einem Entscheidungswurf ihre
eindeutige Reihenfolge im Adminbereich.

Jedes Match wird zuerst nur als geschützter Entwurf unter `beerPongAdmin`
gespeichert. Erst **Resultat veröffentlichen** überträgt den kontrollierten Stand
in das öffentliche Turnier. Dadurch sieht der Grossbildschirm weder unfertige
Eingaben noch spätere Korrekturen vor deren erneuter Freigabe. Die ersten vier
Reiche erreichen die Halbfinals (1 gegen 4 und 2 gegen 3), das Finale wird mit
zehn Bechern und ohne Zeitlimit gespielt. Platz drei und vier richten sich nach
der ursprünglichen Gruppenplatzierung der beiden Halbfinalverlierer.

Der Abschluss bereitet 5 / 4 / 3 / 2 / 1 Tagespunkte im geschützten Endentwurf vor.
Erst die bewusste Enthüllung ersetzt den einzigen öffentlichen Spieleintrag samt Punkten. Vorher sind Finalresultat, Endrang und Tagespunkte auch über direkte Datenbankabfragen verborgen. Für Korrekturen können Finale oder gesamte
KO-Phase kontrolliert zurückgesetzt und neu freigegeben werden. Auf den Handys
erscheint währenddessen nur ein kompakter Verweis auf den Grossbildschirm. Die
TV-Ansicht wechselt in eine eigene Turnierarena mit aktueller Runde,
Gruppenrangliste und den phasengerechten Kurzregeln für 6 beziehungsweise 10
Becher. Nach dem Finale verweist auf den Handys eine Karte auf den Grossbildschirm;
der TV zeigt bis zur Enthüllung einen neutralen Wartehinweis.
Erst **Regnum-Noctis-Sieger enthüllen** zeigt den Gesamtsieger aus allen
Tagespunkten bildschirmfüllend.

## Nachtjagd

Die Nachtjagd ist kein Hauptspiel, sondern eine zusätzliche ganztägige Mission.
Der Admin startet sie morgens und beendet sie manuell. Auf der Ranglistenseite
erscheint eine kompakte Karte mit dem eigenen Teamfortschritt; `nachtjagd.html`
enthält die eigenständige Mission mit zehn Hinweiskarten und Kameraerkennung.
Gefundene Karten zeigen dauerhaft nur **Gegenstand gefunden**, nicht die Lösung.

Jeder Fund wird als deterministischer Eintrag unter
`games/hunt-{runde}-{reich}-{gegenstand}` gespeichert. Eine Firebase-Transaktion
erstellt diesen Eintrag nur, wenn er noch nicht existiert. Zwei fast gleichzeitige
Scans desselben Reichs können deshalb zusammen höchstens einen Eintrag und einen
Tagespunkt erzeugen. Ein anderes Reich kann denselben Gegenstand unabhängig
finden. Nachtjagd-Einträge fliessen direkt in `totalsFromGames` ein, erscheinen
aber nicht als einzelne Hauptspiele in der normalen Chronik.

Im Adminbereich lassen sich Hinweise, interne Namen und KI-Kategorien bearbeiten,
alle Teamfortschritte und Finder kontrollieren sowie Funde manuell hinzufügen
oder entfernen. Beim Entfernen verschwindet derselbe eindeutige Spieleintrag,
wodurch auch der Tagespunkt sofort zurückgenommen wird. **Zurücksetzen** entfernt
alle Nachtjagd-Funde sowie alte Ballon- und Orakel-Spielresultate; die bearbeitete
Gegenstandskonfiguration bleibt erhalten.

Die zehn Gegenstände sind mit Hinweis, internem Namen und passender KI-Kategorie
bereits aktiviert. Die Spielleitung kann die Konfiguration vor einem neuen Start
im Adminbereich weiterhin bearbeiten oder einzelne Gegenstände deaktivieren.

`display.html` ist die eigenständige Querformat-Ansicht für den grossen Bildschirm.
Sie zeigt die Tagesrangliste, alle fünf Nachtjagd-Fortschritte und den letzten Fund,
aber weder Hinweise noch Lösungen.

Die frühere Orakel-Logik bleibt intern im Code erhalten, hat aber keine eigene
Teilnehmer- oder Adminoberfläche mehr. Sie kann später für das 5-Stationen-Spiel
wiederverwendet werden. Das Ballon Game wird vollständig ignoriert und nicht mehr
in Rangliste oder Chronik eingerechnet.

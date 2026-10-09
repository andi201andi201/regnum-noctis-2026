# Regnum Noctis 2026

Mobile Live-Rangliste für das Probeweekend der Guggenmusik Rosswöschwyber. Die Website enthält fünf Reiche, eine automatisch sortierte Rangliste, einzelne Spielresultate, einen geschützten Adminbereich, Freeze-Modus und Siegeransicht.

## Lokal testen

Ohne Firebase-Konfiguration läuft die Website automatisch im lokalen Demomodus. `index.html` über einen lokalen Webserver öffnen (ES-Module funktionieren nicht zuverlässig direkt über `file://`).

```bash
python3 -m http.server 8000
```

Danach `http://localhost:8000` beziehungsweise `/admin.html` öffnen. Daten werden im Browser gespeichert.
Der Adminbereich ist im Demomodus automatisch offen. Sobald Firebase konfiguriert
ist, wird er ausschliesslich über die dort eingerichteten Admin-Konten geschützt.

## Firebase einmalig einrichten

1. In der Firebase Console ein Projekt und eine Web-App erstellen.
2. Realtime Database in der Region `europe-west1` erstellen.
3. Authentication → Sign-in method → **E-Mail/Passwort und Anonym aktivieren**. Anonyme Konten werden für die einmalige Nachtjagd-Wertung verwendet.
4. Unter Authentication zwei Benutzer für Andy und Livio anlegen und deren UID kopieren.
5. In der Realtime Database einmalig folgende Daten erfassen:

```json
{
  "admins": {
    "UID_VON_ANDY": true,
    "UID_VON_LIVIO": true
  },
  "settings": {
    "mode": "live"
  }
}
```

6. Den Inhalt aus `database.rules.json` unter Realtime Database → Rules veröffentlichen.
7. Die Werte in `firebase-config.js` durch die Konfiguration der Web-App ersetzen und committen. Firebase Web-Konfiguration ist öffentlich gedacht; Schutz entsteht durch Authentication und Database Rules, nicht durch Verbergen der API-Key-Zeichenfolge.

## GitHub Pages

Der Workflow in `.github/workflows/pages.yml` veröffentlicht `main` automatisch. Im Repository unter Settings → Pages als Source **GitHub Actions** auswählen. Danach ist die Seite typischerweise unter `https://andi201andi201.github.io/regnum-noctis-2026/` erreichbar. Diesen Link als QR-Code verteilen.

## Datenmodell

- `games/{id}`: Spielname, Runde, Kurzresultat, Punkte aller fünf Reiche, Zeitstempel
- `songBattleAnswers/{teamId}/song-{nr}`: laufende Teamantworten; in der Teilnehmeransicht wird nur das eigene Reich abonniert
- `songBattleParticipants/{teamId}`: reserviert die Eingabe für genau eine Person beziehungsweise ein Gerät pro Reich
- `songBattleAdmin`: geschützte manuelle Bewertungen und interne Song-Battle-Punkte
- `novitiusParticipants/{uid}`: individuelle Anmeldung mit Name und Reich
- `novitiusAnswers/{uid}/question-{nr}`: eigene, bis zur Sperre änderbare Antworten
- `novitiusAdmin/questions`: geschützter Fragenkatalog mit Lösungen und Toleranzbereichen
- `settings/hunt`: öffentlicher Nachtjagd-Status und die für die laufende Runde eingefrorenen Hinweise
- `huntAdmin/targets`: geschützte Bearbeitung der internen Namen, KI-Erkennungsziele und Hinweise
- `games/hunt-{runde}-{reich}-{gegenstand}`: atomarer, eindeutig adressierter Fund mit genau einem Tagespunkt
- `settings/mode`: `live`, `frozen` oder `final`
- `admins/{uid}`: Freigabe für Schreibzugriff

Die Gesamtpunkte werden aus allen Spielresultaten berechnet. Korrekturen wirken dadurch sofort und ohne separate Summenpflege.

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
Teilnehmerliste geschlossen. Pro Frage kann die Antwort bis zur Sperre beliebig
geändert werden. Zahlen werden als Zahlen gespeichert; Uhrzeiten werden über
ein einheitliches Uhrzeitfeld eingegeben und auch über Mitternacht korrekt
verglichen.

Die zehn Fragen, Simons korrekte Antworten sowie fünf aufsteigende
Toleranzbereiche für 5 bis 1 Punkt können im Adminbereich bearbeitet werden.
Beim Live-Test wird die korrekte Antwort erst kurz vor der Auflösung ergänzt.
Nach dem Sperren veröffentlicht **Frage auflösen** Simons Antwort, die eigene
Punktzahl und eine Top 10 aller eingegangenen Antworten. Fehlende Antworten
zählen als null Punkte.

Für die Teamwertung wird der Durchschnitt der persönlichen Gesamtpunkte aller
angemeldeten Personen eines Reichs verwendet. Dadurch entsteht kein Vorteil
durch eine grössere Teilnehmerzahl. Gleichstände teilen sich den Platz und die
zugehörigen Gesamtpunkte. Das erneute Abschliessen nach einer Korrektur ersetzt
das feste Spielresultat, anstatt weitere Punkte zu addieren.

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

Die zehn Plätze sind im ausgelieferten Code bewusst noch deaktiviert und enthalten
keine Lösungen. Vor dem ersten Start werden Hinweis, interner Name und passende
KI-Kategorie ausschliesslich im geschützten Adminbereich erfasst und aktiviert.

`display.html` ist die eigenständige Querformat-Ansicht für den grossen Bildschirm.
Sie zeigt die Tagesrangliste, alle fünf Nachtjagd-Fortschritte und den letzten Fund,
aber weder Hinweise noch Lösungen.

Die frühere Orakel-Logik bleibt intern im Code erhalten, hat aber keine eigene
Teilnehmer- oder Adminoberfläche mehr. Sie kann später für das 5-Stationen-Spiel
wiederverwendet werden. Das Ballon Game wird vollständig ignoriert und nicht mehr
in Rangliste oder Chronik eingerechnet.

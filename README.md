# Regnum Noctis 2026

Mobile Live-Rangliste für das Probeweekend der Guggenmusik Rosswöschwyber. Die Website enthält fünf Reiche, eine automatisch sortierte Rangliste, einzelne Spielresultate, einen geschützten Adminbereich, Freeze-Modus und Siegeransicht.

## Lokal testen

Ohne Firebase-Konfiguration läuft die Website automatisch im lokalen Demomodus. `index.html` über einen lokalen Webserver öffnen (ES-Module funktionieren nicht zuverlässig direkt über `file://`).

```bash
python3 -m http.server 8000
```

Danach `http://localhost:8000` beziehungsweise `/admin.html` öffnen. Daten werden im Browser gespeichert.

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
- `settings/mode`: `live`, `frozen` oder `final`
- `admins/{uid}`: Freigabe für Schreibzugriff

Die Gesamtpunkte werden aus allen Spielresultaten berechnet. Korrekturen wirken dadurch sofort und ohne separate Summenpflege.

## Ballon Game

Im Adminbereich im Abschnitt **Ballon Game** auf **Spiel starten** klicken.
Anschliessend **Resultat eintragen** wählen, alle fünf Reiche genau einmal auf
Platz 1–5 einordnen und speichern. Das Spiel wird damit beendet. Die Punkte
5 / 4 / 3 / 2 / 1 werden automatisch vergeben. **Bearbeiten** in der Resultatliste
führt zurück zu diesem Abschnitt. Erneutes Speichern ersetzt das Resultat;
es addiert keinen zweiten Eintrag. **Zurücksetzen** entfernt Rangfolge und Spielpunkte.

Das Spiel nutzt den bestehenden Pfad `games/ballon-game` mit `status`, `ranking`
(Team-IDs von Platz 1 bis 5), `points`, `source: "placement"`, `round`,
`description`, `durationMinutes` und Zeitstempeln. Vor dem ersten Speichern
zeigt die öffentliche Seite automatisch **Noch nicht gestartet**. Die ca.
15 Minuten sind eine Dauerangabe; der Status wird durch die Spielleitung gesteuert.
Nur beendete Spiele mit Status werden gewertet. Bestehende Resultate ohne
Status zählen unverändert. Die bisherigen Admin-Regeln für `games` und
`settings` reichen aus; neue Firebase-Pfade oder Regeln sind nicht nötig.

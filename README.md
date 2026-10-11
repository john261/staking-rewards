# Epoch — Cardano Staking Dashboard

Responsive Next.js App-Router-Dashboard mit Wallet-Auflösung, Blockfrost-Reward-Historie, EUR-Bewertung, Epochen-Countdown und lokalem CSV-Download.

## Start

1. Node.js 20.9 oder neuer installieren.
2. Abhängigkeiten installieren: `npm install`.
3. `.env.example` nach `.env.local` kopieren und `BLOCKFROST_PROJECT_ID` eintragen.
4. Optional CoinGecko API-Zugangsdaten in `.env.local` eintragen, wenn längere historische Kursdaten benötigt werden.
5. Lokal starten: `npm run dev`.

## API-Konfiguration

- `BLOCKFROST_PROJECT_ID` bleibt serverseitig und darf nicht mit `NEXT_PUBLIC_` beginnen.
- `BLOCKFROST_API_URL` ist optional; Standard ist Cardano Mainnet. Für Testnet muss URL und Blockfrost-Projekt-ID zum gleichen Netzwerk gehören.
- `COINGECKO_API_KEY` wird als Demo-Schlüssel verwendet. `COINGECKO_PRO_API_KEY` aktiviert den Pro-Endpunkt. Die App lädt zuerst die historische CoinGecko-Kursreihe und nutzt bei einem Fehler die 365-Tage-Reihe. Für jeden Reward wird der nächste tatsächliche Kursdatenpunkt desselben UTC-Kalendertags verwendet; es findet keine Interpolation statt. Der Zeitpunkt des verwendeten Kurs-Datenpunkts ist im CSV enthalten. Bei fehlenden Kursen zeigt das Dashboard Quelle, Datenpunktzahl und API-Status.

Der Browser lädt die Reward-Zeilen für den gewählten Zeitraum aus der API-Antwort und erstellt die Excel-kompatible CSV lokal mit UTF-8-BOM und deutschem Semikolon-Trennzeichen. Für historische Rewards, für die CoinGecko keinen Kursdatenpunkt am selben UTC-Kalendertag liefert, bleiben Kurs und EUR-Wert leer.

Die Epochenzeit wird aus dem Blockfrost-Start der aktuellen Epoche und der Cardano-Epochenlänge von fünf Tagen abgeleitet. Für die nächste Ausschüttung zeigt das Dashboard den Betrag, falls Blockfrost ihn bereits meldet; andernfalls bleibt er als unbekannt gekennzeichnet. Es wird kein APY-basierter Reward-Betrag geschätzt.

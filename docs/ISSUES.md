# Issues att skapa

Skapa ett GitHub-issue per rubrik nedan (titel = rubriken, brödtext = texten under). Tas i ordning.

Med GitHub CLI kan du i stället köra `scripts/create-issues.sh`.

---

## 1. Grundstruktur, config och översiktsvy

Sätt upp projektet enligt `docs/SPEC.md` → Filstruktur. Ladda `config.json` (format: `config.example.json`) och rendera översiktsvyen enligt `docs/design/overview.html`: rubrik, spelas nu-kort (statiskt tills vidare), grenlista med status och effektknappar. Grenstatus (kommande/pågår/klar) sparas i `localStorage`.

**Klart när:** översikten ser ut som skissen i mobil vy, statusen överlever omladdning. Inget ljud ännu.

## 2. Spotify-inloggning (PKCE) och Web Playback SDK

Implementera `spotify.js` enligt `docs/SPEC.md` → Teknik: PKCE-inloggning, tokenlagring och förnyelse, Web Playback SDK som egen enhet, starta låt (`uris`, `position_ms` från `startMs`), paus/föregående/nästa, förlopp i spelas nu-kortet. Startvy med "Logga in med Spotify" och "Starta Onyktra Spelen" (låser upp ljud på iOS).

**Klart när:** acceptanskriterie 1 och 2 i specen är uppfyllda.

## 3. Ljudklipp, effektknappar och ducking

Implementera `audio.js`: förladda och avkoda alla klipp från config, spela vid tryck (överlappande), gemensam klippvolym. Ducking: sänk Spotify till `duckLevel` medan minst ett klipp spelar, återställ med kort fade. Reglaget "Sänk vid klipp" (på/av).

**Klart när:** acceptanskriterie 3 är uppfyllt.

## 4. Vy för aktiv gren med timer

Bygg vyn enligt skissens högra skärm och `docs/SPEC.md` → Vyer → Aktiv gren: grennamn, säsong, regeltext, ev. mening, nedräkningstimer (startskott vid start, gong vid 0), musikkort med "Tona ut", grenens effekter, "Klar – nästa gren".

**Klart när:** en gren kan köras från start till klar utan att lämna vyn.

## 5. Service worker och manifest (offline)

Implementera `sw.js` och `manifest.webmanifest` enligt `docs/SPEC.md` → Offline. Cache-first för appfiler och klipp, Spotify och Google Fonts-API aldrig cachat, versionerat cachenamn, banner vid ny version, offline-status i startvyn. Ikoner 192/512 px.

**Klart när:** acceptanskriterie 4 och 6 är uppfyllda.

## 6. Driftsättning och genrepetition

GitHub Pages från `main`. Registrera redirect-URI i Spotify Developer Dashboard. Fyll i riktiga track-URI:er och klipp. Kör igenom hela programmet på festens telefon och högtalare; notera och åtgärda problem.

**Klart när:** acceptanskriterie 7 är uppfyllt.

# Onyktra Spelen (OS) – spec

Webbapp för att styra musik och ljudeffekter under tävlingsdelen på Thomas 50-årsfest (50–60 gäster). En person (speaker/DJ) kör appen på en telefon kopplad till högtalare.

**Namn:** Onyktra Spelen, förkortat **OS**. Grenarna är lekfulla varianter av OS-grenar, både sommar och vinter. Använd inte de olympiska ringarna eller andra skyddade OS-symboler i designen.

## Mål

- Spotify-musik och egna ljudklipp ska kunna spelas **samtidigt från samma webbsida**, så att inget pausas av operativsystemets ljudhantering.
- En knapp per gren startar rätt låt. Effektknappar spelas ovanpå musiken.
- Musiken sänks automatiskt (ducking) medan ett klipp spelas.
- Enkel att köra med en hand, i halvmörker, under stress.

## Icke-mål

- Ingen backend, inga användarkonton utöver Spotify-inloggning.
- Ingen poängräkning i v1 (kan komma senare).
- Ingen inspelning eller mixning av Spotify-ljudet (DRM-skyddat; bara volymstyrning).

## Teknik

- **En statisk sida**: HTML + vanilla JS (eller Vite + TS om det underlättar). Inga ramverk krävs.
- **Hosting**: HTTPS, t.ex. GitHub Pages. Redirect-URI registreras i Spotify Developer Dashboard.
- **Spotify-inloggning**: Authorization Code med PKCE, helt i klienten. Scopes: `streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state`.
- **Uppspelning**: Spotify Web Playback SDK – sidan blir en egen Spotify Connect-enhet. Efter `ready`: flytta uppspelning till enheten via `PUT /v1/me/player` och starta låt via `PUT /v1/me/player/play?device_id=…` med `uris`.
- **Ljudklipp**: Web Audio API. Klippen förladdas och avkodas till `AudioBuffer` vid start, så de spelar direkt och fungerar utan nät.
- **Ducking**: vid klippstart `player.setVolume(duckLevel)` (standard 0.3), återställ när klippet slutat (kort fade, ca 300 ms, genom att stega volymen).
- **Token**: spara access/refresh token i `localStorage`, förnya automatiskt före utgång.
- **Wake Lock API**: håll skärmen tänd när appen är aktiv (om stöd finns).
- **Service worker + Web App Manifest**: appen och klippen cachas lokalt i telefonens webbläsare så att de fungerar offline (se avsnittet Offline nedan). Manifestet gör att sidan kan läggas på hemskärmen och öppnas i helskärm.

### Krav och begränsningar (kända)

- Spotify Premium krävs (för uppspelning och för utvecklarläget sedan feb 2026). Utvecklarläget tillåter max 5 användare – räcker.
- iOS: uppspelning kräver en användarinteraktion innan ljud startar. Visa en tydlig "Starta"-knapp som låser upp både Spotify-spelaren (`player.activateElement()`) och `AudioContext.resume()`.
- Om skärmen låses eller appen byts kan ljudet stanna. Visa en varning om sidan tappar synlighet (`visibilitychange`).
- Spotify strömmas → nätverk krävs. Visa nätstatus.

## Offline (service worker)

Service workern körs i telefonens webbläsare, inte på någon server, och fungerar som en lokal proxy mellan sidan och nätet.

- **`sw.js`** registreras från `app.js` (`navigator.serviceWorker.register('sw.js')`).
- **Install**: förcacha appens filer (`index.html`, JS, CSS, `config.json`, typsnitt) och alla klipp i `config.json` → `effekter[].fil`. Cachenamn med version, t.ex. `onyktra-v1`.
- **Activate**: ta bort cacher med annat versionsnamn.
- **Fetch**: cache-first för appfiler och klipp; nätet som reserv. Anrop till Spotify (`*.spotify.com`, `*.scdn.co`) och Google Fonts-API:t släpps alltid igenom till nätet och cachas inte.
- **Ny version**: höj versionsnumret i `sw.js` när klipp eller appfiler ändras. Visa en banner "Ny version – ladda om" när en ny service worker väntar.
- **Status i UI**: startvyn visar om appen är redo offline (alla filer cachade).
- **`manifest.webmanifest`**: namn "Onyktra Spelen", kortnamn "OS", `display: standalone`, bakgrund/tema `#0F1620`, ikoner 192 och 512 px.
- Kräver HTTPS (GitHub Pages har det).
- iOS kan rensa cachen för sidor som inte besökts på några veckor – öppna appen med nät på festdagen innan programmet startar.

## Ljudklipp – riktlinjer

- Format MP3 eller AAC (`.m4a`), mono räcker, 128 kbps.
- Korta klipp (1–5 s), helst under 200 kB per fil. Trimma tystnad i början så att de låter direkt.
- Normalisera volymen så att alla klipp ligger på ungefär samma nivå (t.ex. −1 dBTP peak, ca −14 LUFS).
- Källor: Pixabay (Sound Effects) eller Freesound (filtrera på CC0). Egna inspelningar går också bra, t.ex. en speakerröst per gren ("Nästa gren: Boxning!").
- Filnamn: gemener, inga mellanslag eller å/ä/ö (`mallur.mp3`, `gong.mp3`).

## Datamodell

Konfiguration i en JSON-fil (`config.json`) så att låtar och klipp kan ändras utan kodändring:

```json
{
  "duckLevel": 0.3,
  "grenar": [
    { "id": "hockey", "sasong": "vinter", "namn": "Hockey", "beskrivning": "Ishockeyspel", "spotifyUri": "spotify:track:…", "startMs": 0 },
    { "id": "curling", "sasong": "vinter", "namn": "Curling", "beskrivning": "Curling på bord", "spotifyUri": "…" },
    { "id": "boxning", "sasong": "sommar", "namn": "Boxning", "beskrivning": "Marshmallows i munnen + säg meningen", "mening": "[MENINGEN]", "spotifyUri": "…" },
    { "id": "fotboll", "sasong": "sommar", "namn": "Fotboll", "beskrivning": "Kicka boll", "spotifyUri": "…" },
    { "id": "basket", "sasong": "sommar", "namn": "Basket", "beskrivning": "Spotta groda", "spotifyUri": "…" },
    { "id": "slalom", "sasong": "vinter", "namn": "Slalom", "beskrivning": "Shot-slalom med shots och godis", "spotifyUri": "…" },
    { "id": "hasthoppning", "sasong": "sommar", "namn": "Hästhoppning", "beskrivning": "Käpphäst, tre hinder", "spotifyUri": "…" }
  ],
  "effekter": [
    { "id": "mallur", "namn": "Mållur", "fil": "clips/mallur.mp3" },
    { "id": "gong", "namn": "Gong", "fil": "clips/gong.mp3" },
    { "id": "startskott", "namn": "Startskott", "fil": "clips/startskott.mp3" },
    { "id": "jubel", "namn": "Jubel", "fil": "clips/jubel.mp3" },
    { "id": "trumvirvel", "namn": "Trumvirvel", "fil": "clips/trumvirvel.mp3" },
    { "id": "buu", "namn": "Buu", "fil": "clips/buu.mp3" }
  ]
}
```

`startMs` låter en låt starta direkt på refrängen/det kända partiet (skickas som `position_ms`).

### Förvalda låtar

| # | Gren | Säsong | Låt |
|---|---|---|---|
| 1 | Hockey | Vinter | Chelsea Dagger – The Fratellis (alt. Kernkraft 400 – Zombie Nation) |
| 2 | Curling | Vinter | An der schönen blauen Donau – Strauss |
| 3 | Boxning | Sommar | Gonna Fly Now – Bill Conti (Rocky) |
| 4 | Fotboll | Sommar | Seven Nation Army – The White Stripes |
| 5 | Basket | Sommar | Jump – Van Halen |
| 6 | Slalom | Vinter | Shots – LMFAO |
| 7 | Hästhoppning | Sommar | Wilhelm Tell-uvertyren – Rossini |

Slå upp track-URI:er via Spotify-sök (`GET /v1/search`) eller i Spotify-appen ("Dela → Kopiera länk").

## Vyer

Mobil först (390 px bredd), mörkt tema. Designskiss: `docs/design/overview.html` (öppna i webbläsaren) och `docs/design/overview.png`. Skissen visar översikten och vyn för aktiv gren; följ layout, färger och typografi därifrån men bygg komponenterna fritt.

### 0. Start
- Knapp "Logga in med Spotify" → PKCE-flöde.
- Efter inloggning: stor knapp "Starta Onyktra Spelen" (låser upp ljud på iOS, förladdar klipp, initierar SDK). Visa status per del: Spotify ansluten ✓, klipp laddade 6/6 ✓.

### 1. Översikt (huvudvy)
- Rubrik: "OS · Thomas 50 år / Onyktra Spelen", räknare "Gren 3/7".
- **Spelas nu-kort**: låtnamn, artist, förlopp, knappar föregående/paus/nästa, reglage "Sänk vid klipp" (på/av + nivå), "Tona ut" (fade till 0 på 3 s, sedan paus).
- **Grenlista**: 7 rader med nummer, namn, säsong (Sommar/Vinter), beskrivning, låt och status (kommande / pågår / klar). Tryck → öppnar grenvyn. Musiken startas inte automatiskt; grenens låt startas manuellt med play-knappen i grenvyn, och det som redan spelar får fortsätta.
- **Effektknappar**: rutnät 3×2, spelas direkt vid tryck (flera kan överlappa).
- Sidfot: nätstatus.

### 2. Aktiv gren
- Tillbaka till översikt, "Gren X av 7".
- Stort grennamn, regeltext, ev. meningen (boxning) i stor text så den kan läsas upp.
- **Timer**: valfri nedräkning (standard 60 s), Start/Återställ; spelar "startskott" vid start och "gong" vid 0 (konfigurerbart).
  Konfigureras med `timerSekunder`, `timerStartEffekt` och `timerSlutEffekt` i `config.json` (globalt eller per gren). Tiden kan justeras ±15 s innan start.
- Musikkort: play/paus, "Tona ut" (fade till 0 på 3 s, sedan paus).
- Alla effektknappar, samma uppsättning och ordning som i översikten.
- "Markera klar & nästa gren".

## Beteende

- Att starta en gren sätter den som "pågår" och föregående som "klar". Status sparas i `localStorage` så att en omladdning inte nollställer kvällen.
- Effektklipp: ny `AudioBufferSourceNode` per tryck, gemensam `GainNode` för klippvolym. Ducking aktiv så länge minst ett klipp spelar.
- Fel från Spotify (t.ex. 401/404 device) → försök förnya token / återansluta enheten automatiskt, visa en diskret banner.
- Allt ska gå att styra med touch; knappar minst 44 px.

## Design

- Mörk bakgrund `#0F1620`, ytor `#18212D`, linjer `#263244`, text `#F2EEE6`, dämpad text `#9AA6B5`.
- Accent guld `#E8B04A` (50 år), sekundär isblå `#7CC4E8`, varning `#E8795A`.
- Typsnitt: Big Shoulders Display (rubriker, versaler), IBM Plex Sans (brödtext), IBM Plex Mono (tider/siffror).

## Filstruktur (förslag)

```
/index.html
/app.js          – UI och state
/spotify.js      – PKCE, token, Web Playback SDK, API-anrop
/audio.js        – Web Audio, förladdning, ducking
/config.json
/clips/*.mp3
/style.css
/sw.js           – service worker (offline-cache)
/manifest.webmanifest
/icons/icon.svg      – ikonkälla (läses OS, och 50 upp och ner)
/icons/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png
/fonts/*.woff2    – självhostade typsnitt (fungerar offline)
```

## Acceptanskriterier

1. Inloggning med Spotify fungerar från telefon (iPhone Safari och Android Chrome).
2. Tryck på en gren startar ingen musik; play i grenvyn startar rätt låt inom ~1 s. Spelar musik eller klipp fortsätter det.
3. En effekt spelas ovanpå pågående låt utan att låten pausas; låten sänks till `duckLevel` och återgår efteråt.
4. Efter första besöket går appen att öppna och klippen att spela i flygplansläge, även efter omladdning.
5. Omladdning av sidan behåller grenstatus.
6. Sidan kan läggas på hemskärmen och öppnas i helskärm.
7. Genrepetition: hela programmet körs igenom på festens telefon och högtalare.

## Förberedelser (manuellt)

1. Skapa app i Spotify Developer Dashboard, lägg till redirect-URI (GitHub Pages-adressen) och ditt Premium-konto som användare.
2. Samla ljudklipp (fria ljudeffekter) i `clips/`.
3. Fyll i track-URI:er i `config.json`.

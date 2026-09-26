# Onyktra Spelen (OS)

Webbapp för att styra musik (Spotify) och ljudeffekter under tävlingsdelen på Thomas 50-årsfest. En person kör appen på en telefon kopplad till högtalare.

## Läs först

- `docs/SPEC.md` – den fullständiga specen (mål, teknik, vyer, beteende, acceptanskriterier). Följ den.
- `docs/design/overview.html` / `overview.png` – designskiss för översikt och aktiv gren. Följ layout, färger och typografi.
- `config.example.json` – format för grenar, låtar och ljudklipp.

## Regler

- Statisk webbapp, **vanilla JS** (ES modules), ingen backend, inga ramverk. Inget byggsteg krävs; om ett behövs, använd Vite.
- All text i gränssnittet på **svenska**.
- Mobil först (390 px), touch-ytor minst 44 px, mörkt tema.
- Spotify: Authorization Code med PKCE i klienten + Web Playback SDK. Hemligheter får aldrig checkas in – client ID ligger i `config.json` (inte hemligt), ingen client secret används.
- Ljudklipp via Web Audio API; musiken sänks (ducking) via `player.setVolume()` när klipp spelas.
- Offline: service worker cachar appen och klippen; Spotify-anrop cachas aldrig.
- Använd inte de olympiska ringarna eller andra skyddade OS-symboler.
- Driftsätts på GitHub Pages (HTTPS).

## Arbetssätt

- Arbeta issue för issue (se GitHub Issues). Håll ändringar små och testbara.
- Varje issue stänger när dess acceptanskriterier i `docs/SPEC.md` är uppfyllda.
- Testa i mobil vy (Chrome DevTools) och notera vad som måste provas på riktig telefon.

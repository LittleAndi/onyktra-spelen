# Byta låtar från telefonen (Supabase)

Låtar kan bytas direkt i appen. Bytena sparas i Supabase och syns på alla enheter. Grenar utan byte använder låten i `config.json`.

## Engångsinställning

1. Skapa ett projekt på [supabase.com](https://supabase.com) (gratisnivån räcker).
2. Öppna **SQL Editor** och klistra in `docs/supabase.sql`. Byt `BYT-MIG` längst ner mot en egen PIN-kod (gärna minst 6 tecken) och kör skriptet.
   - Skriptet skapar tabellen `latar` med RLS aktiverat: alla kan läsa, ingen kan skriva direkt.
   - Skrivning går bara via funktionen `spara_lat()`, som kräver PIN-koden. Koden sparas hashad i tabellen `installningar`, som inte går att läsa via API:t.
   - För att byta PIN-kod senare: kör bara den sista `insert`-satsen igen med ny kod. Om du kör om hela skriptet sätts koden till det som står där.
3. Gå till **Project Settings → API Keys** och kopiera projektets URL och den publika nyckeln (*publishable key*, eller den äldre *anon key*). Nyckeln är publik och får ligga i repot – använd aldrig *secret*/*service_role*-nyckeln.
4. Fyll i `supabaseUrl` och `supabaseKey` i `config.json` och pusha.

## Byta låt

1. I Spotify: **Dela → Kopiera länk** på låten.
2. I appen: öppna grenen och tryck **Byt låt** under musikkortet.
3. Klistra in länken. Låtnamn och artist hämtas automatiskt (går att ändra).
4. Ange eventuellt var låten ska börja (m:ss), och PIN-koden första gången. Appen kommer ihåg koden tills sidan laddas om – den sparas aldrig på telefonen.
5. **Spara**. **Återställ till förvald låt** tar bort bytet så att låten i `config.json` gäller igen.

## Bra att veta

- Senast hämtade låtbyten sparas på telefonen, så appen fungerar även om Supabase inte svarar eller nätet är borta.
- Gratisprojekt pausas efter ungefär en veckas inaktivitet. Öppna appen (eller Supabase-panelen) under veckan före festen så att projektet är vaket.
- Utan `supabaseUrl`/`supabaseKey` i `config.json` visas ingen **Byt låt**-knapp och appen fungerar som tidigare.

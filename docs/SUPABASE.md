# Grenar i Supabase

Grenarna (ordning, namn, beskrivning, meningen och låt) sparas i Supabase och kan ändras direkt i appen. Ändringarna syns på alla enheter. Allt skyddas med samma PIN-kod.

## Engångsinställning

1. Skapa ett projekt på [supabase.com](https://supabase.com) (gratisnivån räcker).
2. Öppna **SQL Editor** och klistra in `docs/supabase.sql`. Första gången: byt `BYT-MIG` längst ner mot en egen PIN-kod med bara siffror (gärna minst 6) – appen visar ett siffertangentbord. Kör skriptet.
   - Skriptet skapar tabellen `grenar` med RLS aktiverat: alla kan läsa, ingen kan skriva direkt.
   - Skrivning går bara via funktionerna `spara_gren()` och `sortera_grenar()`, som kräver PIN-koden. Koden sparas hashad i tabellen `installningar`, som inte går att läsa via API:t.
3. Gå till **Project Settings → API Keys** och kopiera projektets URL och den publika nyckeln (*publishable key*, eller den äldre *anon key*). Nyckeln är publik och får ligga i repot – använd aldrig *secret*/*service_role*-nyckeln.
4. Fyll i `supabaseUrl` och `supabaseKey` i `config.json` och pusha.

## Uppgradera från låtbyten (tabellen `latar`)

Kör hela `docs/supabase.sql` igen – du behöver inte ändra något i den. Skriptet

- lägger in grenarna från `config.json` i tabellen `grenar` (backfill; grenar som redan finns rörs inte),
- flyttar över låtbytena från den gamla tabellen `latar` och tar sedan bort den,
- behåller den PIN-kod du redan har.

Skriptet går att köra igen när som helst utan att ändringar gjorda i appen skrivs över.

## Uppgradera: tidtagning (stoppur)

Kör hela `docs/supabase.sql` igen. Kolumnen `tidtagning` läggs till och slalom och hästhoppning får stoppur. Tills skriptet körts fungerar appen som förut (bara nedräkning).

## Redigera en gren

1. Öppna grenen och tryck **Redigera gren** under musikkortet.
2. Ändra namn, säsong, beskrivning eller **meningen** (visas stort i grenvyn – lämna tomt om grenen inte har någon).
3. Byt låt: i Spotify **Dela → Kopiera länk**, klistra in länken. Låtnamn och artist hämtas automatiskt (går att ändra). Ange eventuellt var låten ska börja (m:ss).
4. Välj **Tid**: *Nedräkning* (timer med standardtid) eller *Tidtagning* (stoppur, t.ex. slalom och hästhoppning).
5. Ange PIN-koden första gången och tryck **Spara**. Appen kommer ihåg koden tills sidan laddas om – den sparas aldrig på telefonen.

## Ändra ordning

1. På översikten: tryck **Ändra ordning** under grenlistan.
2. Dra grenarna i handtaget (≡) till rätt plats. Sidan rullar om du drar mot kanten.
3. Tryck **Spara ordning** (PIN-koden efterfrågas om den inte redan angetts) eller **Avbryt**.

## Lägga till eller ta bort grenar

Görs i Supabase-panelen → **Table Editor → grenar**. `id` ska vara små bokstäver, siffror och bindestreck (t.ex. `dragkamp`). Ladda om appen efteråt.

## Byta PIN-kod

Kör `update`-satsen längst ner i `docs/supabase.sql` (utan kommentarstecknen) med den nya koden.

## Bra att veta

- Senast hämtade grenar sparas på telefonen, så appen fungerar även om Supabase inte svarar eller nätet är borta.
- Grenarna i `config.json` används bara innan grenarna hämtats från Supabase första gången (och om Supabase inte är konfigurerat).
- Gratisprojekt pausas efter ungefär en veckas inaktivitet. Öppna appen (eller Supabase-panelen) under veckan före festen så att projektet är vaket.
- Utan `supabaseUrl`/`supabaseKey` i `config.json` visas varken **Redigera gren** eller **Ändra ordning**, och grenarna läses från `config.json`.

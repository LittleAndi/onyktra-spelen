-- Onyktra Spelen: grenar i Supabase.
-- Kör hela filen i Supabase-panelen → SQL Editor. Går att köra igen:
-- befintliga grenar, ordning och PIN-kod behålls. Första gången: byt 'BYT-MIG' längst ner.

create extension if not exists pgcrypto with schema extensions;

-- PIN-koden (hashad). Ingen policy och inga rättigheter: går inte att läsa via API:t.
create table if not exists public.installningar (
  nyckel text primary key,
  varde  text not null
);
alter table public.installningar enable row level security;
revoke all on public.installningar from anon, authenticated;

-- Kvällens grenar i den ordning de körs.
create table if not exists public.grenar (
  id            text primary key check (id ~ '^[a-z0-9-]+$'),
  ordning       integer not null default 0,
  namn          text not null check (length(trim(namn)) > 0),
  sasong        text check (sasong in ('sommar', 'vinter')),
  beskrivning   text,
  mening        text, -- t.ex. meningen som ska sägas i boxningen; null = ingen
  spotify_uri   text check (spotify_uri ~ '^spotify:track:[A-Za-z0-9]{22}$'),
  lat           text,
  artist        text,
  start_ms      integer not null default 0 check (start_ms >= 0),
  timer_sekunder integer check (timer_sekunder between 15 and 600),
  tidtagning    text check (tidtagning in ('nedrakning', 'stoppur')), -- null = nedräkning
  uppdaterad    timestamptz not null default now()
);

-- Kolumnen tidtagning läggs till i tabeller skapade av äldre versioner.
alter table public.grenar add column if not exists tidtagning text
  check (tidtagning in ('nedrakning', 'stoppur'));

alter table public.grenar enable row level security;
revoke all on public.grenar from anon, authenticated;
grant select on public.grenar to anon, authenticated;

drop policy if exists "Alla kan läsa grenar" on public.grenar;
create policy "Alla kan läsa grenar" on public.grenar for select to anon, authenticated using (true);
-- Inga insert/update/delete-policys: skrivning sker bara via funktionerna nedan, som kräver PIN-kod.

-- Grenarna från config.json. Läggs bara in om de saknas – ändringar gjorda i appen skrivs aldrig över.
insert into public.grenar (id, ordning, namn, sasong, beskrivning, mening, spotify_uri, lat, artist, start_ms) values
  ('hockey', 1, 'Hockey', 'vinter', 'Ishockeyspel', null, 'spotify:track:52fnLN02thRhTnbzVZzdqq', 'Chelsea Dagger', 'The Fratellis', 0),
  ('curling', 2, 'Curling', 'vinter', 'Curling på bord', null, 'spotify:track:2NOyTijV4TGvH6zIntBIYI', 'An der schönen blauen Donau', 'Strauss', 0),
  ('boxning', 3, 'Boxning', 'sommar', 'Marshmallows i munnen + säg meningen', '[MENINGEN]', 'spotify:track:7iXYRR70wewzVYzWScm99j', 'Gonna Fly Now', 'Bill Conti', 0),
  ('fotboll', 4, 'Fotboll', 'sommar', 'Kicka boll', null, 'spotify:track:3dPQuX8Gs42Y7b454ybpMR', 'Seven Nation Army', 'The White Stripes', 0),
  ('basket', 5, 'Basket', 'sommar', 'Spotta groda', null, 'spotify:track:7N3PAbqfTjSEU1edb2tY8j', 'Jump', 'Van Halen', 0),
  ('slalom', 6, 'Slalom', 'vinter', 'Shot-slalom med shots och godis', null, 'spotify:track:1V4jC0vJ5525lEF1bFgPX2', 'Shots', 'LMFAO', 0),
  ('hasthoppning', 7, 'Hästhoppning', 'sommar', 'Käpphäst, tre hinder', null, 'spotify:track:3j01GIGm0LYSzbO7X0NfYM', 'Wilhelm Tell-uvertyren', 'Rossini', 0)
on conflict (id) do nothing;

-- Slalom och hästhoppning tar tid (stoppur) om inget annat valts i appen.
update public.grenar set tidtagning = 'stoppur'
where id in ('slalom', 'hasthoppning') and tidtagning is null;

-- Flytta över låtbyten från den gamla tabellen latar (tidigare version av appen) och ta bort den.
do $$
begin
  if to_regclass('public.latar') is not null then
    update public.grenar g set
      spotify_uri = l.spotify_uri,
      lat         = l.lat,
      artist      = l.artist,
      start_ms    = l.start_ms,
      uppdaterad  = now()
    from public.latar l
    where l.gren_id = g.id;
    drop table public.latar;
  end if;
end;
$$;
drop function if exists public.spara_lat(text, text, text, text, text, integer);

-- Stoppar anropet om PIN-koden är fel. Anropas bara av funktionerna nedan.
create or replace function public.kontrollera_pin(pin text) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not exists (
    select 1 from public.installningar
    where nyckel = 'pin' and varde = extensions.crypt(pin, varde)
  ) then
    perform pg_sleep(1); -- Bromsar gissningar.
    raise exception 'Fel PIN-kod' using errcode = '28P01';
  end if;
end;
$$;
revoke all on function public.kontrollera_pin(text) from public, anon, authenticated;

-- Sparar en gren (nya grenar hamnar sist). Fält som saknas i gren blir tomma.
create or replace function public.spara_gren(pin text, gren jsonb) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.kontrollera_pin(pin);
  insert into public.grenar as g
    (id, ordning, namn, sasong, beskrivning, mening, spotify_uri, lat, artist, start_ms, timer_sekunder, tidtagning, uppdaterad)
  values (
    gren->>'id',
    (select coalesce(max(ordning), 0) + 1 from public.grenar),
    gren->>'namn',
    nullif(gren->>'sasong', ''),
    nullif(gren->>'beskrivning', ''),
    nullif(gren->>'mening', ''),
    nullif(gren->>'spotify_uri', ''),
    nullif(gren->>'lat', ''),
    nullif(gren->>'artist', ''),
    coalesce((gren->>'start_ms')::integer, 0),
    (gren->>'timer_sekunder')::integer,
    nullif(gren->>'tidtagning', ''),
    now()
  )
  on conflict (id) do update set
    namn           = excluded.namn,
    sasong         = excluded.sasong,
    beskrivning    = excluded.beskrivning,
    mening         = excluded.mening,
    spotify_uri    = excluded.spotify_uri,
    lat            = excluded.lat,
    artist         = excluded.artist,
    start_ms       = excluded.start_ms,
    timer_sekunder = excluded.timer_sekunder,
    tidtagning     = excluded.tidtagning,
    uppdaterad     = now();
end;
$$;
revoke all on function public.spara_gren(text, jsonb) from public, anon, authenticated;
grant execute on function public.spara_gren(text, jsonb) to anon, authenticated;

-- Sätter grenarnas ordning efter listan med id:n (första id:t blir gren 1).
create or replace function public.sortera_grenar(pin text, ids text[]) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.kontrollera_pin(pin);
  update public.grenar g set ordning = n.plats, uppdaterad = now()
  from unnest(ids) with ordinality as n(id, plats)
  where g.id = n.id;
end;
$$;
revoke all on function public.sortera_grenar(text, text[]) from public, anon, authenticated;
grant execute on function public.sortera_grenar(text, text[]) to anon, authenticated;

-- PIN-kod: sätts bara om ingen finns, så en befintlig kod behålls när skriptet körs igen.
-- Byt 'BYT-MIG' mot en egen kod (gärna minst 6 tecken) innan du kör skriptet första gången.
insert into public.installningar (nyckel, varde)
values ('pin', extensions.crypt('BYT-MIG', extensions.gen_salt('bf')))
on conflict (nyckel) do nothing;

-- För att byta PIN-kod senare: kör bara den här satsen (utan kommentarstecknen) med den nya koden.
-- update public.installningar set varde = extensions.crypt('NY-KOD', extensions.gen_salt('bf')) where nyckel = 'pin';

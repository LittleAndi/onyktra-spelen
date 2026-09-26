-- Onyktra Spelen: låtbyten i Supabase.
-- Kör hela filen i Supabase-panelen → SQL Editor. Byt PIN-koden längst ner först.
-- Går att köra igen; befintliga låtbyten behålls.

create extension if not exists pgcrypto with schema extensions;

-- Låtbyten per gren. Grenar utan rad använder låten i config.json.
create table if not exists public.latar (
  gren_id     text primary key,
  spotify_uri text not null check (spotify_uri ~ '^spotify:track:[A-Za-z0-9]{22}$'),
  lat         text,
  artist      text,
  start_ms    integer not null default 0 check (start_ms >= 0),
  uppdaterad  timestamptz not null default now()
);

alter table public.latar enable row level security;
revoke all on public.latar from anon, authenticated;
grant select on public.latar to anon, authenticated;

drop policy if exists "Alla kan läsa låtar" on public.latar;
create policy "Alla kan läsa låtar" on public.latar for select to anon, authenticated using (true);
-- Inga insert/update/delete-policys: skrivning sker bara via spara_lat() nedan.

-- PIN-koden (hashad). Ingen policy och inga rättigheter: går inte att läsa via API:t.
create table if not exists public.installningar (
  nyckel text primary key,
  varde  text not null
);
alter table public.installningar enable row level security;
revoke all on public.installningar from anon, authenticated;

-- Sparar (eller tar bort, om p_spotify_uri är null) en grens låt. Kräver rätt PIN-kod.
create or replace function public.spara_lat(
  pin           text,
  p_gren_id     text,
  p_spotify_uri text,
  p_lat         text,
  p_artist      text,
  p_start_ms    integer default 0
) returns void
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

  if p_spotify_uri is null then
    delete from public.latar where gren_id = p_gren_id;
  else
    insert into public.latar (gren_id, spotify_uri, lat, artist, start_ms, uppdaterad)
    values (p_gren_id, p_spotify_uri, p_lat, p_artist, coalesce(p_start_ms, 0), now())
    on conflict (gren_id) do update set
      spotify_uri = excluded.spotify_uri,
      lat         = excluded.lat,
      artist      = excluded.artist,
      start_ms    = excluded.start_ms,
      uppdaterad  = now();
  end if;
end;
$$;

revoke all on function public.spara_lat(text, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.spara_lat(text, text, text, text, text, integer) to anon, authenticated;

-- PIN-kod: byt 'BYT-MIG' mot en egen kod (gärna minst 6 tecken). Kör raden igen för att byta kod senare.
insert into public.installningar (nyckel, varde)
values ('pin', extensions.crypt('BYT-MIG', extensions.gen_salt('bf')))
on conflict (nyckel) do update set varde = excluded.varde;

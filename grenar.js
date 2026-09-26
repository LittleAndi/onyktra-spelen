// Grenarna sparade i Supabase: läses av alla, ändras bara med PIN-kod (se docs/supabase.sql).

const CACHE_KEY = 'os.grenar';
const GAMMAL_CACHE_KEY = 'os.latar';
const TIMEOUT_MS = 8000;
const KOLUMNER = 'id,ordning,namn,sasong,beskrivning,mening,spotify_uri,lat,artist,start_ms,timer_sekunder,tidtagning';

let bas = null;
let nyckel = null;

export function konfigurera({ url, key }) {
  const giltig = url && key && !url.includes('DITT_PROJEKT');
  bas = giltig ? url.replace(/\/+$/, '') : null;
  nyckel = giltig ? key : null;
}

export const arKonfigurerad = () => bas != null;

// Databasrad → gren i samma form som i config.json.
function tillGren(rad) {
  const gren = {
    id: rad.id,
    namn: rad.namn,
    sasong: rad.sasong ?? '',
    beskrivning: rad.beskrivning ?? '',
    mening: rad.mening ?? '',
    spotifyUri: rad.spotify_uri ?? '',
    lat: rad.lat ?? '',
    artist: rad.artist ?? '',
    startMs: rad.start_ms ?? 0,
  };
  if (rad.timer_sekunder != null) gren.timerSekunder = rad.timer_sekunder;
  if (rad.tidtagning) gren.tidtagning = rad.tidtagning;
  return gren;
}

// Senast hämtade grenar, så att appen fungerar offline och om Supabase inte svarar.
// Tom lista betyder att inga grenar hämtats än – då gäller config.json.
export function cachade() {
  try {
    localStorage.removeItem(GAMMAL_CACHE_KEY);
    const rader = JSON.parse(localStorage.getItem(CACHE_KEY)) ?? [];
    return Array.isArray(rader) ? rader.map(tillGren) : [];
  } catch {
    return [];
  }
}

function sparaCache(rader) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(rader));
  } catch {
    // Lagring otillgänglig – grenarna gäller bara under sessionen.
  }
}

async function anrop(sokvag, kropp) {
  const svar = await fetch(`${bas}/rest/v1/${sokvag}`, {
    method: kropp ? 'POST' : 'GET',
    // Bara apikey-headern: fungerar med både anon-nyckel och publishable key.
    headers: { apikey: nyckel, ...(kropp && { 'Content-Type': 'application/json' }) },
    body: kropp ? JSON.stringify(kropp) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await svar.json().catch(() => null);
  if (!svar.ok) {
    const fel = new Error(data?.message || `HTTP ${svar.status}`);
    fel.kod = data?.code;
    throw fel;
  }
  return data;
}

export async function hamta() {
  let rader;
  try {
    rader = await anrop(`grenar?select=${KOLUMNER}&order=ordning,id`);
  } catch (fel) {
    // 42703: kolumnen tidtagning saknas – supabase.sql har inte körts om sedan den lades till.
    if (fel.kod !== '42703') throw fel;
    console.warn('Kolumnen tidtagning saknas i Supabase – kör docs/supabase.sql igen.');
    rader = await anrop(`grenar?select=${KOLUMNER.replace(',tidtagning', '')}&order=ordning,id`);
  }
  sparaCache(rader);
  return rader.map(tillGren);
}

async function skriv(funktion, kropp) {
  try {
    await anrop(`rpc/${funktion}`, kropp);
  } catch (fel) {
    if (fel.kod === '28P01') throw Object.assign(new Error('Fel PIN-kod.'), { felPin: true });
    if (fel.name === 'TimeoutError' || fel instanceof TypeError) throw new Error('Kunde inte nå Supabase. Kontrollera nätet.');
    throw fel;
  }
  return hamta();
}

// Sparar en gren (namn, text, meningen och låt). Returnerar alla grenar efter ändringen.
export function spara(pin, gren) {
  return skriv('spara_gren', {
    pin,
    gren: {
      id: gren.id,
      namn: gren.namn,
      sasong: gren.sasong || null,
      beskrivning: gren.beskrivning || null,
      mening: gren.mening || null,
      spotify_uri: gren.spotifyUri || null,
      lat: gren.lat || null,
      artist: gren.artist || null,
      start_ms: gren.startMs ?? 0,
      timer_sekunder: gren.timerSekunder ?? null,
      tidtagning: gren.tidtagning || 'nedrakning',
    },
  });
}

// Sparar grenarnas ordning (lista med id:n, första blir gren 1). Returnerar alla grenar.
export function sortera(pin, ids) {
  return skriv('sortera_grenar', { pin, ids });
}

// Tolkar en Spotify-länk (open.spotify.com/…/track/ID) eller URI (spotify:track:ID) till en track-URI.
export function tolkaSpotifyLank(text) {
  const traff = text.trim().match(/(?:spotify:track:|open\.spotify\.com\/(?:[\w-]+\/)*track\/)([A-Za-z0-9]{22})/);
  return traff ? `spotify:track:${traff[1]}` : null;
}

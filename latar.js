// Låtbyten sparade i Supabase: läses av alla, skrivs bara med PIN-kod (se docs/supabase.sql).

const CACHE_KEY = 'os.latar';
const TIMEOUT_MS = 8000;

let bas = null;
let nyckel = null;

export function konfigurera({ url, key }) {
  const giltig = url && key && !url.includes('DITT_PROJEKT');
  bas = giltig ? url.replace(/\/+$/, '') : null;
  nyckel = giltig ? key : null;
}

export const arKonfigurerad = () => bas != null;

// Senast hämtade låtbyten, så att appen fungerar offline och om Supabase inte svarar.
export function cachade() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY)) ?? [];
  } catch {
    return [];
  }
}

function sparaCache(rader) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(rader));
  } catch {
    // Lagring otillgänglig – låtbytena gäller bara under sessionen.
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
  const rader = await anrop('latar?select=gren_id,spotify_uri,lat,artist,start_ms');
  sparaCache(rader);
  return rader;
}

// Sparar grenens låt. Utan spotifyUri tas låtbytet bort och grenen får låten från config.json igen.
export async function spara(pin, { grenId, spotifyUri = null, lat = null, artist = null, startMs = 0 }) {
  try {
    await anrop('rpc/spara_lat', {
      pin,
      p_gren_id: grenId,
      p_spotify_uri: spotifyUri,
      p_lat: lat,
      p_artist: artist,
      p_start_ms: startMs,
    });
  } catch (fel) {
    if (fel.kod === '28P01') throw Object.assign(new Error('Fel PIN-kod.'), { felPin: true });
    if (fel.name === 'TimeoutError' || fel instanceof TypeError) throw new Error('Kunde inte nå Supabase. Kontrollera nätet.');
    throw fel;
  }
  return hamta();
}

// Tolkar en Spotify-länk (open.spotify.com/…/track/ID) eller URI (spotify:track:ID) till en track-URI.
export function tolkaSpotifyLank(text) {
  const traff = text.trim().match(/(?:spotify:track:|open\.spotify\.com\/(?:[\w-]+\/)*track\/)([A-Za-z0-9]{22})/);
  return traff ? `spotify:track:${traff[1]}` : null;
}

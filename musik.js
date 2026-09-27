// Spellistan i Musik-vyn: vilken spellista som används och senast hämtade låtar.

const VALD_KEY = 'os.spellista';
const CACHE_KEY = 'os.spellista.latar';

// Tolkar en Spotify-länk (open.spotify.com/…/playlist/ID) eller URI (spotify:playlist:ID) till spellistans id.
export function tolkaLank(text) {
  const traff = (text ?? '').trim()
    .match(/(?:spotify:playlist:|open\.spotify\.com\/(?:[\w-]+\/)*playlist\/)([A-Za-z0-9]{22})/);
  return traff ? traff[1] : null;
}

// Spellistan som valts i appen på den här telefonen, annars den i config.json.
export function valdId(config) {
  try {
    const vald = localStorage.getItem(VALD_KEY);
    if (vald) return tolkaLank(vald);
  } catch {
    // Lagring otillgänglig – använd config.json.
  }
  return tolkaLank(config.spellista);
}

export function valj(id) {
  try {
    localStorage.setItem(VALD_KEY, `spotify:playlist:${id}`);
  } catch {
    // Lagring otillgänglig – valet gäller bara under sessionen.
  }
}

// Senast hämtade spellista ({ id, namn, uri, latar }) om den är den valda, annars null.
export function cachad(id) {
  try {
    const lista = JSON.parse(localStorage.getItem(CACHE_KEY));
    return lista?.id === id && Array.isArray(lista.latar) ? lista : null;
  } catch {
    return null;
  }
}

export function sparaCache(lista) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(lista));
  } catch {
    // Lagring otillgänglig – listan hämtas igen nästa gång.
  }
}

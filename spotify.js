// Spotify: PKCE-inloggning, token, Web Playback SDK och API-anrop.

const SCOPES = 'streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state playlist-read-private playlist-read-collaborative';
const TOKEN_KEY = 'os.spotify.token';
const VERIFIER_KEY = 'os.spotify.verifier';
const STATE_KEY = 'os.spotify.state';
const API = 'https://api.spotify.com/v1';
const FORNYA_MARGINAL_MS = 60_000;
const REDO_TIMEOUT_MS = 15_000;

let clientId = null;
let redirectUri = null;
let token = null; // { access, refresh, utgar }
let fornyelse = null;
let fornyTimer = null;

let sdkLaddning = null;
let player = null;
let deviceId = null;
let anslutning = null;
let lyssnare = { status: () => {}, fel: () => {} };

export class SpotifyFel extends Error {
  constructor(meddelande, status) {
    super(meddelande);
    this.status = status;
  }
}

// --- Token ---

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function slumpstrang(antal) {
  return base64url(crypto.getRandomValues(new Uint8Array(antal)));
}

function sparaToken() {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Lagring otillgänglig – token gäller bara under sessionen.
  }
}

function lasToken() {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY));
    return t?.access && t?.refresh ? t : null;
  } catch {
    return null;
  }
}

function schemalaggFornyelse() {
  clearTimeout(fornyTimer);
  if (!token) return;
  const om = Math.max(0, token.utgar - FORNYA_MARGINAL_MS - Date.now());
  fornyTimer = setTimeout(() => fornyaToken().catch((fel) => lyssnare.fel(fel.message)), om);
}

async function tokenAnrop(parametrar) {
  const svar = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, ...parametrar }),
  });
  const data = await svar.json().catch(() => ({}));
  if (!svar.ok) {
    const fel = new SpotifyFel(data.error_description || data.error || `HTTP ${svar.status}`, svar.status);
    fel.kod = data.error;
    throw fel;
  }
  token = {
    access: data.access_token,
    // Spotify kan rotera refresh-token; behåll den gamla om ingen ny skickas.
    refresh: data.refresh_token ?? token?.refresh,
    utgar: Date.now() + data.expires_in * 1000,
    // Beviljade scopes; en förnyelse utan scope behåller de tidigare.
    scope: data.scope ?? token?.scope ?? '',
  };
  sparaToken();
  schemalaggFornyelse();
}

function fornyaToken() {
  if (!token) return Promise.reject(new SpotifyFel('Inte inloggad på Spotify.', 401));
  fornyelse ??= tokenAnrop({ grant_type: 'refresh_token', refresh_token: token.refresh })
    .catch((fel) => {
      if (fel.kod === 'invalid_grant') {
        loggaUt();
        throw new SpotifyFel('Spotify-inloggningen har gått ut. Logga in igen.', 401);
      }
      throw new SpotifyFel('Kunde inte förnya Spotify-inloggningen. Kontrollera nätet.');
    })
    .finally(() => { fornyelse = null; });
  return fornyelse;
}

export async function hamtaAccessToken() {
  if (!token) throw new SpotifyFel('Inte inloggad på Spotify.', 401);
  if (Date.now() > token.utgar - FORNYA_MARGINAL_MS) await fornyaToken();
  return token.access;
}

// --- Inloggning ---

export function konfigurera({ clientId: id, redirectUri: uri }) {
  clientId = id;
  // Använd konfigurerad redirect-URI på rätt värd, annars sidans egen adress (t.ex. lokalt).
  let konfigurerad = null;
  try {
    konfigurerad = uri && new URL(uri).origin === location.origin ? uri : null;
  } catch {
    // Ogiltig URI i config – använd sidans adress.
  }
  redirectUri = konfigurerad ?? location.origin + location.pathname;
  token = lasToken();
  schemalaggFornyelse();
}

export const arInloggad = () => token != null;

// Inloggningar från före spellistorna saknar läsrätt till privata spellistor – då behövs ny inloggning.
export const harScope = (scope) => token?.scope == null || token.scope.split(' ').includes(scope);

export async function loggaIn() {
  if (!clientId) throw new SpotifyFel('Spotify client ID saknas.');
  const verifier = slumpstrang(48);
  const state = slumpstrang(16);
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  // localStorage i stället för sessionStorage: överlever om omdirigeringen öppnas i ny flik.
  localStorage.setItem(VERIFIER_KEY, verifier);
  localStorage.setItem(STATE_KEY, state);
  const url = new URL('https://accounts.spotify.com/authorize');
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });
  location.assign(url);
}

// Hanterar ?code=… efter omdirigering från Spotify. Returnerar true om en inloggning slutfördes.
export async function hanteraInloggning() {
  const params = new URLSearchParams(location.search);
  if (!params.has('code') && !params.has('error')) return false;
  history.replaceState(null, '', location.pathname + location.hash);

  const verifier = localStorage.getItem(VERIFIER_KEY);
  const state = localStorage.getItem(STATE_KEY);
  localStorage.removeItem(VERIFIER_KEY);
  localStorage.removeItem(STATE_KEY);

  if (params.has('error')) {
    throw new SpotifyFel(params.get('error') === 'access_denied'
      ? 'Inloggningen avbröts.'
      : `Inloggningen misslyckades (${params.get('error')}).`);
  }
  if (!verifier || params.get('state') !== state) {
    // Gammal omdirigering (t.ex. en andra flik med samma ?code=…) när inloggningen redan är klar – ignorera.
    if (token) return false;
    throw new SpotifyFel('Inloggningen kunde inte verifieras. Försök igen.');
  }
  try {
    await tokenAnrop({
      grant_type: 'authorization_code',
      code: params.get('code'),
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
  } catch (fel) {
    throw new SpotifyFel(`Inloggningen misslyckades: ${fel.message}`, fel.status);
  }
  return true;
}

export function loggaUt() {
  token = null;
  sparaToken();
  clearTimeout(fornyTimer);
  player?.disconnect();
  player = null;
  deviceId = null;
  anslutning = null;
}

// --- Web API ---

async function api(metod, sokvag, kropp, forsok = 0) {
  // Sökvägen kan också vara en hel adress, t.ex. next-länken i en sidindelad lista.
  const svar = await fetch(sokvag.startsWith('https://') ? sokvag : API + sokvag, {
    method: metod,
    headers: {
      Authorization: `Bearer ${await hamtaAccessToken()}`,
      ...(kropp && { 'Content-Type': 'application/json' }),
    },
    body: kropp ? JSON.stringify(kropp) : undefined,
  });
  if (svar.status === 401 && forsok === 0) {
    await fornyaToken();
    return api(metod, sokvag, kropp, 1);
  }
  if (!svar.ok) {
    const data = await svar.json().catch(() => ({}));
    throw new SpotifyFel(data.error?.message || `HTTP ${svar.status}`, svar.status);
  }
  return svar.status === 204 ? null : svar.json().catch(() => null);
}

export function hamtaProfil() {
  return api('GET', '/me');
}

// Låtnamn och artist för en track-URI.
export async function hamtaLat(uri) {
  const lat = await api('GET', `/tracks/${encodeURIComponent(uri.split(':').pop())}`);
  return { lat: lat.name, artist: lat.artists?.map((a) => a.name).join(', ') ?? '' };
}

function tillLat(lat) {
  // Lokala filer och poddavsnitt kan inte spelas via Web API.
  if (!lat || lat.type !== 'track' || lat.is_local || !lat.uri) return null;
  return {
    uri: lat.uri,
    titel: lat.name ?? '',
    artist: lat.artists?.map((a) => a.name).join(', ') ?? '',
    langd: lat.duration_ms ?? 0,
  };
}

async function hamtaSidor(forsta) {
  const latar = [];
  let sida = await api('GET', forsta);
  for (;;) {
    for (const rad of sida?.items ?? []) {
      // Nyare API-svar lägger låten i item, äldre i track.
      const lat = tillLat(rad.item ?? rad.track);
      if (lat) latar.push(lat);
    }
    if (!sida?.next) return latar;
    sida = await api('GET', sida.next);
  }
}

// Spellistans namn och låtar. id är spellistans Spotify-id.
export async function hamtaSpellista(id) {
  const del = encodeURIComponent(id);
  const lista = await api('GET', `/playlists/${del}?fields=name,uri`);
  let latar;
  try {
    latar = await hamtaSidor(`/playlists/${del}/items?limit=50`);
  } catch (fel) {
    // Äldre API utan /items – använd /tracks.
    if (fel.status !== 404) throw fel;
    latar = await hamtaSidor(`/playlists/${del}/tracks?limit=50`);
  }
  return { namn: lista.name ?? '', uri: lista.uri ?? `spotify:playlist:${id}`, latar };
}

// --- Web Playback SDK ---

function laddaSdk() {
  if (window.Spotify?.Player) return Promise.resolve();
  sdkLaddning ??= new Promise((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = resolve;
    const skript = document.createElement('script');
    skript.src = 'https://sdk.scdn.co/spotify-player.js';
    skript.onerror = () => {
      skript.remove();
      sdkLaddning = null;
      reject(new SpotifyFel('Kunde inte ladda Spotify-spelaren. Kontrollera nätet.'));
    };
    document.head.append(skript);
  });
  return sdkLaddning;
}

function tolkaStatus(s) {
  if (!s) return null;
  const lat = s.track_window?.current_track;
  return {
    uris: [lat?.uri, lat?.linked_from?.uri].filter(Boolean),
    titel: lat?.name ?? '',
    artist: lat?.artists?.map((a) => a.name).join(', ') ?? '',
    langd: s.duration,
    position: s.position,
    pausad: s.paused,
    kontext: s.context?.uri ?? null,
    tid: performance.now(),
  };
}

// Laddar SDK:t och skapar spelaren i förväg, så att activateElement() kan anropas
// direkt i användarens tryck (krävs på iOS).
export async function forberedSpelare({ namn = 'Onyktra Spelen', onStatus, onFel } = {}) {
  if (onStatus) lyssnare.status = onStatus;
  if (onFel) lyssnare.fel = onFel;
  await laddaSdk();
  if (player) return;

  player = new window.Spotify.Player({
    name: namn,
    volume: 1,
    getOAuthToken: (cb) => hamtaAccessToken().then(cb, (fel) => lyssnare.fel(fel.message)),
  });
  player.addListener('ready', ({ device_id }) => { deviceId = device_id; });
  player.addListener('not_ready', () => {
    deviceId = null;
    lyssnare.fel('Spotify-enheten tappade anslutningen.');
  });
  player.addListener('player_state_changed', (s) => lyssnare.status(tolkaStatus(s)));
  player.addListener('initialization_error', ({ message }) =>
    lyssnare.fel(`Spotify-spelaren stöds inte här: ${message}`));
  player.addListener('authentication_error', () =>
    fornyaToken().catch((fel) => lyssnare.fel(fel.message)));
  player.addListener('account_error', () => lyssnare.fel('Spotify Premium krävs för uppspelning.'));
  player.addListener('playback_error', ({ message }) => lyssnare.fel(`Uppspelningsfel: ${message}`));
  player.addListener('autoplay_failed', () =>
    lyssnare.fel('Webbläsaren blockerade ljudet – tryck på spela.'));
}

// Låser upp uppspelning. Anropa synkront i en klickhanterare.
export function aktivera() {
  player?.activateElement?.();
}

function vantaPaEnhet() {
  if (deviceId) return Promise.resolve(deviceId);
  return new Promise((resolve, reject) => {
    const klar = ({ device_id }) => {
      clearTimeout(timer);
      player.removeListener('ready', klar);
      resolve(device_id);
    };
    const timer = setTimeout(() => {
      player.removeListener('ready', klar);
      reject(new SpotifyFel('Spotify-spelaren svarade inte. Kontrollera nätet och att kontot har Premium.'));
    }, REDO_TIMEOUT_MS);
    player.addListener('ready', klar);
  });
}

const vanta = (ms) => new Promise((r) => setTimeout(r, ms));

async function flyttaUppspelning(id) {
  try {
    await api('PUT', '/me/player', { device_ids: [id], play: false });
  } catch (fel) {
    // Enheten kan behöva en stund innan Web API känner till den.
    if (fel.status !== 404) throw fel;
    await vanta(1000);
    await api('PUT', '/me/player', { device_ids: [id], play: false });
  }
}

// Ansluter spelaren som egen Spotify Connect-enhet och flyttar uppspelningen dit.
export function anslut() {
  anslutning ??= (async () => {
    await forberedSpelare();
    const redo = vantaPaEnhet();
    if (!(await player.connect())) throw new SpotifyFel('Kunde inte ansluta till Spotify.');
    const id = await redo;
    await flyttaUppspelning(id);
    return id;
  })().finally(() => { anslutning = null; });
  return anslutning;
}

async function ateranslut() {
  deviceId = null;
  player?.disconnect();
  return anslut();
}

export const arAnsluten = () => deviceId != null;

async function spelaPaEnhet(kropp, upprepa) {
  let id = deviceId ?? await ateranslut();
  try {
    await api('PUT', `/me/player/play?device_id=${encodeURIComponent(id)}`, kropp);
  } catch (fel) {
    if (fel.status !== 404) throw fel;
    id = await ateranslut();
    await api('PUT', `/me/player/play?device_id=${encodeURIComponent(id)}`, kropp);
  }
  try {
    await api('PUT', `/me/player/repeat?state=${upprepa}&device_id=${encodeURIComponent(id)}`);
  } catch (fel) {
    console.warn('Kunde inte ställa in upprepning:', fel);
  }
  return id;
}

// Spelar listan av låtar med början på index, från startMs. Låten upprepas tills man byter.
export async function spela(uris, { index = 0, startMs = 0 } = {}) {
  const id = await spelaPaEnhet({ uris, offset: { position: index }, position_ms: startMs }, 'track');
  // Grenens låt ska spelas som den är, även om spellistan spelades blandad.
  api('PUT', `/me/player/shuffle?state=false&device_id=${encodeURIComponent(id)}`)
    .catch((fel) => console.warn('Kunde inte stänga av blandning:', fel));
}

// Spelar en spellista från låten latUri (eller början). Hela listan upprepas.
export async function spelaSpellista(spellistaUri, { latUri, blanda = false } = {}) {
  const id = deviceId ?? await ateranslut();
  // Blandning ställs in före start så att den gäller direkt.
  await api('PUT', `/me/player/shuffle?state=${blanda}&device_id=${encodeURIComponent(id)}`).catch(() => {});
  await spelaPaEnhet({ context_uri: spellistaUri, ...(latUri && { offset: { uri: latUri } }) }, 'context');
}

// Slår på eller av blandning för det som spelas.
export function blanda(pa) {
  if (!deviceId) return Promise.resolve();
  return api('PUT', `/me/player/shuffle?state=${pa}&device_id=${encodeURIComponent(deviceId)}`);
}

export const vaxlaPaus = () => player?.togglePlay();
export const pausa = () => player?.pause();
export const foregaende = () => player?.previousTrack();
export const nasta = () => player?.nextTrack();

let volym = 1;
let toning = 0;

// Stegar spelarens volym till mal (0–1) under ms millisekunder. En ny toning avbryter den förra.
// Ger true om toningen gick klart, false om den avbröts.
export async function tonaVolym(mal, ms = 300) {
  const nr = ++toning;
  const fran = volym;
  if (fran === mal) return true;
  const steg = Math.max(1, Math.round(ms / 50));
  for (let i = 1; i <= steg; i++) {
    if (nr !== toning) return false;
    volym = fran + (mal - fran) * (i / steg);
    await player?.setVolume(volym).catch(() => {});
    if (i < steg) await vanta(50);
  }
  return nr === toning;
}

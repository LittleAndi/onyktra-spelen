// Service worker för Onyktra Spelen: cachar appen och ljudklippen så att de fungerar offline.
// Höj VERSION när appfiler, config.json eller klipp ändras.

const VERSION = 'onyktra-v1';

const APPFILER = [
  './',
  'index.html',
  'app.js',
  'audio.js',
  'spotify.js',
  'style.css',
  'config.json',
  'manifest.webmanifest',
  'fonts/big-shoulders-display.woff2',
  'fonts/ibm-plex-sans.woff2',
  'fonts/ibm-plex-mono-500.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-maskable-512.png',
];

// Spotify och Google Fonts-API:t går alltid direkt till nätet och cachas aldrig.
const ALDRIG_CACHA = /(^|\.)(spotify\.com|scdn\.co|googleapis\.com|gstatic\.com)$/;

const url = (sokvag) => new URL(sokvag, self.registration.scope).href;

function filLista(config) {
  const klipp = (config.effekter ?? []).map((e) => e.fil).filter(Boolean);
  return [...new Set([...APPFILER, ...klipp].map(url))];
}

async function allaFiler() {
  const svar = await fetch(url('config.json'), { cache: 'reload' });
  if (!svar.ok) throw new Error(`config.json: ${svar.status}`);
  return filLista(await svar.json());
}

// Hur många av appens filer som finns i cachen (klipplistan läses ur den cachade config.json).
async function cacheStatus() {
  const cache = await caches.open(VERSION);
  const config = await cache.match(url('config.json'));
  const filer = config ? filLista(await config.json()) : APPFILER.map(url);
  const traffar = await Promise.all(filer.map((f) => cache.match(f)));
  const cachade = traffar.filter(Boolean).length;
  return { version: VERSION, cachade, totalt: filer.length, redo: cachade === filer.length };
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    const filer = await allaFiler();
    await cache.addAll(filer.map((f) => new Request(f, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const namn = await caches.keys();
    await Promise.all(namn.filter((n) => n.startsWith('onyktra-') && n !== VERSION).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const adress = new URL(request.url);
  if (ALDRIG_CACHA.test(adress.hostname) || adress.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    // Sidan kan öppnas med ?code=… efter Spotify-inloggningen – visa ändå den cachade sidan.
    const traff = request.mode === 'navigate'
      ? await cache.match(request, { ignoreSearch: true }) ?? await cache.match(url('index.html'))
      : await cache.match(request);
    return traff ?? fetch(request);
  })());
});

self.addEventListener('message', async (event) => {
  const { typ } = event.data ?? {};
  if (typ === 'aktivera') {
    self.skipWaiting();
  } else if (typ === 'status') {
    const status = await cacheStatus().catch(() => ({ version: VERSION, cachade: 0, totalt: 0, redo: false }));
    event.ports[0]?.postMessage(status);
  }
});

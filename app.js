// UI och state för Onyktra Spelen.

import * as spotify from './spotify.js';
import * as ljud from './audio.js';

const STATUS_KEY = 'os.grenstatus';
const DUCKING_KEY = 'os.ducking';
const KLIENTID_KEY = 'os.clientId';
const TRACK_URI = /^spotify:track:[A-Za-z0-9]{22}$/;

const STATUS_TEXT = { kommande: '', pagar: 'Pågår', klar: 'Klar' };
const SASONG_TEXT = { sommar: 'Sommar', vinter: 'Vinter' };

const ICON_NOT = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
const ICON_PIL = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9AA6B5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';

const $ = (id) => document.getElementById(id);

let config;
let status = {};
let spelarStatus = null;
let klippStatus = null; // { laddade, totalt, fel } när förladdningen är klar
let duckad = false;
let bannerTimer;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child != null) node.append(child);
  }
  return node;
}

function lasLagrat(key, reserv) {
  try {
    const varde = localStorage.getItem(key);
    return varde == null ? reserv : JSON.parse(varde);
  } catch {
    return reserv;
  }
}

function sparaLagrat(key, varde) {
  try {
    localStorage.setItem(key, JSON.stringify(varde));
  } catch {
    // Lagring otillgänglig (t.ex. privat läge) – appen fungerar ändå under sessionen.
  }
}

function grenStatus(id) {
  return status[id] ?? 'kommande';
}

function latText(gren) {
  return [gren.lat, gren.artist].filter(Boolean).join(' · ') || 'Låt ej angiven';
}

function visaBanner(text) {
  const banner = $('banner');
  banner.textContent = text;
  banner.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { banner.hidden = true; }, 5000);
}

// Alla grenars låtar i ordning, så att föregående/nästa går mellan kvällens låtar.
function grenlatar() {
  return config.grenar.filter((g) => TRACK_URI.test(g.spotifyUri ?? ''));
}

async function spelaGren(gren) {
  const latar = grenlatar();
  const index = latar.indexOf(gren);
  if (index < 0) {
    visaBanner(`Ingen Spotify-låt angiven för ${gren.namn}.`);
    return;
  }
  if (!spotify.arInloggad()) {
    visaBanner('Spotify är inte anslutet – ladda om sidan och logga in.');
    return;
  }
  try {
    await spotify.spela(latar.map((g) => g.spotifyUri), { index, startMs: gren.startMs ?? 0 });
  } catch (fel) {
    console.error(fel);
    visaBanner(`Kunde inte starta låten: ${fel.message}`);
  }
}

// Att starta en gren sätter den som "pågår" och den som pågick som "klar".
function startaGren(id) {
  spotify.aktivera();
  for (const [annan, s] of Object.entries(status)) {
    if (s === 'pagar' && annan !== id) status[annan] = 'klar';
  }
  status[id] = 'pagar';
  sparaLagrat(STATUS_KEY, status);
  render();
  spelaGren(config.grenar.find((g) => g.id === id));
}

function nollstall() {
  if (!confirm('Nollställ status för alla grenar?')) return;
  status = {};
  sparaLagrat(STATUS_KEY, status);
  render();
}

function renderRaknare() {
  const total = config.grenar.length;
  const pagar = config.grenar.findIndex((g) => grenStatus(g.id) === 'pagar');
  const klara = config.grenar.filter((g) => grenStatus(g.id) === 'klar').length;
  $('raknare').textContent = `${pagar >= 0 ? pagar + 1 : klara}/${total}`;
}

function formateraTid(ms) {
  if (!Number.isFinite(ms)) return '–:––';
  const sek = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sek / 60)}:${String(sek % 60).padStart(2, '0')}`;
}

// Visar Spotify-spelarens låt om den finns, annars den pågående grenens låt.
function renderSpelasNu() {
  if (spelarStatus?.titel) {
    const index = config.grenar.findIndex((g) => spelarStatus.uris.includes(g.spotifyUri));
    $('np-nr').textContent = index >= 0 ? String(index + 1).padStart(2, '0') : '♪';
    $('np-titel').textContent = spelarStatus.titel;
    $('np-artist').textContent = spelarStatus.artist;
  } else {
    const index = config.grenar.findIndex((g) => grenStatus(g.id) === 'pagar');
    const gren = config.grenar[index];
    $('np-nr').textContent = gren ? String(index + 1).padStart(2, '0') : '–';
    $('np-titel').textContent = gren ? (gren.lat || gren.namn) : 'Ingen låt';
    $('np-artist').textContent = gren ? (gren.artist || '') : 'Välj en gren för att starta';
  }
  const spelar = spelarStatus != null && !spelarStatus.pausad;
  $('spela').classList.toggle('spelar', spelar);
  $('spela').setAttribute('aria-label', spelar ? 'Pausa' : 'Spela');
  renderForlopp();
}

function renderForlopp() {
  if (!spelarStatus?.langd) {
    $('np-tid').textContent = '0:00';
    $('np-langd').textContent = '–:––';
    $('np-bar').style.width = '0';
    return;
  }
  const { langd, position, pausad, tid } = spelarStatus;
  const nu = Math.min(langd, position + (pausad ? 0 : performance.now() - tid));
  $('np-tid').textContent = formateraTid(nu);
  $('np-langd').textContent = formateraTid(langd);
  $('np-bar').style.width = `${(nu / langd) * 100}%`;
}

function sattTransport(pa) {
  for (const id of ['foregaende', 'spela', 'nasta']) $(id).disabled = !pa;
}

function renderDucking() {
  const pa = duckingPa();
  const niva = Math.round((config.duckLevel ?? 0.3) * 100);
  $('ducking').setAttribute('aria-pressed', String(pa));
  $('ducking-text').textContent = `Sänk vid klipp · ${pa ? niva + '%' : 'av'}`;
}

function renderGrenar() {
  const rader = config.grenar.map((gren, i) => {
    const s = grenStatus(gren.id);
    const knapp = el('button', { class: `gren ${s}`, type: 'button', 'data-id': gren.id },
      el('span', { class: 'num' }, String(i + 1)),
      el('span', { class: 'gtext' },
        el('span', { class: 'gname' }, gren.namn, ' ', el('span', { class: 'status' }, STATUS_TEXT[s])),
        el('span', { class: 'gdesc' }, [SASONG_TEXT[gren.sasong], gren.beskrivning].filter(Boolean).join(' · ')),
        el('span', { class: 'gsong', html: ICON_NOT }, el('span', {}, latText(gren))),
      ),
      el('span', { html: ICON_PIL }),
    );
    knapp.addEventListener('click', () => startaGren(gren.id));
    return knapp;
  });
  $('grenar').replaceChildren(...rader);
}

function renderEffekter() {
  const knappar = config.effekter.map((effekt) => {
    const knapp = el('button', { class: 'pad', type: 'button', 'data-id': effekt.id },
      el('span', { class: `dot ${effekt.farg || 'is'}` }),
      el('span', {},
        el('span', { class: 'pname' }, effekt.namn),
        effekt.beskrivning ? el('span', { class: 'psub' }, effekt.beskrivning) : null,
      ),
    );
    let spelar = 0;
    knapp.addEventListener('click', () => {
      const startat = ljud.spela(effekt.id, () => {
        spelar -= 1;
        knapp.classList.toggle('spelar', spelar > 0);
      });
      if (!startat) {
        visaBanner(`Klippet ${effekt.namn} är inte laddat.`);
        return;
      }
      spelar += 1;
      knapp.classList.add('spelar');
    });
    return knapp;
  });
  $('effekter').replaceChildren(...knappar);
  renderEffektStatus();
}

// Knappar vars klipp inte kunde laddas visas som saknade.
function renderEffektStatus() {
  for (const knapp of $('effekter').children) {
    const saknas = klippStatus != null && !ljud.harKlipp(knapp.dataset.id);
    knapp.classList.toggle('saknas', saknas);
    knapp.setAttribute('aria-disabled', String(saknas));
  }
}

async function laddaKlipp() {
  sattRad('start-klipp', `Laddar 0/${config.effekter.length}…`);
  try {
    ljud.sattKlippVolym(config.klippVolym ?? 1);
    klippStatus = await ljud.forladda(config.effekter, ({ laddade, totalt }) =>
      sattRad('start-klipp', `Laddar ${laddade}/${totalt}…`));
  } catch (fel) {
    console.error(fel);
    klippStatus = { laddade: 0, totalt: config.effekter.length, fel: new Map() };
    sattRad('start-klipp', fel.message, 'fel-text');
    renderEffektStatus();
    return;
  }
  const { laddade, totalt, fel } = klippStatus;
  for (const [id, orsak] of fel) console.warn(`Klipp ${id}: ${orsak}`);
  sattRad('start-klipp', `${laddade}/${totalt}${laddade === totalt ? ' ✓' : ' – ' + [...fel.keys()].join(', ') + ' saknas'}`,
    laddade === totalt ? 'ok' : 'fel-text');
  renderEffektStatus();
}

// --- Ducking: sänk Spotify medan minst ett klipp spelar ---

const duckingPa = () => lasLagrat(DUCKING_KEY, true);

function uppdateraDucking() {
  const sank = duckad && duckingPa();
  // Snabbt ned när klippet börjar, mjukt upp (ca 300 ms) när det slutat.
  spotify.tonaVolym(sank ? (config.duckLevel ?? 0.3) : 1, sank ? 0 : 300);
}

ljud.sattDuckingLyssnare((aktiv) => {
  duckad = aktiv;
  uppdateraDucking();
});

function render() {
  renderRaknare();
  renderSpelasNu();
  renderGrenar();
}

function renderNatstatus() {
  const online = navigator.onLine;
  $('nat-dot').classList.toggle('offline', !online);
  $('nat-text').textContent = online
    ? 'Online · Spotify strömmas via nätet'
    : 'Offline · Spotify kräver nät';
}

function visaFel(text) {
  visaVy('oversikt');
  $('grenar').replaceChildren(el('div', { class: 'fel', role: 'alert' }, text));
}

async function laddaConfig() {
  const svar = await fetch('config.json', { cache: 'no-cache' });
  if (!svar.ok) throw new Error(`config.json: ${svar.status}`);
  return svar.json();
}

// --- Startvy ---

function klientId() {
  const fran = config.spotifyClientId;
  if (fran && fran !== 'DIN_CLIENT_ID') return fran;
  return lasLagrat(KLIENTID_KEY, '') || null;
}

function sattRad(id, text, klass = '') {
  $(id).textContent = text;
  $(id).className = `rad-varde ${klass}`;
}

function visaStartFel(text) {
  $('start-fel').textContent = text ?? '';
  $('start-fel').hidden = !text;
}

function visaVy(id) {
  $('start').hidden = id !== 'start';
  $('oversikt').hidden = id !== 'oversikt';
  window.scrollTo(0, 0);
}

function renderStart() {
  const inloggad = spotify.arInloggad();
  $('klientid-falt').hidden = inloggad || Boolean(config.spotifyClientId && config.spotifyClientId !== 'DIN_CLIENT_ID');
  $('logga-in').hidden = inloggad;
  $('starta').hidden = !inloggad;
  $('logga-ut').hidden = !inloggad;
  $('utan-spotify').hidden = false;
  if (!inloggad) {
    sattRad('start-konto', 'Ej inloggad');
    sattRad('start-spelare', 'Ej ansluten');
  }
}

async function visaKonto() {
  sattRad('start-konto', 'Kontrollerar…');
  try {
    const profil = await spotify.hamtaProfil();
    const namn = profil.display_name || profil.id;
    if (profil.product === 'premium') sattRad('start-konto', `${namn} ✓`, 'ok');
    else sattRad('start-konto', `${namn} – Premium krävs`, 'fel-text');
  } catch (fel) {
    sattRad('start-konto', 'Fel', 'fel-text');
    visaStartFel(fel.message);
    renderStart();
  }
}

function spelarHandelse(nyStatus) {
  spelarStatus = nyStatus;
  renderSpelasNu();
}

async function loggaIn() {
  const id = klientId();
  if (!id) {
    visaStartFel('Ange Spotify client ID först.');
    $('klientid').focus();
    return;
  }
  spotify.konfigurera({ clientId: id, redirectUri: config.redirectUri });
  try {
    await spotify.loggaIn();
  } catch (fel) {
    visaStartFel(fel.message);
  }
}

// Körs i användarens tryck: låser upp ljud (iOS) och ansluter Spotify-spelaren.
async function startaAppen() {
  spotify.aktivera();
  ljud.lasUpp().catch((fel) => console.warn('Kunde inte låsa upp ljud:', fel));

  visaStartFel(null);
  $('starta').disabled = true;
  $('starta').textContent = 'Startar…';
  sattRad('start-spelare', 'Ansluter…');
  try {
    await spotify.forberedSpelare({ onStatus: spelarHandelse, onFel: visaBanner });
    spotify.aktivera();
    await spotify.anslut();
    sattRad('start-spelare', 'Ansluten ✓', 'ok');
    sattTransport(true);
    visaVy('oversikt');
  } catch (fel) {
    console.error(fel);
    sattRad('start-spelare', 'Fel', 'fel-text');
    visaStartFel(fel.message);
    if (!spotify.arInloggad()) renderStart();
  } finally {
    $('starta').disabled = false;
    $('starta').textContent = 'Starta Onyktra Spelen';
  }
}

function initStart() {
  $('klientid').value = lasLagrat(KLIENTID_KEY, '');
  $('klientid').addEventListener('input', (e) => sparaLagrat(KLIENTID_KEY, e.target.value.trim()));
  $('logga-in').addEventListener('click', loggaIn);
  $('starta').addEventListener('click', startaAppen);
  $('utan-spotify').addEventListener('click', () => {
    ljud.lasUpp().catch((fel) => console.warn('Kunde inte låsa upp ljud:', fel));
    visaVy('oversikt');
  });
  $('logga-ut').addEventListener('click', () => {
    spotify.loggaUt();
    sattTransport(false);
    visaStartFel(null);
    renderStart();
  });

  $('spela').addEventListener('click', () => { spotify.aktivera(); spotify.vaxlaPaus(); });
  $('foregaende').addEventListener('click', () => spotify.foregaende());
  $('nasta').addEventListener('click', () => spotify.nasta());
  setInterval(() => { if (spelarStatus && !spelarStatus.pausad) renderForlopp(); }, 500);
}

async function initSpotify() {
  spotify.konfigurera({ clientId: klientId(), redirectUri: config.redirectUri });
  try {
    await spotify.hanteraInloggning();
  } catch (fel) {
    visaStartFel(fel.message);
  }
  renderStart();
  if (!spotify.arInloggad()) return;
  visaKonto();
  // Ladda SDK:t i förväg så att Starta-trycket kan låsa upp ljudet direkt.
  spotify.forberedSpelare({ onStatus: spelarHandelse, onFel: visaBanner })
    .catch((fel) => visaStartFel(fel.message));
}

async function init() {
  renderNatstatus();
  window.addEventListener('online', renderNatstatus);
  window.addEventListener('offline', renderNatstatus);

  try {
    config = await laddaConfig();
  } catch (fel) {
    console.error(fel);
    visaFel('Kunde inte läsa config.json. Kontrollera att filen finns och är giltig JSON.');
    return;
  }

  status = lasLagrat(STATUS_KEY, {});

  $('ducking').addEventListener('click', () => {
    sparaLagrat(DUCKING_KEY, !duckingPa());
    renderDucking();
    if (duckad) uppdateraDucking();
  });
  $('nollstall').addEventListener('click', nollstall);

  renderDucking();
  renderEffekter();
  render();

  initStart();
  laddaKlipp();
  await initSpotify();
}

init();

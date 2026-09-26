// UI och state för Onyktra Spelen.

import * as spotify from './spotify.js';
import * as ljud from './audio.js';
import * as grenar from './grenar.js';

const AKTUELL_KEY = 'os.aktuellGren';
const GAMMAL_STATUS_KEY = 'os.grenstatus';
const DUCKING_KEY = 'os.ducking';
const KLIENTID_KEY = 'os.clientId';
const GAMMAL_PIN_KEY = 'os.pin';
const TRACK_URI = /^spotify:track:[A-Za-z0-9]{22}$/;

const SASONG_TEXT = { sommar: 'Sommar', vinter: 'Vinter' };

const ICON_NOT = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
const ICON_HANDTAG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="8" x2="19" y2="8"/><line x1="5" y1="12" x2="19" y2="12"/><line x1="5" y1="16" x2="19" y2="16"/></svg>';
const ICON_PIL = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9AA6B5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';

const $ = (id) => document.getElementById(id);

let config;
let grundGrenar; // grenarna som de står i config.json – används tills grenarna hämtats från Supabase
let aktuellGren = null; // id för grenen som senast öppnades
let spelarStatus = null;
let klippStatus = null; // { laddade, totalt, fel } när förladdningen är klar
let duckad = false;
let tonarUt = false;
let aktivGren = null; // id för grenen som visas i grenvyn
let bannerTimer;
let pinKod = ''; // PIN-koden hålls bara i minnet, sparas aldrig i localStorage
let ordnar = null; // gren-id:n i ny ordning medan man ändrar ordning, annars null
let startKlar; // anropas när init (inkl. ev. Spotify-inloggning) är klar
const startKlarLofte = new Promise((klar) => { startKlar = klar; });

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
  avbrytToning();
  try {
    await spotify.spela(latar.map((g) => g.spotifyUri), { index, startMs: gren.startMs ?? 0 });
  } catch (fel) {
    console.error(fel);
    visaBanner(`Kunde inte starta låten: ${fel.message}`);
  }
}

const hittaGren = (id) => config.grenar.find((g) => g.id === id);

function renderRaknare() {
  const index = config.grenar.findIndex((g) => g.id === aktuellGren);
  $('raknare').textContent = `${index >= 0 ? index + 1 : '–'}/${config.grenar.length}`;
}

function formateraTid(ms) {
  if (!Number.isFinite(ms)) return '–:––';
  const sek = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sek / 60)}:${String(sek % 60).padStart(2, '0')}`;
}

// Visar Spotify-spelarens låt om den finns, annars den aktuella grenens låt.
function renderSpelasNu() {
  if (spelarStatus?.titel) {
    const index = config.grenar.findIndex((g) => spelarStatus.uris.includes(g.spotifyUri));
    $('np-nr').textContent = index >= 0 ? String(index + 1).padStart(2, '0') : '♪';
    $('np-titel').textContent = spelarStatus.titel;
    $('np-artist').textContent = spelarStatus.artist;
  } else {
    const index = config.grenar.findIndex((g) => g.id === aktuellGren);
    const gren = config.grenar[index];
    $('np-nr').textContent = gren ? String(index + 1).padStart(2, '0') : '–';
    $('np-titel').textContent = gren ? (gren.lat || gren.namn) : 'Ingen låt';
    $('np-artist').textContent = gren ? (gren.artist || '') : 'Välj en gren för att starta';
  }
  const spelar = spelarStatus != null && !spelarStatus.pausad;
  $('spela').classList.toggle('spelar', spelar);
  $('spela').setAttribute('aria-label', spelar ? 'Pausa' : 'Spela');
  renderTona();
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
  for (const id of ['foregaende', 'spela', 'nasta', 'tona', 'g-spela', 'g-tona']) $(id).disabled = !pa;
}

function renderDucking() {
  const pa = duckingPa();
  const niva = Math.round((config.duckLevel ?? 0.3) * 100);
  $('ducking').setAttribute('aria-pressed', String(pa));
  $('ducking-text').textContent = `Sänk vid klipp · ${pa ? niva + '%' : 'av'}`;
}

function renderGrenar() {
  const ordning = ordnar ? ordnar.map(hittaGren) : config.grenar;
  const rader = ordning.map((gren, i) => {
    const aktuell = gren.id === aktuellGren;
    const knapp = el(ordnar ? 'div' : 'button', {
      class: `gren${aktuell ? ' pagar' : ''}`,
      ...(!ordnar && { type: 'button' }),
      'data-id': gren.id,
    },
      el('span', { class: 'num' }, String(i + 1)),
      el('span', { class: 'gtext' },
        el('span', { class: 'gname' }, gren.namn, ' ', el('span', { class: 'status' }, aktuell ? 'Pågår' : '')),
        el('span', { class: 'gdesc' }, [SASONG_TEXT[gren.sasong], gren.beskrivning].filter(Boolean).join(' · ')),
        el('span', { class: 'gsong', html: ICON_NOT }, el('span', {}, latText(gren))),
      ),
      el('span', ordnar ? { class: 'handtag', html: ICON_HANDTAG, 'aria-label': `Flytta ${gren.namn}` } : { html: ICON_PIL }),
    );
    if (ordnar) knapp.addEventListener('pointerdown', (e) => borjaDra(e, knapp));
    else knapp.addEventListener('click', () => oppnaGren(gren.id));
    return knapp;
  });
  $('grenar').replaceChildren(...rader);
  $('grenar').classList.toggle('ordnas', Boolean(ordnar));
}

function effektKnapp(effekt) {
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
}

function renderEffekter() {
  $('effekter').replaceChildren(...config.effekter.map(effektKnapp));
  $('g-effekter').replaceChildren(...config.effekter.map(effektKnapp));
  renderEffektStatus();
}

// Knappar vars klipp inte kunde laddas visas som saknade.
function renderEffektStatus() {
  for (const knapp of document.querySelectorAll('.pad[data-id]')) {
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
  if (tonarUt) return; // Tona ut styr volymen tills den är klar eller avbruten.
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
  if (aktivGren) renderGrenvy();
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

// --- Grenar i Supabase ---

// Grenarna från Supabase ersätter dem i config.json. Tom lista (inget hämtat än) → config.json gäller.
function tillampaGrenar(lista) {
  config.grenar = lista.length ? lista : grundGrenar;
  if (ordnar) {
    // Behåll pågående omsortering, men bara för grenar som fortfarande finns.
    const ids = config.grenar.map((g) => g.id);
    ordnar = [...ordnar.filter((id) => ids.includes(id)), ...ids.filter((id) => !ordnar.includes(id))];
  }
  if (aktivGren && !hittaGren(aktivGren)) visaVy('oversikt');
  render();
}

async function hamtaGrenar() {
  if (!grenar.arKonfigurerad() || !navigator.onLine || dras) return;
  try {
    tillampaGrenar(await grenar.hamta());
  } catch (fel) {
    console.warn('Kunde inte hämta grenar:', fel);
  }
}

// Frågar efter PIN-koden i en egen dialog. Tom sträng om man avbryter.
function fragaPin() {
  return new Promise((resolve) => {
    const dialog = $('pin-dialog');
    $('pd-pin').value = '';
    dialog.returnValue = '';
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok' ? $('pd-pin').value.trim() : ''), { once: true });
    dialog.showModal();
  });
}

function tolkaTid(text) {
  const traff = text.trim().match(/^(?:(\d+):)?(\d+)$/);
  if (!traff) return text.trim() ? null : 0;
  return ((Number(traff[1] ?? 0) * 60) + Number(traff[2])) * 1000;
}

// --- Redigera gren ---

function visaRedigeraFel(text) {
  $('rg-fel').textContent = text ?? '';
  $('rg-fel').hidden = !text;
}

function sattLankInfo(text, klass = '') {
  $('rg-lank-info').textContent = text;
  $('rg-lank-info').className = klass;
}

function oppnaRedigera() {
  const gren = hittaGren(aktivGren);
  $('rg-rubrik').textContent = `Redigera – ${gren.namn}`;
  $('rg-namn').value = gren.namn ?? '';
  $('rg-sasong').value = gren.sasong ?? '';
  $('rg-beskrivning').value = gren.beskrivning ?? '';
  $('rg-mening').value = gren.mening ?? '';
  $('rg-lank').value = '';
  $('rg-lat').value = gren.lat ?? '';
  $('rg-artist').value = gren.artist ?? '';
  $('rg-start').value = formateraTid(gren.startMs ?? 0);
  $('rg-pin').value = '';
  $('rg-pin-falt').hidden = Boolean(pinKod);
  sattLankInfo('Spotify → Dela → Kopiera länk');
  visaRedigeraFel(null);
  $('redigera').showModal();
}

// Hämtar låtnamn och artist när en giltig länk klistras in.
let lankUppslag = 0;
async function lankAndrad() {
  const text = $('rg-lank').value;
  const uri = grenar.tolkaSpotifyLank(text);
  if (!text.trim()) {
    sattLankInfo('Spotify → Dela → Kopiera länk');
    return;
  }
  if (!uri) {
    sattLankInfo('Känns inte igen som en Spotify-låt.', 'fel-text');
    return;
  }
  sattLankInfo('Hämtar låtinfo…');
  const nr = ++lankUppslag;
  try {
    const { lat, artist } = await spotify.hamtaLat(uri);
    if (nr !== lankUppslag) return;
    $('rg-lat').value = lat;
    $('rg-artist').value = artist;
    sattLankInfo('Låt hittad ✓', 'ok');
  } catch (fel) {
    if (nr !== lankUppslag) return;
    console.warn(fel);
    sattLankInfo('Kunde inte hämta låtinfo – fyll i låt och artist själv.');
  }
}

async function sparaRedigering() {
  const gren = hittaGren(aktivGren);
  const namn = $('rg-namn').value.trim();
  const lank = $('rg-lank').value.trim();
  const uri = lank ? grenar.tolkaSpotifyLank(lank) : gren.spotifyUri;
  const startMs = tolkaTid($('rg-start').value);
  if (!namn) {
    visaRedigeraFel('Grenen måste ha ett namn.');
    return;
  }
  if (lank && !uri) {
    visaRedigeraFel('Klistra in en länk till en Spotify-låt.');
    return;
  }
  if (startMs == null) {
    visaRedigeraFel('Skriv starttiden som m:ss, t.ex. 0:42.');
    return;
  }
  const pin = pinKod || $('rg-pin').value.trim();
  if (!pin) {
    $('rg-pin-falt').hidden = false;
    visaRedigeraFel('Ange PIN-koden.');
    $('rg-pin').focus();
    return;
  }
  visaRedigeraFel(null);
  $('rg-spara').disabled = true;
  try {
    const lista = await grenar.spara(pin, {
      ...gren,
      namn,
      sasong: $('rg-sasong').value,
      beskrivning: $('rg-beskrivning').value.trim(),
      mening: $('rg-mening').value.trim(),
      spotifyUri: TRACK_URI.test(uri ?? '') ? uri : '',
      lat: $('rg-lat').value.trim(),
      artist: $('rg-artist').value.trim(),
      startMs,
    });
    pinKod = pin;
    tillampaGrenar(lista);
    $('redigera').close();
    visaBanner(`${namn} är sparad.`);
  } catch (fel) {
    if (fel.felPin) {
      pinKod = '';
      $('rg-pin-falt').hidden = false;
      $('rg-pin').value = '';
    }
    visaRedigeraFel(fel.message);
  } finally {
    $('rg-spara').disabled = false;
  }
}

function initRedigera() {
  if (!grenar.arKonfigurerad()) return;
  $('g-redigera').hidden = false;
  $('g-redigera').addEventListener('click', oppnaRedigera);
  $('rg-lank').addEventListener('input', lankAndrad);
  $('rg-avbryt').addEventListener('click', () => $('redigera').close());
  $('rg-form').addEventListener('submit', (e) => {
    e.preventDefault();
    sparaRedigering();
  });
  $('pd-avbryt').addEventListener('click', () => $('pin-dialog').close());
  $('pd-form').addEventListener('submit', (e) => {
    e.preventDefault();
    $('pin-dialog').close('ok');
  });
}

// --- Ändra ordning (dra i handtaget på översikten) ---

let dras = false;

function numrera() {
  $('grenar').querySelectorAll('.gren .num').forEach((num, i) => { num.textContent = String(i + 1); });
}

function borjaDra(e, rad) {
  if (dras || e.button > 0 || !e.target.closest('.handtag')) return;
  e.preventDefault();
  dras = true;
  const lista = $('grenar');
  rad.setPointerCapture(e.pointerId);
  rad.classList.add('drar');
  // Annars flyttar webbläsarens scroll anchoring sidan när raden byter plats i listan.
  document.documentElement.style.overflowAnchor = 'none';
  // Positioner i dokumentkoordinater så att det fungerar även när sidan rullar under dragningen.
  let startY = e.clientY + window.scrollY;
  let pekareY = e.clientY;
  let rullning = 0;

  const flytta = () => {
    for (;;) {
      const fore = rad.previousElementSibling;
      const efter = rad.nextElementSibling;
      rad.style.transform = `translateY(${pekareY + window.scrollY - startY}px)`;
      const ruta = rad.getBoundingClientRect();
      const mitt = ruta.top + ruta.height / 2;
      const top = rad.offsetTop;
      if (efter && mitt > efter.getBoundingClientRect().top + efter.offsetHeight / 2) lista.insertBefore(efter, rad);
      else if (fore && mitt < fore.getBoundingClientRect().top + fore.offsetHeight / 2) lista.insertBefore(rad, fore);
      else break;
      startY += rad.offsetTop - top; // raden flyttade i listan – kompensera så att den stannar under fingret
      numrera();
    }
  };

  // Rulla sidan när fingret är nära över- eller underkanten.
  const rulla = () => {
    const kant = 70;
    const steg = pekareY < kant ? -8 : pekareY > window.innerHeight - kant ? 8 : 0;
    if (steg) {
      window.scrollBy(0, steg);
      flytta();
    }
    rullning = requestAnimationFrame(rulla);
  };
  rullning = requestAnimationFrame(rulla);

  const ror = (ev) => {
    pekareY = ev.clientY;
    flytta();
  };
  const slut = () => {
    cancelAnimationFrame(rullning);
    rad.removeEventListener('pointermove', ror);
    rad.removeEventListener('pointerup', slut);
    rad.removeEventListener('pointercancel', slut);
    rad.classList.remove('drar');
    rad.style.transform = '';
    document.documentElement.style.overflowAnchor = '';
    ordnar = [...lista.children].map((r) => r.dataset.id);
    dras = false;
  };
  rad.addEventListener('pointermove', ror);
  rad.addEventListener('pointerup', slut);
  rad.addEventListener('pointercancel', slut);
}

function renderOrdning() {
  $('ordning').textContent = ordnar ? 'Spara ordning' : 'Ändra ordning';
  $('ordning').classList.toggle('aktiv', Boolean(ordnar));
  $('ordning-avbryt').hidden = !ordnar;
  $('grenar-hjalp').textContent = ordnar ? 'Dra i ≡ för att flytta' : 'Tryck för att starta';
}

function avslutaOrdna() {
  ordnar = null;
  renderOrdning();
  renderGrenar();
}

async function sparaOrdning() {
  const oforandrad = ordnar.length === config.grenar.length && ordnar.every((id, i) => config.grenar[i].id === id);
  if (oforandrad) {
    avslutaOrdna();
    return;
  }
  const pin = pinKod || await fragaPin();
  if (!pin) return;
  $('ordning').disabled = true;
  $('ordning').textContent = 'Sparar…';
  try {
    const lista = await grenar.sortera(pin, ordnar);
    pinKod = pin;
    ordnar = null;
    tillampaGrenar(lista);
    visaBanner('Ny ordning sparad.');
  } catch (fel) {
    if (fel.felPin) pinKod = '';
    visaBanner(fel.message);
  } finally {
    $('ordning').disabled = false;
    renderOrdning();
  }
}

function initOrdning() {
  if (!grenar.arKonfigurerad()) return;
  $('ordning-knappar').hidden = false;
  $('ordning').addEventListener('click', () => {
    if (!ordnar) {
      ordnar = config.grenar.map((g) => g.id);
      renderOrdning();
      renderGrenar();
    } else if (!dras) {
      sparaOrdning();
    }
  });
  $('ordning-avbryt').addEventListener('click', avslutaOrdna);
}

// --- Aktiv gren ---

function oppnaGren(id, { ersatt = false } = {}) {
  if (!hittaGren(id)) return;
  // Musiken startas aldrig automatiskt – man trycker play i grenvyn själv.
  spotify.aktivera();
  if (timer.gren !== id) aterstallTimer(id);
  aktivGren = id;
  aktuellGren = id;
  sparaLagrat(AKTUELL_KEY, id);
  // Historikpost så att telefonens bakåtknapp leder till översikten.
  const tillstand = { gren: id };
  if (ersatt || history.state?.gren) history.replaceState(tillstand, '');
  else history.pushState(tillstand, '');
  visaVy('grenvy');
  render();
}

function stangGren() {
  if (history.state?.gren) history.back();
  else visaVy('oversikt');
}

function nastaGren(id) {
  const index = config.grenar.findIndex((g) => g.id === id);
  return config.grenar[index + 1] ?? null;
}

function renderGrenvy() {
  const index = config.grenar.findIndex((g) => g.id === aktivGren);
  const gren = config.grenar[index];

  $('g-nummer').textContent = `Gren ${index + 1} av ${config.grenar.length}`;
  $('g-sasong').textContent = SASONG_TEXT[gren.sasong] ?? '';
  $('g-sasong').className = `tag ${gren.sasong ?? ''}`;
  $('g-namn').textContent = gren.namn;
  $('g-regel').textContent = gren.regel || gren.beskrivning || '';
  $('g-mening-kort').hidden = !gren.mening;
  $('g-mening').textContent = gren.mening ? `”${gren.mening}”` : '';

  const nasta = nastaGren(gren.id);
  $('g-nasta').textContent = nasta ? `Nästa gren – ${nasta.namn}` : 'Tillbaka till alla grenar';

  renderGrenMusik();
  renderTimer();
}

// Musikkortet visar spelarens låt om det är grenens, annars grenens förvalda låt.
function renderGrenMusik() {
  const index = config.grenar.findIndex((g) => g.id === aktivGren);
  const gren = config.grenar[index];
  const grenensLat = Boolean(spelarStatus?.uris.includes(gren.spotifyUri));
  $('g-nr').textContent = String(index + 1).padStart(2, '0');
  $('g-titel').textContent = grenensLat ? spelarStatus.titel : (gren.lat || 'Låt ej angiven');
  $('g-artist').textContent = grenensLat ? spelarStatus.artist : (gren.artist || '');
  const spelar = grenensLat && !spelarStatus.pausad;
  $('g-spela').classList.toggle('spelar', spelar);
  $('g-spela').setAttribute('aria-label', spelar ? 'Pausa' : 'Spela');
  renderTona();
}

function renderTona() {
  for (const id of ['tona', 'g-tona']) {
    $(id).textContent = tonarUt ? 'Tonar ut…' : 'Tona ut';
    $(id).classList.toggle('aktiv', tonarUt);
  }
}

function spelaGrenMusik() {
  spotify.aktivera();
  avbrytToning();
  const gren = hittaGren(aktivGren);
  // Spelar grenens låt redan (pausad eller inte) räcker det att växla paus.
  if (spelarStatus?.uris.includes(gren.spotifyUri)) spotify.vaxlaPaus();
  else spelaGren(gren);
}

// Tona ut: fade till 0 på 3 s, pausa och återställ sedan volymen till nästa låt.
async function tonaUt() {
  if (tonarUt || !spelarStatus || spelarStatus.pausad) return;
  tonarUt = true;
  renderTona();
  const klar = await spotify.tonaVolym(0, 3000);
  if (klar && tonarUt) {
    try {
      await spotify.pausa();
    } catch (fel) {
      console.warn('Kunde inte pausa:', fel);
    }
    tonarUt = false;
    uppdateraDucking();
    renderTona();
  }
}

// Avbryter en pågående utoning och återställer volymen direkt.
function avbrytToning() {
  if (!tonarUt) return;
  tonarUt = false;
  const sank = duckad && duckingPa();
  spotify.tonaVolym(sank ? (config.duckLevel ?? 0.3) : 1, 0);
  renderTona();
}

function tillNastaGren() {
  stoppaTimer();
  const nasta = nastaGren(aktivGren);
  if (nasta) oppnaGren(nasta.id, { ersatt: true });
  else stangGren();
}

// --- Timer ---

const timer = { gren: null, total: 60000, kvar: 60000, slut: null, intervall: null };

function timerSekunder(gren) {
  return gren?.timerSekunder ?? config.timerSekunder ?? 60;
}

function timerEffekt(gren, nyckel, reserv) {
  return gren?.[nyckel] ?? config[nyckel] ?? reserv;
}

function spelaEffekt(id) {
  if (id && !ljud.spela(id)) console.warn(`Klipp ${id} är inte laddat.`);
}

function aterstallTimer(id = timer.gren) {
  stoppaTimer();
  timer.gren = id;
  timer.total = timerSekunder(hittaGren(id)) * 1000;
  timer.kvar = timer.total;
  $('t-tid').classList.remove('slut');
  renderTimer();
}

function stoppaTimer() {
  if (timer.slut != null) timer.kvar = Math.max(0, timer.slut - performance.now());
  timer.slut = null;
  clearInterval(timer.intervall);
  timer.intervall = null;
}

function vaxlaTimer() {
  if (timer.slut != null) {
    stoppaTimer();
    renderTimer();
    return;
  }
  if (timer.kvar <= 0) aterstallTimer();
  if (timer.kvar === timer.total) {
    spelaEffekt(timerEffekt(hittaGren(timer.gren), 'timerStartEffekt', 'startskott'));
  }
  timer.slut = performance.now() + timer.kvar;
  timer.intervall = setInterval(tickaTimer, 200);
  renderTimer();
}

function tickaTimer() {
  timer.kvar = Math.max(0, timer.slut - performance.now());
  if (timer.kvar === 0) {
    stoppaTimer();
    spelaEffekt(timerEffekt(hittaGren(timer.gren), 'timerSlutEffekt', 'gong'));
    if (aktivGren === timer.gren) $('t-tid').classList.add('slut');
  }
  if (aktivGren === timer.gren) renderTimer();
}

function justeraTimer(sekunder) {
  if (timer.slut != null || timer.kvar !== timer.total) return;
  timer.total = Math.min(600000, Math.max(15000, timer.total + sekunder * 1000));
  timer.kvar = timer.total;
  renderTimer();
}

function renderTimer() {
  const sek = Math.ceil(timer.kvar / 1000);
  const tid = $('t-tid');
  tid.textContent = `${String(Math.floor(sek / 60)).padStart(2, '0')}:${String(sek % 60).padStart(2, '0')}`;
  tid.classList.toggle('kort', timer.slut != null && sek <= 10);
  const gar = timer.slut != null;
  const orord = timer.kvar === timer.total;
  const start = $('t-start');
  start.textContent = gar ? 'Pausa' : (orord || timer.kvar === 0 ? 'Starta' : 'Fortsätt');
  start.classList.toggle('pausad', gar);
  $('t-minus').disabled = gar || !orord;
  $('t-plus').disabled = gar || !orord;
}

function initGrenvy() {
  $('tillbaka').addEventListener('click', stangGren);
  $('t-start').addEventListener('click', () => { ljud.lasUpp().catch(() => {}); vaxlaTimer(); });
  $('t-aterstall').addEventListener('click', () => aterstallTimer());
  $('t-minus').addEventListener('click', () => justeraTimer(-15));
  $('t-plus').addEventListener('click', () => justeraTimer(15));
  $('g-spela').addEventListener('click', spelaGrenMusik);
  $('g-tona').addEventListener('click', tonaUt);
  $('g-nasta').addEventListener('click', tillNastaGren);
  window.addEventListener('popstate', (e) => {
    if ($('start').hidden === false) return;
    if (e.state?.gren && hittaGren(e.state.gren)) oppnaGren(e.state.gren, { ersatt: true });
    else visaVy('oversikt');
  });
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
  $('grenvy').hidden = id !== 'grenvy';
  if (id !== 'grenvy') aktivGren = null;
  window.scrollTo(0, 0);
}

function startText() {
  return navigator.onLine ? 'Starta Onyktra Spelen' : 'Starta offline – bara ljudklipp';
}

function renderStart() {
  const inloggad = spotify.arInloggad();
  const online = navigator.onLine;
  $('klientid-falt').hidden = inloggad || !online || Boolean(config.spotifyClientId && config.spotifyClientId !== 'DIN_CLIENT_ID');
  $('logga-in').hidden = inloggad || !online;
  $('starta').hidden = !inloggad && online;
  if (!$('starta').disabled) $('starta').textContent = startText();
  $('logga-ut').hidden = !inloggad;
  if (!inloggad) {
    sattRad('start-konto', 'Ej inloggad');
    sattRad('start-spelare', 'Ej ansluten');
  }
}

// --- Offline (service worker) ---

function fragaServiceWorker(worker, meddelande) {
  return new Promise((resolve, reject) => {
    const kanal = new MessageChannel();
    kanal.port1.onmessage = (e) => resolve(e.data);
    worker.postMessage(meddelande, [kanal.port2]);
    setTimeout(() => reject(new Error('Inget svar från service workern.')), 5000);
  });
}

async function renderOfflineStatus() {
  if (!('serviceWorker' in navigator)) {
    sattRad('start-offline', 'Stöds inte här', 'fel-text');
    return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const { redo, cachade, totalt } = await fragaServiceWorker(reg.active, { typ: 'status' });
    if (redo) sattRad('start-offline', 'Redo ✓', 'ok');
    else sattRad('start-offline', `${cachade}/${totalt} filer sparade`, 'fel-text');
  } catch (fel) {
    console.warn(fel);
    sattRad('start-offline', 'Okänt', 'fel-text');
  }
}

// På startvyn uppdateras appen direkt; mitt i tävlingen visas en knapp så att inget avbryts.
async function visaNyVersion(worker) {
  await startKlarLofte; // Ladda inte om mitt i en Spotify-inloggning.
  if (!$('start').hidden) {
    worker.postMessage({ typ: 'aktivera' });
    return;
  }
  const knapp = $('ny-version');
  knapp.hidden = false;
  knapp.onclick = () => {
    knapp.disabled = true;
    worker.postMessage({ typ: 'aktivera' });
  };
}

async function initServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    renderOfflineStatus();
    return;
  }
  const hadeKontroll = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Första installationen tar över sidan utan omladdning; en ny version laddar om.
    if (hadeKontroll) location.reload();
  });
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    if (reg.waiting && navigator.serviceWorker.controller) visaNyVersion(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const ny = reg.installing;
      ny?.addEventListener('statechange', () => {
        if (ny.state === 'installed' && navigator.serviceWorker.controller) visaNyVersion(ny);
        if (ny.state === 'activated' || ny.state === 'redundant') renderOfflineStatus();
      });
    });
    // En hemskärmsapp kan ligga i bakgrunden länge – leta efter ny version när den visas igen.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  } catch (fel) {
    console.error(fel);
    sattRad('start-offline', 'Kunde inte aktiveras', 'fel-text');
    return;
  }
  renderOfflineStatus();
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
  if (aktivGren) renderGrenMusik();
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
  if (!navigator.onLine) {
    // Utan nät går Spotify inte att nå – klippen fungerar ändå.
    sattRad('start-spelare', 'Offline – kräver nät');
    visaVy('oversikt');
    return;
  }
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
    $('starta').textContent = startText();
  }
}

function initStart() {
  $('klientid').value = lasLagrat(KLIENTID_KEY, '');
  $('klientid').addEventListener('input', (e) => sparaLagrat(KLIENTID_KEY, e.target.value.trim()));
  $('logga-in').addEventListener('click', loggaIn);
  $('starta').addEventListener('click', startaAppen);
  $('logga-ut').addEventListener('click', () => {
    spotify.loggaUt();
    sattTransport(false);
    visaStartFel(null);
    renderStart();
  });

  $('spela').addEventListener('click', () => { spotify.aktivera(); avbrytToning(); spotify.vaxlaPaus(); });
  $('foregaende').addEventListener('click', () => spotify.foregaende());
  $('nasta').addEventListener('click', () => spotify.nasta());
  $('tona').addEventListener('click', tonaUt);
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
  if (!navigator.onLine) {
    sattRad('start-konto', 'Offline');
    return;
  }
  visaKonto();
  // Ladda SDK:t i förväg så att Starta-trycket kan låsa upp ljudet direkt.
  spotify.forberedSpelare({ onStatus: spelarHandelse, onFel: visaBanner })
    .catch((fel) => visaStartFel(fel.message));
}

async function init() {
  renderNatstatus();
  window.addEventListener('online', renderNatstatus);
  window.addEventListener('offline', renderNatstatus);
  initServiceWorker();

  try {
    config = await laddaConfig();
  } catch (fel) {
    console.error(fel);
    visaFel('Kunde inte läsa config.json. Kontrollera att filen finns och är giltig JSON.');
    return;
  }
  grundGrenar = config.grenar;
  grenar.konfigurera({ url: config.supabaseUrl, key: config.supabaseKey });

  aktuellGren = lasLagrat(AKTUELL_KEY, null);
  try {
    localStorage.removeItem(GAMMAL_STATUS_KEY);
    localStorage.removeItem(GAMMAL_PIN_KEY);
  } catch { /* Lagring otillgänglig. */ }
  // Efter omladdning börjar appen på startvyn; släng en gammal grenpost i historiken.
  if (history.state?.gren) history.replaceState(null, '');

  $('ducking').addEventListener('click', () => {
    sparaLagrat(DUCKING_KEY, !duckingPa());
    renderDucking();
    if (duckad) uppdateraDucking();
  });

  renderDucking();
  renderEffekter();
  if (grenar.arKonfigurerad()) tillampaGrenar(grenar.cachade());
  else render();

  initStart();
  initGrenvy();
  initRedigera();
  initOrdning();
  hamtaGrenar();
  window.addEventListener('online', hamtaGrenar);
  laddaKlipp();
  window.addEventListener('online', renderStart);
  window.addEventListener('offline', renderStart);
  await initSpotify();
}

init().finally(startKlar);

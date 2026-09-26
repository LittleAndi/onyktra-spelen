// UI och state för Onyktra Spelen.

const STATUS_KEY = 'os.grenstatus';
const DUCKING_KEY = 'os.ducking';

const STATUS_TEXT = { kommande: '', pagar: 'Pågår', klar: 'Klar' };
const SASONG_TEXT = { sommar: 'Sommar', vinter: 'Vinter' };

const ICON_NOT = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
const ICON_PIL = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9AA6B5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';

const $ = (id) => document.getElementById(id);

let config;
let status = {};

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

// Att starta en gren sätter den som "pågår" och den som pågick som "klar".
function startaGren(id) {
  for (const [annan, s] of Object.entries(status)) {
    if (s === 'pagar' && annan !== id) status[annan] = 'klar';
  }
  status[id] = 'pagar';
  sparaLagrat(STATUS_KEY, status);
  render();
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

// Statiskt tills Spotify är inkopplat: visar den pågående grenens låt.
function renderSpelasNu() {
  const index = config.grenar.findIndex((g) => grenStatus(g.id) === 'pagar');
  const gren = config.grenar[index];
  $('np-nr').textContent = gren ? String(index + 1).padStart(2, '0') : '–';
  $('np-titel').textContent = gren ? (gren.lat || gren.namn) : 'Ingen låt';
  $('np-artist').textContent = gren ? (gren.artist || '') : 'Välj en gren för att starta';
}

function renderDucking() {
  const pa = lasLagrat(DUCKING_KEY, true);
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
    // Ljud kopplas in i audio.js; tills dess bara visuell återkoppling.
    knapp.addEventListener('click', () => {
      knapp.classList.add('tryckt');
      setTimeout(() => knapp.classList.remove('tryckt'), 150);
    });
    return knapp;
  });
  $('effekter').replaceChildren(...knappar);
}

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
  $('grenar').replaceChildren(el('div', { class: 'fel', role: 'alert' }, text));
}

async function laddaConfig() {
  const svar = await fetch('config.json', { cache: 'no-cache' });
  if (!svar.ok) throw new Error(`config.json: ${svar.status}`);
  return svar.json();
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
    sparaLagrat(DUCKING_KEY, !lasLagrat(DUCKING_KEY, true));
    renderDucking();
  });
  $('nollstall').addEventListener('click', nollstall);

  renderDucking();
  renderEffekter();
  render();
}

init();

// Ljudklipp via Web Audio API: förladdning, uppspelning ovanpå musiken och signal för ducking.

let kontext = null;
let klippGain = null;
const buffertar = new Map(); // effekt-id → AudioBuffer
let aktiva = 0;
let onDucking = () => {};

function skapaKontext() {
  if (kontext) return kontext;
  const Kontext = window.AudioContext ?? window.webkitAudioContext;
  if (!Kontext) throw new Error('Web Audio stöds inte i den här webbläsaren.');
  // iOS (Safari 17+): spela klippen även när telefonen står på ljudlöst.
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch {
    // Äldre webbläsare – ljudlöst läge kan tysta klippen.
  }
  kontext = new Kontext({ latencyHint: 'interactive' });
  klippGain = kontext.createGain();
  klippGain.connect(kontext.destination);
  return kontext;
}

// Anropas med true när första klippet börjar och false när sista slutar.
export function sattDuckingLyssnare(lyssnare) {
  onDucking = lyssnare;
}

export function sattKlippVolym(volym) {
  skapaKontext();
  klippGain.gain.value = volym;
}

// Hämtar och avkodar alla klipp. Fungerar innan ljudet låsts upp (kontexten är då pausad).
export async function forladda(effekter, onFramsteg = () => {}) {
  skapaKontext();
  const fel = new Map();
  let klara = 0;
  await Promise.all(effekter.map(async (effekt) => {
    try {
      if (!effekt.fil) throw new Error('ingen fil angiven');
      const svar = await fetch(effekt.fil);
      if (!svar.ok) throw new Error(`HTTP ${svar.status}`);
      buffertar.set(effekt.id, await kontext.decodeAudioData(await svar.arrayBuffer()));
    } catch (e) {
      fel.set(effekt.id, e.message);
    }
    klara += 1;
    onFramsteg({ klara, laddade: buffertar.size, totalt: effekter.length });
  }));
  return { laddade: buffertar.size, totalt: effekter.length, fel };
}

// Låser upp ljudet. Anropa synkront i en klickhanterare (krävs på iOS).
export function lasUpp() {
  try {
    skapaKontext();
    const tyst = kontext.createBufferSource();
    tyst.buffer = kontext.createBuffer(1, 1, kontext.sampleRate);
    tyst.connect(kontext.destination);
    tyst.start();
    return kontext.resume();
  } catch (e) {
    return Promise.reject(e);
  }
}

export const harKlipp = (id) => buffertar.has(id);

const FADE_UT = 0.15; // sekunder – undviker knäpp när ett klipp stoppas
const aktivaKallor = new Map(); // effekt-id → Set av { kalla, gain, start, langd }
let nasta = 0;

// Spelar ett klipp direkt; flera kan överlappa. onSlut anropas när just detta klipp är klart.
export function spela(id, onSlut = () => {}) {
  const buffer = buffertar.get(id);
  if (!buffer) return false;
  // iOS kan pausa kontexten när appen legat i bakgrunden; trycket väcker den igen.
  if (kontext.state !== 'running') kontext.resume().catch(() => {});

  const kalla = kontext.createBufferSource();
  kalla.buffer = buffer;
  const gain = kontext.createGain();
  kalla.connect(gain);
  gain.connect(klippGain);

  const post = { kalla, gain, start: kontext.currentTime, langd: buffer.duration, nr: nasta += 1 };
  let klar = false;
  const avsluta = () => {
    if (klar) return;
    klar = true;
    clearTimeout(reserv);
    kalla.disconnect();
    gain.disconnect();
    const grupp = aktivaKallor.get(id);
    grupp?.delete(post);
    if (grupp?.size === 0) aktivaKallor.delete(id);
    aktiva -= 1;
    if (aktiva === 0) onDucking(false);
    onSlut();
  };
  // Reserv om kontexten aldrig startar och onended uteblir – annars fastnar musiken sänkt.
  const reserv = setTimeout(avsluta, buffer.duration * 1000 + 1500);
  kalla.onended = avsluta;
  post.avsluta = avsluta;

  if (!aktivaKallor.has(id)) aktivaKallor.set(id, new Set());
  aktivaKallor.get(id).add(post);
  aktiva += 1;
  if (aktiva === 1) onDucking(true);
  kalla.start();
  return true;
}

function tona(post) {
  if (post.stoppad) return;
  post.stoppad = true;
  const nu = kontext.currentTime;
  try {
    post.gain.gain.cancelScheduledValues(nu);
    post.gain.gain.setValueAtTime(post.gain.gain.value, nu);
    post.gain.gain.linearRampToValueAtTime(0, nu + FADE_UT);
    post.kalla.stop(nu + FADE_UT);
  } catch {
    post.avsluta();
  }
  // Om onended uteblir (pausad kontext) avslutas klippet ändå.
  setTimeout(post.avsluta, FADE_UT * 1000 + 300);
}

// Stoppar alla pågående uppspelningar av ett klipp med en kort fade.
export function stoppa(id) {
  for (const post of aktivaKallor.get(id) ?? []) tona(post);
}

export function stoppaAlla() {
  for (const grupp of aktivaKallor.values()) for (const post of grupp) tona(post);
}

export const spelarKlipp = () => aktiva > 0;

// Pågående klipp: id → { antal, kvar (sekunder för det senast startade), langd }.
export function aktivaKlipp() {
  const nu = kontext?.currentTime ?? 0;
  const ut = new Map();
  for (const [id, grupp] of aktivaKallor) {
    let senaste = null;
    for (const post of grupp) if (!post.stoppad && (!senaste || post.nr > senaste.nr)) senaste = post;
    senaste ??= [...grupp][0];
    const gatt = Math.max(0, nu - senaste.start);
    ut.set(id, { antal: grupp.size, kvar: Math.max(0, senaste.langd - gatt), langd: senaste.langd });
  }
  return ut;
}

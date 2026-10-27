/* Visibilità locale: gestione prospect, giro e stampe. Dati in un repository GitHub privato,
   copia locale in IndexedDB per lavorare offline. Nessun dato vive nel repository dell'app. */
'use strict';
const VERSIONE = '0.29.6';
/* versione in fondo allo splash di avvio, senza la «v» (che compare solo nel Profilo) */
/* ambiente: lo decide l'indirizzo dell'app (…/visibilita-locale-stage/ è stage, il resto è produzione) */
const AMBIENTE = /-stage\//.test(location.pathname) ? 'stage' : 'prod';
const AMB_NOME = AMBIENTE === 'stage' ? 'Stage' : 'Produzione';
// stage salva su un database e una chiave propri: nello stesso browser non tocca il collegamento della produzione
const SUFF = AMBIENTE === 'stage' ? '-stage' : '';
const CHIAVE_CFG = 'vl-cfg' + SUFF;
{ const sv = document.getElementById('splashV'); if (sv) sv.innerHTML = `<span class="amb amb-${AMBIENTE}">${AMB_NOME}</span>Versione ${VERSIONE}`; }
document.documentElement.dataset.amb = AMBIENTE;
const STATI = ['Da contattare', 'Contattato', 'In attesa di risposta', 'Visita fissata', 'Visita fatta', 'Proposta inviata', 'Trattativa', 'Vinto', 'Perso', 'Scartato'];
const CHIUSI = ['Vinto', 'Perso', 'Scartato'];
// nomi vecchi degli stati: si leggono ancora e diventano quelli nuovi al primo salvataggio della zona
const STATI_VECCHI = { 'Chiuso vinto': 'Vinto', 'Chiuso perso': 'Perso' };
const normStato = (p) => { if (p && STATI_VECCHI[p.stato]) p.stato = STATI_VECCHI[p.stato]; return p; };
const canaleT = (c) => (c === 'Passaggio in agenzia' ? 'Passaggio' : c || '');   // nome vecchio nei contatti già registrati
const CANALI = ['Telefono', 'Passaggio', 'Visita', 'WhatsApp', 'Email', 'LinkedIn'];
const ESITI = ['Nessuna risposta', 'Chiuso', 'Segreteria', 'Richiamare', 'Ripassare', 'Report consegnato', 'Fare report completo', 'Interessato', 'Appuntamento fissato', 'Proposta inviata', 'Obiezione', 'Non interessato', 'Firmato'];
const prossimoOrdine = (zid, data) => Object.values(ST.zone[zid].z.prospect).filter((q) => !q.del && q.giro && q.giro.data === data).reduce((m, q) => Math.max(m, q.giro.ordine || 0), 0) + 1;
function rinumera(zid, data) {
  Object.values(ST.zone[zid].z.prospect).filter((q) => !q.del && q.giro && q.giro.data === data).sort((x, y) => (x.giro.ordine || 99) - (y.giro.ordine || 99))
    .forEach((q, i) => { if (q.giro.ordine !== i + 1) { q.giro = { ...q.giro, ordine: i + 1 }; tocca(q, 'giro'); } });
}
const ESITO_STATO = { 'Nessuna risposta': 'Contattato', 'Segreteria': 'Contattato', 'Richiamare': 'Contattato', 'Ripassare': 'Contattato', 'Report consegnato': 'Contattato', 'Fare report completo': 'In attesa di risposta',
  'Interessato': 'In attesa di risposta', 'Appuntamento fissato': 'Visita fissata', 'Proposta inviata': 'Proposta inviata', 'Obiezione': 'Trattativa',
  'Non interessato': 'Perso', 'Firmato': 'Vinto' };
/* lo stato avanza con l'esito, non torna indietro (es. "Nessuna risposta" su un prospect in trattativa) */
/* iniziali maiuscole su nomi e referenti: tocca solo le parole tutte minuscole,
   lascia stare sigle e marchi (RE/MAX, D&D, BERTOLINO) e le forme societarie (s.a.s., srl) */
const MINORI = new Set(['di', 'da', 'del', 'della', 'dello', 'dei', 'degli', 'delle', 'e', 'ed', 'il', 'la', 'lo', 'le', 'gli', 'in', 'a', 'al', 'alla', 'per', 'con', 'su', 'sul', 'sulla', 'dal', 'dalla', 'dai', 'dalle', 'nel', 'nella', 'nei', 'tra', 'fra', 'ai', 'agli', 'alle']);
const SOCIETA = /^(s\.?r\.?l\.?s?|s\.?a\.?s\.?|s\.?n\.?c\.?|s\.?p\.?a\.?|s\.s\.|d\.i\.)$/i;
const ELISE = /^(dell|all|nell|sull|dall|coll|l)['’]/;   // dell'arte, all'angolo: la preposizione resta minuscola
/* persona = true per referenti e interlocutori: Di Stefano, Della Valle, D'Amico (uso anagrafico) */
function maiuscole(t, persona = false) {
  if (!t) return t;
  return t.replace(/\s+/g, ' ').trim().split(' ').map((w, i) => {
    if (w !== w.toLowerCase() || (i > 0 && SOCIETA.test(w))) return w;
    if (/&/.test(w) && w.length <= 5) return w.toUpperCase();   // b&b, d&d
    if (!persona && i > 0 && MINORI.has(w)) return w;
    const su = w.replace(/(^|['’\-])(\p{L})/gu, (m, sep, c) => sep + c.toUpperCase());
    return !persona && i > 0 && ELISE.test(w) ? su[0].toLowerCase() + su.slice(1) : su;
  }).join(' ');
}
/* partita IVA: controllo della cifra finale (stesso algoritmo dell'Agenzia delle Entrate) */
function pivaValida(n) {
  if (!/^\d{11}$/.test(n || '') || /^0+$/.test(n)) return false;
  let s = 0;
  for (let i = 0; i < 10; i++) { let d = +n[i]; if (i % 2) { d *= 2; if (d > 9) d -= 9; } s += d; }
  return (10 - (s % 10)) % 10 === +n[10];
}
const pulisciPiva = (t) => (t || '').toUpperCase().replace(/^IT/, '').replace(/\D/g, '');
/* compila da sola la P.IVA dei prospect che non ce l'hanno, se il controllo siti l'ha trovata sul loro sito */
function pivaDaSiti() {
  // una P.IVA che compare sui siti di più domini diversi è quella della sede di una rete (es. Tecnocasa): non è dell'agenzia
  const host = (u) => String(u || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0].toLowerCase();
  const domini = {};
  for (const s of Object.values(ST.zone)) for (const p of Object.values(s.z.prospect || {})) {
    const url = p.sito || (s.z.attivita[p.pid] || {}).w; const ver = verificaSito(s.z, url);
    if (ver && ver.piva) (domini[ver.piva] = domini[ver.piva] || new Set()).add(host(url));
  }
  const diRete = (n) => domini[n] && domini[n].size > 1;
  for (const [zid, s] of Object.entries(ST.zone)) {
    let cambiato = false;
    for (const p of Object.values(s.z.prospect || {})) if (p.piva_fonte === 'sito' && diRete(p.piva)) { p.piva = ''; delete p.piva_fonte; cambiato = true; }
    for (const p of Object.values(s.z.prospect || {})) {
      if (p.del || p.piva || p.piva_fonte) continue;   // già presente, o svuotata a mano
      const ver = verificaSito(s.z, p.sito || (s.z.attivita[p.pid] || {}).w);
      if (ver && ver.piva && pivaValida(ver.piva) && !diRete(ver.piva)) { p.piva = ver.piva; p.piva_fonte = 'sito'; cambiato = true; }   // senza toccare u: è un dato derivato, non vince sulle modifiche fatte altrove
    }
    if (cambiato) modificato(zid);
  }
}
const esitiDi = (r) => r.esiti || (r.esito ? r.esito.split(' · ') : []);
const statoDaEsito = (attuale, esito) => { const n = ESITO_STATO[esito]; if (!n) return attuale; if (/^Chiuso/.test(n)) return n; if (CHIUSI.includes(attuale)) return n; return STATI.indexOf(n) > STATI.indexOf(attuale) ? n : attuale; };
const ESITO_AZIONE = { 'Nessuna risposta': ['Richiamare', 1], 'Chiuso': ['Ripassare', 1], 'Ripassare': ['Ripassare', 2], 'Segreteria': ['Richiamare', 1], 'Richiamare': ['Richiamare', 2],
  'Report consegnato': ["Telefonare per fissare l'incontro", 3], 'Fare report completo': ['Preparare e consegnare il report completo', 2], 'Interessato': ["Fissare l'incontro", 2], 'Appuntamento fissato': ["Incontro: presentare l'analisi completa", 0],
  'Proposta inviata': ['Sentire per la decisione sulla proposta', 4], 'Obiezione': ["Rispondere all'obiezione", 2] };
const PRIORITA = ['1 Caldo', '2 Tiepido', '0 Invisibile', '3 Rete'];   // ordine di lavoro: prima i caldi
const PRODOTTI = ['GBP SEO', 'SEO locale', 'AI SEO', 'InRete', 'Scheda PagineGialle', 'PgCasa', 'TuttoCittà', 'Display', 'Pacchetto misto'];
const RETI = /tecnocasa|tecnorete|tempoagency|gabetti|tempocasa|re\/?max|engel|century ?21|grimaldi|coldwell|toscano|professionecasa|frimm|soloaffitti|fondocasa|affiliato|franchising/i;
const MOTORE = ['motore/report.py', 'motore/foglio.py', 'motore/importa.py', 'motore/siti.py', 'motore/requirements.txt', 'motore/salva.sh', 'motore/esegui_import.sh', 'motore/esegui_report.sh', 'motore/esegui_siti.sh',
  ...['PlexCond-Bold', 'PlexCond-SemiBold', 'PlexMono-Bold', 'PlexMono-Medium', 'PlexMono-Regular', 'PlexSans-Bold', 'PlexSans-Medium', 'PlexSans-Regular', 'PlexSans-SemiBold', 'DejaVuSans'].map((f) => `motore/fonts/${f}.ttf`)];
const WORKFLOW = { 'motore/workflows/report.yml': '.github/workflows/report.yml', 'motore/workflows/importa.yml': '.github/workflows/importa.yml', 'motore/workflows/siti.yml': '.github/workflows/siti.yml' };

const ST = { cfg: {}, zone: {}, conf: { firma: {} }, sync: { stato: 'loc', msg: 'Locale' }, f: { stato: 'aperti', prio: '', zona: '', q: '', kpi: '', pg: '' }, giroData: null, fg: { tappa: '', prio: '' }, timer: {}, pdf: {}, pdfMsg: {} };

/* ---------- utilità ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ora = () => Date.now();
const iso = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
/* data e ora sempre di Roma, formato 24 ore, qualunque sia il fuso o il formato impostato sul telefono */
const TZ = 'Europe/Rome';
const oggi = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const oraRoma = (d, opz = {}) => new Date(d).toLocaleString('it-IT', { timeZone: TZ, hourCycle: 'h23', ...opz });
const ORARI = (() => { const o = []; for (let m = 7 * 60; m <= 21 * 60; m += 15) o.push(`${String(m / 60 | 0).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`); return o; })();
const sceltaOra = (attr, val) => `<select class="btn mini ora" ${attr} aria-label="Orario"><option value="">--:--</option>${(val && !ORARI.includes(val) ? [val, ...ORARI] : ORARI).map((o) => `<option value="${esc(o)}"${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
const piuGiorni = (n, da) => { const d = da ? new Date(da + 'T12:00') : new Date(oggi() + 'T12:00'); d.setDate(d.getDate() + n); return iso(d); };
const giorni = (s) => (s ? Math.round((new Date(s + 'T12:00') - new Date(oggi() + 'T12:00')) / 864e5) : null);
const gg = (s) => { if (!s) return ''; const [a, m, d] = s.split('-'); return `${d}/${m}`; };
const ggLungo = (s) => (s ? new Date(s + 'T12:00').toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }) : '');
const uid = () => ora().toString(36) + Math.random().toString(36).slice(2, 6);
const slug = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const tel = (t) => (t || '').replace(/[^\d+]/g, '');
const wa = (t) => { let n = tel(t).replace(/^\+/, ''); if (!n.startsWith('39')) n = '39' + n; return n; };
const aperto = (p) => !CHIUSI.includes(p.stato);
function toast(m, ms = 2600) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(ST.timer.t); ST.timer.t = setTimeout(() => (t.hidden = true), ms); }

/* ---------- archivio locale (IndexedDB, con ripiego in memoria) ---------- */
const DB = (() => {
  let dbp; const mem = {};
  // iOS a volte perde la connessione all'archivio quando l'app torna dallo sfondo: si riapre e si riprova una volta
  const open = () => dbp || (dbp = new Promise((ok, ko) => {
    const r = indexedDB.open('visibilita' + SUFF, 1); r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => { const db = r.result; db.onclose = () => { dbp = null; }; db.onversionchange = () => { db.close(); dbp = null; }; ok(db); };
    r.onerror = () => { dbp = null; ko(r.error); }; r.onblocked = () => { dbp = null; ko(new Error('archivio bloccato')); };
  }));
  const tx1 = async (modo, fn) => { const db = await open(); return new Promise((ok, ko) => { const t = db.transaction('kv', modo); const req = fn(t.objectStore('kv')); t.oncomplete = () => ok(req && req.result); t.onerror = () => ko(t.error); t.onabort = () => ko(t.error); }); };
  const tx = async (modo, fn) => { try { return await tx1(modo, fn); } catch (e) { dbp = null; await new Promise((r) => setTimeout(r, 300)); return tx1(modo, fn); } };
  const guasto = (e) => { D0.guasto = String(e && (e.message || e.name) || e); };
  const D0 = {
    guasto: '',
    get: async (k) => { try { return await tx('readonly', (s) => s.get(k)); } catch (e) { guasto(e); return mem[k]; } },
    set: async (k, v) => { try { await tx('readwrite', (s) => s.put(v, k)); } catch (e) { guasto(e); mem[k] = v; } },
    del: async (k) => { try { await tx('readwrite', (s) => s.delete(k)); } catch (e) { guasto(e); delete mem[k]; } },
    keys: async () => { try { return await tx('readonly', (s) => s.getAllKeys()); } catch (e) { guasto(e); return Object.keys(mem); } },
  };
  return D0;
})();

/* ---------- GitHub ---------- */
const GH = {
  ok: () => !!(ST.cfg.owner && ST.cfg.repo && ST.cfg.token),
  url: (p) => `https://api.github.com/repos/${ST.cfg.owner}/${ST.cfg.repo}/contents/${p.split('/').map(encodeURIComponent).join('/')}`,
  async req(p, opz = {}, accept = 'application/vnd.github+json') {
    // tempo massimo: su iPhone una richiesta partita prima di mettere l'app in background può restare appesa per sempre
    const limite = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(opz.method === 'PUT' ? 60000 : 25000) } : {};
    const r = await fetch(GH.url(p), { cache: 'no-store', ...limite, ...opz, headers: { Authorization: `Bearer ${ST.cfg.token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', ...(opz.headers || {}) } });
    if (r.status === 404) return null;
    if (!r.ok) { const e = new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 160)}`); e.status = r.status; throw e; }
    return r;
  },
  async list(p) { const r = await GH.req(p); return r ? r.json() : []; },
  async getText(p) {
    const r = await GH.req(p); if (!r) return null;
    const j = await r.json();
    if (j.content) return { text: b64dec(j.content), sha: j.sha };
    const raw = await GH.req(p, {}, 'application/vnd.github.raw+json'); // file oltre 1 MB
    return { text: await raw.text(), sha: j.sha };
  },
  async getJSON(p) { const t = await GH.getText(p); return t && { data: JSON.parse(t.text), sha: t.sha }; },
  async getBlob(p) { const r = await GH.req(p, {}, 'application/vnd.github.raw+json'); return r && r.blob(); },
  async sha(p) { const r = await GH.req(p); return r ? (await r.json()).sha : null; },
  async put(p, b64, sha, msg) {
    const r = await GH.req(p, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg, content: b64, ...(sha ? { sha } : {}) }) });
    return (await r.json()).content.sha;
  },
  putJSON: (p, data, sha, msg) => GH.put(p, b64enc(JSON.stringify(data)), sha, msg),
};
function b64enc(str) { const b = new TextEncoder().encode(str); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
function b64dec(b64) { const s = atob(b64.replace(/\n/g, '')); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return new TextDecoder().decode(b); }
async function bufB64(buf) { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }

/* ---------- sincronizzazione ---------- */
function statoSync(stato, msg) {
  ST.sync = { stato, msg }; const b = $('#sync'); b.className = 'sync ' + stato; $('#syncTxt').textContent = msg;
  const fs = $('#fSync'); if (fs) { fs.className = 'sync ' + stato; fs.lastChild.textContent = msg; }   // stesso stato anche dentro la scheda aperta
}
const piuRecente = (a, b) => ((a && a.u || 0) >= (b && b.u || 0) ? a : b);
/* una cancellazione resta tale anche se l'altro dispositivo ha modificato il record dopo */
const recordUnito = (a, b) => { const w = piuRecente(a, b); return (a && a.del) || (b && b.del) ? { ...w, del: true } : w; };
/* il timestamp di una modifica supera sempre quello già noto del record: un orologio indietro non fa perdere modifiche */
const nuovoU = (rec) => Math.max(ora(), ((rec && rec.u) || 0) + 1);
/* ogni campo modificato di un prospect porta la sua ora (uf): due dispositivi che cambiano campi diversi non si cancellano a vicenda */
function tocca(p, ...campi) { const u = nuovoU(p); p.uf = { ...(p.uf || {}) }; for (const k of campi) p.uf[k] = u; p.u = u; }
function prospectUnito(a, b) {
  if (!a || !b) return recordUnito(a, b);
  const w = piuRecente(a, b), o = w === a ? b : a;
  const ufw = w.uf || {}, ufo = o.uf || {};
  const r = { ...w, uf: { ...ufw } };
  for (const k of Object.keys(ufo)) {
    if ((ufo[k] || 0) > (ufw[k] || 0)) { if (k in o) r[k] = o[k]; else delete r[k]; r.uf[k] = ufo[k]; }
  }
  r.u = Math.max(a.u || 0, b.u || 0);
  if (a.del || b.del) r.del = true;
  return r;
}
function unisci(loc, rem) {
  // record per record vince la modifica più recente; nessuna cancellazione fisica (campo del)
  const z = JSON.parse(JSON.stringify(rem));
  // la scansione più recente porta con sé griglia e dati tecnici; i testi modificabili seguono l'ultima modifica
  const lm = loc.meta || {}, rm = rem.meta || {};
  const scansioneLoc = (lm.data || '') > (rm.data || '') || ((lm.data || '') === (rm.data || '') && lm.report_key !== rm.report_key && (lm.u || 0) > (rm.u || 0));
  const base = scansioneLoc ? lm : rm, testi = piuRecente(lm, rm);
  if (scansioneLoc && loc.punti) { z.punti = loc.punti; if (loc.punti_ai) z.punti_ai = loc.punti_ai; else delete z.punti_ai; }   // la griglia AI segue la sua scansione Maps
  z.meta = { ...base };
  if (rem.punti_ai && !scansioneLoc) for (const k of ['report_key_ai', 'data_ai']) if (rm[k] !== undefined) z.meta[k] = rm[k];
  for (const k of ['frase_kw', 'centrata', 'luogo', 'prossimo_passo', 'quartiere', 'citta', 'categoria']) if (testi[k] !== undefined) z.meta[k] = testi[k];
  z.meta.u = Math.max(lm.u || 0, rm.u || 0);
  for (const k of ['prospect', 'registro']) {
    z[k] = { ...(rem[k] || {}) };
    for (const [id, v] of Object.entries(loc[k] || {})) z[k][id] = k === 'prospect' ? prospectUnito(v, z[k][id]) : recordUnito(v, z[k][id]);
  }
  z.attivita = { ...(rem.attivita || {}) };
  for (const [pid, a] of Object.entries(loc.attivita || {})) if (!z.attivita[pid] || (a.u || 0) > (z.attivita[pid].u || 0)) z.attivita[pid] = a;
  return z;
}
async function salvaLocale(id) { const s = ST.zone[id]; await DB.set('zona:' + id, { z: s.z, sha: s.sha, dirty: s.dirty, siti: s.siti, sitiSha: s.sitiSha }); }
function modificato(id) {
  const s = ST.zone[id]; s.dirty = true; s.z.u = ora();
  salvaLocale(id); statoSync('att', 'In invio');
  clearTimeout(ST.timer['p' + id]); ST.timer['p' + id] = setTimeout(() => invia(id), 1500);
}
async function invia(id, tentativi = 3) {
  const s = ST.zone[id];
  if (!s.dirty || (s.inviando && tentativi === 3)) return;
  if (!GH.ok()) { statoSync('loc', 'Solo su questo dispositivo'); return; }
  if (!navigator.onLine) { statoSync('att', 'Offline: in coda'); return; }
  s.inviando = true;
  try {
    statoSync('att', 'Salvo…');
    const snap = JSON.stringify(s.z);
    const sha = await GH.putJSON(`zone/${id}/zona.json`, s.z, s.sha, `Aggiorna ${id}`);
    s.sha = sha; if (JSON.stringify(s.z) === snap) s.dirty = false;
    s.inviando = false;
    await salvaLocale(id); statoSync('ok', 'Salvato');
    if (s.dirty) invia(id);
  } catch (e) {
    if ((e.status === 409 || e.status === 422) && tentativi > 0) { // modificato da un altro dispositivo
      try {
        const r = await GH.getJSON(`zone/${id}/zona.json`);
        if (r) { s.z = unisci(s.z, r.data); s.sha = r.sha; }
        return invia(id, tentativi - 1);
      } catch (e2) { console.error(e2); }   // rete caduta durante il recupero: si riprova tra 30 secondi
    }
    s.inviando = false;
    statoSync('err', e.status === 401 ? 'Token non valido' : 'Errore: riprovo');
    console.error(e);
    ST.timer['p' + id] = setTimeout(() => invia(id), 30000);
  }
}
async function scarica() {
  if (!GH.ok() || !navigator.onLine) { statoSync(GH.ok() ? 'att' : 'loc', GH.ok() ? 'Offline' : 'Solo su questo dispositivo'); return; }
  if (ST.scaricando) return; ST.scaricando = true;   // un solo aggiornamento alla volta
  try {
    statoSync('att', 'Aggiorno…');
    const conf = await GH.getJSON('config.json'); if (conf) { ST.conf = conf.data; ST.confSha = conf.sha; DB.set('conf', ST.conf); }
    const dirs = (await GH.list('zone')).filter((d) => d.type === 'dir');
    for (const d of dirs) {
      const id = d.name;
      const elenco = await GH.list(`zone/${id}`);
      const file = elenco.find((f) => f.name === 'zona.json');
      if (!file) continue;
      const fs = elenco.find((f) => f.name === 'siti.json');
      if (fs && ST.zone[id] && ST.zone[id].sitiSha !== fs.sha) {
        const r = await GH.getJSON(`zone/${id}/siti.json`).catch(() => null);
        if (r) { ST.zone[id].siti = r.data; ST.zone[id].sitiSha = fs.sha; await salvaLocale(id); }
      }
      if (!ST.zone[id]) { const s0 = await DB.get('zona:' + id); if (s0 && s0.z) ST.zone[id] = s0; }   // modifiche offline mai perse se l'archivio era lento all'avvio
      const loc = ST.zone[id];
      if (loc && loc.sha === file.sha && !loc.dirty) continue;
      if (loc && loc.inviando) continue;   // un invio è in corso: la zona si aggiorna al giro successivo
      const r = await GH.getJSON(`zone/${id}/zona.json`);
      const ora0 = ST.zone[id];
      if (ora0 !== loc || (ora0 && ora0.inviando)) continue;   // durante l'attesa è partito un invio o la zona è cambiata: si riprende al giro successivo
      if (loc && loc.dirty) { loc.z = unisci(loc.z, r.data); loc.sha = r.sha; }   // stesso oggetto: nessuna copia di stati temporanei
      else ST.zone[id] = { z: r.data, sha: r.sha, dirty: false, siti: loc && loc.siti, sitiSha: loc && loc.sitiSha };
      if (!ST.zone[id].siti && fs) { const rs = await GH.getJSON(`zone/${id}/siti.json`).catch(() => null); if (rs) { ST.zone[id].siti = rs.data; ST.zone[id].sitiSha = fs.sha; } }
      await salvaLocale(id);
      if (ST.zone[id].dirty) invia(id);
    }
    pivaDaSiti();
    statoSync('ok', 'Aggiornato ' + oraRoma(Date.now(), { hour: '2-digit', minute: '2-digit' }));
    ST.ultimo = ora();
    // mentre si scrive in un campo la vista non si ricostruisce: si aggiorna appena il campo perde il fuoco
    const att = document.activeElement;
    if (!$('#foglio').hidden || (att && /^(INPUT|TEXTAREA|SELECT)$/.test(att.tagName) && $('#vista').contains(att))) ST.daRender = true; else render();
  } catch (e) { console.error(e); statoSync('err', e.status === 401 ? 'Token non valido' : 'Non raggiungibile'); }
  finally { ST.scaricando = false; }
}

/* ---------- accesso ai dati ---------- */
const tutti = () => Object.entries(ST.zone).flatMap(([zid, s]) => Object.values(s.z.prospect || {}).filter((p) => !p.del).map((p) => ({ zid, z: s.z, p: normStato(p) })));
const registro = (zid, pid) => Object.values(ST.zone[zid].z.registro || {}).filter((r) => !r.del && r.p === pid).sort((a, b) => (b.data + b.u > a.data + a.u ? 1 : -1));
// contatti di prospect ancora presenti (quelli di prospect eliminati non entrano nei conteggi)
const registroVivo = () => Object.values(ST.zone).flatMap((s) => Object.values(s.z.registro || {}).filter((r) => !r.del && s.z.prospect[r.p] && !s.z.prospect[r.p].del));
const ultimoContatto = (zid, pid) => (registro(zid, pid)[0] || {}).data || '';
/* data proposta per aggiungere un prospect a un giro: quella aperta nella vista Giro, altrimenti il prossimo giro in programma, altrimenti oggi */
function dataGiroProposta() {
  const og = oggi();
  if (ST.giroData && ST.giroData >= og) return ST.giroData;
  return tutti().filter((x) => x.p.giro && x.p.giro.data && x.p.giro.data >= og).map((x) => x.p.giro.data).sort()[0] || og;
}
function aggiorna(zid, pid, campi) { const p = ST.zone[zid].z.prospect[pid]; Object.assign(p, campi); tocca(p, ...Object.keys(campi)); modificato(zid); }
function urgenza(p) { if (!aperto(p) || !p.data_prossima) return null; return giorni(p.data_prossima); }
// linea a sinistra = quanto è caldo il prospect, con i colori della legenda priorità (1 Caldo, 2 Tiepido, 0 Invisibile, 3 Rete)
function classeCard(p) { const pr = 'pr' + ((p.priorita || '')[0] || 'x'); if (p.stato === 'Vinto') return pr + ' vinto'; if (!aperto(p)) return pr + ' chiuso'; return pr; }
const prioClasse = (p) => 'p' + (p.priorita || '9')[0];
/* 🟢 caldo, 🟠 tiepido, 🔵 invisibile (categoria a sé), ⚪ rete (franchising, gestione separata) */
const PALLINO = { 1: '🟢', 0: '🔵', 2: '🟠', 3: '⚪' };
const ORDINE_PRIO = { 1: 0, 2: 1, 0: 2, 3: 3 };
const prioRank = (p) => ORDINE_PRIO[(p.priorita || '9')[0]] ?? 9;
const prioTesto = (pr) => (pr ? `${PALLINO[pr[0]] || '⚪'} ${pr}` : '—');   // solo dove serve testo puro (menu a tendina)
const pallino = (pr) => (pr ? `<i class="pt pt${pr[0]}" aria-hidden="true"></i>` : '');   // pallino piccolo disegnato in CSS
const prioHtml = (pr) => (pr ? `${pallino(pr)}${esc(pr)}` : '—');

/* ---------- router ---------- */
const VISTE = { oggi: vOggi, prospect: vProspect, giro: vGiro, zone: vZone, cruscotto: vCruscotto, tabella: vTabella, altro: vAltro };
const TITOLI = { oggi: 'Oggi', prospect: 'Prospect', giro: 'Giro', zone: 'Zone', cruscotto: 'Numeri', tabella: 'Tabella', altro: 'Profilo' };
/* app e dati devono essere dello stesso ambiente: stage con visibilita-dati (o produzione con …-stage) va segnalato */
function avvisoAmbiente() {
  const r = ST.cfg && ST.cfg.repo;
  if (!r || (AMBIENTE === 'stage') === /-stage$/.test(r)) return '';
  return `<div class="amb-avviso" role="alert">${AMBIENTE === 'stage'
    ? `App di stage collegata ai <b>dati di produzione</b> (${esc(r)}). Le prove finiscono sui dati veri: in Profilo imposta visibilita-dati-stage.`
    : `App di produzione collegata ai <b>dati di prova</b> (${esc(r)}). In Profilo imposta visibilita-dati.`}</div>`;
}
function render() {
  const [vista, a, b] = (location.hash.slice(1) || 'oggi').split('/');
  // indirizzo sconosciuto (vecchio segnalibro, errore di battitura): si torna a Oggi invece di lasciare la vista precedente
  if (!VISTE[vista] && vista !== 'p' && vista !== 'z') { location.replace('#oggi'); return; }
  document.querySelectorAll('.tab a').forEach((x) => x.classList.toggle('on', x.dataset.t === vista));
  document.body.classList.toggle('largo', vista === 'tabella');
  $('#titolo').textContent = TITOLI[vista] || 'Visibilità';
  if (VISTE[vista]) {
    const V0 = $('#vista'), scroll = V0.scrollTop, cambio = ST.vistaAttuale !== vista;
    V0.innerHTML = avvisoAmbiente() + VISTE[vista](); legaVista(vista);
    V0.scrollTop = ST.restaScroll || !cambio ? scroll : 0;   // cambiando scheda si riparte dall'alto
    ST.vistaAttuale = vista;
  }
  ST.restaScroll = false;
  if (vista === 'p' && a && b) apriProspect(a, b);
  if (vista === 'z' && a) apriZona(a);
}
document.addEventListener('focusout', () => setTimeout(() => { if (ST.daRender && $('#foglio').hidden && !(document.activeElement && $('#vista').contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName))) { ST.daRender = false; ST.restaScroll = true; render(); } }, 50));
// iOS: con html/body bloccati, la tastiera a volte lascia la pagina spostata in alto
document.addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement || document.activeElement === document.body) { if (window.scrollY) window.scrollTo(0, 0); } }, 50));
window.addEventListener('hashchange', (e) => { const da = (e.oldURL.split('#')[1] || 'oggi'); if (VISTE[da.split('/')[0]]) ST.indietro = '#' + da; if (!/^#(p|z)\//.test(location.hash)) chiudiFoglio(); render(); });

/* ---------- vista: oggi ---------- */
/* anteprima della heat map: griglia di pallini come nelle slide, anello blu sul punto più vicino alla sede */
const COL_RANK = (r) => (!r ? '#C5221F' : r === 1 ? '#1E8E3E' : r === 2 ? '#34A853' : r === 3 ? '#6CC24A' : r <= 6 ? '#F6C026' : r <= 10 ? '#F29529' : '#E8603C');
const _righe = new WeakMap();
function righeGriglia(z) {
  if (_righe.has(z.punti)) return _righe.get(z.punti);
  const n = z.meta.griglia || Math.round(Math.sqrt(z.punti.length));
  const idx = z.punti.map((pt, i) => i).sort((a, b) => (z.punti[b][0] - z.punti[a][0]) || (z.punti[a][1] - z.punti[b][1]));
  const rows = []; for (let i = 0; i < idx.length; i += n) rows.push(idx.slice(i, i + n).sort((a, b) => z.punti[a][1] - z.punti[b][1]));
  _righe.set(z.punti, rows); return rows;
}
function miniMappa(z, p, px = 54) {
  if (!p.pid || !z.punti || !z.punti.length || !z.attivita[p.pid]) return `<span class="mini vuota" style="width:${px}px;height:${px}px" title="Non presente nella scansione"></span>`;
  const rows = righeGriglia(z); const n = rows.length; const c = px / n; const r = c * 0.42;
  const ranks = L.metriche(z, p.pid).ranks; const vic = L.puntiOrdinati(z, p)[0].i;
  let dots = '';
  rows.forEach((row, y) => row.forEach((i, x) => {
    const cx = (x + .5) * c, cy = (y + .5) * c;
    dots += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${COL_RANK(ranks[i])}"/>`;
    if (i === vic) dots += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r + 1.3).toFixed(1)}" fill="none" stroke="#1A73E8" stroke-width="1.4"/>`;
  }));
  return `<svg class="mini" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}" role="img" aria-label="Mappa di visibilità">${dots}</svg>`;
}
/* stato del sito: dominio proprio, solo portale o social, sito Google dismesso, nessun sito */
const PORTALI = /(^|\.)(immobiliare\.it|idealista\.it|casa\.it|wikicasa\.it|subito\.it|trovacasa\.net|paginegialle\.it|tripadvisor\.|thefork\.|booking\.com|miodottore\.it|treatwell\.it)$/i;
const SOCIAL = /(^|\.)(facebook\.com|fb\.com|instagram\.com|linktr\.ee|wa\.me|tiktok\.com|linkedin\.com)$/i;
const chiaveSito = (u) => (u || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
const STATO_SITO = { ssl: () => 'Sito con certificato non valido', parcheggiato: () => 'Dominio in vendita o scaduto', costruzione: () => 'Sito in costruzione', errore: (v) => `Sito in errore${v.codice ? ' ' + v.codice : ''}`, irraggiungibile: (v) => (v.nota && v.nota.startsWith('dominio') ? 'Dominio inesistente o scaduto' : 'Sito non raggiungibile') };
function verificaSito(z, url) { const s = z && z.id && ST.zone[z.id] && ST.zone[z.id].siti; return s && s.siti ? s.siti[chiaveSito(url)] : null; }
function sitoInfo(z, p) {
  const url = (p.sito || (z.attivita[p.pid] || {}).w || '').trim();
  if (!url) return { k: 'no', label: 'Nessun sito' };
  const host = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0].toLowerCase();
  const href = /^https?:/i.test(url) ? url : 'https://' + url;
  if (/\.business\.site$/.test(host)) return { k: 'morto', label: 'Sito Google dismesso', href };
  if (SOCIAL.test(host)) return { k: 'social', label: 'Solo social: ' + host.split('.')[0], href };
  if (PORTALI.test(host)) return { k: 'portale', label: 'Solo portale: ' + host, href };
  const ver = verificaSito(z, url);
  if (ver && STATO_SITO[ver.stato]) return { k: 'rotto', label: STATO_SITO[ver.stato](ver), href, ver };
  return { k: 'ok', label: host + (ver ? (ver.stato === 'ok' ? ' ✓' : ' ?') : ''), href, ver };
}
function badgeSito(z, p) {
  const s = sitoInfo(z, p);
  const icona = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/></svg>';
  return `<span class="badge-sito s-${s.k}" ${s.href ? `data-href="${esc(s.href)}"` : ''}>${icona}${esc(s.label)}</span>`;
}
/* presenza su PagineGialle: verifica manuale dal telefono (PagineGialle blocca i server GitHub) */
const PG = { assente: 'Assente su PG', base: 'PG base', evoluta: 'PG evoluta' };
const urlPG = (z, p) => `https://www.paginegialle.it/ricerca/${encodeURIComponent(p.nome || '')}/${encodeURIComponent(z.meta.citta || '')}`;
const badgePG = (p) => (PG[p.pg] ? `<span class="badge-pg pg-${p.pg}"><b>PG</b>${esc(PG[p.pg])}</span>` : '');
const nonRiv = (z, p) => !!(p.pid && z.attivita && z.attivita[p.pid] && z.attivita[p.pid].c === false && z.attivita[p.pid].cv);
// ultimo contatto registrato di un prospect (più recente per data, poi per ora di inserimento)
const ultimoReg = (z, pid) => Object.values(z.registro || {}).filter((r) => !r.del && r.p === pid).sort((a, b) => (b.data + b.u > a.data + a.u ? 1 : -1))[0];
// report completo richiesto e non ancora consegnato: ultimo esito "Fare report completo" o prossima azione sul report completo
const reportCompleto = (z, p) => { if (!aperto(p)) return false; const ur = ultimoReg(z, p.id); return /report completo/i.test(p.prossima || '') || !!(ur && esitiDi(ur).includes('Fare report completo')); };
// non interessato: stato Perso o ultimo esito "Non interessato"
const nonInteressato = (z, p) => { if (p.stato === 'Perso') return true; const ur = ultimoReg(z, p.id); return !!(ur && esitiDi(ur).includes('Non interessato')); };
// in lavoro: tutti tranne i non interessati, che restano visibili solo con il filtro «Non interessati»
const inLavoro = (x) => !nonInteressato(x.z, x.p);
// da ripassare: tappa non consegnata con ultimo esito Chiuso/Ripassare, o prossima azione "Ripassare"
const ripassare = (z, p) => { if ((p.giro && p.giro.fatto) || !aperto(p)) return false; const r = ultimoReg(z, p.id); return (r && esitiDi(r).some((e) => e === 'Chiuso' || e === 'Ripassare')) || /^ripassare/i.test(p.prossima || ''); };
const badgeRC = (z, p) => (reportCompleto(z, p) && !/report completo/i.test(p.prossima || '') ? '<span class="badge-rc">Report completo da preparare</span>' : '');
const esitoBreve = (r) => esitiDi(r).map((e) => esc(e)).join(' · ');
/* posizionamento nelle liste: quota di zone tra i primi 3, AI Mode (piattaforma primaria) sopra Maps, con barre */
function posizionamento(z, p) {
  if (!p.pid || !z.attivita || !z.attivita[p.pid] || !z.punti || !z.punti.length) return '';
  const m = L.metriche(z, p.pid);
  const ai = L.metricheAI(z, p.pid);
  const voci = [ai ? ['AI Mode', L.pct(ai.top3, ai.N)] : null, ['Maps', L.pct(m.top3, m.N)]].filter(Boolean);
  return `<div class="pos" aria-label="Zone tra i primi 3">${voci.map(([l, v]) => { const c = L.colorePct(v);
    return `<div class="pos-r"><span class="pos-l">${l}</span><span class="pos-t"><i class="pos-${c}" style="width:${Math.max(v, 2)}%"></i></span><b class="c-${c}">${v}%</b></div>`; }).join('')}</div>`;
}
function testoProspect(z, p, extra = '', opz = {}) {
  const g = urgenza(p); const ur = ultimoReg(z, p.id);
  const quando = p.data_prossima ? (g < 0 ? `<span class="data c-neg">scaduta ${gg(p.data_prossima)}</span>` : g === 0 ? '<span class="data c-low">oggi</span>' : `<span class="data">${gg(p.data_prossima)}</span>`) : '';
  return `<div class="riga"><span class="nome">${esc(p.nome)}</span>${quando}</div>
    <div class="riga"><span class="sub">${esc(p.stato)} · ${esc(z.meta.quartiere)}</span><span class="pill ${prioClasse(p)}">${prioHtml(p.priorita)}</span></div>
    ${ur ? `<div class="ultimo"><span>Ultimo contatto</span> <b>${esitoBreve(ur)}</b> · ${gg(ur.data)}</div>` : ''}
    ${p.prossima ? `<div class="az">→ ${esc(p.prossima)}</div>` : aperto(p) ? '<div class="az c-low">Nessuna prossima azione</div>' : ''}
    ${posizionamento(z, p)}
    <div class="badges">${opz.senzaRC ? '' : badgeRC(z, p)}${badgeSito(z, p)}${badgePG(p)}${nonRiv(z, p) ? '<span class="badge-nr"><svg viewBox="0 0 24 24"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17.5v.5"/></svg>Scheda non rivendicata</span>' : ''}</div>${extra}`;
}
function cardProspect({ zid, z, p }, extra = '') {
  return `<a class="card con-mappa ${classeCard(p)}" href="#p/${zid}/${p.id}">${miniMappa(z, p)}<div class="card-testo">${testoProspect(z, p, extra)}</div></a>`;
}
function vOggi() {
  const tt = tutti(); const tl = tt.filter(inLavoro); const ap = tl.filter((x) => aperto(x.p));
  const scad = ap.filter((x) => urgenza(x.p) < 0), vic = ap.filter((x) => { const g = urgenza(x.p); return g != null && g >= 0 && g <= 2; });
  const senza = ap.filter((x) => !x.p.prossima || !x.p.data_prossima), mai = ap.filter((x) => !registro(x.zid, x.p.id).length);
  if (!tt.length) return benvenuto();
  const K = { scad: [scad, 'Azioni scadute', 'c-neg'], vic: [vic, 'Entro 2 giorni', 'c-mid'], senza: [senza, 'Senza prossima azione', 'c-low'], mai: [mai, 'Mai contattati', ''] };
  const sel = ST.f.kpi && K[ST.f.kpi];
  const kpi = `<div class="kpi">${Object.entries(K).map(([k, [arr, lab, c]]) => `<button data-kpi="${k}" class="${ST.f.kpi === k ? 'sel' : ''}"><b class="${c}">${arr.length}</b><span>${lab}</span></button>`).join('')}</div>`;
  if (sel) return `${kpi}<div class="eb">${esc(sel[1])}</div><div class="lista">${sel[0].map((x) => cardProspect(x)).join('') || '<div class="vuoto">Nessun prospect in questa lista.</div>'}</div>`;
  // vista predefinita: solo chi va ancora contattato oggi (tappe del giro di oggi + azioni in scadenza oggi);
  // chi ha già un contatto registrato oggi o la tappa consegnata esce dalla lista
  const d = oggi();
  const sentitoOggi = (x) => registro(x.zid, x.p.id).some((r) => r.data === d) || (x.p.giro && x.p.giro.data === d && x.p.giro.fatto);
  const ordGiro = (a, b) => a.zid.localeCompare(b.zid) || (a.p.giro.ordine || 99) - (b.p.giro.ordine || 99);
  const giro = tt.filter((x) => x.p.giro && x.p.giro.data === d).sort(ordGiro);
  const numTappa = {}; const cont = {}; giro.forEach((x) => (numTappa[x.zid + '|' + x.p.id] = cont[x.zid] = (cont[x.zid] || 0) + 1));
  const giroDaFare = giro.filter((x) => !sentitoOggi(x) && aperto(x.p) && inLavoro(x));
  const inGiro = new Set(giro.map((x) => x.zid + '|' + x.p.id));
  const richiami = ap.filter((x) => x.p.data_prossima === d && !inGiro.has(x.zid + '|' + x.p.id) && !sentitoOggi(x))
    .sort((a, b) => prioRank(a.p) - prioRank(b.p));
  const fatti = tt.filter(sentitoOggi);
  const ultimoOggi = (x) => registro(x.zid, x.p.id).find((r) => r.data === d);
  const tappa = (x) => `<div class="riga" style="margin-top:4px"><span class="sub">${esc(x.p.giro.orario || '')}${x.p.giro.orario ? ' · ' : ''}tappa ${numTappa[x.zid + '|' + x.p.id] || ''}</span>${ripassare(x.z, x.p) ? '<span class="stato-tappa ripassare">↻ Ripassare</span>' : '<span class="stato-tappa">Visitare</span>'}</div>`;
  const esitoOggi = (x) => { const r = ultimoOggi(x); return `<div class="riga" style="margin-top:4px">${x.p.giro && x.p.giro.data === d && x.p.giro.fatto ? '<span class="stato-tappa consegnata">✓ Consegnato</span>' : ''}${r ? `<span class="sub">Oggi: ${esc(r.esito)}</span>` : ''}</div>`; };
  const vuoto = !giroDaFare.length && !richiami.length;
  return `${kpi}
  <div class="eb">Da fare oggi · ${ggLungo(d)} · ${giroDaFare.length + richiami.length} da contattare${fatti.length ? ` · ${fatti.length} già sentiti` : ''}</div>
  ${giro.length ? `<div class="row" style="margin-bottom:8px"><a class="btn mini" href="#giro">Apri il giro (${((n) => n + (n === 1 ? ' tappa' : ' tappe'))(giro.filter(inLavoro).length)})</a></div>` : ''}
  ${giroDaFare.length ? `<div class="sub" style="margin:2px 0 6px">Giro di oggi</div><div class="lista">${giroDaFare.map((x) => cardProspect(x, tappa(x))).join('')}</div>` : ''}
  ${richiami.length ? `<div class="sub" style="margin:10px 0 6px">Azioni in scadenza oggi</div><div class="lista">${richiami.map((x) => cardProspect(x)).join('')}</div>` : ''}
  ${vuoto ? `<div class="vuoto">${giro.length || fatti.length ? 'Tutti sentiti per oggi.' : 'Niente in programma per oggi.'}</div>` : ''}
  ${fatti.length ? `<div class="row mt"><button class="btn mini" id="oFatti">${ST.f.fatti ? 'Nascondi' : 'Mostra'} ${fatti.length === 1 ? 'chi è già stato sentito' : `i ${fatti.length} già sentiti`} oggi</button></div>
  ${ST.f.fatti ? `<div class="lista mt">${fatti.map((x) => cardProspect(x, esitoOggi(x))).join('')}</div>` : ''}` : ''}`;
}
function benvenuto() {
  if (DB.guasto && !GH.ok()) return `<div class="box"><h2>Archivio del telefono non raggiungibile</h2>
  <p>I dati non sono persi: sono su GitHub. iOS ha chiuso l'accesso all'archivio dell'app (${esc(DB.guasto)}).</p>
  <p><b>Chiudi l'app dal multitasking</b> (scorri verso l'alto) e riaprila. Se il problema resta, ricollega GitHub da Profilo: i dati si riscaricano da soli.</p>
  <a class="btn pri" href="#altro">Vai a Profilo</a></div>`;
  return `<div class="box"><h2>Benvenuto</h2><p>Nessun dato su questo dispositivo.</p>
  <p>${GH.ok() ? 'Il repository dati è collegato ma non contiene ancora zone: importa la prima da <b>Zone</b>.' : 'Collega il repository dati da <b>Profilo → Collegamento GitHub</b>, poi importa la prima zona.'}</p>
  <a class="btn pri" href="#${GH.ok() ? 'zone' : 'altro'}">${GH.ok() ? 'Vai a Zone' : 'Collega GitHub'}</a></div>`;
}

/* ---------- vista: prospect ---------- */
function filtraProspect() {
  const f = ST.f; let tt = tutti();
  // «Non interessati» sostituisce il filtro di stato; senza, i non interessati restano fuori da ogni lista
  if (f.ni) tt = tt.filter((x) => !inLavoro(x));
  else { tt = tt.filter(inLavoro); if (f.stato === 'aperti') tt = tt.filter((x) => aperto(x.p)); else if (f.stato) tt = tt.filter((x) => x.p.stato === f.stato); }
  if (f.prio) tt = tt.filter((x) => x.p.priorita === f.prio);
  if (f.zona) tt = tt.filter((x) => x.zid === f.zona);
  if (f.nr) tt = tt.filter((x) => nonRiv(x.z, x.p));
  if (f.ns) tt = tt.filter((x) => sitoInfo(x.z, x.p).k !== 'ok');
  if (f.pg === 'assente') tt = tt.filter((x) => x.p.pg === 'assente'); else if (f.pg === 'verifica') tt = tt.filter((x) => !x.p.pg);
  if (f.q) { const q = f.q.toLowerCase(); tt = tt.filter((x) => (x.p.nome + ' ' + x.p.referente + ' ' + x.p.indirizzo + ' ' + x.p.note).toLowerCase().includes(q)); }
  return tt.sort((a, b) => prioRank(a.p) - prioRank(b.p) || (a.p.data_prossima || '9').localeCompare(b.p.data_prossima || '9'));
}
const listaProspect = (tt) => tt.map((x) => cardProspect(x)).join('') || '<div class="vuoto">Nessun prospect con questi filtri.</div>';
function vProspect() {
  const f = ST.f; const zoneIds = Object.keys(ST.zone); const tt = filtraProspect();
  const chip = (campo, val, lab, html) => `<button class="chip ${f[campo] === val && !(campo === 'stato' && f.ni) ? 'on' : ''}" data-f="${campo}" data-v="${esc(val)}">${html || esc(lab)}</button>`;
  const lav = tutti().filter((x) => inLavoro(x) && aperto(x.p)); const nNI = tutti().length - tutti().filter(inLavoro).length;
  return `<input class="cerca" id="q" type="search" placeholder="Cerca nome, referente, via…" value="${esc(f.q)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
  <div class="filtri">${chip('stato', 'aperti', 'Aperti')}${chip('stato', '', 'Tutti')}${nNI || f.ni ? `<button class="chip chip-ni ${f.ni ? 'on' : ''}" id="filtroNI">Non interessati (${nNI})</button>` : ''}${STATI.map((s) => chip('stato', s, s)).join('')}</div>
  <div class="filtri"><button class="chip chip-nr ${f.nr ? 'on' : ''}" id="filtroNR">Non rivendicate (${lav.filter((x) => nonRiv(x.z, x.p)).length})</button><button class="chip chip-ns ${f.ns ? 'on' : ''}" id="filtroNS">Senza sito proprio (${lav.filter((x) => sitoInfo(x.z, x.p).k !== 'ok').length})</button><button class="chip chip-pg ${f.pg === 'assente' ? 'on' : ''}" data-fpg="assente">Assenti su PG (${lav.filter((x) => x.p.pg === 'assente').length})</button><button class="chip ${f.pg === 'verifica' ? 'on' : ''}" data-fpg="verifica">PG da verificare (${lav.filter((x) => !x.p.pg).length})</button>${chip('prio', '', 'Ogni priorità')}${PRIORITA.map((s) => chip('prio', s, s, prioHtml(s))).join('')}${zoneIds.length > 1 ? chip('zona', '', 'Tutte le zone') + zoneIds.map((z) => chip('zona', z, ST.zone[z].z.meta.quartiere)).join('') : ''}</div>
  <div class="sub" style="margin:4px 0 8px" id="contaP">${tt.length} prospect</div>
  <div class="lista" id="listaP">${listaProspect(tt)}</div>`;
}

/* ---------- scheda prospect ---------- */
const ICO = {
  tel: '<path d="M5 3.5h3.5l1.7 4.3-2.2 1.4a11 11 0 0 0 6.8 6.8l1.4-2.2 4.3 1.7V19a1.5 1.5 0 0 1-1.6 1.5C10.5 20 4 13.5 3.5 5.1A1.5 1.5 0 0 1 5 3.5z"/>',
  wa: '<path d="M4 20l1.3-3.9A8 8 0 1 1 8 19l-4 1z"/><path d="M9 9.5c.3 2 2.6 4.3 4.6 4.6l1.1-1.2 1.6.8c-.2 1.2-1.1 1.8-2.2 1.7-3-.3-6.4-3.7-6.6-6.6-.1-1.1.5-2 1.7-2.2l.8 1.6L9 9.5z"/>',
  map: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  web: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/>',
};
const ico = (k) => `<svg viewBox="0 0 24 24">${ICO[k]}</svg>`;
/* barra in fondo ai fogli: stesso comportamento ovunque
   vuoto   → "Chiudi" + azione disattivata (nulla da salvare)
   sporco  → "Annulla" (rosso) + azione attiva
   salvato → "Chiudi" + "✓ … alle HH:MM" (verde chiaro) */
const oraAdesso = () => oraRoma(Date.now(), { hour: '2-digit', minute: '2-digit' });
function statoBarra(f, stato, testo) {
  const [sx, dx] = f.querySelectorAll('.barra-salva .btn'); if (!sx || !dx) return;
  sx.textContent = stato === 'sporco' ? 'Annulla' : 'Chiudi'; sx.classList.toggle('neutro', stato !== 'sporco');
  dx.disabled = stato !== 'sporco'; dx.classList.toggle('fatto', stato === 'salvato');
  dx.textContent = stato === 'salvato' ? '✓ ' + (testo || 'Salvato') + ' alle ' + oraAdesso() : testo || (stato === 'sporco' ? 'Salva modifiche' : 'Nessuna modifica');
}
function apriFoglio(titolo, html, onClose) {
  const f = $('#foglio');
  f.innerHTML = `<div class="testa"><button id="chiudi" aria-label="Chiudi">←</button><h2>${esc(titolo)}</h2><span id="fSync" class="sync ${ST.sync.stato}" role="status"><span class="dot"></span><span>${esc(ST.sync.msg)}</span></span></div><div class="corpo">${html}</div>`;
  f.hidden = false; document.body.style.overflow = 'hidden';
  $('#chiudi').onclick = () => { if (onClose) onClose(); else history.back(); };
  return f;
}
function chiudiFoglio() {
  const f = $('#foglio'); f.hidden = true; f.innerHTML = ''; document.body.style.overflow = '';
  // aggiornamenti arrivati mentre il foglio era aperto: si mostrano adesso
  if (ST.daRender) { ST.daRender = false; ST.restaScroll = true; setTimeout(render, 0); }
}
function minigriglia(z, pid, opz = {}) {
  const m = opz.ai ? L.metricheAI(z, pid) : L.metriche(z, pid); const n = z.meta.griglia || Math.round(Math.sqrt(m.N));
  // punti ordinati da nord-ovest a sud-est per la visualizzazione
  const idx = z.punti.map((pt, i) => i).sort((a, b) => (z.punti[b][0] - z.punti[a][0]) || (z.punti[a][1] - z.punti[b][1]));
  const rows = []; for (let i = 0; i < idx.length; i += n) rows.push(idx.slice(i, i + n).sort((a, b) => z.punti[a][1] - z.punti[b][1]));
  const cl = (r) => (!r ? 'g-no' : r === 1 ? 'g-1' : r === 2 ? 'g-2' : r === 3 ? 'g-3' : r <= 6 ? 'g-y' : r <= 10 ? 'g-o' : 'g-r');
  return `<div class="griglia" style="grid-template-columns:repeat(${n},1fr)">${rows.flat().map((i) => { const r = m.ranks[i]; return `<i class="${cl(r)}">${r || ''}</i>`; }).join('')}</div>` + (opz.ai ? '' : `<div class="griglia-legenda"><span><i style="background:var(--g1)"></i>1-3 visibile</span><span><i style="background:var(--y)"></i>4-10 poco visibile</span><span><i style="background:var(--r1)"></i>11-20 invisibile</span><span><i style="background:var(--r2)"></i>assente</span></div>`);
}
/* scheda cliente: Google AI Mode sulla stessa griglia, con le zone perse rispetto a Maps */
function sezioneAI(z, p) {
  if (!p.pid || !z.attivita[p.pid] || !L.haAI(z)) return '';
  const a = L.metricheAI(z, p.pid), pc = (n) => L.pct(n, a.N);
  return `<div class="eb">Google AI Mode · «${esc(z.meta.keyword)}»</div>
  <div class="stat"><div><span>tra le prime 3</span><b class="c-${L.colorePct(pc(a.top3))}">${a.top3}/${a.N}<small>${pc(a.top3)}%</small></b></div></div>
  <div class="mt">${minigriglia(z, p.pid, { ai: true })}</div>`;
}
function apriProspect(zid, id, opz = {}) {
  const s = ST.zone[zid]; if (!s || !s.z.prospect[id]) { location.hash = '#prospect'; return; }
  const z = s.z, p = normStato(z.prospect[id]), a = z.attivita[p.pid] || {};
  const m = p.pid && z.punti && z.punti.length && z.attivita[p.pid] ? L.metriche(z, p.pid) : null;
  const reg = registro(zid, id);
  const t = p.telefono || a.t, sito = p.sito || a.w;
  const nav = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent((p.indirizzo || a.a || p.nome))}`;
  const an = m ? L.analisi(z, p) : null;
  const sel = (campo, opz, val, et = (o) => o) => `<select data-c="${campo}">${['', ...opz].map((o) => `<option value="${esc(o)}" ${o === val ? 'selected' : ''}>${esc(o ? et(o) : '')}</option>`).join('')}</select>`;
  const inp = (campo, lab, tipo = 'text') => `<label class="f">${lab}<input data-c="${campo}" type="${tipo}" value="${esc(p[campo] ?? '')}"></label>`;
  const html = `
  <div class="riga"><span class="pill ${prioClasse(p)}">${prioHtml(p.priorita)}</span><span class="sub">${esc(z.meta.quartiere)} · ${esc(p.segmento || '')} · ${esc(p.id)}</span></div>
  <div class="badges">${badgeSito(z, p)}${badgePG(p)}</div>
  <div class="box pg-box"><div class="riga"><b>PagineGialle</b><a class="btn mini" href="${urlPG(z, p)}" target="_blank" rel="noopener">Cerca su PagineGialle ↗</a></div>
  <div class="scelte">${Object.entries(PG).map(([k, v]) => `<button class="chip ${p.pg === k ? 'on' : ''}" data-pg="${k}">${k === 'assente' ? 'Assente' : k === 'base' ? 'Scheda base' : 'Scheda evoluta'}</button>`).join('')}</div></div>
  ${nonRiv(z, p) ? `<div class="allerta"><svg viewBox="0 0 24 24"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17.5v.5"/></svg><div><b>Scheda Google non rivendicata dal titolare</b><span>Nessuno la gestisce: non può rispondere alle recensioni né correggere orari e categoria. È il primo gancio da usare.</span></div></div>` : ''}
  <div class="azioni">
    <a class="btn" ${t ? `href="tel:${tel(t)}"` : 'aria-disabled="true"'}>${ico('tel')}Chiama</a>
    <a class="btn" ${t ? `href="https://wa.me/${wa(t)}" target="_blank" rel="noopener"` : 'aria-disabled="true"'}>${ico('wa')}WhatsApp</a>
    <a class="btn" href="${nav}" target="_blank" rel="noopener">${ico('map')}Naviga</a>
    <a class="btn" ${sito ? `href="${/^https?:/.test(sito) ? esc(sito) : 'https://' + esc(sito)}" target="_blank" rel="noopener"` : 'aria-disabled="true"'}>${ico('web')}Sito</a>
  </div>
  <button class="btn pri" style="width:100%" id="registra">Registra contatto</button>
  ${reg.length ? `<div class="box ultimo-box"><div class="riga"><span class="eb" style="margin:0">Ultimo contatto</span><span class="data">${gg(reg[0].data)} · ${esc(canaleT(reg[0].canale))}</span></div>
    <div class="scelte" style="margin-top:6px">${esitiDi(reg[0]).map((e) => `<span class="chip on">${esc(e)}</span>`).join('')}</div>
    ${reg[0].interlocutore ? `<div class="sub">con ${esc(reg[0].interlocutore)}</div>` : ''}${reg[0].emerso ? `<div>${esc(reg[0].emerso)}</div>` : ''}
    ${reg.length > 1 ? `<a class="sub" href="#" id="vaiRegistro">Tutti i ${reg.length} contatti ↓</a>` : ''}</div>` : ''}
  <div class="box">
    <div class="eb" style="margin-top:0">Prossima azione</div>
    <label class="f">Stato${sel('stato', STATI, p.stato)}</label>
    <label class="f">Cosa fare<input data-c="prossima" value="${esc(p.prossima)}"></label>
    <div class="due"><label class="f">Entro il<input data-c="data_prossima" type="date" value="${esc(p.data_prossima)}"></label>
    <label class="f">Priorità${sel('priorita', PRIORITA, p.priorita, prioTesto)}</label></div>
    <div class="scelte">${[0, 1, 3, 7].map((n) => `<button class="chip" data-quando="${n}">${n === 0 ? 'Oggi' : n === 1 ? 'Domani' : '+' + n + ' gg'}</button>`).join('')}</div>
  </div>
  ${m ? `${sezioneAI(z, p)}<div class="eb">Google Maps · «${esc(z.meta.keyword)}»</div>
  <div class="stat"><div><span>tra le prime 3</span><b class="c-${L.colorePct(L.pct(m.top3, m.N))}">${m.top3}/${m.N}<small>${L.pct(m.top3, m.N)}%</small></b></div>
  <div><span>recensioni ${L.virgola(a.r)}</span><b>${a.rv ?? '—'}</b></div></div>
  <div class="mt">${minigriglia(z, p.pid)}</div>
  ${an ? `<div class="box classifica"><b>${esc(an.list_title)}</b><table class="cl">${an.list.map(([r, n, rv, me]) => `<tr class="${me ? 'me' : ''}"><td>${r || '20+'}</td><td>${esc(n)}</td><td style="text-align:right" class="mono">${esc(rv)}</td></tr>`).join('')}</table></div>` : ''}` : '<div class="avviso mt">Attività non presente nella scansione della zona: niente metriche né report.</div>'}
  <div class="eb" id="registroP">Registro (${reg.length})</div>
  ${reg.map((r) => `<div class="reg"><div class="riga"><b>${esc(r.esito || r.canale)}</b><span class="data">${gg(r.data)} · ${esc(canaleT(r.canale))}</span></div>
     ${r.interlocutore ? `<div class="sub">con ${esc(r.interlocutore)}</div>` : ''}${r.emerso ? `<div>${esc(r.emerso)}</div>` : ''}${r.prossima ? `<div class="sub">→ ${esc(r.prossima)} ${r.entro ? 'entro ' + esc(gg(r.entro)) : ''}</div>` : ''}
     <div class="reg-az"><button class="btn mini" data-rmod="${esc(r.id)}">Modifica</button><button class="btn mini neg-t" data-rdel="${esc(r.id)}">Elimina</button></div></div>`).join('') || '<div class="sub">Nessun contatto registrato.</div>'}
  <div class="eb">Giro</div>
  ${p.giro && p.giro.data
    ? `<div class="riga"><span>Nel giro del <b>${esc(ggLungo(p.giro.data))}</b> · tappa ${p.giro.ordine || '—'}${p.giro.fatto ? ' · <span class="stato-tappa consegnata">✓ Consegnato</span>' : ''}</span><button class="btn mini" id="pGiroVia">Togli dal giro</button></div>`
    : `<div class="avviso">Non è in nessun giro: il PDF del giro stampa solo le tappe del giro.</div>
  <div class="riga mt"><input type="date" id="pGiroData" value="${esc(dataGiroProposta())}" style="width:auto"><button class="btn mini" id="pGiroAgg">Aggiungi al giro</button></div>`}
  ${an ? `<label class="f mt"><input type="checkbox" data-r="includi" ${p.report && p.report.includi === false ? '' : 'checked'} style="display:inline;width:auto;margin-right:6px">Includi nel PDF del giro</label>
  ` : ''}
  <div class="eb">Dati</div>
  ${inp('nome', 'Nome')}${inp('referente', 'Referente')}
  <label class="f">Partita IVA<input data-c="piva" inputmode="numeric" autocomplete="off" maxlength="24" value="${esc(p.piva || '')}"></label>
  <div class="sub" id="pivaNota">${p.piva ? (pivaValida(p.piva) ? `✓ P.IVA valida${p.piva_fonte === 'sito' ? ' · trovata sul sito' : ''}` : '<span class="c-neg">P.IVA non valida: controlla le cifre</span>') : 'Si compila da sola se è scritta sul sito; altrimenti inseriscila a mano.'}</div>
  <div class="due">${inp('telefono', 'Telefono', 'tel')}${inp('email', 'Email', 'email')}</div>
  ${inp('indirizzo', 'Indirizzo')}${inp('sito', 'Sito')}
  <div class="due"><label class="f">Prodotto proposto${sel('prodotto', PRODOTTI, p.prodotto)}</label>${inp('valore', 'Valore proposta (€)', 'number')}</div>
  <div class="due"><label class="f">Segmento${sel('segmento', ['Indipendente', 'Franchising'], p.segmento)}</label>${inp('visita_entro', 'Visita entro', 'date')}</div>
  <label class="f">Gancio commerciale<textarea data-c="gancio">${esc(p.gancio)}</textarea></label>
  <label class="f">Note<textarea data-c="note">${esc(p.note)}</textarea></label>
  <div class="row mt"><button class="btn mini" id="elimina" style="color:var(--neg)">Elimina prospect</button></div>
  <div class="barra-salva"><button class="btn annulla neutro" id="annulla">Chiudi</button><button class="btn pri" id="salva" disabled>Nessuna modifica</button></div>`;
  const D = {}, DR = {}; let DB = null, sporco = false;
  const segna = () => { sporco = true; statoBarra(f, 'sporco'); };
  const salva = () => {
    if (!sporco) return;
    const pf = ST.zone[zid].z.prospect[id];   // versione aggiornata: una sincronizzazione può averla sostituita mentre la scheda era aperta
    const campi = { ...D }; if (Object.keys(DR).length) campi.report = { ...(pf.report || {}), ...DR };
    if ('nome' in campi) campi.nome = maiuscole(campi.nome);
    if ('referente' in campi) campi.referente = maiuscole(campi.referente, true);
    if ('piva' in campi) {
      campi.piva = pulisciPiva(campi.piva); campi.piva_fonte = 'manuale';
      if (campi.piva && !pivaValida(campi.piva)) { toast('P.IVA non valida: correggila o lasciala vuota'); const el = $('[data-c=piva]'); if (el) el.focus(); return false; }
    }
    aggiorna(zid, id, campi);
    const za = ST.zone[zid].z; if (DB !== null && za.attivita[p.pid]) { za.attivita[p.pid].b = DB; za.attivita[p.pid].u = nuovoU(za.attivita[p.pid]); modificato(zid); }
    sporco = false;
  };
  const esci = () => { const dest = ST.indietro || '#prospect'; if (location.hash === dest) { chiudiFoglio(); render(); } else location.hash = dest; };
  const annulla = () => { if (sporco && !confirm('Annullare le modifiche non salvate?')) return; sporco = false; esci(); };
  const f = apriFoglio(p.nome, html, annulla);
  f.querySelectorAll('[data-c]').forEach((el) => el.addEventListener('input', () => {
    D[el.dataset.c] = el.type === 'number' ? Number(el.value || 0) : el.value; segna();
    if (el.dataset.c === 'piva') { const n = pulisciPiva(el.value); const nota = $('#pivaNota', f); if (nota) nota.innerHTML = !n ? '' : pivaValida(n) ? '✓ P.IVA valida' : n.length < 11 ? `${n.length} cifre su 11` : '<span class="c-neg">P.IVA non valida: controlla le cifre</span>'; }
    if (el.dataset.c === 'nome') f.querySelector('.testa h2').textContent = el.value;
  }));
  f.querySelectorAll('[data-c]').forEach((el) => el.tagName === 'SELECT' && el.addEventListener('change', () => { D[el.dataset.c] = el.value; segna(); }));
  f.querySelectorAll('[data-r]').forEach((el) => el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
    DR[el.dataset.r] = el.type === 'checkbox' ? el.checked : el.value; segna();
  }));
  const gAgg = $('#pGiroAgg', f); if (gAgg) gAgg.onclick = () => {
    const d = $('#pGiroData', f).value; if (!d) { toast('Scegli la data del giro'); return; }
    if (salva() === false) return;
    const campi = { giro: { data: d, ordine: prossimoOrdine(zid, d), orario: '', fatto: false } };
    if (p.report && p.report.includi === false) campi.report = { ...p.report, includi: true };   // aggiunto al giro per stamparlo
    aggiorna(zid, id, campi); apriProspect(zid, id, { salvato: 'Aggiunto al giro del ' + gg(d) });
  };
  const gVia = $('#pGiroVia', f); if (gVia) gVia.onclick = () => {
    if (salva() === false) return;
    const d = p.giro.data; aggiorna(zid, id, { giro: {} }); rinumera(zid, d); modificato(zid); apriProspect(zid, id, { salvato: 'Tolto dal giro del ' + gg(d) });
  };
  f.querySelectorAll('[data-pg]').forEach((el) => (el.onclick = () => {
    const v = (D.pg ?? p.pg) === el.dataset.pg ? '' : el.dataset.pg;   // secondo tocco: torna da verificare
    D.pg = v; f.querySelectorAll('[data-pg]').forEach((b) => b.classList.toggle('on', b.dataset.pg === v)); segna();
  }));
  f.querySelectorAll('[data-quando]').forEach((el) => (el.onclick = () => { const d = piuGiorni(+el.dataset.quando); f.querySelector('[data-c=data_prossima]').value = d; D.data_prossima = d; segna(); }));
  const br = $('#breve', f); if (br) br.oninput = () => { DB = br.value; segna(); };
  const bz = $('#bozza', f); if (bz) bz.onclick = () => {
    const b = L.bozza(z, { ...p, report: { ...p.report, ...DR, titolo: '', cosa: '' } });
    f.querySelector('[data-r=titolo]').value = b.titolo; f.querySelector('[data-r=cosa]').value = b.cosa;
    Object.assign(DR, { titolo: b.titolo, cosa: b.cosa, titolo_lista: '', punto: null }); segna(); toast('Bozza pronta: premi Salva per tenerla');
  };
  // salva e resta sulla scheda: il pulsante conferma l'ora del salvataggio, l'indicatore in alto mostra l'invio a GitHub
  $('#salva', f).onclick = () => {
    if (salva() === false) return;
    for (const k of Object.keys(D)) delete D[k]; for (const k of Object.keys(DR)) delete DR[k]; DB = null;
    statoBarra(f, 'salvato');
  };
  if (opz.salvato) statoBarra(f, 'salvato', opz.salvato);
  $('#annulla', f).onclick = annulla;
  if ($('#vaiRegistro', f)) $('#vaiRegistro', f).onclick = (e) => { e.preventDefault(); $('#registroP', f).scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  // registro: correggere o eliminare un contatto invece di registrarlo di nuovo
  f.querySelectorAll('[data-rmod]').forEach((b) => (b.onclick = () => { if (salva() !== false) formContatto(zid, id, { modifica: b.dataset.rmod }); }));
  f.querySelectorAll('[data-rdel]').forEach((b) => (b.onclick = () => {
    const za = ST.zone[zid].z, r = za.registro[b.dataset.rdel]; if (!r) return;
    if (!confirm(`Eliminare il contatto del ${gg(r.data)} (${esitiDi(r).join(', ')})? Stato e prossima azione della scheda non cambiano.`)) return;
    za.registro[r.id] = { ...r, del: true, u: nuovoU(r) }; modificato(zid);
    if (salva() !== false) apriProspect(zid, id, { salvato: 'Contatto eliminato' });
  }));
  $('#registra', f).onclick = () => { if (salva() !== false) formContatto(zid, id); };
  $('#elimina', f).onclick = () => {
    const g = p.giro && p.giro.data ? p.giro.data : '';
    if (!confirm(`Eliminare ${p.nome}?${g ? ` Esce anche dal giro del ${gg(g)} e le altre tappe si rinumerano.` : ''} Il registro resta nello storico del repository.`)) return;
    sporco = false; aggiorna(zid, id, { del: true });
    if (g) { rinumera(zid, g); modificato(zid); }   // niente buchi nella numerazione delle tappe e del PDF
    location.hash = '#prospect';
  };
}

/* ---------- registra contatto: un solo modulo aggiorna registro, stato e prossima azione ---------- */
function formContatto(zid, id, preset = {}) {
  let p = ST.zone[zid].z.prospect[id];
  const fresco = () => (p = ST.zone[zid].z.prospect[id] || p);   // dopo una sincronizzazione il record in memoria è un altro oggetto
  // esiti a scelta multipla: stato e prossima azione seguono il più avanzato (l'ultimo nell'elenco ESITI)
  const rm = preset.modifica ? (ST.zone[zid].z.registro || {})[preset.modifica] : null;   // contatto da correggere
  const v = rm ? { canale: canaleT(rm.canale) || 'Telefono', esiti: esitiDi(rm).slice(), interlocutore: rm.interlocutore || '', emerso: rm.emerso || '', prossima: rm.prossima || '', entro: rm.entro || '', stato: p.stato, data: rm.data || oggi() }
    : { canale: preset.canale || 'Telefono', esiti: preset.esito ? [preset.esito] : [], interlocutore: p.referente || '', emerso: '', prossima: '', entro: '', stato: p.stato, data: oggi() };
  // la scheda (stato, prossima azione) segue la modifica solo se il contatto corretto è il più recente
  let toccato = false;
  const ePiuRecente = () => !rm || (registro(zid, id)[0] || {}).id === rm.id;
  const peso = (e) => { const st = ESITO_STATO[e] || (e === 'Chiuso' ? 'Contattato' : undefined); return (st && /^Chiuso/.test(st) ? 100 : STATI.indexOf(st)) * 100 + ESITI.indexOf(e); };
  const principale = () => v.esiti.slice().sort((a, b) => peso(a) - peso(b)).pop() || '';
  const proponi = () => {
    fresco(); const e = principale(); v.stato = statoDaEsito(p.stato, e);
    const az = ESITO_AZIONE[e]; if (az) { v.prossima = az[0]; v.entro = piuGiorni(az[1], v.data); } else { v.prossima = ''; v.entro = ''; }
  };
  if (!rm) proponi();
  const ch = (k, arr) => `<div class="scelte">${arr.map((o) => `<button class="chip ${(k === 'esito' ? v.esiti.includes(o) : v[k] === o) ? 'on' : ''}" data-k="${k}" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
  const disegna = () => {
    fresco();
    const prec = rm ? null : registro(zid, id)[0];
    const f = apriFoglio((rm ? 'Modifica contatto · ' : 'Contatto · ') + p.nome, `
    ${rm ? `<div class="box ultimo-box" style="margin-top:0"><b>Stai correggendo il contatto del ${gg(rm.data)}</b><div class="sub">${ePiuRecente() ? 'È il più recente: stato e prossima azione della scheda seguono la correzione.' : 'Non è il più recente: cambia solo questa voce del registro, la scheda resta com\'è.'}</div></div>` : ''}
    ${prec ? `<div class="box ultimo-box" style="margin-top:0"><div class="riga"><span class="eb" style="margin:0">Contatto precedente</span><span class="data">${gg(prec.data)} · ${esc(canaleT(prec.canale))}</span></div>
      <div class="scelte" style="margin-top:6px">${esitiDi(prec).map((e) => `<span class="chip on">${esc(e)}</span>`).join('')}</div>
      ${prec.interlocutore ? `<div class="sub">con ${esc(prec.interlocutore)}</div>` : ''}${prec.emerso ? `<div>${esc(prec.emerso)}</div>` : ''}
      <div class="sub">Stato ora: ${esc(p.stato)}${p.prossima ? ' · → ' + esc(p.prossima) : ''}</div></div>` : ''}
    <label class="f">Canale</label>${ch('canale', CANALI)}
    <label class="f">Esito <span class="sub">(anche più di uno)</span></label>${ch('esito', ESITI)}
    <div class="due"><label class="f">Data<input id="cData" type="date" value="${v.data}"></label><label class="f">Interlocutore<input id="cInt" value="${esc(v.interlocutore)}"></label></div>
    <label class="f">Cosa è emerso<textarea id="cEm">${esc(v.emerso)}</textarea></label>
    <div class="box"><div class="eb" style="margin-top:0">${rm && !ePiuRecente() ? 'Prossima azione annotata in questo contatto' : 'Dopo questo contatto'}</div>
    <label class="f">Prossima azione<input id="cPr" value="${esc(v.prossima)}"></label>
    <div class="due"><label class="f">Entro il<input id="cEn" type="date" value="${v.entro}"></label>
    <label class="f" ${rm && !ePiuRecente() ? 'style="display:none"' : ''}>Nuovo stato<select id="cSt">${STATI.map((s) => `<option value="${esc(s)}" ${s === v.stato ? 'selected' : ''}>${s}</option>`).join('')}</select></label></div><div class="sub" id="cStNota"></div></div>
    <div class="barra-salva"><button class="btn annulla" id="annullaC">Annulla</button><button class="btn pri" id="salva">Salva contatto</button></div>`, () => annullaC());
    const sporcoC = () => (rm ? toccato : v.esiti.length > 0 || !!v.emerso.trim());
    const annullaC = () => {
      leggi(); if (sporcoC() && !confirm('Uscire senza salvare il contatto?')) return;
      if (preset.ritorno) { location.hash = preset.ritorno; chiudiFoglio(); render(); } else apriProspect(zid, id);
    };
    const aggiornaBarra = () => (rm && !toccato ? statoBarra(f, 'vuoto', 'Nessuna modifica') : v.esiti.length ? statoBarra(f, 'sporco', rm ? 'Salva correzione' : 'Salva contatto') : (statoBarra(f, sporcoC() ? 'sporco' : 'vuoto', 'Scegli almeno un esito'), ($('#salva', f).disabled = true)));
    // avviso se il nuovo stato torna indietro rispetto a quello attuale
    const avvisoStato = () => { const n = $('#cStNota', f); if (!n) return; const st = $('#cSt', f).value; n.innerHTML = !CHIUSI.includes(st) && STATI.indexOf(st) < STATI.indexOf(p.stato) ? `<span class="c-neg">Lo stato torna indietro: da «${esc(p.stato)}» a «${esc(st)}»</span>` : ''; };
    $('#annullaC').onclick = annullaC;
    aggiornaBarra(); avvisoStato();
    $('#cSt', f).onchange = avvisoStato;
    $('#cEm', f).oninput = () => { v.emerso = $('#cEm', f).value; toccato = true; aggiornaBarra(); };
    ['#cData', '#cInt', '#cPr', '#cEn', '#cSt'].forEach((q) => { const el = $(q, f); if (el) el.addEventListener('input', () => { toccato = true; aggiornaBarra(); }); });
    const leggi = () => { v.data = $('#cData').value; v.interlocutore = $('#cInt').value; v.emerso = $('#cEm').value; v.prossima = $('#cPr').value; v.entro = $('#cEn').value; v.stato = $('#cSt').value; };
    f.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => {
      leggi(); toccato = true;
      if (b.dataset.k === 'esito') { // tocco = aggiungi o togli; proposta automatica, modificabile
        const o = b.dataset.v; v.esiti = v.esiti.includes(o) ? v.esiti.filter((x) => x !== o) : [...v.esiti, o];
        proponi();
      } else v[b.dataset.k] = b.dataset.v;
      disegna();
    }));
    $('#salva').onclick = () => {
      leggi(); fresco(); if (!v.esiti.length) { toast('Scegli almeno un esito'); return; }
      if (!v.data) v.data = oggi();   // su iPhone il campo data si può svuotare con "Reset"
      const esiti = v.esiti.slice().sort((a, b) => ESITI.indexOf(a) - ESITI.indexOf(b));
      const z = ST.zone[zid].z; z.registro = z.registro || {};
      const voce = { p: id, data: v.data, canale: v.canale, interlocutore: maiuscole(v.interlocutore, true), esito: esiti.join(' · '), esiti, emerso: v.emerso, prossima: v.prossima, entro: v.entro };
      if (rm) {
        const att = z.registro[rm.id] || rm; z.registro[rm.id] = { ...att, ...voce, u: nuovoU(att) };
        if (!ePiuRecente()) { modificato(zid); apriProspect(zid, id, { salvato: 'Contatto corretto' }); return; }
      } else { const rid = uid(); z.registro[rid] = { id: rid, ...voce, u: ora() }; }
      const campi = { stato: v.stato, prossima: CHIUSI.includes(v.stato) ? '' : v.prossima, data_prossima: CHIUSI.includes(v.stato) ? '' : v.entro };
      if (v.interlocutore && !p.referente) campi.referente = maiuscole(v.interlocutore, true);
      // la tappa è consegnata solo se il contatto è del giorno del giro o successivo: un contatto passato registrato dal giro non la chiude
      if (preset.giro && p.giro && p.giro.data && v.data >= p.giro.data) campi.giro = { ...p.giro, fatto: true, fatto_il: v.data };
      aggiorna(zid, id, campi);
      if (preset.ritorno) { toast('✓ Contatto salvato alle ' + oraAdesso()); location.hash = preset.ritorno; chiudiFoglio(); render(); } else apriProspect(zid, id, { salvato: rm ? 'Contatto corretto' : 'Contatto salvato' });
    };
  };
  disegna();
}

/* ---------- vista: giro ---------- */
/* ---------- mappa del giro (Leaflet, caricato solo quando serve) ---------- */
let _leaflet = null;
function caricaLeaflet() {
  if (_leaflet) return _leaflet;   // Leaflet usa anch'esso window.L: con noConflict() torna la nostra logica.js
  _leaflet = new Promise((ok, ko) => {
    if (!document.querySelector('link[data-leaflet]')) { const css = document.createElement('link'); css.dataset.leaflet = '1'; css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(css); }
    const js = document.createElement('script'); js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    js.onload = () => { const LL = window.L && window.L.noConflict ? window.L.noConflict() : null; LL ? ok(LL) : (_leaflet = null, ko(new Error('mappa non disponibile'))); }; js.onerror = () => { _leaflet = null; ko(new Error('mappa non disponibile offline')); }; document.head.appendChild(js);
  });
  return _leaflet;
}
async function disegnaMappaGiro() {
  const box = $('#mappaGiro'); const pts = ST.mappaGiro || [];
  if (!box || !pts.length) return;
  let L0; try { L0 = await caricaLeaflet(); } catch (e) { box.innerHTML = `<div class="vuoto">${esc(e.message)}</div>`; return; }
  if (!document.body.contains(box) || box._leaflet_id) return;   // vista cambiata durante il caricamento, o mappa già pronta
  if (ST.mappaL) { try { ST.mappaL.remove(); } catch (e) { /* contenitore già sostituito */ } }
  const m = ST.mappaL = L0.map(box, { zoomControl: false, attributionControl: true, scrollWheelZoom: false, dragging: !L0.Browser.mobile });
  L0.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
  const ordinati = pts;   // già in ordine di lista, numerati come la lista
  for (const zid of new Set(pts.map((p) => p.zid))) L0.polyline(pts.filter((p) => p.zid === zid).map((p) => [p.la, p.lo]), { color: '#18232A', weight: 2, opacity: .45, dashArray: '4 6' }).addTo(m);
  for (const p of ordinati) {
    const icona = L0.divIcon({ className: '', html: `<span class="mg-pin ${p.ni ? 'ni' : p.rc ? 'rc' : p.fatto ? 'fatto' : p.rip ? 'rip' : p.vis ? 'vis' : ''}">${p.ni ? '✕' : p.fatto && !p.rc ? '✓' : esc(String(p.n || ''))}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] });
    L0.marker([p.la, p.lo], { icon: icona, title: p.nome, keyboard: true }).addTo(m).on('click', () => { location.hash = `#p/${p.zid}/${p.id}`; });
  }
  m.fitBounds(L0.latLngBounds(ordinati.map((p) => [p.la, p.lo])).pad(0.15), { maxZoom: 17 });
}
function vGiro() {
  const tt = tutti().filter((x) => x.p.giro && x.p.giro.data);
  // nel menu delle date restano i giri da fare: una data passata con tutte le tappe consegnate
  // (es. dopo «Sposta giro», dove le consegnate restano alla data vecchia) sparisce; si riapre dal campo data
  const og = oggi();
  // all'apertura, al cambio di giorno e dopo una lunga pausa il giro riparte da oggi
  // con oggi vuoto si apre direttamente il prossimo giro con tappe da fare
  if (ST.giroGiorno !== og || !ST.giroData) {
    const prossimo = tt.filter((x) => x.p.giro.data > og && !x.p.giro.fatto && aperto(x.p)).map((x) => x.p.giro.data).sort()[0];
    ST.giroData = tt.some((x) => x.p.giro.data === og) || !prossimo ? og : prossimo;
    // la scelta diventa definitiva solo quando i dati sono arrivati (al primo disegno le zone possono essere ancora vuote)
    if (Object.keys(ST.zone).length) ST.giroGiorno = og;
  }
  const date = [...new Set(tt.filter((x) => x.p.giro.data >= og || (!x.p.giro.fatto && aperto(x.p))).map((x) => x.p.giro.data))];
  // oggi c'è sempre; la data scelta dal campo resta visibile finché è selezionata
  for (const x of [og, ST.giroData]) if (!date.includes(x)) date.push(x);
  date.sort();
  const d = ST.giroData;
  // tappe ancora da fare per data, per il numero sulle date
  // numero sulle date: tappe ancora da visitare, con la stessa regola del filtro «Visitare»
  const daFare = {}; tt.forEach((x) => { const g = x.p.giro.data; if (!x.p.giro.fatto && aperto(x.p) && inLavoro(x) && !registro(x.zid, x.p.id).some((r) => r.data === g)) daFare[g] = (daFare[g] || 0) + 1; });
  const domani = new Date(og + 'T12:00'); domani.setDate(domani.getDate() + 1); const dm = domani.toISOString().slice(0, 10);
  const etichettaData = (x) => (x === og ? 'Oggi' : x === dm ? 'Domani' : ggLungo(x)) + (daFare[x] ? ` · ${daFare[x]}` : '');
  const prossima = date.find((x) => x > og && daFare[x]);
  const tutte = tt.filter((x) => x.p.giro.data === d).sort((a, b) => a.zid.localeCompare(b.zid) || (a.p.giro.ordine || 99) - (b.p.giro.ordine || 99));
  // numero di tappa fisso (posizione nel giro della zona), anche quando i filtri nascondono qualcosa
  const numTappa = {}; const cont = {}; tutte.forEach((x) => (numTappa[x.zid + '|' + x.p.id] = cont[x.zid] = (cont[x.zid] || 0) + 1));
  const fg = ST.fg;
  const contattata = (x) => registro(x.zid, x.p.id).some((r) => r.data === d);
  // da ripassare: tappa non consegnata con ultimo esito Chiuso/Ripassare, o prossima azione "Ripassare"
  const daRipassare = (x) => ripassare(x.z, x.p);
  // una sola etichetta per tappa, la più importante; l'esito si legge nella riga "Ultimo contatto"
  const etichettaTappa = (x) => nonInteressato(x.z, x.p) ? '<span class="stato-tappa ni">✕ Non interessato</span>'
    : reportCompleto(x.z, x.p) ? '<span class="stato-tappa rc">Report completo</span>'
    : x.p.giro.fatto ? `<span class="stato-tappa consegnata">✓ Consegnato${x.p.giro.fatto_il ? ' il ' + gg(x.p.giro.fatto_il) : ''}</span>`
    : daRipassare(x) ? '<span class="stato-tappa ripassare">↻ Ripassare</span>'
    : contattata(x) ? '<span class="stato-tappa visitata">✓ Visitato</span>' : '<span class="stato-tappa">Visitare</span>';
  const passa = (x) => (fg.tappa === 'ni' || inLavoro(x)) && (!fg.tappa || (fg.tappa === 'da' ? !x.p.giro.fatto && !contattata(x) : fg.tappa === 'ripassare' ? daRipassare(x) : fg.tappa === 'rc' ? reportCompleto(x.z, x.p) : fg.tappa === 'ni' ? nonInteressato(x.z, x.p) : fg.tappa === 'fatte' ? x.p.giro.fatto : fg.tappa === 'contattate' ? contattata(x) && !x.p.giro.fatto : true))
    && (!fg.prio || x.p.priorita === fg.prio) && (!fg.nr || nonRiv(x.z, x.p)) && (!fg.pg || x.p.pg === 'assente');
  const tappe = tutte.filter(passa);
  const perZona = {}; tutte.forEach((x) => (perZona[x.zid] = perZona[x.zid] || [])); tappe.forEach((x) => perZona[x.zid].push(x));
  // conteggi dei filtri sulle tappe in lavoro; i non interessati si contano solo nel loro filtro
  const nF = (fn) => tutte.filter((x) => inLavoro(x) && fn(x)).length; const nNI = tutte.length - nF(() => true);
  const chipG = (k, v, lab) => `<button class="chip ${fg[k] === v ? 'on' : ''}" data-fg="${k}" data-v="${esc(v)}">${lab}</button>`;
  const filtriGiro = tutte.length ? `<div class="filtri mt">${chipG('tappa', '', `Tutte (${nF(() => true)})`)}${chipG('tappa', 'da', `Visitare (${nF((x) => !x.p.giro.fatto && !contattata(x))})`)}${chipG('tappa', 'contattate', `Contattate (${nF((x) => contattata(x) && !x.p.giro.fatto)})`)}${nF((x) => reportCompleto(x.z, x.p)) ? chipG('tappa', 'rc', `Report completo (${nF((x) => reportCompleto(x.z, x.p))})`) : ''}${nNI ? chipG('tappa', 'ni', `Non interessati (${nNI})`) : ''}${nF(daRipassare) ? chipG('tappa', 'ripassare', `Ripassare (${nF(daRipassare)})`) : ''}${chipG('tappa', 'fatte', `Consegnate (${nF((x) => x.p.giro.fatto)})`)}</div>
  <div class="filtri">${chipG('prio', '', 'Ogni priorità')}${PRIORITA.filter((s) => tutte.some((x) => x.p.priorita === s)).map((s) => chipG('prio', s, prioHtml(s))).join('')}<button class="chip chip-nr ${fg.nr ? 'on' : ''}" data-fgt="nr">Non rivendicate (${nF((x) => nonRiv(x.z, x.p))})</button><button class="chip chip-pg ${fg.pg ? 'on' : ''}" data-fgt="pg">Assenti su PG (${nF((x) => x.p.pg === 'assente')})</button></div>
  ${fg.tappa !== 'ni' && tappe.length < nF(() => true) ? `<div class="sub" style="margin:2px 0 4px">${tappe.length} di ${nF(() => true)} tappe con questi filtri</div>` : ''}` : '';
  const indirizzi = tappe.filter((x) => !x.p.giro.fatto && inLavoro(x)).map((x) => x.p.indirizzo || (x.z.attivita[x.p.pid] || {}).a).filter(Boolean);
  // anteprima su mappa: tappe con coordinate, numerate come nella lista
  ST.mappaGiro = tappe.map((x) => { const a = x.z.attivita[x.p.pid] || {}; const n = numTappa[x.zid + '|' + x.p.id]; return a.la && a.lo ? { zid: x.zid, id: x.p.id, n, nome: x.p.nome, fatto: !!x.p.giro.fatto, rip: daRipassare(x), rc: reportCompleto(x.z, x.p), ni: nonInteressato(x.z, x.p), vis: contattata(x), la: a.la, lo: a.lo } : null; }).filter(Boolean);
  const senzaCoord = tappe.length - ST.mappaGiro.length;
  const percorso = (arr) => { const dest = arr[arr.length - 1]; const wp = arr.slice(0, -1).slice(0, 9); return `https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=${encodeURIComponent(dest)}${wp.length ? '&waypoints=' + encodeURIComponent(wp.join('|')) : ''}`; };
  return `<div class="barra-giro"><input type="date" id="gData" class="cerca" value="${d}"><button class="btn" id="gAgg">+ Tappa</button>${tutte.length ? '<button class="btn" id="gSposta">Sposta…</button>' : ''}</div>
  <div class="filtri mt date-giro">${date.map((x) => `<button class="chip ${x === d ? 'on' : ''} ${x < og ? 'arretrato' : ''}" data-gd="${esc(x)}" ${x < og ? 'title="Giro passato con tappe ancora da fare"' : ''}>${esc(etichettaData(x))}</button>`).join('')}</div>
  ${filtriGiro}
  ${tappe.length ? `<div class="row mt"><a class="btn ink" href="${indirizzi.length ? percorso(indirizzi) : '#giro'}" target="_blank" rel="noopener">${ico('map')} Percorso a piedi (${indirizzi.length} da visitare)</a></div>
  ${indirizzi.length > 10 ? '<div class="avviso">Google Maps accetta al massimo 10 tappe per percorso: le altre si aprono dalla singola tappa.</div>' : ''}` : ''}
  ${ST.mappaGiro.length ? `<div class="mappa-giro mt" id="mappaGiro" role="img" aria-label="Mappa delle tappe del giro"></div>
  <div class="sub mappa-legenda"><span class="mg-pin">1</span> visitare <span class="mg-pin vis">2</span> visitato <span class="mg-pin rip">3</span> ripassare <span class="mg-pin rc">4</span> report completo <span class="mg-pin ni">✕</span> non interessato <span class="mg-pin fatto">✓</span> consegnato${senzaCoord ? ` · ${senzaCoord} tappe senza posizione` : ''}</div>` : ''}
  ${Object.entries(perZona).map(([zid, arr]) => { const tutteZ = tutte.filter((x) => x.zid === zid); return `
    <div class="eb">${esc(ST.zone[zid].z.meta.quartiere)} · ${tutteZ.length} tappe pianificate · ${tutteZ.filter((x) => x.p.giro.fatto).length} consegnate</div>
    <div class="lista">${arr.map((x) => {
      const ind = x.p.indirizzo || (x.z.attivita[x.p.pid] || {}).a || '';
      const ref = [x.p.referente, x.p.telefono].filter(Boolean).join(' · ');
      return `<div class="card tappa ${classeCard(x.p)} ${x.p.giro.fatto ? 'ok-fatto' : ''}">
      <div class="tappa-testa"><span class="num">${x.p.giro.fatto ? '✓' : numTappa[zid + '|' + x.p.id]}</span>
      ${etichettaTappa(x)}
      ${x.p.report && x.p.report.includi === false ? '<span class="sub">senza report</span>' : ''}
      ${sceltaOra(`data-ora="${zid}|${x.p.id}"`, x.p.giro.orario || '')}
      <span class="ordine"><button data-su="${zid}|${x.p.id}" aria-label="Su">↑</button><button data-giu="${zid}|${x.p.id}" aria-label="Giù">↓</button></span></div>
      <a class="con-mappa" href="#p/${zid}/${x.p.id}">${miniMappa(x.z, x.p)}<div class="card-testo">${testoProspect(x.z, x.p, `<div class="sub ind">${esc(ind.split(',').slice(0, 2).join(','))}${ref ? ' · ' + esc(ref) : ''}</div>`, { senzaRC: true })}</div></a>
      <div class="row mt"><a class="btn mini" href="https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=${encodeURIComponent(ind)}" target="_blank" rel="noopener">Naviga</a>
      ${x.p.giro.fatto ? `<button class="btn mini" data-annulla="${zid}|${x.p.id}">Riapri tappa</button>` : `<button class="btn mini segna" data-fatto="${zid}|${x.p.id}">Segna consegnato</button>`}
      <button class="btn mini" data-togli="${zid}|${x.p.id}" title="Togli dal giro">✕</button></div></div>`;
    }).join('') || '<div class="vuoto">Nessuna tappa con questi filtri.</div>'}</div>
    ${(() => {
      // stessa selezione del PDF (tutte le tappe, filtri esclusi): solo le tappe presenti nella scansione e non escluse a mano
      const arr = tutteZ;
      const stampa = arr.filter((x) => x.p.pid && x.z.attivita[x.p.pid] && !(x.p.report && x.p.report.includi === false));
      const fuori = arr.filter((x) => !(x.p.pid && x.z.attivita[x.p.pid]));
      const ai = L.haAI(ST.zone[zid].z);
      // un solo pulsante: con la scansione AI Mode escono i fogli (uno per tappa), senza esce il report del giro
      return `<div class="box"><div class="riga"><b>Stampa del giro</b><span class="sub">${stampa.length} fogli A4${ai ? '' : ' · solo Google Maps'}</span></div>
      ${fuori.length ? `<div class="avviso">Senza pagina nel PDF perché non compaiono nella scansione: ${fuori.map((x) => esc(x.p.nome)).join(', ')}.</div>` : ''}
      <div class="row mt"><button class="btn pri" data-stampa="${zid}" ${ST.pdf[zid] ? 'disabled' : ''}>Genera PDF</button><span id="st-${zid}" class="sub">${ST.pdfMsg[zid] || ''}</span></div></div>`;
    })()}`; }).join('') || `<div class="vuoto">Nessuna tappa ${d === og ? 'oggi' : 'in questa data'}. Aggiungila con “+ Tappa”.${d === og && prossima ? `<div class="mt"><button class="btn" data-gd="${esc(prossima)}">Prossimo giro: ${esc(prossima === dm ? 'domani' : ggLungo(prossima))}</button></div>` : ''}</div>`}`;
}
/* sposta in blocco le tappe di un giro a un'altra data: tutte o solo quelle scelte */
function formSpostaGiro() {
  const da = ST.giroData;
  const tappe = tutti().filter((x) => x.p.giro && x.p.giro.data === da).sort((a, b) => (a.zid + String(a.p.giro.ordine).padStart(3, '0')).localeCompare(b.zid + String(b.p.giro.ordine).padStart(3, '0')));
  const f = apriFoglio('Sposta il giro del ' + ggLungo(da), `
  <label class="f">Nuova data<input type="date" id="sData" value="${piuGiorni(1, da > oggi() ? da : oggi())}"></label>
  <label class="f"><input type="checkbox" id="sAz" checked style="display:inline;width:auto;margin-right:6px">Sposta anche la prossima azione e la data "visita entro"</label>
  <div class="eb">Tappe da spostare</div>
  <div class="row" style="margin-bottom:6px"><button class="chip" id="sTutte">Tutte</button><button class="chip" id="sNessuna">Nessuna</button></div>
  <div class="lista">${tappe.map((x) => `<label class="card riga" style="cursor:pointer;opacity:${x.p.giro.fatto ? .55 : 1}"><span style="display:flex;gap:10px;align-items:center;min-width:0">
    <input type="checkbox" class="sCk" value="${esc(x.zid + '|' + x.p.id)}" ${x.p.giro.fatto ? 'disabled' : 'checked'} style="width:20px;height:20px">
    <span style="min-width:0"><span class="nome" style="display:block">${pallino(x.p.priorita)}${x.p.giro.ordine}. ${esc(x.p.nome)}</span><span class="sub">${esc(x.z.meta.quartiere)} · ${esc(x.p.giro.orario || '')}${x.p.giro.fatto ? ' · già consegnato' : ''}</span></span></span></label>`).join('')}</div>
  <div class="barra-salva"><button class="btn annulla neutro" id="sAnn">Chiudi</button><button class="btn pri" id="sOk">Sposta tappe</button></div>`, () => { chiudiFoglio(); render(); });
  const cks = () => [...f.querySelectorAll('.sCk:not(:disabled)')];
  $('#sTutte', f).onclick = () => cks().forEach((c) => (c.checked = true));
  $('#sNessuna', f).onclick = () => cks().forEach((c) => (c.checked = false));
  $('#sAnn', f).onclick = () => { chiudiFoglio(); render(); };
  $('#sOk', f).onclick = () => {
    const a = $('#sData', f).value; const scelte = cks().filter((c) => c.checked).map((c) => c.value.split('|'));
    if (!a || a === da) { toast('Scegli una data diversa'); return; }
    if (!scelte.length) { toast('Nessuna tappa selezionata'); return; }
    const delta = giorni(a) - giorni(da), conAz = $('#sAz', f).checked;
    const zone = new Set();
    for (const [zid, id] of scelte) {
      const z = ST.zone[zid].z, p = z.prospect[id];
      // le tappe spostate si accodano a quelle già previste nella nuova data
      p.giro = { ...p.giro, data: a, ordine: prossimoOrdine(zid, a) };
      const campi = ['giro'];
      if (conAz) {
        if (p.data_prossima === da) { p.data_prossima = a; campi.push('data_prossima'); }
        if (p.visita_entro) { p.visita_entro = piuGiorni(delta, p.visita_entro); campi.push('visita_entro'); }
      }
      tocca(p, ...campi); zone.add(zid);
    }
    // rinumera le tappe rimaste nella data di partenza
    for (const zid of zone) {
      Object.values(ST.zone[zid].z.prospect).filter((q) => !q.del && q.giro && q.giro.data === da).sort((x, y) => x.giro.ordine - y.giro.ordine)
        .forEach((q, i) => { if (q.giro.ordine !== i + 1) { q.giro = { ...q.giro, ordine: i + 1 }; tocca(q, 'giro'); } });
      modificato(zid);
    }
    ST.giroData = a; toast(`✓ ${scelte.length} tappe spostate al ${gg(a)} alle ${oraAdesso()}`); chiudiFoglio(); render();
  };
}
function spostaTappa(zid, id, dir) {
  const d = ST.giroData;
  const arr = tutti().filter((x) => x.zid === zid && x.p.giro && x.p.giro.data === d).sort((a, b) => (a.p.giro.ordine || 99) - (b.p.giro.ordine || 99));
  const i = arr.findIndex((x) => x.p.id === id), j = i + dir; if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  arr.forEach((x, k) => { if (x.p.giro.ordine !== k + 1) { x.p.giro = { ...x.p.giro, ordine: k + 1 }; tocca(x.p, 'giro'); } });
  modificato(zid); ST.restaScroll = true; render();
}
function scegliTappa() {
  const tt = tutti().filter((x) => aperto(x.p) && !(x.p.giro && x.p.giro.data === ST.giroData));
  const f = apriFoglio('Aggiungi al giro del ' + gg(ST.giroData), `<input class="cerca" id="tq" placeholder="Cerca…"><div class="lista mt" id="tl"></div>`, () => { chiudiFoglio(); render(); });
  const lista = () => { const q = $('#tq').value.toLowerCase(); $('#tl').innerHTML = tt.filter((x) => (x.p.nome || '').toLowerCase().includes(q)).map((x) => `<button class="card" style="text-align:left" data-add="${x.zid}|${x.p.id}"><div class="nome">${esc(x.p.nome)}</div><div class="sub">${esc(x.p.stato)} · ${esc(x.z.meta.quartiere)}</div></button>`).join(''); };
  $('#tq').oninput = lista; lista();
  f.addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]'); if (!b) return;
    const [zid, id] = b.dataset.add.split('|');
    const prima = ST.zone[zid].z.prospect[id].giro, da = prima && prima.data;
    aggiorna(zid, id, { giro: { data: ST.giroData, ordine: prossimoOrdine(zid, ST.giroData), orario: '', fatto: false } });
    if (da && da !== ST.giroData) { rinumera(zid, da); modificato(zid); }   // il giro di partenza non resta con un buco nei numeri
    b.remove(); toast(da && da !== ST.giroData ? `Aggiunto (tolto dal giro del ${gg(da)})` : 'Aggiunto');
  });
}
async function generaPdf(zid, tipo = 'giro') {
  if (ST.pdf[zid]) return;   // una richiesta alla volta per zona
  // lo stato vive in ST: se la vista si ricostruisce durante l'attesa il messaggio e il pulsante "Apri" restano
  const out = { set textContent(t) { scrivi(esc(t)); }, set innerHTML(h) { scrivi(h); } };
  const scrivi = (h) => { ST.pdfMsg[zid] = h; const o = $('#st-' + zid); if (o) o.innerHTML = h; };
  const blocca = (on) => { ST.pdf[zid] = on; const b = document.querySelector(`[data-stampa="${zid}"]`); if (b) b.disabled = on; };
  if (!GH.ok()) { toast('Serve il collegamento GitHub'); return; }
  const z = ST.zone[zid].z;
  const ps = tutti().filter((x) => x.zid === zid && x.p.giro && x.p.giro.data === ST.giroData && x.p.pid && z.attivita[x.p.pid] && !(x.p.report && x.p.report.includi === false))
    .sort((a, b) => (a.p.giro.ordine || 99) - (b.p.giro.ordine || 99)).map((x) => x.p);
  if (!ps.length) { toast('Nessuna analisi da stampare'); return; }
  const firma = ST.conf.firma && ST.conf.firma.nome ? ST.conf.firma : null;
  const job = tipo === 'fogli' ? L.jobFogli(z, ps, { data: oggi(), firma }) : L.jobStampa(z, ps, { data: z.meta.data, firma });
  blocca(true);
  try {
    out.textContent = 'Invio…';
    await invia(zid);
    const sha = await GH.sha(`zone/${zid}/stampa.json`);
    await GH.putJSON(`zone/${zid}/stampa.json`, job, sha, `Stampa giro ${ST.giroData}`);
    out.textContent = 'In generazione (circa un minuto)…';
    const t0 = ora();
    // attesa breve che si interrompe quando l'app torna in primo piano: il controllo riparte subito
    const pausa = (ms) => new Promise((ok) => {
      const fine = () => { clearTimeout(t); document.removeEventListener('visibilitychange', vis); ok(); };
      const vis = () => { if (!document.hidden) fine(); };
      const t = setTimeout(fine, ms); document.addEventListener('visibilitychange', vis);
    });
    while (ora() - t0 < 6 * 60000) {
      await pausa(6000);
      if (document.hidden) continue;
      const e = await GH.getJSON(`zone/${zid}/stampa/esito.json`).catch(() => null);
      out.textContent = `In generazione… (${Math.round((ora() - t0) / 1000)} s)`;
      if (e && e.data.richiesta === job.richiesta) {
        if (e.data.errore) { out.innerHTML = `<span class="c-neg">${esc(e.data.errore)}</span>`; return; }
        const av = (e.data.avvisi || []).map((a) => `<div class="avviso">${esc(a)}</div>`).join('');
        out.innerHTML = `<button class="btn mini ink" data-pdf="${zid}|${esc(e.data.file)}">Apri ${esc(e.data.file.split('/').pop())}</button>${av}`;
        const za = ST.zone[zid].z; if (tipo === 'giro') ps.forEach((p0) => { const p = za.prospect[p0.id]; if (p && !p.report_prodotto) { p.report_prodotto = oggi(); tocca(p, 'report_prodotto'); } }); modificato(zid);
        return;
      }
    }
    out.textContent = 'Ancora in coda: controlla tra poco da Zone → PDF.';
  } catch (e) { out.innerHTML = `<span class="c-neg">${esc(e.message)}</span>`; } finally { blocca(false); }
}
async function apriPdf(zid, file, w0) {
  // la finestra si apre subito, al tocco: su iPhone (Safari e Chrome) un'apertura dopo l'attesa del download viene bloccata
  const w = w0 || window.open('', '_blank');
  if (w && !w0) w.document.write('<p style="font:16px system-ui;padding:24px">Scarico il PDF…</p>');
  toast('Scarico il PDF…');
  try {
    const blob = await GH.getBlob(`zone/${zid}/${file}`); if (!blob) { toast('PDF non trovato'); if (w) w.close(); return; }
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    if (w) w.location.href = url;
    else { const a = document.createElement('a'); a.href = url; a.download = file.split('/').pop(); document.body.appendChild(a); a.click(); a.remove(); }
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  } catch (e) { if (w) w.close(); toast(e.message); }
}

/* ---------- vista: zone ---------- */
// cosa resta da fare in una zona: tappe da visitare e da ripassare, richiami scaduti o di oggi, prospect mai contattati,
// report completi da preparare, prossima data di giro; consegnati in coda. I non interessati e i chiusi non contano
function lavoroZona(z) {
  const og = oggi();
  const tutti = Object.values(z.prospect || {}).filter((p) => !p.del);
  const ap = tutti.filter((p) => aperto(p) && !nonInteressato(z, p));
  const rip = ap.filter((p) => ripassare(z, p));
  const vis = ap.filter((p) => p.giro && p.giro.data && !p.giro.fatto && p.giro.data >= og && !ripassare(z, p));
  // chi è già nel giro o da ripassare si conta lì, non tra i richiami
  const ric = ap.filter((p) => { const g = urgenza(p); return g !== null && g <= 0 && !vis.includes(p) && !rip.includes(p); });
  const scad = ric.filter((p) => urgenza(p) < 0).length;
  const nuovi = ap.filter((p) => p.stato === 'Da contattare' && !p.giro && !ultimoReg(z, p.id) && !p.data_prossima);
  const rc = ap.filter((p) => reportCompleto(z, p));
  const cons = tutti.filter((p) => p.giro && p.giro.fatto).length;
  const prox = ap.filter((p) => p.giro && p.giro.data && !p.giro.fatto && p.giro.data >= og).map((p) => p.giro.data).sort()[0];
  const pill = (cl, t) => `<span class="stato-tappa ${cl}">${t}</span>`;
  const out = [];
  if (vis.length) out.push(pill('', `Visitare · ${vis.length}`));
  if (rip.length) out.push(pill('ripassare', `↻ Ripassare · ${rip.length}`));
  if (ric.length) out.push(pill(scad ? 'ni' : 'ripassare', `Richiamare · ${ric.length}${scad ? ` (${scad} in ritardo)` : ''}`));
  if (rc.length) out.push(pill('rc', `${rc.length} report completo`));
  if (nuovi.length) out.push(pill('visitata', `${nuovi.length} mai ${nuovi.length === 1 ? 'contattato' : 'contattati'}`));
  if (!out.length) out.push(pill('', 'Niente in sospeso'));
  if (cons) out.push(pill('consegnata', `✓ ${cons} ${cons === 1 ? 'consegnato' : 'consegnati'}`));
  const giro = prox ? `<span class="sub">${prox === og ? 'Giro oggi' : 'Prossimo giro ' + gg(prox)}</span>` : '';
  return `<div class="lavoro-zona">${out.join('')}${giro}</div>`;
}
function vZone() {
  const ids = Object.keys(ST.zone).sort().reverse();
  return `<div class="row"><button class="btn pri" id="nuovaScan">Nuova zona da Local Falcon</button><label class="btn">Importa file zona<input type="file" id="impZona" accept=".json,.png" multiple hidden></label></div>
  <div class="lista mt">${ids.map((id) => { const z = ST.zone[id].z; const np = Object.values(z.prospect || {}).filter((p) => !p.del).length;
    return `<a class="card" href="#z/${id}"><div class="riga"><span class="nome">${esc(z.meta.quartiere)}, ${esc(z.meta.citta)}</span><span class="data">${gg(z.meta.data)}</span></div>
    <div class="sub">«${esc(z.meta.keyword)}» · ${z.punti ? z.punti.length : 0} punti · ${Object.keys(z.attivita || {}).length} attività · ${np} prospect</div>${np ? lavoroZona(z) : ''}</a>`; }).join('') || '<div class="vuoto">Nessuna zona.</div>'}</div>
  <div id="richieste"></div>`;
}
/* riga dell'elenco «Attività trovate»: per chi è già prospect mostra gli indicatori per decidere se metterlo in un giro */
function rigaAttivita(zid, z, pid, a, m, p) {
  const pc = (n) => L.pct(n, m.N);
  const ai = L.metricheAI(z, pid);
  // zone al 4°-10° posto: le più facili da portare tra le prime 3. Su AI Mode quando c'è (piattaforma primaria), altrimenti su Maps
  const vicine = (ai || m).ranks.filter((r) => r && r >= 4 && r <= 10).length;
  const sito = (() => { const si = sitoInfo(z, { pid, sito: '' }); return si.k === 'ok' ? ' · ' + esc(si.label) : ' · <b class="c-mid">' + esc(si.label.toLowerCase()) + '</b>'; })();
  const base = `${ai ? `AI Mode ${ai.top3}/${ai.N} top 3 (${L.pct(ai.top3, ai.N)}%) · Maps ${m.top3}/${m.N} (${pc(m.top3)}%)` : `Maps ${m.top3}/${m.N} top 3 (${pc(m.top3)}%)`} · ${a.rv || 0} rec. ${L.virgola(a.r)}`;
  const nr = a.c === false && a.cv ? ' · <b class="c-neg">non rivendicata</b>' : '';
  if (!p) return `<div class="card"><div class="riga"><span class="nome">${esc(a.n)}</span><button class="btn mini" data-nuovo="${pid}">+ Prospect</button></div>
    <div class="sub">${base}${nr}${sito}${RETI.test(a.n) ? ' · rete' : ''}</div></div>`;
  const ult = registro(zid, p.id)[0];
  const giro = p.giro && p.giro.data
    ? `<span class="stato-tappa ${p.giro.fatto ? 'consegnata' : 'rc'}">${p.giro.fatto ? '✓ Consegnato' : 'Giro ' + gg(p.giro.data) + ' · tappa ' + (p.giro.ordine || '—')}</span>`
    : (aperto(p) ? `<button class="btn mini" data-zgiro="${esc(p.id)}">+ Giro ${gg(dataGiroProposta())}</button>` : '');
  return `<div class="card zprospect"><div class="riga"><a class="nome" href="#p/${zid}/${p.id}">${esc(p.nome || a.n)}</a><span class="pill p${(p.priorita || '9')[0]}">${prioHtml(p.priorita)}</span></div>
    <div class="sub">${base}${nr}${sito}</div>
    <div class="sub">${vicine ? `<b>${vicine} zone al 4°-10° posto${ai ? ' su AI Mode' : ''}</b>: a un passo dalle prime 3` : `Nessuna zona al 4°-10° posto${ai ? ' su AI Mode' : ''}`}</div>
    <div class="riga mt" style="justify-content:flex-start;gap:8px;flex-wrap:wrap"><span class="sub">${esc(p.stato)}${ult ? ` · ultimo contatto ${gg(ult.data)}: ${esc(ult.esito || ult.canale)}` : ' · mai contattato'}</span>${giro}</div></div>`;
}
function apriZona(zid) {
  const s = ST.zone[zid]; if (!s) { location.hash = '#zone'; return; }
  const z = s.z; const giaP = new Set(Object.values(z.prospect || {}).filter((p) => !p.del).map((p) => p.pid));
  const prosDi = {}; Object.values(z.prospect || {}).filter((p) => !p.del).forEach((p) => { prosDi[p.pid] = p; });
  const ord = ST.f.ordZ && ST.f.ordZ !== 'top20' ? ST.f.ordZ : 'top3';   // solo le prime 3 posizioni contano: niente ordinamento per presenza
  const campo = L.haAI(z) ? 'punti_ai' : 'punti';   // AI Mode guida l'ordinamento «Top 3» quando c'è
  const righe = Object.entries(z.attivita || {}).map(([pid, a]) => ({ pid, a, m: L.metriche(z, pid), mo: L.metriche(z, pid, campo) }))
    .filter((r) => !ST.f.soloNuove || !giaP.has(r.pid))
    .sort((x, y) => ord === 'rv' ? (y.a.rv || 0) - (x.a.rv || 0) : ord === 'nome' ? x.a.n.localeCompare(y.a.n) : (y.mo.top3 - x.mo.top3) || (y.m.top3 - x.m.top3) || ((y.a.rv || 0) - (x.a.rv || 0)));
  const f = apriFoglio(`${z.meta.quartiere} · ${z.meta.keyword}`, `
  <div class="sub">Rilevazione del ${esc(z.meta.data_testo)} · griglia ${esc(z.meta.lato)} · ${(z.punti || []).length} punti · ${L.haAI(z) ? 'AI Mode importato' : 'AI Mode assente'}</div>
  <div class="sub mt">${s.siti && s.siti.aggiornato ? `Siti controllati il ${oraRoma(s.siti.aggiornato, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}: ${Object.values(s.siti.siti).filter((v) => STATO_SITO[v.stato]).length} non funzionanti su ${Object.keys(s.siti.siti).length}` : 'Siti non ancora controllati'}</div>
  <div class="row mt"><button class="btn mini" id="zSiti">Ricontrolla siti</button><button class="btn mini" id="zPdf">Ultimo PDF</button><button class="btn mini" id="zTesti">Testi della zona</button><button class="btn mini" id="zEsporta">Esporta CSV</button><button class="btn mini" id="zAI">${L.haAI(z) ? 'Aggiorna AI Mode' : 'Aggiungi AI Mode'}</button></div>
  <div class="eb">Attività trovate</div>
  <div class="filtri">${[['top3', L.haAI(z) ? 'Top 3 AI Mode' : 'Top 3'], ['rv', 'Recensioni'], ['nome', 'Nome']].map(([k, l]) => `<button class="chip ${ord === k ? 'on' : ''}" data-ord="${k}">${l}</button>`).join('')}
  <button class="chip ${ST.f.soloNuove ? 'on' : ''}" id="soloNuove">Solo non in lista</button></div>
  <div class="lista">${righe.slice(0, 150).map(({ pid, a, m }) => rigaAttivita(zid, z, pid, a, m, prosDi[pid])).join('')}</div>`,
  () => { location.hash = '#zone'; });
  f.querySelectorAll('[data-ord]').forEach((b) => (b.onclick = () => { ST.f.ordZ = b.dataset.ord; apriZona(zid); }));
  $('#soloNuove', f).onclick = () => { ST.f.soloNuove = !ST.f.soloNuove; apriZona(zid); };
  f.querySelectorAll('[data-nuovo]').forEach((b) => (b.onclick = () => nuovoProspect(zid, b.dataset.nuovo)));
  f.querySelectorAll('[data-zgiro]').forEach((b) => (b.onclick = () => {
    const id = b.dataset.zgiro, d = dataGiroProposta();
    aggiorna(zid, id, { giro: { data: d, ordine: prossimoOrdine(zid, d), orario: '', fatto: false } }); toast('Aggiunto al giro del ' + gg(d)); apriZona(zid);
  }));
  $('#zPdf', f).onclick = async () => {
    const w = window.open('', '_blank'); if (w) w.document.write('<p style="font:16px system-ui;padding:24px">Cerco l\'ultimo PDF…</p>');
    try { const e = await GH.getJSON(`zone/${zid}/stampa/esito.json`); if (e && e.data.file) apriPdf(zid, e.data.file, w); else { if (w) w.close(); toast('Nessun PDF ancora'); } } catch (e) { if (w) w.close(); toast(e.message); }
  };
  $('#zTesti', f).onclick = () => testiZona(zid);
  $('#zSiti', f).onclick = async () => {
    if (!GH.ok()) { toast('Serve il collegamento GitHub'); return; }
    try { await GH.putJSON(`zone/${zid}/siti-richiesta.json`, { creata: new Date().toISOString() }, await GH.sha(`zone/${zid}/siti-richiesta.json`), `Controllo siti ${zid}`);
      toast('Controllo avviato: 2-5 minuti, poi tocca il pallino in alto', 4500); } catch (e) { toast(e.message); }
  };
  $('#zEsporta', f).onclick = () => esportaCSV(zid);
  $('#zAI', f).onclick = () => formAI(zid);
}
function nuovoProspect(zid, pid) {
  const z = ST.zone[zid].z, a = z.attivita[pid], m = L.metriche(z, pid);
  const n = Object.keys(z.prospect || {}).map((k) => parseInt(k.slice(1), 10) || 0).reduce((x, y) => Math.max(x, y), 0) + 1;
  // suffisso casuale: due dispositivi offline non generano lo stesso codice
  let id; do id = 'P' + String(n).padStart(2, '0') + Math.random().toString(36).slice(2, 4); while (z.prospect && z.prospect[id]);
  const rete = RETI.test(a.n);
  // gli invisibili con almeno 20 recensioni tengono a Google: passano tra i caldi
  // priorità e gancio da AI Mode quando la zona ha la scansione AI (taglio primario dei fogli), altrimenti da Google Maps
  const prio = L.priorita(z, pid, rete).prio;
  const gancio = L.gancio(z, pid);
  z.prospect[id] = { id, pid, nome: maiuscole(a.n), priorita: prio, stato: 'Da contattare', prossima: rete ? 'Gestione separata franchising' : "Consegnare il report e proporre l'incontro", data_prossima: '',
    referente: '', telefono: a.t || '', email: '', sito: a.w || '', indirizzo: a.a || '', gancio, prodotto: '', valore: 0, segmento: rete ? 'Franchising' : 'Indipendente', note: '',
    giro: {}, report: { includi: !rete, luogo: rete ? 'agenzia' : undefined }, u: ora() };
  modificato(zid); toast('Aggiunto ' + a.n); apriZona(zid);
}
function testiZona(zid) {
  const z = ST.zone[zid].z, m = z.meta, pp = m.prossimo_passo || { intro: '', outro: '', items: [] };
  const f = apriFoglio('Testi della zona', `
  <div class="due"><label class="f">Quartiere<input data-m="quartiere" value="${esc(m.quartiere)}"></label><label class="f">Città<input data-m="citta" value="${esc(m.citta)}"></label></div>
  <div class="due"><label class="f">Categoria (nome file)<input data-m="categoria" value="${esc(m.categoria)}"></label><label class="f">Centrata… (es. sulla Crocetta)<input data-m="centrata" value="${esc(m.centrata)}"></label></div>
  <label class="f">Chi cerca… (es. un'agenzia immobiliare)<input data-m="frase_kw" value="${esc(m.frase_kw)}"></label>
  <div class="eb">Il prossimo passo</div>
  <label class="f">Introduzione<textarea data-pp="intro">${esc(pp.intro)}</textarea></label>
  <label class="f">Invito<textarea data-pp="outro">${esc(pp.outro)}</textarea></label>
  <div class="barra-salva"><button class="btn annulla neutro" id="tChiudi">Chiudi</button><button class="btn pri" disabled>Si salva a ogni modifica</button></div>`, () => apriZona(zid));
  $('#tChiudi', f).onclick = () => apriZona(zid);
  const meta = () => ST.zone[zid].z.meta;
  const ppOra = () => { const mm = meta(); if (!mm.prossimo_passo) mm.prossimo_passo = JSON.parse(JSON.stringify(pp)); return mm.prossimo_passo; };
  const salva = () => { meta().u = ora(); modificato(zid); statoBarra(f, 'salvato'); };
  f.querySelectorAll('[data-m]').forEach((el) => (el.onchange = () => { meta()[el.dataset.m] = el.value; salva(); }));
  f.querySelectorAll('[data-pp]').forEach((el) => (el.onchange = () => { ppOra()[el.dataset.pp] = el.value; salva(); }));
  f.querySelectorAll('[data-it]').forEach((el) => (el.onchange = () => { const [i, j] = el.dataset.it.split('|'); ppOra().items[i][j] = el.value; salva(); }));
}
function formScansione() {
  const f = apriFoglio('Nuova zona da Local Falcon', `
  <p class="sub">Esegui la scansione su Local Falcon (griglia 7×7 centrata sul quartiere, keyword = sola categoria), poi incolla qui la chiave del report: l'import gira su GitHub, senza consumare Claude.</p>
  <label class="f">Report key (15 caratteri, dall'URL del report)<input id="nk" placeholder="es. e01e001722b17ba" autocapitalize="off"></label>
  <label class="f">Report key AI Mode (facoltativa: stessa griglia e stesso centro, serve ai fogli da lasciare)<input id="nka" placeholder="es. 77b843f6a1547d5" autocapitalize="off"></label>
  <div class="due"><label class="f">Quartiere<input id="nq" placeholder="San Salvario"></label><label class="f">Città<input id="nc" value="Torino"></label></div>
  <div class="due"><label class="f">Categoria per il nome file<input id="ncat" placeholder="Farmacie"></label><label class="f">Riferimento<select id="nl">${L.LUOGHI.map((l) => `<option>${l}</option>`).join('')}</select></label></div>
  <label class="f">Chi cerca… (frase nei titoli)<input id="nf" placeholder="una farmacia"></label>
  <label class="f">Griglia centrata… <input id="nce" placeholder="su San Salvario"></label>
  <button class="btn pri mt" style="width:100%" id="nInvia">Importa</button><div id="nEsito" class="mt sub"></div>`, () => { chiudiFoglio(); render(); });
  $('#nInvia', f).onclick = async () => {
    const k = $('#nk').value.trim().toLowerCase(); const q = $('#nq').value.trim();
    if (!/^[a-f0-9]{15}$/.test(k)) { toast('La report key ha 15 caratteri esadecimali'); return; }
    const ka = $('#nka').value.trim().toLowerCase();
    if (ka && (!/^[a-f0-9]{15}$/.test(ka) || ka === k)) { toast('La report key AI Mode ha 15 caratteri esadecimali ed è diversa da quella Maps'); return; }
    if (!q || !GH.ok()) { toast(GH.ok() ? 'Manca il quartiere' : 'Serve il collegamento GitHub'); return; }
    const cat = $('#ncat').value.trim() || 'Analisi';
    // stesso giorno, quartiere e categoria ma scansione diversa (es. "Centro" in un'altra città): cartella con suffisso
    const base = `${oggi().replace(/-/g, '').slice(2)}-${slug(q)}-${slug(cat)}`;
    let id = base;
    for (let n = 2; n < 10; n++) { const r = await GH.getJSON(`zone/${id}/richiesta.json`).catch(() => null); if (!r || r.data.report_key === k) break; id = `${base}-${n}`; }
    const rq = { report_key: k, ...(ka ? { report_key_ai: ka } : {}), quartiere: q, citta: $('#nc').value.trim(), categoria: cat.replace(/\s+/g, ''), frase_kw: $('#nf').value.trim(), centrata: $('#nce').value.trim() || `su ${q}`, luogo: $('#nl').value, creata: new Date().toISOString() };
    const out = $('#nEsito');
    try {
      await GH.putJSON(`zone/${id}/richiesta.json`, rq, await GH.sha(`zone/${id}/richiesta.json`), `Richiesta import ${id}`);
      out.textContent = 'Richiesta inviata. Import in corso su GitHub (1-3 minuti): puoi chiudere, la zona compare da sola.';
      attendiImport(id, k, out, rq.creata);
    } catch (e) { out.innerHTML = `<span class="c-neg">${esc(e.message)}</span>`; }
  };
}
/* aggiunge la scansione Google AI Mode a una zona già importata: stessa cartella, prospect e registro intatti */
function formAI(zid) {
  const z = ST.zone[zid].z;
  const f = apriFoglio(`AI Mode · ${z.meta.quartiere}`, `
  <p class="sub">Esegui su Local Falcon la scansione Google AI Mode con la stessa griglia (${esc(z.meta.lato)}, ${(z.punti || []).length} punti), lo stesso centro e la stessa keyword «${esc(z.meta.keyword)}», poi incolla qui la report key. L'import gira su GitHub; prospect e registro restano come sono.</p>
  <label class="f">Report key AI Mode<input id="aiK" placeholder="es. 7a025d58a9c8e8d" autocapitalize="off" value="${esc(z.meta.report_key_ai || '')}"></label>
  <button class="btn pri mt" style="width:100%" id="aiInvia">Importa AI Mode</button><div id="aiEsito" class="mt sub"></div>`, () => apriZona(zid));
  $('#aiInvia', f).onclick = async () => {
    const ka = $('#aiK').value.trim().toLowerCase();
    if (!/^[a-f0-9]{15}$/.test(ka) || ka === z.meta.report_key) { toast('La report key AI Mode ha 15 caratteri esadecimali ed è diversa da quella Maps'); return; }
    if (!GH.ok()) { toast('Serve il collegamento GitHub'); return; }
    const out = $('#aiEsito');
    try {
      const r = await GH.getJSON(`zone/${zid}/richiesta.json`);
      if (!r || !r.data || r.data.report_key !== z.meta.report_key) { out.innerHTML = '<span class="c-neg">Richiesta di import della zona non trovata: reimporta la zona da Zone → Nuova zona.</span>'; return; }
      const rq = { ...r.data, report_key_ai: ka, creata: new Date().toISOString() };
      await GH.putJSON(`zone/${zid}/richiesta.json`, rq, await GH.sha(`zone/${zid}/richiesta.json`), `AI Mode ${zid}`);
      out.textContent = 'Richiesta inviata. Import in corso su GitHub (1-3 minuti): puoi chiudere, la griglia AI compare da sola.';
      attendiImport(zid, z.meta.report_key, out, rq.creata);
    } catch (e) { out.innerHTML = `<span class="c-neg">${esc(e.message)}</span>`; }
  };
}
async function attendiImport(id, k, out, creata = null) {
  const t0 = ora();
  while (ora() - t0 < 12 * 60000) {
    await new Promise((r) => setTimeout(r, 15000));
    const e = await GH.getJSON(`zone/${id}/importa-esito.json`).catch(() => null);
    if (e && e.data.report_key === k && (!creata || e.data.creata === creata)) {
      if (e.data.stato === 'in_attesa') { const m = 'Local Falcon sta ancora elaborando la scansione: rilancia l\'import tra qualche minuto.'; if (out) out.textContent = m; else toast(m, 6000); return; }
      if (e.data.stato === 'ok') {
        await scarica();
        const z = ST.zone[id]; if (z && !z.z.meta.luogo) { const rq = await GH.getJSON(`zone/${id}/richiesta.json`); z.z.meta.luogo = rq && rq.data.luogo || 'ufficio'; z.z.meta.u = ora(); modificato(id); }
        const avAI = (e.data.avviso || '').split('; ').find((x) => x.startsWith('AI Mode non importato'));
        if (avAI) { const m = `Zona importata, ma ${avAI.replace('AI Mode non importato', 'AI Mode non è stato importato')}.`; if (out) out.innerHTML = `<span class="c-neg">${esc(m)}</span>`; else toast(m, 8000); return; }
        toast(`Zona importata: ${e.data.attivita} attività`); if (out) out.textContent = 'Zona importata.'; return;
      }
      if (out) out.innerHTML = `<span class="c-neg">Import non riuscito: ${esc(e.data.messaggio)}</span>`; else toast('Import non riuscito: ' + e.data.messaggio, 6000);
      return;
    }
  }
  const msg = 'Import non ancora concluso dopo 12 minuti: controlla Actions su GitHub o riapri Zone più tardi.';
  if (out) out.innerHTML = `<span class="c-neg">${msg}</span>`; else toast(msg, 6000);
}
async function importaFile(files) {
  const json = [...files].find((f) => f.name.endsWith('.json')), png = [...files].find((f) => f.name.endsWith('.png'));
  if (!json) { toast('Seleziona zona.json (e facoltativamente sfondo.png)'); return; }
  try {
    const z = JSON.parse(await json.text());
    if (!z.id || !z.meta || !Array.isArray(z.punti) || !z.punti.length) throw new Error('File non valido: manca id, meta o punti');
    const esist = ST.zone[z.id];
    if (esist && !confirm(`La zona ${z.id} esiste già. Unire i dati del file con quelli presenti?`)) return;
    ST.zone[z.id] = esist ? { ...esist, z: unisci(z, esist.z) } : { z, sha: null, dirty: true };
    if (GH.ok()) {
      ST.zone[z.id].sha = ST.zone[z.id].sha || await GH.sha(`zone/${z.id}/zona.json`);
      if (png) await GH.put(`zone/${z.id}/sfondo.png`, await bufB64(await png.arrayBuffer()), await GH.sha(`zone/${z.id}/sfondo.png`), `Sfondo ${z.id}`);
    }
    modificato(z.id); await invia(z.id); toast('Zona importata'); render();
  } catch (e) { toast(e.message, 5000); }
}

/* ---------- vista: numeri ---------- */
function vCruscotto() {
  const tt = tutti(); const regs = registroVivo();
  const vinti = tt.filter((x) => x.p.stato === 'Vinto'), persi = tt.filter((x) => x.p.stato === 'Perso');
  const eur = (n) => (n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const max = Math.max(1, ...STATI.map((s) => tt.filter((x) => x.p.stato === s).length));
  const sett = piuGiorni(-6);   // ultimi 7 giorni, oggi compreso
  return `<div class="row" style="margin-bottom:10px"><a class="btn mini" href="#tabella">Apri la tabella completa</a></div><div class="kpi">
    <button><b>${tt.length}</b><span>Prospect</span></button>
    <button><b>${regs.length}</b><span>Contatti registrati</span></button>
    <button><b>${regs.filter((r) => r.data >= sett).length}</b><span>Contatti ultimi 7 gg</span></button>
    <button><b>${regs.filter((r) => esitiDi(r).includes('Appuntamento fissato')).length}</b><span>Appuntamenti fissati</span></button>
    <button><b class="c-top">${vinti.length}</b><span>Vinti</span></button>
    <button><b>${vinti.length + persi.length ? L.pct(vinti.length, vinti.length + persi.length) + '%' : '—'}</b><span>Tasso di chiusura</span></button>
    <button><b>${eur(vinti.reduce((s, x) => s + (+x.p.valore || 0), 0))}</b><span>Valore firmato</span></button>
    <button><b>${eur(tt.filter((x) => aperto(x.p)).reduce((s, x) => s + (+x.p.valore || 0), 0))}</b><span>Valore in proposta</span></button></div>
  <div class="eb">Imbuto per stato</div>
  <table class="funnel" style="width:100%">${STATI.map((s) => { const n = tt.filter((x) => x.p.stato === s); return `<tr><td style="width:42%">${s}</td><td style="width:34%"><div class="barra"><i style="width:${n.length / max * 100}%"></i></div></td><td class="mono" style="text-align:right">${n.length}</td><td class="mono" style="text-align:right">${n.length ? eur(n.reduce((a, x) => a + (+x.p.valore || 0), 0)) : ''}</td></tr>`; }).join('')}</table>
  <div class="eb">Aperti per priorità</div>
  <table class="funnel" style="width:100%">${PRIORITA.map((pr) => `<tr><td>${prioHtml(pr)}</td><td class="mono" style="text-align:right">${tt.filter((x) => x.p.priorita === pr && aperto(x.p)).length}</td></tr>`).join('')}</table>
  <div class="eb">Esiti dei contatti</div>
  <table class="funnel" style="width:100%">${ESITI.map((e) => [e, regs.filter((r) => esitiDi(r).includes(e)).length]).filter((x) => x[1]).map(([e, n]) => `<tr><td>${e}</td><td class="mono" style="text-align:right">${n}</td></tr>`).join('') || '<tr><td class="sub">Ancora nessun contatto registrato.</td></tr>'}</table>`;
}

/* ---------- vista: tabella (computer) ---------- */
// tutti i prospect in una tabella: filtri, ordinamento, modifica diretta nelle celle; stessi dati dell'app, nessuna sincronizzazione a parte
const TCOL = [
  ['zona', 'Zona'], ['priorita', 'Priorità', 'sel', PRIORITA], ['nome', 'Attività'], ['stato', 'Stato', 'sel', STATI],
  ['prossima', 'Prossima azione', 'txt'], ['data_prossima', 'Entro', 'data'], ['ultimo', 'Ultimo contatto'], ['ncont', 'Contatti'],
  ['referente', 'Referente', 'txt'], ['telefono', 'Telefono', 'txt'], ['email', 'Email', 'txt'], ['piva', 'P.IVA', 'txt'],
  ['pg', 'PagineGialle', 'sel', ['', 'assente', 'base', 'evoluta']], ['prodotto', 'Prodotto', 'sel', ['', ...PRODOTTI]], ['valore', 'Valore €', 'num'],
  ['giro', 'Giro'], ['note', 'Note', 'txt'],
];
function righeTabella() {
  const f = ST.ft || (ST.ft = { q: '', zona: '', stato: 'aperti', prio: '', solo: '', ord: 'priorita', dir: 1 });
  let tt = tutti().map((x) => ({ ...x, ultimo: ultimoContatto(x.zid, x.p.id), ncont: registro(x.zid, x.p.id).length }));
  if (f.stato === 'aperti') tt = tt.filter((x) => aperto(x.p)); else if (f.stato) tt = tt.filter((x) => x.p.stato === f.stato);
  if (f.zona) tt = tt.filter((x) => x.zid === f.zona);
  if (f.prio) tt = tt.filter((x) => x.p.priorita === f.prio);
  if (f.solo === 'scadute') tt = tt.filter((x) => urgenza(x.p) != null && urgenza(x.p) < 0);
  if (f.solo === 'senza') tt = tt.filter((x) => aperto(x.p) && (!x.p.prossima || !x.p.data_prossima));
  if (f.solo === 'mai') tt = tt.filter((x) => aperto(x.p) && !x.ncont);
  if (f.q) { const q = f.q.toLowerCase(); tt = tt.filter((x) => [x.p.nome, x.p.referente, x.p.indirizzo, x.p.note, x.p.telefono, x.p.email, x.p.piva].join(' ').toLowerCase().includes(q)); }
  const val = (x, k) => k === 'zona' ? x.z.meta.quartiere : k === 'priorita' ? prioRank(x.p) : k === 'stato' ? STATI.indexOf(x.p.stato) : k === 'ultimo' ? x.ultimo : k === 'ncont' ? x.ncont
    : k === 'valore' ? +x.p.valore || 0 : k === 'giro' ? ((x.p.giro || {}).data || '') + String((x.p.giro || {}).ordine || 0).padStart(3, '0') : String(x.p[k] || '').toLowerCase();
  const vuoto = (v) => v === '' || v == null;
  return tt.sort((a, b) => { const va = val(a, f.ord), vb = val(b, f.ord); if (vuoto(va) !== vuoto(vb)) return vuoto(va) ? 1 : -1; return (va > vb ? 1 : va < vb ? -1 : 0) * f.dir || prioRank(a.p) - prioRank(b.p); });
}
function cellaTabella(x, [k, , tipo, opz]) {
  const p = x.p, id = `${x.zid}|${p.id}|${k}`;
  if (k === 'zona') return esc(x.z.meta.quartiere);
  if (k === 'nome') return `<a href="#p/${x.zid}/${p.id}" class="t-nome">${esc(p.nome)}</a>`;
  if (k === 'ultimo') return x.ultimo ? gg(x.ultimo) : '—';
  if (k === 'ncont') return x.ncont || '';
  if (k === 'giro') return p.giro && p.giro.data ? `${gg(p.giro.data)} · ${p.giro.ordine || ''}${p.giro.fatto ? ' ✓' : ''}` : '';
  const v = p[k] ?? '';
  if (tipo === 'sel') return `<select data-te="${id}">${(opz.includes(v) ? opz : [v, ...opz]).map((o) => `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${esc(k === 'pg' ? (PG[o] || (o ? o : 'da verificare')) : o || '—')}</option>`).join('')}</select>`;
  if (tipo === 'data') return `<input type="date" data-te="${id}" value="${esc(v)}">`;
  if (tipo === 'num') return `<input type="number" inputmode="decimal" min="0" step="50" data-te="${id}" value="${esc(v)}">`;
  return `<input data-te="${id}" value="${esc(v)}" ${k === 'note' || k === 'prossima' ? 'class="largo"' : ''}>`;
}
function vTabella() {
  if (!tutti().length) return benvenuto();
  const tt = righeTabella(); const f = ST.ft; const zoneIds = Object.keys(ST.zone);
  const tutti0 = tutti(); const ap = tutti0.filter((x) => aperto(x.p));
  const regs = registroVivo();
  const eur = (n) => (n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const kp = (lab, n, solo, c = '') => `<button data-ts="${solo}" class="${f.solo === solo && solo ? 'sel' : ''}"><b class="${c}">${n}</b><span>${lab}</span></button>`;
  const opz = (arr, cur) => arr.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');
  return `<div class="kpi kpi-t">${kp('Aperti', ap.length, '')}${kp('Azioni scadute', ap.filter((x) => urgenza(x.p) != null && urgenza(x.p) < 0).length, 'scadute', 'c-neg')}${kp('Senza prossima azione', ap.filter((x) => !x.p.prossima || !x.p.data_prossima).length, 'senza', 'c-low')}${kp('Mai contattati', ap.filter((x) => !registro(x.zid, x.p.id).length).length, 'mai')}
    <button><b>${regs.filter((r) => r.data >= piuGiorni(-6)).length}</b><span>Contatti ultimi 7 gg</span></button>
    <button><b>${eur(ap.reduce((s0, x) => s0 + (+x.p.valore || 0), 0))}</b><span>Valore aperto</span></button>
    <button><b class="c-top">${tutti0.filter((x) => x.p.stato === 'Vinto').length}</b><span>Vinti</span></button></div>
  <div class="t-filtri">
    <input class="cerca" id="tq" type="search" placeholder="Cerca nome, referente, telefono, P.IVA…" value="${esc(f.q)}" autocomplete="off" spellcheck="false">
    <select id="tStato">${opz([['aperti', 'Aperti'], ['', 'Tutti gli stati'], ...STATI.map((x) => [x, x])], f.stato)}</select>
    <select id="tPrio">${opz([['', 'Ogni priorità'], ...PRIORITA.map((x) => [x, x])], f.prio)}</select>
    ${zoneIds.length > 1 ? `<select id="tZona">${opz([['', 'Tutte le zone'], ...zoneIds.map((z) => [z, ST.zone[z].z.meta.quartiere])], f.zona)}</select>` : ''}
    <button class="btn mini" id="tCsv">Esporta CSV</button>
  </div>
  <div class="sub" style="margin:4px 0 8px">${tt.length} prospect${f.solo ? ' · filtro dal riquadro attivo' : ''} · clic sull'intestazione per ordinare · le modifiche si salvano da sole</div>
  <div class="t-box"><table class="tabella">
    <thead><tr>${TCOL.map(([k, l]) => `<th data-to="${k}" class="${f.ord === k ? 'ord' : ''}">${esc(l)}${f.ord === k ? (f.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
    <tbody>${tt.map((x) => `<tr class="${classeCard(x.p)}">${TCOL.map((c) => `<td class="t-${c[0]}">${c[0] === 'priorita' ? pallino(x.p.priorita) : ''}${cellaTabella(x, c)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${TCOL.length}" class="vuoto">Nessun prospect con questi filtri.</td></tr>`}</tbody>
  </table></div>`;
}
function salvaCella(el) {
  const [zid, id, k] = el.dataset.te.split('|'); const p = ST.zone[zid] && ST.zone[zid].z.prospect[id]; if (!p) return;
  let v = el.value.trim();
  if (k === 'referente') v = maiuscole(v, true);
  if (k === 'piva') { v = pulisciPiva(v); if (v && !pivaValida(v)) { toast('P.IVA non valida: non salvata'); el.value = p.piva || ''; el.classList.add('t-err'); return; } }
  if (k === 'valore') v = v === '' ? '' : Math.max(0, +v || 0);
  if (String(p[k] ?? '') === String(v)) return;
  const campi = { [k]: v };
  if (k === 'piva') campi.piva_fonte = 'manuale';
  if (k === 'stato' && CHIUSI.includes(v)) { campi.prossima = ''; campi.data_prossima = ''; }
  aggiorna(zid, id, campi); el.classList.remove('t-err'); el.classList.add('t-ok'); setTimeout(() => el.classList.remove('t-ok'), 900);
  if (k === 'referente') el.value = v;
  ST.daRender = true;   // riepilogo e colori si aggiornano quando esci dalla tabella
}

/* ---------- vista: altro ---------- */
function vAltro() {
  const c = ST.cfg, fi = ST.conf.firma || {};
  return `<div class="eb">Collegamento GitHub</div>
  <label class="f">Utente o organizzazione<input id="cOwner" value="${esc(c.owner || '')}" autocapitalize="off"></label>
  <label class="f">Repository dati (privato)<input id="cRepo" value="${esc(c.repo || (AMBIENTE === 'stage' ? 'visibilita-dati-stage' : 'visibilita-dati'))}" autocapitalize="off"></label>
  <label class="f">Token (fine-grained, solo questo repository)<input id="cTok" type="password" value="${esc(c.token || '')}" autocomplete="off"></label>
  <div class="row mt"><button class="btn pri" id="cSalva">Salva e prova</button><button class="btn" id="cInit">Prepara / aggiorna repository</button></div>
  <div id="cEsito" class="sub mt"></div>
  <div class="eb">Firma sui report</div>
  <div class="due"><label class="f">Nome<input data-fi="nome" value="${esc(fi.nome || 'Hector Rinaldi')}"></label><label class="f">Ruolo<input data-fi="ruolo" value="${esc(fi.ruolo || 'Consulente visibilità locale')}"></label></div>
  <div class="due"><label class="f">Telefono<input data-fi="telefono" value="${esc(fi.telefono || '+39 351 894 2667')}"></label><label class="f">Email<input data-fi="email" value="${esc(fi.email || 'hector.rinaldi@italiaonline.it')}"></label></div>
  <div class="eb">Dati</div>
  <div class="row"><button class="btn" id="bkp">Scarica backup completo</button><button class="btn" id="csvAll">Esporta CSV (Excel)</button><button class="btn" id="aggiorna">Riscarica da GitHub</button></div>
  <p class="sub mt"><span class="amb amb-${AMBIENTE}">${AMB_NOME}</span> Versione v${VERSIONE} · dati ${esc((c.owner || '…') + '/' + (c.repo || '…'))}. I dati restano nel repository privato e in questo dispositivo; il token è salvato solo qui. Su un telefono perso: revoca il token da GitHub → Settings → Developer settings.</p>
  <p class="sub mt mono" id="diagFin">${esc(diagFinestra())}</p>
  <button class="btn mini" id="esci" style="color:var(--neg)">Scollega e cancella i dati da questo dispositivo</button>`;
}
async function preparaRepo(out) {
  if (!GH.ok()) { out.textContent = 'Compila prima utente, repository e token.'; return; }
  // il motore di un ambiente non va copiato nei dati dell'altro
  if (avvisoAmbiente()) { out.innerHTML = `<span class="c-neg">App di ${AMB_NOME.toLowerCase()} collegata a ${esc(ST.cfg.repo)}: correggi il repository prima di preparare.</span>`; return; }
  const file = [...MOTORE.map((p) => [p, p]), ...Object.entries(WORKFLOW)];
  let n = 0;
  try {
    for (const [src, dst] of file) {
      out.textContent = `Copio ${dst} (${++n}/${file.length + 1})…`;
      const rs = await fetch(src, { cache: 'no-store' });
      if (!rs.ok) throw new Error(`${src} non disponibile (${rs.status}): riprova tra un minuto`);   // es. Pages in aggiornamento
      const buf = await rs.arrayBuffer();
      const b64 = await bufB64(buf);
      const cur = await GH.req(dst); const curJ = cur && await cur.json();
      if (curJ && curJ.content && curJ.content.replace(/\n/g, '') === b64) continue;
      await GH.put(dst, b64, curJ && curJ.sha, `Motore: ${dst}`);
    }
    const conf = await GH.getJSON('config.json');
    if (!conf) await GH.putJSON('config.json', { firma: ST.conf.firma || {} }, null, 'Configurazione');
    out.innerHTML = '<span class="c-top">Repository pronto.</span> Ultimo passo: aggiungi il secret LOCALFALCON_API_KEY (vedi istruzioni).';
  } catch (e) {
    out.innerHTML = `<span class="c-neg">${esc(e.message)}</span>${e.status === 403 || e.status === 404 ? '<br>Controlla che il token abbia Contents e Workflows in lettura e scrittura.' : ''}`;
  }
}
function esportaCSV(zid) {
  const righe = [['Zona', 'ID', 'Priorità', 'Agenzia', 'Stato', 'Prossima azione', 'Data prossima azione', 'Ultimo contatto', 'N. contatti', 'Referente', 'Telefono', 'Email', 'Sito', 'Partita IVA', 'PagineGialle', 'Indirizzo', 'Gancio', 'Prodotto', 'Valore', 'Segmento', 'Top 3', 'Top 20', 'Recensioni', 'Valutazione', 'Data giro', 'Ordine giro', 'Note']];
  tutti().filter((x) => !zid || x.zid === zid).forEach(({ zid: z0, z, p }) => {
    const a = z.attivita[p.pid] || {}; const m = a.n ? L.metriche(z, p.pid) : {};
    righe.push([z.meta.quartiere, p.id, p.priorita, p.nome, p.stato, p.prossima, p.data_prossima, ultimoContatto(z0, p.id), registro(z0, p.id).length, p.referente, p.telefono, p.email, p.sito, p.piva ? `="${p.piva}"` : '', PG[p.pg] || 'da verificare', p.indirizzo, p.gancio, p.prodotto, p.valore, p.segmento, m.top3 ?? '', m.top20 ?? '', a.rv ?? '', a.r != null ? L.virgola(a.r) : '', (p.giro || {}).data || '', (p.giro || {}).ordine || '', p.note]);
  });
  const reg = [['Zona', 'Data', 'ID', 'Agenzia', 'Canale', 'Interlocutore', 'Esito', 'Cosa è emerso', 'Prossima azione', 'Entro il']];
  Object.entries(ST.zone).filter(([k]) => !zid || k === zid).forEach(([k, s]) => Object.values(s.z.registro || {}).filter((r) => !r.del).sort((a, b) => (a.data > b.data ? 1 : -1))
    .forEach((r) => reg.push([s.z.meta.quartiere, r.data, r.p, (s.z.prospect[r.p] || {}).nome, canaleT(r.canale), r.interlocutore, r.esito, r.emerso, r.prossima, r.entro])));
  const csv = (rr) => '﻿' + rr.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  // un solo file: prospect e, sotto, il registro dei contatti (se c'è)
  const tutto = reg.length > 1 ? [...righe, [], ['REGISTRO CONTATTI'], ...reg] : righe;
  scaricaFile(csv(tutto), `prospect-${zid || 'tutte'}-${oggi()}.csv`, 'text/csv');
}
function scaricaFile(testo, nome, tipo) { const url = URL.createObjectURL(new Blob([testo], { type: tipo })); const a = document.createElement('a'); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }

/* ---------- eventi delle viste ---------- */
function legaVista(v) {
  const V = $('#vista');
  if (v === 'oggi') V.querySelectorAll('[data-kpi]').forEach((b) => (b.onclick = () => { ST.f.kpi = ST.f.kpi === b.dataset.kpi ? '' : b.dataset.kpi; render(); }));
  if (v === 'tabella') {
    const f = ST.ft;
    let tq; $('#tq').oninput = (e) => { f.q = e.target.value; clearTimeout(tq); tq = setTimeout(() => { const pos = e.target.selectionStart; render(); const i = $('#tq'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (x) { /* */ } } }, 250); };
    $('#tStato').onchange = (e) => { f.stato = e.target.value; render(); };
    $('#tPrio').onchange = (e) => { f.prio = e.target.value; render(); };
    if ($('#tZona')) $('#tZona').onchange = (e) => { f.zona = e.target.value; render(); };
    $('#tCsv').onclick = () => esportaCSV();
    V.querySelectorAll('[data-ts]').forEach((b) => (b.onclick = () => { f.solo = f.solo === b.dataset.ts ? '' : b.dataset.ts; render(); }));
    V.querySelectorAll('[data-to]').forEach((th) => (th.onclick = () => { if (f.ord === th.dataset.to) f.dir = -f.dir; else { f.ord = th.dataset.to; f.dir = 1; } render(); }));
    V.querySelectorAll('[data-te]').forEach((el) => {
      el.addEventListener('change', () => salvaCella(el));
      if (el.tagName === 'INPUT') el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } if (e.key === 'Escape') { const [zid, id, k] = el.dataset.te.split('|'); el.value = ST.zone[zid].z.prospect[id][k] ?? ''; el.blur(); } });
    });
  }
  if (v === 'oggi' && $('#oFatti')) $('#oFatti').onclick = () => { ST.f.fatti = !ST.f.fatti; render(); };
  if (v === 'prospect') {
    V.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { ST.f[b.dataset.f] = b.dataset.v; if (b.dataset.f === 'stato') ST.f.ni = false; render(); }));
    if ($('#filtroNI')) $('#filtroNI').onclick = () => { ST.f.ni = !ST.f.ni; render(); };
    $('#filtroNR').onclick = () => { ST.f.nr = !ST.f.nr; render(); };
    $('#filtroNS').onclick = () => { ST.f.ns = !ST.f.ns; render(); };
    V.querySelectorAll('[data-fpg]').forEach((b) => (b.onclick = () => { ST.f.pg = ST.f.pg === b.dataset.fpg ? '' : b.dataset.fpg; render(); }));
    const q = $('#q');
    q.oninput = () => { ST.f.q = q.value; clearTimeout(ST.timer.q); ST.timer.q = setTimeout(() => { const tt = filtraProspect(); $('#contaP').textContent = `${tt.length} prospect`; $('#listaP').innerHTML = listaProspect(tt); }, 120); };
    q.onkeydown = (e) => { if (e.key === 'Enter') q.blur(); };
  }
  if (v === 'giro') {
    disegnaMappaGiro();
    $('#gData').onchange = (e) => { ST.giroData = e.target.value; render(); };
    $('#gAgg').onclick = scegliTappa;
    const gs = $('#gSposta'); if (gs) gs.onclick = formSpostaGiro;
    V.querySelectorAll('[data-gd]').forEach((b) => (b.onclick = () => { ST.giroData = b.dataset.gd; render(); }));
    // la data selezionata resta sempre in vista al centro della fila, anche con molte date
    { const on = V.querySelector('.date-giro .chip.on'); if (on) { const r = on.parentElement; r.scrollLeft += on.getBoundingClientRect().left - r.getBoundingClientRect().left - (r.clientWidth - on.offsetWidth) / 2; } }
    V.querySelectorAll('[data-fg]').forEach((b) => (b.onclick = () => { ST.fg[b.dataset.fg] = ST.fg[b.dataset.fg] === b.dataset.v ? '' : b.dataset.v; render(); }));
    V.querySelectorAll('[data-fgt]').forEach((b) => (b.onclick = () => { ST.fg[b.dataset.fgt] = !ST.fg[b.dataset.fgt]; render(); }));
    V.querySelectorAll('[data-su],[data-giu]').forEach((b) => (b.onclick = () => { const [zid, id] = (b.dataset.su || b.dataset.giu).split('|'); spostaTappa(zid, id, b.dataset.su ? -1 : 1); }));
    V.querySelectorAll('[data-ora]').forEach((el) => (el.onchange = () => { const [zid, id] = el.dataset.ora.split('|'); const p = ST.zone[zid].z.prospect[id]; aggiorna(zid, id, { giro: { ...p.giro, orario: el.value } }); }));
    V.querySelectorAll('[data-fatto]').forEach((b) => (b.onclick = () => { const [zid, id] = b.dataset.fatto.split('|'); formContatto(zid, id, { canale: 'Passaggio', esito: 'Report consegnato', giro: true, ritorno: '#giro' }); }));
    V.querySelectorAll('[data-annulla]').forEach((b) => (b.onclick = () => { const [zid, id] = b.dataset.annulla.split('|'); const p = ST.zone[zid].z.prospect[id]; aggiorna(zid, id, { giro: { ...p.giro, fatto: false, fatto_il: '' } }); ST.restaScroll = true; render(); }));
    V.querySelectorAll('[data-togli]').forEach((b) => (b.onclick = () => { const [zid, id] = b.dataset.togli.split('|'); const d = (ST.zone[zid].z.prospect[id].giro || {}).data; aggiorna(zid, id, { giro: {} }); rinumera(zid, d); modificato(zid); ST.restaScroll = true; render(); }));
    V.querySelectorAll('[data-stampa]').forEach((b) => (b.onclick = () => generaPdf(b.dataset.stampa, 'fogli')));
  }
  if (v === 'zone') {
    $('#nuovaScan').onclick = formScansione;
    $('#impZona').onchange = (e) => importaFile(e.target.files);
  }
  if (v === 'altro') {
    $('#cSalva').onclick = async () => {
      const nuovo = { owner: $('#cOwner').value.trim(), repo: $('#cRepo').value.trim(), token: $('#cTok').value.trim() };
      // cambio di repository (es. produzione ↔ stage): le zone in locale sono del vecchio e non devono finire nel nuovo
      if (ST.cfg.owner && ST.cfg.repo && (nuovo.owner !== ST.cfg.owner || nuovo.repo !== ST.cfg.repo)) {
        const sospese = Object.values(ST.zone).filter((s) => s.dirty).length;
        if (sospese && !confirm(`${sospese} ${sospese === 1 ? 'zona ha' : 'zone hanno'} modifiche non ancora inviate a ${ST.cfg.repo}: passando a ${nuovo.repo} vanno perse. Continuare?`)) return;
        for (const k of await DB.keys()) if (String(k).startsWith('zona:')) await DB.del(k);
        ST.zone = {}; ST.giroGiorno = null;
      }
      ST.cfg = nuovo;
      await DB.set('cfg', ST.cfg); try { localStorage.setItem(CHIAVE_CFG, JSON.stringify(ST.cfg)); } catch (e) { /* copia di riserva non disponibile */ } const out = $('#cEsito');
      try { const r = await fetch(`https://api.github.com/repos/${ST.cfg.owner}/${ST.cfg.repo}`, { cache: 'no-store', headers: { Authorization: `Bearer ${ST.cfg.token}` } });
        if (!r.ok) throw new Error(r.status === 404 ? 'Repository non trovato o token senza accesso' : r.status === 401 ? 'Token non valido' : 'GitHub ' + r.status);
        const j = await r.json(); out.innerHTML = `<span class="c-top">Collegato a ${esc(j.full_name)}</span>${j.private ? '' : ' <span class="c-neg">ATTENZIONE: il repository è pubblico. Rendilo privato.</span>'}`; scarica();
      } catch (e) { out.innerHTML = `<span class="c-neg">${esc(e.message)}</span>`; }
    };
    $('#cInit').onclick = () => preparaRepo($('#cEsito'));
    $('#vista').querySelectorAll('[data-fi]').forEach((el) => (el.onchange = async () => {
      ST.conf.firma = { ...(ST.conf.firma || {}), [el.dataset.fi]: el.value }; DB.set('conf', ST.conf);
      if (GH.ok()) try { const s = await GH.sha('config.json'); await GH.putJSON('config.json', ST.conf, s, 'Firma'); toast('Firma salvata'); } catch (e) { toast(e.message); }
    }));
    $('#bkp').onclick = () => scaricaFile(JSON.stringify(Object.fromEntries(Object.entries(ST.zone).map(([k, s]) => [k, s.z]))), `backup-visibilita-${oggi()}.json`, 'application/json');
    $('#csvAll').onclick = () => esportaCSV();
    $('#aggiorna').onclick = () => { Object.values(ST.zone).forEach((s) => { if (!s.dirty) s.sha = null; }); scarica(); };
    $('#esci').onclick = async () => {
      if (Object.values(ST.zone).some((s) => s.dirty) && !confirm('Ci sono modifiche non ancora salvate su GitHub. Cancellare comunque?')) return;
      if (!confirm('Cancellare token e dati da questo dispositivo? Il repository GitHub non viene toccato.')) return;
      for (const k of await DB.keys()) await DB.del(k); try { localStorage.removeItem(CHIAVE_CFG); } catch (e) { /* */ } location.reload();
    };
  }
}

/* ---------- altezza reale della finestra (iOS app da Home) ---------- */
// Su iPhone, nell'app aperta dalla Home, WebKit a volte calcola la finestra ~60 px più bassa del vero
// (all'avvio o dopo la tastiera): innerHeight, 100dvh e position:fixed restano "corti" finché non si ruota il telefono.
// Rimedio: 1) altezza del corpo pagina presa dallo schermo, che in modalità app occupa tutto; 2) un "ricalcolo" forzato
// (nascondi e rimostra il corpo) quando l'app torna in primo piano o si chiude la tastiera.
const IPHONE_APP = /iPhone/.test(navigator.userAgent) && navigator.standalone === true;
/* margine di sicurezza in alto: > 0 solo se la pagina parte da sotto la barra di stato (finestra a tutto schermo) */
function margineAlto() {
  const p = document.createElement('div'); p.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;padding-top:env(safe-area-inset-top,0px)';
  document.body.appendChild(p); const v = parseFloat(getComputedStyle(p).paddingTop) || 0; p.remove(); return v;
}
/* Bug di iOS (app aperta dalla Home): dopo la tastiera, e a volte all'avvio, innerHeight resta ~60 px più corto
   della finestra vera finché non si ruota il telefono, e sotto la barra delle schede resta una fascia bianca.
   L'altezza dello schermo non va bene come riferimento: in verticale la finestra parte sotto la barra di stato ed è
   legittimamente più corta (allungarla spinge la barra fuori schermo, 26-27/10/2026).
   Rimedio: per ogni orientamento si ricorda l'altezza più grande vista senza tastiera (anche tra un'apertura e l'altra)
   e si usa quella quando iOS ne dichiara una più corta. Mai oltre lo schermo. */
const CHIAVE_ALT = 'vl-alt' + SUFF;
let ALT = {}; try { ALT = JSON.parse(localStorage.getItem(CHIAVE_ALT) || '{}') || {}; } catch (e) { ALT = {}; }
function altezzaGiusta() {
  const h = window.innerHeight;
  if (!IPHONE_APP) return h;
  const orizz = window.innerWidth > h;
  const att = document.activeElement;
  if (att && /^(INPUT|TEXTAREA|SELECT)$/.test(att.tagName)) return h;   // tastiera aperta: decide iOS
  const k = (orizz ? 'o' : 'v') + Math.min(screen.width, screen.height) + 'x' + Math.max(screen.width, screen.height);
  const schermo = orizz ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
  if (h <= schermo && h > (ALT[k] || 0)) { ALT[k] = h; try { localStorage.setItem(CHIAVE_ALT, JSON.stringify(ALT)); } catch (e) { /* */ } }
  const buona = Math.min(ALT[k] || h, schermo);
  return buona - h > 0 && buona - h <= 140 ? buona : h;
}
function diagFinestra() {
  const t = document.querySelector('.tab'); const tb = t ? Math.round(t.getBoundingClientRect().bottom) : '?';
  return `finestra ${innerWidth}×${innerHeight} · schermo ${screen.width}×${screen.height} · margine alto ${margineAlto()} · corpo ${Math.round(document.body.getBoundingClientRect().height)} · fondo barra ${tb} · app ${IPHONE_APP ? 'sì' : 'no'} · memoria ${JSON.stringify(ALT)}`;
}
function adattaAltezza() {
  const b = document.body; if (!b) return;
  const giusta = altezzaGiusta();
  if (Math.abs(b.getBoundingClientRect().height - giusta) > 2) b.style.height = giusta + 'px';
}
function ricalcolaFinestra() {
  if (!IPHONE_APP) { adattaAltezza(); return; }
  const v = $('#vista'); const pos = v ? v.scrollTop : 0;
  document.body.style.display = 'none'; void document.body.offsetHeight; document.body.style.display = '';
  if (v) v.scrollTop = pos;
  adattaAltezza();
}
['resize', 'orientationchange'].forEach((ev) => window.addEventListener(ev, () => { adattaAltezza(); setTimeout(adattaAltezza, 350); }));
window.addEventListener('pageshow', () => setTimeout(ricalcolaFinestra, 50));
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(ricalcolaFinestra, 200); });
// iPhone tiene l'app in memoria per giorni: dopo 30 minuti in background il giro riparte da oggi
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { ST.nascosta = Date.now(); return; }
  if (ST.nascosta && Date.now() - ST.nascosta > 30 * 60000) { ST.giroGiorno = null; if (location.hash.startsWith('#giro')) render(); }
});
document.addEventListener('focusout', (e) => { if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) setTimeout(() => { const a = document.activeElement; if (!a || !/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) ricalcolaFinestra(); }, 160); });
[0, 300, 1000].forEach((t) => setTimeout(adattaAltezza, t));

/* ---------- avvio ---------- */
(async function avvio() {
  ST.cfg = (await DB.get('cfg')) || {};
  // copia di riserva del collegamento: se l'archivio del telefono non risponde, i dati si riscaricano da GitHub
  let riserva = null; try { riserva = JSON.parse(localStorage.getItem(CHIAVE_CFG) || 'null'); } catch (e) { /* */ }
  if (!ST.cfg.token && riserva && riserva.token) ST.cfg = riserva;
  else if (ST.cfg.token) { try { localStorage.setItem(CHIAVE_CFG, JSON.stringify(ST.cfg)); } catch (e) { /* */ } }
  ST.conf = (await DB.get('conf')) || { firma: {} };
  for (const k of await DB.keys()) if (String(k).startsWith('zona:')) ST.zone[k.slice(5)] = await DB.get(k);
  statoSync(GH.ok() ? 'att' : 'loc', GH.ok() ? 'Avvio…' : 'Solo su questo dispositivo');
  render();
  $('#sync').onclick = async () => { for (const id of Object.keys(ST.zone)) await invia(id); scarica(); };
  window.addEventListener('online', () => { Object.keys(ST.zone).forEach((id) => invia(id)); scarica(); });
  window.addEventListener('offline', () => statoSync('att', 'Offline'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ora() - (ST.ultimo || 0) > 60000) scarica(); });
  // con l'app aperta (anche la Tabella sul computer) i dati si riallineano ogni minuto
  setInterval(() => { if (!document.hidden && ora() - (ST.ultimo || 0) > 55000) scarica(); }, 60000);
  document.addEventListener('click', (e) => { const sb = e.target.closest('.badge-sito[data-href]'); if (sb) { e.preventDefault(); e.stopPropagation(); window.open(sb.dataset.href, '_blank', 'noopener'); } }, true);
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-pdf]'); if (b) { const [zid, f] = b.dataset.pdf.split('|'); apriPdf(zid, f); } });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  Object.keys(ST.zone).forEach((id) => { if (ST.zone[id].dirty) invia(id); });
  scarica();
})();

'use strict';
/* Test end-to-end su telefono simulato (iPhone, viewport 390×664) con GitHub finto in memoria
   e Leaflet servito da test/vendor. Lancio: npm run test:e2e */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { avvia, RADICE } = require('./server.js');
const { creaGithub } = require('./github-finto.js');
const { ID, zona } = require('./fixture/zona.js');

const OGGI = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const LEAFLET = path.join(__dirname, 'vendor', 'leaflet');
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
// il banco serve l'app dalla radice, cioè come produzione: i dati finti hanno quindi il nome di quelli di produzione
const SESSIONE = { owner: 'prova', repo: 'visibilita-dati', token: 'github_pat_finto_solo_per_i_test' };

let web, browser;
test.before(async () => { web = await avvia(); browser = await chromium.launch(process.env.PW_EXE?{executablePath:process.env.PW_EXE}:{}); });
test.after(async () => { await browser.close(); await web.chiudi(); });

/* contesto nuovo per ogni test: telefono simulato, fuso e lingua italiani */
async function apri({ token = true, vista = '', dati = true, desktop = false, mutaGh } = {}) {
  const gh = creaGithub();
  if (dati) { gh.metti('config.json', { firma: { nome: 'Prova Test' } }); gh.metti(`zone/${ID}/zona.json`, zona(OGGI)); }
  if (mutaGh) mutaGh(gh);
  const ctx = await browser.newContext(desktop
    ? { viewport: { width: 1280, height: 800 }, locale: 'it-IT', timezoneId: 'Europe/Rome' }
    : { viewport: { width: 390, height: 664 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'it-IT', timezoneId: 'Europe/Rome' });
  const esterne = [];
  await gh.installa(ctx);
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/1\.9\.4\/leaflet\.min\.(js|css)/, (r) => {
    const js = /\.js/.test(r.request().url());
    r.fulfill({ status: 200, contentType: js ? 'text/javascript' : 'text/css', body: fs.readFileSync(path.join(LEAFLET, js ? 'leaflet.js' : 'leaflet.css')) });
  });
  await ctx.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG1 }));
  // ogni altra uscita di rete è un errore del banco di prova
  await ctx.route((u) => !/^(http:\/\/127\.0\.0\.1|data:|blob:)/.test(u.href) && !/api\.github\.com|cdnjs\.cloudflare\.com|tile\.openstreetmap\.org/.test(u.href), (r) => { esterne.push(r.request().url()); r.abort(); });
  if (token) await ctx.addInitScript((c) => { try { if (!localStorage.getItem('vl-cfg')) localStorage.setItem('vl-cfg', JSON.stringify(c)); } catch (e) { /* */ } }, SESSIONE);
  const page = await ctx.newPage();
  const errori = [];
  page.on('pageerror', (e) => errori.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errori.push('console: ' + m.text()); });
  await page.goto(web.url + (vista ? '#' + vista : ''));
  return { page, ctx, gh, errori, esterne, chiudi: () => ctx.close() };
}
const attendiStato = (page, re, timeout = 8000) => page.waitForFunction((s) => new RegExp(s).test(document.querySelector('#syncTxt').textContent), re.source, { timeout });
const testoVista = (page) => page.locator('#vista').innerText();

test('1. senza token: «Solo su questo dispositivo» e nessuna richiesta a GitHub', async () => {
  const t = await apri({ token: false });
  try {
    await attendiStato(t.page, /Solo su questo dispositivo/);
    assert.equal(t.gh.richieste.length, 0);
    assert.match(await testoVista(t.page), /Benvenuto|Collega|GitHub|Prospect/i);
  } finally { await t.chiudi(); }
});

test('2. con token: scarica la zona, «Aggiornato HH:MM» a 24 ore, token nell’intestazione', async () => {
  const t = await apri();
  try {
    await attendiStato(t.page, /Aggiornato \d{2}:\d{2}/);
    const txt = await t.page.locator('#syncTxt').innerText();
    assert.match(txt, /^Aggiornato ([01]\d|2[0-3]):[0-5]\d$/);
    assert.ok(t.gh.richieste.some((r) => r.path.endsWith('/contents/config.json')));
    assert.ok(t.gh.richieste.some((r) => r.path.endsWith(`/contents/zone/${ID}/zona.json`)));
    assert.ok(t.gh.richieste.every((r) => /^Bearer /.test(r.auth || '')));
    assert.match(await testoVista(t.page), /Agenzia Alfa/);
  } finally { await t.chiudi(); }
});

test('3. sette viste: Tabella solo da 900 px, nessun overflow orizzontale a 390 px', async () => {
  const t = await apri();
  try {
    await attendiStato(t.page, /Aggiornato/);
    for (const v of ['oggi', 'prospect', 'giro', 'zone', 'cruscotto', 'altro']) {
      await t.page.locator(`.tab a[data-t=${v}]`).click();
      await t.page.waitForFunction((x) => document.querySelector('#titolo').textContent.length > 0 && location.hash === '#' + x, v);
      const { sw, iw } = await t.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(sw <= iw, `${v}: scrollWidth ${sw} > ${iw}`);
      const interno = await t.page.evaluate(() => { const e = document.querySelector('#vista'); return e.scrollWidth - e.clientWidth; });
      assert.ok(interno <= 1, `${v}: overflow interno ${interno}px`);
    }
    assert.equal(await t.page.locator('.tab a[data-t=tabella]').isVisible(), false);
    assert.equal(await t.page.locator('.tab a').evaluateAll((a) => a.filter((x) => x.offsetParent).length), 6);
  } finally { await t.chiudi(); }
  const d = await apri({ desktop: true });
  try {
    await attendiStato(d.page, /Aggiornato/);
    assert.equal(await d.page.locator('.tab a[data-t=tabella]').isVisible(), true);
    await d.page.locator('.tab a[data-t=tabella]').click();
    await d.page.waitForSelector('#vista table');
    assert.match(await testoVista(d.page), /Agenzia Alfa/);
  } finally { await d.chiudi(); }
  // telefono in orizzontale (932 px, touch): stessa barra della verticale, niente Tabella
  const o2 = await apri();
  try {
    await o2.page.setViewportSize({ width: 932, height: 430 });
    await attendiStato(o2.page, /Aggiornato/);
    assert.equal(await o2.page.locator('.tab a[data-t=tabella]').isVisible(), false, 'Tabella visibile sul telefono in orizzontale');
    assert.equal(await o2.page.locator('.tab a').evaluateAll((a) => a.filter((x) => x.offsetParent).length), 6);
  } finally { await o2.chiudi(); }
});

test('4. scheda prospect: barra «Chiudi»/«Annulla», salvataggio con sha corretto e «✓ Salvato alle HH:MM»', async () => {
  const t = await apri({ vista: 'prospect' });
  try {
    await attendiStato(t.page, /Aggiornato/);
    const shaPrima = t.gh.sha(`zone/${ID}/zona.json`);
    await t.page.locator(`a.card[href="#p/${ID}/p1"]`).click();
    await t.page.waitForSelector('#salva');
    const chiudi = t.page.locator('#annulla'), salva = t.page.locator('#salva');
    assert.equal((await chiudi.innerText()).trim(), 'Chiudi');
    assert.equal(await salva.isDisabled(), true);
    await t.page.locator('[data-c=prossima]').fill('Passare in agenzia');
    assert.equal((await chiudi.innerText()).trim(), 'Annulla');
    assert.equal(await salva.isEnabled(), true);
    await salva.click();
    assert.match(await salva.innerText(), /^✓ Salvato alle ([01]\d|2[0-3]):[0-5]\d$/);
    assert.equal((await chiudi.innerText()).trim(), 'Chiudi');
    await t.page.waitForFunction(() => /^Salvato/.test(document.querySelector('#syncTxt').textContent), null, { timeout: 8000 });
    const puts = t.gh.putSu(`zone/${ID}/zona.json`);
    assert.equal(puts.length, 1);
    assert.equal(puts[0].shaInviato, shaPrima);
    assert.equal(t.gh.json(`zone/${ID}/zona.json`).prospect.p1.prossima, 'Passare in agenzia');
    assert.notEqual(t.gh.sha(`zone/${ID}/zona.json`), shaPrima);
  } finally { await t.chiudi(); }
});

test('5. conflitto reale: l’altro dispositivo cambia lo stesso file, l’app unisce per record e le cancellazioni restano', async () => {
  const t = await apri({ vista: 'prospect' });
  try {
    await attendiStato(t.page, /Aggiornato/);
    // l’altro dispositivo: aggiunge p6, cancella p3 con u più vecchio della modifica locale
    const remoto = t.gh.json(`zone/${ID}/zona.json`);
    remoto.prospect.p6 = { id: 'p6', pid: 'pD', nome: 'Nato Altrove', stato: 'Da contattare', priorita: '2 Tiepido', u: Date.now() + 1000 };
    remoto.prospect.p3 = { ...remoto.prospect.p3, del: true, u: 1500 };
    t.gh.metti(`zone/${ID}/zona.json`, remoto);
    await t.page.locator(`a.card[href="#p/${ID}/p3"]`).click();
    await t.page.waitForSelector('#salva');
    await t.page.locator('[data-c=note]').fill('nota locale');
    await t.page.locator('#salva').click();
    await t.page.waitForFunction(() => /^Salvato/.test(document.querySelector('#syncTxt').textContent), null, { timeout: 15000 });
    const fin = t.gh.json(`zone/${ID}/zona.json`);
    assert.ok(t.gh.rifiuti >= 1, 'il banco doveva rifiutare almeno un PUT con sha vecchio');
    assert.ok(fin.prospect.p6, 'il record creato altrove è andato perso');
    assert.equal(fin.prospect.p3.del, true, 'la cancellazione è stata annullata dalla modifica locale');
    assert.equal(fin.prospect.p1.nome, 'Agenzia Alfa s.a.s.');
  } finally { await t.chiudi(); }
});

test('5b. 409 forzato: l’app rilegge, riprova e salva', async () => {
  const t = await apri({ vista: 'prospect' });
  try {
    await attendiStato(t.page, /Aggiornato/);
    t.gh.forza409 = 1;
    await t.page.locator(`a.card[href="#p/${ID}/p1"]`).click();
    await t.page.waitForSelector('#salva');
    await t.page.locator('[data-c=note]').fill('dopo 409');
    await t.page.locator('#salva').click();
    await t.page.waitForFunction(() => /^Salvato/.test(document.querySelector('#syncTxt').textContent), null, { timeout: 15000 });
    assert.equal(t.gh.json(`zone/${ID}/zona.json`).prospect.p1.note, 'dopo 409');
    assert.ok(t.gh.putSu(`zone/${ID}/zona.json`).length >= 2);
  } finally { await t.chiudi(); }
});

test('6. offline: modifica in coda e salvata in locale, rinvio al ritorno della rete', async () => {
  const t = await apri({ vista: 'prospect' });
  try {
    await attendiStato(t.page, /Aggiornato/);
    await t.page.locator(`a.card[href="#p/${ID}/p1"]`).click();
    await t.page.waitForSelector('#salva');
    await t.ctx.setOffline(true);
    await t.page.locator('[data-c=note]').fill('scritta offline');
    await t.page.locator('#salva').click();
    await attendiStato(t.page, /Offline/);
    assert.equal(t.gh.putSu(`zone/${ID}/zona.json`).length, 0);
    const locale = await t.page.evaluate(() => new Promise((ok) => { const r = indexedDB.open('visibilita', 1); r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').get('zona:torino-prova'); q.onsuccess = () => ok(q.result); }; }));
    assert.equal(locale.dirty, true);
    assert.equal(locale.z.prospect.p1.note, 'scritta offline');
    await t.ctx.setOffline(false);
    await t.page.waitForFunction(() => /^(Salvato|Aggiornato)/.test(document.querySelector('#syncTxt').textContent), null, { timeout: 15000 });
    assert.equal(t.gh.json(`zone/${ID}/zona.json`).prospect.p1.note, 'scritta offline');
  } finally { await t.chiudi(); }
});

test('7. giro: mappa Leaflet locale con un marker per tappa, click sul marker apre la scheda', async () => {
  const t = await apri({ vista: 'giro' });
  try {
    await attendiStato(t.page, /Aggiornato/);
    await t.page.waitForSelector('#mappaGiro .leaflet-marker-icon', { timeout: 8000 });
    assert.equal(await t.page.locator('#mappaGiro .leaflet-marker-icon').count(), 2);
    assert.equal(t.esterne.length, 0, 'uscite di rete non previste: ' + t.esterne.join(', '));
    await t.page.locator('#mappaGiro .leaflet-marker-icon').first().click({ force: true });
    await t.page.waitForFunction(() => /^#p\/torino-prova\/p[12]$/.test(location.hash));
    await t.page.waitForSelector('#salva');
  } finally { await t.chiudi(); }
});

test('7b. giro: due tappe nello stesso punto hanno i pin distanziati e numeri leggibili', async () => {
  const t = await apri({ vista: 'giro', mutaGh: (gh) => {
    const z = gh.json(`zone/${ID}/zona.json`);
    const a = z.attivita[z.prospect.p1.pid]; const b = z.attivita[z.prospect.p2.pid];
    b.la = a.la + 0.00002; b.lo = a.lo;   // circa 2 m: i due pin si coprirebbero
    gh.metti(`zone/${ID}/zona.json`, z);
  } });
  try {
    await attendiStato(t.page, /Aggiornato/);
    await t.page.waitForSelector('#mappaGiro .leaflet-marker-icon', { timeout: 8000 });
    await t.page.waitForTimeout(400);
    const r = await t.page.locator('#mappaGiro .leaflet-marker-icon').evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width }; }));
    assert.equal(r.length, 2);
    assert.ok(Math.hypot(r[0].x - r[1].x, r[0].y - r[1].y) >= r[0].w, `pin sovrapposti: distanza ${Math.hypot(r[0].x - r[1].x, r[0].y - r[1].y)} per pin da ${r[0].w}`);
    assert.deepEqual(t.errori, []);
  } finally { await t.chiudi(); }
});

test('8. «Genera PDF»: scrive stampa.json con le tappe del giro e mostra «Apri» all’esito', async () => {
  const t = await apri({ vista: 'giro' });
  try {
    await attendiStato(t.page, /Aggiornato/);
    await t.page.locator(`[data-stampa="${ID}"]`).click();
    await t.page.waitForFunction((p) => !!document.querySelector('#st-' + p) && /generazione/i.test(document.querySelector('#st-' + p).textContent), ID, { timeout: 8000 });
    const job = t.gh.json(`zone/${ID}/stampa.json`);
    assert.ok(job, 'stampa.json non scritto');
    assert.equal(job.tipo, 'fogli');
    assert.equal(job.fogli.length, 2);
    assert.deepEqual(job.fogli.map((a) => a.pid), ['pA', 'pB']);
    assert.equal(job.punti.length, 9);
    // il motore (Actions) risponde: la prossima lettura trova l’esito
    t.gh.metti(`zone/${ID}/stampa/esito.json`, { file: 'stampa/prova.pdf', richiesta: job.richiesta, analisi: 2, fogli: 1, avvisi: [] });
    await t.page.waitForSelector(`[data-pdf="${ID}|stampa/prova.pdf"]`, { timeout: 15000 });
  } finally { await t.chiudi(); }
});

test('8b. un prospect fuori dal giro (anche di Rete) si aggiunge dalla scheda e finisce nel PDF del giro', async () => {
  const t = await apri({ vista: 'prospect' });
  try {
    await attendiStato(t.page, /Aggiornato/);
    await t.page.locator(`a.card[href="#p/${ID}/p4"]`).click();
    await t.page.waitForSelector('#pGiroAgg');
    assert.match(await t.page.locator('.foglio').innerText(), /Non è in nessun giro/);
    assert.equal(await t.page.locator('#pGiroData').inputValue(), OGGI, 'proposta: il giro già in programma');
    await t.page.locator('#pGiroAgg').click();
    await t.page.waitForSelector('#pGiroVia');
    assert.match(await t.page.locator('.foglio').innerText(), /tappa 3/);
    await t.page.evaluate(() => { location.hash = '#giro'; });
    await t.page.waitForSelector(`[data-stampa="${ID}"]`);
    assert.match(await testoVista(t.page), /RE\/MAX Delta/);
    await t.page.locator(`[data-stampa="${ID}"]`).click();
    await t.page.waitForFunction((p) => !!document.querySelector('#st-' + p) && /generazione/i.test(document.querySelector('#st-' + p).textContent), ID, { timeout: 8000 });
    const job = t.gh.json(`zone/${ID}/stampa.json`);
    assert.deepEqual(job.fogli.map((a) => a.pid), ['pA', 'pB', 'pD']);
  } finally { await t.chiudi(); }
});

test('8c. un contatto con data passata registrato dal giro non segna la tappa come consegnata', async () => {
  const t = await apri({ vista: 'giro' });
  try {
    await attendiStato(t.page, /Aggiornato/);
    await t.page.locator(`[data-fatto="${ID}|p2"]`).click();
    await t.page.waitForSelector('#cData');
    await t.page.locator('#cData').fill('2026-10-01');
    await t.page.locator('#salva').click();
    await t.page.waitForFunction(() => /^Salvato/.test(document.querySelector('#syncTxt').textContent), null, { timeout: 15000 });
    const z = t.gh.json(`zone/${ID}/zona.json`);
    assert.notEqual(z.prospect.p2.giro.fatto, true, 'la tappa di oggi non deve risultare consegnata per un contatto del 01/10');
    assert.equal(Object.values(z.registro).length, 1, 'il contatto resta nel registro');
  } finally { await t.chiudi(); }
});

test('8d. elenco attività della zona: indicatori dei prospect (priorità, top 3, zone al 4°-10° posto, stato, giro) e «+ Giro»', async () => {
  const t = await apri({ vista: 'zone' });
  try {
    await attendiStato(t.page, /Aggiornato/);
    await t.page.evaluate((id) => { location.hash = '#z/' + id; }, ID);
    await t.page.waitForSelector('.zprospect');
    const testo = await t.page.locator('.foglio').innerText();
    assert.doesNotMatch(testo, /top 20|Presenza/, 'niente dati sulle prime 20 posizioni');
    assert.match(testo, /Giro \d{2}\/\d{2} · tappa 1/);
    assert.match(testo, /4°-10° posto/);
    const btn = t.page.locator('[data-zgiro="p4"]');
    assert.equal(await btn.count(), 1, 'RE/MAX Delta fuori dal giro: atteso il pulsante «+ Giro»');
    await btn.click();
    await t.page.waitForFunction(() => !document.querySelector('[data-zgiro="p4"]'));
    await t.page.waitForFunction(() => /^Salvato/.test(document.querySelector('#syncTxt').textContent), null, { timeout: 15000 });
    assert.equal(t.gh.json(`zone/${ID}/zona.json`).prospect.p4.giro.data, OGGI);
  } finally { await t.chiudi(); }
});

test('8e. liste: barre del posizionamento con la quota di zone tra i primi 3 (Maps; AI Mode sopra quando c’è)', async () => {
  const t = await apri({ vista: 'prospect' });
  try {
    await attendiStato(t.page, /Aggiornato/);
    const card = t.page.locator(`a.card[href="#p/${ID}/p1"]`);
    await card.waitFor();
    const testo = await card.locator('.pos').innerText();
    assert.match(testo, /MAPS\s*\d+%/i);
    assert.doesNotMatch(testo, /top 20|presente/i);
    const w = await card.locator('.pos-t i').first().evaluate((e) => e.style.width);
    assert.match(w, /^\d+%$/);
  } finally { await t.chiudi(); }
});

test('9. regole di interfaccia: etichette di stato, posizioni in cifre, «rivendicata» solo da c/cv, priorità', async () => {
  const t = await apri({ vista: 'giro' });
  try {
    await attendiStato(t.page, /Aggiornato/);
    const giro = await testoVista(t.page);
    assert.match(giro, /Visitare/);
    assert.doesNotMatch(giro, /\bFatto\b/);
    await t.page.locator('.tab a[data-t=prospect]').click();
    await t.page.waitForSelector('a.card');
    const lista = await testoVista(t.page);
    assert.doesNotMatch(lista, /\bFatto\b/);
    assert.equal(await t.page.locator(`a.card[href="#p/${ID}/p2"] .badge-nr`).count(), 1, 'p2 ha c=false verificato: badge atteso');
    assert.equal(await t.page.locator(`a.card[href="#p/${ID}/p3"] .badge-nr`).count(), 0, 'p3 ha solo claimed=false di Local Falcon: nessun badge');
    assert.equal(await t.page.locator(`a.card[href="#p/${ID}/p1"] .badge-nr`).count(), 0);
    // colori delle linee di priorità
    const col = (id) => t.page.locator(`a.card[href="#p/${ID}/${id}"]`).evaluate((e) => getComputedStyle(e).borderLeftColor);
    assert.equal(await col('p1'), 'rgb(30, 142, 62)');    // 1 Caldo #1E8E3E
    assert.equal(await col('p2'), 'rgb(242, 149, 41)');   // 2 Tiepido #F29529
    assert.equal(await col('p3'), 'rgb(26, 115, 232)');   // 0 Invisibile #1A73E8
    assert.equal(await col('p4'), 'rgb(154, 163, 160)');  // 3 Rete grigio
    // la scheda: testi con posizioni in cifre
    await t.page.locator(`a.card[href="#p/${ID}/p1"]`).click();
    await t.page.waitForSelector('#salva');
    const scheda = await t.page.locator('#foglio').innerText();
    assert.doesNotMatch(scheda, /\b(primo|secondo|terzo|quarto|quinto|sesto|settimo|ottavo) posto/i);
  } finally { await t.chiudi(); }
});

test('9b. nomi con iniziali maiuscole al salvataggio; sigle e forme societarie intatte', async () => {
  const t = await apri({ vista: 'prospect' });
  try {
    await attendiStato(t.page, /Aggiornato/);
    await t.page.locator(`a.card[href="#p/${ID}/p2"]`).click();
    await t.page.waitForSelector('#salva');
    await t.page.locator('[data-c=nome]').fill('studio rossi di roma s.a.s.');
    await t.page.locator('#salva').click();
    await t.page.waitForFunction(() => /^Salvato/.test(document.querySelector('#syncTxt').textContent), null, { timeout: 8000 });
    assert.equal(t.gh.json(`zone/${ID}/zona.json`).prospect.p2.nome, 'Studio Rossi di Roma s.a.s.');
    await t.page.locator('#annulla').click();
    await t.page.locator(`a.card[href="#p/${ID}/p4"]`).click();
    await t.page.waitForSelector('#salva');
    await t.page.locator('[data-c=nome]').fill('RE/MAX Torino Centro');
    await t.page.locator('#salva').click();
    await t.page.waitForFunction(() => /^Salvato/.test(document.querySelector('#syncTxt').textContent), null, { timeout: 8000 });
    assert.equal(t.gh.json(`zone/${ID}/zona.json`).prospect.p4.nome, 'RE/MAX Torino Centro');
  } finally { await t.chiudi(); }
});

test('9c. non interessati: fuori da Oggi, Prospect e Giro; visibili solo con il filtro «Non interessati»', async () => {
  const ieri = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - 864e5));
  const t = await apri({ mutaGh: (gh) => {
    const z = zona(OGGI); z.prospect.p2.stato = 'Contattato'; z.prospect.p2.prossima = 'Richiamare'; z.prospect.p2.data_prossima = OGGI;
    z.registro = { r1: { id: 'r1', p: 'p2', data: ieri, esito: 'Non interessato', u: 1 } };
    gh.metti(`zone/${ID}/zona.json`, z);
  } });
  const card = (id) => t.page.locator(`#vista a[href="#p/${ID}/${id}"]`);
  const foto = (n) => process.env.FOTO_DIR && t.page.screenshot({ path: path.join(process.env.FOTO_DIR, n + '.png'), fullPage: true });
  try {
    await attendiStato(t.page, /Aggiornato/);
    await t.page.waitForSelector(`a.card[href="#p/${ID}/p1"]`);
    assert.equal(await card('p2').count(), 0, 'Oggi: p2 non interessato non deve comparire');
    assert.match(await testoVista(t.page), /Apri il giro \(1 tappa\)/);
    await foto('1-oggi');
    await t.page.locator('.tab a[data-t=prospect]').click();
    await t.page.waitForSelector('#filtroNI');
    assert.equal(await card('p2').count(), 0, 'Prospect: p2 fuori dalla lista');
    assert.equal(await card('p1').count(), 1);
    assert.match(await t.page.locator('#filtroNI').innerText(), /Non interessati \(1\)/);
    await t.page.locator('.filtri button[data-f=stato][data-v=""]').click();
    assert.equal(await card('p2').count(), 0, 'Prospect «Tutti»: p2 resta fuori');
    await t.page.locator('#filtroNI').click();
    await t.page.waitForSelector(`a.card[href="#p/${ID}/p2"]`);
    assert.equal(await card('p1').count(), 0, 'filtro Non interessati: solo p2');
    assert.equal(await t.page.locator('.filtri button[data-f=stato].on').count(), 0, 'con il filtro attivo nessuno stato è evidenziato');
    await foto('2-prospect-ni');
    await t.page.locator('.filtri button[data-f=stato][data-v=aperti]').click();
    await t.page.waitForSelector(`a.card[href="#p/${ID}/p1"]`);
    assert.equal(await card('p2').count(), 0, 'uno stato toglie il filtro Non interessati');
    await t.page.locator('.tab a[data-t=giro]').click();
    await t.page.waitForSelector('[data-fg=tappa][data-v=ni]');
    assert.equal(await card('p2').count(), 0, 'Giro: p2 fuori dalle tappe');
    assert.match(await t.page.locator('[data-fg=tappa][data-v=""]').innerText(), /Tutte \(1\)/);
    assert.match(await t.page.locator('[data-fg=tappa][data-v=ni]').innerText(), /Non interessati \(1\)/);
    await foto('3-giro');
    await t.page.locator('[data-fg=tappa][data-v=ni]').click();
    await t.page.waitForSelector(`#vista a[href="#p/${ID}/p2"]`);
    assert.equal(await card('p1').count(), 0);
    assert.match(await testoVista(t.page), /Non interessato/);
    assert.match(await testoVista(t.page), /Percorso a piedi \(0 da visitare\)/, 'i non interessati non entrano nel percorso');
    await foto('4-giro-ni');
    assert.deepEqual(t.errori, []);
  } finally { await t.chiudi(); }
});

test('9d. stati «Vinto» e «Perso»: i vecchi «Chiuso vinto/Chiuso perso» si leggono e si salvano con il nome nuovo', async () => {
  const t = await apri({ vista: 'prospect', mutaGh: (gh) => {
    const z = zona(OGGI); z.prospect.p3.stato = 'Chiuso vinto'; z.prospect.p4.stato = 'Chiuso perso';
    gh.metti(`zone/${ID}/zona.json`, z);
  } });
  const foto = (n) => process.env.FOTO_DIR && t.page.screenshot({ path: path.join(process.env.FOTO_DIR, n + '.png'), fullPage: true });
  try {
    await attendiStato(t.page, /Aggiornato/);
    await t.page.waitForSelector(`a.card[href="#p/${ID}/p1"]`);
    assert.equal(await t.page.locator(`#vista a[href="#p/${ID}/p3"]`).count(), 0, 'Vinto è chiuso: fuori dagli aperti');
    await t.page.locator('.filtri button[data-f=stato][data-v=Vinto]').click();
    await t.page.waitForSelector(`a.card[href="#p/${ID}/p3"]`);
    assert.match(await testoVista(t.page), /Vinto · Crocetta/);
    assert.doesNotMatch(await testoVista(t.page), /Chiuso vinto|Chiuso perso/);
    assert.equal(await t.page.locator('.filtri button[data-f=stato][data-v="Chiuso vinto"]').count(), 0);
    await foto('5-prospect-vinto');
    assert.match(await t.page.locator('#filtroNI').innerText(), /Non interessati \(1\)/, 'Perso conta tra i non interessati');
    await t.page.locator('.tab a[data-t=cruscotto]').click();
    await t.page.waitForFunction(() => /Vinti/.test(document.querySelector('#vista').innerText));
    const numeri = await testoVista(t.page);
    assert.match(numeri, /1\s*Vinti/);
    assert.doesNotMatch(numeri, /Chiusi vinti|Chiuso vinto/);
    await foto('6-numeri');
    // la scheda propone «Vinto» e il salvataggio scrive il nome nuovo
    await t.page.goto(t.page.url().split('#')[0] + `#p/${ID}/p3`);
    await t.page.waitForSelector('#salva');
    assert.equal(await t.page.locator('#foglio select[data-c=stato]').inputValue(), 'Vinto');
    await t.page.locator('[data-c=prossima]').fill('Mandare il contratto');
    await t.page.locator('#salva').click();
    await t.page.waitForFunction(() => /^Salvato/.test(document.querySelector('#syncTxt').textContent), null, { timeout: 8000 });
    const dati = t.gh.json(`zone/${ID}/zona.json`);
    assert.equal(dati.prospect.p3.stato, 'Vinto');
    assert.equal(dati.prospect.p4.stato, 'Perso');
    assert.deepEqual(t.errori, []);
  } finally { await t.chiudi(); }
});

test('10b. ambiente: la produzione collegata ai dati di stage mostra l’avviso rosso chiaro; con i dati giusti nessun avviso', async () => {
  const t = await apri();
  try {
    await attendiStato(t.page, /Aggiornato/);
    assert.equal(await t.page.locator('.amb-avviso').count(), 0);
    assert.equal(await t.page.evaluate(() => document.documentElement.dataset.amb), 'prod');
    await t.page.evaluate(() => { ST.cfg.repo = 'visibilita-dati-stage'; render(); });
    await t.page.waitForSelector('.amb-avviso');
    assert.match(await t.page.locator('.amb-avviso').innerText(), /dati di prova/);
  } finally { await t.chiudi(); }
});

test('10. versione: VERSIONE, CACHE e ?v= coincidono; la «v» compare solo nel Profilo', async () => {
  const app = fs.readFileSync(path.join(RADICE, 'app.js'), 'utf8'), sw = fs.readFileSync(path.join(RADICE, 'sw.js'), 'utf8'), html = fs.readFileSync(path.join(RADICE, 'index.html'), 'utf8');
  const v = app.match(/const VERSIONE = '([\d.]+)'/)[1];
  assert.equal(sw.match(/const CACHE = 'vl-([\d.]+)'/)[1], v);
  const q = [...html.matchAll(/\?v=([\d.]+)"/g)].map((m) => m[1]).filter((x) => /\d+\.\d+\.\d+/.test(x));
  assert.ok(q.length >= 3, 'attesi almeno stile.css, logica.js, app.js con ?v=');
  assert.ok(q.every((x) => x === v), `?v= diversi: ${q} ≠ ${v}`);
  assert.match(v, /^0\.\d+\.\d+$/);
  const t = await apri({ vista: 'altro' });
  try {
    // il Profilo si disegna dopo l'avvio: si aspetta che compaia il testo invece di leggerlo subito
    await t.page.waitForFunction(() => /Versione v/.test(document.querySelector('#vista').innerText), null, { timeout: 8000 });
    assert.match(await testoVista(t.page), new RegExp(`Versione v${v.replace(/\./g, '\\.')}`));
  } finally { await t.chiudi(); }
});

test('10c. stage: sotto /…-stage/ l’app è di stage e non scrive sui dati di produzione, ma sì su quelli di stage', async () => {
  const stage = async (repo) => {
    const t = await apri({});
    await t.ctx.addInitScript((r) => { try { localStorage.setItem('vl-cfg-stage', JSON.stringify(r)); } catch (e) { /* */ } }, { ...SESSIONE, repo });
    await t.page.goto(web.url.replace(/\/$/, '') + '/visibilita-locale-stage/#oggi');
    return t;
  };
  const t1 = await stage('visibilita-dati');
  try {
    await t1.page.waitForFunction(() => document.documentElement.dataset.amb === 'stage', null, { timeout: 8000 });
    const err = await t1.page.evaluate(async () => { try { await GH.put('prova.txt', btoa('x'), null, 'prova'); return ''; } catch (e) { return e.message; } });
    assert.match(err, /Stage: scrittura bloccata/);
    assert.equal(t1.gh.json('prova.txt'), null);
  } finally { await t1.chiudi(); }
  const t2 = await stage('visibilita-dati-stage');
  try {
    await t2.page.waitForFunction(() => document.documentElement.dataset.amb === 'stage', null, { timeout: 8000 });
    const err = await t2.page.evaluate(async () => { try { await GH.put('prova.txt', btoa('x'), null, 'prova'); return ''; } catch (e) { return e.message; } });
    assert.doesNotMatch(err, /bloccata/, 'con i dati di stage la scrittura non va bloccata');   // il GitHub finto risponde solo per visibilita-dati: qualunque altro esito va bene
  } finally { await t2.chiudi(); }
});

test('11. service worker: si registra e dopo il primo caricamento l’app si apre anche senza rete', async () => {
  const t = await apri();
  try {
    await attendiStato(t.page, /Aggiornato/);
    await t.page.evaluate(() => navigator.serviceWorker.ready);
    await t.page.reload();   // con il worker attivo i file entrano nella cache (rete prima)
    await t.page.waitForFunction(() => navigator.serviceWorker.controller);
    await t.ctx.setOffline(true);
    await t.page.reload();
    await t.page.waitForSelector('#vista');
    assert.match(await testoVista(t.page), /Agenzia Alfa/);
    const chiavi = await t.page.evaluate(async () => (await caches.keys()));
    // una cache per ambiente (produzione e stage condividono il sito): vl-<versione>@prod dalla radice del banco
    assert.ok(chiavi.some((k) => /^vl-\d+\.\d+\.\d+@prod$/.test(k)), 'cache vl-<versione>@prod assente: ' + chiavi);
  } finally { await t.chiudi(); }
});

test('12. nessun errore JS né richiesta esterna imprevista durante un giro completo', async () => {
  const t = await apri();
  try {
    await attendiStato(t.page, /Aggiornato/);
    for (const v of ['oggi', 'prospect', 'giro', 'zone', 'cruscotto', 'altro']) { await t.page.locator(`.tab a[data-t=${v}]`).click(); await t.page.waitForTimeout(250); }
    await t.page.goto(web.url + `#z/${ID}`); await t.page.waitForTimeout(500);
    assert.deepEqual(t.errori, []);
    assert.deepEqual(t.esterne, []);
  } finally { await t.chiudi(); }
});

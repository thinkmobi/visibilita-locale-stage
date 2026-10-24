/* Visibilità locale · foglio Google in sola lettura
   Legge i dati dal repository privato GitHub (zone/<id>/zona.json) e riscrive le schede
   Riepilogo, Prospect, Giro e Contatti. Le modifiche si fanno nell'app: qui ogni aggiornamento
   sovrascrive le schede.

   Installazione (una volta sola):
   1. Nel foglio: Estensioni → Apps Script, incolla questo file al posto del codice presente, salva.
   2. Ricarica il foglio: compare il menu "Visibilità".
   3. Visibilità → Imposta token GitHub: incolla un token fine-grained con accesso
      SOLO al repository visibilita-dati e permesso Contents: Read-only.
   4. Visibilità → Aggiorna ora (la prima volta Google chiede di autorizzare lo script).
   5. Visibilità → Aggiornamento automatico ogni 15 minuti. */

const REPO = 'thinkmobi/visibilita-dati';
const STATI = ['Da contattare', 'Contattato', 'In attesa di risposta', 'Visita fissata', 'Visita fatta', 'Proposta inviata', 'Trattativa', 'Vinto', 'Perso', 'Scartato'];
const CHIUSI = ['Vinto', 'Perso', 'Scartato'];
// nomi vecchi degli stati, letti come quelli nuovi
const STATI_VECCHI = { 'Chiuso vinto': 'Vinto', 'Chiuso perso': 'Perso' };
const PRIORITA = ['1 Caldo', '2 Tiepido', '0 Invisibile', '3 Rete'];
const PG = { assente: 'Assente su PG', base: 'PG base', evoluta: 'PG evoluta' };

/* ---------- parte pura: dai dati alle tabelle (provata anche fuori da Google) ---------- */
function costruisciTabelle(zone, oggi) {
  const tutti = [];
  const contatti = [];
  zone.forEach((z) => {
    const reg = Object.values(z.registro || {}).filter((r) => !r.del);
    Object.values(z.prospect || {}).filter((p) => !p.del).map((p) => (STATI_VECCHI[p.stato] ? { ...p, stato: STATI_VECCHI[p.stato] } : p)).forEach((p) => {
      const rp = reg.filter((r) => r.p === p.id).sort((a, b) => (a.data < b.data ? 1 : -1));
      tutti.push({ z, p, a: (z.attivita || {})[p.pid] || {}, ultimo: rp.length ? rp[0].data : '', n: rp.length, contOggi: rp.find((r) => r.data === (p.giro || {}).data) });
    });
    reg.forEach((r) => contatti.push([quartiere(z), r.data || '', (z.prospect[r.p] || {}).nome || r.p, (r.canale === 'Passaggio in agenzia' ? 'Passaggio' : r.canale || ''), r.interlocutore || '', r.esito || '', r.emerso || '', r.prossima || '', r.entro || '']));
  });
  // P.IVA trovata sui siti di domini diversi = sede di una rete (es. Tecnocasa): non la mostro
  const host = (u) => String(u || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0].toLowerCase();
  const dom = {};
  tutti.forEach((x) => { if (x.p.piva && x.p.piva_fonte === 'sito') (dom[x.p.piva] = dom[x.p.piva] || {})[host(x.p.sito || x.a.w)] = 1; });
  const pivaOk = (p) => (p.piva && !(p.piva_fonte === 'sito' && Object.keys(dom[p.piva] || {}).length > 1) ? p.piva : '');
  const aperto = (p) => !CHIUSI.includes(p.stato);
  const ordP = (x) => (({ 1: 0, 2: 1, 0: 2, 3: 3 })[(x.p.priorita || '9')[0]] ?? 9);
  const val = (x) => +x.p.valore || 0;
  const prospect = [['Zona', 'Priorità', 'Attività', 'Stato', 'Prossima azione', 'Entro', 'Scaduta', 'Ultimo contatto', 'N. contatti', 'Referente', 'Telefono', 'Email', 'Sito', 'Partita IVA', 'PagineGialle', 'Prodotto', 'Valore €', 'Giro', 'Tappa n.', 'Stato tappa', 'Recensioni', 'Valutazione', 'Indirizzo', 'Note', 'ID']];
  tutti.slice().sort((a, b) => Number(aperto(b.p)) - Number(aperto(a.p)) || ordP(a) - ordP(b) || String(a.p.data_prossima || '9').localeCompare(String(b.p.data_prossima || '9')))
    .forEach((x) => {
      const p = x.p, g = p.giro || {};
      prospect.push([quartiere(x.z), p.priorita || '', p.nome || '', p.stato || '', p.prossima || '', data(p.data_prossima), aperto(p) && p.data_prossima && p.data_prossima < oggi ? 'sì' : '',
        data(x.ultimo), x.n || '', p.referente || '', p.telefono || '', p.email || '', p.sito || x.a.w || '', pivaOk(p) ? "'" + pivaOk(p) : '', PG[p.pg] || 'da verificare',
        p.prodotto || '', +p.valore ? +p.valore : '', data(g.data), g.ordine || '', g.data ? statoTappa(x) : '',
        x.a.rv ?? '', x.a.r ?? '', p.indirizzo || x.a.a || '', p.note || '', p.id]);
    });
  const giro = [['Data', 'Zona', 'Tappa', 'Orario', 'Attività', 'Stato tappa', 'Priorità', 'Stato', 'Referente', 'Telefono', 'Indirizzo']];
  tutti.filter((x) => x.p.giro && x.p.giro.data).sort((a, b) => (b.p.giro.data > a.p.giro.data ? 1 : b.p.giro.data < a.p.giro.data ? -1 : 0) || quartiere(a.z).localeCompare(quartiere(b.z)) || (a.p.giro.ordine || 99) - (b.p.giro.ordine || 99))
    .forEach((x) => giro.push([data(x.p.giro.data), quartiere(x.z), x.p.giro.ordine || '', x.p.giro.orario || '', x.p.nome || '', statoTappa(x), x.p.priorita || '', x.p.stato || '', x.p.referente || '', x.p.telefono || '', x.p.indirizzo || x.a.a || '']));
  contatti.sort((a, b) => (a[1] < b[1] ? 1 : -1));
  const cont = [['Zona', 'Data', 'Attività', 'Canale', 'Interlocutore', 'Esito', 'Cosa è emerso', 'Prossima azione', 'Entro il']].concat(contatti.map((r) => [r[0], data(r[1]), ...r.slice(2, 8), data(r[8])]));
  // riepilogo
  const ap = tutti.filter((x) => aperto(x.p));
  const sett = piuGiorni(oggi, -6);
  const riep = [['Riepilogo', ''], ['Prospect aperti', ap.length], ['Azioni scadute', ap.filter((x) => x.p.data_prossima && x.p.data_prossima < oggi).length],
    ['Azioni di oggi', ap.filter((x) => x.p.data_prossima === oggi).length], ['Senza prossima azione', ap.filter((x) => !x.p.prossima || !x.p.data_prossima).length],
    ['Mai contattati', ap.filter((x) => !x.n).length], ['Contatti ultimi 7 giorni', contatti.filter((r) => r[1] >= sett).length],
    ['Valore aperto €', ap.reduce((s, x) => s + val(x), 0)], ['Vinti', tutti.filter((x) => x.p.stato === 'Vinto').length],
    ['Valore firmato €', tutti.filter((x) => x.p.stato === 'Vinto').reduce((s, x) => s + val(x), 0)], ['', ''], ['Stato', 'Prospect']];
  STATI.forEach((s) => riep.push([s, tutti.filter((x) => x.p.stato === s).length]));
  riep.push(['', ''], ['Priorità (aperti)', 'Prospect']);
  PRIORITA.forEach((s) => riep.push([s, ap.filter((x) => x.p.priorita === s).length]));
  riep.push(['', ''], ['Zona', 'Aperti']);
  zone.forEach((z) => riep.push([quartiere(z), ap.filter((x) => x.z === z).length]));
  return { Riepilogo: riep, Prospect: prospect, Giro: giro, Contatti: cont };
}
function quartiere(z) { return ((z.meta || {}).quartiere) || z.id || ''; }
function data(s) { if (!s) return ''; const [a, m, g] = String(s).split('-'); return g ? `${g}/${m}/${a}` : s; }
function piuGiorni(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function statoTappa(x) { return x.p.giro.fatto ? 'Consegnato' : x.contOggi ? 'Contattato' : 'Da visitare'; }

/* ---------- parte Google ---------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Visibilità')
    .addItem('Aggiorna ora', 'aggiorna').addItem('Aggiornamento automatico ogni 15 minuti', 'attivaAutomatico')
    .addItem('Ferma aggiornamento automatico', 'fermaAutomatico').addSeparator().addItem('Imposta token GitHub', 'impostaToken').addToUi();
}
function impostaToken() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Token GitHub', 'Token fine-grained con accesso solo a visibilita-dati, permesso Contents: Read-only. Resta salvato solo per il tuo account Google.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() === ui.Button.OK && r.getResponseText().trim()) { PropertiesService.getUserProperties().setProperty('GH_TOKEN', r.getResponseText().trim()); ui.alert('Token salvato. Ora usa Visibilità → Aggiorna ora.'); }
}
function gh(percorso, raw) {
  const token = PropertiesService.getUserProperties().getProperty('GH_TOKEN');
  if (!token) throw new Error('Manca il token: Visibilità → Imposta token GitHub');
  const r = UrlFetchApp.fetch(`https://api.github.com/repos/${REPO}/contents/${percorso}`, {
    headers: { Authorization: 'Bearer ' + token, Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error(`GitHub ${r.getResponseCode()} su ${percorso}: ${r.getContentText().slice(0, 150)}`);
  return JSON.parse(r.getContentText());
}
function aggiorna() {
  const lock = LockService.getDocumentLock(); if (!lock.tryLock(20000)) return;
  try {
    const cartelle = gh('zone').filter((d) => d.type === 'dir').map((d) => d.name);
    const zone = [];
    cartelle.forEach((id) => { try { const z = gh(`zone/${id}/zona.json`, true); z.id = z.id || id; zone.push(z); } catch (e) { if (!/ 404 /.test(e.message)) throw e; } });
    const oggi = Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyy-MM-dd');
    const T = costruisciTabelle(zone, oggi);
    const ss = SpreadsheetApp.getActive();
    Object.keys(T).forEach((nome, i) => scriviScheda(ss, nome, T[nome], i));
    const info = ss.getSheetByName('Riepilogo');
    info.getRange('D1:D2').setValues([['Aggiornato: ' + Utilities.formatDate(new Date(), 'Europe/Rome', 'dd/MM/yyyy HH:mm')], ['Sola lettura: le modifiche si fanno nell\'app, qui vengono sovrascritte.']]);
    info.getRange('D1:D2').setFontColor('#5F6B70').setFontStyle('italic');
  } catch (e) {
    const s = SpreadsheetApp.getActive().getSheetByName('Riepilogo');
    if (s) s.getRange('D1').setValue('Errore aggiornamento ' + Utilities.formatDate(new Date(), 'Europe/Rome', 'dd/MM HH:mm') + ': ' + e.message).setFontColor('#C5221F');
    throw e;
  } finally { lock.releaseLock(); }
}
function scriviScheda(ss, nome, righe, indice) {
  let sh = ss.getSheetByName(nome) || ss.insertSheet(nome, indice);
  if (sh.getFilter()) sh.getFilter().remove();
  sh.clear();
  if (sh.getMaxRows() > righe.length + 50) sh.deleteRows(righe.length + 51, sh.getMaxRows() - righe.length - 50);
  const largh = Math.max(...righe.map((r) => r.length));
  const dati = righe.map((r) => r.concat(Array(largh - r.length).fill('')));
  sh.getRange(1, 1, dati.length, largh).setValues(dati);
  const testa = sh.getRange(1, 1, 1, largh);
  testa.setFontWeight('bold').setBackground('#18232A').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  if (nome === 'Prospect') sh.setFrozenColumns(3);
  if (nome !== 'Riepilogo' && dati.length > 1) sh.getRange(1, 1, dati.length, largh).createFilter();
  if (nome === 'Riepilogo') { sh.getRange('A:A').setFontWeight('normal'); dati.forEach((r, i) => { if (r[1] === 'Prospect' || r[1] === 'Aperti') sh.getRange(i + 1, 1, 1, 2).setFontWeight('bold').setBackground('#E4F2E8'); }); }
}
function attivaAutomatico() {
  fermaAutomatico();
  ScriptApp.newTrigger('aggiorna').timeBased().everyMinutes(15).create();
  SpreadsheetApp.getUi().alert('Aggiornamento automatico attivo: ogni 15 minuti.');
}
function fermaAutomatico() { ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'aggiorna').forEach((t) => ScriptApp.deleteTrigger(t)); }

if (typeof module !== 'undefined') module.exports = { costruisciTabelle };

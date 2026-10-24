'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logica.js');
const { zona, ID } = require('./fixture/zona.js');

const OGGI = '2026-10-23';
const z = zona(OGGI);
const P = z.prospect;

test('posizioni in cifre con articolo giusto', () => {
  assert.equal(L.alPosto(6), 'al 6° posto');
  assert.equal(L.alPosto(8), "all'8° posto");
  assert.equal(L.alPosto(11), "all'11° posto");
  assert.equal(L.alPosto(18), "all'18° posto");
  assert.equal(L.alPostoBreve(3), 'al 3°');
  assert.equal(L.alPostoBreve(80), "all'80°");
});

test('ordinale e virgola', () => {
  assert.equal(L.ordinale(1), 'primo');
  assert.equal(L.ordinale(25), '25°');
  assert.equal(L.virgola(4.6), '4,6');
  assert.equal(L.virgola(null), '');
});

test('metriche: conteggi su griglia 3×3', () => {
  const m = L.metriche(z, 'pA');
  assert.equal(m.N, 9);
  assert.deepEqual(m.ranks, [1, 2, 4, 5, 1, null, null, 5, null]);
  assert.equal(m.top3, 3);
  assert.equal(m.top20, 6);
  assert.ok(Math.abs(m.solv - 3 / 9) < 1e-9);
  assert.ok(Math.abs(m.arp - 18 / 6) < 1e-9);
  assert.ok(Math.abs(m.atrp - (1 + 2 + 4 + 5 + 1 + 21 + 21 + 5 + 21) / 9) < 1e-9);
});

test('metriche: attività assente e zona senza punti', () => {
  const m = L.metriche(z, 'inesistente');
  assert.equal(m.top20, 0); assert.equal(m.arp, null); assert.equal(m.atrp, 21);
  const v = L.metriche({ punti: undefined }, 'pA');
  assert.equal(v.N, 0); assert.equal(v.atrp, null); assert.equal(v.solv, 0);
});

test('dist e tondo', () => {
  assert.ok(Math.abs(L.dist(45, 7, 45.001, 7) - 111.32) < 0.5);
  assert.equal(L.tondo(47), 45);
  assert.equal(L.tondo(123), 120);
});

test('puntiOrdinati: il più vicino alla sede è il punto centrale', () => {
  const ord = L.puntiOrdinati(z, P.p1);
  assert.equal(ord[0].i, 4);
  assert.ok(ord[0].d < 1);
  assert.equal(ord.length, 9);
});

test('puntoLista: sede già nei primi 3 → primo punto a ≥200 m fuori dai primi 3', () => {
  const pt = L.puntoLista(z, P.p1);
  assert.ok(pt.d >= 200);
  assert.ok(!pt.rank || pt.rank > 3);
});

test('puntoLista: punto scelto a mano in report.punto', () => {
  const p = { ...P.p1, report: { punto: 0 } };
  assert.equal(L.puntoLista(z, p).i, 0);
});

test('classifica: sede che non compare in coda alla lista', () => {
  const p = { ...P.p3, pid: 'pE' };
  const c = L.classifica({ ...z, punti: [[45.06, 7.66, ['pB', 'pC']]], attivita: z.attivita }, { ...p, lat: 1, lng: 1 });
  const ultima = c.righe[c.righe.length - 1];
  assert.equal(ultima[0], null);
  assert.match(ultima[1], /non compare/);
  assert.equal(ultima[3], true);
});

test('classifica: sede oltre il 7° → prime 5 più la sede', () => {
  const lista = ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8', 'pA'];
  const att = { ...z.attivita }; lista.slice(0, 8).forEach((k) => (att[k] = { n: k, rv: 1, r: 4 }));
  const zz = { ...z, attivita: att, punti: [[45.06, 7.66, lista]] };
  const c = L.classifica(zz, P.p1);
  assert.equal(c.righe.length, 6);
  assert.equal(c.righe[5][0], 9);
  assert.equal(c.righe[5][3], true);
});

test('bozza: ramo «non compare» quando in nessun punto', () => {
  const zz = { ...z, punti: z.punti.map(([a, b]) => [a, b, ['pB', 'pC']]) };
  const b = L.bozza(zz, P.p1);
  assert.match(b.titolo, /non compare/);
  assert.match(b.cosa, /In nessuno dei 9 punti/);
});

test('bozza: ramo «sotto il 3° posto» e ramo «vicino alla sede»', () => {
  const lontano = L.bozza({ ...z, punti: z.punti.map(([a, b]) => [a, b, ['pB', 'pC', 'pD', 'pE', 'pA']]) }, P.p1);
  assert.match(lontano.titolo, /su Google è al 5° posto/);
  const b = L.bozza(z, P.p1);
  assert.match(b.titolo, /è al 1° posto/);
  assert.match(b.cosa, /La visibilità si ferma vicino alla sede/);
});

test('luogo «scuola»: elenco, titolo davanti alla scuola, intestazione a distanza', () => {
  assert.ok(L.LUOGHI.includes('scuola'));
  const p = { ...P.p1, report: { luogo: 'scuola' } };
  const zz = { ...z, punti: z.punti.map(([a, b]) => [a, b, ['pB', 'pC']]) };
  assert.equal(L.bozza(zz, p).titolo, 'Davanti alla sua scuola, su Google non compare.');
  assert.equal(L.testaLista(z, p), 'A 220 M DALLA SUA SCUOLA');
});

test('analisi: statistiche e testi', () => {
  const a = L.analisi(z, P.p1);
  assert.equal(a.name, 'Agenzia Alfa');
  assert.equal(a.pid, 'pA');
  assert.equal(a.stats[0].big, '3 su 9');
  assert.equal(a.stats[0].pct, '33%');
  assert.equal(a.stats[0].color, 'mid');
  assert.equal(a.stats[1].big, '6 su 9');
  assert.equal(a.stats[2].big, '32');
  assert.equal(a.unclaimed, false);
  assert.match(a.method, /20 ottobre 2026/);
  assert.match(a.method, /«agenzia immobiliare»/);
});

test('analisi: «non rivendicata» solo dal dato verificato c=false', () => {
  assert.equal(L.analisi(z, P.p2).unclaimed, true);
  assert.equal(L.analisi(z, P.p4).unclaimed, false);
});

test('analisi: titolo e testo modificati a mano prevalgono sulla bozza', () => {
  const a = L.analisi(z, { ...P.p1, report: { titolo: 'T', cosa: 'C' } });
  assert.equal(a.title, 'T'); assert.equal(a.cosa, 'C');
});

test('colorePct, recStr, indirizzoBreve', () => {
  assert.equal(L.colorePct(50), 'top'); assert.equal(L.colorePct(25), 'mid'); assert.equal(L.colorePct(24), 'low');
  assert.equal(L.recStr({ rv: 32, r: 4.6 }), '32 rec. · 4,6');
  assert.equal(L.recStr({}), '0 rec. · ');
  assert.equal(L.indirizzoBreve('Via Roma, 10, 10100 Torino TO', 'Torino'), 'Via Roma 10, Torino');
  assert.equal(L.indirizzoBreve('', 'Torino'), 'Torino');
});

test('nomeFile: data AAMMGG, categoria, quartiere senza spazi', () => {
  assert.equal(L.nomeFile(z, '2026-10-23'), '261023-Agenzia immobiliare-Crocetta');
});

test('jobStampa: struttura attesa da motore/report.py', () => {
  const job = L.jobStampa(z, [P.p1, P.p2], { data: '2026-10-23', richiesta: 'r1' });
  assert.equal(job.richiesta, 'r1');
  assert.equal(job.file, '261023-Agenzia immobiliare-Crocetta');
  assert.equal(job.punti.length, 9);
  assert.equal(job.analisi.length, 2);
  assert.equal(job.lat_centro, 45.06);
  assert.match(job.occhiello, /Crocetta, Torino/);
  for (const a of job.analisi) for (const k of ['name', 'pid', 'lat', 'lng', 'date', 'title', 'subtitle', 'stats', 'list_title', 'list_head', 'list', 'cosa', 'method']) assert.ok(k in a, k);
});

test('la fixture usa un id di zona valido', () => { assert.match(ID, /^[a-z0-9-]+$/); });

test('jobFogli: tipo, nome file per una o più attività, griglia AI', () => {
  const { zona } = require('./fixture/zona.js');
  const z = zona('2026-10-23');
  assert.equal(L.haAI(z), false);
  z.punti_ai = z.punti.map(([la, lo]) => [la, lo, []]);
  assert.equal(L.haAI(z), true);
  const uno = L.jobFogli(z, [z.prospect.p1], { data: '2026-10-24' });
  assert.equal(uno.tipo, 'fogli');
  assert.match(uno.file, /^261024-.+-.+-[^-]+$/);
  assert.ok(!uno.file.endsWith('-Fogli'));
  const due = L.jobFogli(z, [z.prospect.p1, z.prospect.p2], { data: '2026-10-24' });
  assert.ok(due.file.endsWith('-Fogli'));
  assert.equal(due.fogli.length, 2);
  assert.equal(due.punti_ai.length, z.punti.length);
});

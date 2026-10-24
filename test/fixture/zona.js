/* Zona di prova (dati inventati, nessun dato reale) secondo docs/SCHEMA-DATI.md.
   Griglia 3×3 attorno a (45.0600, 7.6600); passo ~220 m. */
const ID = 'torino-prova';
const LA = 45.06, LO = 7.66, PASSO = 0.002;

const attivita = {
  pA: { n: 'Agenzia Alfa s.a.s.', b: 'Agenzia Alfa', a: 'Via Roma 10, 10100 Torino TO', la: LA, lo: LO, r: 4.6, rv: 32, t: '011 111 1111', w: 'https://alfa.example', c: true, cv: '2026-10-01', u: 1 },
  pB: { n: 'Immobiliare Beta', b: 'Immobiliare Beta', a: 'Via Po 8, 10100 Torino TO', la: LA + PASSO, lo: LO, r: 4.2, rv: 12, t: '011 222 2222', c: false, cv: '2026-10-01', u: 1 },
  pC: { n: 'Gamma Casa', b: 'Gamma Casa', a: 'Corso Vittorio 3, 10100 Torino TO', la: LA, lo: LO + PASSO, r: 4.8, rv: 80, u: 1 },
  pD: { n: 'Delta RE/MAX', b: 'RE/MAX Delta', a: 'Via Garibaldi 5, 10100 Torino TO', la: LA - PASSO, lo: LO, r: 4.0, rv: 8, u: 1 },
  pE: { n: 'Epsilon Studio', b: 'Epsilon Studio', a: 'Via Lagrange 2, 10100 Torino TO', la: LA, lo: LO - PASSO, r: 3.9, rv: 25, claimed: false, u: 1 },
};

/* ogni riga: [lat, lng, [place_id in ordine di posizione]] */
const punti = [];
const ordini = [
  ['pA', 'pB', 'pC', 'pD'], ['pB', 'pA', 'pC'], ['pC', 'pB', 'pD', 'pA'],
  ['pB', 'pC', 'pD', 'pE', 'pA'], ['pA', 'pC', 'pB', 'pD'], ['pC', 'pD', 'pB'],
  ['pD', 'pB', 'pC', 'pE'], ['pC', 'pB', 'pD', 'pE', 'pA'], ['pB', 'pC', 'pD'],
];
for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) punti.push([+(LA + (1 - r) * PASSO).toFixed(6), +(LO + (c - 1) * PASSO).toFixed(6), ordini[r * 3 + c]]);

function prospect(id, pid, nome, extra = {}) {
  return { id, pid, nome, indirizzo: attivita[pid].a, stato: 'Da contattare', priorita: '1 Caldo', segmento: 'Agenzia immobiliare', prossima: '', data_prossima: '', u: 1000, ...extra };
}

/* oggi: 'AAAA-MM-GG' del fuso Europe/Rome, per avere il giro di oggi */
function zona(oggi) {
  return {
    v: 1,
    meta: { quartiere: 'Crocetta', citta: 'Torino', categoria: 'Agenzia immobiliare', keyword: 'agenzia immobiliare', frase_kw: 'agenzia immobiliare', centrata: 'sulla sede',
      data: '2026-10-20', data_testo: '20 ottobre 2026', lat: LA, lng: LO, griglia: 3, lato: '1 km', report_key: 'k1', luogo: 'agenzia', u: 1 },
    attivita,
    punti,
    prospect: {
      p1: prospect('p1', 'pA', 'Agenzia Alfa s.a.s.', { priorita: '1 Caldo', prossima: 'Telefonare', data_prossima: oggi, giro: { data: oggi, ordine: 1, orario: '09:30' } }),
      p2: prospect('p2', 'pB', 'immobiliare beta', { priorita: '2 Tiepido', giro: { data: oggi, ordine: 2 } }),
      p3: prospect('p3', 'pE', 'Epsilon Studio', { priorita: '0 Invisibile', stato: 'Contattato' }),
      p4: prospect('p4', 'pD', 'RE/MAX Delta', { priorita: '3 Rete' }),
      p5: prospect('p5', 'pC', 'Gamma Casa', { priorita: '0 Invisibile', stato: 'Chiuso perso', del: true, u: 2000 }),
    },
    registro: {},
  };
}

module.exports = { ID, zona, attivita, punti, LA, LO, PASSO };

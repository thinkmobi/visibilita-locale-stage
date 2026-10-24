/* Logica condivisa: metriche dalla griglia, bozze dei testi, preparazione di stampa.json.
   Gira nel browser (window.L) e in Node (require) per i test. */
(function (root) {
  const L = {};
  const ORD = ['primo', 'secondo', 'terzo', 'quarto', 'quinto', 'sesto', 'settimo', 'ottavo', 'nono', 'decimo',
    'undicesimo', 'dodicesimo', 'tredicesimo', 'quattordicesimo', 'quindicesimo', 'sedicesimo', 'diciassettesimo',
    'diciottesimo', 'diciannovesimo', 'ventesimo'];
  const LUOGO = {
    ufficio: ['dal suo ufficio', "dall'ufficio", 'Davanti al suo ufficio'],
    agenzia: ['dalla sua agenzia', "dall'agenzia", "Davanti all'agenzia"],
    sede: ['dalla sua sede', 'dalla sede', 'Davanti alla sua sede'],
    negozio: ['dal suo negozio', 'dal negozio', 'Davanti al suo negozio'],
    locale: ['dal suo locale', 'dal locale', 'Davanti al suo locale'],
    studio: ['dal suo studio', 'dallo studio', 'Davanti al suo studio'],
    circolo: ['dal suo circolo', 'dal circolo', 'Davanti al suo circolo'],
    scuola: ['dalla sua scuola', 'dalla scuola', 'Davanti alla sua scuola'],
  };
  L.LUOGHI = Object.keys(LUOGO);
  L.ordinale = (n) => ORD[n - 1] || n + '°';
  /* posizioni sempre in cifre: "al 6° posto", "all'8° posto"; breve: "al 6°" */
  const art = (n) => ([8, 11, 18].includes(n) || String(n).startsWith('8') ? "all'" : 'al ');
  L.alPostoBreve = (n) => `${art(n)}${n}°`;
  L.alPosto = (n) => `${L.alPostoBreve(n)} posto`;
  L.virgola = (x, d = 1) => (x == null ? '' : Number(x).toFixed(d).replace('.', ','));

  L.dist = (la1, lo1, la2, lo2) =>
    Math.hypot((la1 - la2) * 111320, (lo1 - lo2) * 111320 * Math.cos(la1 * Math.PI / 180));
  L.tondo = (m) => (m < 50 ? Math.round(m / 5) * 5 : Math.round(m / 10) * 10);

  L.posizione = (p) => p.pid; // place_id del prospect
  L.coord = (z, p) => {
    const a = z.attivita[p.pid] || {};
    return [p.lat ?? a.la, p.lng ?? a.lo];
  };

  /* metriche di un'attività su tutta la griglia */
  L.metriche = (z, pid) => {
    const punti = z.punti || [];   // zona senza griglia: metriche a zero invece di un errore
    const N = punti.length;
    const ranks = punti.map(([, , r]) => { const i = r.indexOf(pid); return i < 0 ? null : i + 1; });
    const trovati = ranks.filter((r) => r);
    return {
      N, ranks,
      top3: trovati.filter((r) => r <= 3).length,
      top20: trovati.length,
      solv: N ? trovati.filter((r) => r <= 3).length / N : 0,
      atrp: N ? ranks.reduce((s, r) => s + (r || 21), 0) / N : null,
      arp: trovati.length ? trovati.reduce((s, r) => s + r, 0) / trovati.length : null,
    };
  };

  L.puntiOrdinati = (z, p) => {
    const [la, lo] = L.coord(z, p);
    return z.punti.map((pt, i) => ({ i, d: L.dist(la, lo, pt[0], pt[1]), rank: (pt[2].indexOf(p.pid) + 1) || null }))
      .sort((a, b) => a.d - b.d);
  };

  /* punto da cui prendere la classifica: il più vicino; se lì è già nei primi 3, il primo punto
     ad almeno 200 m in cui scende oltre il terzo posto ("a distanze crescenti") */
  L.puntoLista = (z, p) => {
    const ord = L.puntiOrdinati(z, p);
    const r = p.report || {};
    if (r.punto != null) return ord.find((o) => o.i === r.punto) || ord[0];
    if (ord[0].rank && ord[0].rank <= 3) return ord.find((o) => o.d >= 200 && (!o.rank || o.rank > 3)) || ord[0];
    return ord[0];
  };

  L.colorePct = (x) => (x >= 50 ? 'top' : x >= 25 ? 'mid' : 'low');
  L.recStr = (a) => `${a.rv ?? 0} rec. · ${L.virgola(a.r)}`;
  L.nomeBreve = (z, pid) => { const a = z.attivita[pid] || {}; return a.b || a.n || ''; };
  L.indirizzoBreve = (ind, citta) => {
    const parti = (ind || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (parti.length >= 3 && /^\d/.test(parti[1])) return `${parti[0]} ${parti[1]}, ${citta}`;
    return parti[0] ? `${parti[0]}, ${citta}` : citta;
  };
  const luogo = (z, p) => LUOGO[(p.report && p.report.luogo) || z.meta.luogo || 'ufficio'] || LUOGO.ufficio;

  L.classifica = (z, p) => {
    const pt = L.puntoLista(z, p);
    const lista = z.punti[pt.i][2];
    const me = z.attivita[p.pid] || { rv: 0, r: null };
    const riga = (rk, pid) => [rk, L.nomeBreve(z, pid), L.recStr(z.attivita[pid] || {}), pid === p.pid];
    let out;
    if (!pt.rank) out = lista.slice(0, 5).map((pid, i) => riga(i + 1, pid)).concat([[null, L.nomeBreve(z, p.pid) + ' · non compare', L.recStr(me), true]]);
    else if (pt.rank <= 7) out = lista.slice(0, pt.rank).map((pid, i) => riga(i + 1, pid));
    else out = lista.slice(0, 5).map((pid, i) => riga(i + 1, pid)).concat([riga(pt.rank, p.pid)]);
    return { pt, righe: out, vicino: L.puntiOrdinati(z, p)[0] };
  };

  L.titoloLista = () => 'Chi la precede su Google';
  /* intestazione della tabella: da quale punto della griglia viene la classifica */
  L.testaLista = (z, p) => {
    const { pt } = L.classifica(z, p);
    const d = L.tondo(pt.d), lu = luogo(z, p);
    return (d < 30 ? lu[2] : `A ${d} m ${lu[0]}`).toUpperCase();
  };

  /* bozza deterministica di titolo e "Cosa vuol dire": zero token, da rifinire a mano */
  L.bozza = (z, p) => {
    const m = L.metriche(z, p.pid);
    const { pt, righe, vicino } = L.classifica(z, p);
    const a = z.attivita[p.pid] || {};
    const nome = L.nomeBreve(z, p.pid);
    const lu = luogo(z, p);
    const dv = L.tondo(vicino.d);
    const a_dist = dv < 30 ? lu[2] : `A ${dv} metri ${lu[0]}`;
    const fuori = m.N - m.top20, pf = Math.round(fuori / m.N * 100);
    const sopra = righe.filter((r) => !r[3] && r[0] && (!pt.rank || r[0] < pt.rank));
    const deboli = sopra.filter((r) => parseInt(r[2], 10) < (a.rv || 0));
    let titolo, cosa;
    if (!m.top20) {
      titolo = `${a_dist}, su Google non compare.`;
      cosa = `In nessuno dei ${m.N} punti della zona compare tra i primi 20 risultati.` +
        (a.rv ? ` Le sue ${a.rv} recensioni a ${L.virgola(a.r)} restano fuori da questa ricerca.` : '');
    } else if (!vicino.rank || vicino.rank > 3) {
      titolo = vicino.rank ? `${a_dist}, su Google è ${L.alPosto(vicino.rank)}.` : `${a_dist}, su Google non compare.`;
      cosa = (deboli.length ? (deboli.length === 1 ? 'Davanti a Lei compare una concorrente' : `Davanti a Lei compaiono ${deboli.length} concorrenti`) + ` con meno recensioni delle sue ${a.rv}. ` : '') +
        `In ${fuori} punti su ${m.N} (${pf}%) non compare tra i primi 20 risultati.`;
    } else {
      titolo = `${lu[2]} è ${L.alPosto(vicino.rank)}. A ${L.tondo(pt.d)} metri ` +
        (pt.rank ? `è ${L.alPostoBreve(pt.rank)}.` : 'non compare più.');
      cosa = `La visibilità si ferma vicino alla sede. In ${fuori} punti su ${m.N} (${pf}%) non compare tra i primi 20 risultati.`;
    }
    return { titolo, cosa };
  };

  L.analisi = (z, p) => {
    const m = L.metriche(z, p.pid);
    const a = z.attivita[p.pid] || {};
    const r = p.report || {};
    const b = L.bozza(z, p);
    const pc = (n) => Math.round(n / m.N * 100);
    const [la, lo] = L.coord(z, p);
    return {
      name: L.nomeBreve(z, p.pid) || p.nome, pid: p.pid, lat: la, lng: lo, date: z.meta.data_testo,
      title: r.titolo || b.titolo,
      subtitle: r.sottotitolo || `${L.nomeBreve(z, p.pid) || p.nome} · ${L.indirizzoBreve(p.indirizzo || a.a, z.meta.citta)}`,
      stats: [
        { big: `${m.top3} su ${m.N}`, pct: pc(m.top3) + '%', lab: 'punti in cui compare tra le prime 3 posizioni', color: L.colorePct(pc(m.top3)) },
        { big: `${m.top20} su ${m.N}`, pct: pc(m.top20) + '%', lab: 'punti in cui compare tra le prime 20 posizioni', color: L.colorePct(pc(m.top20)) },
        { big: String(a.rv ?? 0), pct: '', lab: `recensioni, media ${L.virgola(a.r)}`, color: 'ink' },
      ],
      list_title: r.titolo_lista || L.titoloLista(z, p),
      list_head: L.testaLista(z, p),
      unclaimed: a.c === false,
      list: L.classifica(z, p).righe,
      cosa: r.cosa || b.cosa,
      method: `Rilevazione del ${z.meta.data_testo} sui risultati pubblici di Google Maps, quelli che vede chiunque faccia una ricerca: ` +
        `gli annunci a pagamento sono esclusi. La ricerca «${z.meta.keyword}» è stata ripetuta da ${m.N} punti diversi disposti su una griglia ` +
        `di ${z.meta.lato} centrata ${z.meta.centrata}. I risultati possono variare nel tempo e da punto a punto.`,
    };
  };

  L.nomeFile = (z, data) => {
    const d = (data || new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date())).replace(/-/g, '').slice(2);
    const q = (z.meta.quartiere || '').replace(/[^\p{L}\p{N}]+/gu, '');
    return `${d}-${z.meta.categoria || 'Analisi'}-${q}`;
  };

  /* contenuto di zone/<id>/stampa.json: tutto ciò che serve al motore, nell'ordine del giro */
  L.jobStampa = (z, prospects, opz = {}) => ({
    richiesta: opz.richiesta || String(Date.now()),
    file: opz.file || L.nomeFile(z, opz.data),
    titolo_pdf: `Rilevazione di quartiere ${z.meta.quartiere}: due analisi per foglio`,
    occhiello: `Google Maps  ·  «${z.meta.keyword}»  ·  ${z.meta.quartiere}, ${z.meta.citta}`,
    lat_centro: z.meta.lat,
    sfondo: z.meta.sfondo || null,
    firma: opz.firma || null,
    prossimo_passo: z.meta.prossimo_passo,
    punti: z.punti,
    analisi: prospects.map((p) => L.analisi(z, p)),
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = L; else root.L = L;
})(typeof window !== 'undefined' ? window : globalThis);

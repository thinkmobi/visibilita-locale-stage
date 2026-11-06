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
  // «all'» solo davanti a numeri letti con vocale iniziale: 8° (ottavo), 11° (undicesimo), 80°-89°; per il resto «al» (al 18° posto)
  const art = (n) => (n === 11 || String(n).startsWith('8') ? "all'" : 'al ');
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
  L.metriche = (z, pid, campo = 'punti') => {
    const punti = z[campo] || [];   // zona senza griglia: metriche a zero invece di un errore
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

  /* percentuali mostrate: X,5 per difetto, oltre X,5 per eccesso (regola di Hector, 26/10/2026) */
  L.pct = (n, N) => (N ? Math.max(0, Math.ceil(n / N * 100 - 0.5 - 1e-9)) : 0);
  /* colore di una quota di zone tra i primi 3: verde dal 66%, giallo dal 33%, rosso sotto (regola di Hector, 26/10/2026) */
  L.colorePct = (x) => (x >= 66 ? 'top' : x >= 33 ? 'mid' : 'low');
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
    // solo le prime 3 posizioni contano: fuori = punti in cui non è tra le prime 3; l'assenza è 100 meno la presenza arrotondata
    const fuori = m.N - m.top3, pf = 100 - L.pct(m.top3, m.N);
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
        `In ${fuori} punti su ${m.N} (${pf}%) non compare tra le prime 3 posizioni.`;
    } else {
      titolo = `${lu[2]} è ${L.alPosto(vicino.rank)}. A ${L.tondo(pt.d)} metri ` +
        (pt.rank ? `è ${L.alPostoBreve(pt.rank)}.` : 'non compare più.');
      cosa = `La visibilità si ferma vicino alla sede. In ${fuori} punti su ${m.N} (${pf}%) non compare tra le prime 3 posizioni.`;
    }
    return { titolo, cosa };
  };

  L.analisi = (z, p) => {
    const m = L.metriche(z, p.pid);
    const a = z.attivita[p.pid] || {};
    const r = p.report || {};
    const b = L.bozza(z, p);
    const pc = (n) => L.pct(n, m.N);
    const [la, lo] = L.coord(z, p);
    return {
      name: L.nomeBreve(z, p.pid) || p.nome, pid: p.pid, lat: la, lng: lo, date: z.meta.data_testo,
      title: r.titolo || b.titolo,
      subtitle: r.sottotitolo || `${L.nomeBreve(z, p.pid) || p.nome} · ${L.indirizzoBreve(p.indirizzo || a.a, z.meta.citta)}`,
      stats: [
        { big: `${m.top3} su ${m.N}`, pct: pc(m.top3) + '%', lab: 'punti in cui compare tra le prime 3 posizioni', color: L.colorePct(pc(m.top3)) },
        { big: String(a.rv ?? 0), pct: '', lab: `recensioni, media ${L.virgola(a.r)}`, color: 'ink' },
      ],
      list_title: r.titolo_lista || L.titoloLista(z, p),
      list_head: L.testaLista(z, p),
      unclaimed: a.c === false && !!a.cv,
      list: L.classifica(z, p).righe,
      cosa: r.cosa || b.cosa,
      method: `Rilevazione del ${z.meta.data_testo} sui risultati pubblici di Google Maps, quelli che vede chiunque faccia una ricerca: ` +
        `gli annunci a pagamento sono esclusi. La ricerca «${z.meta.keyword}» è stata ripetuta da ${m.N} punti diversi disposti su una griglia ` +
        `di ${z.meta.lato} centrata ${z.meta.centrata}. I risultati possono variare nel tempo e da punto a punto.`,
    };
  };

  L.nomeFile = (z, data) => {
    const d = (data || new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date())).replace(/-/g, '');
    const q = (z.meta.quartiere || '').replace(/[^\p{L}\p{N}]+/gu, '');
    // categoria scritta a mano con spazi («Negozi di capsule e cialde») → NegoziDiCapsuleECialde, come le altre
    const cat = (z.meta.categoria || 'Analisi').split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
    return `${d}-${cat}-${q}`;
  };

  /* punti sullo schermo [{x, y}] → nuove posizioni [{i, x, y}] con i pin troppo vicini (meno di 26 px) disposti su un cerchio attorno al loro centro */
  L.distanziaPin = (pt, soglia = 26) => {
    const gruppo = pt.map((_, i) => i);
    const radice = (i) => (gruppo[i] === i ? i : (gruppo[i] = radice(gruppo[i])));
    for (let i = 0; i < pt.length; i++) for (let j = i + 1; j < pt.length; j++) if (Math.hypot(pt[i].x - pt[j].x, pt[i].y - pt[j].y) < soglia) gruppo[radice(j)] = radice(i);
    const per = {}; pt.forEach((_, i) => (per[radice(i)] = per[radice(i)] || []).push(i));
    const out = pt.map((q, i) => ({ i, x: q.x, y: q.y }));
    for (const ids of Object.values(per)) {
      if (ids.length < 2) continue;
      const cx = ids.reduce((a, i) => a + pt[i].x, 0) / ids.length, cy = ids.reduce((a, i) => a + pt[i].y, 0) / ids.length;
      const r = 15 / Math.sin(Math.PI / ids.length);   // pin da 28 px: centri a 30 px almeno
      // posto di ogni pin nel cerchio: dalla sua direzione reale rispetto al centro del gruppo, non dall'ordine della lista,
      // così spostando una tappa nel giro ogni pin resta al suo posto e cambia solo il numero (con coordinate uguali decide la chiave k)
      const ang = (i) => Math.atan2(pt[i].y - cy, pt[i].x - cx);
      const ord = [...ids].sort((p, q) => ang(p) - ang(q) || String(pt[p].k || '').localeCompare(String(pt[q].k || '')) || p - q);
      const a0 = Math.hypot(pt[ord[0]].x - cx, pt[ord[0]].y - cy) > .5 ? ang(ord[0]) : -Math.PI / 2;
      ord.forEach((i, k) => { const a = a0 + (2 * Math.PI * k) / ids.length; out[i].x = cx + r * Math.cos(a); out[i].y = cy + r * Math.sin(a); });
    }
    return out;
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

  /* fogli da lasciare porta a porta (A4 orizzontale, uno per attività): Maps contro AI Mode sulla stessa griglia */
  /* priorità di un nuovo prospect. Con la scansione AI Mode il criterio è AI Mode (il taglio primario dei fogli):
     invisibile = AI Mode non lo cita in nessuna zona; caldo = almeno 20 recensioni e tra i primi 3 su AI Mode in meno di metà delle zone
     (reputazione da difendere, visibilità AI da costruire); tiepido = tutti gli altri. Senza AI Mode resta il criterio su Google Maps. */
  L.SOGLIA_REC = 20;
  L.priorita = (z, pid, rete) => {
    const a = (z.attivita || {})[pid] || {};
    const rv = a.rv || 0;
    if (rete) return { prio: '3 Rete', base: L.haAI(z) ? 'ai' : 'maps' };
    if (L.haAI(z)) {
      const m = L.metriche(z, pid, 'punti_ai');
      const debole = L.pct(m.top3, m.N) < 50;
      const prio = !m.top20 ? (rv >= L.SOGLIA_REC ? '1 Caldo' : '0 Invisibile') : (rv >= L.SOGLIA_REC && debole ? '1 Caldo' : '2 Tiepido');
      return { prio, base: 'ai' };
    }
    const m = L.metriche(z, pid);
    const prio = rv >= L.SOGLIA_REC && (!m.top20 || !m.top3) ? '1 Caldo' : !m.top20 ? '0 Invisibile' : '2 Tiepido';
    return { prio, base: 'maps' };
  };
  /* gancio commerciale: parte da AI Mode quando c'è */
  L.gancio = (z, pid) => {
    const a = (z.attivita || {})[pid] || {};
    const m = L.metriche(z, pid);
    const rec = `${a.rv || 0} recensioni a ${L.virgola(a.r)}`;
    if (L.haAI(z)) {
      const ai = L.metriche(z, pid, 'punti_ai');
      return (!ai.top20 ? `Google AI Mode non la cita in nessuna delle ${ai.N} zone` : `Google AI Mode la mette tra i primi 3 in ${ai.top3} zone su ${ai.N} (${L.pct(ai.top3, ai.N)}%)`) +
        `; su Google Maps in ${m.top3} (${L.pct(m.top3, m.N)}%); ${rec}`;
    }
    return !m.top20 ? `Non compare tra i primi 20 in nessuno dei ${m.N} punti` : `${rec}; nel top 3 in ${m.top3} punti su ${m.N}, presente in ${m.top20}`;
  };
  L.haAI = (z) => !!(z && z.punti_ai && z.punti && z.punti_ai.length === z.punti.length);
  /* AI Mode della stessa attività: metriche sulla griglia AI e zone in cui Maps la mette tra i primi 3 e AI Mode no */
  L.metricheAI = (z, pid) => {
    if (!L.haAI(z)) return null;
    const m = L.metriche(z, pid, 'punti_ai'), mm = L.metriche(z, pid);
    const perse = mm.ranks.map((r, i) => !!(r && r <= 3 && !(m.ranks[i] && m.ranks[i] <= 3)));
    return { ...m, perse, nPerse: perse.filter(Boolean).length };
  };
  L.jobFogli = (z, prospects, opz = {}) => {
    const fogli = prospects.map((p) => { const a = z.attivita[p.pid] || {}; const [la, lo] = L.coord(z, p);
      return { pid: p.pid, nome: p.nome || a.n || '', indirizzo: p.indirizzo || a.a || '', lat: la ?? null, lng: lo ?? null }; });
    const nomeAtt = fogli.length === 1 ? '-' + (fogli[0].nome || '').replace(/[^\p{L}\p{N}]+/gu, '') : '-Fogli';
    return {
      tipo: 'fogli',
      richiesta: opz.richiesta || String(Date.now()),
      file: opz.file || L.nomeFile(z, opz.data) + nomeAtt,
      titolo_pdf: `Visibilità su Google AI Mode e Maps · ${z.meta.quartiere}`,
      keyword: z.meta.keyword, frase_kw: z.meta.frase_kw, centrata: z.meta.centrata, lato: z.meta.lato, data_testo: z.meta.data_testo,
      sfondo: z.meta.sfondo || null,
      firma: opz.firma || null,
      punti: z.punti, punti_ai: L.haAI(z) ? z.punti_ai : null,   // griglia AI solo se allineata ai punti Maps
      fogli,
    };
  };

  /* ---------- analisi dedicata (deck 16:9): dati per motore/analisi.html ---------- */
  /* righe della griglia da nord a sud, colonne da ovest a est (stesso ordine delle mappe dell'app) */
  L.righe = (z, campo = 'punti') => {
    const pt = z.punti || []; const n = z.meta.griglia || Math.round(Math.sqrt(pt.length));
    const idx = pt.map((_, i) => i).sort((a, b) => (pt[b][0] - pt[a][0]) || (pt[a][1] - pt[b][1]));
    const rows = []; for (let i = 0; i < idx.length; i += n) rows.push(idx.slice(i, i + n).sort((a, b) => pt[a][1] - pt[b][1]));
    return rows;
  };
  const nomeId = (z, id) => { if (String(id).startsWith('~')) return String(id).slice(1); const a = z.attivita[id] || {}; return String(a.b || a.n || '').replace(/(\s+(di|del|della|dei|e|&|-|geom\.?))+\s*$/i, '').replace(/\bS\.?\s?R\.?\s?L\.?(?=\s|$)/gi, 'srl').replace(/\bS\.?\s?A\.?\s?S\.?(?=\s|$)/gi, 's.a.s.').replace(/\bS\.?\s?N\.?\s?C\.?(?=\s|$)/gi, 's.n.c.').trim(); };
  /* quota di punti nelle prime 3 posizioni di ogni attività, dalla più presente */
  const classificaQuota = (z, campo, pid) => {
    const punti = z[campo] || []; const N = punti.length; const t3 = {}; const tutti = new Set();
    punti.forEach(([, , r]) => r.forEach((id, i) => { tutti.add(id); if (i < 3) t3[id] = (t3[id] || 0) + 1; }));
    const ar = Object.entries(t3).map(([id, c]) => ({ id, n: nomeId(z, id), v: c / N * 100, rv: (z.attivita[id] || {}).rv ?? null, me: id === pid }))
      .sort((a, b) => b.v - a.v || a.n.localeCompare(b.n));
    if (!ar.some((c) => c.me)) ar.push({ id: pid, n: nomeId(z, pid), v: 0, rv: (z.attivita[pid] || {}).rv ?? null, me: true });
    ar.forEach((c, i) => (c.pos = i + 1));
    const mi = ar.findIndex((c) => c.me);
    const lista = mi < 7 ? ar.slice(0, 7) : [...ar.slice(0, 6), ar[mi]];
    return { lista, attive: Object.keys(t3).length, totali: tutti.size };
  };
  L.datiAnalisi = (z, pid, opz = {}) => {
    const a = z.attivita[pid] || {}; const m = z.meta; const rows = L.righe(z);
    const griglia = (campo) => rows.map((r) => r.map((i) => { const k = ((z[campo] || [])[i] || [, , []])[2].indexOf(pid); return k < 0 ? 0 : k + 1; }));
    const nomi = (campo) => rows.map((r) => r.map((i) => ((z[campo] || [])[i] || [, , []])[2].slice(0, 3).filter((id) => id !== pid).map((id) => nomeId(z, id))));
    const piatta = (campo) => { const mm = L.metriche(z, pid, campo); const cl = classificaQuota(z, campo, pid);
      return { grid: griglia(campo), names: nomi(campo), arp: mm.arp, found: mm.top20, comp: cl.lista, active: cl.attive, total: cl.totali }; };
    const lato = parseFloat(String(m.lato || '').replace(',', '.')) || 4;
    return {
      business: { name: opz.nome || a.n || '', short: opz.breve || a.b || '', service: m.frase_kw || '', address: a.a || '',
        unclaimed: a.c === false && !!a.cv, rv: a.rv ?? null },
      scanDate: m.data_testo || m.data || '', kw: m.keyword || '',
      grid: { size: m.griglia || rows.length, radiusKm: lato / 2, points: (z.punti || []).length, aiPoints: L.haAI(z) ? z.punti_ai.length : 0 },
      maps: piatta('punti'), ai: L.haAI(z) ? piatta('punti_ai') : null,
      firma: opz.firma || null,
    };
  };
  /* chiave breve e stabile dell'attività per i file dell'analisi (zone/<id>/analisi/<chiave>-…) */
  L.chiaveAnalisi = (pid) => String(pid).replace(/[^A-Za-z0-9]/g, '').slice(-12);
  L.fileAnalisi = (z, pid, data) => {
    const d = (data || new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date())).replace(/-/g, '').slice(2);
    const a = z.attivita[pid] || {}; const cc = (s) => String(s || '').split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
    return `${d}-${cc(z.meta.categoria) || 'Analisi'}-${cc(z.meta.quartiere)}-${cc(a.n).slice(0, 40)}-Analisi`;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = L; else root.L = L;
})(typeof window !== 'undefined' ? window : globalThis);

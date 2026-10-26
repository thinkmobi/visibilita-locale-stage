# Visibilità locale · istruzioni per Claude Code

PWA per i giri di visibilità locale di Hector Rinaldi: prospect, giro di consegna, stampa dei report.
Produzione: https://thinkmobi.github.io/visibilita-locale/ (GitHub Pages dal branch `main`).
Questo repo contiene solo codice. I dati stanno nel repo privato `thinkmobi/visibilita-dati`: schema in `docs/SCHEMA-DATI.md`.

## Regole di lavoro
- Parla in italiano, dai del tu a Hector, risposte brevi a elenchi.
- Mai push su `main` senza il «pubblica» di Hector. Il lavoro va su un branch del giorno (`rilascio/AAMMGG`).
- Mai modificare dati reali in `visibilita-dati` senza dirlo prima. Per le prove usa `visibilita-locale-stage` e `visibilita-dati-stage`.
- Token GitHub e chiave Local Falcon li gestisce solo Hector: mai chiederli, mai scriverli in file o commit.
- Non usare OpenSEO senza richiesta esplicita.
- Nessun dato inventato: se non hai verificato, scrivi «non verificato».

## Protocollo rilasci
1. In giornata si raccolgono le richieste; il codice non si tocca, salvo bug bloccanti (PDF che non si genera, dati persi, app che non si apre).
2. Un rilascio la sera: tutte le modifiche sul branch del giorno, test completo, poi `main` solo dopo «pubblica».
3. Versione in tre punti, sempre insieme: `VERSIONE` in app.js, `CACHE = 'vl-<versione>'` in sw.js, `?v=<versione>` in index.html.
   Numerazione: v0.N.0 rilascio serale, v0.N.1 fix urgente. La «v» compare solo nel testo del Profilo.
4. Nota di rilascio breve per Hector, con promemoria di chiudere e riaprire l'app.
5. Se cambia qualcosa in `motore/`, va copiato anche in `visibilita-dati/motore` (e `.github/workflows` dai file in `motore/workflows/`): chiedi conferma prima del push lì.

## Architettura
- JavaScript senza framework: `index.html`, `app.js` (UI, sync GitHub, IndexedDB), `logica.js` (metriche e testi, gira anche in Node), `stile.css`, `sw.js` (cache offline, rete prima).
- Sync: l'app legge e scrive `zone/<id>/*.json` via API GitHub con token fine-grained salvato sul dispositivo. Merge per record con timestamp `u`, vince il più recente; `del` resta cancellato.
- `motore/`: script Python eseguiti dalle GitHub Actions del repo dati (import Local Falcon, PDF del giro, controllo siti). `salva.sh` committa con retry e rigenera in caso di conflitto.
- `strumenti/foglio-google.gs`: Apps Script del foglio «Visibilità locale · dati (sola lettura)», aggiornato ogni 15 minuti.

## Interfaccia
- Deve funzionare su iPhone (viewport 390×664) e su computer; la Tabella solo da 900 px.
- Palette: ink #18232A, sfondo #F4F5F3, verdi #1E8E3E/#34A853, giallo #F6C026, arancione #F29529, rossi #E8603C/#C5221F, blu #1A73E8.
- Alert con i colori della palette in versione chiara, mai pieni.
- Etichette di stato che descrivono l'azione reale («Consegnato», «Visitare», «Ripassare»), mai «Fatto».
- Orari a 24 ore, fuso Europe/Rome.
- Priorità: 1 Caldo (verde), 2 Tiepido (arancione), 0 Invisibile (blu), 3 Rete (grigio). Con la scansione AI Mode il criterio è AI Mode (`L.priorita`): Invisibile = AI Mode non lo cita in nessuna zona; Caldo = almeno 20 recensioni e tra i primi 3 su AI Mode in meno di metà delle zone (anche se invisibile); Tiepido = gli altri. Senza AI Mode resta il criterio su Maps (invisibile con almeno 20 recensioni → Caldo).
- AI Mode è la piattaforma primaria: viene prima di Maps in fogli, scheda prospect ed elenco attività.
- Posizioni in cifre («al 6° posto»), via `L.alPosto`.
- Barre di salvataggio uguali in tutti i fogli: «Chiudi» grigio senza modifiche, «Annulla» rosso con modifiche; a destra «✓ Salvato alle HH:MM».
- Nomi con iniziali maiuscole; sigle e marchi intatti (RE/MAX, D&D); forme societarie minuscole (s.a.s., srl).
- «Rivendicata»: vale solo il dato verificato (campi `c`/`cv`), mai il `claimed` di Local Falcon.
- Icone con sfondo trasparente; sulla Home iPhone sfondo #18232A.

## Test
- Il banco di prova è in `test/`: `cd test && npm i && npm test`. Deve essere tutto verde prima di ogni rilascio.
- Contenuto: `node` su `logica.js`, Playwright su telefono simulato (viewport 390×664) con GitHub finto in memoria e Leaflet servito in locale, `motore/report.py` sul PDF di prova.
- Non copre: sync con GitHub vero, `importa.py` e `siti.py`, Safari reale.

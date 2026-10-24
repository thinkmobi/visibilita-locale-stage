# Banco di prova

Lancio da `test/`: `npm i` (una volta), poi `npm test`.

- `logica.test.js`: test `node:test` su `logica.js` (posizioni, metriche, classifica, bozze, analisi, job di stampa).
- `e2e.test.js`: Playwright, iPhone 390×664, fuso Europe/Rome. GitHub finto in memoria (`github-finto.js`), Leaflet servito da `vendor/leaflet`, nessuna rete reale. Copre avvio con e senza token, viste, salvataggio con sha, conflitto 409 e merge, offline, mappa del giro, Genera PDF (lato app), regole di interfaccia, versione in tre punti, service worker.
- `motore.test.js`: `stampa.json` da `logica.js` sulla fixture, poi `motore/report.py` (reportlab in `test/.venv`): il PDF esiste, ha almeno una pagina, l'esito coincide.
- `fixture/zona.js`: zona inventata, nessun dato reale.

Non coperti: sync con GitHub vero, import Local Falcon (`importa.py`), controllo siti (`siti.py`), Safari/iOS reale, stampa fisica.

# Visibilità locale

App per gestire prospect, giro di consegna e stampa dei report di visibilità su Google Maps.
Questo repository contiene solo il codice dell'app: nessun dato dei clienti.
I dati stanno nel repository privato `visibilita-dati`, collegato dall'app con un token personale.

- `index.html`, `app.js`, `logica.js`, `stile.css`: l'app (funziona offline, installabile sul telefono)
- `motore/`: generatore PDF e import Local Falcon, copiati nel repository dati dal pulsante "Prepara repository"
- `motore/workflows/`: le due GitHub Actions (import scansione, generazione PDF)

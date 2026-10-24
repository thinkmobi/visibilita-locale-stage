# Schema dei dati · repo thinkmobi/visibilita-dati

Contratto tra chi scrive i dati: l'app (dal telefono), le GitHub Actions del repo dati, Claude (scansioni dal progetto «Visibilità Locale») e il foglio Google (solo lettura).
Chi cambia un campo aggiorna prima questo file, nello stesso commit.

## File per zona: `zone/<id>/`
| File | Chi scrive | Chi legge | Cosa contiene |
|---|---|---|---|
| `richiesta.json` | app, Claude | importa.yml | richiesta di import: `report_key`, `report_key_ai` (facoltativa, scansione Google AI Mode con stessa griglia e centro), `quartiere`, `citta`, `categoria`, `frase_kw`, `centrata`, `luogo` |
| `importa-esito.json` | importa.py | app | `report_key`, `stato` (ok/errore), `creata`, `punti`, `attivita`, `sfondo` (mancante se da ritentare) |
| `zona.json` | app, importa.py | app, report.py, foglio | `v`, `meta`, `attivita`, `punti`, `prospect`, `registro` |
| `sfondo.png` | importa.py, app | report.py | sfondo della mappa |
| `siti-richiesta.json` | app | siti.yml | `creata`: avvia il controllo siti |
| `siti.json` | siti.py | app | esito del controllo dei siti e P.IVA |
| `stampa.json` | app | report.yml | job di stampa preparato da `logica.js`: PDF del giro (`L.jobStampa`) o fogli da lasciare (`tipo: "fogli"`, `L.jobFogli`) |
| `stampa/esito.json`, `stampa/*.pdf` | report.py | app | PDF del giro e suo esito |

## `zona.json`
- `meta`: `quartiere`, `citta`, `categoria`, `keyword`, `frase_kw`, `centrata`, `data`, `data_testo`, `lat`, `lng`, `griglia`, `lato`, `report_key`, `report_key_ai` e `data_ai` (se importata la scansione AI Mode), `prossimo_passo`, `luogo`, `u`.
- `attivita[place_id]`: `n` nome, `b` nome breve, `a` indirizzo, `la`/`lo` coordinate, `r` voto, `rv` recensioni, `t` telefono, `w` sito, `c` rivendicata, `cv` verifica di `c`, `cat` categorie, `u`.
- `punti`: per ogni punto della griglia `[lat, lng, [place_id in ordine di posizione]]`.
- `punti_ai` (facoltativo): stessa forma e stesso ordine di `punti`, dalla scansione Google AI Mode. AI Mode usa identificativi suoi: `importa.py` abbina per nome alle attività Maps; un nome non abbinato resta come `"~nome"`. Una nuova scansione Maps senza AI cancella `punti_ai`.
- `prospect[id]` e `registro[id]`: record dell'app con timestamp `u` e `del` per le cancellazioni; i prospect puntano all'attività con `pid`.

## Regole
- Merge per record: vince `u` più recente; un record con `del` resta cancellato.
- L'import di una zona esistente non tocca `prospect` e `registro`, e conserva `b`, `c`, `cv` delle attività.
- `c` vale solo se `cv` è valorizzato (verifica OpenSEO o manuale): il `claimed` di Local Falcon non si usa.
- Root del repo: `config.json` con la firma (`firma`).

#!/usr/bin/env bash
# Importa le richieste nuove (zone/*/richiesta.json) e controlla subito i siti delle zone importate.
for rq in zone/*/richiesta.json; do
  dir=$(dirname "$rq")
  if python3 -c "import json,sys;r=json.load(open('$rq'));e=json.load(open('$dir/importa-esito.json'));sys.exit(0 if e.get('report_key')==r.get('report_key') and e.get('report_key_ai')==r.get('report_key_ai') and e.get('stato')=='ok' else 1)" 2>/dev/null; then
    # importata, ma senza sfondo: riprova solo l'immagine (al massimo 3 volte)
    if grep -q '"sfondo": "mancante"' "$dir/importa-esito.json"; then python3 motore/importa.py --sfondo "$rq" || true; else echo "già importata: $dir"; fi
    continue
  fi
  python3 motore/importa.py "$rq" || true
  if [ -f "$dir/zona.json" ]; then python3 motore/siti.py "$dir" || true; fi
done
exit 0

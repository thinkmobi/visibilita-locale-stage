#!/usr/bin/env bash
# Genera i PDF delle analisi dedicate richiesti (zone/*/analisi/*-richiesta.json) e non ancora prodotti.
shopt -s nullglob
for job in zone/*/analisi/*-richiesta.json; do
  dir=$(dirname "$job"); k=$(basename "$job" -richiesta.json)
  if python3 -c "import json,sys;j=json.load(open('$job'));e=json.load(open('$dir/$k-esito.json'));sys.exit(0 if e.get('richiesta')==j.get('richiesta') else 1)" 2>/dev/null; then
    echo "già generato: $job"; continue
  fi
  python3 motore/analisi.py "$job" || python3 -c "import json;j=json.load(open('$job'));json.dump({'richiesta':j.get('richiesta'),'errore':'generazione fallita: dati incompleti, vedi il log in Actions'},open('$dir/$k-esito.json','w'))"
done
exit 0

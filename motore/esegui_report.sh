#!/usr/bin/env bash
# Genera i PDF richiesti (zone/*/stampa.json) che non sono ancora stati prodotti.
for job in zone/*/stampa.json; do
  dir=$(dirname "$job")
  if python3 -c "import json,sys;j=json.load(open('$job'));e=json.load(open('$dir/stampa/esito.json'));sys.exit(0 if e.get('richiesta')==j.get('richiesta') else 1)" 2>/dev/null; then
    echo "già generato: $dir"; continue
  fi
  python3 motore/report.py "$job" || python3 -c "import json,os,sys;j=json.load(open('$job'));os.makedirs('$dir/stampa',exist_ok=True);json.dump({'richiesta':j.get('richiesta'),'errore':'generazione fallita: testo troppo lungo o dati incompleti, vedi il log in Actions'},open('$dir/stampa/esito.json','w'))"
done
exit 0

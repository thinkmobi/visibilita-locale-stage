#!/usr/bin/env bash
# Controlla i siti delle zone elencate in zone.txt (una cartella per riga); salta le zone senza dati.
while read -r z; do
  if [ -n "$z" ] && [ -f "$z/zona.json" ]; then python3 motore/siti.py "$z" || echo "::warning::controllo siti non riuscito per $z"; fi
done < zone.txt
exit 0

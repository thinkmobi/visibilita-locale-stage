#!/usr/bin/env bash
# Salva nel repository i file prodotti dal workflow, anche se nel frattempo l'app ha scritto.
# Uso: bash motore/salva.sh "messaggio di commit" "comando che rigenera i file"
# In caso di conflitto annulla il rebase, riparte dall'ultima versione remota e rigenera:
# così le modifiche fatte dall'app non si perdono e il workflow non finisce mai "verde" senza aver salvato.
set -u
msg="$1"; rigenera="$2"
git config user.name "visibilita-bot"
git config user.email "visibilita-bot@users.noreply.github.com"
for i in 1 2 3 4 5; do
  git add zone
  if git diff --cached --quiet; then echo "niente da salvare"; exit 0; fi
  git commit -q -m "$msg"
  if git pull -q --rebase && git push -q; then echo "salvato al tentativo $i"; exit 0; fi
  echo "conflitto o push rifiutato (tentativo $i): riparto dalla versione remota"
  git rebase --abort 2>/dev/null || true
  git fetch -q origin && git reset -q --hard origin/HEAD 2>/dev/null || git reset -q --hard "origin/$(git rev-parse --abbrev-ref HEAD)"
  sleep $((i * 4))
  bash -c "$rigenera"
done
echo "::error::salvataggio non riuscito dopo 5 tentativi"
exit 1

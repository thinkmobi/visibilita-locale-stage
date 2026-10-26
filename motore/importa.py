"""Importa una scansione Local Falcon in zone/<id>/zona.json senza passare da Claude.
Uso (GitHub Actions): LOCALFALCON_API_KEY=... python motore/importa.py zone/<id>/richiesta.json
richiesta.json: {"report_key": "e01e001722b17ba", "report_key_ai": "facoltativa, scansione AI Mode con la stessa griglia", "quartiere": "Crocetta", "citta": "Torino",
                 "categoria": "AgenzieImmobiliari", "frase_kw": "un'agenzia immobiliare", "centrata": "sulla Crocetta"}
Se zona.json esiste già, prospect e registro restano intatti: si aggiornano solo punti, attività e metadati."""
import json, math, os, sys, time, re, urllib.request, urllib.parse, urllib.error

API = "https://api.localfalcon.com/v1/reports/{}/"
MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto",
        "settembre", "ottobre", "novembre", "dicembre"]
PROSSIMO_PASSO = {
    "intro": "Questa pagina mostra solo il risultato. L'analisi completa spiega perché Google mette altre attività davanti alla sua e cosa correggere per recuperare posizioni.",
    "items": [["Concorrenti", "chi la precede, punto per punto"], ["Recensioni", "quante, quanto recenti, cosa dicono"],
              ["Assistenti AI", "se la citano nelle loro risposte"], ["Scheda Google", "le modifiche fatte senza avvisarla"]],
    "outro": "Le propongo un incontro di mezz'ora: guardiamo insieme l'analisi completa e decidiamo da dove partire."}
MAX_TENTATIVI = 3   # oltre, una richiesta che fallisce sempre non viene più ritentata a ogni workflow


class InAttesa(RuntimeError):
    """Local Falcon non ha ancora finito di elaborare la scansione"""


def num(x, tipo=float):
    try: return tipo(float(x))
    except (TypeError, ValueError): return None


def breve(nome):
    """nome corto per le classifiche stampate; si corregge a mano nell'app (Zone o scheda prospect)"""
    n = re.split(r"\s*\|\s*|\s+\*+", nome)[0]
    n = re.sub(r"(?i)^agenzia\s+immobiliare\s+(-\s+)?", "", n)
    n = re.sub(r"(?i)\s+-\s+agenzia\b.*$", "", n)
    n = re.sub(r"(?i)\btorino\s*-\s*", "", n)
    n = re.sub(r"\s+di\s+[A-Z][\w']+\s+[A-Z][\w']+.*$", "", n)
    n = re.sub(r"\s+[-–]\s+", " ", n)
    n = re.sub(r"\s{2,}", " ", n).strip(" -–")
    if n.isupper() and len(n) > 4: n = n.title()
    if len(n) > 34: n = n[:34].rsplit(" ", 1)[0]
    return n or nome[:34]


def _post(chiave, api_key, modo):
    """Local Falcon accetta la chiave come campo del form, parametro in URL o header Bearer"""
    url = API.format(chiave)
    corpo = urllib.parse.urlencode({"api_key": api_key} if modo != "bearer" else {}).encode()
    if modo == "query": url += "?" + urllib.parse.urlencode({"api_key": api_key})
    req = urllib.request.Request(url, data=corpo, method="POST")
    if modo == "bearer": req.add_header("Authorization", "Bearer " + api_key)
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.status, json.load(r)


def chiedi_report(chiave, api_key, attese=20):
    # la risposta resta in cache per il run: se il salvataggio va in conflitto, l'import si ripete senza richiamare Local Falcon
    cache = os.path.join(os.environ.get("RUNNER_TEMP", "/tmp"), f"lf-{chiave}.json")
    if os.path.exists(cache):
        return json.load(open(cache, encoding="utf-8"))
    d = _chiedi_report(chiave, api_key, attese)
    json.dump(d, open(cache, "w", encoding="utf-8"))
    return d


def _chiedi_report(chiave, api_key, attese=20):
    api_key = api_key.strip()
    modo, ultimo = None, None
    for _ in range(attese):
        for m in ([modo] if modo else ["form", "query", "bearer"]):
            try:
                stato, risposta = _post(chiave, api_key, m); modo = m; break
            except urllib.error.HTTPError as e:
                ultimo = e
                if e.code not in (401, 403): raise
        else:
            raise RuntimeError(f"Local Falcon rifiuta la chiave API ({ultimo.code}): controlla il secret LOCALFALCON_API_KEY")
        if stato == 200 and (risposta.get("data") or {}).get("data_points"):
            return risposta["data"]
        time.sleep(30)          # 202 = scansione ancora in elaborazione
    raise InAttesa("Local Falcon sta ancora elaborando la scansione (nessun punto della griglia dopo 10 minuti): riprovo al prossimo import")


def zona_da_report(d, rq, esistente=None, avvisi=None):
    z = esistente or {"v": 1, "prospect": {}, "registro": {}}
    data = (d.get("date") or "")[:10]
    try:
        a, m, g = data.split("-"); data_testo = f"{int(g)} {MESI[int(m) - 1]} {a}"
    except ValueError:
        data_testo = data
    grid = num(d.get("grid_size"), int) or 7
    raggio = num(d.get("radius")) or 1.0
    if (d.get("measurement") or "km") == "mi": raggio *= 1.609
    lato = f"{raggio * 2:g}".replace(".", ",")
    kw = d.get("keyword") or rq.get("keyword", "")
    meta = dict(z.get("meta") or {})
    meta.update({
        "quartiere": rq.get("quartiere", meta.get("quartiere", "")), "citta": rq.get("citta", meta.get("citta", "")),
        "categoria": rq.get("categoria", meta.get("categoria", "")), "keyword": kw,
        "frase_kw": rq.get("frase_kw") or meta.get("frase_kw") or f"«{kw}»",
        "centrata": rq.get("centrata") or meta.get("centrata") or f"su {rq.get('quartiere', '')}",
        "data": data, "data_testo": data_testo, "lat": num(d.get("lat")), "lng": num(d.get("lng")),
        "griglia": grid, "lato": f"{lato} × {lato} km", "report_key": d.get("report_key"),
        "prossimo_passo": meta.get("prossimo_passo") or rq.get("prossimo_passo") or PROSSIMO_PASSO,
        "luogo": rq.get("luogo") or meta.get("luogo") or "ufficio",
        "u": int(time.time() * 1000)})
    att = z.get("attivita") or {}
    ora = int(time.time() * 1000)   # i dati appena importati vincono sulle copie locali dell'app
    punti = []
    scartati = 0
    for p in d["data_points"]:
        if num(p.get("lat")) is None or num(p.get("lng")) is None:
            scartati += 1; continue
        # un risultato malformato (posizione non numerica, place_id assente) si salta senza fermare l'import
        validi = [q for q in p.get("results") or [] if isinstance(q, dict) and q.get("place_id") and num(q.get("rank"), int) is not None]
        scartati += len(p.get("results") or []) - len(validi)
        ris = sorted(validi, key=lambda q: num(q["rank"], int))
        for q in ris:
            pid = q["place_id"]
            vecchio = att.get(pid, {})
            att[pid] = {"n": q.get("name", ""), "b": vecchio.get("b") or breve(q.get("name", "")),
                        "a": q.get("address", ""), "la": num(q.get("lat")), "lo": num(q.get("lng")),
                        "r": num(q.get("rating")), "rv": num(q.get("reviews"), int) or 0,
                        "t": q.get("phone") or "", "w": q.get("display_url") or q.get("url") or "",
                        # "claimed" di Local Falcon non è affidabile (13 schede su 13 smentite il 18/10/2026):
                        # si tiene solo un dato verificato a parte (cv), altrimenti resta sconosciuto
                        "c": vecchio.get("c") if vecchio.get("cv") else None, "cv": vecchio.get("cv"), "u": ora, "cat": list((q.get("categories") or {}).values())}
        punti.append([num(p["lat"]), num(p["lng"]), [q["place_id"] for q in ris]])
    if not punti: raise RuntimeError("la scansione non contiene punti della griglia utilizzabili")
    if scartati and avvisi is not None: avvisi.append(f"{scartati} risultati o punti malformati ignorati")
    z.update({"meta": meta, "attivita": att, "punti": punti})
    return z


def _norm(nome):
    """nome confrontabile: minuscole, senza accenti, punteggiatura e parole di servizio"""
    import unicodedata
    n = unicodedata.normalize("NFKD", nome or "").encode("ascii", "ignore").decode().lower()
    n = re.sub(r"[^a-z0-9]+", " ", n)
    return " ".join(w for w in n.split() if w not in {"di", "del", "della", "e", "il", "la", "lo", "srl", "sas", "snc", "spa", "torino"})


def _frase(nome):
    """come _norm ma senza togliere parole: per cercare il marchio come frase intera"""
    import unicodedata
    n = unicodedata.normalize("NFKD", nome or "").encode("ascii", "ignore").decode().lower()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", n).split())


def abbina(nome, indice, punto=None):
    """place_id dell'attività Maps con lo stesso nome della risposta AI Mode, o None.
    AI Mode usa identificativi suoi: l'unico aggancio è il nome. Prima uguaglianza, poi contenimento
    (parole intere, almeno 8 caratteri e metà del nome), poi parole in comune (almeno il 60%); un abbinamento ambiguo non vale."""
    k = _norm(nome)
    if not k: return None
    if k in indice["esatto"]:
        # stesso nome in più sedi: si sceglie la più vicina al punto, come per i marchi
        tutti = indice.get("omonimi", {}).get(k) or [indice["esatto"][k]]
        pos = indice.get("pos") or {}
        vicine = [(math.hypot(pos[c][0] - punto[0], (pos[c][1] - punto[1]) * .707), c) for c in tutti if punto and pos.get(c)]
        return min(vicine)[1] if len(tutti) > 1 and vicine else indice["esatto"][k]
    # AI Mode cita spesso il marchio ("Torino Case", "Toscano"): vale se la frase intera compare in un solo nome Maps
    f = _frase(nome)
    generiche = {"agenzia", "agenzie", "immobiliare", "immobiliari", "studio", "scuola", "centro", "istituto", "torino", "di", "e",
                 "real", "estate", "group", "srl", "sas", "snc", "spa"}
    if len(f) >= 5 and indice.get("frasi") and any(w not in generiche for w in f.split()):
        cand = {pid for ff, pid in indice["frasi"] if f" {f} " in f" {ff} "}
        if len(cand) == 1: return cand.pop()
        if len(cand) > 1:
            # marchio con più sedi (Tecnocasa, Abytare): AI Mode non dice quale, si attribuisce alla sede più vicina al punto
            pos = indice.get("pos") or {}
            vicine = [(math.hypot(pos[c][0] - punto[0], (pos[c][1] - punto[1]) * .707), c) for c in cand if punto and pos.get(c)]
            return min(vicine)[1] if vicine else None
    def contiene(a, b):   # b dentro a come parole intere, e b copre almeno metà di a: "scuola psicoterapia" non abbina ogni scuola
        return len(b) >= 8 and len(b) / len(a) >= .5 and f" {b} " in f" {a} "
    cand = {pid for kk, pid in indice["esatto"].items() if contiene(k, kk) or contiene(kk, k)}
    if len(cand) == 1: return cand.pop()
    if cand: return None
    pk = set(k.split()); migliori, top = [], 0
    for kk, pid in indice["esatto"].items():
        pp = set(kk.split()); j = len(pk & pp) / len(pk | pp)
        if j > top: migliori, top = [pid], j
        elif j == top: migliori.append(pid)
    return migliori[0] if top >= .6 and len(set(migliori)) == 1 else None


def punti_ai_da_report(d, z, avvisi=None):
    """griglia AI Mode della stessa zona: [lat, lng, [place_id Maps o "~nome" se non abbinato]] in ordine di posizione.
    La scansione AI deve avere la stessa griglia della scansione Maps, altrimenti il confronto punto per punto non regge."""
    indice = {"esatto": {}, "frasi": [], "pos": {}, "omonimi": {}}
    for pid, a in (z.get("attivita") or {}).items():
        if a.get("la") is not None and a.get("lo") is not None: indice["pos"][pid] = (a["la"], a["lo"])
        k = _norm(a.get("n"))   # solo il nome completo: i nomi brevi automatici ("Istituto") abbinerebbero a caso
        if k: indice["esatto"].setdefault(k, pid); indice["omonimi"].setdefault(k, []).append(pid)
        indice["frasi"].append((_frase(a.get("n")), pid))
    pm = z.get("punti") or []
    pa, non_abbinati = [], set()
    for p in d.get("data_points") or []:
        la, lo = num(p.get("lat")), num(p.get("lng"))
        if la is None or lo is None: continue
        ris = sorted([q for q in p.get("results") or [] if isinstance(q, dict) and num(q.get("rank"), int) is not None],
                     key=lambda q: num(q["rank"], int))
        ids = []
        for q in ris:
            pid = abbina(q.get("name", ""), indice, (la, lo))
            if not pid: non_abbinati.add(q.get("name", "")); pid = "~" + (q.get("name") or "")
            ids.append(pid)
        pa.append([la, lo, ids])
    if len(pa) != len(pm):
        raise RuntimeError(f"la scansione AI Mode ha {len(pa)} punti, quella Maps {len(pm)}: servono stessa griglia e stesso raggio")
    # stesso ordine dei punti Maps: si abbina ogni punto AI al punto Maps più vicino
    ordinati = []
    for la, lo, _ in pm:
        j = min(range(len(pa)), key=lambda i: (pa[i][0] - la) ** 2 + (pa[i][1] - lo) ** 2)
        if abs(pa[j][0] - la) > .002 or abs(pa[j][1] - lo) > .002:
            raise RuntimeError("la griglia AI Mode non coincide con quella Maps: rifai la scansione AI con lo stesso centro")
        ordinati.append(pa[j])
    if non_abbinati and avvisi is not None:
        avvisi.append(f"AI Mode: {len(non_abbinati)} nomi non abbinati alle attività Maps")
    return ordinati


def scarica(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": "visibilita-locale/1.0"})
    with urllib.request.urlopen(req, timeout=90) as r, open(dest, "wb") as f:
        f.write(r.read())


MAX_SFONDO = 3


def ritenta_sfondo(percorso):
    """zona già importata ma senza sfondo (es. 404 temporaneo di Local Falcon): riprova a scaricare solo l'immagine.
    Non tocca prospect, registro né punti: aggiunge meta.sfondo a zona.json e aggiorna l'esito."""
    cartella = os.path.dirname(os.path.abspath(percorso))
    fe, fz, fs = (os.path.join(cartella, n) for n in ("importa-esito.json", "zona.json", "sfondo.png"))
    esito = json.load(open(fe, encoding="utf-8"))
    if esito.get("stato") != "ok" or esito.get("sfondo") != "mancante": return
    n = esito.get("tentativi_sfondo", 1)
    if n >= MAX_SFONDO:
        print(f"sfondo: sospeso dopo {n} tentativi"); return
    try:
        api_key = os.environ.get("LOCALFALCON_API_KEY")
        if not api_key: raise RuntimeError("manca il secret LOCALFALCON_API_KEY nel repository dati")
        d = chiedi_report(esito["report_key"], api_key)
        if not d.get("image"): raise RuntimeError("Local Falcon non ha fornito l'immagine")
        scarica(d["image"], fs)
        z = json.load(open(fz, encoding="utf-8"))
        z["meta"]["sfondo"] = "sfondo.png"
        json.dump(z, open(fz, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        for k in ("sfondo", "tentativi_sfondo", "errore_sfondo"): esito.pop(k, None)
        esito["avviso"] = "; ".join(a for a in (esito.get("avviso") or "").split("; ") if a and not a.startswith("sfondo non scaricato")) or None
        if not esito["avviso"]: esito.pop("avviso")
        print("sfondo scaricato al nuovo tentativo")
    except InAttesa as e:
        print(f"sfondo: report non ancora pronto ({e})")
    except Exception as e:
        if os.path.exists(fs) and "sfondo" not in json.load(open(fz, encoding="utf-8"))["meta"]: os.remove(fs)
        esito["tentativi_sfondo"] = n + 1; esito["errore_sfondo"] = str(e)
        print(f"sfondo: tentativo {n + 1} non riuscito ({e})")
    json.dump(esito, open(fe, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def main(percorso):
    cartella = os.path.dirname(os.path.abspath(percorso))
    fe = os.path.join(cartella, "importa-esito.json")
    try:
        prima = json.load(open(fe, encoding="utf-8"))
    except Exception:
        prima = {}
    rq = {}
    esito = {"report_key": None, "stato": "errore"}
    try:
        rq = json.load(open(percorso, encoding="utf-8"))
        esito.update(report_key=rq.get("report_key"), creata=rq.get("creata"))
        # stessa richiesta già fallita più volte: non si ritenta a ogni workflow; una nuova richiesta dall'app azzera il conto
        stessa = prima.get("report_key") == esito["report_key"] and prima.get("creata") == esito["creata"]
        n = prima.get("tentativi", 0) if stessa and prima.get("stato") == "errore" else 0
        if n >= MAX_TENTATIVI:
            ultimo = prima.get("errore") or prima.get("messaggio") or "errore sconosciuto"
            esito.update(tentativi=n, errore=ultimo,
                         messaggio=f"import sospeso dopo {n} tentativi non riusciti ({ultimo}): invia di nuovo la richiesta dall'app per riprovare")
            json.dump(esito, open(fe, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            print(esito["messaggio"])
            return
        esito["tentativi"] = n + 1
        api_key = os.environ.get("LOCALFALCON_API_KEY")
        if not api_key: raise RuntimeError("manca il secret LOCALFALCON_API_KEY nel repository dati")
        d = chiedi_report(rq["report_key"], api_key)
        fz = os.path.join(cartella, "zona.json")
        esistente = json.load(open(fz, encoding="utf-8")) if os.path.exists(fz) else None
        avvisi = []
        z = zona_da_report(d, rq, esistente, avvisi)
        z["id"] = os.path.basename(cartella)
        if rq.get("report_key_ai"):
            # la scansione AI Mode è facoltativa: se non va, la zona si importa comunque e il foglio resta non disponibile
            try:
                dai = chiedi_report(rq["report_key_ai"], api_key)
                if (dai.get("platform") or "").lower() not in ("aimode", "gaio"):
                    raise RuntimeError(f"la scansione {rq['report_key_ai']} non è di Google AI Mode ({dai.get('platform')})")
                z["punti_ai"] = punti_ai_da_report(dai, z, avvisi)
                z["meta"].update(report_key_ai=rq["report_key_ai"], data_ai=(dai.get("date") or "")[:10])
            except InAttesa:
                raise
            except Exception as e:
                z.pop("punti_ai", None); z["meta"].pop("report_key_ai", None); z["meta"].pop("data_ai", None)
                avvisi.append(f"AI Mode non importato: {e}")
        elif z["meta"].get("report_key_ai") and esistente and (esistente.get("meta") or {}).get("report_key") != rq["report_key"]:
            # nuova scansione Maps senza AI: la griglia AI vecchia non è più confrontabile
            z.pop("punti_ai", None); z["meta"].pop("report_key_ai", None); z["meta"].pop("data_ai", None)
        fs = os.path.join(cartella, "sfondo.png")
        try:
            if not d.get("image"): raise RuntimeError("Local Falcon non ha fornito l'immagine")
            scarica(d["image"], fs); z["meta"]["sfondo"] = "sfondo.png"
        except Exception as e:  # la stampa funziona anche senza sfondo, ma non con la mappa della scansione precedente
            z["meta"].pop("sfondo", None)
            if os.path.exists(fs): os.remove(fs)
            avvisi.insert(0, f"sfondo non scaricato: {e}")
        json.dump(z, open(fz, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        esito = {"report_key": esito["report_key"], "creata": esito["creata"], "stato": "ok",
                 "punti": len(z["punti"]), "attivita": len(z["attivita"])}
        if rq.get("report_key_ai"):   # esegui_import.sh confronta anche questa: aggiungere l'AI a una zona già importata rilancia l'import
            esito["report_key_ai"] = rq["report_key_ai"]
            if z.get("punti_ai"): esito["punti_ai"] = len(z["punti_ai"])
        if avvisi: esito["avviso"] = "; ".join(avvisi)
        if "sfondo" not in z["meta"]: esito.update(sfondo="mancante", tentativi_sfondo=1)   # si riprova ai run successivi
    except InAttesa as e:   # non è un errore: l'app mostra l'attesa e il conto dei tentativi non sale
        esito.update(stato="in_attesa", messaggio=str(e), tentativi=esito.get("tentativi", 1) - 1)
    except Exception as e:
        esito.update(messaggio=str(e), errore=str(e))
    if esito.get("creata") is None: esito.pop("creata", None)
    json.dump(esito, open(fe, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps(esito, ensure_ascii=False, indent=1))

if __name__ == "__main__":
    if sys.argv[1] == "--sfondo": ritenta_sfondo(sys.argv[2])
    else: main(sys.argv[1])

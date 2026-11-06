"""Controllo dei siti delle attività di una zona: visita ogni link della scheda Google e scrive zone/<id>/siti.json.
Uso: python motore/siti.py [zone/<id> ...]   (senza argomenti controlla tutte le zone)
Stati: ok, dubbio (blocca i controlli, verificare a mano), ssl (certificato non valido), parcheggiato (dominio in vendita o scaduto),\ncostruzione, errore (HTTP 404/5xx), irraggiungibile (dominio inesistente o server spento).
Il file è separato da zona.json, così il controllo non entra mai in conflitto con le modifiche fatte dall'app."""
import json, os, re, sys, glob, ssl, time, errno, socket, html, urllib.request, urllib.error, urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
PARCHEGGIO = ["domain is for sale", "buy this domain", "this domain may be for sale", "dominio è in vendita", "dominio in vendita",
              "sedoparking", "parkingcrew", "bodis.com", "afternic", "domain has expired", "dominio scaduto",
              "questo dominio è stato registrato", "this domain has been registered", "account suspended", "account sospeso",
              "hosting scaduto", "the domain name is not configured", "default web site page", "web server's default page"]
COSTRUZIONE = ["sito in costruzione", "under construction", "stiamo lavorando al nuovo sito", "sito in manutenzione",
               "maintenance mode"]
# parole troppo comuni nel testo delle pagine vere (dan.com compare in giordan.com): valgono solo in <title> e nel primo <h1>
SOLO_TITOLO_P = ["dan.com"]
SOLO_TITOLO_C = ["coming soon", "index of /"]
SOSPESO = ["account suspended", "account sospeso"]
CORTO = 1500   # sotto questa lunghezza di testo visibile la pagina è quasi vuota: si cerca anche nel corpo
FORZA = {"irraggiungibile": 0, "dubbio": 1, "ssl": 2, "errore": 3}   # per non far vincere il tentativo http su un indizio migliore


def chiave(url):
    """stessa normalizzazione usata dall'app: niente protocollo, niente www, minuscolo, senza / finale"""
    u = (url or "").strip().lower()
    for p in ("https://", "http://"):
        if u.startswith(p): u = u[len(p):]
    if u.startswith("www."): u = u[4:]
    return u.rstrip("/")


def _testo(frammento):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", frammento or ""))).strip()


def classifica(corpo):
    """parcheggiato / costruzione / None: le parole chiave contano in <title> e nel primo <h1>,
    nel resto della pagina solo se il testo visibile è corto (pagine di parcheggio, server di default)"""
    titolo = re.search(r"<title[^>]*>(.*?)</title>", corpo, re.S)
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", corpo, re.S)
    testa = _testo(titolo.group(1) if titolo else "") + " | " + _testo(h1.group(1) if h1 else "")
    visibile = _testo(re.sub(r"(?s)<(script|style|noscript)\b.*?</\1>", " ", corpo))
    corto = len(visibile) < CORTO
    if any(k in testa for k in PARCHEGGIO + SOLO_TITOLO_P) or (corto and any(k in corpo for k in PARCHEGGIO)):
        return "parcheggiato"
    if any(k in testa for k in COSTRUZIONE + SOLO_TITOLO_C) or (corto and any(k in visibile for k in COSTRUZIONE)):
        return "costruzione"
    return None


def piva_valida(n):
    """controllo di Luhn della partita IVA italiana (11 cifre)"""
    if not re.fullmatch(r"\d{11}", n or "") or n == "0" * 11: return False
    s = 0
    for i, c in enumerate(n[:10]):
        d = int(c)
        if i % 2: d = d * 2 - 9 if d * 2 > 9 else d * 2
        s += d
    return (10 - s % 10) % 10 == int(n[10])


def trova_piva(corpo):
    """partita IVA dichiarata nella pagina (di solito nel piè di pagina): la prima valida vicino a 'iva' o 'vat'"""
    testo = _testo(re.sub(r"(?s)<(script|style|noscript)\b.*?</\1>", " ", corpo))
    for m in re.finditer(r"(?:\bp\.?\s?iva\b|\bpartita\s+iva\b|\bp\.i\.|\bvat\b(?:\s+number)?)[^0-9]{0,40}?(?:it\s?)?(?<!\d)((?:\d[ .]?){10}\d)(?!\d)", testo, re.I):
        n = re.sub(r"\D", "", m.group(1))
        if piva_valida(n): return n
    return None


# indirizzi che non sono dell'attività: costruttori di siti, servizi tecnici, esempi
EMAIL_NO = re.compile(r"(wixpress|sentry|example\.|esempio\.|^dominio\.|tuodominio|yourdomain|^domain\.com$|^e?mail\.com$|"
                      r"godaddy|^register\.it$|wordpress|squarespace|jimdo|webnode|cloudflare|schema\.org|w3\.org)", re.I)
EMAIL_RE = re.compile(r"[a-z0-9][a-z0-9._%+-]{0,63}@(?:[a-z0-9-]+\.)+[a-z]{2,10}", re.I)


def _dominio(url):
    return chiave(url).split("/")[0]


def trova_email(corpo, url=""):
    """email di contatto: prima i link mailto, poi il testo; preferisce quelle sullo stesso dominio del sito"""
    corpo = html.unescape(corpo or "").replace("&#64;", "@").replace("[at]", "@").replace("(at)", "@")
    trovate = [m.split("?")[0] for m in re.findall(r"mailto:([^\"'\s>]+)", corpo, re.I)]
    testo = re.sub(r"(?s)<(script|style|noscript)\b.*?</\1>", " ", corpo)
    trovate += EMAIL_RE.findall(_testo(testo))
    buone = []
    for e in trovate:
        e = urllib.parse.unquote(e).strip(" .;,").lower()
        if not EMAIL_RE.fullmatch(e) or EMAIL_NO.search(e.split("@")[1]) or re.search(r"\.(png|jpe?g|gif|webp|svg)$", e): continue
        if e not in buone: buone.append(e)
    dom = _dominio(url)
    stesso = [e for e in buone if dom and (e.split("@")[1] == dom or dom.endswith("." + e.split("@")[1]))]
    return (stesso or buone or [None])[0]


PAGINE = re.compile(r"contatt|contact|chi-siamo|chi_siamo|about|privacy|note-legali|legal|impressum|dove-siamo", re.I)


def pagine_interne(corpo, finale, n=3):
    """fino a n link interni a pagine dove di solito stanno P.IVA ed email (contatti, privacy, note legali)"""
    dom, visti = _dominio(finale), []
    for href in re.findall(r"<a\b[^>]*href=[\"']([^\"'#]+)", corpo, re.I):
        u = urllib.parse.urljoin(finale, html.unescape(href))
        if not u.startswith("http") or _dominio(u) != dom or not PAGINE.search(u) or u in visti: continue
        visti.append(u)
        if len(visti) >= n: break
    return visti


def leggi(u):
    ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(u, headers={"User-Agent": UA, "Accept-Language": "it-IT,it;q=0.9", "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=12, context=ctx) as r:
        return r.read(200000).decode("utf-8", "ignore").lower()


def dati_contatto(esito, corpo):
    """P.IVA ed email dalla home; se mancano, dalle pagine contatti/privacy dello stesso sito"""
    piva, email = trova_piva(corpo), trova_email(corpo, esito.get("finale", ""))
    if not (piva and email):
        for u in pagine_interne(corpo, esito.get("finale", "")):
            try: c = leggi(u)
            except Exception: continue
            piva = piva or trova_piva(c); email = email or trova_email(c, esito.get("finale", ""))
            if piva and email: break
    if piva: esito["piva"] = piva
    if email: esito["email"] = email


def _scegli(ultimo, nuovo):
    """tiene l'indizio più forte tra il tentativo https e quello http"""
    if ultimo is None or FORZA.get(nuovo["stato"], 0) > FORZA.get(ultimo["stato"], 0): return nuovo
    return ultimo


def visita(url):
    """prova https e http, con e senza verifica del certificato; distingue i siti morti dai blocchi anti-bot"""
    t0 = time.time()
    base = url.strip()
    tentativi = [base] if base.lower().startswith("http") else ["https://" + base, "http://" + base]
    ultimo, ssl_rotto = None, False
    for u in tentativi:
        for verifica_ssl in (True, False):
            ctx = ssl.create_default_context()
            if not verifica_ssl: ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
            req = urllib.request.Request(u, headers={"User-Agent": UA, "Accept-Language": "it-IT,it;q=0.9",
                                                     "Accept": "text/html,application/xhtml+xml"})
            try:
                with urllib.request.urlopen(req, timeout=15, context=ctx) as r:
                    corpo = r.read(120000).decode("utf-8", "ignore").lower()
                    esito = {"stato": "ok", "codice": r.status, "finale": r.geturl(), "ms": int((time.time() - t0) * 1000)}
                    dati_contatto(esito, corpo)
                    if not verifica_ssl or ssl_rotto:
                        esito.update(stato="ssl", nota="il sito risponde ma il certificato HTTPS non è valido")
                    tipo = classifica(corpo)
                    if tipo: esito["stato"] = tipo
                    elif r.status == 202 or len(corpo.strip()) < 400:   # pagine di verifica anti-bot o caricate via JavaScript
                        esito.update(stato="dubbio", nota="pagina vuota o di verifica automatica: controlla a mano")
                    return esito
            except urllib.error.HTTPError as e:
                if e.code in (400, 401, 403, 405, 406, 429, 503):   # protezioni anti-bot: il sito esiste, salvo hosting sospeso o dominio parcheggiato
                    try: corpo = e.read(120000).decode("utf-8", "ignore").lower()
                    except Exception: corpo = ""
                    ms = int((time.time() - t0) * 1000)
                    if any(k in corpo for k in SOSPESO):
                        return {"stato": "errore", "codice": e.code, "finale": u, "nota": "hosting sospeso", "ms": ms}
                    tipo = classifica(corpo)
                    if tipo: return {"stato": tipo, "codice": e.code, "finale": u, "ms": ms}
                    return {"stato": "ok", "codice": e.code, "finale": u, "nota": "risponde ma blocca i controlli automatici", "ms": ms}
                ultimo = _scegli(ultimo, {"stato": "errore", "codice": e.code, "finale": u})
                break
            except (urllib.error.URLError, socket.timeout, ConnectionError, OSError) as e:
                motivo = getattr(e, "reason", e)
                testo = str(motivo)
                if isinstance(motivo, ssl.SSLError) or isinstance(e, ssl.SSLError) or "CERTIFICATE" in testo.upper():
                    ssl_rotto = True; ultimo = _scegli(ultimo, {"stato": "ssl", "nota": "certificato HTTPS non valido"}); continue
                if isinstance(motivo, socket.gaierror) or "address associated" in testo or "Name or service" in testo:
                    return {"stato": "irraggiungibile", "nota": "dominio inesistente o scaduto", "ms": int((time.time() - t0) * 1000)}
                if (isinstance(motivo, (socket.timeout, TimeoutError)) or "timed out" in testo
                        or getattr(motivo, "errno", None) in (errno.ENETUNREACH, errno.EHOSTUNREACH) or "unreachable" in testo.lower()):
                    # rete del controllo lenta o senza percorso verso il server: non prova che il sito sia morto
                    ultimo = _scegli(ultimo, {"stato": "dubbio", "nota": "il server non risponde in tempo ai controlli automatici: verifica a mano"})
                    break
                if "closed connection" in testo or "reset" in testo.lower():
                    ultimo = _scegli(ultimo, {"stato": "dubbio", "nota": "il server chiude la connessione ai controlli automatici: verifica a mano"})
                    break
                ultimo = _scegli(ultimo, {"stato": "irraggiungibile", "nota": testo[:120]})
                break
            except Exception as e:   # URL con spazi, accenti o malformati: non deve fermare il controllo della zona
                return {"stato": "dubbio", "nota": f"indirizzo non controllabile: {str(e)[:80]}", "ms": int((time.time() - t0) * 1000)}
    ultimo = ultimo or {"stato": "irraggiungibile"}
    ultimo["ms"] = int((time.time() - t0) * 1000)
    return ultimo


def controlla(cartella):
    fz = os.path.join(cartella, "zona.json")
    if not os.path.exists(fz): return None
    z = json.load(open(fz, encoding="utf-8"))
    urls = {}
    for a in (z.get("attivita") or {}).values():
        if a.get("w"): urls[chiave(a["w"])] = a["w"]
    for p in (z.get("prospect") or {}).values():
        if p.get("sito") and not p.get("del"): urls[chiave(p["sito"])] = p["sito"]
    urls.pop("", None)
    with ThreadPoolExecutor(max_workers=16) as ex:
        risultati = dict(zip(urls.keys(), ex.map(visita, urls.values())))
    out = {"aggiornato": datetime.now(timezone.utc).isoformat(timespec="seconds"), "siti": risultati}
    json.dump(out, open(os.path.join(cartella, "siti.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    conta = {}
    for r in risultati.values(): conta[r["stato"]] = conta.get(r["stato"], 0) + 1
    print(os.path.basename(cartella), len(risultati), "siti", conta)
    return conta


if __name__ == "__main__":
    cartelle = sys.argv[1:] or sorted(glob.glob("zone/*/"))
    for c in cartelle: controlla(c.rstrip("/"))

"""Analisi dedicata: PDF del deck 16:9 (motore/analisi.html) per un'attività della zona.
L'app scrive zone/<id>/analisi/<chiave>-richiesta.json con i dati (L.datiAnalisi) e i testi corretti a mano;
questo script aggiunge mappa e font, disegna il deck in Chromium e salva il PDF e l'esito accanto alla richiesta.
Uso: python motore/analisi.py zone/<id>/analisi/<chiave>-richiesta.json"""
import base64, glob, json, os, sys

QUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, QUI)

FONT = [("Roboto", "roboto", [400, 500, 600, 700]), ("Roboto Condensed", "roboto-condensed", [500, 700]), ("Roboto Mono", "roboto-mono", [400, 500, 700])]
EXT = "unicode-range:U+0100-024F,U+1E00-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF;"


def font_css():
    """Roboto dai file del motore, incorporati: il PDF non dipende dalla rete"""
    css = ""
    for fam, d, ws in FONT:
        for w in ws:
            for sub, rng in (("latin", ""), ("latin-ext", EXT)):
                f = os.path.join(QUI, "fonts", f"{d}-{sub}-{w}-normal.woff2")
                if os.path.exists(f):
                    b64 = base64.b64encode(open(f, "rb").read()).decode()
                    css += f"@font-face{{font-family:'{fam}';font-weight:{w};src:url(data:font/woff2;base64,{b64}) format('woff2');{rng}}}"
    return css


def pagina(job, zona_dir):
    data = dict(job["data"])
    sfondo = os.path.join(zona_dir, "sfondo.png")
    if os.path.exists(sfondo):
        data["mapImg"] = "data:image/png;base64," + base64.b64encode(open(sfondo, "rb").read()).decode()
        try:   # distanza dal bordo dei segnalini nello sfondo, come nei fogli (dipende dal raggio della zona)
            import foglio
            n = data["grid"]["size"]; first = foglio.pad_sfondo(sfondo, n)
            data["mapGrid"] = {"first": first, "step": (1 - 2 * first) / max(1, n - 1)}
        except Exception:
            pass
    A = {"data": data, "testi": job.get("testi") or {}, "pdf": True}
    src = open(os.path.join(QUI, "analisi.html"), encoding="utf-8").read()
    import re   # i font relativi della pagina non si trovano accanto alla copia temporanea: si usano quelli incorporati
    src = re.sub(r'<style id="fonti">.*?</style>', '', src, count=1, flags=re.S)
    inj = f"<style>{font_css()}</style><script>window.ANALISI={json.dumps(A, ensure_ascii=False)}</script>"
    return src.replace("<main class=\"deck\"", inj + "<main class=\"deck\"", 1)


def genera(percorso):
    cartella = os.path.dirname(os.path.abspath(percorso))     # zone/<id>/analisi
    zona_dir = os.path.dirname(cartella)
    job = json.load(open(percorso, encoding="utf-8"))
    chiave = os.path.basename(percorso).rsplit("-richiesta.json", 1)[0]
    if not (job.get("data") or {}).get("maps"):
        raise ValueError("richiesta senza dati della griglia: rifai «Genera PDF» dall'app")
    html = pagina(job, zona_dir)
    tmp = os.path.join(cartella, f".{chiave}.html")
    open(tmp, "w", encoding="utf-8").write(html)
    nome = job["file"] + ".pdf"
    from playwright.sync_api import sync_playwright
    avvisi = []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page(viewport={"width": 1600, "height": 900})
            pg.goto("file://" + tmp)
            pg.evaluate("document.fonts.ready")
            pg.wait_for_timeout(800)
            if not pg.evaluate("document.fonts.check(\"700 20px 'Roboto Condensed'\")"):
                avvisi.append("font Roboto non caricato")
            n = pg.evaluate("document.querySelectorAll('.deck .slide').length")
            if not n:
                raise ValueError("nessuna slide disegnata: dati incompleti")
            pg.pdf(path=os.path.join(cartella, nome), width="1600px", height="900px", print_background=True,
                   margin={"top": "0", "right": "0", "bottom": "0", "left": "0"})
            b.close()
    finally:
        os.remove(tmp)
    esito = {"file": "analisi/" + nome, "richiesta": job.get("richiesta"), "tipo": "analisi", "slide": n, "avvisi": avvisi}
    json.dump(esito, open(os.path.join(cartella, f"{chiave}-esito.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps(esito, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    try:
        genera(sys.argv[1])
    except ValueError as e:
        print("ERRORE:", e, file=sys.stderr); sys.exit(1)

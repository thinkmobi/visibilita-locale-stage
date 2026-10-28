"""Prepara zone/<id>/stampa.json (tipo "fogli") da zona.json, come fa l'app, e genera il PDF con report.py.
Uso: python motore/stampa_fogli.py zone/<id> [AAAA-MM-GG]   (data del giro; se manca, quella più vicina tra i prospect)
I fogli sono i prospect del giro con report.includi, nell'ordine del giro. Nome file: <AAAAMMGG del giro>-<Categoria>-<Quartiere>-Fogli."""
import json, os, re, sys, time

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def prepara(cartella, data=None):
    z = json.load(open(os.path.join(cartella, "zona.json"), encoding="utf-8"))
    m, att = z["meta"], z["attivita"]
    giro = [p for p in z["prospect"].values() if (p.get("giro") or {}).get("data") and (p.get("report") or {}).get("includi")]
    if not giro: raise ValueError("nessun prospect con giro e report.includi: imposta prima il giro")
    data = data or min(p["giro"]["data"] for p in giro)
    giro = sorted((p for p in giro if p["giro"]["data"] == data), key=lambda p: p["giro"].get("ordine") or 999)
    if not giro: raise ValueError(f"nessun prospect nel giro del {data}")
    if not z.get("punti_ai"): raise ValueError("manca la griglia AI Mode: i fogli confrontano Maps e AI Mode")
    fogli = [{"pid": p["pid"], "nome": p["nome"], "indirizzo": p["indirizzo"], "lat": att[p["pid"]]["la"], "lng": att[p["pid"]]["lo"]} for p in giro]
    nome = lambda s: re.sub(r"[^A-Za-z0-9]", "", s.title())
    firma = json.load(open(os.path.join(RADICE, "config.json"), encoding="utf-8"))["firma"]
    job = {"tipo": "fogli", "richiesta": str(int(time.time() * 1000)),
           "file": f"{data[:4]}{data[5:7]}{data[8:10]}-{m['categoria']}-{nome(m['quartiere'])}-Fogli",
           "titolo_pdf": f"Visibilità su Google AI Mode e Maps · {m['quartiere']}", "keyword": m["keyword"], "frase_kw": m["frase_kw"],
           "centrata": m["centrata"], "lato": m["lato"], "data_testo": m["data_testo"], "sfondo": m.get("sfondo", ""), "firma": firma,
           "punti": z["punti"], "punti_ai": z["punti_ai"], "fogli": fogli}
    json.dump(job, open(os.path.join(cartella, "stampa.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    return job


if __name__ == "__main__":
    import report
    cartella = sys.argv[1].rstrip("/")
    prepara(cartella, sys.argv[2] if len(sys.argv) > 2 else None)
    report.genera(os.path.join(cartella, "stampa.json"))

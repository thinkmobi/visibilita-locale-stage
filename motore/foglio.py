"""Foglio da lasciare porta a porta: A4 orizzontale, una pagina per attività.
Confronta la griglia Google Maps con la griglia Google AI Mode della stessa zona (zona.json: punti e punti_ai)
e fa emergere le zone in cui l'intelligenza artificiale di Google mostra prima i concorrenti.
Layout approvato da Hector il 24/10/2026 (anteprima nel deck IPSIG). Lo chiama report.py quando stampa.json ha tipo "fogli"."""
import math, os
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT

INK = HexColor("#18232A"); MUTE = HexColor("#5F6B70"); LINE = HexColor("#D2D7D3"); HOME = HexColor("#1A73E8")
MAPBG = HexColor("#FAFBFA")
NEGBG = HexColor("#FCE4E2"); NEGBR = HexColor("#C5221F"); NEGTX = HexColor("#5C1410")
OKBG = HexColor("#E3F1E6"); OKTX = HexColor("#0F3D1C"); OKAC = HexColor("#1E8E3E"); OKIC = HexColor("#8FD19E")
# scala delle posizioni del foglio: verde 1-3, giallo/arancio 4-10, rosso oltre 10 o assente
R = {1: HexColor("#1E8E3E"), 2: HexColor("#34A853"), 3: HexColor("#6CC24A"), 4: HexColor("#F6C026"),
     5: HexColor("#F29529"), 6: HexColor("#E8603C"), 7: HexColor("#C5221F")}
INKR = {1: white, 2: white, 3: INK, 4: INK, 5: INK, 6: white, 7: white}
RING = {"top": HexColor("#34A853"), "mid": HexColor("#F6C026"), "low": HexColor("#C5221F")}


def heat(r):
    if not r or r >= 20: return 7
    if r <= 3: return r
    if r <= 6: return 4
    if r <= 10: return 5
    return 6


def su(n):
    """numeri mostrati: interi arrotondati per eccesso, come nel deck"""
    return max(0, math.ceil(n - 1e-9))


def pc(a, b):
    return f"{su(a / b * 100)}%" if b else "0%"


def ord_f(n):
    """ordinale femminile per "posizione": 3ª"""
    return f"{su(n)}ª"


def P(t, font="P", size=10, lead=None, col=INK):
    return Paragraph(t, ParagraphStyle("f", fontName=font, fontSize=size, leading=lead or size * 1.3, textColor=col, alignment=TA_LEFT))


def esc(s):
    return str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def ranghi(punti, pid):
    out = []
    for _, _, ids in punti:
        try: out.append(ids.index(pid) + 1)
        except ValueError: out.append(None)
    return out


def metriche(rk):
    N = len(rk); tro = [r for r in rk if r]
    return {"N": N, "top3": sum(1 for r in tro if r <= 3), "found": len(tro),
            "arp": (sum(tro) / len(tro)) if tro else None}


def testi(job, f, mm_, ma, lost, debole):
    """testi del foglio: generati dai numeri e dalla frase della zona, uguali per ogni settore.
    debole = "ai" o "maps": il titolo parla della piattaforma in cui l'attività è più indietro"""
    N, a, b = mm_["N"], mm_["top3"], ma["top3"]
    chi = esc(job.get("frase_kw") or f"«{job.get('keyword', '')}»")
    ai = "AI Mode è la ricerca in cui risponde l’intelligenza artificiale di Google. "
    if debole == "ai":
        fuori = N - b
        dove, altrove = "Nelle risposte di Google AI Mode", "l’intelligenza artificiale di Google"
        sub = ai + (f"Oggi non siete tra i primi 3 in nessuna zona, né su Maps né su AI Mode." if a == 0 and b == 0
                    else f"Su Maps siete tra i primi 3 in {a} zone, su AI Mode {'solo ' if b < a else ''}in {b}.")
        perse_txt = (f"In {lost} di queste {fuori} zone ({pc(lost, N)}) Google Maps vi mette tra i primi 3. "
                     "Chi cerca con l’intelligenza artificiale di Google, invece, vede prima i concorrenti. "
                     "Sulla mappa AI Mode sono i pallini tratteggiati.")
    else:
        fuori = N - a
        dove, altrove = "Su Google Maps", "Google Maps"
        sub = ai + f"Lì siete tra i primi 3 in {b} zone, su Google Maps solo in {a}."
        perse_txt = (f"In {lost} di queste {fuori} zone ({pc(lost, N)}) l’intelligenza artificiale di Google vi mette tra i primi 3. "
                     "Su Google Maps, invece, chi cerca vede prima i concorrenti. Sulla mappa Maps sono i pallini tratteggiati.")
    if fuori:
        titolo = f"{dove}, in <font color='#C5221F'>{fuori} zone su {N}</font> chi cerca {chi} trova prima i vostri concorrenti"
    else:
        titolo = f"{dove} siete tra i primi 3 in <font color='#1E8E3E'>tutte le {N} zone</font>"
    lettura = (f"Ogni pallino è una delle {N} zone di un quadrato di {esc(job.get('lato', '')).replace(' ', '')} "
               f"centrato {esc(job.get('centrata', ''))}. Il numero è la posizione in cui Google vi mostra a chi cerca da lì; "
               f"il rombo nero è la vostra sede.")
    rischio = (lost, perse_txt) if lost else (fuori, f"in cui {altrove} mostra prima i concorrenti ({pc(fuori, N)}).")
    perche = "In ogni zona fuori dai primi 3, chi cerca chiama prima un concorrente. Finché la situazione resta questa, quelle ricerche vanno agli altri."
    invito = ("Prossimo passo", "Vi mostro l’analisi completa",
              "In un incontro guardiamo zona per zona chi vi passa davanti e parliamo delle azioni correttive per migliorare il vostro posizionamento nel tempo.")
    return {"titolo": titolo, "sub": sub, "lettura": lettura, "rischio": rischio, "perche": perche, "invito": invito}


def spaced(c, x, y, text, font, size, col, track=.12, right=False):
    """testo maiuscolo spaziato (etichette mono)"""
    t = text.upper(); cs = size * track
    w = c.stringWidth(t, font, size) + cs * (len(t) - 1)
    if right: x -= w
    to = c.beginText(x, y); to.setFont(font, size); to.setCharSpace(cs); to.setFillColor(col); to.textOut(t); to.setCharSpace(0); c.drawText(to)
    return w


def ring(c, cx, cy, r, rk, w):
    """anello: quota di zone tra i primi 3 (verde), 4-10 (giallo), oltre o assenti (rosso)"""
    N = len(rk) or 1
    parti = [(sum(1 for x in rk if x and x <= 3), "top"), (sum(1 for x in rk if x and 3 < x <= 10), "mid"),
             (sum(1 for x in rk if not x or x > 10), "low")]
    c.setLineWidth(w); c.setStrokeColor(LINE); c.circle(cx, cy, r, stroke=1, fill=0)
    start = 90
    for n, k in parti:
        if not n: continue
        ext = -360 * n / N
        p = c.beginPath(); p.arc(cx - r, cy - r, cx + r, cy + r, start, ext)
        c.setStrokeColor(RING[k]); c.drawPath(p, stroke=1, fill=0); start += ext
    c.setFillColor(INK); c.setFont("MOB", r * .62); c.drawCentredString(cx, cy - r * .22, pc(parti[0][0], N))


def mappa(c, x, y, S, punti, rk, bg, sede, segna=None):
    """griglia a pallini sullo sfondo della zona; segna(i) disegna il contorno tratteggiato sul punto i"""
    c.saveState(); pth = c.beginPath(); pth.roundRect(x, y, S, S, 1.6 * mm); c.clipPath(pth, stroke=0, fill=0)
    if bg: c.drawImage(bg, x, y, S, S)
    else: c.setFillColor(MAPBG); c.rect(x, y, S, S, stroke=0, fill=1)
    c.restoreState()
    c.setStrokeColor(LINE); c.setLineWidth(.6); c.roundRect(x, y, S, S, 1.6 * mm, stroke=1, fill=0)
    lats = [p[0] for p in punti]; lngs = [p[1] for p in punti]
    la0, la1, lo0, lo1 = min(lats), max(lats), min(lngs), max(lngs)
    if la1 - la0 < 1e-9: la0, la1 = la0 - .005, la1 + .005
    if lo1 - lo0 < 1e-9: lo0, lo1 = lo0 - .007, lo1 + .007
    pad = S * (.203 if bg else .085)   # sullo sfondo Local Falcon i pallini cadono al 20,3% dal bordo (zone 7x7)
    xy = lambda la, lo: (x + pad + (lo - lo0) / (lo1 - lo0) * (S - 2 * pad), y + pad + (la - la0) / (la1 - la0) * (S - 2 * pad))
    n = max(2, round(math.sqrt(len(punti))))
    rr = (S - 2 * pad) / (n - 1) * .36
    for i, (la, lo, _) in enumerate(punti):
        px, py = xy(la, lo); r = rk[i]; h = heat(r)
        c.setFillColor(R[h]); c.setStrokeColor(white); c.setLineWidth(.9); c.circle(px, py, rr, stroke=1, fill=1)
        if r:
            c.setFillColor(INKR[h]); c.setFont("P-B", rr * 1.05); c.drawCentredString(px, py - rr * .37, "20+" if r > 20 else str(r))
        if segna and segna(i):
            c.setStrokeColor(INK); c.setLineWidth(.7); c.setDash(1.4, 1); c.circle(px, py, rr + 1.1 * mm, stroke=1, fill=0); c.setDash()
    if sede and sede[0] is not None:
        sx, sy = xy(*sede)
        # se il rombo coprirebbe un numero, lo sposto sul bordo del pallino più vicino (come nel PDF del giro)
        cx, cy = min((xy(la, lo) for la, lo, _ in punti), key=lambda q: math.hypot(q[0] - sx, q[1] - sy))
        if math.hypot(cx - sx, cy - sy) < rr * 1.15:
            ang = math.atan2(sy - cy, sx - cx) if math.hypot(cx - sx, cy - sy) > rr * .35 else math.radians(45)
            sx, sy = cx + rr * math.cos(ang), cy + rr * math.sin(ang)
        sx = min(max(sx, x + 2 * mm), x + S - 2 * mm); sy = min(max(sy, y + 2 * mm), y + S - 2 * mm)
        c.setFillColor(INK); c.setStrokeColor(white); c.setLineWidth(1)
        c.saveState(); c.translate(sx, sy); c.rotate(45); c.rect(-1.8 * mm, -1.8 * mm, 3.6 * mm, 3.6 * mm, stroke=1, fill=1); c.restoreState()


def pagina(c, job, f, bg, firma):
    W, H = landscape(A4)
    ML, MR, MT, MB = 12.5 * mm, 12.5 * mm, 10 * mm, 7.5 * mm
    punti, pai = job["punti"], job["punti_ai"]
    rkm, rka = ranghi(punti, f["pid"]), ranghi(pai, f["pid"])
    mm_, ma = metriche(rkm), metriche(rka)
    # piattaforma debole: quella con meno zone tra i primi 3 (a parità, AI Mode)
    debole = "maps" if mm_["top3"] < ma["top3"] else "ai"
    forte_r, debole_r = (rka, rkm) if debole == "maps" else (rkm, rka)
    perso = [bool(x and x <= 3 and not (y and y <= 3)) for x, y in zip(forte_r, debole_r)]
    lost = sum(perso)
    T = testi(job, f, mm_, ma, lost, debole)
    top = H - MT
    # --- testata: a sinistra data, nome e indirizzo; a destra la ricerca
    c.setFillColor(OKAC); c.rect(ML, top - 2.4 * mm, 6 * mm, .6 * mm, stroke=0, fill=1)
    spaced(c, ML + 8.5 * mm, top - 2.9 * mm, f"Analisi visibilità su Google · {job.get('data_testo', '')}", "MOB", 8.2, MUTE)
    nome = f.get("nome") or ""
    fn = 22
    while c.stringWidth(nome, "C", fn) > W * .62 and fn > 14: fn -= .5
    c.setFillColor(INK); c.setFont("C", fn); c.drawString(ML, top - 4.6 * mm - fn * .78, nome)
    ya = top - 4.6 * mm - fn * .78 - 5.2 * mm
    c.setFillColor(MUTE); c.setFont("MO", 8.6); c.drawString(ML, ya, f.get("indirizzo") or "")
    kw = f"«{job.get('keyword', '')}»"
    c.setFillColor(INK); c.setFont("C", 16); c.drawRightString(W - MR, ya, kw)
    spaced(c, W - MR, ya + 6.2 * mm, "Abbiamo cercato su Google", "MOB", 7.2, MUTE, right=True)
    yl = ya - 3 * mm
    c.setStrokeColor(INK); c.setLineWidth(.8); c.line(ML, yl, W - MR, yl)
    # --- titolo, spiegazione e come leggere
    y = yl - 4 * mm
    TW = W - ML - MR
    y -= draw(c, P(T["titolo"], "C", 21, 23.5), ML, y, TW * .86) + 1.8 * mm
    y -= draw(c, P(esc(T["sub"]), "P", 11.2, 14), ML, y, TW) + .8 * mm
    y -= draw(c, P(T["lettura"], "P", 9.2, 11.6, MUTE), ML, y, TW) + 4 * mm
    # --- piede: legenda e fonte
    fy = MB + 2.4 * mm
    c.setStrokeColor(LINE); c.setLineWidth(.6); c.line(ML, fy + 4.2 * mm, W - MR, fy + 4.2 * mm)
    lx = ML
    for cols, b, r in [((1, 3), "Visibile", "1–3"), ((4, 5), "Poco visibile", "4–10"), ((6, 7), "Invisibile", "oltre 10 o assenti")]:
        c.setFillColor(R[cols[0]]); c.wedge(lx, fy - .3 * mm, lx + 3 * mm, fy + 2.7 * mm, 90, 180, stroke=0, fill=1)
        c.setFillColor(R[cols[1]]); c.wedge(lx, fy - .3 * mm, lx + 3 * mm, fy + 2.7 * mm, 270, 180, stroke=0, fill=1)
        lx += 4.4 * mm
        c.setFillColor(INK); c.setFont("MOM", 7.4); c.drawString(lx, fy, b); lx += c.stringWidth(b, "MOM", 7.4) + 1.6 * mm
        c.setFillColor(MUTE); c.setFont("MO", 7.4); c.drawString(lx, fy, r); lx += c.stringWidth(r, "MO", 7.4) + 6 * mm
    c.setFillColor(INK); c.setStrokeColor(white)
    c.saveState(); c.translate(lx + 1.5 * mm, fy + 1.2 * mm); c.rotate(45); c.rect(-1.1 * mm, -1.1 * mm, 2.2 * mm, 2.2 * mm, stroke=0, fill=1); c.restoreState()
    c.setFillColor(MUTE); c.setFont("MO", 7.4); c.drawString(lx + 4.4 * mm, fy, "rombo: la vostra sede")
    c.setFont("MO", 7.4); c.drawRightString(W - MR, fy, "Dati pubblici di Google, non pubblicitari")
    bottom = fy + 4.2 * mm + 3.5 * mm
    # --- due mappe a sinistra, colonna dei messaggi a destra
    gap, gcol = 7 * mm, 8.5 * mm
    avail = y - bottom
    head_h, stat_h = 9.5 * mm, 21 * mm
    S = min(80 * mm, avail - head_h - stat_h)
    xm = ML
    sede = (f.get("lat"), f.get("lng"))
    for i, (lab, sub, pts, rk, m, segna) in enumerate([
            ("Google Maps", "la mappa di Google", punti, rkm, mm_, (lambda j: perso[j]) if debole == "maps" else None),
            ("Google AI Mode", "le risposte dell’intelligenza artificiale", pai, rka, ma, (lambda j: perso[j]) if debole == "ai" else None)]):
        x = xm + i * (S + gap)
        spaced(c, x, y - 3 * mm, lab, "MOB", 8.6, INK, .1)
        c.setFillColor(MUTE); c.setFont("P", 8.2); c.drawString(x, y - 7 * mm, sub)
        c.setStrokeColor(LINE); c.setLineWidth(.5); c.line(x, y - head_h + .6 * mm, x + S, y - head_h + .6 * mm)
        my = y - head_h - 1.6 * mm - S
        mappa(c, x, my, S, pts, rk, bg, sede, segna)
        # numeri sotto la mappa
        rr = 9.4 * mm; cy = my - 3 * mm - rr
        ring(c, x + rr, cy, rr - 1.6 * mm, rk, 3.2 * mm)
        tx = x + 2 * rr + 4 * mm
        c.setFillColor(INK); c.setFont("C", 17); c.drawString(tx, cy + 3.6 * mm, f"{m['top3']} zone su {m['N']}")
        c.setFillColor(MUTE); c.setFont("P", 8.8); c.drawString(tx, cy - .6 * mm, "tra i primi 3 risultati")
        if m["arp"] is not None:
            c.drawString(tx, cy - 4.4 * mm, f"posizione media {ord_f(m['arp'])}" + (" dove comparite" if m["found"] < m["N"] else ""))
        miss = m["N"] - m["top3"]
        if miss:
            t = f"in {miss} zone non siete tra i primi 3 ({100 - su(m['top3'] / m['N'] * 100)}%)"   # complementare all'anello
            w = c.stringWidth(t, "P-B", 8.4) + 3.2 * mm
            c.setFillColor(NEGBG); c.roundRect(tx - 1.2 * mm, cy - 10.6 * mm, w, 4.8 * mm, 1 * mm, stroke=0, fill=1)
            c.setFillColor(NEGTX); c.setFont("P-B", 8.4); c.drawString(tx + .4 * mm, cy - 9.2 * mm, t)
    sx = xm + 2 * S + gap + gcol; sw = W - MR - sx
    # riquadro rosso: cosa state perdendo
    big, rt = T["rischio"]
    inner = sw - 9 * mm
    p1 = P(esc(rt), "P", 9.3, 12.2, NEGTX); _, h1 = p1.wrap(inner, 100 * mm)
    p2 = P(f"<b>{esc(T['perche'])}</b>", "P", 9.3, 12.2, NEGTX); _, h2 = p2.wrap(inner, 100 * mm)
    hb = 6 * mm + 4 * mm + 15 * mm + h1 + 4 * mm + h2 + 5 * mm
    yb = y - hb
    c.setFillColor(NEGBG); c.roundRect(sx, yb, sw, hb, 1.6 * mm, stroke=0, fill=1)
    c.setFillColor(NEGBR); c.rect(sx, yb, 1.3 * mm, hb, stroke=0, fill=1)
    ix = sx + 5.5 * mm; iy = y - 6 * mm
    spaced(c, ix, iy - 1 * mm, "Cosa state perdendo", "MOB", 8.4, NEGTX, .12)
    iy -= 4 * mm + 13 * mm
    c.setFillColor(NEGBR); c.setFont("C", 40); c.drawString(ix, iy, str(big))
    bw = c.stringWidth(str(big), "C", 40)
    c.setFont("C", 16); c.drawString(ix + bw + 1.2 * mm, iy, "zone")
    if lost:
        dx = ix + bw + c.stringWidth("zone", "C", 16) + 7 * mm; dy = iy + 5 * mm
        c.setFillColor(NEGBR); c.circle(dx, dy, 2.6 * mm, stroke=0, fill=1)
        c.setStrokeColor(INK); c.setLineWidth(.7); c.setDash(1.4, 1); c.circle(dx, dy, 3.8 * mm, stroke=1, fill=0); c.setDash()
    iy -= 4 * mm
    p1.drawOn(c, ix, iy - h1); iy -= h1 + 2 * mm
    c.setStrokeColor(HexColor("#E9B9B4")); c.setLineWidth(.5); c.line(ix, iy, sx + sw - 4 * mm, iy); iy -= 2 * mm
    p2.drawOn(c, ix, iy - h2)
    # prossimo passo e contatti: un riquadro, due colori
    eb, ti, de = T["invito"]
    pd = P(esc(de), "P", 9.4, 12.2, OKTX); _, hd = pd.wrap(sw - 9 * mm, 60 * mm)
    hi = 5 * mm + 4.4 * mm + 7 * mm + hd + 9 * mm
    hc = 22 * mm
    yc = bottom
    c.setFillColor(INK); c.roundRect(sx, yc, sw, hc, 1.8 * mm, stroke=0, fill=1)
    c.rect(sx, yc + hc - 2 * mm, sw, 2 * mm, stroke=0, fill=1)
    c.setFillColor(OKBG); c.roundRect(sx, yc + hc, sw, hi, 1.8 * mm, stroke=0, fill=1)
    c.rect(sx, yc + hc, sw, 2 * mm, stroke=0, fill=1)
    if yc + hc + hi > yb - 1.5 * mm:
        AVVISI_F.append(f"{nome}: colonna destra troppo alta, ridurre i testi")
    ix = sx + 4.5 * mm; iy = yc + hc + hi - 5 * mm
    spaced(c, ix, iy - 1.6 * mm, eb, "MOB", 8, OKAC, .12)
    c.setFillColor(OKTX); c.setFont("C", 15); c.drawString(ix, iy - 8.6 * mm, ti)
    pd.drawOn(c, ix, iy - 11 * mm - hd)
    wy = yc + hc + 4 * mm
    w = spaced(c, ix, wy, "Appuntamento il", "MO", 8, OKAC, .06)
    c.setStrokeColor(OKTX); c.setLineWidth(.6); c.line(ix + w + 2 * mm, wy - .6 * mm, sx + sw - 4.5 * mm, wy - .6 * mm)
    # contatti
    c.setFillColor(white); c.setFont("C", 15); c.drawString(ix, yc + hc - 7.4 * mm, firma["nome"])
    spaced(c, sx + sw - 4.5 * mm, yc + hc - 7.2 * mm, firma["ruolo"], "MOB", 6.6, HexColor("#B9C3C7"), .1, right=True)
    c.setFillColor(OKIC); c.setFont("DJ", 10); c.drawString(ix, yc + 8.6 * mm, "☎")
    c.setFillColor(white); c.setFont("CS", 13.5); c.drawString(ix + 6 * mm, yc + 8.6 * mm, firma["telefono"])
    c.setFillColor(OKIC); c.setFont("DJ", 10); c.drawString(ix, yc + 3 * mm, "✉")
    c.setFillColor(white); c.setFont("CS", 11); c.drawString(ix + 6 * mm, yc + 3 * mm, firma["email"])


def draw(c, p, x, ytop, w):
    _, h = p.wrap(w, 200 * mm); p.drawOn(c, x, ytop - h); return h


AVVISI_F = []


def genera_fogli(job, cartella, out, firma):
    """un foglio per attività; restituisce gli avvisi"""
    AVVISI_F.clear()
    if not job.get("punti_ai"):
        raise ValueError("manca la scansione Google AI Mode della zona: importala dall'app (report AI Mode) e riprova")
    if len(job["punti_ai"]) != len(job["punti"]):
        raise ValueError("le griglie Maps e AI Mode non hanno lo stesso numero di punti: rifai l'import della zona")
    bg = os.path.join(cartella, job["sfondo"]) if job.get("sfondo") else None
    if bg and not os.path.exists(bg): AVVISI_F.append("sfondo mappa non trovato: fogli senza mappa"); bg = None
    c = canvas.Canvas(out, pagesize=landscape(A4))
    c.setTitle(job.get("titolo_pdf", "Visibilità su Google")); c.setAuthor(firma["nome"] + " Consulente")
    for f in job["fogli"]:
        pagina(c, job, f, bg, firma); c.showPage()
    c.save()
    return list(AVVISI_F)

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
    """numeri mostrati: X,5 per difetto, oltre X,5 per eccesso (regola di Hector, 26/10/2026)"""
    return max(0, math.ceil(n - .5 - 1e-9))


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


def presenza(dentro, N, chi):
    """riquadro rosa: quota di zone in cui compare tra i primi 3 (la presenza, non la perdita), e cosa succede nelle altre.
    chi = la piattaforma debole come soggetto («Google AI Mode», «Google Maps»)"""
    fuori = N - dentro
    testo = f"delle zone in cui {chi} vi mostra tra i primi 3 risultati."
    if not fuori:
        return (pc(dentro, N), testo, "")
    testo += (" Nelle altre" if dentro else " Ovunque") + " chi cerca vede prima i vostri concorrenti e chiama loro."
    return (pc(dentro, N), testo, "Finché la situazione resta questa, quelle ricerche vanno agli altri.")


def presenza_doppia(b, a, N):
    """riquadro rosa con AI Mode e Maps: le due quote di zone tra i primi 3, nello stesso ordine delle mappe"""
    fuori = (b < N) or (a < N)
    testo = "delle zone in cui Google vi mostra tra i primi 3 risultati."
    if fuori:
        testo += (" Nelle altre" if (a or b) else " Ovunque") + " chi cerca vede prima i vostri concorrenti e chiama loro."
    return {"voci": [(pc(b, N), "Google AI Mode"), (pc(a, N), "Google Maps")], "testo": testo,
            "chiusa": "Finché la situazione resta questa, quelle ricerche vanno agli altri." if fuori else ""}


def testi(job, f, mm_, ma, debole):
    """testi del foglio: generati dai numeri e dalla frase della zona, uguali per ogni settore.
    debole = "ai" o "maps": il titolo parla della piattaforma in cui l'attività è più indietro"""
    N, a = mm_["N"], mm_["top3"]
    b = ma["top3"] if ma else None
    chi = esc(job.get("frase_kw") or f"«{job.get('keyword', '')}»")
    rosso = lambda t: f"<font color='#C5221F'>{t}</font>"
    zone = lambda n: f"{n} zona" if n == 1 else f"{n} zone"
    lettura = "Ogni pallino è una zona: il numero è la vostra posizione su Google da quel punto. Il quadratino nero è la vostra sede."
    invito = ("Prossimo passo", "Vi mostro l’analisi completa",
              "In un incontro guardiamo zona per zona chi vi passa davanti e parliamo delle azioni correttive per migliorare il vostro posizionamento nel tempo.")
    if ma is None:   # zona senza scansione AI Mode: solo Google Maps
        fuori = N - a
        titolo = (f"Su Google Maps, in {rosso(f'{zone(fuori)} su {N}')} chi cerca {chi} trova prima i vostri concorrenti" if fuori
                  else f"Su Google Maps siete tra i primi 3 in <font color='#1E8E3E'>tutte le {N} zone</font>")
        return {"titolo": titolo, "lettura": lettura, "fuori": fuori, "invito": invito, "dove": "Su Google Maps",
                "rischio": presenza(a, N, "Google Maps")}
    dentro = b if debole == "ai" else a
    fuori = N - dentro
    altro_fuori = N - (a if debole == "ai" else b)
    dove = "Nelle risposte di Google AI Mode" if debole == "ai" else "Su Google Maps"
    altrove = "Su Google Maps" if debole == "ai" else "Su Google AI Mode"
    # il titolo parte dalla piattaforma più debole e cita sempre anche l'altra
    if fuori and fuori == altro_fuori:
        titolo = f"Su Google AI Mode e su Google Maps, in {rosso(f'{zone(fuori)} su {N}')} chi cerca {chi} trova prima i vostri concorrenti"
    elif fuori:
        titolo = f"{dove}, in {rosso(f'{zone(fuori)} su {N}')} chi cerca {chi} trova prima i vostri concorrenti. "
        titolo += f"{altrove} succede in {rosso(f'{zone(altro_fuori)} su {N}')}." if altro_fuori else f"{altrove} siete tra i primi 3 ovunque."
    else:
        titolo = f"Su Google AI Mode e su Google Maps siete tra i primi 3 in <font color='#1E8E3E'>tutte le {N} zone</font>"
    sub = f"Tra i primi 3: su Google AI Mode in {b} zone su {N} ({pc(b, N)}), su Google Maps in {a} ({pc(a, N)})."
    lettura = "Ogni pallino è una zona: il numero è la vostra posizione su Google da quel punto. Il quadratino nero è la vostra sede."
    # quota di zone tra i primi 3 sulla piattaforma debole: si vede subito quanto poco compare
    rischio = presenza_doppia(b, a, N)
    invito = ("Prossimo passo", "Vi mostro l’analisi completa",
              "In un incontro guardiamo zona per zona chi vi passa davanti e parliamo delle azioni correttive per migliorare il vostro posizionamento nel tempo.")
    return {"titolo": titolo, "sub": sub, "lettura": lettura, "rischio": rischio, "fuori": fuori, "invito": invito, "dove": dove}


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


def mappa(c, x, y, S, punti, rk, bg, sede):
    """griglia a pallini sullo sfondo della zona"""
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
    punti, pai = job["punti"], (job.get("punti_ai") or None)
    rkm = ranghi(punti, f["pid"]); mm_ = metriche(rkm)
    rka = ranghi(pai, f["pid"]) if pai else None; ma = metriche(rka) if pai else None
    # piattaforma debole: quella con meno zone tra i primi 3 (a parità, AI Mode)
    debole = "maps" if (not ma or mm_["top3"] < ma["top3"]) else "ai"
    T = testi(job, f, mm_, ma, debole)
    top = H - MT
    # --- testata: a sinistra data, nome e indirizzo; a destra la ricerca
    c.setFillColor(OKAC); c.rect(ML, top - 2.4 * mm, 6 * mm, .6 * mm, stroke=0, fill=1)
    spaced(c, ML + 8.5 * mm, top - 2.9 * mm, f"Analisi visibilità su Google · {job.get('data_testo', '')}", "MOB", 8.2, MUTE)
    nome = f.get("nome") or ""
    fn = 22
    while c.stringWidth(nome, "C", fn) > W * .62 and fn > 14: fn -= .5
    nome = taglia(c, nome, "C", fn, W * .62)
    c.setFillColor(INK); c.setFont("C", fn); c.drawString(ML, top - 4.6 * mm - fn * .78, nome)
    ya = top - 4.6 * mm - fn * .78 - 5.2 * mm
    c.setFillColor(MUTE); c.setFont("MO", 8.6); c.drawString(ML, ya, taglia(c, f.get("indirizzo") or "", "MO", 8.6, W * .55))
    kw = f"«{job.get('keyword', '')}»"
    c.setFillColor(INK); c.setFont("C", 16); c.drawRightString(W - MR, ya, kw)
    spaced(c, W - MR, ya + 6.2 * mm, "Abbiamo cercato su Google", "MOB", 7.2, MUTE, right=True)
    yl = ya - 3 * mm
    c.setStrokeColor(INK); c.setLineWidth(.8); c.line(ML, yl, W - MR, yl)
    # --- titolo, spiegazione e come leggere
    y = yl - 4 * mm
    TW = W - ML - MR
    y -= draw(c, P(T["titolo"], "C", 22, 24.5), ML, y, TW * .86) + 2.2 * mm
    y -= draw(c, P(esc(T["lettura"]), "P", 9.4, 11.8, MUTE), ML, y, TW) + 4 * mm
    # --- piede: legenda e fonte
    fy = MB + 2.4 * mm
    c.setStrokeColor(LINE); c.setLineWidth(.6); c.line(ML, fy + 4.2 * mm, W - MR, fy + 4.2 * mm)
    lx = ML
    # prima voce: quadratino nero (rombo) come sulle mappe, la sede dell'attività
    c.setFillColor(INK)
    c.saveState(); c.translate(lx + 1.5 * mm, fy + 1.2 * mm); c.rotate(45); c.rect(-1.15 * mm, -1.15 * mm, 2.3 * mm, 2.3 * mm, stroke=0, fill=1); c.restoreState()
    lx += 4.4 * mm
    c.setFont("MOM", 7.4); c.drawString(lx, fy, "La vostra sede"); lx += c.stringWidth("La vostra sede", "MOM", 7.4) + 6 * mm
    for cols, b, r in [((1, 3), "Visibile", "1–3"), ((4, 5), "Poco visibile", "4–10"), ((6, 7), "Invisibile", "oltre 10 o assenti")]:
        c.setFillColor(R[cols[0]]); c.wedge(lx, fy - .3 * mm, lx + 3 * mm, fy + 2.7 * mm, 90, 180, stroke=0, fill=1)
        c.setFillColor(R[cols[1]]); c.wedge(lx, fy - .3 * mm, lx + 3 * mm, fy + 2.7 * mm, 270, 180, stroke=0, fill=1)
        lx += 4.4 * mm
        c.setFillColor(INK); c.setFont("MOM", 7.4); c.drawString(lx, fy, b); lx += c.stringWidth(b, "MOM", 7.4) + 1.6 * mm
        c.setFillColor(MUTE); c.setFont("MO", 7.4); c.drawString(lx, fy, r); lx += c.stringWidth(r, "MO", 7.4) + 6 * mm
    c.setFillColor(MUTE); c.setFont("MO", 7.4); c.drawRightString(W - MR, fy, "Dati pubblici di Google, non pubblicitari")
    bottom = fy + 4.2 * mm + 3.5 * mm
    # --- due mappe a sinistra, colonna dei messaggi a destra
    gap, gcol = 7 * mm, 8.5 * mm
    avail = y - bottom
    head_h, stat_h = 12 * mm, 19 * mm
    S = min(80 * mm, avail - head_h - stat_h)
    xm = ML
    sede = (f.get("lat"), f.get("lng"))
    def numeri(x, cy, rk, m):
        rr = 9.4 * mm
        ring(c, x + rr, cy, rr - 1.6 * mm, rk, 3.2 * mm)
        tx = x + 2 * rr + 4 * mm
        # etichetta sopra il numero, come nella scheda dell'app
        c.setFillColor(MUTE); c.setFont("P", 9.6); c.drawString(tx, cy + 2.6 * mm, "tra i primi 3 risultati")
        c.setFillColor(INK); c.setFont("C", 20); c.drawString(tx, cy - 4.6 * mm, f"{m['top3']} {'zona' if m['top3'] == 1 else 'zone'} su {m['N']}")
    def icona(lab, x, yb, h, col):
        """simbolo della piattaforma: scintilla per AI Mode, segnaposto per Maps (riconoscibili anche in bianco e nero)"""
        c.setFillColor(col)
        if "AI" in lab:
            c.setFont("DJ", h * 1.25); c.drawString(x, yb, "✦"); return h * 1.05
        r = h * .36; cx = x + r; cy = yb + h * .62
        pth = c.beginPath(); pth.moveTo(cx - r * .82, cy - r * .55); pth.lineTo(cx, yb - h * .05); pth.lineTo(cx + r * .82, cy - r * .55); pth.close()
        c.drawPath(pth, stroke=0, fill=1); c.circle(cx, cy, r, stroke=0, fill=1)
        c.setFillColor(white); c.circle(cx, cy, r * .42, stroke=0, fill=1); return 2 * r + h * .2
    def testata(x, lab, sub, w):
        # simbolo e nome grande della piattaforma, descrizione sotto
        dx = icona(lab, x, y - 5.6 * mm, 4.6 * mm, INK)
        c.setFillColor(INK); c.setFont("C", 16); c.drawString(x + dx + 1.6 * mm, y - 5.4 * mm, lab)
        c.setFillColor(MUTE); c.setFont("P", 8.2); c.drawString(x, y - 9.6 * mm, sub)
        c.setStrokeColor(LINE); c.setLineWidth(.5); c.line(x, y - head_h + .6 * mm, x + w, y - head_h + .6 * mm)
    if pai:
        for i, (lab, sub, pts, rk, m) in enumerate([
                ("Google AI Mode", "le risposte dell’intelligenza artificiale", pai, rka, ma),
                ("Google Maps", "la mappa di Google", punti, rkm, mm_)]):   # prima AI Mode, poi Maps
            x = xm + i * (S + gap)
            testata(x, lab, sub, S)
            my = y - head_h - 1.6 * mm - S
            mappa(c, x, my, S, pts, rk, bg, sede)
            numeri(x, my - 3 * mm - 9.4 * mm, rk, m)
    else:
        # solo Google Maps: una mappa più grande, i numeri alla sua destra; la colonna destra resta dov'è
        largo = 2 * S + gap
        S1 = min(avail - head_h - 1.6 * mm, largo - 60 * mm)
        testata(xm, "Google Maps", "la mappa di Google", largo)
        my = y - head_h - 1.6 * mm - S1
        mappa(c, xm, my, S1, punti, rkm, bg, sede)
        numeri(xm + S1 + 6 * mm, my + S1 / 2, rkm, mm_)
    sx = xm + 2 * S + gap + gcol; sw = W - MR - sx
    # riquadro rosa: quanto vi vede chi cerca (presenza tra i primi 3: AI Mode e Maps, oppure solo Maps)
    doppio = isinstance(T["rischio"], dict)
    if doppio: voci, rt, chiusa = T["rischio"]["voci"], T["rischio"]["testo"], T["rischio"]["chiusa"]
    else: big, rt, chiusa = T["rischio"]
    inner = sw - 9 * mm
    p1 = P(esc(rt), "P", 9.8 if doppio else 10.4, 12.4 if doppio else 13.4, NEGTX); _, h1 = p1.wrap(inner, 100 * mm)
    p2 = P(f"<b>{esc(chiusa)}</b>", "P", 9.6, 12.4, NEGTX) if chiusa else None; _, h2 = p2.wrap(inner, 100 * mm) if p2 else (0, -4 * mm)
    hb = 6 * mm + 4 * mm + (20.5 if doppio else 15) * mm + h1 + 4 * mm + h2 + 5 * mm
    yb = y - hb
    c.setFillColor(NEGBG); c.roundRect(sx, yb, sw, hb, 1.6 * mm, stroke=0, fill=1)
    c.setFillColor(NEGBR); c.rect(sx, yb, 1.3 * mm, hb, stroke=0, fill=1)
    ix = sx + 5.5 * mm; iy = y - 6 * mm
    spaced(c, ix, iy - 1 * mm, "Quanto vi vede chi cerca", "MOB", 8.4, NEGTX, .12)
    if doppio:
        # due numeri affiancati, con la piattaforma sotto: prima AI Mode, poi Maps, come le mappe
        iy -= 4 * mm + 11 * mm; cw = inner / 2
        for k, (val, lab) in enumerate(voci):
            # simbolo e nome sopra il numero, come le testate delle mappe
            xx = ix + k * cw
            dx = icona(lab, xx, iy + 3.6 * mm, 3.6 * mm, NEGTX)
            c.setFillColor(NEGTX); c.setFont("C", 12); c.drawString(xx + dx + 1.2 * mm, iy + 3.8 * mm, lab)
            c.setFillColor(NEGBR); c.setFont("C", 27); c.drawString(xx, iy - 6 * mm, str(val))
        iy -= 10.5 * mm
    else:
        iy -= 4 * mm + 13 * mm
        c.setFillColor(NEGBR); c.setFont("C", 40); c.drawString(ix, iy, str(big))
        iy -= 4 * mm
    p1.drawOn(c, ix, iy - h1); iy -= h1 + 2 * mm
    if p2:
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


def taglia(c, t, font, size, w):
    """accorcia con … finché il testo sta in w"""
    if c.stringWidth(t, font, size) <= w: return t
    while t and c.stringWidth(t + "…", font, size) > w: t = t[:-1]
    if t != "": AVVISI_F.append("nome o indirizzo lungo accorciato nel foglio")
    return t.rstrip(" ,.;:-–·|") + "…"


def draw(c, p, x, ytop, w):
    _, h = p.wrap(w, 200 * mm); p.drawOn(c, x, ytop - h); return h


AVVISI_F = []


def genera_fogli(job, cartella, out, firma):
    """un foglio per attività; restituisce gli avvisi"""
    AVVISI_F.clear()
    if job.get("punti_ai") and len(job["punti_ai"]) != len(job["punti"]):
        raise ValueError("le griglie Maps e AI Mode non hanno lo stesso numero di punti: rifai l'import della zona")
    bg = os.path.join(cartella, job["sfondo"]) if job.get("sfondo") else None
    if bg and not os.path.exists(bg): AVVISI_F.append("sfondo mappa non trovato: fogli senza mappa"); bg = None
    c = canvas.Canvas(out, pagesize=landscape(A4))
    c.setTitle(job.get("titolo_pdf", "Visibilità su Google")); c.setAuthor(firma["nome"] + " Consulente")
    for f in job["fogli"]:
        pagina(c, job, f, bg, firma); c.showPage()
    c.save()
    return list(AVVISI_F)

"""Motore di stampa: due analisi per foglio A4 (210 x 148,5 mm ciascuna), mappa sulla metà sinistra.
Layout v6 del 18/10/2026 (attività in testata, titoli brevi, avviso scheda non rivendicata,
prossimo passo con proposta in coda alla descrizione, contatti in un box bordato di verde); i dati arrivano da zone/<id>/stampa.json,
preparato dall'app. Uso: python motore/report.py zone/<id>/stampa.json"""
import json, math, sys, os, html
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT

FD = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts") + os.sep
for n, f in [("P", "PlexSans-Regular"), ("P-M", "PlexSans-Medium"), ("P-B", "PlexSans-SemiBold"),
             ("C", "PlexCond-Bold"), ("CS", "PlexCond-SemiBold"), ("MO", "PlexMono-Regular"), ("MOM", "PlexMono-Medium"), ("MOB", "PlexMono-Bold")]:
    pdfmetrics.registerFont(TTFont(n, FD + f + ".ttf"))
from reportlab.lib.fonts import addMapping
addMapping("P", 0, 0, "P"); addMapping("P", 1, 0, "P-B"); addMapping("P", 0, 1, "P"); addMapping("P", 1, 1, "P-B")

pdfmetrics.registerFont(TTFont("DJ", FD + "DejaVuSans.ttf"))
import re
STAR = "<font name='DJ' color='#E0A43A'>\u2605</font>"
def stars(t):
    return re.sub(r"(?<![\d,])([1-5],\d)(?![\d%])", lambda m: m.group(1) + "\u00a0" + STAR, t)
DP = []          # punti della griglia: [{"lat":..,"lng":..,"results":[{"rank":..,"place_id":..}]}]
JOB = {}         # stampa.json completo (occhiello, firma, centro)
AVVISI = []
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importa import PROSSIMO_PASSO   # stesso testo di default dell'import, se stampa.json non lo porta
SMIN = 70 * mm   # mappa più piccola accettabile: sotto si riduce il testo e si avvisa
TMAX = 18 * mm   # altezza massima del titolo (tre righe in corpo 16)

INK = HexColor("#18232A"); BOX = HexColor("#F4F5F3"); MUTE = HexColor("#5F6B70"); LINE = HexColor("#D2D7D3")
HOME = HexColor("#1A73E8"); NEGBG = HexColor("#FCE4E2"); NEGBR = HexColor("#C5221F"); NEGTX = HexColor("#5C1410")
# colori della legenda: sono gli unici colori usati per dati e numeri
C_TOP = HexColor("#2E7D5B"); C_MID = HexColor("#E0A43A"); C_LOW = HexColor("#D2643A"); C_NO = HexColor("#C9C4BA")
TINT = {C_TOP: HexColor("#E3F0EA"), C_MID: HexColor("#FBF0DC"), C_LOW: HexColor("#F8E4DB"), C_NO: HexColor("#F1F0ED")}


def color(r):
    if r is None: return C_NO
    if r <= 3: return C_TOP
    if r <= 10: return C_MID
    return C_LOW


def pct_color(p):
    """quota di punti: verde se la zona è coperta, giallo a metà, arancio se scoperta"""
    if p >= 50: return C_TOP
    if p >= 25: return C_MID
    return C_LOW


def P(text, font="P", size=7, lead=None, col=INK, align=TA_LEFT):
    return Paragraph(text, ParagraphStyle("x", fontName=font, fontSize=size, leading=lead or size * 1.38, textColor=col, alignment=align))


def eyebrow(c, x, y, text, col=None, size=5.6):
    c.setFillColor(C_TOP); c.rect(x, y + .9 * mm, 4.5 * mm, .55 * mm, stroke=0, fill=1)
    t = c.beginText(x + 6.3 * mm, y); t.setFont("MOB", size); t.setCharSpace(size * .14); t.setFillColor(col or MUTE)
    t.textOut(text.upper()); t.setCharSpace(0); c.drawText(t)


def posizioni(lab):
    """"tra le prime 3" diventa "tra le prime 3 posizioni" anche sui dati preparati prima della v5"""
    return re.sub(r"prime (\d+)$", r"prime \1 posizioni", lab.strip())


def tronca(testo, font, size, w):
    """accorcia con … finché il testo sta nella larghezza w (per drawString)"""
    if pdfmetrics.stringWidth(testo, font, size) <= w: return testo
    while testo and pdfmetrics.stringWidth(testo + "…", font, size) > w: testo = testo[:-1]
    return testo.rstrip(" ,.;:-–·") + "…"


def adatta(fare, testo, w, hmax):
    """fare(testo) -> Paragraph; se non sta in hmax toglie parole in coda e chiude con …. Restituisce (paragrafo, tagliato)"""
    p = fare(testo)
    if p.wrap(w, 500 * mm)[1] <= hmax: return p, False
    parole = testo.split(" ")
    corto = lambda n: " ".join(parole[:n]).rstrip(" ,.;:-") + "…"
    lo, hi = 0, len(parole)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if fare(corto(mid)).wrap(w, 500 * mm)[1] <= hmax: lo = mid
        else: hi = mid - 1
    return fare(corto(lo)), True


def draw_par(c, p, x, ytop, w):
    _, h = p.wrap(w, 200 * mm); p.drawOn(c, x, ytop - h); return h


SFIX = None
SLOG = []


def luogo_legenda(cfg):
    """'Il suo studio', 'La sua sede'... dall'intestazione della classifica; di default 'Il suo ufficio'"""
    m = re.search(r"\b(?:AL|DAL)(LA)? SU[OA] ([A-ZÀ-Ù]+)", (cfg.get("list_head") or "").upper())
    if not m: return "Il suo ufficio"
    return ("La sua " if m.group(1) else "Il suo ") + m.group(2).lower()


def analysis(c, cfg, X, Y, W, H):
    """disegna un'analisi nel riquadro (X, Y) in basso a sinistra, W x H"""
    M = 7.5 * mm
    MT, MB = 6.5 * mm, 4.5 * mm
    top = Y + H - MT
    # intestazione: a sinistra l'attività, a destra ricerca e data
    nm, _, addr = cfg["subtitle"].partition(" · ")
    nm, addr = html.unescape(nm), html.unescape(addr)   # in drawString le entità resterebbero letterali
    hy = top - 2.4 * mm
    rt = (JOB["occhiello"].replace("  ", " ").rsplit(",", 1)[0] + " · " + cfg["date"]).upper()
    rw_ = c.stringWidth(rt, "MOB", 5.2) + .5 * len(rt)
    fn = 10.5
    while c.stringWidth(nm, "C", fn) + c.stringWidth(addr, "MO", 6.2) + 12 * mm > W - 2 * M - rw_ and fn > 8: fn -= .25
    # nomi lunghissimi: il nome tiene almeno il 60% dello spazio, l'indirizzo prende il resto o sparisce
    disp = W - 2 * M - rw_ - 6.3 * mm - 3 * mm
    aw = c.stringWidth(addr, "MO", 6.2) + 2.2 * mm if addr else 0
    corto = tronca(nm, "C", fn, max(disp - aw, disp * .6))
    if corto != nm: AVVISI.append(f"Nome troppo lungo nell'intestazione, accorciato: {nm}")
    nm = corto
    resto = disp - c.stringWidth(nm, "C", fn) - 2.2 * mm
    addr = tronca(addr, "MO", 6.2, resto) if resto > 12 * mm else ""
    c.setFillColor(C_TOP); c.rect(X + M, hy + .5 * mm, 4.5 * mm, .9 * mm, stroke=0, fill=1)
    c.setFillColor(INK); c.setFont("C", fn); c.drawString(X + M + 6.3 * mm, hy, nm)
    c.setFillColor(MUTE); c.setFont("MO", 6.2); c.drawString(X + M + 6.3 * mm + c.stringWidth(nm, "C", fn) + 2.2 * mm, hy, addr)
    t = c.beginText(); t.setFont("MOB", 5.2); t.setCharSpace(.5)
    t.setTextOrigin(X + W - M - rw_, hy); t.setFillColor(MUTE); t.textOut(rt); t.setCharSpace(0); c.drawText(t)
    c.setStrokeColor(LINE); c.setLineWidth(.5); c.line(X + M, hy - 2 * mm, X + W - M, hy - 2 * mm)
    # titolo breve
    yy = hy - 3.6 * mm
    ft = 16
    while ft > 11 and P(cfg["title"], "C", ft, ft * 17 / 16).wrap(W - 2 * M, 500 * mm)[1] > TMAX: ft -= .5
    tp, lungo = adatta(lambda t: P(t, "C", ft, ft * 17 / 16), cfg["title"], W - 2 * M, TMAX)
    yy -= draw_par(c, tp, X + M, yy, W - 2 * M) + 3.2 * mm
    body_top = yy
    foot_h = 7.2 * mm
    body_bot = Y + MB + foot_h
    # mappa: metà sinistra
    half = W / 2
    cosa = next((b for h_, b in cfg["blocks"] if not isinstance(b, dict)), None)
    fcosa = lambda t, k_: P(f"<font name='C' size='{9 * k_:.2f}'>Cosa vuol dire</font><br/>{stars(t)}", "P", 6.7 * k_, 8.8 * k_, NEGTX)
    alto = body_top - body_bot - 1.5 * mm - 7.2 * mm   # mappa + legenda + box "Cosa vuol dire"
    for kl in (1.0, .92, .84, .76):   # testo lungo: prima si riduce il corpo, poi si rinuncia a parte della mappa
        S = 88 * mm
        for _ in range(4):
            cp = fcosa(cosa, kl)
            _, hcosa = cp.wrap(S - 5 * mm, 80 * mm)
            S = min(half - M - 3 * mm, alto - (hcosa + 3.2 * mm), 94 * mm)
        if S >= SMIN: break
    if S < SMIN: lungo = True; S = SMIN
    else: SLOG.append(S)     # un'analisi fuori misura non rimpicciolisce le mappe delle altre
    if SFIX and S >= SFIX: S = SFIX
    S = min(S, alto - 8 * mm)
    hbox = alto - S
    for kk in [x / 100 for x in range(130, 99, -2)]:
        cq = fcosa(cosa, kk)
        if cq.wrap(S - 5.8 * mm, 80 * mm)[1] <= hbox - 3.6 * mm:
            cp = cq; break
    else:
        if cp.wrap(S - 5.8 * mm, 80 * mm)[1] > hbox - .5 * mm:   # il testo esce dal box: corpo più piccolo, poi taglio
            for kk in [x / 100 for x in range(98, 69, -2)]:
                cq = fcosa(cosa, kk)
                if cq.wrap(S - 5.8 * mm, 80 * mm)[1] <= hbox - 3.6 * mm:
                    cp = cq; break
            else:
                cp, tagliato = adatta(lambda t: fcosa(t, .7), cosa, S - 5.8 * mm, hbox - 3.6 * mm); lungo = lungo or tagliato
    if lungo: AVVISI.append(f"Testo troppo lungo per {html.unescape(cfg['name'])}: accorcia titolo o 'Cosa vuol dire'")
    _, hcosa = cp.wrap(S - 5.8 * mm, 80 * mm)
    mx = X + M; my = body_top - S
    BG = cfg.get("bg")
    if BG:
        c.saveState(); pth = c.beginPath(); pth.roundRect(mx, my, S, S, 1.5 * mm); c.clipPath(pth, stroke=0, fill=0)
        c.drawImage(BG, mx, my, S, S); c.restoreState()
        c.setStrokeColor(LINE); c.setLineWidth(.6); c.roundRect(mx, my, S, S, 1.5 * mm, stroke=1, fill=0)
    else:
        c.setFillColor(BOX); c.setStrokeColor(LINE); c.setLineWidth(.6); c.roundRect(mx, my, S, S, 1.5 * mm, stroke=1, fill=1)
    lats = [float(p["lat"]) for p in DP]; lngs = [float(p["lng"]) for p in DP]
    la0, la1, lo0, lo1 = min(lats), max(lats), min(lngs), max(lngs)
    # griglia di un punto o di una sola riga/colonna: si allarga l'asse piatto per non dividere per zero
    if la1 - la0 < 1e-9: d = (lo1 - lo0) * .7 / 2 or .005; la0, la1 = la0 - d, la1 + d
    if lo1 - lo0 < 1e-9: d = (la1 - la0) / .7 / 2 or .007; lo0, lo1 = lo0 - d, lo1 + d
    pad = S * (.203 if BG else .085)
    xy = lambda la, lo: (mx + pad + (lo - lo0) / (lo1 - lo0) * (S - 2 * pad), my + pad + (la - la0) / (la1 - la0) * (S - 2 * pad))
    rr = (S - 2 * pad) / 6 * (.36 if BG else .40)
    for pt in DP:
        r = next((q["rank"] for q in pt["results"] if q["place_id"] == cfg["pid"]), None)
        x, y = xy(float(pt["lat"]), float(pt["lng"]))
        c.setFillColor(color(r)); c.setStrokeColor(white); c.setLineWidth(1 if BG else .8); c.circle(x, y, rr, stroke=1, fill=1)
        c.setFillColor(white if r else HexColor("#5E5A52")); c.setFont("P-B" if BG else "P-M", (6 if r else 4.6) if BG else (6.4 if r else 5))
        c.drawCentredString(x, y - ((2.1 if r else 1.6) if BG else (2.2 if r else 1.7)), str(r) if r else "20+")
    x, y = xy(cfg["lat"], cfg["lng"])
    # se il rombo coprirebbe un numero, lo sposto sul bordo del cerchio più vicino
    cx, cy = min((xy(float(p["lat"]), float(p["lng"])) for p in DP), key=lambda q: math.hypot(q[0] - x, q[1] - y))
    if math.hypot(cx - x, cy - y) < rr * 1.15:
        ang = math.atan2(y - cy, x - cx) if math.hypot(cx - x, cy - y) > rr * .35 else math.radians(45)
        x, y = cx + rr * math.cos(ang), cy + rr * math.sin(ang)
    c.setFillColor(INK); c.setStrokeColor(white); c.setLineWidth(1)
    c.saveState(); c.translate(x, y); c.rotate(45); c.rect(-1.6 * mm, -1.6 * mm, 3.2 * mm, 3.2 * mm, stroke=1, fill=1); c.restoreState()
    # scala 500 m
    span_m = (lo1 - lo0) * 111320 * math.cos(math.radians(JOB.get("lat_centro", 45.057)))
    px = 500 / span_m * (S - 2 * pad)
    sx, sy = (mx + S - px - 12 * mm, my + 2.6 * mm) if BG else (mx + 3 * mm, my + 2.6 * mm)
    if BG:
        c.setFillColor(white); c.setFillAlpha(.85); c.roundRect(sx - 1.5 * mm, sy - 1.8 * mm, px + 12 * mm, 4 * mm, .8 * mm, stroke=0, fill=1); c.setFillAlpha(1)
    c.setStrokeColor(INK); c.setLineWidth(.7); c.line(sx, sy, sx + px, sy)
    c.setFillColor(INK); c.setFont("MO", 5.5); c.drawString(sx + px + 1.2 * mm, sy - .7 * mm, "500 m")
    # legenda centrata sotto la mappa
    items = [(C_TOP, "Visibile", "1-3"), (C_MID, "Poco visibile", "4-10"), (C_LOW, "Invisibile", "11-20"), (C_NO, "Assente", "oltre 20"), (None, luogo_legenda(cfg), "")]
    fs = 5.6
    def iw_(b, r): return 3.2 * mm + c.stringWidth(b, "P-B", fs) + (c.stringWidth(" " + r, "MO", fs) if r else 0) + 2 * mm
    while sum(iw_(b, r) for _, b, r in items) - 2 * mm > S and fs > 4.4: fs -= .1
    widths = [iw_(b, r) for _, b, r in items]
    lx = mx + (S - sum(widths) + 2 * mm) / 2; ly = my - 4.5 * mm
    for (col, b, r), w in zip(items, widths):
        if col is None:
            c.setFillColor(INK); c.saveState(); c.translate(lx + 1.1 * mm, ly + .75 * mm); c.rotate(45); c.rect(-.85 * mm, -.85 * mm, 1.7 * mm, 1.7 * mm, stroke=0, fill=1); c.restoreState()
        else:
            c.setFillColor(col); c.circle(lx + 1.1 * mm, ly + .75 * mm, 1.15 * mm, stroke=0, fill=1)
        c.setFillColor(INK); c.setFont("P-B", fs); c.drawString(lx + 3 * mm, ly, b)
        if r:
            c.setFillColor(MUTE); c.setFont("MO", fs); c.drawString(lx + 3 * mm + c.stringWidth(b, "P-B", fs) + c.stringWidth(" ", "MO", fs), ly, r)
        lx += w
    # colonna destra
    # "Cosa vuol dire" sotto la mappa, allineato in basso
    cb = body_bot + 1.5 * mm
    c.setFillColor(NEGBG); c.roundRect(mx, cb, S, hbox, 1.2 * mm, stroke=0, fill=1)
    c.setFillColor(NEGBR); c.rect(mx, cb, 1.1 * mm, hbox, stroke=0, fill=1)
    cp.drawOn(c, mx + 3.2 * mm, cb + (hbox - hcosa) / 2)
    cfg = dict(cfg); cfg["blocks"] = [b for b in cfg["blocks"] if isinstance(b[1], dict)]
    rx = mx + S + 5 * mm; rw = X + W - M - rx
    avail = body_top - (body_bot + 1.5 * mm)
    k = 1.0
    for kk in [x / 100 for x in range(120, 78, -2)]:
        if right_column(c, cfg, rx, rw, body_top, kk, 0, draw=False) <= avail:
            k = kk; break
    need = right_column(c, cfg, rx, rw, body_top, k, 0, draw=False)
    extra = max(0, (avail - need) / 2)
    ry = body_top - right_column(c, cfg, rx, rw, body_top, k, extra, draw=True)
    # piè di pagina centrato
    fy = Y + MB + foot_h
    c.setStrokeColor(LINE); c.setLineWidth(.5); c.line(X + M, fy - .6 * mm, X + W - M, fy - .6 * mm)
    h = draw_par(c, P(cfg["method"], "MO", 4.9, 6.5, MUTE), X + M, fy - 1.8 * mm, W - 2 * M)
    if ry < fy + .9 * mm: AVVISI.append(f"{cfg['name']}: testo troppo lungo, sfora di {round((fy - ry) / mm, 1)} mm")
    if k < .9: AVVISI.append(f"{cfg['name']}: colonna destra compressa al {round(k * 100)}%")
    return ry


def right_column(c, cfg, rx, rw, top, k, extra, draw):
    """colonna destra in stile IPSIG: numeri, classifica, prossimo passo e contatti. Restituisce l'altezza usata."""
    y = top
    # numeri chiave senza riquadri: cifra condensata, etichetta mono
    gap = 3 * mm; bw = (rw - 2 * gap) / 3
    labs = [P(stars(posizioni(st["lab"]).replace(" 3", "\u00a03").replace(" 20", "\u00a020")).upper().replace("<FONT NAME='DJ' COLOR='#E0A43A'>", "<font name='DJ' color='#E0A43A'>").replace("</FONT>", "</font>"), "MOB", 5 * k, 6.4 * k, MUTE) for st in cfg["stats"]]
    fb = 21 * k
    def wstat(st, f): return c.stringWidth(st["big"], "C", f) + (c.stringWidth(st.get("pct", ""), "C", f * .55) + 1.4 * mm if st.get("pct") else 0)
    while max((wstat(st, fb) for st in cfg["stats"]), default=0) > bw - 1 * mm and fb > 12: fb -= .5
    bh = fb * .78 + 1.6 * mm + max((l.wrap(bw, 50 * mm)[1] for l in labs), default=0)
    if draw:
        for i, s in enumerate(cfg["stats"]):
            bx = rx + i * (bw + gap); col = s.get("color")
            col = {"top": C_TOP, "mid": C_MID, "low": C_LOW, "ink": INK}[col] if col else INK
            big, pct = s["big"], s.get("pct", "")
            c.setFillColor(col); c.setFont("C", fb); c.drawString(bx, y - fb * .78, big)
            if pct:
                c.setFont("C", fb * .55); c.drawString(bx + c.stringWidth(big, "C", fb) + 1.4 * mm, y - fb * .78, pct)
            labs[i].drawOn(c, bx, y - fb * .78 - 1.6 * mm - labs[i].height)
    y -= bh + 2.4 * mm + extra
    # scheda non rivendicata: avviso in tinta chiara
    if cfg.get("unclaimed"):
        ap = P(f"<font name='C' size='{8.6 * k:.2f}'>⚠ La sua scheda Google risulta non rivendicata</font><br/>"
               "Oggi nessuno la gestisce: non può rispondere alle recensioni da titolare né ricevere avvisi quando qualcuno la modifica.",
               "P", 6.1 * k, 7.6 * k, NEGTX)
        _, ha = ap.wrap(rw - 10.5 * mm, 40 * mm)
        hb = ha + 3 * mm
        if draw:
            c.setFillColor(NEGBG); c.roundRect(rx, y - hb, rw, hb, 1.2 * mm, stroke=0, fill=1)
            c.setFillColor(NEGBR); c.rect(rx, y - hb, 1.1 * mm, hb, stroke=0, fill=1)
            ap.drawOn(c, rx + 8.6 * mm, y - 1.5 * mm - ha)
            ix, iy = rx + 5 * mm, y - hb / 2
            c.setStrokeColor(NEGBR); c.setLineWidth(.9); c.setFillColor(white); c.circle(ix, iy, 2.3 * mm, stroke=1, fill=1)
            c.setFillColor(NEGBR); c.setFont("C", 9); c.drawCentredString(ix, iy - 1.1 * mm, "!")
        y -= hb + 2.4 * mm
    # classifica
    rh = 3.75 * mm * k
    if draw:
        c.setFillColor(INK); c.setFont("C", 10.5 * k); c.drawString(rx, y - 3.4 * mm * k, cfg["list_title"])
    y -= 5.2 * mm * k
    if draw:
        t = c.beginText(rx, y - 2.2 * mm); t.setFont("MOB", 4.8 * k); t.setCharSpace(.5); t.setFillColor(MUTE); t.textOut(cfg.get("list_head") or "CLASSIFICA"); t.setCharSpace(0); c.drawText(t)
        t = c.beginText(rx + rw - c.stringWidth("RECENSIONI", "MOB", 4.8 * k) - 9 * .5, y - 2.2 * mm); t.setFont("MOB", 4.8 * k); t.setCharSpace(.5); t.setFillColor(MUTE); t.textOut("RECENSIONI"); t.setCharSpace(0); c.drawText(t)
        c.setStrokeColor(LINE); c.setLineWidth(.4); c.line(rx, y - 3.2 * mm, rx + rw, y - 3.2 * mm)
    y -= 3.6 * mm
    sep_done = False
    for rank, nm, rev, me in cfg["list"]:
        if (rank is None or rank > 3) and not sep_done and any(r_ and r_ <= 3 for r_, *_ in cfg["list"]):
            sep_done = True
            if draw:
                t = c.beginText(rx, y - 2.3 * mm); t.setFont("MOB", 4.6 * k); t.setCharSpace(.45); t.setFillColor(MUTE); t.textOut("OLTRE LE PRIME 3 POSIZIONI"); t.setCharSpace(0); c.drawText(t)
                x0 = rx + c.stringWidth("OLTRE LE PRIME 3 POSIZIONI", "MOB", 4.6 * k) + 26 * .45 + 2 * mm
                c.setStrokeColor(LINE); c.setLineWidth(.5); c.setDash(1.5, 1.5); c.line(x0, y - 1.9 * mm, rx + rw, y - 1.9 * mm); c.setDash()
            y -= 3.2 * mm
        col = color(rank)
        if draw:
            if me:
                c.setFillColor(HexColor("#EAF1FD")); c.roundRect(rx - 1 * mm, y - rh + .3 * mm, rw + 1 * mm, rh, .8 * mm, stroke=0, fill=1)
                c.setFillColor(HOME); c.rect(rx - 1 * mm, y - rh + .3 * mm, .9 * mm, rh, stroke=0, fill=1)
            cy = y - rh / 2 + .3 * mm
            c.setFillColor(col); c.circle(rx + 2.4 * mm, cy, 1.65 * mm * min(k, 1.1), stroke=0, fill=1)
            c.setFillColor(white if rank else INK); c.setFont("MOB", (5.6 if rank else 4) * min(k, 1.1)); c.drawCentredString(rx + 2.4 * mm, cy - .65 * mm, str(rank) if rank else "20+")
            fn = "P-B" if me else "P"
            # il nome non deve arrivare sotto le recensioni né spingere fuori il bollino LEI
            fine = rx + rw - ((c.stringWidth("\u2605", "DJ", 6.4 * k) + .8 * mm + c.stringWidth(rev, "MOM", 6.2 * k) + 2 * mm) if rev else 0)
            if me: fine -= c.stringWidth("LEI", "MOB", 4.6 * k) + 3.4 * mm
            nm = tronca(html.unescape(nm), fn, 7 * k, fine - rx - 5.6 * mm)
            c.setFillColor(INK); c.setFont(fn, 7 * k); c.drawString(rx + 5.6 * mm, cy - .85 * mm * k, nm)
            if me:
                tx = rx + 5.6 * mm + c.stringWidth(nm, fn, 7 * k) + 1.6 * mm; tw_ = c.stringWidth("LEI", "MOB", 4.6 * k) + 1.8 * mm
                c.setFillColor(HOME); c.roundRect(tx, cy - 1.15 * mm, tw_, 2.3 * mm, .5 * mm, stroke=0, fill=1)
                c.setFillColor(white); c.setFont("MOB", 4.6 * k); c.drawCentredString(tx + tw_ / 2, cy - .55 * mm, "LEI")
            if rev:
                sw = c.stringWidth("\u2605", "DJ", 6.4 * k)
                c.setFillColor(C_MID); c.setFont("DJ", 6.4 * k); c.drawRightString(rx + rw, cy - .8 * mm * k, "\u2605")
                c.setFillColor(INK if me else MUTE); c.setFont("MOM", 6.2 * k); c.drawRightString(rx + rw - sw - .8 * mm, cy - .8 * mm * k, rev)
        y -= rh
    y -= 2.4 * mm + extra
    # prossimo passo: titolo, descrizione con la proposta in coda, sotto i contatti in un box bordato di verde
    for hd, body in cfg["blocks"]:
        iw = rw
        outro = body["outro"].replace(":<br/>", ": ")
        h1 = P(f"<font name='C' size='{10.5 * k:.2f}' color='#2E7D5B'>{hd}</font><br/>{body['intro']}<br/><b>{outro}</b>", "P", 6.6 * k, 8.8 * k)
        _, hi = h1.wrap(iw, 80 * mm)
        g = 4 * mm; cw = (iw - g) / 2
        cells = [P(f"<font name='C' size='{7.8 * k:.2f}'>{t}</font>&nbsp;&nbsp;{d}", "P", 6.4 * k, 8.2 * k, INK) for t, d in body["items"]]
        tw = cw - 3.4 * mm
        rows = [max(cells[j].wrap(tw, 20 * mm)[1] for j in (i, i + 1) if j < len(cells)) for i in range(0, len(cells), 2)]
        ch = sum(rows) + 1.6 * mm * (len(rows) - 1) + 2.6 * mm if cells else 0
        kk = min(k, 1.1)
        hct = 14.5 * mm * kk
        gap = 3.6 * mm
        tot = hi + gap + ch + hct
        if draw:
            yy = y
            h1.drawOn(c, rx, yy - hi); yy -= hi + gap
            for i, p_ in enumerate(cells):
                cx = rx + (i % 2) * (cw + g); cy = yy - sum(rows[r] + 1.6 * mm for r in range(i // 2))
                c.setFillColor(C_TOP); c.circle(cx + 1.1 * mm, cy - 1.95 * mm * k, .8 * mm, stroke=0, fill=1)
                p_.wrap(tw, 20 * mm); p_.drawOn(c, cx + 3.4 * mm, cy - p_.height)
            yy -= ch
            # contatti: sfondo bianco, bordo verde
            c.setFillColor(white); c.setStrokeColor(C_TOP); c.setLineWidth(1)
            c.roundRect(rx + .5, yy - hct, iw - 1, hct, 1.6 * mm, stroke=1, fill=1)
            mid = yy - hct / 2
            x0 = rx + 4.2 * mm
            c.setFillColor(INK); c.setFont("C", 12 * kk); c.drawString(x0, mid + .6 * mm, JOB["firma"]["nome"])
            t = c.beginText(x0, mid - 3 * mm * kk); t.setFont("MOB", 4.8 * kk); t.setCharSpace(.6); t.setFillColor(MUTE); t.textOut(JOB["firma"]["ruolo"].upper()); t.setCharSpace(0); c.drawText(t)
            x1 = rx + iw * .47
            c.setFillColor(C_TOP); c.setFont("DJ", 8.4 * kk); c.drawString(x1, mid + 1.1 * mm, "\u260E")
            c.setFillColor(INK); c.setFont("CS", 9.8 * kk); c.drawString(x1 + 4.4 * mm, mid + 1.1 * mm, JOB["firma"]["telefono"])
            c.setFillColor(C_TOP); c.setFont("DJ", 8.4 * kk); c.drawString(x1, mid - 3.6 * mm, "\u2709")
            c.setFillColor(INK); c.setFont("CS", 9.8 * kk); c.drawString(x1 + 4.4 * mm, mid - 3.6 * mm, JOB["firma"]["email"])
        y -= tot
    return top - y


def build(cfgs, out):
    W, H = A4
    c = canvas.Canvas(out, pagesize=A4)
    c.setTitle(JOB.get("titolo_pdf", "Rilevazione di quartiere")); c.setAuthor(JOB["firma"]["nome"] + " Consulente")
    for i in range(0, len(cfgs), 2):
        analysis(c, cfgs[i], 0, H / 2, W, H / 2)
        if i + 1 < len(cfgs): analysis(c, cfgs[i + 1], 0, 0, W, H / 2)
        # linea di taglio
        c.setStrokeColor(HexColor("#B8BCC2")); c.setLineWidth(.4); c.setDash(2, 2); c.line(4 * mm, H / 2, W - 4 * mm, H / 2); c.setDash()
        c.setFillColor(HexColor("#B8BCC2")); c.setFont("DJ", 6); c.drawString(4 * mm, H / 2 + .8 * mm, "\u2702")
        c.showPage()
    c.save()


FIRMA = {"nome": "Hector Rinaldi", "ruolo": "Consulente visibilità locale",
         "telefono": "+39 351 894 2667", "email": "hector.rinaldi@italiaonline.it"}


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def prepara(job, cartella):
    """trasforma stampa.json nelle configurazioni attese da analysis(); l'ordine di stampa
    accoppia i e i+metà, così tagliando la risma a metà e sovrapponendo le pile l'ordine del giro resta corretto"""
    global DP, JOB
    JOB = job; JOB["firma"] = {**FIRMA, **(job.get("firma") or {})}
    try:
        DP = [{"lat": float(la), "lng": float(lo), "results": [{"rank": i + 1, "place_id": p} for i, p in enumerate(r or [])]} for la, lo, r in job["punti"]]
    except (KeyError, TypeError, ValueError):
        DP = []
    if not DP:
        raise ValueError("griglia non utilizzabile in stampa.json: mancano i punti o hanno coordinate non valide. Rifai l'importazione della scansione dall'app.")
    bg = os.path.join(cartella, job["sfondo"]) if job.get("sfondo") else None
    if bg and not os.path.exists(bg): AVVISI.append("sfondo mappa non trovato: stampa senza mappa"); bg = None
    nxt = {**PROSSIMO_PASSO, **(job.get("prossimo_passo") or {})}
    nxt = {"intro": esc(nxt["intro"]), "items": [], "outro": esc(nxt["outro"]).replace(": ", ":<br/>", 1)}
    try:
        att = json.load(open(os.path.join(cartella, "zona.json"), encoding="utf-8")).get("attivita", {})
    except Exception:
        att = {}
    cfgs = []
    for a in job["analisi"]:
        c = dict(a)
        if "unclaimed" not in c: c["unclaimed"] = (att.get(a["pid"]) or {}).get("c") is False
        c["title"] = esc(a["title"]); c["subtitle"] = esc(a["subtitle"]); c["method"] = esc(a["method"])
        c["stats"] = [{**s, "lab": esc(s["lab"])} for s in a["stats"]]
        # list e list_title vanno in drawString: testo semplice, niente escape
        c["blocks"] = [["Cosa vuol dire", esc(a["cosa"])], ["Il prossimo passo", nxt]]
        c["bg"] = bg
        cfgs.append(c)
    h = (len(cfgs) + 1) // 2
    out = []
    for i in range(h):
        out.append(cfgs[i])
        if i + h < len(cfgs): out.append(cfgs[i + h])
    return out


def genera(percorso_job):
    import io
    global SFIX
    cartella = os.path.dirname(os.path.abspath(percorso_job))
    job = json.load(open(percorso_job, encoding="utf-8"))
    AVVISI.clear()
    if job.get("tipo") == "fogli":   # fogli da lasciare porta a porta: A4 orizzontale, Maps contro AI Mode
        import foglio
        firma = {**FIRMA, **(job.get("firma") or {})}
        os.makedirs(os.path.join(cartella, "stampa"), exist_ok=True)
        nome = job["file"] + ".pdf"
        av = foglio.genera_fogli(job, cartella, os.path.join(cartella, "stampa", nome), firma)
        esito = {"file": "stampa/" + nome, "richiesta": job.get("richiesta"), "tipo": "fogli",
                 "analisi": len(job["fogli"]), "fogli": len(job["fogli"]), "avvisi": sorted(set(av))}
        json.dump(esito, open(os.path.join(cartella, "stampa", "esito.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(json.dumps(esito, ensure_ascii=False, indent=1))
        return
    cfgs = prepara(job, cartella)
    pre = list(AVVISI)                   # avvisi di prepara (sfondo mancante): non vanno persi col primo passaggio
    SLOG.clear(); SFIX = None
    build(cfgs, io.BytesIO())            # primo passaggio: misura la mappa più piccola
    SFIX = min(SLOG) if SLOG else None; AVVISI[:] = pre   # secondo passaggio: stessa dimensione mappa su tutte le analisi
    os.makedirs(os.path.join(cartella, "stampa"), exist_ok=True)
    nome = job["file"] + ".pdf"
    build(cfgs, os.path.join(cartella, "stampa", nome))
    esito = {"file": "stampa/" + nome, "richiesta": job.get("richiesta"), "analisi": len(cfgs),
             "fogli": (len(cfgs) + 1) // 2, "avvisi": sorted(set(AVVISI))}
    json.dump(esito, open(os.path.join(cartella, "stampa", "esito.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps(esito, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    try:
        genera(sys.argv[1])
    except ValueError as e:   # dati inutilizzabili: messaggio chiaro nel log invece del traceback
        print("ERRORE:", e, file=sys.stderr); sys.exit(1)

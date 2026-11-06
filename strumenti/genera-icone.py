"""Genera le icone dell'app (pallini 3x3 con anello sul centro) da un SVG geometrico.
Uso: python3 strumenti/genera-icone.py   (dalla radice del repo; serve Playwright)"""
import pathlib, base64
from playwright.sync_api import sync_playwright

RADICE = pathlib.Path(__file__).resolve().parent.parent
INK, FLUO = '#141212', '#FE3E2F'
# (colore, numero, colore testo) per riga, da sinistra a destra
GRIGLIA = [
    [('#34A853', '2', '#FFFFFF'), ('#F6C026', '5', INK), ('#E8603C', '12', '#FFFFFF')],
    [('#1E8E3E', '1', '#FFFFFF'), ('#1E8E3E', '1', '#FFFFFF'), ('#C5221F', '', '#FFFFFF')],
    [('#6CC24A', '3', INK), ('#F29529', '8', INK), ('#E8603C', '15', '#FFFFFF')],
]
PASSO, R = 140, 52            # distanza tra i centri e raggio dei pallini (su 512)
ANELLO_R, ANELLO_S = 66, 9    # anello: raggio della linea mediana e spessore

def svg(scala=1.0, sfondo=None):
    c = 256
    el = []
    if sfondo:
        el.append(f'<rect width="512" height="512" fill="{sfondo}"/>')
    el.append(f'<g transform="translate({c} {c}) scale({scala}) translate({-c} {-c})">')
    for i, riga in enumerate(GRIGLIA):
        for j, (col, num, tcol) in enumerate(riga):
            x, y = c + (j - 1) * PASSO, c + (i - 1) * PASSO
            if i == 1 and j == 1:
                el.append(f'<circle cx="{x}" cy="{y}" r="{ANELLO_R}" fill="none" stroke="{FLUO}" stroke-width="{ANELLO_S}"/>')
            el.append(f'<circle cx="{x}" cy="{y}" r="{R}" fill="{col}"/>')
            if num:
                fs = 58 if len(num) == 1 else 50
                el.append(f'<text x="{x}" y="{y}" font-size="{fs}" fill="{tcol}" text-anchor="middle" '
                          f'dominant-baseline="central" letter-spacing="{-1 if len(num) > 1 else 0}">{num}</text>')
    el.append('</g>')
    return '\n'.join(el)

def pagina(contenuto):
    font = base64.b64encode((RADICE / 'fonti/space-grotesk-latin-600-normal.woff2').read_bytes()).decode()
    return f'''<!doctype html><html><head><style>
@font-face{{font-family:SG;src:url(data:font/woff2;base64,{font}) format("woff2");font-weight:600}}
html,body{{margin:0;background:transparent}} text{{font-family:SG;font-weight:600}}
</style></head><body><svg id="s" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">{contenuto}</svg></body></html>'''

ICONE = [  # file, lato, scala, sfondo
    ('icon-512.png', 512, 0.94, INK),
    ('icon-192.png', 192, 0.94, INK),
    ('icon-maskable-512.png', 512, 0.78, INK),   # contenuto nella zona sicura (cerchio 80%)
    ('icon-maskable-192.png', 192, 0.78, INK),
    ('apple-touch-icon.png', 180, 0.94, INK),
]

if __name__ == '__main__':
    with sync_playwright() as p:
        b = p.chromium.launch()
        for nome, lato, scala, sfondo in ICONE:
            pg = b.new_page(viewport={'width': 512, 'height': 512}, device_scale_factor=lato / 512)
            pg.set_content(pagina(svg(scala, sfondo)))
            pg.evaluate('document.fonts.ready')
            pg.locator('#s').screenshot(path=str(RADICE / nome), omit_background=sfondo is None)
            pg.close()
            print('ok', nome, lato)
        b.close()

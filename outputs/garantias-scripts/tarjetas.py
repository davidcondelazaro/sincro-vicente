import sys, math
from PIL import Image, ImageDraw, ImageFont
D = sys.argv[1]
F = "/System/Library/Fonts/Supplemental/"
def font(n, s): return ImageFont.truetype(F + n, s)
ROJO, AZUL, NAR, NEGRO, AMAR = (227,30,36), (0,159,227), (240,125,25), (30,30,30), (255,237,0)
BASE = {250: "cover_8033509885191.png", 500: "cover_8033509885207.png", 1000: "cover_8033509885214.png", 2000: "cover_8033509885276.png"}
COLOR = {250: (145,192,44), 500: (229,9,127), 1000: (131,78,152), 2000: (11,107,169)}
# Combi usa la paleta de las ampliaciones +2/+3 (como su tarjeta oficial), no la de Cover
AMPL = {250: (1,176,83), 500: (227,31,35), 1000: (0,161,226), 2000: (239,127,27)}
NUEVO = {150: (243,146,0), 1500: (90,40,110)}  # topes de Display sin tarjeta Cover

def recolorea(im, src, dst, caja):
    px = im.load(); x0,y0,x1,y1 = caja
    for y in range(y0,y1):
        for x in range(x0,x1):
            r,g,b = px[x,y]
            # mezcla de blanco y color origen: se mide con el canal más bajo del color origen
            ch = min(range(3), key=lambda i: src[i]); v = (r,g,b)[ch]
            t = max(0, min(1, (255 - v) / (255 - src[ch])))
            # solo si el píxel se parece al tono origen (descarta negro y grises)
            exp = tuple(255*(1-t) + src[i]*t for i in range(3))
            if sum(abs((r,g,b)[i]-exp[i]) for i in range(3)) < 90:
                px[x,y] = tuple(round(255*(1-t) + dst[i]*t) for i in range(3))

def importes(im, tope, color):
    d = ImageDraw.Draw(im); w = im.width
    txt = f"{tope} €"; s = 92
    while d.textlength(txt, font=font("Arial Bold.ttf", s)) > 235: s -= 2
    f = font("Arial Bold.ttf", s)
    for cx in (192, w-196):
        d.rectangle([cx-170, 86, cx+170, 156], fill="white")
        d.text((cx, 148), txt, font=f, fill=color, anchor="ms")

def centra(d, y, partes):
    # partes: [(texto, fuente, color, dy)] en una línea, alineadas por la base
    anchos = [d.textlength(t, font=f) for t,f,c,dy in partes]; esp = 18
    x = (1182 - sum(anchos) - esp*(len(partes)-1)) / 2
    for (t,f,c,dy),a in zip(partes, anchos):
        d.text((x, y+dy), t, font=f, fill=c, anchor="ls"); x += a + esp

def sello(im, texto, cx, cy, ang):
    f = font("Arial Black.ttf", 84)
    tw = ImageDraw.Draw(im).textlength(texto, font=f)
    w, h = int(tw + 90), 140
    s = Image.new("RGBA", (w, h), (0,0,0,0)); d = ImageDraw.Draw(s)
    d.rounded_rectangle([4,4,w-5,h-5], radius=14, fill=AMAR, outline=NEGRO, width=8)
    d.text((w/2, h/2+4), texto, font=f, fill=NEGRO, anchor="mm")
    s = s.rotate(ang, expand=True, resample=Image.BICUBIC)
    im.paste(s, (int(cx - s.width/2), int(cy - s.height/2)), s)

def tarjeta(tipo, tope):
    base = BASE.get(tope, BASE[500]); color = COLOR.get(tope) or NUEVO[tope]
    im = Image.open(D + base).convert("RGB")
    if im.size != (1182,1536): im = im.resize((1182,1536), Image.LANCZOS)
    if tope not in BASE:
        recolorea(im, COLOR[500], color, (0,40,1182,165)); recolorea(im, COLOR[500], color, (0,975,1182,1095))
        importes(im, tope, color)
    if tipo == "combi":
        recolorea(im, COLOR[tope], AMPL[tope], (0,40,1182,165)); recolorea(im, COLOR[tope], AMPL[tope], (0,975,1182,1095))
    d = ImageDraw.Draw(im)
    d.rectangle([12, 1092, 1170, 1462], fill="white")
    if tipo == "combi":
        sello(im, "COMBI", 290, 1215, 18)
        g, m, p = font("Arial Rounded Bold.ttf", 200), font("Arial Rounded Bold.ttf", 96), font("Arial Rounded Bold.ttf", 66)
        d.text((560, 1300), "2", font=g, fill=ROJO, anchor="ls")
        d.text((700, 1200), "años", font=m, fill=AZUL, anchor="ls")
        d.text((700, 1300), "más", font=m, fill=NAR, anchor="ls")
        centra(d, 1445, [("+ 12 meses", p, ROJO, 0), ("daño accidental", p, NAR, 0)])
    else:
        sello(im, "DISPLAY", 310, 1250, 18)
        g, m, p = font("Arial Rounded Bold.ttf", 190), font("Arial Rounded Bold.ttf", 96), font("Arial Rounded Bold.ttf", 70)
        a, b = d.textlength("12", font=g), d.textlength("meses", font=m); x = 560 + (590 - a - b - 16) / 2
        d.text((x, 1290), "12", font=g, fill=ROJO, anchor="ls")
        d.text((x + a + 16, 1290), "meses", font=m, fill=AZUL, anchor="ls")
        centra(d, 1415, [("rotura de pantalla", p, NAR, 0)])
    # a 1000×1000 sobre blanco, como las demás
    h = 950; w = round(im.width*h/im.height); im = im.resize((w,h), Image.LANCZOS)
    out = Image.new("RGB", (1000,1000), "white"); out.paste(im, ((1000-w)//2, 25))
    out.save(D + f"garantia3-{tipo}-{tope}.jpg", "JPEG", quality=90, optimize=True); print(tipo, tope)

for t, tope in [("combi",250),("combi",500),("combi",1000),("combi",2000),("display",150),("display",250),("display",500),("display",1000),("display",1500)]:
    tarjeta(t, tope)

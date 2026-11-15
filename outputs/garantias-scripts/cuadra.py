import sys
from PIL import Image
for src, dst in zip(sys.argv[1::2], sys.argv[2::2]):
    im = Image.open(src).convert("RGBA")
    bg = Image.new("RGBA", im.size, (255,255,255,255)); bg.alpha_composite(im); im = bg.convert("RGB")
    h = 950; w = round(im.width * h / im.height)
    im = im.resize((w, h), Image.LANCZOS)
    out = Image.new("RGB", (1000,1000), (255,255,255)); out.paste(im, ((1000-w)//2, (1000-h)//2))
    out.save(dst, "JPEG", quality=90, optimize=True); print(dst, out.size)

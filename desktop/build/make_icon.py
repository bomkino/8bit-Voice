# Draws the 8-bit Voice icons: the app's pixel speech bubble, in its gold, on
# the dark stage with its dot grid.
#
#   python3 desktop/build/make_icon.py
#
# writes, in desktop/build: icon.png and icon.icns (macOS), icon.ico (Windows),
# icons/<size>x<size>.png (Linux) and the DMG window's background; and in
# icons/ at the repo root: the web app's icons. The link preview image,
# icons/social.png, comes from desktop/build/social.html (see its comment).
import io
import os
import struct
import sys

from PIL import Image, ImageDraw, ImageFilter

MARK = ['.###########.',
        '#...........#',
        '#..##.##.##.#',
        '#..##.##.##.#',
        '#...........#',
        '.####..#####.',
        '....#.#......',
        '....##.......']
GOLD = (233, 180, 76)
TOP, BOTTOM = (31, 32, 43), (9, 10, 14)
DOT = (241, 234, 219)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def icon(p=44, S=1024, dy=0, inset=100, radius=185, shadow=True):
    """p: size of one bubble pixel on the 1024 grid; inset and radius: the body."""
    k = S / 1024
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    x0, y0, x1, y1 = inset * k, inset * k, (1024 - inset) * k, (1024 - inset) * k
    r = radius * k
    shade = lambda y: lerp(TOP, BOTTOM, min(1, max(0, (y - y0) / (y1 - y0))) ** 0.9)

    if shadow:
        sh = Image.new('L', (S, S), 0)
        ImageDraw.Draw(sh).rounded_rectangle((x0, y0 + 14 * k, x1, y1 + 14 * k), r, fill=110)
        img.paste((0, 0, 0, 255), (0, 0), sh.filter(ImageFilter.GaussianBlur(18 * k)))

    # body: the stage, a little lighter at the top, with its dot grid lined up
    # on the bubble's pixels
    body = Image.new('RGBA', (S, S))
    bd = ImageDraw.Draw(body)
    for y in range(S):
        bd.line([(0, y), (S, y)], fill=shade(y) + (255,))
    step = p * k
    mx = round((S - 13 * step) / 2)
    my = round((S - 8 * step) / 2 + dy * k)
    dot = max(1, round(step * 0.14))
    yy = my % step
    while yy < S:
        xx = mx % step
        while xx < S:
            cx, cy = xx + step / 2, yy + step / 2
            bd.rectangle((cx - dot / 2, cy - dot / 2, cx + dot / 2 - 1, cy + dot / 2 - 1), fill=lerp(shade(cy), DOT, 0.07) + (255,))
            xx += step
        yy += step

    # the bubble, with a soft bloom under it like a CRT
    mark = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    md = ImageDraw.Draw(mark)
    for j, row in enumerate(MARK):
        for i, c in enumerate(row):
            if c == '#':
                md.rectangle((mx + i * step, my + j * step, mx + (i + 1) * step - 1, my + (j + 1) * step - 1), fill=GOLD + (255,))
    glow = mark.filter(ImageFilter.GaussianBlur(step * 0.9))
    glow.putalpha(glow.split()[3].point(lambda v: int(v * 0.42)))
    body = Image.alpha_composite(Image.alpha_composite(body, glow), mark)

    # a hairline of light along the top edge, like moulded plastic
    hl = Image.new('L', (S, S), 0)
    ImageDraw.Draw(hl).rounded_rectangle((x0, y0, x1, y1), r, outline=40, width=max(1, round(3 * k)))
    fade = Image.linear_gradient('L').resize((S, S)).point(lambda v: 255 - v)
    body.paste((255, 255, 255, 255), (0, 0), Image.composite(hl, Image.new('L', (S, S), 0), fade))

    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((x0, y0, x1, y1), r, fill=255)
    img.paste(body, (0, 0), mask)
    return img


def icns(im, path):
    # PNG entries for every size macOS asks for
    entries = [('icp4', 16), ('icp5', 32), ('icp6', 64), ('ic07', 128), ('ic08', 256), ('ic09', 512), ('ic10', 1024),
               ('ic11', 32), ('ic12', 64), ('ic13', 256), ('ic14', 512)]
    blobs = []
    for typ, size in entries:
        b = io.BytesIO()
        (im if size == im.width else im.resize((size, size), Image.LANCZOS)).save(b, 'PNG')
        d = b.getvalue()
        blobs.append(typ.encode() + struct.pack('>I', len(d) + 8) + d)
    body = b''.join(blobs)
    with open(path, 'wb') as f:
        f.write(b'icns' + struct.pack('>I', len(body) + 8) + body)


def dmg_background(S=1):
    """The Mac disk image window: the stage, the app on the left, an arrow of
    pixels pointing at Applications on the right."""
    W, H = 600 * S, 400 * S
    img = Image.new('RGB', (W, H), BOTTOM)
    d = ImageDraw.Draw(img)
    for y in range(H):
        d.line([(0, y), (W, y)], fill=lerp(TOP, BOTTOM, (y / H) ** 0.9))
    step = 12 * S
    for y in range(step // 2, H, step):
        for x in range(step // 2, W, step):
            d.rectangle((x, y, x + S - 1, y + S - 1), fill=lerp(lerp(TOP, BOTTOM, y / H), DOT, 0.09))
    # arrow between the icons (centres at x=150 and x=450, y=190)
    arrow = ['......#.....', '......##....', '############', '############', '......##....', '......#.....']
    px = 6 * S
    ax, ay = W // 2 - len(arrow[0]) * px // 2, 190 * S - len(arrow) * px // 2
    for j, row in enumerate(arrow):
        for i, c in enumerate(row):
            if c == '#':
                d.rectangle((ax + i * px, ay + j * px, ax + (i + 1) * px - 1, ay + (j + 1) * px - 1), fill=GOLD)
    return img


if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    out = sys.argv[1] if len(sys.argv) > 1 else here
    web = os.path.join(here, '..', '..', 'icons')
    os.makedirs(os.path.join(out, 'icons'), exist_ok=True)
    os.makedirs(web, exist_ok=True)
    # macOS: the standard icon grid, body inset with room for its shadow
    mac = icon(p=44, dy=-12)
    mac.save(os.path.join(out, 'icon.png'))
    icns(mac, os.path.join(out, 'icon.icns'))
    # Linux: a fuller square, no shadow baked in
    lin = icon(p=50, dy=-14, inset=56, radius=200, shadow=False)
    for size in (16, 24, 32, 48, 64, 128, 256, 512, 1024):
        (lin if size == 1024 else lin.resize((size, size), Image.LANCZOS)).save(os.path.join(out, 'icons', f'{size}x{size}.png'))
    # Windows: the same fuller square, every size the shell asks for
    lin.resize((256, 256), Image.LANCZOS).save(os.path.join(out, 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    # the Mac disk image window, at 1x and 2x
    dmg_background(1).save(os.path.join(out, 'background.png'))
    dmg_background(2).save(os.path.join(out, 'background@2x.png'))
    # web: rounded icons, a full-bleed one for masks and home screens
    for size in (192, 512):
        lin.resize((size, size), Image.LANCZOS).save(os.path.join(web, f'icon-{size}.png'))
    full = icon(p=40, dy=-10, inset=0, radius=0, shadow=False)
    full.resize((512, 512), Image.LANCZOS).save(os.path.join(web, 'maskable-512.png'))
    full.resize((180, 180), Image.LANCZOS).convert('RGB').save(os.path.join(web, 'apple-touch-icon.png'))
    lin.resize((32, 32), Image.LANCZOS).save(os.path.join(web, 'favicon-32.png'))

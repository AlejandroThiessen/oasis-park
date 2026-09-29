"""Regenerate the web photos in public/park/ from the original photos in the project root.

The originals are never modified. Portrait photos are cropped to 4:5 around each
structure so the landscape drone stage never needs the empty sky/grass extremes.
Run from the project root: python3 scripts/build-park-photos.py
"""
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'park'

# name: (source, crop centre y as a fraction of the original height or None for no crop)
PHOTOS = {
    'palapa-1': ('IMG_5304.jpeg', 0.47),
    'palapa-2': ('IMG_5303.jpeg', 0.52),
    'palapa-3': ('IMG_5302.jpeg', 0.50),
    'palapa-4': ('IMG_5309.jpeg', None),
    'palapa-5': ('IMG_5299.jpeg', 0.52),
    'palapa-6': ('IMG_7849.jpeg', None),
    'cancha': ('IMG_5295.jpeg', None),
    'futbol': ('IMG_5298.jpeg', None),
}
# Square thumbnails: centre (x, y) as fractions of the original, side as a fraction of the shorter edge.
THUMBS = {
    'palapa-1': (0.52, 0.47, 0.78), 'palapa-2': (0.50, 0.53, 0.95), 'palapa-3': (0.49, 0.51, 0.85),
    'palapa-4': (0.50, 0.48, 1.00), 'palapa-5': (0.55, 0.52, 0.85), 'palapa-6': (0.47, 0.42, 0.80),
    'cancha': (0.55, 0.55, 0.90), 'futbol': (0.58, 0.50, 0.95),
}


def load(name):
    return ImageOps.exif_transpose(Image.open(ROOT / name)).convert('RGB')


def save(im, path, quality):
    im.save(path, 'WEBP', quality=quality, method=6)
    return path.stat().st_size // 1024


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    aerial = Image.open(ROOT / 'public' / 'oasis-park-aerial.png').convert('RGB')
    print('aerial.webp', aerial.size, save(aerial, OUT / 'aerial.webp', 90), 'KB')
    for name, (source, centre) in PHOTOS.items():
        im = load(source)
        w, h = im.size
        if centre is not None and h > w:
            ch = round(w * 5 / 4)
            top = min(max(round(centre * h - ch / 2), 0), h - ch)
            im = im.crop((0, top, w, top + ch))
        long_side = 2400 if im.width / im.height > 2 else (1920 if im.width > im.height else 1600)
        im.thumbnail((long_side, long_side), Image.LANCZOS)
        print(f'{name}.webp', im.size, save(im, OUT / f'{name}.webp', 80), 'KB')
        cx, cy, side = THUMBS[name]
        src = load(source)
        s = round(min(src.size) * side)
        x0 = min(max(round(cx * src.width - s / 2), 0), src.width - s)
        y0 = min(max(round(cy * src.height - s / 2), 0), src.height - s)
        thumb = src.crop((x0, y0, x0 + s, y0 + s)).resize((240, 240), Image.LANCZOS)
        print(f'{name}-thumb.webp', save(thumb, OUT / f'{name}-thumb.webp', 78), 'KB')


if __name__ == '__main__':
    main()

"""Clean up the seller's heavily compressed 900px belt photos for the store (24 Nov 2026).

Reduces JPEG block noise, enlarges to 1440px (sharp on 2x phone screens), sharpens edges and saves
JPEG + WebP. Content is not changed: same photos of the belt that actually ships.
Usage: python enhance_photos.py <src_dir> <out_dir>
"""
import pathlib
import sys

from PIL import Image, ImageEnhance, ImageFilter

SIZE = 1440


def enhance(path: pathlib.Path, out: pathlib.Path):
    im = Image.open(path).convert('RGB')
    # soften 8x8 JPEG blocks and ringing without smearing edges much
    im = Image.blend(im, im.filter(ImageFilter.MedianFilter(3)), 0.45)
    im = im.resize((SIZE, SIZE), Image.LANCZOS)
    im = im.filter(ImageFilter.UnsharpMask(radius=2.2, percent=85, threshold=3))
    im = im.filter(ImageFilter.UnsharpMask(radius=0.8, percent=40, threshold=2))
    im = ImageEnhance.Contrast(im).enhance(1.04)
    im.save(out / f'{path.stem}.jpg', quality=88, optimize=True, progressive=True)
    im.save(out / f'{path.stem}.webp', quality=84, method=6)


if __name__ == '__main__':
    src, dst = map(pathlib.Path, sys.argv[1:3])
    dst.mkdir(parents=True, exist_ok=True)
    for p in sorted(src.glob('belt-*.jpg')):
        enhance(p, dst)
        print(p.name)

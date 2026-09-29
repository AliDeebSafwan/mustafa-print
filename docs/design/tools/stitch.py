"""Joins the slices shots.mjs writes into one image per page. usage: stitch.py OUT_DIR"""
import glob, os, sys
from PIL import Image
out = sys.argv[1]
for parts in sorted(glob.glob(f'{out}/.*.parts')):
    files = [f for f in open(parts).read().split('\n') if f]
    ims = [Image.open(f) for f in files]
    sheet = Image.new('RGB', (ims[0].width, sum(i.height for i in ims)), (255, 255, 255))
    y = 0
    for im in ims: sheet.paste(im, (0, y)); y += im.height
    name = os.path.basename(parts)[1:-len('.parts')]
    sheet.save(f'{out}/{name}.png')
    for f in files: os.remove(f)
    os.remove(parts)

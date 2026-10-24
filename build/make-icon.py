"""Generate build/icon.ico: a blue rounded square split in two, with an 'M'. Run once; the .ico is committed."""
from PIL import Image, ImageDraw, ImageFont
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SIZE = 256
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([8, 8, SIZE - 8, SIZE - 8], radius=48, fill=(47, 111, 221, 255))
# split line
d.rectangle([SIZE // 2 - 4, 40, SIZE // 2 + 4, SIZE - 40], fill=(255, 255, 255, 230))
# left: three "source" lines; right: a "rendered" block
for i, w in enumerate((70, 52, 62)):
    y = 72 + i * 40
    d.rounded_rectangle([44, y, 44 + w, y + 14], radius=7, fill=(255, 255, 255, 200))
d.rounded_rectangle([152, 70, 212, 100], radius=8, fill=(255, 255, 255, 230))
d.rounded_rectangle([152, 118, 212, 128], radius=5, fill=(255, 255, 255, 170))
d.rounded_rectangle([152, 142, 200, 152], radius=5, fill=(255, 255, 255, 170))
d.rounded_rectangle([152, 166, 212, 176], radius=5, fill=(255, 255, 255, 170))

img.save(os.path.join(HERE, "icon.png"))
img.save(os.path.join(HERE, "icon.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("icon written")

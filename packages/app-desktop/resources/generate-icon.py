"""One-off script to generate a placeholder app icon (stylized tree on a
dark rounded square, matching the renderer's dark palette). Not run as part
of any build — regenerate manually if the design changes, or replace with a
real design asset later."""

from PIL import Image, ImageDraw

SIZE = 1024
BG = (20, 22, 26, 255)  # #14161a
ACCENT = (107, 208, 138, 255)  # #6bd08a
TRUNK = (138, 143, 152, 255)  # #8a8f98

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

pad = SIZE * 0.06
corner = SIZE * 0.22
draw.rounded_rectangle([pad, pad, SIZE - pad, SIZE - pad], radius=corner, fill=BG)

cx = SIZE / 2
trunk_w = SIZE * 0.05
trunk_top = SIZE * 0.52
trunk_bottom = SIZE * 0.80
draw.rounded_rectangle(
    [cx - trunk_w / 2, trunk_top, cx + trunk_w / 2, trunk_bottom],
    radius=trunk_w / 2,
    fill=TRUNK,
)

def branch(x1, y1, x2, y2, width):
    draw.line([x1, y1, x2, y2], fill=TRUNK, width=int(width))

branch(cx, trunk_top + SIZE * 0.02, cx - SIZE * 0.16, SIZE * 0.40, SIZE * 0.022)
branch(cx, trunk_top + SIZE * 0.02, cx + SIZE * 0.16, SIZE * 0.40, SIZE * 0.022)
branch(cx, trunk_top - SIZE * 0.04, cx, SIZE * 0.30, SIZE * 0.022)

nodes = [
    (cx, SIZE * 0.26, 0.052),
    (cx - SIZE * 0.20, SIZE * 0.36, 0.040),
    (cx + SIZE * 0.20, SIZE * 0.36, 0.040),
    (cx - SIZE * 0.30, SIZE * 0.46, 0.030),
    (cx + SIZE * 0.30, SIZE * 0.46, 0.030),
]
for nx, ny, r in nodes:
    rr = SIZE * r
    draw.ellipse([nx - rr, ny - rr, nx + rr, ny + rr], fill=ACCENT)

root_w = SIZE * 0.11
draw.ellipse(
    [cx - root_w, trunk_bottom - SIZE * 0.02, cx + root_w, trunk_bottom + SIZE * 0.05],
    fill=TRUNK,
)

img.save("icon-1024.png")

sizes = [16, 24, 32, 48, 64, 128, 256]
img.save("icon.ico", sizes=[(s, s) for s in sizes])

try:
    img.save("icon.icns")
    print("wrote icon.icns")
except Exception as e:
    print("icns write failed:", e)

img.resize((512, 512), Image.LANCZOS).save("icon.png")
print("done")

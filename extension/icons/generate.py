"""Generate the extension's local PNG mark. Requires Pillow; no network."""
from pathlib import Path
from PIL import Image, ImageDraw


def main():
    root = Path(__file__).resolve().parent
    image = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((8, 8, 504, 504), radius=72, fill="#236346")
    draw.polygon([(256, 91), (399, 147), (390, 292), (344, 368), (256, 425),
                  (168, 368), (122, 292), (113, 147)], fill="#f3f8f4")
    draw.line([(185, 253), (237, 306), (332, 205)], fill="#236346", width=31, joint="curve")
    for size in (16, 32, 48, 128):
        image.resize((size, size), Image.Resampling.LANCZOS).save(root / f"icon-{size}.png")
    print("Generated local 16, 32, 48, and 128px PNG icons.")


if __name__ == "__main__":
    main()

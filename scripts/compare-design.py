"""Build normalized comparison evidence from real reference and browser captures."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / "output" / "design"
QA = ROOT / "output" / "qa"
OUT = BASE / "comparisons"
OUT.mkdir(parents=True, exist_ok=True)


def comparison(left, right, path, labels, crop=None):
    source = Image.open(left).convert("RGB")
    implementation = Image.open(right).convert("RGB")
    if crop:
        source = source.crop(crop)
        implementation = implementation.crop(crop)
    width = max(source.width, implementation.width)
    height = max(source.height, implementation.height)
    result = Image.new("RGB", (width * 2 + 32, height + 42), "#ecf0ed")
    draw = ImageDraw.Draw(result)
    draw.text((12, 12), labels[0], fill="#24372b")
    draw.text((width + 28, 12), labels[1], fill="#24372b")
    result.paste(source, (0, 42))
    result.paste(implementation, (width + 32, 42))
    result.save(path)
    print(f"{path.name}: {source.size} / {implementation.size}; source pixels unscaled")


comparison(BASE / "figma-baseline.png", QA / "00-start-viewport.png",
           OUT / "full-view.png", ("Original Figma baseline", "Refined implementation"),
           (0, 0, 1440, 1000))
comparison(BASE / "lookup-target.png", QA / "lookup-detail.png",
           OUT / "lookup.png", ("Independent Figma lookup target", "Actual extension lookup"))
comparison(BASE / "before" / "02-reduced-fixture-detail.png", QA / "02-reduced-fixture-detail.png",
           OUT / "findings.png", ("Before: synthetic finding view", "After: same synthetic finding state"))
comparison(BASE / "before" / "00-start-narrow.png", QA / "00-start-narrow.png",
           OUT / "mobile.png", ("Before: 390px viewport", "After: 390px viewport"),
           (0, 0, 390, 844))

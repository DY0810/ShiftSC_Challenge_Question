"""Render the two-page showcase from checked browser evidence, never mock artwork."""
import json
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
QA = ROOT / "output" / "qa"
OUTPUT = ROOT / "output" / "pdf" / "Privacy_Choices_ShiftSC_Showcase.pdf"
BROWSER = json.loads((QA / "browser.json").read_text())
HOSTED = json.loads((QA / "hosted.json").read_text())
SOURCES = json.loads((QA / "source-probe.json").read_text())
assert BROWSER["passed"] is True
assert len(SOURCES["results"]) == 5
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont("Geist", ROOT / "data/fonts/Geist-Regular.ttf"))
pdfmetrics.registerFont(TTFont("Geist-SemiBold", ROOT / "data/fonts/Geist-SemiBold.ttf"))
pdfmetrics.registerFontFamily("Geist", normal="Geist", bold="Geist-SemiBold",
                            italic="Geist", boldItalic="Geist-SemiBold")

W, H = 612, 792
LEFT, WIDTH = 42, 528
INK = colors.HexColor("#242d2a")
MUTED = colors.HexColor("#55615b")
GREEN = colors.HexColor("#22694c")
LINE = colors.HexColor("#d4ddd7")
PALE = colors.HexColor("#f1f5f2")
AMBER = colors.HexColor("#805217")
STYLE = ParagraphStyle("body", fontName="Geist", fontSize=9, leading=13.2, textColor=INK)
SMALL = ParagraphStyle("small", parent=STYLE, fontSize=7.8, leading=10.7, textColor=MUTED)
C = canvas.Canvas(str(OUTPUT), pagesize=(W, H))
C.setTitle("Privacy Choices | ShiftSC Fall 2026")
C.setAuthor("DongYeop Lee")
C.setSubject("Cyber Privacy challenge: implementation, rationale, and verification boundaries")


def text(value, x, top, width, style=STYLE):
    paragraph = Paragraph(value, style)
    _, height = paragraph.wrap(width, H)
    assert top + height < H - 32, f"Text overflows page: {value[:80]}"
    paragraph.drawOn(C, x, H - top - height)
    return top + height


def line(top):
    C.setStrokeColor(LINE)
    C.setLineWidth(0.6)
    C.line(LEFT, H - top, LEFT + WIDTH, H - top)


def heading(label, top):
    C.setFillColor(GREEN)
    C.setFont("Geist-SemiBold", 10.5)
    C.drawString(LEFT, H - top - 11, label)


def image(name, x, top, width, height):
    path = QA / name
    reader = ImageReader(str(path))
    iw, ih = reader.getSize()
    scale = min(width / iw, height / ih)
    dw, dh = iw * scale, ih * scale
    C.drawImage(reader, x + (width - dw) / 2, H - top - dh,
                width=dw, height=dh, mask="auto")
    C.setStrokeColor(LINE)
    C.rect(x + (width - dw) / 2, H - top - dh, dw, dh, fill=0, stroke=1)
    return top + dh


def footer(page):
    line(750)
    C.setFont("Geist", 7.6)
    C.setFillColor(MUTED)
    C.drawString(LEFT, 28, "DongYeop Lee  |  ShiftSC Fall 2026  |  Cyber Privacy")
    C.drawRightString(LEFT + WIDTH, 28, f"{page} / 2")


C.setFillColor(GREEN)
C.rect(0, H - 9, W, 9, fill=1, stroke=0)
C.setFont("Geist-SemiBold", 8)
C.drawString(LEFT, H - 38, "SHIFTSC FALL 2026 / CYBER PRIVACY")
C.setFillColor(INK)
C.setFont("Geist-SemiBold", 31)
C.drawString(LEFT, H - 80, "Privacy Choices")
text("A privacy decision aid that asks what the student values <b>before</b> a service decides for them.",
     LEFT, 94, WIDTH, ParagraphStyle("deck", parent=STYLE, fontSize=12, leading=16))
heading("The problem I chose", 144)
text("Privacy policies disclose practices, but the work of interpreting them is left to the student. "
     "I wanted to connect those disclosures to five questions: what am I sharing, what am I unwilling "
     "to share, how is it handled, what can I change, and do I still want to use this service?",
     LEFT, 165, WIDTH)

line(224)
for index, (title, description) in enumerate([
    ("01  Choose", "Select a service and local preferences."),
    ("02  Understand", "Inspect conflicts and source evidence."),
    ("03  Reduce", "Apply a control or review a guide."),
    ("04  Decide", "Acknowledge what remains, or decline.")
]):
    x = LEFT + index * 134
    text(f"<b>{title}</b>", x, 237, 122)
    text(description, x, 255, 122, SMALL)

heading("What I built", 297)
bottom = image("00-start-viewport.png", LEFT, 320, WIDTH, 292)
text("<b>Actual extension interface.</b> Preferences stay in the browser. The private backend receives "
     "only a supported service ID, not the original URL or preference selections.",
     LEFT, bottom + 9, WIDTH, SMALL)

heading("Three services, three different privacy decisions", 665)
for index, (title, description) in enumerate([
    ("Google Maps", "Block browser location; IP location and typed places remain."),
    ("Quizlet", "Review optional tracking choices; do not promise to remove essential processing."),
    ("ChatGPT", "Distinguish receiving a conversation from using it for model training.")
]):
    x = LEFT + index * 180
    text(f"<b>{title}</b>", x, 686, 168)
    text(description, x, 703, 166, SMALL)
footer(1)
C.showPage()

C.setFillColor(GREEN)
C.rect(0, H - 9, W, 9, fill=1, stroke=0)
C.setFillColor(INK)
C.setFont("Geist-SemiBold", 22)
C.drawString(LEFT, H - 51, "The decisions behind it")

decisions = [
    ("Agency over a score", "No universal safe/unsafe rating. The student chooses acceptable data and uses, then acknowledges unresolved risks."),
    ("Separate facts from protection", "Company policy, AI interpretation, user-reported changes, and browser-verified controls are different states."),
    ("Live analysis with honest fallbacks", "Fetch fixed official sources; use an anonymous reader or dated snapshot when blocked. Never interpret a CAPTCHA as policy."),
    ("Small and inspectable", "Native extension UI, a small Node backend, and persistent budget reservations. No browsing-history access or autonomous account edits.")
]
top = 72
for title, description in decisions:
    text(f"<b>{title}</b>", LEFT, top, 151)
    end = text(description, LEFT + 163, top, 365, SMALL)
    top = max(top + 34, end + 8)
line(top + 1)

heading("Verified behavior, not a blanket privacy guarantee", top + 13)
figure_top = top + 38
image_bottom = image("02-reduced-fixture-detail.png", LEFT, figure_top, 290, 229)
right = LEFT + 308
text("<b>4 conflicts became 3.</b> Chrome's actual location setting changed to Block. "
     "The synthetic IP-location, content, and activity findings stayed unresolved.",
     right, figure_top + 3, 220, SMALL)
text("<b>36 automated checks passed.</b> Includes an isolated real-Redis test: "
     "100 concurrent reservation attempts accepted 71 and reserved $4.97, below the $5 limit.",
     right, figure_top + 68, 220, SMALL)
text("<b>Evidence boundary.</b> This is a real extension screenshot with visibly labeled "
     "synthetic policy responses. It proves the interaction and browser control, not live AI accuracy.",
     right, figure_top + 135, 220, SMALL)

next_top = max(image_bottom + 15, figure_top + 210)
heading("Feasibility and return on effort", next_top)
text("<b>Publicly accessible:</b> policies and help pages about collection, purposes, retention, and controls. "
     "Five dated source snapshots were obtained. Latest retrieval used two direct sources, one reader, and two snapshots. "
     "<b>Not established:</b> internal processing, complete tracking prevention, account-specific choices, or semantic correctness of AI summaries.",
     LEFT, next_top + 21, WIDTH, SMALL)
text("<b>Return:</b> three bounded services make the preference-to-decision flow testable. "
     "Broader coverage would add recurring policy review and site-specific maintenance. "
     "The AI allowance is capped; no paid model call has been made. "
     "Educational usefulness is a hypothesis: no student usability study has been completed.",
     LEFT, next_top + 71, WIDTH, SMALL)

status_top = next_top + 126
C.setFillColor(colors.HexColor("#fff5df"))
C.rect(LEFT, H - status_top - 50, WIDTH, 50, fill=1, stroke=0)
status = ("Live hosted analysis verified." if HOSTED["liveAnalysisVerified"] else
          "Live analysis is not activated: OpenAI and Upstash credentials are still required.")
text(f"<b>Current delivery status:</b> extension ZIP built; backend deployed and authentication checked. "
     f"{escape(status)} Guided account settings and real-model output remain unverified.",
     LEFT + 10, status_top + 8, WIDTH - 20, SMALL)

references_top = status_top + 63
refs = [
    ('Google privacy / location', 'https://policies.google.com/privacy'),
    ('Quizlet privacy', 'https://quizlet.com/privacy'),
    ('ChatGPT data controls', 'https://help.openai.com/en/articles/7730893-data-controls-faq'),
    ('Chrome content settings', 'https://developer.chrome.com/docs/extensions/reference/api/contentSettings')
]
links = " &nbsp; | &nbsp; ".join(f'<link href="{url}" color="#22694c">{label}</link>' for label, url in refs)
text("<b>Sources and evidence:</b> " + links, LEFT, references_top, WIDTH, SMALL)
text("Public policies were captured September 11, 2026 (UTC). Source details, test commands, "
     "and the remaining setup steps accompany the code in README.md and DECISIONS.md.",
     LEFT, references_top + 26, WIDTH, SMALL)
footer(2)
C.save()
reader = PdfReader(OUTPUT)
assert len(reader.pages) == 2
assert all(page.extract_text().strip() for page in reader.pages)
assert "synthetic" in reader.pages[1].extract_text().lower()
assert "credentials" in reader.pages[1].extract_text().lower()
print(f"Created {OUTPUT} (2 pages). Render and visually inspect before delivery.")

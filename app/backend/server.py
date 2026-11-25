"""Local resume editor. Run with the bundled Python or Python + reportlab + Pillow."""
import argparse
import copy
import errno
import base64
import io
import json
import os
import re
import tempfile
import threading
import urllib.request
import webbrowser
import zipfile
import uuid
from datetime import datetime
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer as BaseThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlparse, parse_qs

from PIL import Image
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

from .seed import initial_state
from .boss_adapter import BossAdapter, BossError
from .career import CareerStore
from .schedule import calendar_ics
from . import workflow, assistant, llm
VERSION = (Path(__file__).resolve().parents[2] / "VERSION").read_text(encoding="utf-8").strip()

ROOT = Path(__file__).resolve().parents[2]
CONFIG = json.loads((ROOT / "config.local.json").read_text(encoding="utf-8")) if (ROOT / "config.local.json").exists() else {}
RELEASE = json.loads((ROOT / "RELEASE.json").read_text(encoding="utf-8"))
EXPORT_DIR = Path(os.environ.get("CAREER_EXPORT_DIR") or CONFIG.get("exportDir") or ROOT / "exports").expanduser()
EXPORT_DIR = (ROOT / EXPORT_DIR).resolve() if not EXPORT_DIR.is_absolute() else EXPORT_DIR.resolve()
PAGE_W, PAGE_H = 595.276, 841.89
MARGIN = 31
CONTENT_W = PAGE_W - 2 * MARGIN
LOCK = threading.Lock()
font_pairs = [
    (os.environ.get("CAREER_FONT_REGULAR"), os.environ.get("CAREER_FONT_BOLD")),
    ("/System/Library/Fonts/STHeiti Light.ttc", "/System/Library/Fonts/STHeiti Medium.ttc"),
    ("C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/msyhbd.ttc"),
    ("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", None),
    ("/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf", None),
]
for regular, bold in font_pairs:
    if not regular or not Path(regular).is_file():
        continue
    try:
        pdfmetrics.registerFont(TTFont("Resume", regular))
        pdfmetrics.registerFont(TTFont("ResumeBold", bold if bold and Path(bold).is_file() else regular))
        break
    except Exception:
        continue
else:
    raise RuntimeError("未找到可嵌入的中文 TrueType 字体。请设置 CAREER_FONT_REGULAR（.ttf/.ttc），参见 README。")
pdfmetrics.registerFontFamily("Resume", normal="Resume", bold="ResumeBold", italic="Resume", boldItalic="ResumeBold")


def validate_state(state):
    if not isinstance(state, dict) or state.get("schemaVersion") != 1:
        raise ValueError("请选择本工作台导出的 JSON 备份文件。")
    def text(value, maximum=12000):
        if not isinstance(value, str) or len(value) > maximum:
            raise ValueError("文本字段格式有误或篇幅过长。")
    def bullets(items):
        if not isinstance(items, list) or len(items) > 60:
            raise ValueError("描述条目格式有误，最多支持 60 条。")
        for item in items:
            text(item["label"], 150)
            text(item["text"])
    profile = state["profile"]
    for key in ["name", "englishName", "phone", "email", "birth", "gender", "location"]:
        text(profile[key], 200)
    photo = profile.get("photo", "")
    if photo:
        if not re.fullmatch(r"data:image/(jpeg|png);base64,[A-Za-z0-9+/=]+", photo) or len(photo) > 3_000_000:
            raise ValueError("照片请使用 JPG 或 PNG，文件需小于 2 MB。")
        image = Image.open(io.BytesIO(base64.b64decode(photo.split(",", 1)[1], validate=True)))
        if image.width * image.height > 12_000_000:
            raise ValueError("照片分辨率过大，请压缩后重试。")
        image.verify()
    text(state["educationTitle"], 100)
    if not isinstance(state["education"], list) or len(state["education"]) > 20:
        raise ValueError("教育经历格式有误。")
    for entry in state["education"]:
        text(entry["heading"], 400)
        text(entry["date"], 100)
        text(entry["detail"], 400)
        bullets(entry["bullets"])
    versions = state["versions"]
    if not isinstance(versions, list) or not 1 <= len(versions) <= 500:
        raise ValueError("请保留 1 至 500 份简历。")
    ids = set()
    for version in versions:
        for key in ["id", "name", "target", "summaryTitle", "workTitle"]:
            text(version[key], 200)
        if version["id"] in ids:
            raise ValueError("简历版本编号重复。")
        ids.add(version["id"])
        if not 9 <= float(version["fontSize"]) <= 12:
            raise ValueError("正文字号需在 9 至 12 pt 之间。")
        if version.get("kind", "master") not in ("master", "job") or not isinstance(version.get("archived", False), bool):
            raise ValueError("简历分类或归档状态无效。")
        if not 9 <= float(version.get("minFontSize", 9)) <= float(version["fontSize"]):
            raise ValueError("最低字号应在9pt与正文字号之间。")
        bullets(version["summary"])
        if not isinstance(version["experience"], list) or len(version["experience"]) > 30:
            raise ValueError("工作经历格式有误。")
        for entry in version["experience"]:
            text(entry["heading"], 400)
            text(entry["date"], 100)
            bullets(entry["bullets"])


def paragraph(text, size, bold=False, align=TA_LEFT):
    style = ParagraphStyle("resume", fontName="ResumeBold" if bold else "Resume", fontSize=size, leading=size * 1.36, textColor=colors.HexColor("#17191d"), wordWrap="CJK", alignment=align, splitLongWords=True)
    return Paragraph(text, style)


def markup(text):
    return escape(text).replace("\n", "<br/>")


def layout_blocks(state, version, size):
    blocks = []
    def add_text(text, bold=False, after=2, indent=0, size_override=None):
        p = paragraph(text, size_override or size, bold)
        _, height = p.wrap(CONTENT_W - indent, PAGE_H)
        blocks.append({"kind": "text", "p": p, "height": height + after, "textHeight": height, "indent": indent})
    def section(title):
        blocks.append({"kind": "section", "title": title, "height": 26})
    def add_bullets(items):
        for item in items:
            if not item["label"].strip() and not item["text"].strip():
                continue
            label_text = item["label"].strip().rstrip("：: ")
            label = "<b>" + markup(label_text) + "</b>： " if label_text else ""
            add_text(label + markup(item["text"]), indent=10)
            blocks[-1]["bullet"] = True
    def entry_heading(entry, education=False):
        heading = markup(entry["heading"])
        if education and entry.get("detail"):
            heading += "　" + markup(entry["detail"])
        left = paragraph(heading, size + .2, True)
        right = paragraph(markup(entry["date"]), size - .4, False, TA_RIGHT)
        date_width = min(CONTENT_W * .33, max(112, pdfmetrics.stringWidth(entry["date"], "Resume", size - .4) + 5)) if entry["date"] else 0
        _, lh = left.wrap(CONTENT_W - date_width - 10, PAGE_H)
        _, rh = right.wrap(date_width or 1, PAGE_H)
        blocks.append({"kind": "heading", "left": left, "right": right, "lh": lh, "rh": rh, "dateWidth": date_width, "height": max(lh, rh) + 3})
    if version["summary"]:
        section(version["summaryTitle"])
        add_bullets(version["summary"])
    if state["education"]:
        section(state["educationTitle"])
        for entry in state["education"]:
            entry_heading(entry, education=True)
            add_bullets(entry["bullets"])
    if version["experience"]:
        section(version["workTitle"])
        for index, entry in enumerate(version["experience"]):
            if index and blocks:
                blocks[-1]["height"] += 8
            entry_heading(entry)
            add_bullets(entry["bullets"])
    return blocks


def render_pdf(state, version):
    profile = state["profile"]
    photo_enabled = profile.get("showPhoto", True) and profile.get("photo")
    # Keep the text column identical when toggling the portrait, including long
    # contact lines. Portrait size must never impose a minimum header height.
    photo_width = 58
    photo_top_margin = 18
    top_width = CONTENT_W - photo_width - 12
    name = paragraph(markup(profile["name"]) + "　" + markup(profile["englishName"]), 20, True)
    _, name_height = name.wrap(top_width, PAGE_H)
    contacts = [profile[k] for k in ["phone", "email", "birth", "gender"] if profile[k]]
    if profile.get("showLocation") and profile["location"]:
        contacts.append(profile["location"])
    contact = paragraph(markup(" | ".join(contacts)), 10)
    _, contact_height = contact.wrap(top_width, PAGE_H)
    target = paragraph(markup(version["target"]), 10.5)
    _, target_height = target.wrap(top_width, PAGE_H)
    header_height = name_height + contact_height + (target_height + 4 if version.get("showTarget") else 0) + 10
    body_top = PAGE_H - MARGIN - header_height - 4
    size = float(version["fontSize"])
    floor = float(version.get("minFontSize", 9))
    blocks = layout_blocks(state, version, size)
    if version.get("autoFit", True):
        while sum(b["height"] for b in blocks) > body_top - MARGIN and size > floor:
            size = round(max(floor, size - .1), 1)
            blocks = layout_blocks(state, version, size)
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(PAGE_W, PAGE_H), pageCompression=1)
    pdf.setTitle(profile["name"] + " - " + version["name"])
    pdf.setAuthor(profile["name"])
    name.drawOn(pdf, MARGIN, PAGE_H - MARGIN - name_height)
    contact.drawOn(pdf, MARGIN, PAGE_H - MARGIN - name_height - 5 - contact_height)
    if version.get("showTarget"):
        target.drawOn(pdf, MARGIN, PAGE_H - MARGIN - name_height - contact_height - target_height - 9)
    if photo_enabled:
        raw_photo = base64.b64decode(profile["photo"].split(",", 1)[1])
        # The portrait may sit beside the first section title, but ends at least
        # 8 pt above its divider. Sparse/empty headers use a smaller image box.
        photo_height = min(photo_width * 7 / 5, PAGE_H - body_top + 21 - photo_top_margin - 8)
        photo_width = photo_height * 5 / 7
        pdf.drawImage(ImageReader(io.BytesIO(raw_photo)), PAGE_W - MARGIN - photo_width,
                      PAGE_H - photo_top_margin - photo_height, width=photo_width,
                      height=photo_height, preserveAspectRatio=True, anchor="c", mask="auto")
    pages = 1
    y = body_top
    for i, block in enumerate(blocks):
        keep_height = block["height"]
        if block["kind"] in ["section", "heading"] and i + 1 < len(blocks):
            keep_height += blocks[i + 1]["height"]
            if block["kind"] == "section" and blocks[i + 1]["kind"] == "heading" and i + 2 < len(blocks):
                keep_height += blocks[i + 2]["height"]
        if y - keep_height < MARGIN and y != PAGE_H - MARGIN:
            pdf.showPage()
            pages += 1
            y = PAGE_H - MARGIN
        if block["kind"] == "section":
            pdf.setFont("ResumeBold", 13)
            pdf.drawString(MARGIN, y - 16, block["title"])
            pdf.setLineWidth(.8)
            pdf.line(MARGIN, y - 21, PAGE_W - MARGIN, y - 21)
        elif block["kind"] == "heading":
            block["left"].drawOn(pdf, MARGIN, y - block["lh"])
            if block["dateWidth"]:
                block["right"].drawOn(pdf, PAGE_W - MARGIN - block["dateWidth"], y - block["rh"])
        else:
            p = block["p"]
            # Very long user edits are split into readable pages rather than clipped.
            while block["textHeight"] > y - MARGIN:
                parts = p.split(CONTENT_W - block["indent"], y - MARGIN)
                if not parts:
                    pdf.showPage()
                    pages += 1
                    y = PAGE_H - MARGIN
                    continue
                first = parts.pop(0)
                _, height = first.wrap(CONTENT_W - block["indent"], PAGE_H)
                first.drawOn(pdf, MARGIN + block["indent"], y - height)
                pdf.showPage()
                pages += 1
                y = PAGE_H - MARGIN
                if not parts:
                    p = None
                    break
                p = parts[0]
                _, block["textHeight"] = p.wrap(CONTENT_W - block["indent"], PAGE_H)
                block["height"] = block["textHeight"] + 2
            if p:
                if block.get("bullet"):
                    pdf.setFillColor(colors.HexColor("#17191d"))
                    pdf.circle(MARGIN + 3, y - size * .65, 1.2, fill=1, stroke=0)
                p.drawOn(pdf, MARGIN + block["indent"], y - block["textHeight"])
        y -= block["height"]
    pdf.save()
    return buffer.getvalue(), {"pages": pages, "fontSize": size, "fitsOnePage": pages == 1}


def filename(state, version):
    name = state["profile"]["name"] + "-" + version["name"]
    clean = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "-", name).strip().rstrip(". ")
    return (clean.encode("utf-8")[:180].decode("utf-8", errors="ignore") or "resume") + ".pdf"


def atomic_json(path, data):
    fd, temp = tempfile.mkstemp(dir=path.parent, prefix=".saving-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def save_export(name, data):
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=EXPORT_DIR, prefix=".export-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        stem, suffix = os.path.splitext(name)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        path = EXPORT_DIR / (stem + "-" + stamp + suffix)
        # Publish a complete file without replacing an earlier export.
        os.link(temp, path)
        return str(path)
    finally:
        os.unlink(temp)


def commit_resume(path, state, previous):
    history = path.parent / "history"
    history.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    atomic_json(history / (stamp + "-r" + str(previous["revision"]) + ".json"), previous)
    state["revision"] = previous["revision"] + 1
    state["savedAt"] = datetime.now().astimezone().isoformat(timespec="seconds")
    atomic_json(path, state)


class ThreadingHTTPServer(BaseThreadingHTTPServer):
    # Chrome may prefetch several independent local scripts on navigation.
    request_queue_size = 64


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def send(self, body, content_type="application/json; charset=utf-8", status=200, extra=None):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "no-referrer")
        for key, value in (extra or {}).items():
            self.send_header(key, str(value))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def trusted(self):
        host = self.headers.get("Host", "")
        allowed = {"127.0.0.1:" + str(self.server.server_port), "localhost:" + str(self.server.server_port)}
        origin = self.headers.get("Origin")
        return host in allowed and (not origin or origin in {"http://" + h for h in allowed})

    def do_GET(self):
        if not self.trusted():
            return self.send({"error": "仅支持本机访问。"}, status=403)
        route = urlparse(self.path).path
        if route == "/health":
            return self.send({"app": "career-studio", "root": str(ROOT), "version": VERSION})
        if route == "/api/about":
            return self.send({"name": "Offer Workbench", "version": VERSION, **RELEASE})
        if route == "/api/config":
            return self.send({"exportDir": str(EXPORT_DIR), "version": VERSION})
        if route == "/api/ai/config":
            try: return self.send(llm.Config(self.server.career.path.parent).public())
            except (ValueError,OSError): return self.send({"error":"AI配置无法读取，请检查本机配置文件。"},status=400)
        if route == "/api/ai/exploration":
            try:
                version_id = parse_qs(urlparse(self.path).query).get('versionId', [''])[0]
                with LOCK:
                    state = json.loads(self.server.state_path.read_text(encoding='utf-8'))
                    result = assistant.latest_exploration(self.server.career, version_id, state)
                return self.send(result)
            except (ValueError, KeyError, TypeError) as error:
                return self.send({'error': str(error)}, status=400)
        if route == "/api/boss/status":
            return self.send(self.server.boss.status())
        if route in {"/api/career/state", "/api/career/backup", "/api/career/calendar.ics", "/api/career/assist-state"}:
            try:
                with LOCK:
                    state = json.loads(self.server.state_path.read_text(encoding="utf-8"))
                    result = self.server.career.dispatch("/api/career/state" if route.endswith(".ics") else route, {}, state)
                if route.endswith(".ics"):
                    return self.send(calendar_ics(result["events"]), "text/calendar; charset=utf-8", extra={"Content-Disposition": 'attachment; filename="offer-workbench.ics"'})
                return self.send(result)
            except (ValueError, KeyError, TypeError) as error:
                return self.send({"error": str(error)}, status=400)
        if route == "/api/career/artifact-pdf":
            try:
                ident=parse_qs(urlparse(self.path).query).get("id",[""])[0]
                with LOCK:
                    a=self.server.career.dispatch("/api/career/artifact",{"id":ident},{})
                return self.send(base64.b64decode(a["pdfBase64"]),"application/pdf",extra={"Content-Disposition":"inline; filename*=UTF-8''"+quote(a["filename"])})
            except (ValueError,KeyError,TypeError) as error:
                return self.send({"error":str(error)},status=400)
        if route == "/api/state":
            with LOCK:
                return self.send(json.loads(self.server.state_path.read_text(encoding="utf-8")))
        static = {"/": ("app/frontend/index.html", "text/html; charset=utf-8"), "/app.js": ("app/frontend/js/app.js", "text/javascript; charset=utf-8"), "/style.css": ("app/frontend/css/style.css", "text/css; charset=utf-8"), "/pdf.mjs": ("app/frontend/vendor/pdfjs/pdf.mjs", "text/javascript"), "/pdf.worker.mjs": ("app/frontend/vendor/pdfjs/pdf.worker.mjs", "text/javascript")}
        static.update({"/career": ("app/frontend/career.html", "text/html; charset=utf-8"), "/career.js": ("app/frontend/js/career.js", "text/javascript; charset=utf-8"), "/career.css": ("app/frontend/css/career.css", "text/css; charset=utf-8")})
        static.update({"/salary-engine.js": ("app/frontend/js/salary-engine.js", "text/javascript; charset=utf-8"), "/salary-job.js": ("app/frontend/js/salary-job.js", "text/javascript; charset=utf-8"), "/salary-ui.js": ("app/frontend/js/salary-ui.js", "text/javascript; charset=utf-8"), "/salary.css": ("app/frontend/css/salary.css", "text/css; charset=utf-8"), "/salary-policies.json": ("app/frontend/config/salary-policies.json", "application/json; charset=utf-8")})
        static.update({"/studio.css": ("app/frontend/css/studio.css", "text/css; charset=utf-8"), "/ui.js": ("app/frontend/js/ui.js", "text/javascript; charset=utf-8"), "/photo-crop.js": ("app/frontend/js/photo-crop.js", "text/javascript; charset=utf-8"), "/boss-help": ("app/frontend/guide.html", "text/html; charset=utf-8"), "/boss-help.js": ("app/frontend/js/boss-help.js", "text/javascript; charset=utf-8")})
        static.update({"/calendar-ui.js": ("app/frontend/js/calendar-ui.js", "text/javascript; charset=utf-8"), "/calendar.css": ("app/frontend/css/calendar.css", "text/css; charset=utf-8")})
        static.update({"/doc-reader.js": ("app/frontend/js/doc-reader.js", "text/javascript; charset=utf-8"), "/doc-reader.css": ("app/frontend/css/doc-reader.css", "text/css; charset=utf-8")})
        for document in ("CHANGELOG.md", "SALARY_POLICY_SOURCES.md", "BOSS_FILTER_SOURCES.md", "AI_PROVIDERS.md"):
            file = "docs/reference/" + document if document in ("SALARY_POLICY_SOURCES.md", "BOSS_FILTER_SOURCES.md", "AI_PROVIDERS.md") else document
            static["/docs/" + document] = (file, "text/plain; charset=utf-8")
        static["/docs/images/calendar-demo.png"] = ("docs/images/calendar-demo.png", "image/png")
        static["/docs/images/user-journey.png"] = ("docs/images/user-journey.png", "image/png")
        static["/docs/images/user-journey.svg"] = ("docs/images/user-journey.svg", "image/svg+xml")
        static["/docs/USER_JOURNEY.md"] = ("docs/design/USER_JOURNEY.md", "text/plain; charset=utf-8")
        static["/job-workflow.js"] = ("app/frontend/js/job-workflow.js", "text/javascript; charset=utf-8")
        static["/job-rules.js"] = ("app/frontend/js/job-rules.js", "text/javascript; charset=utf-8")
        static["/job-workflow.css"] = ("app/frontend/css/job-workflow.css", "text/css; charset=utf-8")
        static["/workspace-layout.js"] = ("app/frontend/js/workspace-layout.js", "text/javascript; charset=utf-8")
        static["/site-info.js"] = ("app/frontend/js/site-info.js", "text/javascript; charset=utf-8")
        for name,folder,mime in [("ai-analysis.js","js","text/javascript"),("assistant-ui.js","js","text/javascript"),("inline-ai.js","js","text/javascript"),("assistant.css","css","text/css"),("brand.css","css","text/css")]:
            static["/"+name] = ("app/frontend/"+folder+"/"+name,mime+"; charset=utf-8")
        if route.startswith('/brand/'):
            names={'wordmark.svg':'image/svg+xml','mark-blue.svg':'image/svg+xml','favicon.ico':'image/x-icon'}
            name=route.rsplit('/',1)[-1]
            if name in names:
                settings=ROOT/'brand.local.json'
                directory=Path(json.loads(settings.read_text(encoding='utf-8'))['directory']) if settings.exists() else None
                if directory and (directory/'logo'/name).is_file():return self.send((directory/'logo'/name).read_bytes(),names[name])
                fallback='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 412 72"><text x="8" y="48" fill="#245bcc" font-size="36" font-family="sans-serif">简历工作台</text></svg>'
                if name!='wordmark.svg':fallback='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect x="10" y="6" width="28" height="36" rx="3" fill="none" stroke="#245bcc" stroke-width="3"/><path d="M17 17h14M17 24h14M17 31h10" stroke="#245bcc" stroke-width="3"/></svg>'
                return self.send(fallback.encode(),'image/svg+xml')

        static["/guide"] = ("app/frontend/guide.html", "text/html; charset=utf-8")
        static["/docs/USER_GUIDE.md"] = ("docs/USER_GUIDE.md", "text/plain; charset=utf-8")
        static["/help"] = ("docs/USER_GUIDE.md", "text/plain; charset=utf-8")
        if route in static:
            file, mime = static[route]
            return self.send((ROOT / file).read_bytes(), mime)
        return self.send({"error": "页面不存在。"}, status=404)

    def do_POST(self):
        if not self.trusted() or self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            return self.send({"error": "请求来源或格式不正确。"}, status=403)
        try:
            length = int(self.headers.get("Content-Length", 0))
            maximum = 64 * 1024 * 1024 if urlparse(self.path).path == "/api/career/import" else 8_000_000
            if not 0 < length <= maximum:
                raise ValueError("请求文件过大。")
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError("请求需为 JSON 对象。")
            route = urlparse(self.path).path
            allowed_routes = {"/api/save", "/api/pdf", "/api/export-pdf", "/api/export-all", "/api/boss/search", "/api/boss/detail"}
            allowed_routes.update("/api/career/" + action for action in ("preferences", "upsert", "update", "delete", "match", "import", "tailor", "export", "event-save", "event-delete", "event-check", "view", "decision", "preparation", "plan-save", "plan-delete", "submission-confirm"))
            allowed_routes.update("/api/career/"+a for a in ("material-save","material-delete","draft-delete","jd-insights"))
            allowed_routes.update("/api/ai/"+a for a in ("config","prepare","generate","apply","undo","run","test","model-delete","model-select"))
            if route not in allowed_routes:
                return self.send({"error": "接口不存在。"}, status=404)
            if route == "/api/ai/config":
                return self.send(llm.Config(self.server.career.path.parent).save(payload))
            if route in ("/api/ai/model-delete","/api/ai/model-select"):
                return self.send(llm.Config(self.server.career.path.parent).change(payload,route.endswith("delete")))
            if route == "/api/ai/test":return self.send(llm.Config(self.server.career.path.parent).test(payload))
            if route == "/api/ai/run":
                with LOCK:state=json.loads(self.server.state_path.read_text(encoding="utf-8"))
                return self.send(assistant.run(self.server.career,payload,state))
            if route == "/api/ai/generate":
                return self.send(assistant.generate(self.server.career,payload))
            if route in ("/api/ai/prepare","/api/ai/apply","/api/ai/undo"):
                with LOCK:
                    state=json.loads(self.server.state_path.read_text(encoding="utf-8"))
                    if route.endswith("prepare"):return self.send(assistant.prepare(self.server.career,payload,state))
                    previous=copy.deepcopy(state);undo=route.endswith("undo")
                    draft,value=assistant.apply(self.server.career,payload,state,undo)
                    validate_state(state)
                    assistant.begin_apply(self.server.career,draft,value,previous,undo)
                    try:
                        commit_resume(self.server.state_path,state,previous)
                        assistant.finish_apply(self.server.career,draft,value,undo)
                    finally:
                        assistant.recover_applies(self.server.career,json.loads(self.server.state_path.read_text(encoding="utf-8")))
                    return self.send({"revision":state["revision"],"message":"已撤销这一段" if undo else "已写入所选简历段落"})
            if route == "/api/boss/search":
                return self.send(self.server.boss.search(payload.get("filters", {})))
            if route == "/api/boss/detail":
                return self.send(self.server.boss.detail(payload.get("id", "")))
            if route.startswith("/api/career/"):
                with LOCK:
                    state = json.loads(self.server.state_path.read_text(encoding="utf-8"))
                    if route in {"/api/career/tailor", "/api/career/export"}:
                        return self.career_resume_action(route, payload, state)
                    return self.send(self.server.career.dispatch(route, payload, state))
            state = payload["state"]
            validate_state(state)
            if route == "/api/save":
                with LOCK:
                    previous = json.loads(self.server.state_path.read_text(encoding="utf-8"))
                    if payload.get("revision") != previous["revision"]:
                        return self.send({"error": "另一窗口已更新简历。请先下载当前备份，再刷新核对，避免覆盖。"}, status=409)
                    commit_resume(self.server.state_path, state, previous)
                    return self.send({"revision": state["revision"], "savedAt": state["savedAt"]})
            if route == "/api/pdf":
                version = next(v for v in state["versions"] if v["id"] == payload["id"])
                pdf, meta = render_pdf(state, version)
                return self.send(pdf, "application/pdf", extra={"X-Resume-Pages": meta["pages"], "X-Resume-Font": meta["fontSize"], "Content-Disposition": "inline; filename*=UTF-8''" + quote(filename(state, version))})
            if route == "/api/export-pdf":
                version = next(v for v in state["versions"] if v["id"] == payload["id"])
                pdf, meta = render_pdf(state, version)
                path = save_export(filename(state, version), pdf)
                return self.send({"directory": str(EXPORT_DIR), "files": [path], **meta})
            if route == "/api/export-all":
                buf = io.BytesIO()
                files = []
                with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as archive:
                    for i, version in enumerate([v for v in state["versions"] if not v.get("archived")], 1):
                        pdf, _ = render_pdf(state, version)
                        files.append(save_export(filename(state, version), pdf))
                        archive.writestr(str(i).zfill(2) + "-" + filename(state, version), pdf)
                files.append(save_export("全部简历.zip", buf.getvalue()))
                return self.send({"directory": str(EXPORT_DIR), "files": files})
            return self.send({"error": "接口不存在。"}, status=404)
        except BossError as error:
            return self.send(error.to_dict(), status=error.http_status)
        except (ValueError, KeyError, TypeError, StopIteration, OSError) as error:
            return self.send({"error": str(error) or "内容格式有误，请检查后重试。"}, status=400)
        except Exception:
            return self.send({"error": "导出失败，请检查文字和照片格式后重试。"}, status=500)


    def career_resume_action(self, route, payload, state):
        jobs = self.server.career.dispatch("/api/career/state", {}, state)["jobs"]
        job = next((j for j in jobs if j["id"] == payload.get("jobId")), None)
        version = next((v for v in state["versions"] if v["id"] == payload.get("versionId")), None)
        if not job or not version:
            raise ValueError("请先保存机会并选择有效简历。")
        if route.endswith("/tailor"):
            existing = version if version.get("tailoredFor") == job["id"] else next((v for v in state["versions"] if v.get("tailoredFor") == job["id"] and v.get("sourceVersionId") == version["id"]), None)
            if existing:
                tailored = existing
            else:
                previous = copy.deepcopy(state)
                tailored = copy.deepcopy(version)
                tailored.update({"id": str(uuid.uuid4()), "name": (job["company"] + " · " + job["title"])[:200], "target": job["title"][:200], "tailoredFor": job["id"], "sourceVersionId": version["id"], "kind":"job", "archived":False})
                state["versions"].append(tailored)
                validate_state(state)
                commit_resume(self.server.state_path, state, previous)
            self.server.career.dispatch("/api/career/update", {"id": job["id"], "resumeId": tailored["id"]}, state)
            return self.send({"versionId": tailored["id"], "name": tailored["name"], "message": "已复制经历，可结合匹配缺口人工调整；未自动改写事实。"})
        pdf, meta = render_pdf(state, version)
        path = save_export(filename(state, version), pdf)
        try:
            artifact = workflow.record_artifact(self.server.career, job, state, version, pdf, Path(path).name, meta["pages"])
        except (ValueError, OSError):
            # A failed archive must not leave an apparently successful export.
            Path(path).unlink(missing_ok=True)
            raise
        self.server.career.dispatch("/api/career/update", {"id": job["id"], "resumeId": version["id"], "lastExport": {"path": path, "versionId": version["id"], "exportedAt": datetime.now().astimezone().isoformat(timespec="seconds")}}, state)
        return self.send({"files": [path], "directory": str(EXPORT_DIR), "artifact": artifact, **meta})


def main():
    global EXPORT_DIR
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data")
    parser.add_argument("--export-dir", type=Path, default=EXPORT_DIR)
    parser.add_argument("--open", action="store_true")
    args = parser.parse_args()
    EXPORT_DIR = args.export_dir.expanduser().resolve()
    url = "http://127.0.0.1:" + str(args.port)
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError as error:
        if error.errno != errno.EADDRINUSE:
            raise SystemExit("无法启动本机服务：" + str(error))
        try:
            info = json.load(urllib.request.urlopen(url + "/health", timeout=2))
            if info.get("root") == str(ROOT) and info.get("app") == "career-studio":
                if args.open:
                    webbrowser.open(url + "/")
                print("已运行 " + url, flush=True)
                return
        except Exception:
            pass
        raise SystemExit("端口被其他程序占用。请关闭占用程序，或以 --port 8767 启动。")
    args.data_dir.mkdir(parents=True, exist_ok=True)
    server.state_path = args.data_dir / "resumes.json"
    if not server.state_path.exists():
        atomic_json(server.state_path, initial_state())
    server.career = CareerStore(args.data_dir)
    assistant.recover_running(server.career)
    assistant.recover_applies(server.career,json.loads(server.state_path.read_text(encoding="utf-8")))
    server.boss = BossAdapter()
    print("简历工作台 " + url, flush=True)
    if args.open:
        webbrowser.open(url + "/")
    server.serve_forever()


if __name__ == "__main__":
    main()

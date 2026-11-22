"""Local HTTP contract checks, using anonymous fixtures and a fake BOSS adapter."""
import copy
import http.client
import json
from pathlib import Path
import re
import tempfile
import threading
import unittest
import zipfile
from unittest.mock import patch

from app.backend import server
from app.backend.boss_adapter import BossError
from app.backend.career import CareerStore
from scripts.package_source import FILES, package
from app.backend.seed import initial_state


class FakeBoss:
    def __init__(self):
        self.calls = []
        self.failure = None

    def status(self):
        return {"available": True, "authenticated": None, "version": "test"}

    def search(self, filters):
        self.calls.append(("search", filters))
        if self.failure:
            raise self.failure
        return {"jobs": [{"id": "fake-security", "title": "测试产品经理", "company": "测试公司", "source": "boss"}]}

    def detail(self, id_):
        self.calls.append(("detail", id_))
        return {"id": id_, "title": "测试产品经理", "description": "测试职责", "source": "boss"}


class HTTPIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.export_dir = self.root / "exports"
        self.patch_export = patch.object(server, "EXPORT_DIR", self.export_dir)
        self.patch_export.start()
        self.http = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.http.daemon_threads = True
        self.http.state_path = self.root / "resumes.json"
        self.state = initial_state()
        server.atomic_json(self.http.state_path, self.state)
        self.http.career = CareerStore(self.root)
        self.http.boss = FakeBoss()
        self.thread = threading.Thread(target=self.http.serve_forever, kwargs={"poll_interval": .02}, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join(timeout=2)
        self.patch_export.stop()
        self.temp.cleanup()

    def request(self, method, path, payload=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.http.server_port, timeout=5)
        try:
            body = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
            request_headers = {"Content-Type": "application/json"} if body else {}
            request_headers.update(headers or {})
            connection.request(method, path, body, request_headers)
            response = connection.getresponse()
            data = response.read()
            if response.getheader("Content-Type", "").startswith("application/json"):
                data = json.loads(data)
            return response.status, data
        finally:
            connection.close()

    def post(self, route, payload):
        status, result = self.request("POST", route, payload)
        self.assertEqual(status, 200, result)
        return result

    def test_release_metadata_and_guide_keep_legacy_routes(self):
        status, info = self.request("GET", "/api/about")
        self.assertEqual(status, 200)
        self.assertEqual(info["version"], server.VERSION)
        self.assertEqual(info["updatedOn"], "2026-11-22")
        self.assertEqual(set(info), {"name", "version", "updatedOn", "developer", "repository", "profile"})
        for route in ("/guide", "/boss-help"):
            status, body = self.request("GET", route)
            self.assertEqual(status, 200)
            for marker in (b'quick-start', b'boss-connection', b'about-project', b'app-footer'):
                self.assertIn(marker, body)
        status, body = self.request("GET", "/help")
        self.assertEqual(status, 200)
        self.assertIn("使用文档", body.decode())
        for route in ("/api/about", "/site-info.js", "/guide"):
            self.assertEqual(self.request("GET", route, headers={"Origin":"https://example.com"})[0], 403)
        for path in ("/app/backend/server.py", "/RELEASE.json", "/config.local.json", "/data/resumes.json"):
            self.assertEqual(self.request("GET", path)[0], 404)
        self.assertEqual(self.http.boss.calls, [])

    def test_calendar_api_roundtrip_and_ics_without_boss(self):
        payload = {"event": {"title": "匿名面试", "kind": "interview", "start": "2026-12-01T14:00+08:00", "end": "2026-12-01T15:00+08:00"}}
        saved = self.post("/api/career/event-save", payload)["events"][0]
        status, ics = self.request("GET", "/api/career/calendar.ics")
        self.assertEqual(status, 200)
        self.assertIn(b"BEGIN:VCALENDAR", ics)
        self.assertIn(b"DTSTART:20261201T060000Z", ics)
        self.assertEqual(self.request("GET", "/calendar-ui.js")[0], 200)
        self.assertEqual(self.request("GET", "/calendar.css")[0], 200)
        status, _ = self.request("POST", "/api/career/event-save", payload, {"Origin":"https://example.com"})
        self.assertEqual(status, 403)
        self.post("/api/career/event-delete", {"event": saved})
        self.assertEqual(self.http.boss.calls, [])

    def test_shared_ui_assets_and_global_help_are_served_locally(self):
        for route in ('/studio.css', '/ui.js', '/photo-crop.js', '/boss-help', '/boss-help.js', '/doc-reader.js', '/doc-reader.css', '/docs/CHANGELOG.md', '/docs/SALARY_POLICY_SOURCES.md'):
            status, body = self.request('GET', route)
            self.assertEqual(status, 200, route)
            self.assertGreater(len(body), 100)
        for route in ('/', '/career'):
            _, body = self.request('GET', route)
            html = body.decode('utf-8')
            self.assertIn('href="/guide"', html)
            self.assertIn('src="/ui.js"', html)
        self.assertEqual(self.http.boss.calls, [])
        self.assertEqual(self.request("GET", "/docs/config.local.json")[0], 404)

    def test_tailor_is_idempotent_and_export_does_not_mark_applied(self):
        job = self.post("/api/career/upsert", {"job": {"title": "AI 产品经理", "company": "测试公司", "description": "Agent 产品设计"}})["job"]
        payload = {"jobId": job["id"], "versionId": "ai"}
        first = self.post("/api/career/tailor", payload)
        second = self.post("/api/career/tailor", payload)
        self.assertEqual(first["versionId"], second["versionId"])
        _, state = self.request("GET", "/api/state")
        self.assertEqual(len(state["versions"]), len(self.state["versions"]) + 1)
        tailored = next(v for v in state["versions"] if v["id"] == first["versionId"])
        original = next(v for v in self.state["versions"] if v["id"] == "ai")
        self.assertEqual(tailored["summary"], original["summary"])
        self.assertEqual(tailored["experience"], original["experience"])
        exported = self.post("/api/career/export", {**payload, "versionId": first["versionId"]})
        pdf = Path(exported["files"][0])
        self.assertEqual(pdf.parent, self.export_dir)
        self.assertTrue(pdf.read_bytes().startswith(b"%PDF"))
        _, career = self.request("GET", "/api/career/state")
        self.assertEqual(career["jobs"][0]["status"], "saved")
        self.assertEqual(career["jobs"][0]["lastExport"]["versionId"], first["versionId"])
        self.assertFalse(self.http.boss.calls)

    def test_preview_is_transient_but_export_is_durable(self):
        payload = {"state": self.state, "id": "ai"}
        preview = self.post("/api/pdf", payload)
        self.assertTrue(preview.startswith(b"%PDF"))
        self.assertFalse(self.export_dir.exists())
        exported = self.post("/api/export-pdf", payload)
        self.assertEqual(len(exported["files"]), 1)
        self.assertTrue(Path(exported["files"][0]).is_file())
        before = set(self.export_dir.iterdir())
        self.post("/api/pdf", payload)
        self.assertEqual(set(self.export_dir.iterdir()), before)

    def test_tailoring_an_existing_job_copy_reopens_it_without_more_copies(self):
        job = self.post("/api/career/upsert", {"job": {"title": "产品经理", "company": "测试公司"}})["job"]
        first = self.post("/api/career/tailor", {"jobId": job["id"], "versionId": "ai"})
        second = self.post("/api/career/tailor", {"jobId": job["id"], "versionId": first["versionId"]})
        self.assertEqual(first["versionId"], second["versionId"])
        _, state = self.request("GET", "/api/state")
        self.assertEqual(len(state["versions"]), len(self.state["versions"]) + 1)

    def test_missing_linked_resume_cannot_silently_export_another_version(self):
        job = self.post("/api/career/upsert", {"job": {"title": "产品经理"}, "resumeId": "ai"})["job"]
        changed = copy.deepcopy(self.state)
        changed["versions"] = [v for v in changed["versions"] if v["id"] != "ai"]
        self.post("/api/save", {"state": changed, "revision": 0})
        _, career = self.request("GET", "/api/career/state")
        self.assertTrue(career["jobs"][0]["resumeMissing"])
        self.assertEqual(career["jobs"][0]["resumeId"], "ai")
        status, body = self.request("POST", "/api/career/export", {"jobId": job["id"], "versionId": "ai"})
        self.assertEqual(status, 400)
        self.assertFalse(self.export_dir.exists())
        self.assertNotIn("lastExport", career["jobs"][0])

    def test_resume_limit_rejects_tailor_without_changing_opportunity(self):
        job = self.post("/api/career/upsert", {"job": {"title": "产品经理"}})["job"]
        expanded = copy.deepcopy(self.state)
        while len(expanded["versions"]) < 30:
            version = copy.deepcopy(expanded["versions"][0])
            version["id"] = "copy-" + str(len(expanded["versions"]))
            expanded["versions"].append(version)
        self.post("/api/save", {"state": expanded, "revision": 0})
        before = self.request("GET", "/api/state")[1]
        status, body = self.request("POST", "/api/career/tailor", {"jobId": job["id"], "versionId": "ai"})
        self.assertEqual(status, 400)
        self.assertEqual(self.request("GET", "/api/state")[1], before)
        self.assertEqual(self.request("GET", "/api/career/state")[1]["jobs"][0]["resumeId"], "")

    def test_stale_resume_revision_cannot_overwrite(self):
        changed = copy.deepcopy(self.state)
        changed["profile"]["name"] = "测试候选人"
        self.post("/api/save", {"state": changed, "revision": 0})
        status, body = self.request("POST", "/api/save", {"state": self.state, "revision": 0})
        self.assertEqual(status, 409)
        stored = json.loads(self.http.state_path.read_text(encoding="utf-8"))
        self.assertEqual(stored["profile"]["name"], "测试候选人")
        self.assertEqual(stored["revision"], 1)
        self.assertEqual(len(list((self.root / "history").glob("*.json"))), 1)

    def test_cross_origin_and_foreign_host_cannot_read_or_mutate(self):
        for method, path, payload, headers in [
            ("POST", "/api/boss/search", {"filters": {"query": "产品"}}, {"Origin": "https://attacker.example"}),
            ("GET", "/api/state", None, {"Host": "attacker.example"}),
            ("GET", "/api/boss/status", None, {"Origin": "null"}),
            ("POST", "/api/save", {"state": self.state, "revision": 0}, {"Content-Type": "text/plain"}),
        ]:
            with self.subTest(path=path, headers=headers):
                status, body = self.request(method, path, payload, headers)
                self.assertEqual(status, 403)
        self.assertFalse(self.http.boss.calls)
        self.assertEqual(json.loads(self.http.state_path.read_text(encoding="utf-8"))["revision"], 0)

    def test_unknown_boss_routes_do_not_execute_any_adapter_action(self):
        for route in ("/api/boss/greet", "/api/boss/apply", "/api/boss/login", "/api/boss/doctor", "/api/boss/search/extra"):
            with self.subTest(route=route):
                status, result = self.request("POST", route, {})
                self.assertEqual(status, 404)
        self.assertFalse(self.http.boss.calls)

    def test_explicit_search_only_executes_one_read_and_error_is_structured(self):
        result = self.post("/api/boss/search", {"filters": {"query": "产品", "city": "深圳"}})
        self.assertEqual(result["jobs"][0]["source"], "boss")
        self.assertEqual(self.http.boss.calls, [("search", {"query": "产品", "city": "深圳"})])
        self.http.boss.failure = BossError("AUTH_REQUIRED", "请登录", 401)
        status, result = self.request("POST", "/api/boss/search", {"filters": {"query": "产品"}})
        self.assertEqual(status, 401)
        self.assertEqual(result, {"error": "请登录", "code": "AUTH_REQUIRED"})

    def test_unknown_career_routes_are_404_and_do_not_mutate(self):
        before = self.request("GET", "/api/career/state")[1]
        for route in ("/api/career/unknown", "/api/career/update/extra", "/api/career/send", "/api/career/"):
            with self.subTest(route=route):
                status, result = self.request("POST", route, {})
                self.assertEqual(status, 404)
        self.assertEqual(self.request("GET", "/api/career/state")[1], before)
        self.assertFalse(self.http.boss.calls)

    def test_salary_assets_are_local_and_do_not_mutate_personal_state(self):
        before = self.http.state_path.read_bytes()
        for route in ("/salary-engine.js", "/salary-ui.js", "/salary-job.js", "/salary.css"):
            status, body = self.request("GET", route)
            self.assertEqual(status, 200, route)
            self.assertTrue(body)
        status, policies = self.request("GET", "/salary-policies.json")
        self.assertEqual(status, 200)
        self.assertEqual(set(policies["cities"]), {"shenzhen", "guangzhou"})
        self.assertEqual(self.http.state_path.read_bytes(), before)
        self.assertFalse(self.http.boss.calls)
        self.assertEqual(self.request("GET", "/salary-policies.json", headers={"Origin": "https://example.com"})[0], 403)


class SourceReleaseTests(unittest.TestCase):
    def test_source_archive_excludes_private_state_assets_and_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            archive_path = package(Path(folder) / "source.zip")
            with zipfile.ZipFile(archive_path) as archive:
                names = set(archive.namelist())
                self.assertEqual(names, {"offer-workbench/" + name for name in FILES})
                for name in names:
                    self.assertNotIn("/data/", name)
                    self.assertNotIn("/history/", name)
                    if name != "offer-workbench/docs/images/calendar-demo.png":
                        self.assertFalse(name.endswith((".pdf", ".sqlite3", ".jpg", ".png", "config.json")))
                for name in names:
                    data = archive.read(name)
                    self.assertIsNone(re.search(rb"/Users/[A-Za-z0-9_.-]+/", data), name)
                seed = archive.read("offer-workbench/app/backend/seed.py").decode()
                self.assertIn("你的姓名", seed)
                profile = initial_state()["profile"]
                self.assertEqual(profile["name"], "你的姓名")
                for key in ("email", "phone", "photo", "birth", "location"):
                    self.assertEqual(profile[key], "", key)
                self.assertFalse(profile["showPhoto"])


if __name__ == "__main__":
    unittest.main()

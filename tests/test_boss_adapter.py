"""Adapter contract tests: mock CLI only; no credentials or platform requests."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.backend.boss_adapter import BossAdapter, BossError, normalize_job


def response(command, data=None, *, error=None, code=0):
    body = {"ok": error is None, "schema_version": "1.0", "command": command, "data": data,
            "error": error, "pagination": {"page": 1, "has_more": True, "total": 20}}
    return subprocess.CompletedProcess([], code, json.dumps(body), "private stderr must never appear")


class AdapterTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.adapter = BossAdapter(executable="/test/boss", data_dir=self.tmp.name)
        self.job = {"security_id": "sec-1", "job_id": "job-1", "lid": "lid-1", "title": "产品经理", "company": "示例公司", "salary": "20-30K", "city": "深圳", "description": "金融 SaaS", "cookie": "MUST_NOT_LEAK"}

    @patch("app.backend.boss_adapter.subprocess.run")
    def test_search_args_are_allowlisted_and_not_shell(self, run):
        run.return_value = response("search", [self.job])
        result = self.adapter.search({"query": "--greet $(echo unsafe)", "city": "深圳", "stage": ["A轮", "B轮"], "jobType": ["全职"], "page": 2})
        argv = run.call_args.args[0]
        self.assertEqual(argv[-2:], ["--", "--greet $(echo unsafe)"])
        self.assertTrue(any("city=101280600" in a for a in argv))
        self.assertIn("--stage=A轮,B轮", argv)
        self.assertIn("--page=2", argv)
        self.assertIn("--no-cache", argv)
        self.assertIn("existing-browser", argv)
        self.assertFalse(run.call_args.kwargs["shell"])
        self.assertEqual(result["jobs"][0]["id"], "sec-1")
        self.assertEqual(result["jobs"][0]["url"], "https://www.zhipin.com/job_detail/job-1.html")
        self.assertNotIn("MUST_NOT_LEAK", json.dumps(result))
        self.assertTrue(result["pagination"]["hasMore"])
        self.assertEqual(run.call_count, 1)

    @patch("app.backend.boss_adapter.subprocess.run")
    def test_detail_uses_security_id_and_known_job_id(self, run):
        run.side_effect = [response("search", [self.job]), response("detail", {"title": "产品经理", "description": "完整描述"})]
        self.adapter.search({"keyword": "产品经理"})
        detail = self.adapter.detail("sec-1")
        self.assertEqual(run.call_args.args[0][-4:], ["--job-id=job-1", "--lid=lid-1", "--", "sec-1"])
        self.assertEqual(detail["id"], "sec-1")
        self.assertEqual(detail["jobId"], "job-1")
        self.assertEqual(detail["description"], "完整描述")

    @patch("app.backend.boss_adapter.subprocess.run")
    def test_unsupported_bulk_filters_never_execute(self, run):
        for filters in ({"query": "产品", "welfare": "双休"}, {"query": "产品", "active": "today"}, {"query": "产品", "page": 6}, {"query": "产品", "page": True}, {"query": "产品", "page": "1"}, {"query": "产品", "city": ["深圳", "广州"]}, {"query": "产品", "salary": "99K"}, {"query": "产品", "command": "greet"}):
            with self.subTest(filters=filters), self.assertRaises(BossError) as caught:
                self.adapter.search(filters)
            self.assertEqual(caught.exception.code, "INVALID_PARAM")
        run.assert_not_called()

    @patch("app.backend.boss_adapter.subprocess.run")
    def test_risk_stops_and_latches_without_retry(self, run):
        run.return_value = response("search", error={"code": "ACCOUNT_RISK", "message": "sensitive remote data"}, code=1)
        for _ in range(2):
            with self.assertRaises(BossError) as caught:
                self.adapter.search({"query": "产品"})
            self.assertEqual(caught.exception.code, "ACCOUNT_RISK")
            self.assertNotIn("sensitive", str(caught.exception))
        self.assertEqual(run.call_count, 1)

    @patch("app.backend.boss_adapter.subprocess.run")
    def test_existing_risk_file_blocks_without_reading_contents(self, run):
        (Path(self.tmp.name) / "cdp_risk_lock.json").write_text("never read")
        with patch.object(Path, "read_text", side_effect=AssertionError("no reads")):
            with self.assertRaises(BossError) as caught:
                self.adapter.search({"query": "产品"})
        self.assertEqual(caught.exception.code, "ACCOUNT_RISK")
        run.assert_not_called()

    @patch("app.backend.boss_adapter.subprocess.run")
    def test_auth_error_is_explicit_and_has_no_raw_logs(self, run):
        run.return_value = response("search", error={"code": "AUTH_REQUIRED", "message": "cookie=secret"}, code=1)
        with self.assertRaises(BossError) as caught:
            self.adapter.search({"query": "产品"})
        self.assertEqual(caught.exception.code, "AUTH_REQUIRED")
        self.assertEqual(caught.exception.http_status, 401)
        self.assertNotIn("secret", str(caught.exception))
        self.assertEqual(run.call_count, 1)

    @patch("app.backend.boss_adapter.subprocess.run")
    def test_timeout_releases_busy_lock(self, run):
        run.side_effect = subprocess.TimeoutExpired("boss", 45)
        with self.assertRaises(BossError) as caught:
            self.adapter.search({"query": "产品"})
        self.assertEqual(caught.exception.code, "BOSS_TIMEOUT")
        self.assertFalse(self.adapter._lock.locked())
        self.assertEqual(run.call_count, 1)

    @patch("app.backend.boss_adapter.subprocess.run")
    def test_concurrent_operation_is_rejected(self, run):
        self.adapter._lock.acquire()
        self.addCleanup(self.adapter._lock.release)
        with self.assertRaises(BossError) as caught:
            self.adapter.search({"query": "产品"})
        self.assertEqual(caught.exception.code, "BOSS_BUSY")
        run.assert_not_called()

    @patch("app.backend.boss_adapter.subprocess.run")
    def test_malformed_output_is_not_silently_empty(self, run):
        candidates = [subprocess.CompletedProcess([], 0, "not-json", ""), response("detail", {}), response("search", {"items": []}), response("search", [], code=1)]
        for candidate in candidates:
            run.return_value = candidate
            with self.subTest(candidate=candidate), self.assertRaises(BossError) as caught:
                self.adapter.search({"query": "产品"})
            self.assertEqual(caught.exception.code, "INVALID_RESPONSE")

    @patch("app.backend.boss_adapter.subprocess.run")
    def test_empty_success_remains_empty(self, run):
        run.return_value = response("search", [])
        result = self.adapter.search({"query": "产品"})
        self.assertEqual(result["jobs"], [])
        self.assertEqual(result["quality"]["state"], "empty-unconfirmed")

    @patch("app.backend.boss_adapter.subprocess.run")
    def test_missing_salaries_are_explicit_without_detail_fanout(self, run):
        run.return_value = response("search", [{**self.job, "title": "AI产品经理", "salary": ""}])
        result = self.adapter.search({"query": "AI产品经理", "page": 1})
        self.assertEqual(result["jobs"][0]["salary"], "")
        self.assertEqual(result["quality"], {"state": "partial", "missingSalary": 1, "cacheBypassed": True})
        self.assertTrue(any("不代表面议" in w for w in result["warnings"]))
        self.assertEqual(run.call_count, 1)

    @patch("app.backend.boss_adapter.subprocess.run")
    def test_page_two_empty_is_not_proof_of_no_opportunities(self, run):
        run.return_value = response("search", [])
        result = self.adapter.search({"query": "产品经理", "city": "深圳", "page": 2})
        self.assertEqual(result["pagination"]["page"], 2)
        self.assertEqual(result["quality"]["state"], "empty-unconfirmed")
        self.assertTrue(any("分页异常" in w for w in result["warnings"]))
        self.assertEqual(run.call_count, 1)

    @patch("app.backend.boss_adapter.subprocess.run")
    def test_normal_search_preserves_salary_and_unknown_pagination(self, run):
        envelope = json.loads(response("search", [self.job]).stdout)
        envelope["pagination"] = {"has_more": "false", "total": 1}
        run.return_value = subprocess.CompletedProcess([], 0, json.dumps(envelope), "")
        result = self.adapter.search({"query": "产品经理", "page": 1})
        self.assertEqual(result["jobs"][0]["salary"], "20-30K")
        self.assertIsNone(result["pagination"]["hasMore"])
        self.assertNotIn("total", result["pagination"])
        self.assertEqual(result["quality"]["state"], "complete")

    @patch("app.backend.boss_adapter.subprocess.run")
    def test_missing_id_is_not_silently_an_empty_page(self, run):
        run.return_value = response("search", [{"title": "产品经理"}])
        with self.assertRaises(BossError) as caught:
            self.adapter.search({"query": "产品经理"})
        self.assertEqual(caught.exception.code, "INVALID_RESPONSE")

    @patch("app.backend.boss_adapter.shutil.which", return_value="/test/boss")
    @patch("app.backend.boss_adapter.subprocess.run")
    def test_status_does_not_read_credentials_or_use_remote_status(self, run, which):
        auth = Path(self.tmp.name) / "auth"
        auth.mkdir()
        (auth / "session.enc").write_text("DO NOT READ")
        run.return_value = subprocess.CompletedProcess([], 0, "boss, version 3.0.1\n", "")
        with patch.object(Path, "read_text", side_effect=AssertionError("no reads")), patch.object(Path, "read_bytes", side_effect=AssertionError("no reads")):
            result = self.adapter.status()
        self.assertIsNone(result["authenticated"])
        self.assertTrue(result["sessionFilePresent"])
        self.assertEqual(run.call_args.args[0], ["/test/boss", "--version"])
        self.assertFalse(result["capabilities"]["apply"])

    def test_cdp_endpoint_must_be_loopback_without_auth(self):
        for url in ("https://external.example", "http://example.com:9222", "http://secret@localhost:9222", "http://localhost:9222/path", "file:///tmp/browser"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                BossAdapter(cdp_url=url)
        self.assertEqual(BossAdapter(cdp_url="http://127.0.0.1:9222").cdp_url, "http://127.0.0.1:9222")

    @patch("app.backend.boss_adapter.subprocess.run")
    def test_detail_rejects_command_injection_and_bad_identifiers(self, run):
        for value in ("a\nb", ";send", {}, "", "a b"):
            with self.subTest(value=value), self.assertRaises(BossError):
                self.adapter.detail(value)
        run.assert_not_called()

    def test_normalization_does_not_invent_missing_fields(self):
        job = normalize_job({"job_id": "a/b", "title": "产品经理"})
        self.assertEqual(job["salary"], "")
        self.assertFalse(job["canFetchDetail"])
        self.assertIn("a%2Fb", job["url"])
        self.assertNotIn("matchScore", job)


    @patch("app.backend.boss_adapter.subprocess.run")
    def test_recruitment_and_custom_city_use_codes_without_extra_requests(self, run):
        from urllib.parse import urlparse, parse_qs
        run.return_value=response("search",[self.job])
        for kind,expected in [("campus","102"),("social","101,103,104,105,106,107"),("internship",None)]:
            self.adapter.search({"query":"机械工程师","city":"香港特别行政区","recruitmentType":kind,"salary":"10-20K"})
            args=run.call_args.args[0];params=parse_qs(urlparse(next(a[6:] for a in args if a.startswith('--url='))).query)
            self.assertEqual(params['city'],['101320300']);self.assertEqual(params['salary'],['405'])
            if expected:self.assertEqual(params['experience'],[expected])
            else:self.assertIn('--job-type=实习',args)
            self.assertNotIn('--city=香港',args)
        self.assertEqual(run.call_count,3)
        self.adapter.search({"query":"工程师","city":"南阳市","experience":"1-3年"})
        args=run.call_args.args[0];self.assertTrue(any('city=101180700' in a and 'experience=104' in a for a in args))

    @patch("app.backend.boss_adapter.subprocess.run")
    def test_invalid_cities_and_conflicting_types_do_not_run_cli(self, run):
        invalid=[{'recruitmentType':'campus','job_type':['实习']},{'recruitmentType':'social','jobType':['实习']},{'city':'火星'},{'city':'广东省'},{'city':'远程'},{'city':'https://example.com'},
          {'recruitmentType':'campus','experience':'3-5年'}, {'recruitmentType':'internship','jobType':['全职']},
          {'recruitmentType':'social','experience':'应届'},{'recruitmentType':'unknown'}, {'salary':'10-15K'}]
        for more in invalid:
            with self.subTest(more=more),self.assertRaises(BossError):self.adapter.search({'query':'工程师',**more})
        run.assert_not_called()

if __name__ == "__main__":
    unittest.main()

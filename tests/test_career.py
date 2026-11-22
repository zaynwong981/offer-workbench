import tempfile
import unittest
from pathlib import Path

from career import CareerStore, validate_preferences, _salary_range


RESUMES = {"education": [], "versions": [
    {"id": "ai", "name": "AI 方向", "summary": [{"label": "经验", "text": "大模型应用与 Agent，使用 SQL 完成数据分析。"}], "experience": []},
    {"id": "finance", "name": "金融方向", "summary": [{"label": "经验", "text": "银行信贷与风控产品，推进授信接口联调。"}], "experience": []},
]}


class CareerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = CareerStore(Path(self.temp.name))

    def tearDown(self):
        self.temp.cleanup()

    def call(self, route, **payload):
        return self.store.dispatch("/api/career/" + route, payload, RESUMES)

    def test_upsert_does_not_erase_pipeline_or_notes(self):
        self.call("upsert", job={"id": "job1", "title": "AI 产品经理", "company": "例子公司", "description": "完整 JD"})
        self.call("update", id="job1", status="interview", notes="第二轮待准备", resumeId="ai", nextDate="2026-11-20")
        record = self.call("upsert", job={"id": "job1", "title": "AI 产品经理", "salary": "20-30K"})["job"]
        self.assertEqual(record["status"], "interview")
        self.assertEqual(record["notes"], "第二轮待准备")
        self.assertEqual(record["resumeId"], "ai")
        self.assertEqual(record["description"], "完整 JD")
        self.assertEqual(len(record["history"]), 3)
        state = CareerStore(Path(self.temp.name)).dispatch("/api/career/state", {}, RESUMES)
        self.assertEqual(state["stats"]["interview"], 1)

    def test_invalid_url_is_rejected(self):
        for url in ("javascript:alert(1)", "file:///etc/passwd", "https://a:secret@example.com", "data:text/html,evil", "https://example.com/\nattack"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                self.call("upsert", job={"title": "产品经理", "url": url})

    def test_explicit_edit_can_clear_fields_without_erasing_tracking(self):
        job = self.call("upsert", job={"id": "edit-job", "title": "产品经理", "salary": "20-30K", "address": "待核实地址", "description": "完整 JD"})["job"]
        self.call("update", id=job["id"], status="interview", notes="保留面试记录", resumeId="ai")
        edited = self.call("upsert", mode="edit", job={"id": job["id"], "title": "产品经理", "salary": "", "address": ""})["job"]
        self.assertEqual(edited["salary"], "")
        self.assertEqual(edited["address"], "")
        self.assertEqual(edited["description"], "完整 JD")
        self.assertEqual(edited["status"], "interview")
        self.assertEqual(edited["notes"], "保留面试记录")
        self.assertEqual(edited["resumeId"], "ai")

    def test_resume_missing_is_reported_without_destroying_backup_link(self):
        job = self.call("upsert", job={"title": "产品经理"}, resumeId="ai")["job"]
        absent = {"education": [], "versions": [RESUMES["versions"][1]]}
        missing = self.store.dispatch("/api/career/state", {}, absent)["jobs"][0]
        self.assertTrue(missing["resumeMissing"])
        self.assertEqual(missing["resumeId"], "ai")
        backup = self.store.dispatch("/api/career/backup", {}, absent)
        self.store.dispatch("/api/career/import", {"backup": backup}, absent)
        restored = self.call("state")["jobs"][0]
        self.assertFalse(restored["resumeMissing"])
        self.assertEqual(restored["resumeId"], "ai")

    def test_invalid_upsert_mode_does_not_mutate_existing_job(self):
        self.call("upsert", job={"id": "mode-job", "title": "产品经理", "salary": "20-30K"})
        before = self.call("backup")
        with self.assertRaises(ValueError):
            self.call("upsert", mode="unknown", job={"id": "mode-job", "title": "产品经理", "salary": ""})
        self.assertEqual(self.call("backup")["jobs"], before["jobs"])

    def test_stale_edit_cannot_resurrect_deleted_opportunity(self):
        job = self.call("upsert", job={"title": "产品经理"})["job"]
        self.call("delete", id=job["id"])
        with self.assertRaises(ValueError):
            self.call("upsert", mode="edit", job=job)
        self.assertEqual(self.call("state")["jobs"], [])

    def test_public_job_metadata_survives_refresh_and_backup(self):
        job = self.call("upsert", job={"id": "public-job", "title": "产品经理", "skills": ["SQL"], "welfare": ["餐补"], "jobType": "全职", "fetchedAt": "2026-11-18T06:00:00+00:00", "recruiterActive": "今日活跃", "internalCredentials": "must-not-persist"})["job"]
        refreshed = self.call("upsert", job={"id": job["id"], "title": "产品经理", "skills": [], "welfare": []})["job"]
        self.assertEqual(refreshed["skills"], ["SQL"])
        self.assertEqual(refreshed["welfare"], ["餐补"])
        self.assertEqual(refreshed["fetchedAt"], "2026-11-18T06:00:00+00:00")
        self.assertNotIn("internalCredentials", refreshed)
        backup = self.call("backup")
        self.call("import", backup=backup)
        restored = self.call("state")["jobs"][0]
        self.assertEqual(restored["welfare"], ["餐补"])
        self.assertEqual(restored["jobType"], "全职")
        with self.assertRaises(ValueError):
            self.call("upsert", job={"title": "产品经理", "skills": [{"raw": "invalid"}]})

    def test_match_uses_real_evidence_and_is_not_hiring_probability(self):
        result = self.call("match", job={"title": "AI 产品经理", "description": "大模型 Agent 应用，需要 SQL 数据分析"})
        self.assertEqual(result["versions"][0]["id"], "ai")
        self.assertGreater(result["versions"][0]["score"], result["versions"][1]["score"])
        self.assertIn("非录用概率", result["scoreLabel"])
        self.assertTrue(result["versions"][0]["evidence"])
        self.assertTrue(result["versions"][1]["missing"])

    def test_unknown_jd_has_no_fake_score(self):
        result = self.call("match", job={"title": "客户助理"})
        self.assertTrue(all(v["score"] is None for v in result["versions"]))
        self.assertTrue(result["warnings"])

    def test_unknown_salary_and_partial_overlap(self):
        prefs = validate_preferences({"salaryMin": 25, "salaryMax": 35})
        result = self.call("match", job={"title": "产品经理", "salary": "面议"}, preferences=prefs)
        self.assertEqual(result["checks"][0]["status"], "unknown")
        result = self.call("match", job={"title": "产品经理", "salary": "20-30K·15薪"}, preferences=prefs)
        self.assertEqual(result["checks"][0]["status"], "unknown")
        result = self.call("match", job={"title": "产品经理", "salary": "10-20K"}, preferences=prefs)
        self.assertEqual(result["checks"][0]["status"], "mismatch")

    def test_exclusion_city_rejection_history(self):
        self.call("upsert", job={"title": "旧岗位", "company": "例子科技"}, status="rejected")
        prefs = validate_preferences({"cities": ["深圳"], "excludedCompanies": ["例子"]})
        result = self.call("match", job={"title": "新岗位", "company": "例子科技", "city": "上海"}, preferences=prefs)
        self.assertEqual([c["status"] for c in result["checks"]], ["mismatch", "mismatch", "unknown"])

    def test_invalid_updates_rollback(self):
        job = self.call("upsert", job={"title": "产品经理"})["job"]
        for changes in ({"status": "nonsense"}, {"resumeId": "missing"}, {"nextDate": "2026-02-30"}):
            with self.assertRaises(ValueError):
                self.call("update", id=job["id"], **changes)
        state = self.call("state")
        self.assertEqual(state["jobs"][0]["status"], "saved")
        self.assertEqual(len(state["jobs"][0]["history"]), 1)

    def test_delete_and_sql_injection_id(self):
        id_ = "'; DELETE FROM jobs; --"
        self.call("upsert", job={"id": id_, "title": "产品经理"})
        self.call("upsert", job={"id": "safe", "title": "数据产品经理"})
        self.call("delete", id=id_)
        self.assertEqual([j["id"] for j in self.call("state")["jobs"]], ["safe"])

    def test_preference_roundtrip_and_salary_units(self):
        prefs = self.call("preferences", preferences={"cities": ["深圳", "深圳"], "salaryMin": 20})["preferences"]
        self.assertEqual(prefs["cities"], ["深圳"])
        self.assertEqual(self.call("state")["preferences"]["salaryMin"], 20)
        self.assertEqual(_salary_range("2-3万/月"), (20, 30))
        self.assertIsNone(_salary_range("年薪40-60万"))
        with self.assertRaises(ValueError):
            self.call("preferences", preferences={"salaryMin": 30, "salaryMax": 20})

    def test_backup_restore_and_atomic_invalid_import(self):
        self.call("upsert", job={"id": "job1", "title": "产品经理"})
        self.call("update", id="job1", status="interview", notes="保留记录")
        backup = self.call("backup")
        self.call("delete", id="job1")
        self.assertEqual(self.call("import", backup=backup)["imported"], 1)
        restored = self.call("state")["jobs"][0]
        self.assertEqual(restored["notes"], "保留记录")
        self.assertEqual(len(restored["history"]), 2)
        backup["jobs"].append({"id": "job2", "title": "错误", "url": "javascript:alert(1)"})
        with self.assertRaises(ValueError):
            self.call("import", backup=backup)
        self.assertEqual(len(self.call("state")["jobs"]), 1)

    def test_source_ids_do_not_collide_and_export_is_not_application(self):
        first = self.call("upsert", job={"id": "abc", "securityId": "abc", "jobId": "42", "lid": "9", "source": "boss", "title": "产品经理"})["job"]
        second = self.call("upsert", job={"id": "abc", "source": "other", "title": "产品经理"})["job"]
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(first["sourceId"], "abc")
        self.assertEqual(first["securityId"], "abc")
        exported = self.call("update", id=first["id"], lastExport={"path": "/local/resume.pdf", "exportedAt": "2026-11-18T12:00:00Z", "versionId": "ai"})["job"]
        self.assertEqual(exported["status"], "saved")
        self.assertEqual(exported["lastExport"]["versionId"], "ai")
        again = self.call("upsert", job={"id": "abc", "source": "boss", "title": "产品经理"})["job"]
        self.assertEqual(again["lastExport"], exported["lastExport"])

    def test_rotated_boss_security_id_preserves_opportunity(self):
        original = self.call("upsert", job={"id": "security-old", "securityId": "security-old", "jobId": "stable", "source": "boss", "title": "产品经理"})["job"]
        self.call("update", id=original["id"], status="interview", notes="待三面")
        updated = self.call("upsert", job={"id": "security-new", "securityId": "security-new", "jobId": "stable", "source": "boss", "title": "产品经理"})["job"]
        self.assertEqual(updated["id"], original["id"])
        self.assertEqual(updated["sourceId"], "security-new")
        self.assertEqual(updated["securityId"], "security-new")
        self.assertEqual(updated["status"], "interview")
        self.assertEqual(updated["notes"], "待三面")
        self.assertEqual(self.call("state")["stats"]["total"], 1)

    def test_import_rejects_duplicate_normalized_ids_and_stable_job_ids(self):
        self.call("upsert", job={"id": "existing", "title": "产品经理"})
        for rows in ([{"id": "x", "title": "A", "source": "boss"}, {"id": "boss:x", "title": "B", "source": "boss"}],
                     [{"id": "old", "title": "A", "source": "boss", "jobId": "stable"}, {"id": "new", "title": "B", "source": "boss", "jobId": "stable"}]):
            with self.assertRaises(ValueError):
                self.call("import", backup={"kind": "career-studio", "schemaVersion": 1, "preferences": {}, "jobs": rows})
            self.assertEqual(self.call("state")["stats"]["total"], 1)

    def test_backups_preserve_history_beyond_display_limit(self):
        job = self.call("upsert", job={"title": "产品经理"})["job"]
        for i in range(105):
            self.call("update", id=job["id"], notes=str(i))
        displayed = self.call("state")["jobs"][0]
        self.assertEqual(len(displayed["history"]), 100)
        self.assertEqual(displayed["historyTotal"], 106)
        backup = self.call("backup")
        self.assertEqual(len(backup["jobs"][0]["history"]), 106)
        self.call("import", backup=backup)
        self.assertEqual(len(self.call("backup")["jobs"][0]["history"]), 106)

    def test_uncertain_salary_units_are_not_treated_as_monthly(self):
        for salary in ("年包50万", "40-60万/年", "30K/year", "300元/日", "20K以上", "月薪20K起"):
            self.assertIsNone(_salary_range(salary), salary)

    def test_salary_range_dash_variants(self):
        for dash in ("-", "–", "—", "－", "~", "～", "〜", "至"):
            self.assertEqual(_salary_range(f"20{dash}30K·14薪"), (20, 30), dash)


if __name__ == "__main__":
    unittest.main()

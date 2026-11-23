"""Local opportunity tracking and explainable résumé keyword comparisons.

No recruiting service or model is called here. Scores describe only evidence in
the supplied text and are never estimates of hiring or interview probability.
"""
from contextlib import contextmanager
from datetime import date, datetime, timezone
import json
from pathlib import Path
import re
import sqlite3
from urllib.parse import urlsplit
import uuid
from .schedule import validate_event, conflicts
from . import workflow


STATUSES = {
    "saved": "待研究", "contacted": "已沟通", "applied": "已投递",
    "interview": "面试中", "offer": "已获 Offer", "rejected": "招聘方未通过",
    "archived": "已归档",
}
DEFAULT_PREFERENCES = {
    "cities": [], "roles": [], "keywords": [], "salaryMin": 0,
    "salaryMax": 0, "excludedCompanies": [], "preferredLocations": [],
    "workModes": [], "companyStages": [], "notes": "", "pace": "passive",
}
JOB_LIMITS = {
    "id": 720, "title": 300, "company": 300, "salary": 150,
    "city": 100, "district": 100, "address": 1000, "description": 40000,
    "url": 3000, "source": 80, "experience": 200, "education": 200,
    "companySize": 200, "companyStage": 200, "workMode": 200,
    "industry": 200, "jobType": 200, "recruiterActive": 200, "fetchedAt": 100,
    "sourceId": 600, "jobId": 600, "securityId": 600, "lid": 600,
    "sourceLabel": 100, "firstViewedAt": 100, "lastViewedAt": 100, "decision": 20, "decisionReason": 2000, "decidedAt": 100,
    "notes": 20000, "resumeId": 200, "nextAction": 2000, "nextDate": 10,
}
JOB_LIST_FIELDS = ("skills", "welfare")
TRACKING_FIELDS = ("status", "notes", "resumeId", "nextAction", "nextDate", "lastExport", "firstViewedAt", "lastViewedAt", "decision", "decisionReason", "decidedAt", "preparation")
TERMS = {
    "AI／大模型": ["AI", "AIGC", "LLM", "大模型", "人工智能"],
    "Agent": ["Agent", "智能体", "Dify"],
    "提示词": ["提示词", "Prompt"],
    "模型评估": ["模型评估", "效果评估", "评测", "召回率", "误伤率", "准确率"],
    "机器学习": ["机器学习", "深度学习", "模型训练", "算法", "Machine Learning"],
    "SaaS": ["SaaS", "软件即服务"],
    "跨境电商": ["跨境", "电商", "Amazon", "Shopify", "ERP"],
    "金融业务": ["金融", "银行", "信贷", "贷款", "授信", "理财", "证券"],
    "风险控制": ["风控", "风险控制", "风险管理", "风险识别", "征信", "风险变量"],
    "数据分析": ["数据分析", "SQL", "Python", "数据处理", "统计", "数据清洗"],
    "需求分析": ["需求分析", "需求调研", "用户调研", "需求设计", "需求梳理", "用户旅程"],
    "原型设计": ["原型", "Axure", "Figma", "交互设计"],
    "项目交付": ["项目管理", "联调", "验收", "项目交付", "上线", "排期"],
    "数据权限": ["权限", "数据安全", "合规", "越权"],
    "增长运营": ["增长", "获客", "转化", "埋点", "运营"],
    "API／系统集成": ["API", "接口", "系统集成", "系统对接"],
}


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _text(value, field, limit):
    if not isinstance(value, str) or len(value) > limit or "\x00" in value:
        raise ValueError(f"{field} 格式不正确或内容过长。")
    return value.strip()


def _normal(value):
    return re.sub(r"[\s（）()·._/\\-]+", "", value).casefold()


def _contains(text, term):
    if re.fullmatch(r"[a-zA-Z0-9 +.-]+", term):
        return bool(re.search(r"(?<![a-zA-Z0-9])" + re.escape(term) + r"(?![a-zA-Z0-9])", text, re.I))
    return _normal(term) in _normal(text)


def _overlap(text, values):
    return [v for v in values if _contains(text, v)]


def validate_preferences(value):
    if not isinstance(value, dict):
        raise ValueError("求职偏好格式不正确。")
    result = dict(DEFAULT_PREFERENCES)
    for key, default in DEFAULT_PREFERENCES.items():
        item = value.get(key, default)
        if isinstance(default, list):
            if not isinstance(item, list) or len(item) > 100:
                raise ValueError(f"{key} 最多支持 100 项。")
            result[key] = list(dict.fromkeys(_text(v, key, 200) for v in item if v != ""))
        elif key in ("salaryMin", "salaryMax"):
            if isinstance(item, bool) or not isinstance(item, (int, float)) or not 0 <= item <= 10000:
                raise ValueError("月薪范围需为 0–10000 K，0 表示不限。")
            result[key] = item
        else:
            result[key] = _text(item, key, 4000 if key == "notes" else 100)
    if result["salaryMax"] and result["salaryMin"] > result["salaryMax"]:
        raise ValueError("期望月薪下限不能高于上限。")
    return result


def validate_job(value, partial=False):
    if not isinstance(value, dict):
        raise ValueError("岗位格式不正确。")
    job = {}
    for key, limit in JOB_LIMITS.items():
        if key in value:
            job[key] = _text(value[key], key, limit)
        elif not partial:
            job[key] = ""
    for key in JOB_LIST_FIELDS:
        if key in value:
            items = value[key]
            if not isinstance(items, list) or len(items) > 100:
                raise ValueError(f"{key} 最多支持 100 条公开标签。")
            job[key] = [_text(item, key, 500) for item in items]
        elif not partial:
            job[key] = []
    if not partial and not job["title"]:
        if not (job.get("description") or job.get("url")):
            raise ValueError("先粘贴职位描述或岗位链接，其他信息可以稍后补齐。")
        job["title"] = "岗位名称待补充"
    if value.get("decision") and value["decision"] not in workflow.DECISIONS:
        raise ValueError("取舍记录不正确。")
    if "preparation" in value:
        raw=value["preparation"]
        if not isinstance(raw,dict): raise ValueError("岗位准备内容格式不正确。")
        works=raw.get("works",[])
        if not isinstance(works,list) or len(works)>20 or any(not isinstance(w,dict) for w in works): raise ValueError("作品列表格式不正确。")
        job["preparation"]={"greeting":workflow.text(raw.get("greeting",""),"沟通文字",10000),"submitUrl":workflow.url(raw.get("submitUrl","")),"works":[{"label":workflow.text(w.get("label",""),"作品名称",100),"url":workflow.url(w.get("url",""))} for w in works]}
    if job.get("url"):
        parts = urlsplit(job["url"])
        if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password:
            raise ValueError("岗位链接仅支持不含账号密码的 http 或 https 网址。")
        if any(ord(char) < 32 for char in job["url"]):
            raise ValueError("岗位链接包含无效字符。")
    if job.get("nextDate"):
        try:
            date.fromisoformat(job["nextDate"])
        except ValueError as error:
            raise ValueError("跟进日期请使用 YYYY-MM-DD。") from error
    if job.get("fetchedAt"):
        try:
            datetime.fromisoformat(job["fetchedAt"])
        except ValueError as error:
            raise ValueError("岗位读取时间格式不正确。") from error
    if "status" in value:
        if not isinstance(value["status"], str) or value["status"] not in STATUSES:
            raise ValueError("机会状态不正确。")
        job["status"] = value["status"]
    if "lastExport" in value:
        item = value["lastExport"]
        if not isinstance(item, dict):
            raise ValueError("导出记录格式不正确。")
        job["lastExport"] = {key: _text(item.get(key, ""), key, 3000 if key == "path" else 200)
                             for key in ("path", "exportedAt", "versionId")}
    return job


def _salary_range(text):
    """Return monthly K only when the text makes the units unambiguous."""
    if not text or any(word in text.lower() for word in ("年", "annual", "year", "天", "日", "小时", "时薪", "hour", "面议", "以上", "以下", "起", "不低于", "不高于")):
        return None
    compact = text.replace(" ", "").translate(str.maketrans({char: "-" for char in "－–—~～〜至"}))
    match = re.search(r"(\d+(?:\.\d+)?)\s*([kK千万]?)\s*-\s*(\d+(?:\.\d+)?)\s*([kK千万])", compact)
    if match:
        unit = match.group(4)
        factor = {"k": 1, "K": 1, "千": 1, "万": 10}
        low = float(match.group(1)) * factor.get(match.group(2), factor[unit])
        high = float(match.group(3)) * factor[unit]
        return (low, high) if low <= high else None
    match = re.search(r"(\d+(?:\.\d+)?)\s*([kK千万])", compact)
    if match:
        amount = float(match.group(1)) * {"k": 1, "K": 1, "千": 1, "万": 10}[match.group(2)]
        return amount, amount
    match = re.search(r"(\d{4,})-(\d{4,})元?(?:/月|／月)", compact)
    if match:
        return float(match.group(1)) / 1000, float(match.group(2)) / 1000
    return None


def _resume_lines(state, version):
    lines = []
    for bullet in version.get("summary", []):
        lines.append(str(bullet.get("label", "")) + "：" + str(bullet.get("text", "")))
    for entry in version.get("experience", []) + state.get("education", []):
        lines.append(str(entry.get("heading", "")) + " " + str(entry.get("detail", "")))
        for bullet in entry.get("bullets", []):
            lines.append(str(bullet.get("label", "")) + "：" + str(bullet.get("text", "")))
    return [line.strip() for line in lines if line.strip(" ：")]


def compare_job(job, preferences, resume_state, rejected_companies=()):
    text = "\n".join(job.get(k, "") for k in ("title", "description"))
    selected = {key: aliases for key, aliases in TERMS.items() if any(_contains(text, alias) for alias in aliases)}
    for term in preferences["keywords"]:
        if _contains(text, term) and not any(_contains(term, alias) for aliases in selected.values() for alias in aliases):
            selected[term] = [term]
    versions = []
    for version in resume_state.get("versions", []):
        lines = _resume_lines(resume_state, version)
        evidence, missing = [], []
        for term, aliases in selected.items():
            found = next((line for line in lines if any(_contains(line, alias) for alias in aliases)), None)
            if found:
                evidence.append({"term": term, "text": found[:600]})
            else:
                missing.append(term)
        versions.append({"id": version.get("id", ""), "name": version.get("name", ""),
                         "score": round(len(evidence) / len(selected) * 100) if selected else None,
                         "matched": [e["term"] for e in evidence], "missing": missing, "evidence": evidence})
    versions.sort(key=lambda row: row["score"] if row["score"] is not None else -1, reverse=True)
    checks = []
    def check(label, status, detail):
        checks.append({"label": label, "status": status, "detail": detail})
    if preferences["cities"]:
        location = " ".join(job.get(k, "") for k in ("city", "district", "address"))
        hit = _overlap(location, preferences["cities"])
        check("工作城市", "match" if hit else "mismatch" if job.get("city") else "unknown",
              "命中：" + "、".join(hit) if hit else "岗位城市与偏好不一致。" if job.get("city") else "待核实岗位所在城市。")
    if preferences["roles"]:
        hit = _overlap(job.get("title", ""), preferences["roles"])
        check("岗位方向", "match" if hit else "unknown", "命中：" + "、".join(hit) if hit else "岗位名称未直接命中，需结合职责判断。")
    if preferences["salaryMin"] or preferences["salaryMax"]:
        salary = _salary_range(job.get("salary", ""))
        if salary is None:
            check("月薪范围", "unknown", "薪酬缺失、面议或单位不明确；需确认税前固定月薪及薪数。")
        else:
            low, high = salary
            floor, ceiling = preferences["salaryMin"], preferences["salaryMax"] or float("inf")
            outside = high < floor or low > ceiling
            full = low >= floor and high <= ceiling
            check("月薪范围", "mismatch" if outside else "match" if full else "unknown",
                  f"招聘月薪 {low:g}–{high:g} K；" + ("与期望范围无交集。" if outside else "位于期望范围内，实际报价待确认。" if full else "仅部分重叠，实际报价待确认。"))
    company = job.get("company", "")
    exclusions = [name for name in preferences["excludedCompanies"] if _normal(name) in _normal(company)] if company else []
    if preferences["excludedCompanies"]:
        check("排除名单", "mismatch" if exclusions else "match" if company else "unknown",
              "命中：" + "、".join(exclusions) if exclusions else "未命中已设置名单。" if company else "公司名称缺失。")
    previous = [name for name in rejected_companies if company and _normal(name) == _normal(company)]
    if previous:
        check("历史未通过", "unknown", "该公司有未通过记录，请核对岗位、时间及冷却期后决定是否再次联系。")
    for pref_key, fields, label in (("preferredLocations", ("district", "address"), "办公地点"),
                                    ("workModes", ("workMode", "description"), "工作方式"),
                                    ("companyStages", ("companyStage",), "公司阶段")):
        values = preferences[pref_key]
        if values:
            hit = _overlap(" ".join(job.get(k, "") for k in fields), values)
            check(label, "match" if hit else "unknown", "命中：" + "、".join(hit) if hit else "公开信息未直接命中，需进一步核实。")
    warnings = []
    if not job.get("description"):
        warnings.append("尚无完整 JD，仅按岗位名称比较；请补充职责与要求。")
    if not selected:
        warnings.append("未识别可比较的技能词，不生成分数。可在偏好中补充该岗位的关键词。")
    mismatch = any(item["status"] == "mismatch" for item in checks)
    return {"versions": versions, "checks": checks, "warnings": warnings,
            "keywords": list(selected), "scoreLabel": "简历文本关键词覆盖率（非录用概率）",
            "summary": "存在不符合的筛选条件，请先核对。" if mismatch else "请结合匹配证据、信息缺口与真实职责决定是否推进。",
            "method": "基于岗位文本中的有限主题词与简历证据进行同义词匹配，不评判资历、业务成果真实性或面试通过率。"}


class CareerStore:
    def __init__(self, data_dir):
        self.path = Path(data_dir) / "career.sqlite3"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, job_id TEXT, data TEXT NOT NULL,
                  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE);
                CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  job_id TEXT NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL, detail TEXT NOT NULL,
                  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE);
            """)
            workflow.setup(db)

    @contextmanager
    def _db(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def _preferences(self, db):
        row = db.execute("SELECT value FROM settings WHERE key = ?", ("preferences",)).fetchone()
        return validate_preferences(json.loads(row[0]) if row else {})

    def _get_job(self, db, job_id, history_limit=100):
        row = db.execute("SELECT data FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if not row:
            raise ValueError("机会不存在或已删除。")
        job = json.loads(row[0])
        query = "SELECT * FROM activity WHERE job_id = ? ORDER BY id DESC"
        params = (job_id,)
        if history_limit is not None:
            query += " LIMIT ?"
            params += (history_limit,)
        job["history"] = [{"id": h["id"], "type": h["kind"], "at": h["at"], "detail": h["detail"]}
                          for h in db.execute(query, params)]
        job["historyTotal"] = db.execute("SELECT COUNT(*) FROM activity WHERE job_id = ?", (job_id,)).fetchone()[0]
        return job

    def _state(self, db, full_history=False, resume_state=None):
        jobs = [self._get_job(db, row[0], None if full_history else 100) for row in db.execute("SELECT id FROM jobs ORDER BY updated_at DESC, id")]
        resume_ids = {version.get("id") for version in (resume_state or {}).get("versions", [])}
        for job in jobs:
            # This is derived presentation state. Keep the original association
            # so restoring a separately backed-up résumé can repair it later.
            job["resumeMissing"] = bool(job.get("resumeId") and job["resumeId"] not in resume_ids)
        stats = {key: sum(job["status"] == key for job in jobs) for key in STATUSES}
        stats["total"] = len(jobs)
        today = date.today().isoformat()
        stats["due"] = sum(bool(job.get("nextDate")) and job["nextDate"] <= today and job["status"] not in ("rejected", "archived") for job in jobs)
        events = [json.loads(row[0]) for row in db.execute("SELECT data FROM events ORDER BY id")]
        return {"preferences": self._preferences(db), "jobs": jobs, "stats": stats, "statuses": STATUSES,
                "events": events, "conflicts": conflicts(events), **workflow.extra_state(db)}

    def dispatch(self, route, payload, resume_state):
        if not isinstance(payload, dict):
            raise ValueError("请求格式不正确。")
        action = route.removeprefix("/api/career/")
        with self._db() as db:
            if action in ("view", "decision", "preparation", "plan-save", "plan-delete", "artifact", "submission-confirm"):
                return workflow.dispatch(self,db,action,payload,resume_state)
            if action in ("event-save", "event-delete", "event-check"):
                if action == "event-delete":
                    raw = payload.get("event", {})
                    event_id = _text(raw.get("id"), "id", 80)
                    row = db.execute("SELECT data FROM events WHERE id=?", (event_id,)).fetchone()
                    if not row or json.loads(row[0])["revision"] != raw.get("revision"):
                        raise ValueError("日程已修改或删除，请刷新日历后重试。")
                    db.execute("DELETE FROM events WHERE id=?", (event_id,))
                else:
                    raw = payload.get("event")
                    event = validate_event(raw)
                    if event["jobId"]:
                        self._get_job(db, event["jobId"])
                    row = db.execute("SELECT data FROM events WHERE id=?", (event["id"],)).fetchone()
                    if action == "event-save":
                        if (row and json.loads(row[0])["revision"] != event["revision"]) or (not row and event["revision"]):
                            raise ValueError("日程已修改或删除，请刷新日历后重试；当前输入仍保留。")
                        if not row and db.execute("SELECT COUNT(*) FROM events").fetchone()[0] >= 10000:
                            raise ValueError("最多支持 10000 条日程，请先备份和整理历史日程。")
                        event["revision"] += 1
                        db.execute("INSERT INTO events VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET job_id=excluded.job_id, data=excluded.data",
                                   (event["id"], event["jobId"] or None, json.dumps(event, ensure_ascii=False)))
                        if event["jobId"]:
                            self._activity(db, event["jobId"], "schedule", "更新日程：" + event["title"])
                    else:
                        others = [json.loads(r[0]) for r in db.execute("SELECT data FROM events WHERE id<>?", (event["id"],))]
                        return {"conflicts": [c for c in conflicts(others + [event]) if event["id"] in c["ids"]]}
                return self._state(db, resume_state=resume_state)
            if action == "state":
                return self._state(db, resume_state=resume_state)
            if action == "backup":
                state = self._state(db, full_history=True, resume_state=resume_state)
                return {"schemaVersion": 3, "kind": "career-studio", "exportedAt": _now(),
                        "preferences": state["preferences"], "jobs": state["jobs"], "events": state["events"], **workflow.extra_state(db, full=True)}
            if action == "import":
                backup = payload.get("backup")
                if not isinstance(backup, dict) or backup.get("schemaVersion") not in (1, 2, 3) or backup.get("kind") != "career-studio":
                    raise ValueError("请选择求职工作台导出的备份。")
                prefs = validate_preferences(backup.get("preferences"))
                raw_jobs = backup.get("jobs")
                if not isinstance(raw_jobs, list) or len(raw_jobs) > 5000:
                    raise ValueError("备份机会列表格式不正确或超过 5000 条。")
                imported, seen, stable_ids = [], set(), set()
                for raw in raw_jobs:
                    job = validate_job(raw)
                    if not job["id"]:
                        raise ValueError("备份中机会编号缺失。")
                    self._canonical_job(job)
                    stable = (job["source"], job["jobId"] or job["id"])
                    if job["id"] in seen or stable in stable_ids:
                        raise ValueError("备份中机会编号缺失或重复。")
                    seen.add(job["id"])
                    stable_ids.add(stable)
                    job["status"] = raw.get("status", "saved")
                    for key in ("createdAt", "updatedAt"):
                        job[key] = _text(raw.get(key, _now()), key, 100)
                        try:
                            datetime.fromisoformat(job[key])
                        except ValueError as error:
                            raise ValueError("备份时间格式不正确。") from error
                    history = raw.get("history", [])
                    if not isinstance(history, list) or len(history) > 100000:
                        raise ValueError("历史记录格式不正确或超过 100000 条。")
                    clean_history = []
                    for event in history:
                        if not isinstance(event, dict):
                            raise ValueError("历史记录格式不正确。")
                        clean_history.append({key: _text(event.get(key, ""), key, 2000 if key == "detail" else 100)
                                              for key in ("type", "at", "detail")})
                    imported.append((job, clean_history))
                raw_events = backup.get("events", [])
                if not isinstance(raw_events, list) or len(raw_events) > 10000:
                    raise ValueError("日程备份格式不正确或超过 10000 条。")
                events, event_ids = [], set()
                for raw in raw_events:
                    event = validate_event(raw)
                    if not raw.get("id") or event["id"] in event_ids or (event["jobId"] and event["jobId"] not in seen):
                        raise ValueError("日程编号重复或关联机会不存在。")
                    event_ids.add(event["id"])
                    events.append(event)
                extras = workflow.validate_extra_backup(backup, seen)
                # Validation finishes before any deletion; all replacements commit
                # together, or the original opportunity collection is retained.
                db.execute("DELETE FROM submissions")
                db.execute("DELETE FROM artifacts")
                db.execute("DELETE FROM events")
                db.execute("DELETE FROM jobs")
                db.execute("INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ("preferences", json.dumps(prefs, ensure_ascii=False)))
                for job, history in imported:
                    db.execute("INSERT INTO jobs VALUES (?, ?, ?)", (job["id"], json.dumps(job, ensure_ascii=False), job["updatedAt"]))
                    for event in reversed(history):
                        db.execute("INSERT INTO activity (job_id, kind, at, detail) VALUES (?, ?, ?, ?)", (job["id"], event["type"], event["at"], event["detail"]))
                for event in events:
                    db.execute("INSERT INTO events VALUES (?, ?, ?)", (event["id"], event["jobId"] or None, json.dumps(event, ensure_ascii=False)))
                workflow.restore_extra(db, extras)
                return {"imported": len(imported), **self._state(db, resume_state=resume_state)}
            if action == "preferences":
                prefs = validate_preferences(payload.get("preferences"))
                db.execute("INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ("preferences", json.dumps(prefs, ensure_ascii=False)))
                return {"preferences": prefs}
            if action == "match":
                job = validate_job(payload.get("job"))
                prefs = validate_preferences(payload["preferences"]) if "preferences" in payload else self._preferences(db)
                rejected = [json.loads(row[0]).get("company", "") for row in db.execute("SELECT data FROM jobs") if json.loads(row[0]).get("status") == "rejected"]
                return compare_job(job, prefs, resume_state, rejected)
            if action == "upsert":
                raw = payload.get("job")
                mode = payload.get("mode", "refresh")
                if mode not in ("refresh", "edit"):
                    raise ValueError("岗位更新模式不正确。")
                if mode == "edit" and (not isinstance(raw, dict) or not raw.get("id")):
                    raise ValueError("请先保存机会，再编辑岗位资料。")
                job = validate_job(raw)
                self._canonical_job(job)
                if job["source"] == "boss" and job.get("jobId"):
                    # securityId can rotate between BOSS searches. Keep the local
                    # opportunity identity and notes using the stable platform jobId.
                    for row in db.execute("SELECT data FROM jobs"):
                        prior = json.loads(row[0])
                        if prior.get("source") == "boss" and prior.get("jobId") == job["jobId"]:
                            job["id"] = prior["id"]
                            break
                old = db.execute("SELECT data FROM jobs WHERE id = ?", (job["id"],)).fetchone()
                now = _now()
                if old:
                    previous = json.loads(old[0])
                    if previous.get("source", "manual") != job["source"]:
                        raise ValueError("该编号已属于其他来源，请使用不同的机会编号。")
                    # Refetching a job enriches its source fields without destroying
                    # the user's pipeline, notes or assigned résumé.
                    for key in (*JOB_LIMITS, *JOB_LIST_FIELDS):
                        preserve = key not in raw if mode == "edit" else not job.get(key)
                        if key in TRACKING_FIELDS or preserve:
                            job[key] = previous.get(key, [] if key in JOB_LIST_FIELDS else "")
                    if "preparation" in previous: job["preparation"] = previous["preparation"]
                    job["status"] = previous["status"]
                    job["createdAt"] = previous["createdAt"]
                    if previous.get("lastExport"):
                        job["lastExport"] = previous["lastExport"]
                else:
                    if mode == "edit":
                        raise ValueError("该机会已删除或不存在，未重新创建。请刷新机会列表。")
                    count = db.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
                    if count >= 5000:
                        raise ValueError("最多保存 5000 个机会，请先整理历史记录。")
                    job["status"] = "saved"
                    job["createdAt"] = now
                changes = validate_job({key: payload[key] for key in TRACKING_FIELDS if key in payload}, partial=True)
                if changes.get("status") == "applied" and job.get("status") != "applied":
                    raise ValueError("请在岗位准备区确认实际提交，并选择当时使用的PDF，投递记录才有对应版本。")
                job.update(changes)
                if "resumeId" in changes or not old:
                    self._validate_resume(job.get("resumeId"), resume_state)
                job["updatedAt"] = now
                job["source"] = job.get("source") or "manual"
                db.execute("INSERT INTO jobs VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at", (job["id"], json.dumps(job, ensure_ascii=False), now))
                self._activity(db, job["id"], "refresh" if old else "create", "更新岗位资料" if old else "加入机会看板")
                return {"job": self._get_job(db, job["id"])}
            if action in ("update", "delete"):
                job_id = _text(payload.get("id"), "id", 720)
                job = self._get_job(db, job_id)
                if action == "delete":
                    if db.execute("SELECT 1 FROM submissions WHERE job_id=?",(job_id,)).fetchone():
                        raise ValueError("这个机会有投递留档，请改为归档，保留当时提交的简历。")
                    db.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
                    return {"deleted": job_id}
                changes = validate_job({key: payload[key] for key in TRACKING_FIELDS if key in payload}, partial=True)
                if "resumeId" in changes:
                    self._validate_resume(changes["resumeId"], resume_state)
                detail = []
                if "status" in changes and changes["status"] != job["status"]:
                    detail.append(STATUSES[job["status"]] + " → " + STATUSES[changes["status"]])
                if any(changes.get(key, job.get(key)) != job.get(key) for key in ("notes", "resumeId", "nextAction", "nextDate")):
                    detail.append("更新跟进记录")
                if "lastExport" in changes:
                    detail.append("导出岗位专属 PDF（未自动投递）")
                if changes.get("status") == "applied" and job.get("status") != "applied":
                    raise ValueError("请在岗位准备区确认实际提交，并选择当时使用的PDF，投递记录才有对应版本。")
                job.update(changes)
                job.pop("history", None)
                job.pop("historyTotal", None)
                job["updatedAt"] = _now()
                db.execute("UPDATE jobs SET data = ?, updated_at = ? WHERE id = ?", (json.dumps(job, ensure_ascii=False), job["updatedAt"], job_id))
                if detail:
                    self._activity(db, job_id, "update", "；".join(detail))
                return {"job": self._get_job(db, job_id)}
        raise ValueError("未知求职接口。")

    @staticmethod
    def _canonical_job(job):
        job["id"] = job.get("id") or "local-" + uuid.uuid4().hex
        job["source"] = (job.get("source") or "manual").lower()
        if not re.fullmatch(r"[a-z0-9_-]{1,80}", job["source"]):
            raise ValueError("岗位来源请使用字母、数字、下划线或短横线。")
        if job["source"] != "manual":
            prefix = job["source"] + ":"
            raw_id = job["id"].removeprefix(prefix)
            job["sourceId"] = job.get("securityId") or job.get("sourceId") or raw_id
            _text(job["sourceId"], "sourceId", 600)
            if not job["id"].startswith(prefix):
                job["id"] = prefix + job["id"]
            _text(job["id"], "id", 720)

    @staticmethod
    def _validate_resume(resume_id, state):
        if resume_id and resume_id not in {v.get("id") for v in state.get("versions", [])}:
            raise ValueError("所选简历版本已不存在，请重新选择。")

    @staticmethod
    def _activity(db, job_id, kind, detail):
        db.execute("INSERT INTO activity (job_id, kind, at, detail) VALUES (?, ?, ?, ?)", (job_id, kind, _now(), detail))

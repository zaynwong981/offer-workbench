"""Read-only, bounded adapter for the independently installed boss-agent-cli.

Verified against CLI 3.0.1. No dependency on its Python internals or credential
store: commands execute in its own environment and return the JSON envelope.
Only an existing, manually signed-in CDP browser is used. No login, send, apply,
doctor, credential import or background polling is exposed by this module.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlparse


class BossError(RuntimeError):
    def __init__(self, code: str, message: str, http_status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status

    def to_dict(self):
        return {"error": self.message, "code": self.code}


FILTERS = {
    "query": {"multiple": False, "label": "职位关键词"},
    "city": {"multiple": False, "label": "城市", "examples": ["深圳", "广州", "北京", "上海", "杭州"]},
    "salary": {"multiple": False, "options": ["3K以下", "3-5K", "5-10K", "10-15K", "10-20K", "20-50K", "50K以上"]},
    "experience": {"multiple": False, "options": ["应届", "1年以内", "1-3年", "3-5年", "5-10年", "10年以上"]},
    "education": {"multiple": False, "options": ["大专", "本科", "硕士", "博士"]},
    "industry": {"multiple": True, "label": "行业（CLI 支持的名称）"},
    "scale": {"multiple": True, "options": ["0-20人", "20-99人", "100-499人", "500-999人", "1000-9999人", "10000人以上"]},
    "stage": {"multiple": True, "options": ["不限", "未融资", "天使轮", "A轮", "B轮", "C轮", "D轮及以上", "已上市", "不需要融资"]},
    "jobType": {"multiple": True, "options": ["全职", "兼职", "实习"]},
    "active": {"multiple": False, "options": ["online"]},
    "page": {"min": 1, "max": 5},
}
RISK_CODES = {"ACCOUNT_RISK", "ENVIRONMENT_RISK", "ENVIRONMENT_RISK_LOCKED", "LOGIN_RISK_CONTROL"}
AUTH_CODES = {"AUTH_REQUIRED", "AUTH_EXPIRED", "LOGIN_EXPIRED", "TOKEN_REFRESH_FAILED", "BROWSER_SESSION_NOT_FOUND", "CDP_UNAVAILABLE"}
ERROR_MESSAGES = {
    "AUTH_REQUIRED": "BOSS 连接需要登录。请在你手动启动的 CDP 浏览器中打开 BOSS 官网并登录，再重试。",
    "AUTH_EXPIRED": "BOSS 登录已过期，请在官方页面手动重新登录。",
    "LOGIN_EXPIRED": "BOSS 登录已过期，请在官方页面手动重新登录。",
    "TOKEN_REFRESH_FAILED": "BOSS 会话不可用，请在官方页面手动重新登录。",
    "BROWSER_SESSION_NOT_FOUND": "未找到已登录的 CDP 浏览器。请先按连接说明启动浏览器并手动登录 BOSS。",
    "CDP_UNAVAILABLE": "无法连接指定的本机 CDP 浏览器，请检查浏览器是否运行。",
    "RATE_LIMITED": "BOSS 请求受到频率限制，本次已停止，请稍后手动重试。",
    "REQUEST_BUDGET_EXHAUSTED": "BOSS CLI 请求额度已用完，本次已停止。",
    "INVALID_PARAM": "BOSS CLI 不接受本次筛选条件，请使用界面提供的选项或减少筛选项。",
    "JOB_NOT_FOUND": "岗位不存在、已下架或详情标识已过期，请重新搜索。",
    "NETWORK_ERROR": "BOSS 网络请求失败，本次已停止，请检查连接后手动重试。",
    "NOT_SUPPORTED": "当前 BOSS CLI 不支持此读取能力，请检查版本。",
}


def _text(value, limit=20000):
    return value[:limit] if isinstance(value, str) else ""


def _string_list(value):
    return [_text(v, 500) for v in value[:100] if isinstance(v, str)] if isinstance(value, list) else []


def normalize_job(raw: dict) -> dict:
    """Select public job fields; never forward arbitrary CLI objects or hints."""
    security_id = _text(raw.get("security_id") or raw.get("securityId"), 2048)
    job_id = _text(raw.get("job_id") or raw.get("jobId"), 2048)
    result = {
        "id": security_id or job_id,
        "securityId": security_id,
        "jobId": job_id,
        "lid": _text(raw.get("lid"), 2048),
        "source": "boss",
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "url": "https://www.zhipin.com/job_detail/" + quote(job_id, safe="") + ".html" if job_id else "",
        "skills": _string_list(raw.get("skills")),
        "welfare": _string_list(raw.get("welfare")),
        "jobType": _text(raw.get("employment_type"), 100),
        "companySize": _text(raw.get("scale"), 200),
        "companyStage": _text(raw.get("stage"), 200),
        "recruiterActive": _text(raw.get("boss_active_desc") or raw.get("boss_active"), 200),
        "canFetchDetail": bool(security_id),
    }
    for key in ("title", "company", "salary", "city", "district", "address", "description", "experience", "education", "industry", "scale", "stage"):
        result[key] = _text(raw.get(key), 30000 if key == "description" else 2000)
    return result


class BossAdapter:
    def __init__(self, executable=None, data_dir=None, *, cdp_url=None, timeout=45):
        self.executable = str(executable) if executable else self._find_cli()
        self.data_dir = Path(data_dir or os.environ.get("CAREER_BOSS_DATA_DIR") or "~/.boss-agent").expanduser()
        self.cdp_url = cdp_url or os.environ.get("CAREER_BOSS_CDP_URL")
        if self.cdp_url:
            parsed = urlparse(self.cdp_url)
            if parsed.scheme != "http" or parsed.hostname not in {"localhost", "127.0.0.1", "::1"} or parsed.username or parsed.password or parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
                raise ValueError("BOSS CDP 地址必须是本机 HTTP 调试端口。")
        self.timeout = min(max(float(timeout), 1), 60)
        self._lock = threading.Lock()
        self._blocked = False
        self._identities = {}

    @staticmethod
    def _find_cli():
        configured = os.environ.get("CAREER_BOSS_BIN")
        if configured:
            return shutil.which(configured)
        found = shutil.which("boss")
        if found:
            return found
        fallback = Path.home() / ".local" / "bin" / ("boss.exe" if os.name == "nt" else "boss")
        return str(fallback) if fallback.is_file() and os.access(fallback, os.X_OK) else None

    def status(self):
        """Local diagnostics only; neither decrypts auth nor accesses BOSS."""
        available = bool(self.executable and shutil.which(self.executable))
        version = ""
        if available:
            try:
                completed = subprocess.run([self.executable, "--version"], capture_output=True, text=True, timeout=5, shell=False, stdin=subprocess.DEVNULL)
                match = re.search(r"\bversion\s+(\d+\.\d+\.\d+[^\s]*)", completed.stdout[:200])
                version = match.group(1) if completed.returncode == 0 and match else "未知"
            except (OSError, subprocess.TimeoutExpired):
                available = False
        blocked = self._blocked or (self.data_dir / "cdp_risk_lock.json").exists()
        return {
            "available": available, "version": version, "verifiedVersion": "3.0.1",
            "authenticated": None, "authState": "risk-blocked" if blocked else "unverified",
            "sessionFilePresent": (self.data_dir / "auth" / "session.enc").is_file(),
            "busy": self._lock.locked(), "blocked": blocked,
            "browserSource": "existing-browser", "filters": FILTERS,
            "capabilities": {"search": True, "detail": True, "login": False, "send": False, "apply": False, "batch": False},
            "message": "已检测到 CLI；登录有效性尚未验证。读取岗位时只复用已登录的 CDP 浏览器。" if available else "未找到 boss-agent-cli，请先安装并确保 boss 命令可用。",
            "limitations": ["一次只读取一页，最多允许手动查看前 5 页；不会后台轮询。", "地区、办公楼、排除公司等条件由工作台对已取回结果过滤，不能代表全站覆盖。", "不发送消息、不投递附件、不处理验证码；CLI 可能写入本机搜索缓存。", "登录文件存在不代表登录有效；本适配器不读取其内容。"],
        }

    def _run(self, command, args):
        if command not in {"search", "detail"}:
            raise BossError("NOT_SUPPORTED", "此工作台只开放 BOSS 搜索与详情读取。")
        if not self.executable:
            raise BossError("CLI_NOT_FOUND", "未找到 boss-agent-cli，请先安装并确保 boss 命令可用。", 503)
        if self._blocked or (self.data_dir / "cdp_risk_lock.json").exists():
            raise BossError("ACCOUNT_RISK", "BOSS 请求已因平台风险停止。请先在平台人工处理；工作台不会自动解除风险锁或重试。", 409)
        if not self._lock.acquire(blocking=False):
            raise BossError("BOSS_BUSY", "已有 BOSS 请求正在执行，请等待完成后再操作。", 409)
        try:
            argv = [self.executable, "--json", "--exit-codes", "envelope", "--log-level", "error", "--data-dir", str(self.data_dir), "--platform", "zhipin", "--role", "candidate", "--browser-source", "existing-browser"]
            if self.cdp_url:
                argv += ["--cdp-url", self.cdp_url]
            argv += [command, *args]
            try:
                completed = subprocess.run(argv, capture_output=True, text=True, timeout=self.timeout, shell=False, stdin=subprocess.DEVNULL)
            except subprocess.TimeoutExpired:
                raise BossError("BOSS_TIMEOUT", "BOSS 读取超时，本次已停止，请稍后手动重试。", 504) from None
            except OSError:
                raise BossError("CLI_NOT_FOUND", "无法启动 boss-agent-cli，请检查安装和可执行文件路径。", 503) from None
            if len(completed.stdout) > 8_000_000:
                raise BossError("INVALID_RESPONSE", "BOSS CLI 返回数据过大，未导入。", 502)
            try:
                envelope = json.loads(completed.stdout)
            except (ValueError, TypeError):
                raise BossError("INVALID_RESPONSE", "BOSS CLI 未返回有效 JSON，请核对安装版本。", 502) from None
            if not isinstance(envelope, dict) or envelope.get("command") != command or envelope.get("schema_version") != "1.0":
                raise BossError("INVALID_RESPONSE", "BOSS CLI 返回结构不兼容，请核对版本。", 502)
            if envelope.get("ok") is not True:
                error = envelope.get("error")
                code = error.get("code") if isinstance(error, dict) else "BOSS_ERROR"
                if not isinstance(code, str):
                    code = "BOSS_ERROR"
                if code in RISK_CODES:
                    self._blocked = True
                    raise BossError(code, "BOSS 返回账号或环境风险，本次已停止。请先在官方页面人工处理，工作台不会自动重试或解除风险锁。", 409)
                known_code = code if code in ERROR_MESSAGES else "BOSS_ERROR"
                raise BossError(known_code, ERROR_MESSAGES.get(known_code, "BOSS 读取失败，本次已停止，请检查 CLI 和浏览器连接。"), 401 if code in AUTH_CODES else 502)
            if completed.returncode != 0:
                raise BossError("INVALID_RESPONSE", "BOSS CLI 退出状态异常，未导入结果。", 502)
            return envelope
        finally:
            self._lock.release()

    def search(self, filters):
        if not isinstance(filters, dict):
            raise BossError("INVALID_PARAM", "搜索条件必须为对象。")
        allowed = set(FILTERS) | {"keyword", "job_type"}
        if set(filters) - allowed:
            raise BossError("INVALID_PARAM", "包含未支持的 BOSS 筛选条件，请使用界面提供的选项。")
        query = filters.get("query") or filters.get("keyword")
        if not isinstance(query, str) or not query.strip() or len(query) > 100 or any(ord(c) < 32 for c in query):
            raise BossError("INVALID_PARAM", "请输入 1 至 100 字的单个搜索关键词。")
        page = filters.get("page", 1)
        if isinstance(page, bool) or not isinstance(page, int) or not 1 <= page <= 5:
            raise BossError("INVALID_PARAM", "一次只读取一页，页码须为 1 至 5。")
        # A search is an explicit user refresh. CLI caches even empty pages and
        # rows with missing salaries for 24h, across browser login changes.
        args = ["--no-cache", "--page=" + str(page)]
        for key, spec in FILTERS.items():
            if key in {"query", "page"}:
                continue
            value = filters.get(key, filters.get("job_type") if key == "jobType" else None)
            if value is None or value == "" or value == []:
                continue
            if isinstance(value, list) and spec.get("multiple"):
                values = value
            elif isinstance(value, str):
                values = value.split(",") if spec.get("multiple") else [value]
            else:
                raise BossError("INVALID_PARAM", "筛选项格式不正确：" + key)
            if len(values) > 12 or not all(isinstance(v, str) and 0 < len(v.strip()) <= 100 and not any(ord(c) < 32 for c in v) for v in values):
                raise BossError("INVALID_PARAM", "筛选项内容过长或格式不正确：" + key)
            values = [v.strip() for v in values]
            if spec.get("options") and any(v not in spec["options"] for v in values):
                raise BossError("INVALID_PARAM", "筛选项不在可用选项中：" + key)
            option = "job-type" if key == "jobType" else key
            args.append("--" + option + "=" + ",".join(values))
        args += ["--", query.strip()]
        envelope = self._run("search", args)
        rows = envelope.get("data")
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise BossError("INVALID_RESPONSE", "BOSS 搜索结果结构不兼容。", 502)
        jobs = [normalize_job(row) for row in rows[:100]]
        warnings = ["本次已跳过 CLI 搜索缓存；薪资、福利、地址及招聘状态以岗位详情和招聘方确认为准。"]
        if len(rows) > 100:
            warnings.append("该页超过 100 条，仅显示前 100 条；未自动请求下一页。")
        jobs = [job for job in jobs if job["id"]]
        if rows and not jobs:
            raise BossError("INVALID_RESPONSE", "BOSS 返回的岗位缺少详情标识，无法读取；本次结果未导入。", 502)
        missing_salary = sum(not job["salary"].strip() for job in jobs)
        if missing_salary:
            warnings.append(f"本页 {missing_salary}/{len(jobs)} 个岗位未返回薪资，不代表面议。请在专用 Chrome 核对登录状态及岗位原页面；工作台不会自动逐条请求详情。")
        if not jobs:
            warnings.append("本次未返回岗位，尚不能确认是真实空页还是会话或分页异常。请在专用 Chrome 核对相同条件，勿连续重试。")
        for job in jobs:
            if job["securityId"]:
                self._identities[job["id"]] = (job["jobId"], job["lid"])
        if len(self._identities) > 1000:
            self._identities = dict(list(self._identities.items())[-1000:])
        pagination = envelope.get("pagination") or {}
        if not isinstance(pagination, dict):
            pagination = {}
        has_more = pagination.get("has_more")
        # CLI 3.0.1 total falls back to len(items); it is not a proven site total.
        return {"jobs": jobs, "pagination": {"page": page, "hasMore": has_more if isinstance(has_more, bool) else None, "count": len(jobs)}, "warnings": warnings, "source": "boss",
                "quality": {"state": "empty-unconfirmed" if not jobs else "partial" if missing_salary else "complete", "missingSalary": missing_salary, "cacheBypassed": True}}

    def detail(self, job_id):
        # This is the search result's normalized id (BOSS security_id).
        if not isinstance(job_id, str) or not 1 <= len(job_id) <= 2048 or not re.fullmatch(r"[A-Za-z0-9_~+=/.-]+", job_id):
            raise BossError("INVALID_PARAM", "岗位详情标识不正确，请从搜索结果中选择岗位。")
        encrypted_id, lid = self._identities.get(job_id, ("", ""))
        args = []
        if encrypted_id:
            args.append("--job-id=" + encrypted_id)
        if lid:
            args.append("--lid=" + lid)
        args += ["--", job_id]
        envelope = self._run("detail", args)
        raw = envelope.get("data")
        if not isinstance(raw, dict):
            raise BossError("INVALID_RESPONSE", "BOSS 岗位详情结构不兼容。", 502)
        raw = {**raw, "security_id": job_id}
        if not raw.get("job_id"):
            raw["job_id"] = encrypted_id
        return normalize_job(raw)

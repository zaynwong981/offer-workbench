"""Offline selection catalog and bounded BOSS filter translation. No network."""
import json
from pathlib import Path

CATALOG = json.loads((Path(__file__).resolve().parents[1] / "frontend/config/preference-options.json").read_text(encoding="utf-8"))
RECRUITMENT_TYPES = ("all", "campus", "social", "internship")

def resolve_city(value):
    name = value.strip()
    if len(name)>100 or any(ord(c)<32 for c in name): raise ValueError("请填写一个完整城市名称。")
    if not name or name in ("全国", "不限"): return "", "100010000"
    aliases = {"香港特别行政区":"香港", "香港特別行政區":"香港", "香港市":"香港"}
    name = aliases.get(name, name)
    for label, code in CATALOG["cities"].items():
        if name in (label, label + "市") or (label.endswith("市") and name == label[:-1]):
            return label, code
    raise ValueError("未识别城市：" + name + "。请填写中国大陆城市全名或香港，不要填写省份、区县或办公楼；工作台不会改成全国搜索。")

def search_params(filters):
    params = {}
    if filters.get("city"):
        if not isinstance(filters["city"], str): raise ValueError("每次搜索请选择一个城市。")
        _, params["city"] = resolve_city(filters["city"])
    kind = filters.get("recruitmentType", "all")
    if kind not in RECRUITMENT_TYPES: raise ValueError("招聘类别请选择不限、校招、社招或实习。")
    experience = filters.get("experience", "")
    if experience and experience not in CATALOG["experience"]: raise ValueError("请选择可用的经验条件。")
    if kind == "campus":
        if experience and experience != "应届": raise ValueError("校招使用应届生条件，请清空其他经验要求后再搜索。")
        if "实习" in filters.get("jobType", []): raise ValueError("校招与实习不是同一条件。查实习岗位时，请把招聘类别设为实习。")
        params["experience"] = "102"
    elif kind == "internship":
        types = filters.get("jobType", [])
        if isinstance(types, str): types = types.split(",")
        if types and types != ["实习"]: raise ValueError("实习类别与工作类型冲突，请仅选择实习或清空工作类型。")
        if experience and experience != "在校生": raise ValueError("实习类别不能同时要求应届或工作年限，请清空经验要求。")
        if experience: params["experience"] = "108"
    elif kind == "social":
        if "实习" in filters.get("jobType", []): raise ValueError("社招与实习类型冲突，请把招聘类别设为实习。")
        if experience in ("应届", "在校生"): raise ValueError("社招与在校／应届条件冲突，请调整招聘类别或经验要求。")
        params["experience"] = CATALOG["experience"].get(experience, "101,103,104,105,106,107")
    elif experience:
        params["experience"] = CATALOG["experience"][experience]
    salary = filters.get("salary", "")
    if salary:
        # Legacy 10-15K had no exact platform band; do not silently broaden it.
        band = next((b for b in CATALOG["salaryBands"] if b["label"] == salary), None)
        if not band: raise ValueError("该薪资区间没有对应的BOSS筛选项，请重新选择；更细的期望可在偏好中手动填写。")
        if band["code"]: params["salary"] = band["code"]
    return params

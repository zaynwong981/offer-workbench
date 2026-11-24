"use strict";
const $ = s => document.querySelector(s);
const esc = x => String(x ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
} [c]));
const statuses = {
    saved: "待评估",
    contacted: "已沟通",
    applied: "已投递",
    interview: "面试中",
    offer: "Offer",
    rejected: "招聘方未通过",
    archived: "已归档"
};
const sessionKey = "career-studio-session-v3";
function readSession() {
    try {
        const value = JSON.parse(sessionStorage.getItem(sessionKey) || "null");
        return value && value.schemaVersion === 1 ? value : {};
    } catch { return {}; }
}
const restoredSession = readSession();
const validTabs = ["overview", "search", "pipeline", "calendar", "salary", "preferences"];
let salaryPrefill = null;
let calendarJob = "";
let career = {
        preferences: {},
        jobs: [],
        stats: {}
    },
    resumes = {
        versions: []
    },
    connection = {},
    tab = validTabs.includes(location.hash.slice(1)) ? location.hash.slice(1) : validTabs.includes(restoredSession.tab) ? restoredSession.tab : "overview",
    results = Array.isArray(restoredSession.results) ? restoredSession.results : [],
    resultInfo = restoredSession.resultInfo || "",
    pipelineStatus = restoredSession.pipelineStatus || "all",
    pipelineText = restoredSession.pipelineText || "",
    activeJob = null,
    matching = null;
let searchValues = restoredSession.searchValues || {
    keyword: "产品经理",
    city: "深圳",
    page: 1
};
let preferenceDraft = restoredSession.preferenceDraft || null;
let searchPending = false, searchError = "", searchCompleted = Boolean(restoredSession.searchCompleted);
let editingJob = null,
    renderedJobKey = "",
    renderedTracking = {};
const trackingDrafts = new Map(restoredSession.trackingDrafts || []),
    contactDrafts = new Map(restoredSession.contactDrafts || []),
    targetChoices = new Map(restoredSession.targetChoices || []);
const chromeCommand = 'open -na "Google Chrome" --args --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir="$HOME/.career-studio-chrome" "https://www.zhipin.com/"';
const titles = {
    calendar: ["CAREER CALENDAR", "求职日历", "面试、笔试与截止时间，按北京时间统一安排。"],
    overview: ["CAREER OVERVIEW", "工作台", "从筛选到准备，在一个地方完成。"],
    search: ["DISCOVER OPPORTUNITIES", "找岗位", "按次检索 BOSS，或粘贴职位描述开始评估。"],
    pipeline: ["OPPORTUNITY PIPELINE", "机会管理", "已保存的岗位、准备材料和投递记录都在这里。"],
    salary: ["SALARY & TAKE-HOME PAY", "薪酬与个税", "北上广深杭同薪比较，拆开看个税、社保和公积金。"],
    preferences: ["YOUR PREFERENCES", "先定义你的好机会", "保留多个探索方向，再用实际岗位校准偏好。"]
};

function safeUrl(value) {
    try {
        const u = new URL(value);
        return ["https:", "http:"].includes(u.protocol) ? u.href : "";
    } catch {
        return "";
    }
}

function textOf(value) {
    return typeof value === "string" ? value : value?.text || value?.detail || value?.message || JSON.stringify(value ?? "");
}

function list(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeJob(j) {
    return j?.job ? {
        ...j.job,
        ...j
    } : j;
}

function savedJob(j) {
    return career.jobs.find(k => k.id === j.id || (k.source === j.source && ((k.jobId && j.jobId && k.jobId === j.jobId) || (k.sourceId || k.securityId || k.id) === (j.sourceId || j.securityId || j.id))));
}

function error(message) {
    $("#error").textContent = message || "";
    $("#error").hidden = !message;
}

function toast(message) {
    $("#toast").textContent = message;
    $("#toast").hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => $("#toast").hidden = true, 4500);
}
async function api(path, payload) {
    const response = await fetch(path, payload === undefined ? {} : {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });
    let data;
    try { data = await response.json(); }
    catch { throw new Error("本机服务返回异常，请重新启动工作台后再试。当前输入仍保留。"); }
    if (!response.ok) {
        const failure = new Error(data.error?.message || data.error || data.message || "请求失败，请重试。");
        failure.code = data.code;
        throw failure;
    }
    return data;
}
async function busy(button, work) {
    if (button) button.disabled = true;
    error("");
    try {
        return await work();
    } catch (e) {
        error(e.message);
        if ($("#manual-dialog").open) {
            $("#manual-error").textContent = e.message;
            $("#manual-error").hidden = false;
        }
        if ($("#job-dialog").open) {
            const target = $("#job-error");
            if (target) {
                target.textContent = e.message;
                target.hidden = false;
            }
        }
        toast(e.message);
    } finally {
        if (button) button.disabled = false;
    }
}
async function refresh() {
    career = await api("/api/career/state");
    career.jobs = list(career.jobs).map(normalizeJob);
    return career;
}

function versionOptions(selected) {
    return resumes.versions.map(v => `<option value="${esc(v.id)}" ${v.id===selected?"selected":""}>${esc(v.name)}</option>`).join("");
}

function statusOptions(selected) {
    return Object.entries(statuses).map(([v, n]) => `<option value="${v}" ${v===selected?"selected":""}>${n}</option>`).join("");
}

function empty(title, body, button = "") {
    return `<div class="empty"><strong>${esc(title)}</strong><p>${esc(body)}</p>${button}</div>`;
}

function persistSession() {
    try {
        sessionStorage.setItem(sessionKey, JSON.stringify({schemaVersion: 1, tab, searchValues,
            results, resultInfo, searchCompleted, pipelineStatus, pipelineText, preferenceDraft,
            trackingDrafts: [...trackingDrafts], contactDrafts: [...contactDrafts], targetChoices: [...targetChoices]}));
    } catch { error("浏览器草稿空间不足，请先保存偏好和跟进记录，再离开页面。"); }
}

function readPreferences(form) {
    const f = new FormData(form), prefs = {...career.preferences};
    for (const g of preferenceGroups) prefs[g.key] = [...new Set([...f.getAll(g.key), ...splitItems(f.get(g.key + "Extra"))])];
    for (const k of ["preferredLocations", "excludedCompanies"]) prefs[k] = splitItems(f.get(k));
    prefs.salaryMin = Number(f.get("salaryMin"));
    prefs.salaryMax = Number(f.get("salaryMax"));
    prefs.recruitmentType = f.get("recruitmentType") || "all";
    prefs.pace = f.get("pace");
    prefs.notes = String(f.get("notes") || "").trim();
    return prefs;
}

function captureViewDraft() {
    const prefs = $("#preferences-form"), search = $("#search-form"), filter = $("#pipeline-filter");
    if (prefs) {
        const value = readPreferences(prefs);
        preferenceDraft = JSON.stringify(value) === JSON.stringify(career.preferences) ? null : value;
        const hint = $("#preferences-dirty");
        if (hint) hint.hidden = !preferenceDraft;
    }
    if (search) searchValues = readSearchFilters(search);
    if (filter) pipelineText = filter.value;
    persistSession();
}

function selectedTarget(job) {
    const desired = targetChoices.get(jobDraftKey(job)) || job.resumeId;
    if (desired) return resumes.versions.some(v => v.id === desired) ? desired : "";
    return job.resumeMissing ? "" : resumes.versions[0]?.id || "";
}

function navigate(next) {
    captureViewDraft();
    tab = next;
    document.body.dataset.section = next;
    window.scrollTo?.({top: 0, behavior: "instant"});
    history.replaceState(null, "", location.pathname + location.search + "#" + next);
    error("");
    document.querySelectorAll("#sections button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    const t = titles[tab];
    if ($("#eyebrow")) $("#eyebrow").textContent = t[0];
    $("#title").textContent = t[1];
    $("#subtitle").textContent = t[2];
    $("#manual-add").hidden = ["salary", "calendar"].includes(tab);
    render();
    persistSession();
}

function render() {
    captureViewDraft();
    ({
        overview: renderOverview,
        search: renderSearch,
        pipeline: renderPipeline,
        preferences: renderPreferences,
        salary: renderSalary,
        calendar: renderCalendar
    } [tab])();
}

function renderCalendar() {
    $("#content").innerHTML = '<div id="calendar-root"></div>';
    CalendarUI.mount($("#calendar-root"), {state: career, api, refresh, openJob, confirm: confirmAction, initialJob: calendarJob});
    calendarJob = "";
}

function renderSalary() {
    $("#content").innerHTML = (activeJob ? '<p class="hint"><button class="text-button" data-action="salary-return-job">← 返回最近查看的岗位</button></p>' : '') + '<div id="salary-root"><div class="empty">正在加载薪酬计算器…</div></div>';
    const host = $("#salary-root"), prefill = salaryPrefill;
    salaryPrefill = null;
    Promise.resolve().then(() => SalaryUI.mount(host, {prefill})).catch(e => {
        if (host.isConnected) host.innerHTML = `<div class="error-banner" role="alert">${esc(e.message || "薪酬计算器加载失败，请刷新页面。")}</div>`;
    });
}

function renderOverview() {
    const jobs = career.jobs,
        current = jobs.filter(j => !["archived", "rejected"].includes(j.status));
    const upcoming = (career.events || []).filter(e => e.status === "planned").sort((a,b) => a.start.localeCompare(b.start)).slice(0,5);
    const scheduleSummary = `<section class="panel"><div class="panel-heading"><h2>日程与截止时间</h2><button class="text-button" data-tab="calendar">打开日历 →</button></div>${upcoming.length ? upcoming.map(e=>`<div class="due-item"><div class="grow"><strong>${esc(e.title)}</strong><p>${esc(CalendarUI.when(e))}</p></div><button class="secondary" data-tab="calendar">查看</button></div>`).join("") : '<p class="hint">面试和笔试可以分别记录，多轮安排会保留在同一岗位下。</p>'}${(career.conflicts||[]).length ? `<p class="draft-hint">有 ${career.conflicts.length} 组时间冲突，请到日历核对。</p>` : ""}</section>`;
    const due = current.filter(j => j.nextAction || j.nextDate).sort((a, b) => (a.nextDate || "9999").localeCompare(b.nextDate || "9999")).slice(0, 6);
    $("#content").innerHTML = scheduleSummary + `<div class="stats">${[["机会池",jobs.length],["正在跟进",current.length],["面试中",jobs.filter(j=>j.status==="interview").length],["简历版本",resumes.versions.length]].map(([l,n])=>`<div class="stat"><span>${l}</span><strong>${n}</strong></div>`).join("")}</div><div class="two-col"><div class="panel"><div class="panel-heading"><h2>你的求职流程</h2><span class="tag">随时可继续</span></div>${[["01","设定期待","城市、薪资和岗位方向支持组合选择，也能保留模糊偏好。","preferences","调整偏好"],["02","发现与评估","搜索岗位或粘贴 JD，查看硬条件与简历中的真实匹配证据。","search","寻找机会"],["03","准备并推进","选择简历方向，复制专属版本，导出 PDF 后在原平台沟通。","pipeline","管理机会"],["04","比较到手待遇","按北上广深杭参考缴费参数，比较税后月薪与全年到手。","salary","测算薪酬"]].map(([n,h,p,t,b])=>`<div class="step"><span class="step-number">${n}</span><div><h3>${h}</h3><p>${p}</p><button class="text-button" data-tab="${t}">${b} →</button></div></div>`).join("")}</div><div class="panel"><div class="panel-heading"><h2>下一步行动</h2><button class="text-button" data-tab="pipeline">查看全部 →</button></div>${due.length?due.map(j=>`<div class="due-item"><div class="grow"><strong>${esc(j.nextAction||"跟进机会")}</strong><p>${esc(j.company)} · ${esc(j.title)}<br>${esc(j.nextDate||"日期待定")}</p></div><button class="secondary" data-action="open-saved" data-id="${esc(j.id)}">继续</button></div>`).join(""):empty("把下一步写下来","在机会详情中记录下一步行动和日期，这里会显示待办。")}</div></div><div class="panel"><div class="panel-heading"><h2>工具连接</h2><span class="tag ${connection.available?"":"warn"}">${connection.available?"BOSS CLI 已安装":"BOSS CLI 未就绪"}</span></div><p class="muted">${esc(connection.message||"连接状态尚未检查。手动添加岗位、匹配与导出始终可用。")}</p><div class="note">沟通和投递在原渠道完成，再回到岗位选择实际使用的PDF，确认并记录本次投递。工具不会自动发送消息、交换联系方式或上传简历。</div><button class="secondary" data-action="open-connection-help">连接与使用说明</button></div>`;
}

function searchExtraFields() {
    const labels = {
        salary: "薪资范围",
        experience: "工作经验",
        education: "学历",
        scale: "公司规模",
        stage: "融资阶段",
        jobType: "工作类型"
    };
    const singles = ["salary", "experience", "education"].map(key => `<label>${labels[key]}<select name="${key}"><option value="">不限</option>${[...new Set([...list(connection.filters?.[key]?.options),...(searchValues[key]?[searchValues[key]]:[])])].map(v=>`<option value="${esc(v)}" ${searchValues[key]===v?"selected":""}>${esc(v)}</option>`).join("")}</select></label>`).join("");
    const multiples = ["scale", "stage", "jobType"].map(key => `<fieldset class="search-filter-group"><legend>${labels[key]} <span class="muted">可多选</span></legend><div class="chip-group">${[...new Set([...list(connection.filters?.[key]?.options),...list(searchValues[key])])].map(v=>`<label class="chip"><input type="checkbox" name="${key}" value="${esc(v)}" ${list(searchValues[key]).includes(v)?"checked":""}>${esc(v)}</label>`).join("")||'<span class="muted">连接信息中暂无可用选项</span>'}</div></fieldset>`).join("");
    const expanded = ["salary", "experience", "education", "scale", "stage", "jobType"].some(k => Array.isArray(searchValues[k]) ? searchValues[k].length : Boolean(searchValues[k]));
    return `<details class="search-advanced" ${expanded?"open":""}><summary>更多筛选 <span class="muted">薪资、经验、学历、规模、融资与工作类型</span></summary><div class="search-extra-grid">${singles}</div>${multiples}<p class="hint">这些选项来自当前 BOSS CLI。多选条件由平台解释；办公地点、排除公司等额外偏好仍用于本地评估。</p></details>`;
}

function readSearchFilters(form) {
    const f = new FormData(form),
        filters = {
            keyword: String(f.get("keyword") || "").trim(),
            page: Number(f.get("page") || 1)
        };
    const city = String(f.get("city") || "").trim();
    if (city) filters.city = city;
    for (const key of ["salary", "experience", "education", "recruitmentType"]) {
        const v = f.get(key);
        if (v) filters[key] = v;
    }
    for (const key of ["scale", "stage", "jobType", "industry"]) {
        const values = f.getAll(key).filter(Boolean);
        if (values.length) filters[key] = values;
    }
    return filters;
}

function renderSearch() {
    const feedback = searchPending ? '<div class="search-feedback" role="status">正在读取这一页岗位…通常需要数秒，最长约 45 秒。你可以切换页面，结果会保留在这里。</div>' : searchError ? `<div class="search-feedback error-banner" role="alert">${esc(searchError)}<div class="button-row"><button class="secondary" data-action="open-connection-help">查看排障指南</button><button class="secondary" data-action="manual">先手动添加 JD</button></div></div>` : "";
    $("#content").innerHTML = `<section class="panel"><form id="search-form" class="search-form"><label>关键词<input name="keyword" maxlength="100" value="${esc(searchValues.keyword)}" required placeholder="产品经理 SaaS"></label><label>城市<input name="city" maxlength="40" value="${esc(searchValues.city||"")}" placeholder="深圳"></label><label>页码<input name="page" type="number" min="1" max="5" value="${esc(searchValues.page)}"></label><button class="primary" type="submit" ${searchPending?"disabled":""}>${searchPending?"正在搜索…":"搜索 BOSS"}</button><label class="search-recruitment">招聘类别<select name="recruitmentType">${recruitmentOptions(searchValues.recruitmentType)}</select></label><label class="search-industry">行业<select name="industry"><option value="">不限</option>${Object.keys(career.preferenceOptions?.industries||{}).map(v=>`<option ${list(searchValues.industry).includes(v)?"selected":""}>${esc(v)}</option>`).join("")}</select></label>${savedPreferenceSearchFields()}${searchExtraFields()}</form>${feedback}<p class="hint">每次搜索读取一页岗位。切换页面会保留条件和结果；刷新页面不会重新搜索。</p><details><summary class="muted">连接说明与搜索边界</summary><p class="note">先按使用指引打开专用 Chrome 并登录 BOSS。遇到登录验证或环境异常时，回到原网页处理；也可以先粘贴 JD 保存岗位。</p></details></section><div class="search-summary"><h2>搜索结果</h2><p>${esc(resultInfo||"尚未发起搜索")}</p></div><div id="search-results">${results.length?`<div class="job-list">${results.map((j,i)=>jobCard(j,i)).join("")}</div>`:empty(searchCompleted?"本次未返回岗位":searchPending?"正在读取岗位":searchError?"本次未取回岗位":"从一个关键词开始",searchCompleted?"暂不能确认是真实空页还是会话或分页异常。请在专用 Chrome 核对相同搜索条件、登录状态和下一页；勿连续重试。":"也可以把其他招聘平台的职位描述粘贴进来，统一管理和评估。",'<button class="secondary" data-action="manual">手动添加岗位</button>')}</div>`;
    const fillSaved=$("#fill-saved-preferences");if(fillSaved)fillSaved.onclick=fillSearchFromPreferences;
    $("#search-form").onsubmit = async e => {
        e.preventDefault();
        if (searchPending) return;
        searchValues = readSearchFilters(e.target);
        const submitted = structuredClone(searchValues);
        searchPending = true;
        searchError = "";
        searchCompleted = false;
        results = [];
        resultInfo = `正在查询「${submitted.keyword}」 · ${submitted.city || "不限城市"} · 第 ${submitted.page} 页`;
        persistSession();
        renderSearch();
        try {
            const data = await api("/api/boss/search", {filters: submitted});
            results = list(data.jobs).map(normalizeJob);
            searchCompleted = true;
            resultInfo = `「${submitted.keyword}」 · ${submitted.city || "不限城市"} · 第 ${submitted.page} 页 · ${results.length} 个岗位` + (data.pagination?.hasMore ? " · 可手动查询下一页" : "");
            const warnings = list(data.warnings).map(textOf);
            if (warnings.length) resultInfo += " · " + warnings.join("；");
            if (tab !== "search") toast("岗位读取完成，结果已保留在「找岗位」");
        } catch (e) {
            searchError = e.message;
            resultInfo = `「${submitted.keyword}」本次读取失败`;
            if (tab !== "search") toast("岗位读取失败，请回到「找岗位」查看处理指引");
        } finally {
            searchPending = false;
            persistSession();
            if (tab === "search") renderSearch();
        }
    };
}

function jobCard(j, index) {
    const url = safeUrl(j.url),
        saved = Boolean(savedJob(j));
    return `<article class="job-card"><div class="card-head"><h3>${esc(j.title||"未命名岗位")}</h3><span class="salary">${esc(j.salary||(j.source==="boss"?"未读取到薪资":"薪资待核实"))}</span></div><p class="company">${esc(j.company||"公司待核实")}</p><div class="job-meta">${[j.city,j.district,j.experience,j.education].filter(Boolean).map(x=>`<span class="tag">${esc(x)}</span>`).join("")}</div><p class="excerpt">${esc(j.description||j.address||"暂无完整 JD，可点击查看详情后评估。")}</p><div class="card-actions"><button class="secondary" data-action="open-result" data-index="${index}">详情与匹配</button><button class="${saved?"secondary":"primary"}" data-action="save-result" data-index="${index}" ${saved?"disabled":""}>${saved?"已加入机会池":"＋ 加入机会池"}</button>${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">原页面 ↗</a>`:""}</div></article>`;
}

function renderPipeline() {
    const jobs = career.jobs.filter(j => (pipelineStatus === "all" || j.status === pipelineStatus) && `${j.title} ${j.company} ${j.notes||""}`.toLowerCase().includes(pipelineText.toLowerCase()));
    $("#content").innerHTML = `<div class="status-tabs">${[["all","全部"],...Object.entries(statuses)].map(([k,v])=>`<button data-status-filter="${k}" class="${pipelineStatus===k?"active":""}">${v}<small>${career.jobs.filter(j=>k==="all"||j.status===k).length}</small></button>`).join("")}</div><div class="filter-bar"><input id="pipeline-filter" value="${esc(pipelineText)}" placeholder="搜索公司、岗位或备注" aria-label="筛选机会"><button class="secondary" id="filter-button">筛选</button><button class="secondary" data-action="manual">＋ 添加岗位</button></div><section class="panel"><div class="panel-heading"><h2>${jobs.length} 个机会</h2><span class="muted">状态以你的实际操作为准</span></div>${jobs.length?`<div class="table-wrap"><table class="board-table"><thead><tr><th>岗位 / 公司</th><th>薪资 / 城市</th><th>进度</th><th>下一步</th><th></th></tr></thead><tbody>${jobs.map(j=>`<tr><td><strong>${esc(j.title)}</strong><small>${esc(j.company)}</small></td><td>${esc(j.salary||"待核实")}<br><small>${esc(j.city||"地点待核实")}</small></td><td><select aria-label="${esc(j.title)}进度" data-job-status="${esc(j.id)}">${statusOptions(j.status)}</select></td><td>${esc(j.nextAction||"尚未安排")}<br><small>${esc(j.nextDate||"")}</small></td><td class="cell-actions"><button class="text-button" data-action="open-saved" data-id="${esc(j.id)}">查看详情 →</button></td></tr>`).join("")}</tbody></table></div>`:empty(career.jobs.length?"没有符合筛选条件的机会":"还没有收藏的机会","把真实岗位加入机会池后，就可以管理简历、匹配依据和面试进度。",'<button class="secondary" data-tab="search">去找岗位</button>')}</section>`;
    $("#filter-button").onclick = () => {
        pipelineText = $("#pipeline-filter").value.trim();
        renderPipeline();
    };
    $("#pipeline-filter").onkeydown = e => {
        if (e.key === "Enter") $("#filter-button").click();
    };
}
const preferenceGroups = [{
    key: "cities",
    title: "城市",
    choices: ["北京", "上海", "广州", "深圳", "杭州", "远程"]
}, {
    key: "roles",
    title: "岗位方向",
    choices: ["跨境电商产品经理", "SaaS 产品经理", "AI 产品经理", "AI 应用产品经理", "金融产品经理", "数据产品经理", "产品运营"]
}, {
    key: "keywords",
    title: "希望接触的业务",
    choices: ["AI", "LLM", "Agent", "SaaS", "跨境电商", "金融科技", "信贷", "风控", "数据分析"]
}, {
    key: "workModes",
    title: "工作方式",
    choices: ["坐班", "混合办公", "远程", "双休", "可接受出差"]
}, {
    key: "companyStages",
    title: "公司阶段",
    choices: ["初创", "成长期", "成熟公司", "上市公司", "不限"]
}];

const recruitmentLabels = {all:"不限",campus:"校招",social:"社招",internship:"实习"};
function recruitmentOptions(value) {
    return Object.entries(recruitmentLabels).map(([id,label])=>`<option value="${id}" ${id===(value||'all')?'selected':''}>${label}</option>`).join('');
}
function salaryBands() { return list(career.preferenceOptions?.salaryBands); }
function salaryBandValue(p) { return salaryBands().find(b=>b.min===Number(p.salaryMin||0)&&b.max===Number(p.salaryMax||0))?.label||''; }
function preferenceGroup(group, prefs) {
    const selected = list(prefs[group.key]), extra = selected.filter(v => !group.choices.includes(v));
    if (['roles','keywords'].includes(group.key)) {
        const groups = career.preferenceOptions?.[group.key==='roles'?'roleGroups':'businessGroups'] || {};
        const names = Object.keys(groups), first = groups[names[0]] || [];
        return `<div class="pref-group"><p class="pref-title">${group.title}</p><div class="classification-picker"><label>大类<select data-pref-category="${group.key}">${names.map(n=>`<option>${esc(n)}</option>`).join('')}</select></label><label>具体方向<select data-pref-choice="${group.key}"><option value="">选择后加入下方</option>${first.map(n=>`<option>${esc(n)}</option>`).join('')}</select></label><button type="button" class="secondary" data-pref-add="${group.key}">加入</button></div><label>已选与自定义匹配词<textarea name="${group.key}Extra" rows="3" placeholder="可直接填写多个方向，用逗号或换行分隔">${esc(selected.join('，'))}</textarea></label><p class="hint">可从分类加入，也可直接修改、删除或补充下方文字。具体岗位仍按职责核实。</p></div>`;
    }
    return `<div class="pref-group"><p class="pref-title">${group.title} <span class="muted">可多选</span></p><div class="chip-group">${group.choices.map(v=>`<label class="chip"><input type="checkbox" name="${group.key}" value="${esc(v)}" ${selected.includes(v)?"checked":""}>${esc(v)}</label>`).join('')}${group.key==='cities'?`<label class="chip"><input type="checkbox" id="other-cities" ${extra.length?'checked':''}>其它</label>`:''}</div><label ${group.key==='cities'?'id="other-cities-field" '+(extra.length?'':'hidden'):''}>${group.key==='cities'?'中国大陆其他城市或香港':'补充选项'}（逗号分隔）<input name="${group.key}Extra" value="${esc(extra.join('，'))}" placeholder="${group.key==='cities'?'例如：成都，南京，香港':'可以保留探索中的偏好'}"></label>${group.key==='cities'?'<p class="hint">支持城市全名，可加“市”；区县、办公楼请填在优先办公地点。远程作为本地偏好，搜索时另选城市。</p>':''}</div>`;
}
function mountPreferenceControls() {
    const form = $('#preferences-form');
    const other = $('#other-cities');
    if(other) other.onchange=()=>{
        const field=$('#other-cities-field');
        if(!other.checked && form.elements.namedItem('citiesExtra').value.trim()) {
            other.checked=true;toast('先清空其它城市，再取消勾选；已填城市不会直接丢失。');
        }
        field.hidden=!other.checked;
    };
    form.querySelectorAll('[data-pref-category]').forEach(select=>select.onchange=()=>{
        const k=select.dataset.prefCategory, groups=career.preferenceOptions[k==='roles'?'roleGroups':'businessGroups'];
        form.querySelector(`[data-pref-choice="${k}"]`).innerHTML='<option value="">选择后加入下方</option>'+list(groups[select.value]).map(n=>`<option>${esc(n)}</option>`).join('');
    });
    form.querySelectorAll('[data-pref-add]').forEach(button=>button.onclick=()=>{
        const k=button.dataset.prefAdd, value=form.querySelector(`[data-pref-choice="${k}"]`).value, input=form.elements.namedItem(k+'Extra');
        if(!value)return toast('先选择一个具体方向，或直接在下方填写。');
        input.value=[...new Set([...splitItems(input.value),value])].join('，');captureViewDraft();
    });
    const band=$('#preference-salary-band');
    if(band) {
        band.onchange=()=>{const v=salaryBands().find(x=>x.label===band.value);if(!v)return;form.elements.namedItem('salaryMin').value=v.min;form.elements.namedItem('salaryMax').value=v.max;captureViewDraft();};
        for(const k of ['salaryMin','salaryMax']) form.elements.namedItem(k).addEventListener('input',()=>{band.value=salaryBandValue(readPreferences(form));band.dispatchEvent(new Event('input'));});
    }
}
function savedPreferenceSearchFields() {
    const p=career.preferences||{};
    return `<details class="search-advanced saved-preference-search"><summary>从已保存偏好填写</summary><p class="hint">一次选择一个城市、岗位方向和业务。只填写条件，不会自动搜索。</p><div class="search-extra-grid">${[['city','城市',list(p.cities).filter(x=>x!=='远程')],['role','岗位方向',list(p.roles)],['business','业务方向',list(p.keywords)]].map(([id,label,values])=>`<label>${label}<select id="saved-pref-${id}"><option value="">暂不带入</option>${values.map((v,i)=>`<option ${i===0?'selected':''}>${esc(v)}</option>`).join('')}</select></label>`).join('')}</div><button type="button" class="secondary" id="fill-saved-preferences">填写搜索条件</button><p class="hint">自定义业务词会并入关键词；目录内业务会使用行业筛选。手填薪资没有相同区间时不自动扩大范围，可在下方自行选择。</p></details>`;
}
function fillSearchFromPreferences() {
    const p=career.preferences||{}, role=$('#saved-pref-role').value, city=$('#saved-pref-city').value, business=$('#saved-pref-business').value;
    searchValues=readSearchFilters($('#search-form'));
    searchValues.keyword=[role||searchValues.keyword, career.preferenceOptions?.industries?.[business]?'':business].filter(Boolean).join(' ');
    searchValues.city=city;searchValues.recruitmentType=p.recruitmentType||'all';searchValues.page=1;
    delete searchValues.experience;delete searchValues.jobType;delete searchValues.industry;delete searchValues.salary;
    if(career.preferenceOptions?.industries?.[business])searchValues.industry=[business];
    const band=salaryBandValue(p);if(band&&band!=='不限')searchValues.salary=band;
    persistSession();renderSearch();toast('已填写搜索条件，请核对后点击搜索 BOSS。');
}

function renderPreferences() {
    const p = preferenceDraft || career.preferences || {};
    $("#content").innerHTML = `<div class="preferences-layout"><form id="preferences-form" class="panel"><div class="panel-heading"><h2>我的求职偏好</h2><span class="tag">可带入搜索</span></div><p id="preferences-dirty" class="draft-hint" ${preferenceDraft?"":"hidden"}>有未保存修改，已保留在此浏览器标签页；切页或刷新后可继续。匹配仍使用已保存偏好。</p><div class="form-grid"><label>招聘类别<select name="recruitmentType">${recruitmentOptions(p.recruitmentType)}</select></label><label>求职节奏<select name="pace"><option value="passive" ${p.pace==="passive"?"selected":""}>在职观察，只看明显更好的机会</option><option value="exploring" ${p.pace==="exploring"?"selected":""}>主动探索，开放比较</option><option value="active" ${p.pace==="active"?"selected":""}>积极求职，尽快推进</option></select></label></div><p class="hint">校招按应届生条件，社招按非在校／应届经验条件，实习按实习岗位筛选；最终资格以岗位说明为准。</p><div class="preferences-grid">${preferenceGroups.slice(0,3).map(g=>preferenceGroup(g,p)).join("")}<div class="pref-group"><p class="pref-title">税前月薪（人民币 K）</p><label>常用区间<select id="preference-salary-band"><option value="" ${salaryBandValue(p)?"":"selected"}>自定义金额</option>${salaryBands().map(b=>`<option ${salaryBandValue(p)===b.label?"selected":""}>${esc(b.label)}</option>`).join("")}</select></label><div class="form-grid"><label>期望下限<input name="salaryMin" type="number" min="0" max="1000" step="0.5" value="${esc(p.salaryMin||0)}"></label><label>期望上限<input name="salaryMax" type="number" min="0" max="1000" step="0.5" value="${esc(p.salaryMax||0)}"></label></div><p class="hint">0 表示不限制。岗位薪资未知或口径不明确时标记待核实。</p></div><div class="pref-group"><label>优先办公区域 / 地点（每行一个）<textarea name="preferredLocations" rows="3" placeholder="深圳市南山区&#10;高新园地铁站">${esc(list(p.preferredLocations).join("\n"))}</textarea></label></div>${preferenceGroups.slice(3).map(g=>preferenceGroup(g,p)).join("")}<div class="pref-group"><label>排除公司（每行一个）<textarea name="excludedCompanies" rows="3" placeholder="不考虑的公司；已拒绝记录另保留在机会管理中">${esc(list(p.excludedCompanies).join("\n"))}</textarea></label></div></div><label>其他条件与待探索问题<textarea name="notes" rows="4" placeholder="例如：优先有成熟产研团队；薪资结构待比较">${esc(p.notes||"")}</textarea></label><div class="dialog-actions preferences-actions"><button class="secondary" type="button" data-action="discard-preferences">撤销未保存修改</button><button class="primary" type="submit">保存偏好</button></div></form><div class="preferences-support"><details class="panel"><summary>匹配与操作边界</summary><ul class="feature-list"><li>维护多方向简历与本地 PDF</li><li>按次检索岗位，或手动录入 JD</li><li>查看条件差距与简历中的匹配证据</li><li>复制岗位专属版本并自行微调</li><li>跟进沟通、投递、面试与拒绝记录</li></ul><div class="note">规则匹配只是辅助筛选，不是招聘成功概率。薪资、办公地址、校招资格等需向招聘方核实。</div><p class="muted">发送消息、交换联系方式和投递简历请在原平台完成，回来更新状态。没有后台采集或自动投递。</p></details><section class="panel"><h2>备份与迁移</h2><p class="hint">求职备份包含偏好、机会、日程与投递留档。完整简历与照片请在「简历工作台」另行下载备份。</p><div class="button-row"><button class="secondary" data-action="backup">导出求职备份</button><button class="secondary" data-action="restore">导入备份</button></div></section></div></div>`;
    mountPreferenceControls();
    $("#preferences-form").onsubmit = e => {
        e.preventDefault();
        const prefs = readPreferences(e.target);
        busy(e.submitter, async () => {
            await api("/api/career/preferences", {
                preferences: prefs
            });
            await refresh();
            if (JSON.stringify(preferenceDraft) === JSON.stringify(prefs)) preferenceDraft = null;
            persistSession();
            if (tab === "preferences") renderPreferences();
            toast("偏好已保存到本机");
        });
    };
}

function splitItems(v) {
    return String(v || "").split(/[\n,，;；]+/).map(x => x.trim()).filter(Boolean);
}

function jobDraftKey(job) {
    return job.source && job.jobId ? job.source + ":" + job.jobId : job.id;
}

function trackingValue(form) {
    const f = new FormData(form);
    return Object.fromEntries(["status", "resumeId", "nextAction", "nextDate", "notes"].map(k => [k, String(f.get(k) || "")]));
}

function captureJobDraft() {
    if (!renderedJobKey) return;
    const form = $("#job-update-form");
    if (form) {
        const current = trackingValue(form);
        if (Object.keys(current).some(k => current[k] !== String(renderedTracking[k] || ""))) trackingDrafts.set(renderedJobKey, current);
        else trackingDrafts.delete(renderedJobKey);
    }
    const contact = $("#contact-draft");
    if (contact) contactDrafts.set(renderedJobKey, contact.value);
    const target = $("#target-version");
    if (target) targetChoices.set(renderedJobKey, target.value);
    const hint = $("#job-dirty");
    if (hint) {
        hint.hidden = !trackingDrafts.has(renderedJobKey);
        hint.textContent = "跟进尚未保存，草稿已保留在此浏览器标签页；切页或刷新后可继续。";
    }
    persistSession();
}

function openJob(job) {
    captureJobDraft();
    activeJob = normalizeJob(job);
    matching = null;
    renderJob();
    if (!$("#job-dialog").open) $("#job-dialog").showModal();
}

function renderJob() {
    captureJobDraft();
    const saved = savedJob(activeJob);
    if (saved) {
        const currentSecurity = activeJob.securityId;
        activeJob = {
            ...activeJob,
            ...saved
        };
        if (currentSecurity && currentSecurity !== saved.securityId) {
            activeJob.securityId = currentSecurity;
            activeJob.sourceId = currentSecurity;
        }
    }
    renderedJobKey = jobDraftKey(activeJob);
    renderedTracking = {
        ...activeJob
    };
    const j = {
            ...activeJob,
            ...(trackingDrafts.get(renderedJobKey) || {})
        },
        url = safeUrl(j.url);
    $("#job-detail").innerHTML = `<h1>${esc(j.title||"岗位详情")}</h1><p class="company">${esc(j.company||"公司待核实")} · <span class="salary">${esc(j.salary||(j.source==="boss"?"未读取到薪资":"薪资待核实"))}</span></p><div class="job-meta">${[j.city,j.district,j.address].filter(Boolean).map(x=>`<span>${esc(x)}</span>`).join(" · ")}${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">打开招聘原页面 ↗</a>`:""}</div><div class="button-row salary-job-entry"><button class="secondary" data-action="salary-job">测算这个岗位的税后收入 →</button><span class="hint">按招聘薪资带入，范围薪资由你选择金额。</span></div><div id="job-error" class="error-banner" role="alert" hidden></div><div class="detail-grid"><div><section class="panel"><div class="panel-heading"><h2>职位描述</h2><div class="button-row"><button class="secondary" data-action="edit-job">修改岗位资料</button>${j.source==="boss"&&(j.securityId||j.canFetchDetail)?'<button class="secondary" data-action="fetch-detail">获取详情</button>':""}</div></div><div class="description">${esc(j.description||"还没有职位描述。可先粘贴JD补充；来自BOSS的岗位也可按需读取详情。")}</div></section><section class="panel"><div class="panel-heading"><h2>匹配解读</h2><button class="primary" data-action="match">分析匹配</button></div><p class="hint">按当前偏好与简历原文分析；覆盖度只衡量关键词出现情况。</p><div id="matching">${matching?renderMatch(matching):empty("看看哪些经历能对应岗位","查看各方向简历的已有经验、缺失词和需要进一步核实的条件。")}</div></section></div><div><section class="panel"><h2>机会与简历</h2>${saved?'<button class="secondary" data-action="calendar-job">安排面试／笔试日程 →</button>':""}<div class="detail-controls"><p class="hint">${saved?"岗位已保存，可以准备简历和材料。":"查看后会保存在本机，方便继续准备和跟进。"}</p>${saved?`<form id="job-update-form" class="detail-controls"><p id="job-dirty" class="draft-hint" ${trackingDrafts.has(renderedJobKey)?"":"hidden"}>跟进尚未保存；当前页面内保留。</p><label>招聘进度<select name="status">${statusOptions(j.status)}</select></label><label>关联简历<select name="resumeId"><option value="">暂不关联</option>${j.resumeMissing?`<option value="${esc(j.resumeId)}" selected>原关联简历已不存在，请重新选择</option>`:""}${versionOptions(j.resumeId)}</select></label><label>下一步行动<input name="nextAction" maxlength="1000" value="${esc(j.nextAction||"")}" placeholder="例如：确认社招资格与办公地址"></label><label>计划日期<input name="nextDate" type="date" value="${esc(j.nextDate||"")}"></label><label>沟通 / 面试备注<textarea name="notes" rows="5" maxlength="20000" placeholder="沟通记录、笔试题、面试复盘、拒绝原因">${esc(j.notes||"")}</textarea></label><button class="primary" type="submit">保存跟进</button></form>`:'<button class="primary" data-action="save-active">＋ 加入机会池</button>'}${j.resumeMissing?'<p class="draft-hint">原关联简历已不存在，系统不会替你改选其他版本。请选择新版本后再导出。</p>':""}<label>制作或导出的简历版本<select id="target-version"><option value="">请选择简历版本</option>${versionOptions(selectedTarget(j))}</select></label><div class="button-row"><button class="secondary" data-action="tailor" ${saved?"":"disabled"}>复制为岗位专属版本</button><button class="secondary" data-action="export" ${saved?"":"disabled"}>导出 PDF</button></div>${saved && resumes.versions.some(v=>v.id===j.resumeId)?`<a class="secondary linked-resume" href="/?version=${encodeURIComponent(j.resumeId)}&returnJob=${encodeURIComponent(j.id)}">继续编辑关联简历 ↗</a>`:""}<p class="hint">复制会保留原有内容；在编辑器中根据岗位手动微调，不自动编造经验。</p><div id="export-result" hidden></div></div></section><section class="panel"><h2>沟通与面试准备</h2><p class="hint">以下是准备提纲，可自行修改；工作台不会发送消息。</p><textarea id="contact-draft" rows="5">${esc(contactDrafts.get(renderedJobKey)??contactDraft(j))}</textarea><button class="text-button" data-action="copy-draft">复制沟通提纲</button><ul class="prep-list"><li>用一段真实经历说明与岗位职责的关联。</li><li>准备一个包含本人职责、关键决策、结果与证据的案例。</li><li>核实岗位资格、实际办公地点、薪资结构和团队分工。</li><li>面试后将问题、反馈与下一步写入备注。</li></ul></section>${saved?`<section class="panel"><h3>跟进记录</h3>${j.lastExport?.path?`<p class="hint">最近导出：${esc(j.lastExport.exportedAt||"")}</p><div class="file-result">${esc(j.lastExport.path)}</div>`:""}<ul class="history">${list(j.history).slice(0,15).map(h=>`<li>${esc(h.at||"")}<br>${esc(textOf(h.detail)||h.type||"更新记录")}</li>`).join("")||"暂无记录"}</ul><button class="text-button danger" data-action="delete-job">删除此机会</button></section>`:""}</div></div>`;
    if ($("#job-update-form")) $("#job-update-form").onsubmit = e => {
        e.preventDefault();
        captureJobDraft();
        const key = renderedJobKey,
            values = trackingValue(e.target);
        busy(e.submitter, async () => {
            await api("/api/career/update", {
                id: j.id,
                ...values
            });
            trackingDrafts.delete(key);
            renderedJobKey = "";
            await refresh();
            render();
            renderJob();
            toast("跟进记录已保存");
        });
    };
}

function contactDraft(j) {
    return `您好，我关注到贵公司的「${j.title||"该岗位"}」机会，希望进一步了解。\n\n【补充 1–2 句与岗位相关、可核实的个人经历】\n\n也想确认岗位目前是否仍在招聘、实际办公地点，以及团队当前最希望解决的问题。谢谢。`;
}

function renderMatch(data) {
    return `<p class="hint">${esc(textOf(data.summary)||"")}</p>${list(data.checks).map(c=>`<div class="check-row"><span class="tag ${c.status==="mismatch"?"red":c.status==="unknown"?"warn":""}">${{match:"符合",mismatch:"有差距",unknown:"待核实"}[c.status]||"待核实"}</span><div>${esc(c.label)}<p>${esc(c.detail)}</p></div></div>`).join("")}${list(data.versions).map(v=>`<div class="match-version"><header><h3>${esc(v.name)}</h3><span class="score">${v.score===null||v.score===undefined?"待补 JD":esc(v.score)+"%"}<small>覆盖</small></span></header><p>已体现：${esc(list(v.matched).join("、")||"暂无识别到的匹配词")}</p><p>未体现：${esc(list(v.missing).join("、")||"暂无")}</p>${list(v.evidence).slice(0,4).map(e=>`<div class="evidence">${esc(e.term||"")}${e.term?" · ":""}${esc(textOf(e))}</div>`).join("")}<button class="text-button" data-action="select-version" data-version="${esc(v.id)}">选用这个方向 →</button></div>`).join("")}<p class="hint">未出现的词不等于不具备能力；出现的词也不代表已满足所有任职要求。请核对实际工作范围。</p>`;
}
async function saveJob(job) {
    const result = await api("/api/career/upsert", {
        job
    });
    await refresh();
    toast("岗位已保存在本机");
    render();
    return result.job;
}

function confirmAction(title, message) {
    const d = $("#confirm-dialog");
    $("#confirm-title").textContent = title;
    $("#confirm-message").textContent = message;
    d.returnValue = "cancel";
    d.showModal();
    return new Promise(resolve => d.addEventListener("close", () => resolve(d.returnValue === "yes"), {
        once: true
    }));
}

function download(data, name) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
            type: "application/json"
        }),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function backup() {
    download(await api("/api/career/backup"), "求职工作台备份-" + new Date().toISOString().slice(0, 10) + ".json");
    toast("求职备份已下载");
}

function manual(job = null) {
    captureJobDraft();
    editingJob = job ? {
        ...job
    } : null;
    const form = $("#manual-form");
    form.reset();
    $("#manual-title").textContent = job ? "修改岗位资料" : "添加一个真实机会";
    $("#manual-note").textContent = job ? "仅修改本机机会记录，原招聘平台的数据不会改变。后续重新获取详情可能更新这些字段。" : "复制招聘页面中的职位描述即可；无需先连接 BOSS。";
    $("#manual-submit").textContent = job ? "保存岗位资料" : "保存到机会池";
    $("#manual-error").hidden = true;
    form.elements.namedItem("description").required = false;
    if (job)
        for (const key of ["title", "company", "salary", "city", "address", "url", "description"]) form.elements.namedItem(key).value = job[key] || "";
    $("#manual-dialog").showModal();
}
async function action(button) {
    const a = button.dataset.action;
    if (a === "calendar-job") {
        captureJobDraft();
        calendarJob = activeJob.id;
        $("#job-dialog").close();
        navigate("calendar");
        return;
    }
    if (a === "manual") return manual();
    if (a === "edit-job") return manual(activeJob);
    if (a === "salary-job") {
        captureJobDraft();
        salaryPrefill = SalaryJob.prepare(activeJob || {});
        $("#job-dialog").close();
        navigate("salary");
        return;
    }
    if (a === "salary-return-job" && activeJob) {
        const job = activeJob;
        navigate(savedJob(job) ? "pipeline" : "search");
        return openJob(job);
    }
    if (a === "restore") return $("#backup-file").click();
    if (a === "backup") return backup();
    if (a === "open-result") return openJob(results[Number(button.dataset.index)]);
    if (a === "open-saved") return openJob(career.jobs.find(j => j.id === button.dataset.id));
    if (a === "save-result") return saveJob(results[Number(button.dataset.index)]);
    if (a === "open-connection-help") { window.open("/guide#risk-guide", "_blank", "noopener"); return; }
    if (a === "copy-connection") {
        try {
            await navigator.clipboard.writeText(chromeCommand);
            toast("Chrome 启动命令已复制，请在终端自行执行");
        } catch {
            toast("请手动选择上方代码后复制");
        }
        return;
    }
    if (a === "discard-preferences") {
        if (preferenceDraft && !await confirmAction("撤销偏好修改？", "将恢复为已保存的偏好；当前未保存修改会被放弃。")) return;
        preferenceDraft = null;
        persistSession();
        renderPreferences();
        return;
    }
    if (a === "check-connection") {
        captureViewDraft();
        connection = await api("/api/boss/status");
        if (tab === "preferences") renderPreferences();
        return toast("本地连接状态已刷新；未发起在线登录检查");
    }
    if (a === "save-active") {
        activeJob = await saveJob(activeJob);
        return renderJob();
    }
    if (a === "fetch-detail") {
        captureJobDraft();
        const requested = {...activeJob}, key = jobDraftKey(requested), saved = savedJob(requested);
        const data = await api("/api/boss/detail", {id: requested.securityId || requested.sourceId || requested.id});
        let updated = {...requested, ...normalizeJob(data)};
        if (saved) {
            updated.id = saved.id;
            updated = (await api("/api/career/upsert", {job: updated})).job;
            await refresh();
        }
        if (activeJob && jobDraftKey(activeJob) === key && $("#job-dialog").open) {
            activeJob = updated;
            matching = null;
            renderJob();
        } else toast("岗位详情已读取；已收藏机会的资料已更新。");
        return;
    }
    if (a === "match") {
        const requested = {...activeJob}, key = jobDraftKey(requested);
        const result = await api("/api/career/match", {job: requested});
        if (activeJob && jobDraftKey(activeJob) === key && $("#job-dialog").open) {
            matching = result;
            $("#matching").innerHTML = renderMatch(matching);
        }
        return;
    }
    if (a === "select-version") {
        $("#target-version").value = button.dataset.version;
        return toast("已选择该方向，接下来可复制或导出");
    }
    if (a === "tailor") {
        captureJobDraft();
        const job = {...activeJob}, key = jobDraftKey(job), id = $("#target-version").value;
        const pendingTracking = trackingDrafts.get(key);
        if (!id) throw new Error("请先选择一个简历版本。");
        if (pendingTracking) {
            if (!await confirmAction("先保存跟进，再编辑简历？", "你的跟进记录有未保存修改。确认后会保存记录，再打开岗位专属简历。")) return;
            await api("/api/career/update", {id: job.id, ...pendingTracking});
            if (trackingDrafts.get(key) === pendingTracking) trackingDrafts.delete(key);
        }
        const result = await api("/api/career/tailor", {jobId: job.id, versionId: id});
        targetChoices.set(key, result.versionId);
        if (!activeJob || jobDraftKey(activeJob) !== key || !$("#job-dialog").open) {
            resumes = await api("/api/state");
            await refresh();
            persistSession();
            return toast("专属简历已创建。回到这个岗位后，可继续编辑关联简历。");
        }
        // Keep the outgoing base selection from replacing the new target.
        renderedJobKey = "";
        persistSession();
        window.location.assign("/?version=" + encodeURIComponent(result.versionId) + "&returnJob=" + encodeURIComponent(job.id));
        return;
    }
    if (a === "export") {
        const id = $("#target-version").value;
        if (!id) throw new Error("请先选择一个简历版本。");
        const exportKey = jobDraftKey(activeJob);
        const data = await api("/api/career/export", {
            jobId: activeJob.id,
            versionId: id
        });
        await refresh();
        render();
        if (!activeJob || jobDraftKey(activeJob) !== exportKey || !$("#job-dialog").open) {
            toast("PDF 已保存至 " + data.directory);
            return;
        }
        renderJob();
        const el = $("#export-result");
        el.className = "file-result";
        el.textContent = "已保存：" + list(data.files).join("；") + (data.pages > 1 ? `。当前简历共 ${data.pages} 页，已保留完整内容；可在简历工作台精简。` : "");
        el.hidden = false;
        toast(data.pages > 1 ? `PDF 已保存，共 ${data.pages} 页；可精简后重新导出` : "PDF 已保存至 " + data.directory);
        return;
    }
    if (a === "copy-draft") {
        try {
            await navigator.clipboard.writeText($("#contact-draft").value);
            toast("沟通提纲已复制，请核实后自行发送");
        } catch {
            $("#contact-draft").focus();
            $("#contact-draft").select();
            toast("请使用 ⌘C / Ctrl+C 复制已选中的文字");
        }
        return;
    }
    if (a === "delete-job") {
        if (await confirmAction("删除这个机会？", "这会删除本机机会记录、跟进历史和关联日程，招聘平台上的数据不受影响。")) {
            await api("/api/career/delete", {
                id: activeJob.id
            });
            await refresh();
            trackingDrafts.delete(jobDraftKey(activeJob));
            contactDrafts.delete(jobDraftKey(activeJob));
            targetChoices.delete(jobDraftKey(activeJob));
            renderedJobKey = "";
            $("#job-dialog").close();
            render();
            toast("机会已删除");
        }
    }
}
document.addEventListener("click", e => {
    const close = e.target.closest("[data-close]");
    if (close) {
        if (close.dataset.close === "job-dialog") captureJobDraft();
        return document.getElementById(close.dataset.close).close();
    }
    const t = e.target.closest("[data-tab]");
    if (t) return navigate(t.dataset.tab);
    const filter = e.target.closest("[data-status-filter]");
    if (filter) {
        pipelineStatus = filter.dataset.statusFilter;
        return renderPipeline();
    }
    const a = e.target.closest("[data-action]");
    if (a) busy(a, () => action(a));
});
document.addEventListener("change", e => {
    if (e.target.closest("#job-dialog")) captureJobDraft();
    const select = e.target.closest("[data-job-status]");
    if (select) busy(select, async () => {
        await api("/api/career/update", {
            id: select.dataset.jobStatus,
            status: select.value
        });
        await refresh();
        if (tab === "pipeline") renderPipeline();
        toast("机会进度已更新");
    });
});
$("#manual-add").onclick = () => manual();
$("#backup").onclick = e => busy(e.currentTarget, backup);
$("#restore").onclick = () => $("#backup-file").click();
$("#manual-form").onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const editing = Boolean(editingJob && savedJob(editingJob));
    const job = editingJob ? {
        ...editingJob
    } : {
        source: "manual"
    };
    for (const k of ["title", "company", "salary", "city", "address", "url", "description"]) job[k] = String(f.get(k) || "").trim();
    if (job.url && !safeUrl(job.url)) {
        $("#manual-error").textContent = "请使用 http 或 https 招聘链接。";
        $("#manual-error").hidden = false;
        return;
    }
    busy(e.submitter, async () => {
        const data = await api("/api/career/upsert", {
            job, mode: editing ? "edit" : "refresh"
        });
        await refresh();
        $("#manual-dialog").close();
        render();
        openJob(data.job);
        toast(editing ? "本机岗位资料已更新" : "岗位已保存，可开始匹配分析");
        editingJob = null;
    });
};
$("#backup-file").onchange = async e => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    await busy(null, async () => {
        if (file.size > 64 * 1024 * 1024) throw new Error("备份文件不得超过64MB；其中PDF留档最多40MB。");
        const backup = JSON.parse(await file.text());
        if (!await confirmAction("导入求职备份？", "导入会替换当前机会、日程、筛选方案和投递留档。请先导出当前备份；旧版备份没有的新字段将被清空。简历编辑区仍单独管理，投递快照随求职备份恢复。")) return;
        await api("/api/career/import", {
            backup
        });
        await refresh();
        trackingDrafts.clear(); contactDrafts.clear(); targetChoices.clear(); preferenceDraft = null;
        renderedJobKey = "";
        $("#job-dialog").close();
        persistSession();
        navigate("pipeline");
        toast("求职备份已导入");
    });
};
document.addEventListener("input", e => {
    if (e.target.closest("#job-dialog")) captureJobDraft();
    if (e.target.closest("#preferences-form, #search-form, #pipeline-filter")) captureViewDraft();
});
document.addEventListener("change", e => {
    if (e.target.closest("#preferences-form, #search-form")) captureViewDraft();
});
$("#job-dialog").addEventListener("cancel", captureJobDraft);
window.addEventListener("beforeunload", e => {
    captureJobDraft();
    captureViewDraft();
    if (trackingDrafts.size || preferenceDraft) {
        e.preventDefault();
        e.returnValue = "";
    }
});
async function boot() {
    const loaded = await Promise.allSettled([api("/api/career/state"), api("/api/state"), api("/api/boss/status")]);
    if (loaded[0].status === "fulfilled") {
        career = loaded[0].value;
        career.jobs = list(career.jobs).map(normalizeJob);
    } else throw loaded[0].reason;
    if (loaded[1].status === "fulfilled") resumes = loaded[1].value;
    else error("简历数据暂时不可用：" + loaded[1].reason.message);
    if (loaded[2].status === "fulfilled") connection = loaded[2].value;
    else connection = {
        available: false,
        message: loaded[2].reason.message
    };
    navigate(tab);
    const requestedJob = new URLSearchParams(location.search).get("job");
    const saved = career.jobs.find(j => j.id === requestedJob);
    if (saved) openJob(saved);
}
boot().catch(e => {
    error(e.message);
    $("#content").innerHTML = empty("本机服务暂时不可用", "请确认工作台已启动，再刷新此页面。");
});

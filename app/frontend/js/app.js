"use strict";

let state;
// Migrate legacy drafts without embedding a personal identifier in public code.
for (const [suffix, target] of [["-resume-active", "offer-workbench-active"], ["-resume-draft-v1", "offer-workbench-draft-v1"]]) {
  const old = Object.keys(localStorage).find(key => key.endsWith(suffix));
  if (old && !localStorage.getItem(target)) {
    localStorage.setItem(target, localStorage.getItem(old));
    localStorage.removeItem(old);
  }
}
let activeId = new URLSearchParams(location.search).get("version") || localStorage.getItem("offer-workbench-active") || "saas";
let commonView = false;
let editSequence = 0;
let savedSequence = 0;
let savingPromise = null;
let saveTimer;
let previewTimer;
let previewSequence = 0;
let previewDocument;
let recoveryDraft;
let recoveryPending = false;
let recoveryBackupDownloaded = false;
const draftOwner = crypto.randomUUID();
const pdfEngine = import("/pdf.mjs").then(engine => {
  engine.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
  return engine;
});
const draftKey = "offer-workbench-draft-v1";
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[c]));
const pathValue = (path) => path.reduce((value, key) => value[key], state);
const attrPath = (path) => escapeHtml(JSON.stringify(path));

function activeVersion() {
  return state.versions.find(v => v.id === activeId) || state.versions[0];
}

function syncActiveVersion() {
  localStorage.setItem("offer-workbench-active", activeId);
  const url = new URL(location.href);
  if (url.searchParams.get("version") !== activeId) {
    url.searchParams.set("version", activeId);
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
}

function lockEditor(locked) {
  $(".sidebar").inert = locked;
  $(".toolbar-actions").inert = locked;
  $("#editor").inert = locked;
}

function readyToEdit() {
  if (!state || recoveryPending) {
    toast(recoveryPending ? "请先处理未保存草稿，再进行编辑、导入或导出。" : "简历仍在读取，请稍候。");
    return false;
  }
  return true;
}

function recoveryIsStale() {
  return recoveryDraft?.state?.revision !== state.revision;
}

function showRecovery() {
  recoveryPending = true;
  recoveryBackupDownloaded = false;
  const stale = recoveryIsStale();
  $("#recovery-message").textContent = stale
    ? `草稿基于版本 ${recoveryDraft.state.revision ?? "未知"}，本机已更新到版本 ${state.revision}。为保护新内容，请先下载完整草稿备份；随后可明确选择导入替换，或使用本机内容。`
    : "发现尚未保存的草稿。请恢复编辑，或下载备份后选择使用本机内容。";
  $("#recover-draft").textContent = stale ? "先下载草稿再导入" : "恢复编辑";
  $("#recover-draft").disabled = stale;
  $("#recovery").hidden = false;
  lockEditor(true);
  saveStatus("待处理未保存草稿");
}

function finishRecovery() {
  recoveryPending = false;
  $("#recovery").hidden = true;
  lockEditor(false);
}

function discardRecoveredDraft() {
  try {
    const stored = localStorage.getItem(draftKey);
    // A second window may have written a different draft while this banner was open.
    if (stored && JSON.stringify(JSON.parse(stored)) === JSON.stringify(recoveryDraft)) {
      localStorage.removeItem(draftKey);
    }
  } catch {
    // An inaccessible or newly corrupted draft must not prevent using the saved state.
  }
}

function errorMessage(message) {
  $("#error").textContent = message;
  $("#error").hidden = !message;
}

function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { $("#toast").hidden = true; }, 3000);
}

function saveStatus(text, error = false) {
  $("#save-status").textContent = text;
  $("#save-status").classList.toggle("error", error);
  $("#retry-save").hidden = !error;
}

async function request(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "请求失败，请重试。");
  }
  return response;
}

function storeDraft() {
  try {
    localStorage.setItem(draftKey, JSON.stringify({state, time: Date.now(), owner: draftOwner, sequence: editSequence}));
  } catch {
    errorMessage("浏览器临时恢复空间不足。请确认本机保存成功，或点击下载备份。");
  }
}

function changed() {
  editSequence += 1;
  storeDraft();
  saveStatus("待保存…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 600);
  clearTimeout(previewTimer);
  // Invalidate an earlier request as soon as text changes.
  previewSequence += 1;
  $("#page-meta").textContent = "等待更新";
  previewTimer = setTimeout(refreshPreview, 950);
}

async function save() {
  if (!readyToEdit()) return false;
  clearTimeout(saveTimer);
  if (savingPromise) return savingPromise;
  savingPromise = (async () => {
    while (savedSequence < editSequence) {
      const sequence = editSequence;
      const snapshot = structuredClone(state);
      saveStatus("正在保存…");
      try {
        const response = await request("/api/save", {state: snapshot, revision: state.revision});
        const result = await response.json();
        state.revision = result.revision;
        state.savedAt = result.savedAt;
        savedSequence = sequence;
        errorMessage("");
        if (savedSequence === editSequence) {
          const stored = JSON.parse(localStorage.getItem(draftKey) || "null");
          if (stored?.owner === draftOwner && stored.sequence === sequence && stored.state.revision === snapshot.revision) localStorage.removeItem(draftKey);
        } else {
          storeDraft();
        }
      } catch (error) {
        saveStatus("保存失败", true);
        errorMessage(error.message + " 当前编辑仍保留在页面，可下载备份。");
        return false;
      }
    }
    saveStatus("已保存到本机");
    return true;
  })();
  try { return await savingPromise; }
  finally { savingPromise = null; }
}

function field(label, path, options = {}) {
  const value = pathValue(path);
  const className = options.className || "";
  const input = options.multiline
    ? `<textarea data-path="${attrPath(path)}" rows="${options.rows || 3}">${escapeHtml(value)}</textarea>`
    : `<input class="${className}" data-path="${attrPath(path)}" value="${escapeHtml(value)}">`;
  return `<label class="field">${escapeHtml(label)}${input}</label>`;
}

function check(label, path) {
  return `<label class="check"><input type="checkbox" data-path="${attrPath(path)}" ${pathValue(path) ? "checked" : ""}>${escapeHtml(label)}</label>`;
}

function actionButton(action, label, path, extra = "") {
  return `<button type="button" class="small-button ${action === "remove" ? "danger" : ""}" data-action="${action}" data-list="${attrPath(path)}" ${extra}>${label}</button>`;
}

function bulletEditors(path) {
  return pathValue(path).map((item, i) => `
    <div class="bullet-editor">
      <div class="bullet-label">
        <label class="bullet-topic">描述主题<input aria-label="描述主题" data-path="${attrPath([...path, i, "label"])}" value="${escapeHtml(item.label)}" placeholder="描述主题"></label>
        ${actionButton("move", "↑", path, `data-index="${i}" data-step="-1" aria-label="上移描述" ${i === 0 ? "disabled" : ""}`)}
        ${actionButton("move", "↓", path, `data-index="${i}" data-step="1" aria-label="下移描述" ${i === pathValue(path).length - 1 ? "disabled" : ""}`)}
        ${actionButton("remove", "删除", path, `data-index="${i}"`)}
      </div>
      <label class="bullet-body">详情描述<textarea aria-label="${escapeHtml(item.label || "描述正文")}" data-path="${attrPath([...path, i, "text"])}" rows="3">${escapeHtml(item.text)}</textarea></label>
    </div>`).join("") + `<button class="add-button" data-action="add-bullet" data-list="${attrPath(path)}">＋ 添加描述</button>`;
}

function entryEditors(path, education = false) {
  return pathValue(path).map((entry, i) => `
    <div class="entry">
      <div class="entry-actions">
        ${actionButton("move", "上移", path, `data-index="${i}" data-step="-1" ${i === 0 ? "disabled" : ""}`)}
        ${actionButton("move", "下移", path, `data-index="${i}" data-step="1" ${i === pathValue(path).length - 1 ? "disabled" : ""}`)}
        ${actionButton("remove", "删除经历", path, `data-index="${i}"`)}
      </div>
      ${education ? `<div class="education-fields">${field("学校／学院", [...path, i, "heading"], {className: "entry-heading"})}${field("专业／学历", [...path, i, "detail"])}</div>` : field("公司／部门／岗位／任职类型", [...path, i, "heading"], {className: "entry-heading"})}
      ${field("起止时间", [...path, i, "date"])}
      ${bulletEditors([...path, i, "bullets"])}
    </div>`).join("");
}

function titleField(path) {
  return `<label class="section-title-label">栏目名称<input aria-label="栏目名称" class="section-title-input" data-path="${attrPath(path)}" value="${escapeHtml(pathValue(path))}"></label>`;
}

function renderNav() {
  $("#common-nav").classList.toggle("active", commonView);
  const query=($("#version-search")?.value||"").toLowerCase(),filter=$("#version-filter")?.value||"active";
  const shown=state.versions.filter(v=>v.name.toLowerCase().includes(query)&&(filter==="all"||filter==="archived"?filter==="all"||v.archived:!v.archived&&(filter==="active"||(v.kind||(v.tailoredFor?"job":"master"))===filter)));
  $("#versions").innerHTML = shown.map(v => `<button class="nav-item version ${!commonView && v.id === activeId ? "active" : ""}" title="${escapeHtml(v.name)}" data-id="${escapeHtml(v.id)}">${escapeHtml(v.name)}</button>`).join("");
}

function renderEditor() {
  const version = activeVersion();
  activeId = version.id;
  syncActiveVersion();
  renderNav();
  $("#page-title").textContent = commonView ? "个人资料与教育经历" : version.name;
  if (commonView) {
    $("#editor").innerHTML = `
      <p class="section-note">这里的修改会同步到所有方向的简历。</p>
      <div class="card">
        <div class="card-header"><h2>简历顶部</h2></div>
        <div class="photo-row">
          <img src="${escapeHtml(state.profile.photo)}" alt="简历证件照" id="portrait" ${state.profile.photo ? "" : "hidden"}>
          <div><div class="photo-buttons"><button class="secondary" id="photo-button">更换照片</button><button class="secondary" id="crop-photo" ${state.profile.photo ? "" : "disabled"}>裁剪当前照片</button></div><p>JPG / PNG · 一寸比例 25:35 · 本机裁剪</p>${check("在 PDF 中显示照片", ["profile", "showPhoto"])}</div>
        </div>
        <input type="file" accept="image/jpeg,image/png" id="photo-file" hidden>
        <div class="row">${field("姓名", ["profile", "name"])}${field("英文名", ["profile", "englishName"])}</div>
        <div class="row">${field("手机号", ["profile", "phone"])}${field("邮箱", ["profile", "email"])}</div>
        <div class="row">${field("出生年月", ["profile", "birth"])}${field("性别", ["profile", "gender"])}</div>
        ${field("所在城市", ["profile", "location"])}${check("在 PDF 中显示所在城市", ["profile", "showLocation"])}
        <p class="hint">可清空暂时不需要展示的信息。</p>
      </div>
      <div class="card"><div class="card-header">${titleField(["educationTitle"])}</div>
        ${entryEditors(["education"], true)}
        <button class="add-button" data-action="add-education">＋ 添加教育经历</button>
      </div>`;
    $("#photo-button").onclick = () => $("#photo-file").click();
    $("#photo-file").onchange = changePhoto;
    $("#crop-photo").onclick = async () => {
      if (!readyToEdit() || !state.profile.photo) return;
      try { await cropPhoto(await (await fetch(state.profile.photo)).blob()); }
      catch (error) { errorMessage(error.message); }
    };
  } else {
    const index = state.versions.indexOf(version);
    const path = ["versions", index];
    $("#editor").innerHTML = `
      <div class="card">
        <div class="card-header"><h2>版本设置</h2><div class="version-actions"><button class="muted-button" id="duplicate">复制版本</button><button class="muted-button" id="delete-version">删除版本</button></div></div>
        ${field("版本名称（用于管理及文件名）", [...path, "name"])}
        ${field("求职方向", [...path, "target"])}
        <div class="layout-settings"><label>用途<select data-path="${attrPath([...path,"kind"])}"><option value="master" ${(version.kind||(version.tailoredFor?'job':'master'))==='master'?'selected':''}>方向母版</option><option value="job" ${(version.kind||(version.tailoredFor?'job':'master'))==='job'?'selected':''}>岗位草稿</option></select></label>${check("归档此版本（不出现在默认列表和批量导出中）",[...path,"archived"])}</div>
        <button type="button" id="open-assistant" class="secondary">保存并用素材与AI准备</button>
        ${check("在 PDF 顶部显示求职方向", [...path, "showTarget"])}
        <div class="layout-settings">
          <label>正文字号 <select data-path="${attrPath([...path, "fontSize"])}" data-number="true">${[9,9.5,10,10.5,11,11.5,12].map(n => `<option value="${n}" ${n === version.fontSize ? "selected" : ""}>${n} pt</option>`).join("")}</select></label>
          <label>最低可读字号<select data-path="${attrPath([...path,"minFontSize"])}" data-number="true">${[9,9.5,10,10.5,11,11.5,12].map(n=>`<option value="${n}" ${(version.minFontSize||9)===n?'selected':''}>${n} pt</option>`).join('')}</select></label>
          ${check("自动适配一页", [...path, "autoFit"])}
        </div>
        <p class="hint">最低字号由你决定，不会小于9pt；达到下限仍放不下时完整分页，不截断内容。</p>
      </div>
      <div class="card"><div class="card-header">${titleField([...path, "summaryTitle"])}</div>${bulletEditors([...path, "summary"])}</div>
      <div class="card"><div class="card-header">${titleField([...path, "workTitle"])}</div>${entryEditors([...path, "experience"])}<button class="add-button" data-action="add-experience" data-list="${attrPath([...path, "experience"])}">＋ 添加工作／项目经历</button></div>`;
    $("#open-assistant").onclick = async () => { if(!await save())return;location.href='/career?assistVersion='+encodeURIComponent(activeId)+'#materials'; };
    $("#duplicate").onclick = duplicateVersion;
    $("#delete-version").onclick = deleteVersion;
  }
  document.querySelectorAll("textarea").forEach(autoHeight);
}

function autoHeight(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = Math.max(75, textarea.scrollHeight + 2) + "px";
}

async function refreshPreview() {
  const sequence = ++previewSequence;
  const version = activeVersion();
  $("#page-meta").textContent = "正在排版…";
  $("#preview-version").textContent = version.name;
  try {
    const response = await request("/api/pdf", {state, id: version.id});
    const blob = await response.blob();
    if (sequence !== previewSequence) return;
    const engine = await pdfEngine;
    const document = await engine.getDocument({data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false}).promise;
    const container = window.document.createElement("div");
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({scale: 2});
      const canvas = window.document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.setAttribute("aria-label", "简历第 " + pageNumber + " 页");
      await page.render({canvasContext: canvas.getContext("2d"), viewport}).promise;
      container.append(canvas);
    }
    if (sequence !== previewSequence) { await document.destroy(); return; }
    $("#pdf-preview").replaceChildren(container);
    if (previewDocument) await previewDocument.destroy();
    previewDocument = document;
    const pages = Number(response.headers.get("X-Resume-Pages"));
    const font = response.headers.get("X-Resume-Font");
    $("#page-meta").textContent = `${pages} 页 · ${font} pt`;
    $("#overflow-warning").hidden = pages <= 1;
  } catch (error) {
    if (sequence !== previewSequence) return;
    $("#page-meta").textContent = "预览失败";
    errorMessage(error.message);
  }
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function safeName(text) { return text.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-"); }

function ask(title, message, value = null) {
  const dialog = $("#confirm-dialog");
  $("#dialog-title").textContent = title;
  $("#dialog-message").textContent = message;
  $("#dialog-input-label").hidden = value === null;
  $("#dialog-input").value = value || "";
  dialog.returnValue = "cancel";
  return new Promise(resolve => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "accept" ? (value === null ? true : $("#dialog-input").value) : null), {once: true});
    dialog.showModal();
    if (value !== null) { $("#dialog-input").focus(); $("#dialog-input").select(); }
  });
}

async function downloadPdf(all = false) {
  if (!readyToEdit()) return;
  const button = all ? $("#export-all") : $("#download");
  button.disabled = true;
  try {
    if (!(await save())) throw new Error("请先解决保存冲突，再导出。当前编辑仍保留在页面。");
    const snapshot = structuredClone(state);
    const version = activeVersion();
    const response = await request(all ? "/api/export-all" : "/api/export-pdf", {state: snapshot, id: version.id});
    const result = await response.json();
    toast((all ? "全部 PDF 与 ZIP 已保存至：" : "PDF 已保存至：") + result.directory);
  } catch (error) { errorMessage(error.message); }
  finally { button.disabled = false; }
}

async function duplicateVersion() {
  if (!readyToEdit()) return;
  if (state.versions.length >= 500) return toast("最多保留 500 份简历。请先备份并整理不再使用的版本。");
  const source = activeVersion();
  const name = await ask("复制简历版本", "可以用目标公司命名，例如《腾讯-CSIG-AI产品经理-姓名-1年经验-25K》", source.name + " · 副本");
  if (name === null || !name.trim()) return;
  const copy = structuredClone(source);
  copy.id = crypto.randomUUID();
  copy.name = name.trim();
  delete copy.tailoredFor;
  delete copy.sourceVersionId;
  copy.kind="master";copy.archived=false;
  state.versions.push(copy);
  activeId = copy.id;
  commonView = false;
  localStorage.setItem("offer-workbench-active", activeId);
  changed();
  renderEditor();
}

async function deleteVersion() {
  if (!readyToEdit()) return;
  if (state.versions.length === 1) return toast("请至少保留一份简历");
  if (!(await ask("删除简历版本", "删除「" + activeVersion().name + "」？历史恢复副本仍保存在本机。"))) return;
  state.versions = state.versions.filter(v => v.id !== activeId);
  activeId = state.versions[0].id;
  changed();
  renderEditor();
}

async function changePhoto(event) {
  if (!readyToEdit()) return;
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 15_000_000) throw new Error("请选择小于 15 MB 的 JPG 或 PNG 照片。");
    await cropPhoto(file);
  } catch (error) { errorMessage(error.message); }
  finally { event.target.value = ""; }
}

async function cropPhoto(source) {
  try {
    const photo = await PhotoCrop.open(source);
    if (!photo || !readyToEdit()) return;
    state.profile.photo = photo;
    changed();
    renderEditor();
  } catch (error) { errorMessage(error.message); }
}

$("#editor").addEventListener("input", event => {
  if (!readyToEdit()) return;
  const input = event.target;
  if (!input.dataset.path) return;
  const path = JSON.parse(input.dataset.path);
  const parent = pathValue(path.slice(0, -1));
  const key = path.at(-1);
  parent[key] = input.type === "checkbox" ? input.checked : input.dataset.number ? Number(input.value) : input.value;
  if (key === "fontSize" && parent.minFontSize>parent.fontSize) parent.minFontSize=parent.fontSize;
  if (key === "minFontSize" && parent.fontSize<parent.minFontSize) parent.fontSize=parent.minFontSize;
  if (["fontSize","minFontSize","archived","kind"].includes(key)) renderEditor();
  if (input.tagName === "TEXTAREA") autoHeight(input);
  if (key === "name" && path[0] === "versions") {
    renderNav();
    $("#page-title").textContent = activeVersion().name;
  }
  changed();
});

$("#editor").addEventListener("click", async event => {
  if (!readyToEdit()) return;
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const path = button.dataset.list ? JSON.parse(button.dataset.list) : [];
  const list = path.length ? pathValue(path) : null;
  const index = Number(button.dataset.index);
  if (action === "remove") {
    if (!(await ask("删除内容", "确认删除这一条内容？"))) return;
    list.splice(index, 1);
  }
  if (action === "move") {
    const next = index + Number(button.dataset.step);
    if (next < 0 || next >= list.length) return;
    [list[index], list[next]] = [list[next], list[index]];
  }
  if (action === "add-bullet") list.push({label: "", text: ""});
  if (action === "add-experience") list.push({heading: "新的工作／项目经历", date: "", bullets: [{label: "", text: ""}]});
  if (action === "add-education") state.education.push({heading: "学校名称", detail: "", date: "", bullets: []});
  changed();
  renderEditor();
});

$("#versions").onclick = event => {
  if (!readyToEdit()) return;
  const button = event.target.closest("[data-id]");
  if (!button) return;
  activeId = button.dataset.id;
  commonView = false;
  localStorage.setItem("offer-workbench-active", activeId);
  renderEditor();
  $(".editor-pane").scrollTop = 0;
  clearTimeout(previewTimer);
  refreshPreview();
};
$("#common-nav").onclick = () => { if (!readyToEdit()) return; commonView = true; renderEditor(); $(".editor-pane").scrollTop = 0; };
$("#toggle-preview").onclick = () => {
  if (!readyToEdit()) return;
  const previewOnly = document.body.classList.toggle("preview-only");
  $("#toggle-preview").textContent = previewOnly ? "继续编辑" : "查看预览";
};
$("#duplicate-nav").onclick = duplicateVersion;
$("#download").onclick = () => downloadPdf();
$("#export-all").onclick = () => downloadPdf(true);
$("#retry-save").onclick = save;
$("#backup").onclick = () => {
  if (!readyToEdit()) return;
  downloadBlob(new Blob([JSON.stringify(state, null, 2)], {type: "application/json"}), "简历工作台备份-" + new Date().toISOString().slice(0, 10) + ".json");
};
$("#import").onclick = () => { if (readyToEdit()) $("#import-file").click(); };
$("#import-file").onchange = async event => {
  if (!readyToEdit()) { event.target.value = ""; return; }
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 8_000_000) throw new Error("备份文件过大。");
    const imported = JSON.parse(await file.text());
    if (imported.schemaVersion !== 1 || !Array.isArray(imported.versions) || !imported.versions.length) throw new Error("请选择本工作台的 JSON 备份。");
    // Validate through rendering before changing the user's working copy.
    await request("/api/pdf", {state: imported, id: imported.versions[0].id});
    if (!(await ask("导入备份", "导入将替换当前全部简历及共用资料。当前版本会保留在本机历史文件中。继续？"))) return;
    if (!(await save())) throw new Error("请先解决当前保存问题，再导入备份。");
    imported.revision = state.revision;
    state = imported;
    activeId = state.versions[0].id;
    commonView = false;
    changed();
    renderEditor();
    if (await save()) toast("备份已导入");
  } catch (error) { errorMessage(error.message); }
  finally { event.target.value = ""; }
};
$("#download-draft").onclick = () => {
  if (!recoveryPending || !recoveryDraft?.state) return;
  downloadBlob(new Blob([JSON.stringify(recoveryDraft.state, null, 2)], {type: "application/json"}), "未保存简历草稿-" + new Date().toISOString().slice(0, 10) + ".json");
  recoveryBackupDownloaded = true;
  $("#recover-draft").disabled = false;
  if (recoveryIsStale()) $("#recover-draft").textContent = "导入这份草稿…";
  toast("已发起完整草稿下载，请确认浏览器已保存文件。姓名、照片和教育信息也包含在内。");
};
$("#recover-draft").onclick = async () => {
  if (!recoveryPending || !recoveryDraft?.state) return;
  if (recoveryIsStale()) {
    if (!recoveryBackupDownloaded) return toast("请先下载完整草稿备份，再选择导入。");
    if (!(await ask("用草稿完整替换本机内容？", "请确认草稿备份已下载。此操作将替换姓名、照片、教育信息及全部简历，不会合并另一个窗口的新修改。本机当前内容将保留历史副本，并同时下载一份备份。"))) return;
    downloadBlob(new Blob([JSON.stringify(state, null, 2)], {type: "application/json"}), "恢复前简历备份-" + new Date().toISOString().slice(0, 10) + ".json");
  }
  // Validate the complete snapshot before replacing any in-memory content.
  try {
    await request("/api/pdf", {state: recoveryDraft.state, id: recoveryDraft.state.versions[0].id});
  } catch (error) {
    return errorMessage("草稿未通过校验，请先下载保留，再使用本机内容。" + error.message);
  }
  const revision = state.revision;
  state = structuredClone(recoveryDraft.state);
  state.revision = revision;
  activeId = state.versions.some(v => v.id === activeId) ? activeId : state.versions[0].id;
  finishRecovery();
  changed();
  renderEditor();
};
$("#discard-draft").onclick = async () => {
  if (!recoveryPending) return;
  if (!recoveryBackupDownloaded && !(await ask("放弃这份未保存草稿？", "尚未下载草稿备份。继续将使用本机内容并放弃这份草稿；需要保留时，请取消并先下载草稿。"))) return;
  discardRecoveredDraft();
  finishRecovery();
  saveStatus("已保存到本机");
};
window.addEventListener("beforeunload", event => {
  if (editSequence !== savedSequence) {
    event.preventDefault();
    event.returnValue = "";
  }
});

async function start() {
  try {
    const returnJob = new URL(location.href).searchParams.get("returnJob");
    if (returnJob) {
      $("#career-link").href = "/career?job=" + encodeURIComponent(returnJob) + "#pipeline";
      $("#career-link").title = "返回当前机会";
    }
    const response = await fetch("/api/state");
    if (!response.ok) throw new Error("本地服务读取失败，请重新打开工作台。");
    state = await response.json();
    const config = await (await fetch("/api/config")).json();
    if($("#export-destination")) $("#export-destination").textContent = config.exportDir;
    activeId = state.versions.some(v => v.id === activeId) ? activeId : state.versions[0].id;
    renderEditor();
    saveStatus("已保存到本机");
    try { recoveryDraft = JSON.parse(localStorage.getItem(draftKey) || "null"); }
    catch { recoveryDraft = null; }
    if (recoveryDraft?.state?.schemaVersion === 1) {
      showRecovery();
    } else lockEditor(false);
    refreshPreview();
  } catch (error) {
    errorMessage(error.message);
    saveStatus("读取失败", true);
  }
}
lockEditor(true);
if($("#version-search")) $("#version-search").oninput=renderNav;
if($("#version-filter")) $("#version-filter").onchange=renderNav;
start();

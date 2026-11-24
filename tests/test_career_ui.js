/* Behavior regressions for the production frontend in an isolated Node VM.
 * This small form/DOM double does not replace the real-browser acceptance pass.
 * No application data, browser, recruiting account or network is accessed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'app/frontend/js/career.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'app/frontend/career.html'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const decode = text => String(text ?? '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attr = (text, key) => decode(text.match(new RegExp('(?:^|\\s)' + key + '="([^"]*)"'))?.[1] ?? '');
const hasAttr = (text, key) => new RegExp('(?:^|\\s)' + key + '(?:\\s|=|$)').test(text);

class Element {
  constructor(document, id = '', tag = 'div') {
    this.document = document;
    this.id = id;
    this.tagName = tag.toUpperCase();
    this.dataset = {};
    this.controls = [];
    this.elements = {namedItem: name => this.controls.find(c => c.name === name)};
    this.classList = {toggle() {}, add() {}, remove() {}};
    this.hidden = false;
    this.disabled = false;
    this.open = false;
    this.value = '';
    this.textContent = '';
    this._html = '';
    this._descendants = new Set();
    this.listeners = new Map();
  }
  set innerHTML(value) {
    for (const id of this._descendants) this.document.nodes.delete(id);
    this._html = value;
    this._descendants = this.document.mount(value);
  }
  get innerHTML() { return this._html; }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  removeEventListener(type) { this.listeners.delete(type); }
  setAttribute(name, value) { this[name] = value; }
  showModal() { this.open = true; }
  close() { this.open = false; this.listeners.get('close')?.(); }
  focus() {}
  select() {}
  click() { this.onclick?.({currentTarget: this, target: this}); }
  reset() { for (const c of this.controls) { c.value = c.defaultValue; c.checked = c.defaultChecked; } }
  querySelectorAll() { return []; }
  append() {}
  remove() {}
}
class Document {
  constructor(html) {
    this.nodes = new Map();
    this.listeners = new Map();
    this.body = new Element(this, 'body', 'body');
    this.mount(html);
  }
  mount(html) {
    const ids = new Set();
    for (const m of html.matchAll(/<([\w-]+)\b([^>]*\bid="[^"]+"[^>]*)>/g)) {
      const id = attr(m[2], 'id');
      const node = new Element(this, id, m[1]);
      node.hidden = hasAttr(m[2], 'hidden');
      node.disabled = hasAttr(m[2], 'disabled');
      this.nodes.set(id, node);
      ids.add(id);
    }
    for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)) {
      const form = this.nodes.get(attr(m[1], 'id'));
      if (!form) continue;
      for (const field of m[2].matchAll(/<input\b([^>]*)>|<(select|textarea)\b([^>]*)>([\s\S]*?)<\/(?:select|textarea)>/g)) {
        const tag = field[2] || 'input', attributes = field[2] ? field[3] : field[1];
        const node = new Element(this, attr(attributes, 'id'), tag);
        node.name = attr(attributes, 'name');
        node.type = attr(attributes, 'type');
        node.disabled = hasAttr(attributes, 'disabled');
        node.checked = hasAttr(attributes, 'checked');
        if (tag === 'select') {
          const options = [...(field[4] || '').matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)];
          const option = options.find(o => hasAttr(o[1], 'selected')) || options[0];
          node.value = option ? attr(option[1], 'value') : '';
          node.selectedOptionDisabled = Boolean(option && hasAttr(option[1], 'disabled'));
        } else if (tag === 'textarea') node.value = decode(field[4]);
        else node.value = attr(attributes, 'value');
        node.defaultValue = node.value;
        node.defaultChecked = node.checked;
        form.controls.push(node);
        if (node.id) this.nodes.set(node.id, node);
      }
    }
    // A select outside a form still needs the browser's selected/default value.
    for (const m of html.matchAll(/<select\b([^>]*\bid="[^"]+"[^>]*)>([\s\S]*?)<\/select>/g)) {
      const node = this.nodes.get(attr(m[1], 'id'));
      const options = [...m[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)];
      const chosen = options.find(o => hasAttr(o[1], 'selected')) || options[0];
      node.value = chosen ? attr(chosen[1], 'value') : '';
    }
    return ids;
  }
  querySelector(selector) { return selector.startsWith('#') ? this.nodes.get(selector.slice(1)) || null : null; }
  querySelectorAll(selector) {
    if (selector === '#sections button') return ['overview', 'search', 'pipeline', 'preferences'].map(tab => ({dataset: {tab}, classList: {toggle() {}}}));
    return [];
  }
  getElementById(id) { return this.nodes.get(id) || null; }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  createElement(tag) { return new Element(this, '', tag); }
}
class FormDataDouble {
  constructor(form) { this.pairs = form.controls.filter(c => c.name && !c.disabled && !c.selectedOptionDisabled && (!['checkbox', 'radio'].includes(c.type) || c.checked)).map(c => [c.name, c.value]); }
  get(name) { return this.pairs.find(p => p[0] === name)?.[1] ?? null; }
  getAll(name) { return this.pairs.filter(p => p[0] === name).map(p => p[1]); }
}
const defaults = () => ({preferences: {cities: [], roles: [], keywords: [], salaryMin: 0, salaryMax: 0, excludedCompanies: [], preferredLocations: [], workModes: [], companyStages: [], notes: '', pace: 'passive'}, jobs: [], stats: {}});
const resumeState = () => ({versions: [{id: 'ai', name: 'AI 方向'}, {id: 'finance', name: '金融方向'}]});
const tick = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };

async function harness(savedSession) {
  const document = new Document(HTML), stored = new Map(savedSession || []), calls = [], salaryMounts = [];
  let handler = async request => {
    if (request.url === '/api/career/state') return defaults();
    if (request.url === '/api/state') return resumeState();
    if (request.url === '/api/boss/status') return {available: true, filters: {salary: {options: ['20-50K']}, scale: {options: ['100-499人']}}};
    throw new Error('Unexpected request: ' + request.url);
  };
  const location = {hash: '', pathname: '/career', search: '', assign(url) { this.assigned = url; }};
  const sessionStorage = {getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, String(value)), removeItem: key => stored.delete(key)};
  const windowListeners = new Map();
  const window = {location, addEventListener(type, listener) { windowListeners.set(type, listener); }};
  const context = vm.createContext({document, window, location, SalaryJob: require('../app/frontend/js/salary-job.js'), SalaryUI: {mount: async (host, options) => salaryMounts.push({host, options})}, history: {replaceState(_state, _title, url) { location.hash = url.includes('#') ? '#' + url.split('#')[1] : ''; }}, sessionStorage, navigator: {clipboard: {writeText: async () => {}}}, FormData: FormDataDouble, URL, URLSearchParams, Blob, console, structuredClone, setTimeout: () => 1, clearTimeout() {}, fetch: async (url, options = {}) => {
    const request = {url, options, payload: options.body ? JSON.parse(options.body) : undefined}; calls.push(request);
    const result = await handler(request);
    if (result && Object.hasOwn(result, 'ok')) return result;
    return {ok: true, json: async () => result};
  }});
  vm.runInContext(SOURCE, context, {filename: 'career.js'});
  await tick();
  return {document, calls, salaryMounts, stored, context, run: code => vm.runInContext(code, context), setHandler: fn => { handler = fn; }, emitWindow: (type, event = {}) => windowListeners.get(type)?.(event), node: id => document.nodes.get(id), set(formId, name, value) { const c = document.nodes.get(formId).elements.namedItem(name); assert.ok(c, 'Missing control ' + name); c.value = value; }, submit(formId) { const form = document.nodes.get(formId); return form.onsubmit({preventDefault() {}, target: form, submitter: new Element(document, 'submit', 'button')}); }};
}

test('salary entry preserves unsaved job tracking and never writes or searches', async () => {
  const h=await harness();
  h.run("career.jobs=[{id:'pay-job',title:'测试岗位',company:'测试公司',salary:'20–30K·14薪',city:'深圳',source:'manual',status:'saved'}]; openJob(career.jobs[0])");
  h.set('job-update-form','notes','薪资结构待确认');
  await h.run("action({dataset:{action:'salary-job'}})");
  await tick();
  assert.equal(h.run('tab'),'salary');
  assert.equal(h.node('job-dialog').open,false);
  assert.equal(h.run("trackingDrafts.get('pay-job').notes"),'薪资结构待确认');
  const prefill=clone(h.salaryMounts[0].options.prefill);
  assert.equal(prefill.monthlyGross,null);
  assert.deepEqual(prefill.salaryRange,{min:20000,max:30000});
  assert.equal(prefill.salaryMonths,14);
  assert.equal(h.calls.filter(c=>c.options.method==='POST').length,0);
  h.run("navigate('overview'); navigate('salary')");
  await tick();
  assert.equal(h.salaryMounts[1].options.prefill,null,'do not reapply the source over user edits');
});

test('unsaved preferences survive page changes and a new page VM', async () => {
  const h = await harness();
  h.run("navigate('preferences')");
  h.set('preferences-form', 'salaryMin', '25');
  h.set('preferences-form', 'notes', '保留草稿，不自动写入本机偏好');
  h.node('preferences-form').controls.find(c => c.name === 'cities' && c.value === '深圳').checked = true;
  h.run("navigate('search'); navigate('preferences')");
  assert.equal(h.node('preferences-form').elements.namedItem('salaryMin').value, '25');
  assert.equal(h.node('preferences-form').elements.namedItem('notes').value, '保留草稿，不自动写入本机偏好');
  assert.equal(h.node('preferences-dirty').hidden, false);
  assert.equal(h.calls.filter(c => c.url === '/api/career/preferences').length, 0);
  const reloaded = await harness(h.stored);
  assert.equal(reloaded.run('tab'), 'preferences');
  assert.equal(reloaded.node('preferences-form').elements.namedItem('salaryMin').value, '25');
  assert.deepEqual(clone(reloaded.run('preferenceDraft.cities')), ['深圳']);
});

test('unsubmitted search conditions survive leaving and returning without requests', async () => {
  const h = await harness();
  h.run("navigate('search')");
  h.set('search-form', 'keyword', 'LLM 产品经理');
  h.set('search-form', 'city', '广州');
  h.set('search-form', 'page', '2');
  h.set('search-form', 'salary', '20-50K');
  h.node('search-form').controls.find(c => c.name === 'scale').checked = true;
  h.run("navigate('pipeline'); navigate('search')");
  assert.equal(h.node('search-form').elements.namedItem('keyword').value, 'LLM 产品经理');
  assert.equal(h.node('search-form').elements.namedItem('city').value, '广州');
  assert.equal(h.node('search-form').elements.namedItem('page').value, '2');
  assert.equal(h.node('search-form').elements.namedItem('salary').value, '20-50K');
  assert.deepEqual(clone(h.run('searchValues.scale')), ['100-499人']);
  assert.equal(h.calls.filter(c => c.url === '/api/boss/search').length, 0);
});

test('refreshing local connection status preserves unsaved preference edits', async () => {
  const h = await harness();
  h.run("navigate('preferences')");
  h.set('preferences-form', 'salaryMin', '27');
  await h.run("action({dataset:{action:'check-connection'}})");
  assert.equal(h.node('preferences-form').elements.namedItem('salaryMin').value, '27');
  assert.equal(h.run('preferenceDraft.salaryMin'), 27);
  assert.equal(h.calls.filter(c => c.url === '/api/boss/search').length, 0);
  assert.equal(h.calls.filter(c => c.url === '/api/career/preferences').length, 0);
});

test('a delayed search result never replaces a different active page', async () => {
  const h = await harness();
  let resolveSearch;
  h.setHandler(request => {
    assert.equal(request.url, '/api/boss/search');
    return new Promise(resolve => { resolveSearch = resolve; });
  });
  h.run("navigate('search')");
  h.set('search-form', 'keyword', 'SaaS');
  const pending = h.submit('search-form');
  assert.equal(h.run('searchPending'), true);
  h.run("navigate('preferences')");
  resolveSearch({jobs: [{id: 'anonymous-job', title: 'SaaS 产品经理', company: '测试公司', source: 'boss'}], warnings: []});
  await pending;
  assert.equal(h.run('tab'), 'preferences');
  assert.ok(h.node('preferences-form'));
  assert.equal(h.node('search-form'), undefined);
  h.run("navigate('search')");
  assert.match(h.node('content').innerHTML, /SaaS 产品经理/);
  assert.match(h.run('resultInfo'), /SaaS/);
  assert.equal(h.calls.filter(c => c.url === '/api/boss/search').length, 1);
});

test('missing linked resume never silently selects or exports the first version', async () => {
  const h = await harness();
  h.run("career.jobs = [{id:'j',title:'产品经理',company:'测试公司',source:'manual',status:'saved',resumeId:'removed',resumeMissing:true}]; openJob(career.jobs[0])");
  assert.equal(h.run('selectedTarget(activeJob)'), '');
  assert.equal(h.node('target-version').value, '');
  assert.match(h.node('job-detail').innerHTML, /原关联简历已不存在/);
  await assert.rejects(h.run("action({dataset:{action:'export'}})"), /请选择.*简历|请先选择.*简历/);
  assert.equal(h.calls.filter(c => c.url === '/api/career/export').length, 0);
});

test('tailoring preserves the new target through the outgoing page unload capture', async () => {
  const h = await harness();
  h.run("career.jobs = [{id:'tailor-job',title:'产品经理',source:'manual',status:'saved',resumeId:'ai'}]; openJob(career.jobs[0])");
  assert.equal(h.node('target-version').value, 'ai');
  h.setHandler(async request => {
    assert.equal(request.url, '/api/career/tailor');
    assert.equal(request.payload.versionId, 'ai');
    return {versionId: 'tailored-copy', name: '岗位专属版本'};
  });
  await h.run("action({dataset:{action:'tailor'}})");
  // The outgoing form is still showing the base version when beforeunload fires.
  assert.equal(h.node('target-version').value, 'ai');
  h.emitWindow('beforeunload', {preventDefault() {}});
  const session = JSON.parse(h.stored.get('career-studio-session-v3'));
  assert.equal(new Map(session.targetChoices).get('tailor-job'), 'tailored-copy');
  assert.match(h.run('location.assigned'), /version=tailored-copy.*returnJob=tailor-job/);
});

test('missing resume sentinel stays in form data and an update error preserves the association', async () => {
  const h = await harness();
  h.run("career.jobs = [{id:'missing-link',title:'产品经理',source:'manual',status:'saved',resumeId:'removed',resumeMissing:true}]; openJob(career.jobs[0])");
  assert.equal(new FormDataDouble(h.node('job-update-form')).get('resumeId'), 'removed');
  h.set('job-update-form', 'notes', '待重新关联简历');
  h.setHandler(async request => {
    assert.equal(request.url, '/api/career/update');
    assert.equal(request.payload.resumeId, 'removed');
    return {ok: false, json: async () => ({error: '所选简历版本已不存在，请重新选择。'})};
  });
  h.submit('job-update-form');
  await tick();
  assert.equal(h.run('career.jobs[0].resumeId'), 'removed');
  assert.equal(new FormDataDouble(h.node('job-update-form')).get('resumeId'), 'removed');
  assert.equal(h.node('job-error').hidden, false);
  assert.match(h.node('job-error').textContent, /请重新选择/);
  assert.equal(h.calls.filter(c => c.url === '/api/career/update').length, 1);
});

test('manual editing sends edit mode and keeps explicitly cleared fields', async () => {
  const h = await harness();
  let saved;
  h.setHandler(async request => {
    if (request.url === '/api/career/upsert') { saved = request.payload.job; return {job: saved}; }
    if (request.url === '/api/career/state') return {...defaults(), jobs: [saved]};
    throw new Error('Unexpected request: ' + request.url);
  });
  h.run("career.jobs = [{id:'edit-job',source:'manual',title:'产品经理',company:'测试公司',salary:'20-30K',address:'旧地址',description:'岗位职责',status:'saved'}]; manual(career.jobs[0])");
  h.set('manual-form', 'salary', '');
  h.set('manual-form', 'address', '');
  h.submit('manual-form');
  await tick();
  const request = h.calls.find(c => c.url === '/api/career/upsert');
  assert.equal(request.payload.mode, 'edit');
  assert.equal(request.payload.job.id, 'edit-job');
  assert.equal(request.payload.job.salary, '');
  assert.equal(request.payload.job.address, '');
  assert.equal(h.node('manual-dialog').open, false);
});

test('a successful empty page has different guidance from an unsubmitted search', async () => {
  const h = await harness();
  h.setHandler(async request => { assert.equal(request.url, '/api/boss/search'); return {jobs: [], warnings: []}; });
  h.run("navigate('search')");
  assert.match(h.node('content').innerHTML, /从一个关键词开始/);
  await h.submit('search-form');
  assert.match(h.node('content').innerHTML, /本次未返回岗位/);
  assert.match(h.node('content').innerHTML, /暂不能确认是真实空页还是会话或分页异常/);
  assert.doesNotMatch(h.node('content').innerHTML, /从一个关键词开始/);
  const reloaded = await harness(h.stored);
  assert.match(reloaded.node('content').innerHTML, /本次未返回岗位/);
  assert.equal(reloaded.calls.filter(c => c.url === '/api/boss/search').length, 0);
});

test('search authentication errors keep usable recovery actions and do not retry', async () => {
  const h = await harness();
  h.setHandler(async request => {
    assert.equal(request.url, '/api/boss/search');
    return {ok: false, json: async () => ({code: 'AUTH_REQUIRED', error: '请先登录专用浏览器'})};
  });
  h.run("navigate('search')");
  await h.submit('search-form');
  assert.match(h.node('content').innerHTML, /请先登录专用浏览器/);
  assert.match(h.node('content').innerHTML, /查看排障指南/);
  assert.match(h.node('content').innerHTML, /先手动添加 JD/);
  assert.equal(h.run('searchPending'), false);
  assert.equal(h.run('searchCompleted'), false);
  assert.equal(h.calls.filter(c => c.url === '/api/boss/search').length, 1);
});


test('AI search keeps missing salary explicit without automatic detail requests', async () => {
  const h = await harness();
  h.setHandler(async request => {
    assert.equal(request.url, '/api/boss/search');
    assert.equal(request.payload.filters.keyword, 'AI产品经理');
    assert.equal(request.payload.filters.page, 1);
    return {jobs: [{id: 'ai-1', title: 'AI产品经理', source: 'boss', salary: ''}], warnings: ['本页 1/1 个岗位未返回薪资，不代表面议。']};
  });
  h.run("navigate('search')");
  h.set('search-form', 'keyword', 'AI产品经理');
  await h.submit('search-form');
  assert.match(h.node('content').innerHTML, /未读取到薪资/);
  assert.match(h.node('content').innerHTML, /不代表面议/);
  assert.equal(h.calls.filter(c => c.url.startsWith('/api/boss/') && c.url !== '/api/boss/status').length, 1);
});

test('page two is sent intact and risk failure is never rendered as empty success', async () => {
  const h = await harness();
  h.setHandler(async request => {
    assert.equal(request.payload.filters.page, 2);
    return {ok: false, json: async () => ({code: 'ENVIRONMENT_RISK', error: 'BOSS 返回环境风险，本次已停止。'})};
  });
  h.run("navigate('search')");
  h.set('search-form', 'page', '2');
  await h.submit('search-form');
  assert.match(h.node('content').innerHTML, /BOSS 返回环境风险/);
  assert.doesNotMatch(h.node('content').innerHTML, /本次未返回岗位/);
  assert.equal(h.calls.filter(c => c.url === '/api/boss/search').length, 1);
});


test('switching jobs during tailoring keeps the copy on its original job and does not navigate away', async () => {
  const h = await harness();
  h.run("career.jobs = [{id:'first',title:'First',source:'manual',status:'saved',resumeId:'ai'},{id:'second',title:'Second',source:'manual',status:'saved',resumeId:'ai'}]; openJob(career.jobs[0])");
  const state = clone(h.run('career'));
  let finish;
  h.setHandler(async request => {
    if(request.url === '/api/career/tailor') {
      assert.equal(request.payload.jobId, 'first');
      return new Promise(resolve => {finish=resolve;});
    }
    if(request.url === '/api/state') return resumeState();
    if(request.url === '/api/career/state') return state;
    throw Error('unexpected '+request.url);
  });
  const pending=h.run("action({dataset:{action:'tailor'}})");
  await tick();
  h.run('openJob(career.jobs[1])');
  finish({versionId:'first-copy'});
  await pending;
  assert.equal(h.run('activeJob.id'),'second');
  assert.equal(h.run("targetChoices.get('first')"),'first-copy');
  assert.notEqual(h.run("targetChoices.get('second')"),'first-copy');
  assert.equal(h.run('location.assigned'),undefined);
});


test('general preferences preserve recruitment, custom cities and manually entered directions across navigation', async()=>{
 const h=await harness();h.run("navigate('preferences')");
 h.set('preferences-form','recruitmentType','internship');h.set('preferences-form','citiesExtra','成都市，香港');
 h.set('preferences-form','rolesExtra','机械工程师，定制方向');h.set('preferences-form','keywordsExtra','制造业，新能源');
 h.run("navigate('search');navigate('preferences')");
 assert.equal(h.node('preferences-form').elements.namedItem('recruitmentType').value,'internship');
 assert.deepEqual(clone(h.run('preferenceDraft.cities')),['成都市','香港']);
 assert.deepEqual(clone(h.run('preferenceDraft.roles')),['机械工程师','定制方向']);
 assert.deepEqual(clone(h.run('preferenceDraft.keywords')),['制造业','新能源']);
 assert.equal(h.calls.filter(c=>c.options.method==='POST').length,0);
});

test('search retains recruitment category through navigation and does not search until submitted',async()=>{
 const h=await harness();h.run("navigate('search')");h.set('search-form','recruitmentType','campus');h.set('search-form','city','香港');
 h.run("navigate('overview');navigate('search')");
 assert.equal(h.node('search-form').elements.namedItem('recruitmentType').value,'campus');
 assert.equal(h.node('search-form').elements.namedItem('city').value,'香港');
 assert.equal(h.calls.filter(c=>c.url==='/api/boss/search').length,0);
});

test('restored multiple filters remain separate choices',async()=>{
 const h=await harness();
 const markup=h.run("searchValues={keyword:'engineer',scale:['20-99人','100-499人'],stage:['A轮','B轮']};searchExtraFields()");
 assert.ok(!markup.includes('value="20-99人,100-499人"'));
 assert.ok(!markup.includes('value="A轮,B轮"'));
 assert.ok(markup.includes('value="A轮" checked'));
});

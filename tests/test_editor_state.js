/* Anonymous state-machine regressions. Run with: node tests/test_editor_state.js */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
  .replace(/const pdfEngine = import\("\/pdf\.mjs"\)\.then\(engine => \{[\s\S]*?\n\}\);/, 'const pdfEngine = Promise.resolve({});')
  .replace(/\nstart\(\);\s*$/, '');

function fixture() {
  return {
    schemaVersion: 1, revision: 10, educationTitle: '教育经历', education: [],
    profile: {name: '示例候选人', englishName: '', phone: '', email: '', birth: '', gender: '', location: '', photo: '', showPhoto: false, showLocation: false},
    versions: [{id: 'current', name: '当前版本', target: '', showTarget: false, fontSize: 10.5,
      autoFit: true, summaryTitle: '优势', workTitle: '经历',
      summary: [{label: '能力', text: '已确认的新内容'}], experience: []}],
  };
}

function environment() {
  const elements = new Map(), storage = new Map(), listeners = new Map(), downloads = [];
  const flags = new Set();
  const body = {classList: {contains: name => flags.has(name), toggle(name) {if (flags.has(name)) {flags.delete(name);return false;} flags.add(name);return true;}}};
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      textContent: '', hidden: false, inert: false, disabled: false, innerHTML: '', value: '', style: {},
      classList: {toggle() {}}, addEventListener(type, fn) {listeners.set(selector + ':' + type, fn);},
      focus() {}, select() {}, click() {},
    });
    return elements.get(selector);
  }
  const location = {href: 'http://localhost:8766/?version=current', search: '?version=current'};
  let latest = fixture();
  const requests = [];
  const context = vm.createContext({
    console, structuredClone, URL, URLSearchParams, Blob, crypto, location,
    history: {replaceState(_state, _title, value) {location.href = new URL(value, location.href).href;location.search = new URL(location.href).search;}},
    localStorage: {getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
    window: {addEventListener() {}, document: {createElement() {return {};}}},
    document: {querySelector: element, querySelectorAll: () => [], body},
    setTimeout: () => 1, clearTimeout() {},
    fetch: async (url, options) => {
      const payload = options ? JSON.parse(options.body) : null;
      requests.push({url, payload});
      if (url === '/api/state') return {ok: true, json: async () => structuredClone(latest)};
      if (url === '/api/config') return {ok: true, json: async () => ({exportDir: '/tmp/anonymous-resume-output'})};
      if (url === '/api/save') {
        if (payload.revision !== latest.revision) return {ok: false, json: async () => ({error: '版本冲突'})};
        latest = {...payload.state, revision: latest.revision + 1, savedAt: 'test'};
        return {ok: true, json: async () => ({revision: latest.revision, savedAt: latest.savedAt})};
      }
      if (url === '/api/pdf') return {ok: true};
      throw new Error('Unexpected request: ' + url);
    },
    initial: fixture(), downloads,
  });
  vm.runInContext(source, context);
  vm.runInContext('refreshPreview = async () => {}; downloadBlob = (blob, name) => downloads.push({blob, name});', context);
  return {context, element, storage, requests, downloads, location, run: code => vm.runInContext(code, context)};
}

async function test(name, run) {
  await run();
  console.log('PASS ' + name);
}

(async () => {
  await test('pending recovery blocks duplication, import, backup and exports', async () => {
    const e = environment();
    const old = fixture(); old.revision = 3;old.profile.name = '草稿候选人';
    e.storage.set('offer-workbench-draft-v1', JSON.stringify({state: old, time: 1}));
    await e.run('start()');
    const stored = e.storage.get('offer-workbench-draft-v1');
    await e.run('duplicateVersion()');
    await e.run('downloadPdf()');
    e.element('#backup').onclick();
    let fileReads = 0;
    await e.element('#import-file').onchange({target:{value:'fixture.json', files:[{text:async()=>{fileReads += 1;return '{}';}}]}});
    assert.equal(e.run('state.versions.length'), 1);
    assert.equal(e.storage.get('offer-workbench-draft-v1'), stored);
    assert.equal(e.element('.sidebar').inert, true);
    assert.equal(e.element('.toolbar-actions').inert, true);
    assert.equal(e.element('#recover-draft').disabled, true);
    assert.equal(e.downloads.length, 0);
    assert.equal(fileReads, 0);
    assert.equal(e.requests.some(r => r.url === '/api/save' || r.url.startsWith('/api/export')), false);
  });

  await test('stale recovery requires full backup and explicit replacement confirmation', async () => {
    const e = environment(), old = fixture();old.revision = 3;old.profile.name = '草稿候选人';old.education = [{heading:'草稿学校', detail:'草稿专业', date:'', bullets:[]}];
    e.storage.set('offer-workbench-draft-v1', JSON.stringify({state: old, time: 1}));
    await e.run('start()');
    await e.element('#recover-draft').onclick();
    assert.equal(e.run('state.profile.name'), '示例候选人');
    e.element('#download-draft').onclick();
    const full = JSON.parse(await e.downloads[0].blob.text());
    assert.equal(full.profile.name, '草稿候选人');
    assert.equal(full.education[0].heading, '草稿学校');
    e.run('ask = async () => false');
    await e.element('#recover-draft').onclick();
    assert.equal(e.run('state.profile.name'), '示例候选人');
    e.run('ask = async () => true');
    await e.element('#recover-draft').onclick();
    assert.equal(e.run('state.profile.name'), '草稿候选人');
    assert.equal(e.run('state.education[0].heading'), '草稿学校');
    assert.equal(e.run('recoveryPending'), false);
    assert.equal(e.downloads.length, 2);
    assert.equal(JSON.parse(await e.downloads[1].blob.text()).profile.name, '示例候选人');
    assert.equal(await e.run('save()'), true);
  });

  await test('same-base recovery resumes edits without a replacement prompt', async () => {
    const e = environment(), draft = fixture();draft.profile.name = '未保存候选人';
    e.storage.set('offer-workbench-draft-v1', JSON.stringify({state: draft, time: 1}));
    await e.run('start()');
    assert.equal(e.element('#recover-draft').disabled, false);
    await e.element('#recover-draft').onclick();
    assert.equal(e.run('state.profile.name'), '未保存候选人');
    assert.equal(e.element('#editor').inert, false);
  });

  await test('saving one window does not remove another window draft', async () => {
    const e = environment();await e.run('start()');
    e.run("state.profile.name='自己的编辑'; changed()");
    const foreign = {state: fixture(), owner: 'another-window', sequence: 1, time: 2};
    e.storage.set('offer-workbench-draft-v1', JSON.stringify(foreign));
    assert.equal(await e.run('save()'), true);
    assert.deepEqual(JSON.parse(e.storage.get('offer-workbench-draft-v1')), foreign);
  });

  await test('a saved own draft is cleared when its sequence matches', async () => {
    const e = environment();await e.run('start()');
    e.run("state.profile.name='自己的编辑'; changed()");
    assert.equal(await e.run('save()'), true);
    assert.equal(e.storage.has('offer-workbench-draft-v1'), false);
  });

  await test('ordinary copy drops job metadata and keeps selected version in URL', async () => {
    const e = environment();await e.run('start()');
    e.run("state.versions[0].tailoredFor='manual:fixture'; state.versions[0].sourceVersionId='other'; ask=async()=> '独立副本'");
    await e.run('duplicateVersion()');
    const copied = JSON.parse(e.run('JSON.stringify(activeVersion())'));
    assert.equal(copied.name, '独立副本');
    assert.equal('tailoredFor' in copied, false);
    assert.equal('sourceVersionId' in copied, false);
    assert.equal(new URL(e.location.href).searchParams.get('version'), copied.id);
    e.element('#versions').onclick({target:{closest:()=>({dataset:{id:'current'}})}});
    assert.equal(new URL(e.location.href).searchParams.get('version'), 'current');
  });

  await test('copy limit is checked before creating unsavable state', async () => {
    const e = environment();await e.run('start()');
    e.run("state.versions = Array.from({length:30},(_,i)=>({...structuredClone(initial.versions[0]),id:'v'+i})); activeId='v0'; ask=async()=> '多余副本'");
    await e.run('duplicateVersion()');
    assert.equal(e.run('state.versions.length'), 30);
  });

  await test('job context survives version changes and links back to its opportunity', async () => {
    const e = environment();
    const jobId = 'manual:fixture/岗位';
    e.location.href = 'http://localhost:8766/?version=current&returnJob=' + encodeURIComponent(jobId);
    e.location.search = new URL(e.location.href).search;
    await e.run('start()');
    assert.equal(e.element('#career-link').href, '/career?job=' + encodeURIComponent(jobId) + '#pipeline');
    assert.equal(e.element('#career-link').title, '返回当前机会');
    e.run("ask=async()=> '另一个版本'");
    await e.run('duplicateVersion()');
    assert.equal(new URL(e.location.href).searchParams.get('returnJob'), jobId);
  });
})().catch(error => {console.error(error);process.exitCode=1;});

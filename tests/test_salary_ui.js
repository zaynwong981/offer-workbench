/* Salary scenario-state and boundary regressions, using production functions.
 * No browser, recruitment account, personal data or network is accessed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SalaryUI = require('../app/frontend/js/salary-ui.js');

const city = () => ({name: '测试城市', pension: {rate: .08, min: 5000, max: 28000}, medicalPlans: [{id: 'first', label: '一档', rate: .02, min: 6000, max: 30000}, {id: 'second', label: '二档', rate: .005, fixedBase: 10000}], unemployment: {rate: .002, min: 2500, max: 42000}, housing: {rate: .05, min: 2500, max: 45000}});
const policies = () => ({cities: {shenzhen: city(), guangzhou: city()}});
const draft = () => SalaryUI.restoreDraft(null);

test('ordinary mounts with a null prefill do not lose the saved scenario', () => {
  assert.deepEqual(SalaryUI.normalizePrefill(null), {values: {}, notices: []});
  assert.deepEqual(SalaryUI.normalizePrefill('not a job'), {values: {}, notices: []});
});

test('job ranges and unknown salaries clear the previous monthly salary instead of inventing a midpoint', () => {
  const range = SalaryUI.normalizePrefill({monthlyGross: null, salaryRange: {min: 20000, max: 30000}, sourceWarning: '自行选择区间端点'});
  assert.equal(range.values.monthlyGross, '');
  assert.deepEqual(range.values.salaryRange, {min: 20000, max: 30000});
  assert.equal(range.values.sourceWarning, '自行选择区间端点');
  for (const ambiguous of ['20–30K', '20K', '30万/年', '面议', '  ', NaN, Infinity]) {
    const parsed = SalaryUI.normalizePrefill({monthlyGross: ambiguous});
    assert.equal(parsed.values.monthlyGross, '');
    assert.ok(parsed.notices.length);
  }
});

test('explicit monthly pay and known cities can be prefilled without guessing unknown cities', () => {
  assert.deepEqual(SalaryUI.normalizePrefill({monthlyGross: 22500, salaryMonths: 14, city: '广州'}).values, {monthlyGross: '22500', salaryMonths: '14', city: 'guangzhou'});
  const unknown = SalaryUI.normalizePrefill({city: '成都', salaryMonths: 10});
  assert.equal(unknown.values.city, undefined);
  assert.equal(unknown.values.salaryMonths, undefined);
  assert.equal(unknown.notices.length, 2);
  assert.equal(SalaryUI.normalizePrefill({salaryRange: {min: 30000, max: 20000}}).values.salaryRange, undefined);
});

test('reference contributions apply each insurance boundary and the fixed medical-plan base', () => {
  const low = SalaryUI.presetContributions(city(), '1000', 'first', '5');
  assert.equal(low.pension.base, 5000);
  assert.equal(low.medical.base, 6000);
  assert.equal(low.unemployment.base, 2500);
  const high = SalaryUI.presetContributions(city(), '100000', 'second', '12');
  assert.equal(high.pension.base, 28000);
  assert.equal(high.medical.base, 10000);
  assert.equal(high.medical.rate, .005);
  assert.equal(high.housing.base, 45000);
  assert.equal(high.housing.rate, .12);
});

test('unverified policy fields cannot silently turn into zero deductions', () => {
  const missing = city(); missing.medicalPlans[0].min = null;
  assert.throws(() => SalaryUI.presetContributions(missing, '15000', 'first', '5'), /未核实/);
  missing.medicalPlans[0].min = 6000; missing.pension.rate = null;
  assert.throws(() => SalaryUI.presetContributions(missing, '15000', 'first', '5'), /未核实/);
});

test('blank and invalid scenario inputs fail rather than showing a stale or NaN result', () => {
  for (const value of ['', '-1', 'NaN', 'Infinity']) {
    const state = draft(); state.monthlyGross = value;
    assert.throws(() => SalaryUI.inputFromDraft(state, policies()), /月薪/);
  }
  const invalid = draft(); invalid.salaryMonths = '11';
  assert.throws(() => SalaryUI.inputFromDraft(invalid, policies()), /发薪月数/);
  invalid.salaryMonths = '12'; invalid.specialDeductionMonthly = '-1';
  assert.throws(() => SalaryUI.inputFromDraft(invalid, policies()), /专项附加扣除/);
});

test('manual contribution inputs survive draft restoration and override the reference preset', () => {
  const state = draft();
  state.manual = true;
  state.contributionFields = SalaryUI.fieldsFromContributions(SalaryUI.presetContributions(city(), '15000', 'first', '5'));
  state.contributionFields.pension.base = '12000';
  state.contributionFields.housing.rate = '10';
  const restored = SalaryUI.restoreDraft(JSON.parse(JSON.stringify(state)));
  const result = SalaryUI.inputFromDraft(restored, policies());
  assert.equal(result.contributions.pension.base, 12000);
  assert.equal(result.contributions.housing.rate, .1);
  assert.equal(result.monthlyGross, 15000);
});

test('housing deductions reject rates or bases beyond the supported tax-free envelope', () => {
  const state = draft(); state.manual = true;
  state.contributionFields = SalaryUI.fieldsFromContributions(SalaryUI.presetContributions(city(), '15000', 'first', '5'));
  state.contributionFields.housing.rate = '13';
  assert.throws(() => SalaryUI.inputFromDraft(state, policies()), /公积金.*比例/);
  state.contributionFields.housing.rate = '12'; state.contributionFields.housing.base = '45001';
  assert.throws(() => SalaryUI.inputFromDraft(state, policies()), /公积金基数超过/);
  state.contributionFields.housing.rate = '0'; state.contributionFields.housing.base = '15000';
  assert.equal(SalaryUI.inputFromDraft(state, policies()).contributions.housing.rate, 0);
});

test('invalid stored schemas are ignored, while incomplete numeric drafts remain incomplete for validation', () => {
  assert.equal(SalaryUI.restoreDraft({schemaVersion: 9, city: 'shenzhen', monthlyGross: '1'}).monthlyGross, '15000');
  const state = draft(); state.monthlyGross = ''; state.sourceWarning = '岗位薪资待核实';
  const restored = SalaryUI.restoreDraft(state);
  assert.equal(restored.monthlyGross, '');
  assert.equal(restored.sourceWarning, '岗位薪资待核实');
});

test('an asynchronous policy response does not mount into a detached salary page', async () => {
  let resolve;
  const context = vm.createContext({URL, Intl, fetch: () => new Promise(r => { resolve = r; }), SalaryEngine: {calculate() {}}, localStorage: {getItem() { throw new Error('detached mount must not access storage'); }}});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/frontend/js/salary-ui.js'), 'utf8'), context);
  const container = {innerHTML: '', isConnected: true};
  const pending = context.SalaryUI.mount(container);
  const initial = container.innerHTML;
  container.isConnected = false;
  resolve({ok: true, json: async () => policies()});
  await pending;
  assert.equal(container.innerHTML, initial);
  assert.equal(context.SalaryUI.capture(), null);
});


test('five city policies preserve real contribution differences and Beijing fixed fee', () => {
  const policies=JSON.parse(fs.readFileSync(path.join(__dirname,'../app/frontend/config/salary-policies.json'),'utf8'));
  assert.deepEqual(Object.keys(policies.cities),['beijing','shanghai','guangzhou','shenzhen','hangzhou']);
  const engine=require('../app/frontend/js/salary-engine.js');
  for(const [id,net] of [['beijing',145377.6],['shanghai',145410],['hangzhou',144600]]) {
    const draft=SalaryUI.restoreDraft({schemaVersion:1,city:id,monthlyGross:'15000'});
    assert.equal(engine.calculate(SalaryUI.inputFromDraft(draft,policies)).annual.net,net);
    assert.equal(SalaryUI.normalizePrefill({city:policies.cities[id].name}).values.city,id);
    const lo=SalaryUI.presetContributions(policies.cities[id],'1000','','5');
    const hi=SalaryUI.presetContributions(policies.cities[id],'100000','','5');
    assert.equal(lo.pension.base,policies.cities[id].pension.min);
    assert.equal(hi.housing.base,policies.cities[id].housing.max);
  }
  const sh=SalaryUI.restoreDraft({schemaVersion:1,city:'shanghai',monthlyGross:'50000',housingRate:'7',supplementalHousingRate:'5'});
  const result=engine.calculate(SalaryUI.inputFromDraft(sh,policies));
  assert.equal(result.monthlyContributions.housing,2641+1887);
  sh.housingRate='12';assert.throws(()=>SalaryUI.inputFromDraft(sh,policies),/最高/);
  sh.housingRate='7';sh.supplementalHousingRate='1.5';assert.throws(()=>SalaryUI.inputFromDraft(sh,policies),/整数/);
  const bj=SalaryUI.restoreDraft({schemaVersion:1,city:'beijing',monthlyGross:'15000'});
  bj.manual=true;bj.contributionFields=SalaryUI.fieldsFromContributions(SalaryUI.presetContributions(policies.cities.beijing,'15000','','5'));
  assert.equal(SalaryUI.inputFromDraft(SalaryUI.restoreDraft(bj),policies).contributions.medical.fixedMonthly,3);
});

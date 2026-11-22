/* Local-only salary scenarios. No resume or recruiting service is accessed. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SalaryUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const STORAGE_KEY = 'career-studio-salary-v1';
  const FIELDS = ['pension', 'medical', 'unemployment', 'housing'];
  const LABELS = {pension: '养老保险', medical: '医疗保险', unemployment: '失业保险', housing: '住房公积金'};
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const money = value => new Intl.NumberFormat('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(value);
  const numeric = value => (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))) && Number.isFinite(Number(value));
  const defaults = () => ({schemaVersion: 1, city: 'shenzhen', monthlyGross: '15000', salaryMonths: '12', additionalBonus: '0', bonusMode: 'merged', specialDeductionMonthly: '0', otherDeductionMonthly: '0', housingRate: '5', medicalPlan: '', manual: false, contributionFields: {}, sourceLabel: '', sourceWarning: '', salaryRange: null});
  let current = null, activeMount = 0;

  function normalizePrefill(prefill = {}) {
    if (!prefill || typeof prefill !== 'object' || Array.isArray(prefill)) prefill = {};
    const values = {}, notices = [];
    if (prefill.monthlyGross !== undefined) {
      if (prefill.monthlyGross === null) values.monthlyGross = '';
      else if (numeric(prefill.monthlyGross) && Number(prefill.monthlyGross) >= 0 && Number(prefill.monthlyGross) <= 10000000) values.monthlyGross = String(Number(prefill.monthlyGross));
      else { values.monthlyGross = ''; notices.push('岗位薪资不是明确的税前月薪数值，请手动填写后测算。'); }
    }
    if (prefill.salaryMonths !== undefined) {
      if (numeric(prefill.salaryMonths) && Number(prefill.salaryMonths) >= 12 && Number(prefill.salaryMonths) <= 24) values.salaryMonths = String(Number(prefill.salaryMonths));
      else notices.push('发薪月数未能确认，请核对后填写。');
    }
    if (prefill.city) {
      const city = {深圳: 'shenzhen', 广州: 'guangzhou', shenzhen: 'shenzhen', guangzhou: 'guangzhou'}[prefill.city];
      if (city) values.city = city;
      else notices.push('该岗位城市暂未提供参考参数，请自行选择深圳或广州作为比较场景。');
    }
    if (typeof prefill.sourceLabel === 'string') values.sourceLabel = prefill.sourceLabel.slice(0, 300);
    if (typeof prefill.sourceWarning === 'string') values.sourceWarning = prefill.sourceWarning.slice(0, 500);
    if (prefill.salaryRange && numeric(prefill.salaryRange.min) && numeric(prefill.salaryRange.max) && Number(prefill.salaryRange.min) >= 0 && Number(prefill.salaryRange.max) <= 10000000 && Number(prefill.salaryRange.max) >= Number(prefill.salaryRange.min)) values.salaryRange = {min: Number(prefill.salaryRange.min), max: Number(prefill.salaryRange.max)};
    return {values, notices};
  }

  function restoreDraft(value) {
    const fresh = defaults();
    if (!value || value.schemaVersion !== 1 || !['shenzhen', 'guangzhou'].includes(value.city)) return fresh;
    for (const key of ['city', 'monthlyGross', 'salaryMonths', 'additionalBonus', 'bonusMode', 'specialDeductionMonthly', 'otherDeductionMonthly', 'housingRate', 'medicalPlan', 'sourceLabel', 'sourceWarning']) {
      if (typeof value[key] === 'string' && value[key].length <= 500) fresh[key] = value[key];
    }
    fresh.salaryRange = normalizePrefill({salaryRange: value.salaryRange}).values.salaryRange || null;
    fresh.manual = value.manual === true;
    if (value.contributionFields && typeof value.contributionFields === 'object') {
      for (const field of FIELDS) {
        const item = value.contributionFields[field];
        if (item && typeof item.base === 'string' && typeof item.rate === 'string') fresh.contributionFields[field] = {base: item.base.slice(0, 40), rate: item.rate.slice(0, 40)};
      }
    }
    return fresh;
  }

  function requiredNumber(value, label, minimum = 0, maximum = 10000000) {
    if (!numeric(value)) throw new Error('请填写' + label + '，使用数字且不要带单位。');
    const result = Number(value);
    if (result < minimum || result > maximum) throw new Error(label + '应在 ' + minimum + ' 至 ' + maximum + ' 之间。');
    return result;
  }

  function presetContributions(city, monthlyGross, planId, housingRate) {
    if (!city) throw new Error('暂未提供该城市的参考缴费参数。');
    const gross = requiredNumber(monthlyGross, '税前月薪');
    const housing = requiredNumber(housingRate, '公积金个人比例', 0, 12) / 100;
    const plans = Array.isArray(city.medicalPlans) ? city.medicalPlans : [];
    const medical = plans.find(p => p.id === planId) || plans[0];
    const result = {};
    for (const key of FIELDS) {
      const policy = key === 'medical' ? medical : city[key];
      if (!policy) throw new Error(LABELS[key] + '参考参数尚不完整，请按工资条手动填写。');
      const fixed = typeof policy.fixedBase === 'number' && Number.isFinite(policy.fixedBase);
      if (!fixed && (!Number.isFinite(policy.min) || !Number.isFinite(policy.max) || policy.min > policy.max)) throw new Error(LABELS[key] + '参考基数未核实，请按工资条手动填写。');
      const rate = key === 'housing' ? housing : policy.rate;
      if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error(LABELS[key] + '参考比例未核实，请按工资条手动填写。');
      result[key] = {base: fixed ? policy.fixedBase : Math.min(policy.max, Math.max(policy.min, gross)), rate};
    }
    return result;
  }

  function inputFromDraft(draft, policies) {
    const input = {
      monthlyGross: requiredNumber(draft.monthlyGross, '税前月薪'),
      salaryMonths: requiredNumber(draft.salaryMonths, '发薪月数', 12, 24),
      additionalBonus: requiredNumber(draft.additionalBonus, '额外奖金'),
      specialDeductionMonthly: requiredNumber(draft.specialDeductionMonthly, '专项附加扣除'),
      otherDeductionMonthly: requiredNumber(draft.otherDeductionMonthly, '其他税前扣除'),
      bonusMode: draft.bonusMode,
      contributions: {}
    };
    if (!['merged', 'separate'].includes(input.bonusMode)) throw new Error('请选择奖金计税方式。');
    if (draft.manual) {
      for (const key of FIELDS) {
        const item = draft.contributionFields[key] || {};
        input.contributions[key] = {
          base: requiredNumber(item.base, LABELS[key] + '缴费基数'),
          rate: requiredNumber(item.rate, LABELS[key] + '个人比例', 0, key === 'housing' ? 12 : 100) / 100
        };
      }
      const housingLimit = policies.cities[draft.city]?.housing?.max;
      if (!Number.isFinite(housingLimit)) throw new Error('公积金税前可扣除基数上限尚未核实，暂无法按手动参数测算。');
      if (input.contributions.housing.base > housingLimit) throw new Error('公积金基数超过当前参考税前上限 ' + housingLimit + ' 元，请核对工资条中的税前允许扣除部分。');
    } else input.contributions = presetContributions(policies.cities[draft.city], draft.monthlyGross, draft.medicalPlan, draft.housingRate);
    return input;
  }

  function fieldsFromContributions(contributions) {
    return Object.fromEntries(FIELDS.map(key => [key, {base: String(contributions[key].base), rate: String(Math.round(contributions[key].rate * 1000000) / 10000)}]));
  }

  function safeLink(value) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
    catch { return ''; }
  }

  function field(name, label, value, min = 0, max = 10000000, step = '0.01') {
    return `<label for="salary-${name}">${label}<input id="salary-${name}" name="${name}" type="number" min="${min}" max="${max}" step="${step}" inputmode="decimal" value="${esc(value)}"></label>`;
  }

  function renderFrame(state) {
    const {draft, policies} = state;
    const cityOptions = Object.entries(policies.cities).map(([id, city]) => `<option value="${esc(id)}" ${draft.city === id ? 'selected' : ''}>${esc(city.name)}</option>`).join('');
    state.container.innerHTML = `<section class="salary-workspace" aria-label="薪酬与税后收入计算器">
      <div class="salary-intro"><p><strong>相同税前薪酬，换一座城市会剩下多少？</strong><br>两地使用同一套个税税率，差异主要来自社保、公积金缴费。先试算，再用 Offer 或工资条中的实际参数校准。</p><span class="tag blue">仅在当前浏览器本机保存</span></div>
      <p class="salary-reference-period" id="salary-reference-period"></p>
      <div class="salary-source-note" id="salary-source-note" hidden></div><div class="salary-range-actions" id="salary-range-actions" hidden></div>
      <div class="salary-layout"><section class="panel salary-input-panel"><div class="panel-heading"><h2>设置薪酬方案</h2><button type="button" class="text-button" data-salary-action="reset">重置示例</button></div>
      <form id="salary-form" novalidate><div class="salary-form-grid">
        <label for="salary-city">缴费城市<select id="salary-city" name="city">${cityOptions}</select></label>
        ${field('monthlyGross', '税前月薪（元）', draft.monthlyGross)}
        ${field('salaryMonths', '全年发薪月数', draft.salaryMonths, 12, 24, '0.5')}
        ${field('additionalBonus', '多薪以外的额外奖金（元/年）', draft.additionalBonus)}
      </div><p class="salary-help">切换城市会重新应用该城市参考缴费参数；手动调整前请先选好城市。按全年 12 个月固定工资估算，超过 12 薪的部分与额外奖金合计，假设在 12 月发放。</p>
      <div class="salary-quick-row" aria-label="发薪月数快捷设置">${[12, 13, 14, 16].map(n => `<button type="button" data-salary-months="${n}">${n} 薪</button>`).join('')}</div>
      <label for="salary-bonusMode">额外薪酬计税方式<select name="bonusMode" id="salary-bonusMode"><option value="merged" ${draft.bonusMode === 'merged' ? 'selected' : ''}>并入工资，累计预扣（默认）</option><option value="separate" ${draft.bonusMode === 'separate' ? 'selected' : ''}>符合条件的全年一次性奖金单独计税</option></select></label>
      <p class="salary-help">“13/14 薪”不自动等于全年一次性奖金。单独计税须符合政策且本年度未使用过该方式，现行政策延续至 2027 年底。</p>
      <div class="salary-form-grid">
        ${field('specialDeductionMonthly', '专项附加扣除（元/月）', draft.specialDeductionMonthly)}
        <label for="salary-housingRate">公积金个人缴存比例（%）<input id="salary-housingRate" name="housingRate" type="number" min="0" max="12" step="0.5" value="${esc(draft.housingRate)}"></label>
      </div><p class="salary-help">专项附加扣除填写个税 App 已申报的每月合计，适用资格与分摊以实际申报为准。</p>
      <div class="salary-quick-row" aria-label="专项附加扣除快捷设置">${[0, 1500, 3000].map(n => `<button type="button" data-salary-deduction="${n}">${n.toLocaleString('zh-CN')} 元/月</button>`).join('')}</div>
      <div class="salary-form-grid"><label for="salary-medicalPlan">医保参考方案<select id="salary-medicalPlan" name="medicalPlan"></select></label><label for="salary-calculationMode">缴费参数<select id="salary-calculationMode" name="calculationMode"><option value="reference" ${!draft.manual ? 'selected' : ''}>按城市参考参数估算</option><option value="manual" ${draft.manual ? 'selected' : ''}>手动基数与个人比例</option></select></label></div>
      <details class="salary-advanced"><summary>核对社保、公积金基数与其他扣除 <span id="salary-custom-tag"></span></summary><p class="salary-help">参考方案用月薪匹配上下限；单位申报基数可能按上年平均工资等确定。手动输入请使用工资条中税前允许扣除的基数与个人比例，仅计个人扣款。公积金常规比例 5%–12%，填 0% 表示不缴；超税前上限的额外扣款暂不建模。</p><div class="salary-contribution-fields">${FIELDS.map(key => `<fieldset><legend>${LABELS[key]}</legend>${field('contribution_' + key + 'Base', '税前可扣除基数（元/月）', draft.contributionFields[key]?.base || '')}${field('contribution_' + key + 'Rate', '个人比例（%）', draft.contributionFields[key]?.rate || '', 0, key === 'housing' ? 12 : 100, '0.01')}</fieldset>`).join('')}</div>${field('otherDeductionMonthly', '其他合规税前扣除（元/月）', draft.otherDeductionMonthly)}<p class="salary-help">其他扣除仅指可在税前减除的项目，不包含消费支出。工资之外的劳务报酬、年度汇算和换工作累计收入不在本次模型内。</p></details>
      <div id="salary-form-error" class="error-banner" role="alert" hidden></div><p id="salary-storage-status" class="salary-help">参数自动保存在当前浏览器；不会写入个人简历或向外发送。</p></form></section>
      <section class="salary-results" aria-label="税后测算结果"><div id="salary-result" aria-live="polite"></div></section></div>
      <div id="salary-city-comparison"></div><div id="salary-monthly"></div><div id="salary-policy"></div>
      <section class="salary-model-notes" aria-label="测算说明"><h2>测算说明与适用范围</h2><div id="salary-model-notes"></div><p class="salary-footnote">本模型面向居民雇员，假设全年 12 个月由同一雇主发放固定工资、无其他综合所得。所选参考口径应用于全年，不等同于 2026 年逐月历史税单。公司申报基数、年内调基、奖金认定及个税汇算会影响实际到手。</p></section>
    </section>`;
    state.form = state.container.querySelector('#salary-form');
    updatePlans(state);
    state.form.addEventListener('submit', event => event.preventDefault());
    state.form.addEventListener('input', event => onInput(state, event));
    state.form.addEventListener('change', event => onInput(state, event));
    state.container.addEventListener('click', state.click = event => {
      const button = event.target.closest('button');
      if (!button || !state.container.contains(button)) return;
      if (button.dataset.salaryMonths) updateField(state, 'salaryMonths', button.dataset.salaryMonths);
      else if (button.dataset.salaryDeduction !== undefined) updateField(state, 'specialDeductionMonthly', button.dataset.salaryDeduction);
      else if (button.dataset.salaryRange) {
        const value = state.draft.salaryRange?.[button.dataset.salaryRange];
        if (Number.isFinite(value)) {
          state.draft.monthlyGross = String(value); control(state, 'monthlyGross').value = String(value);
          if (!state.draft.manual) { applyReference(state); syncContributionControls(state); }
          recompute(state);
        }
      }
      else if (button.dataset.salaryAction === 'reset') {
        state.draft = defaults(); state.prefillNotices = [];
        state.container.removeEventListener('click', state.click);
        applyReference(state); renderFrame(state); recompute(state);
      }
    });
    renderPolicy(state);
  }

  function control(state, name) { return state.form.elements.namedItem(name); }
  function updateField(state, name, value) {
    state.draft[name] = value; control(state, name).value = value; recompute(state);
  }
  function applyReference(state) {
    const city = state.policies.cities[state.draft.city], plans = city?.medicalPlans || [];
    if (!plans.some(plan => plan.id === state.draft.medicalPlan)) state.draft.medicalPlan = plans[0]?.id || '';
    try {
      state.draft.contributionFields = fieldsFromContributions(presetContributions(city, state.draft.monthlyGross, state.draft.medicalPlan, state.draft.housingRate));
      state.referenceError = '';
    } catch (error) { state.referenceError = error.message; }
  }
  function updatePlans(state) {
    const plans = state.policies.cities[state.draft.city]?.medicalPlans || [];
    const selected = plans.some(plan => plan.id === state.draft.medicalPlan) ? state.draft.medicalPlan : plans[0]?.id || '';
    state.draft.medicalPlan = selected;
    control(state, 'medicalPlan').innerHTML = plans.map(plan => `<option value="${esc(plan.id)}" ${plan.id === selected ? 'selected' : ''}>${esc(plan.label)}</option>`).join('');
  }
  function syncContributionControls(state) {
    for (const key of FIELDS) {
      const item = state.draft.contributionFields[key] || {};
      control(state, 'contribution_' + key + 'Base').value = item.base ?? '';
      control(state, 'contribution_' + key + 'Rate').value = item.rate ?? '';
    }
    control(state, 'calculationMode').value = state.draft.manual ? 'manual' : 'reference';
  }
  function onInput(state, event) {
    const name = event.target.name;
    if (!name) return;
    if (name === 'calculationMode') {
      state.draft.manual = event.target.value === 'manual';
      if (state.draft.manual) state.container.querySelector('.salary-advanced').open = true;
      if (!state.draft.manual) { applyReference(state); syncContributionControls(state); }
    } else {
      const contribution = FIELDS.find(key => name === 'contribution_' + key + 'Base' || name === 'contribution_' + key + 'Rate');
      if (contribution) {
        state.draft.manual = true;
        state.draft.contributionFields[contribution] ||= {base: '', rate: ''};
        state.draft.contributionFields[contribution][name.endsWith('Base') ? 'base' : 'rate'] = event.target.value;
        control(state, 'calculationMode').value = 'manual';
        if (contribution === 'housing' && name.endsWith('Rate')) {
          state.draft.housingRate = event.target.value; control(state, 'housingRate').value = event.target.value;
        }
      } else {
        state.draft[name] = event.target.value;
        if (name === 'city') {
          state.draft.manual = false; state.draft.medicalPlan = '';
          applyReference(state); updatePlans(state); syncContributionControls(state); renderPolicy(state);
        } else if (['monthlyGross', 'medicalPlan', 'housingRate'].includes(name)) {
          if (name === 'housingRate' && state.draft.manual) {
            state.draft.contributionFields.housing ||= {base: '', rate: ''};
            state.draft.contributionFields.housing.rate = event.target.value;
            control(state, 'contribution_housingRate').value = event.target.value;
          }
          if (!state.draft.manual) { applyReference(state); syncContributionControls(state); }
        }
      }
    }
    recompute(state);
  }

  function persist(state) {
    const status = state.container.querySelector('#salary-storage-status');
    try {
      root.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.draft));
      status.textContent = '已自动保存在当前浏览器本机；不包含在“导出求职备份”中，也不会写入简历或向外发送。';
    } catch { status.textContent = '当前浏览器无法保存草稿；本次仍可计算，刷新或离开后可能丢失参数。'; }
  }
  function recompute(state) {
    if (state !== current) return;
    const monthlyDetails = state.container.querySelector('.salary-month-panel');
    if (monthlyDetails) state.monthsOpen = monthlyDetails.open;
    persist(state);
    const note = state.container.querySelector('#salary-source-note');
    const notices = [...state.prefillNotices];
    if (state.draft.sourceLabel) notices.unshift('已带入：' + state.draft.sourceLabel + '。请核对月薪、发薪月数与奖金性质。');
    if (state.draft.sourceWarning) notices.push(state.draft.sourceWarning);
    if (Number(state.draft.housingRate) === 0 && state.draft.housingRate !== '') notices.push('当前公积金个人比例为 0%，按不缴存公积金测算。');
    else if (Number(state.draft.housingRate) > 0 && Number(state.draft.housingRate) < 5) notices.push('当前公积金个人比例低于常规 5% 下限，请确认单位适用的特殊缴存安排。');
    note.hidden = notices.length === 0; note.textContent = notices.join(' ');
    const range = state.draft.salaryRange, rangeNode = state.container.querySelector('#salary-range-actions');
    rangeNode.hidden = !range;
    rangeNode.innerHTML = range ? `<span>招聘月薪范围：¥${money(range.min)} – ¥${money(range.max)}</span><button class="secondary" type="button" data-salary-range="min">用下限试算</button><button class="secondary" type="button" data-salary-range="max">用上限试算</button>` : '';
    state.container.querySelector('#salary-custom-tag').textContent = state.draft.manual ? '已手动调整' : '参考参数';
    control(state, 'medicalPlan').disabled = state.draft.manual;
    const errorNode = state.container.querySelector('#salary-form-error');
    let result, input;
    try {
      input = inputFromDraft(state.draft, state.policies);
      result = root.SalaryEngine.calculate(input);
      errorNode.hidden = true; errorNode.textContent = '';
    } catch (error) {
      errorNode.hidden = false; errorNode.textContent = error.message;
      state.container.querySelector('#salary-result').innerHTML = '<div class="panel salary-result-empty"><h2>补齐参数后查看到手收入</h2><p>当前结果已隐藏，避免把上一次的测算误认为本次结果。</p></div>';
      state.container.querySelector('#salary-city-comparison').innerHTML = '';
      state.container.querySelector('#salary-monthly').innerHTML = '';
      const notes = state.container.querySelector('#salary-model-notes');
      if (notes) notes.textContent = '';
      return;
    }
    renderResult(state, result);
    renderComparison(state, input);
    renderMonths(state, result);
  }

  function renderResult(state, result) {
    const a = result.annual, m = result.months;
    const extra = result.bonus.amount;
    const comparison = result.comparison;
    const cheaper = comparison.merged.tax < comparison.separate.tax ? '并入工资' : comparison.merged.tax > comparison.separate.tax ? '单独计税' : '两种方式';
    state.container.querySelector('#salary-result').innerHTML = `<section class="salary-net-card"><p>预计全年税后到手</p><strong>¥${money(a.net)}</strong><span>月均 ¥${money(a.monthlyAverageNet)} · 含额外薪酬</span><div class="salary-net-months"><div><small>1 月到手</small><b>¥${money(m[0].net)}</b></div><div><small>12 月到手${extra ? '（含额外薪酬）' : ''}</small><b>¥${money(m[11].net)}</b></div></div></section>
      <section class="panel salary-breakdown"><h2>税前到税后，差在哪里</h2><dl><div><dt>全年税前收入</dt><dd>¥${money(a.gross)}</dd></div><div><dt>个人社保扣款</dt><dd>− ¥${money(a.social)}</dd></div><div><dt>个人公积金缴存</dt><dd>− ¥${money(a.housing)}</dd></div><div><dt>全年个税</dt><dd>− ¥${money(a.tax)}</dd></div><div class="salary-breakdown-total"><dt>全年现金到手</dt><dd>¥${money(a.net)}</dd></div></dl><p class="salary-help">公积金计入个人账户，不计入本处现金到手。专项附加扣除用于减少应纳税所得，不会再从到手金额扣一次。</p><div class="salary-contribution-totals">${FIELDS.map(key => `<span>${LABELS[key]}<b>¥${money(result.monthlyContributions[key])}/月</b></span>`).join('')}</div></section>
      <section class="panel salary-bonus-panel"><h2>额外薪酬两种算法</h2><p class="salary-help">额外薪酬共 ¥${money(extra)}。下方单独计税结果仅在奖金符合政策时可用。</p><div class="salary-bonus-options"><div><span>并入工资 · 全年个税</span><strong>¥${money(comparison.merged.tax)}</strong></div><div><span>单独计税 · 全年个税</span><strong>¥${money(comparison.separate.tax)}</strong></div></div><p class="salary-bonus-difference">${Math.abs(comparison.merged.tax - comparison.separate.tax) < 0.005 ? '两种方式的全年个税相同。' : `${cheaper}的测算个税低 ¥${money(Math.abs(comparison.merged.tax - comparison.separate.tax))}，请先确认可选资格。`}</p></section>
      `;
    const notes = state.container.querySelector('#salary-model-notes');
    if (notes) notes.innerHTML = (result.warnings || []).map(esc).join('<br>');
  }

  function renderComparison(state, input) {
    const rows = Object.entries(state.policies.cities).map(([id, city]) => {
      try {
        const plan = id === state.draft.city ? state.draft.medicalPlan : city.medicalPlans[0]?.id;
        const contributions = presetContributions(city, state.draft.monthlyGross, plan, state.draft.housingRate);
        const calculated = root.SalaryEngine.calculate({...input, contributions});
        return `<tr><th scope="row">${esc(city.name)}<small>${esc(city.medicalPlans.find(p => p.id === plan)?.label || city.medicalPlans[0]?.label)}</small></th><td>¥${money(calculated.annual.net)}</td><td>¥${money(calculated.annual.monthlyAverageNet)}</td><td>¥${money(calculated.monthlyContributions.total)}</td><td>¥${money(calculated.annual.tax)}</td></tr>`;
      } catch (error) { return `<tr><th scope="row">${esc(city.name)}</th><td colspan="4">${esc(error.message)}</td></tr>`; }
    }).join('');
    state.container.querySelector('#salary-city-comparison').innerHTML = `<section class="panel salary-compare-panel"><div class="panel-heading"><h2>深圳与广州 · 同薪比较</h2><span class="tag blue">均为城市参考方案</span></div><p class="salary-help">沿用相同税前薪酬、扣除额、公积金比例与奖金方式；分别应用两地参考基数。当前手动基数不会用于此表，因此可能与上方结果不同。另一城市采用列表中的首个职工医保方案。</p><div class="salary-table-wrap"><table class="salary-table"><thead><tr><th>城市 / 医保</th><th>全年到手</th><th>月均到手</th><th>每月五险一金个人扣款</th><th>全年个税</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }
  function renderMonths(state, result) {
    const rows = result.months.map(m => `<tr><th scope="row">${m.month} 月</th><td>¥${money(m.gross)}</td><td>¥${money(m.contributions)}</td><td>¥${money(m.salaryTax)}</td><td>¥${money(m.bonusTax)}</td><td class="salary-table-net">¥${money(m.net)}</td></tr>`).join('');
    state.container.querySelector('#salary-monthly').innerHTML = `<details class="panel salary-month-panel"${state.monthsOpen ? ' open' : ''}><summary>查看 12 个月到手明细 <span>累计预扣后，每月个税可能不同</span></summary><div class="salary-table-wrap"><table class="salary-table"><thead><tr><th>月份</th><th>税前收入</th><th>社保公积金</th><th>工资个税</th><th>单独计税奖金税</th><th>现金到手</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
  }
  function renderPolicy(state) {
    const city = state.policies.cities[state.draft.city];
    const policyOpen = state.container.querySelector('.salary-policy-panel')?.open === true;
    state.container.querySelector('#salary-reference-period').textContent = '参考口径：' + (city.periodLabel || '适用期未核实') + ' · 资料核验 ' + (state.policies.verifiedOn || '未记录') + '。使用这组参数估算全年，不是 2026 年逐月历史税单。' + (city.status?.includes('derived') ? ' 部分缴费上限为参考折算值，高薪场景请按单位实际基数核对；详见下方政策口径。' : '');
    const sources = [...(city.sources || []), ...(state.policies.nationalSources || [])];
    const sourceList = sources.map(source => {
      const url = safeLink(source.url);
      return `<li>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)} ↗</a>` : esc(source.title)}${source.effective ? `<small>${esc(source.effective)}${source.verification === 'secondary' ? ' · 辅助来源，非政策原文' : ''}</small>` : ''}</li>`;
    }).join('');
    const componentNotes = [city.housing?.note, ...city.medicalPlans.map(plan => plan.note)].filter(Boolean);
    state.container.querySelector('#salary-policy').innerHTML = `<details class="panel salary-policy-panel"${policyOpen ? ' open' : ''}><summary>查看政策口径与来源 <span>${esc(city.name)} · ${esc(city.periodLabel || '请核对适用期')}</span></summary><p><strong>参考适用期：</strong>${esc(city.periodLabel || '未核实')}<br><strong>资料核验日期：</strong>${esc(state.policies.verifiedOn || '未记录')}</p><p>${esc(city.note || '')}</p>${componentNotes.map(note => `<p>${esc(note)}</p>`).join('')}<p class="salary-help">参考参数不是单位实际缴费承诺；如入职时间跨过政策调整日，请在高级参数中按新的基数和比例校准。</p><ul>${sourceList || '<li>暂无可用来源，请手动核对缴费参数。</li>'}</ul></details>`;
  }

  async function mount(container, options = {}) {
    const mountId = ++activeMount;
    if (current?.container && current.click) current.container.removeEventListener('click', current.click);
    current = null;
    container.innerHTML = '<div class="panel salary-loading" role="status">正在加载本机薪酬计算规则…</div>';
    try {
      const response = await root.fetch('/salary-policies.json');
      if (!response.ok) throw new Error('无法读取本机政策参数，请重新启动工作台后重试。');
      const policies = await response.json();
      if (!policies.cities?.shenzhen || !policies.cities?.guangzhou) throw new Error('本机城市参数不完整，暂时无法测算。');
      if (!root.SalaryEngine?.calculate) throw new Error('薪酬计算模块未加载，请刷新页面后重试。');
      if (mountId !== activeMount || container.isConnected === false) return;
      let saved;
      try { saved = JSON.parse(root.localStorage.getItem(STORAGE_KEY) || 'null'); } catch { saved = null; }
      const draft = restoreDraft(saved), prefill = normalizePrefill(options.prefill);
      if (options.prefill) Object.assign(draft, {monthlyGross: '', salaryMonths: '12', additionalBonus: '0', bonusMode: 'merged', sourceLabel: '', sourceWarning: '', salaryRange: null, manual: false});
      Object.assign(draft, prefill.values);
      current = {container, policies, draft, prefillNotices: prefill.notices, referenceError: ''};
      if (!draft.manual) applyReference(current);
      renderFrame(current); recompute(current);
    } catch (error) {
      if (mountId !== activeMount || container.isConnected === false) return;
      container.innerHTML = `<div class="error-banner" role="alert">${esc(error.message)}<p>你的简历与机会数据不受影响。重新进入“薪酬与个税”可重试。</p></div>`;
    }
  }

  return {mount, capture: () => current ? clone(current.draft) : null, normalizePrefill, restoreDraft, inputFromDraft, presetContributions, fieldsFromContributions};
});

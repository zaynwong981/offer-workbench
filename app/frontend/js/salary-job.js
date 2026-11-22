/* Read only explicit monthly salary notation; never turn an annual/day rate
 * or a negotiated offer into an invented monthly amount. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.SalaryJob = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    function prepare(job = {}) {
        const raw = String(job.salary || '').trim();
        const cityText = String(job.city || '').trim();
        const result = {
            monthlyGross: null, salaryMonths: 12, additionalBonus: 0, bonusMode: 'merged',
            sourceLabel: [job.company, job.title, raw || '薪资待核实'].filter(Boolean).join(' · '),
            sourceWarning: ''
        };
        if (/^(?:广东[省·\s-]*)?深圳(?:市)?(?:[·\s-].*)?$/.test(cityText)) result.city = 'shenzhen';
        else if (/^(?:广东[省·\s-]*)?广州(?:市)?(?:[·\s-].*)?$/.test(cityText)) result.city = 'guangzhou';
        else if (/^北京(?:市)?(?:[·\s-].*)?$/.test(cityText)) result.city = 'beijing';
        else if (/^上海(?:市)?(?:[·\s-].*)?$/.test(cityText)) result.city = 'shanghai';
        else if (/^(?:浙江[省·\s-]*)?杭州(?:市)?(?:[·\s-].*)?$/.test(cityText)) result.city = 'hangzhou';
        const normalized = raw.replace(/[，,]/g, '').replace(/[–—－~～〜至]/g, '-').replace(/\s/g, '');
        const match = normalized.match(/^(\d+(?:\.\d+)?)([kK千万元]?)(?:-(\d+(?:\.\d+)?)([kK千万元]?))?(?:元)?(?:\/月|每月|月薪)?(?:[·•・x×*](\d+(?:\.\d+)?)薪)?$/);
        if (!match) {
            result.sourceWarning = '未识别为明确月薪，请核实后填写税前月薪。年薪、日薪、面议不会自动换算。';
        } else {
            const unit = u => /[kK千]/.test(u) ? 1000 : u === '万' ? 10000 : 1;
            const loUnit = match[2] || match[4] || '';
            const hiUnit = match[4] || match[2] || '';
            const low = Number(match[1]) * unit(loUnit);
            const high = match[3] ? Number(match[3]) * unit(hiUnit) : low;
            // A bare “20-30” is ambiguous; a yuan amount requires an explicit unit.
            const explicit = Boolean(loUnit || /元|\/月|每月|月薪/.test(normalized));
            const months = match[5] ? Number(match[5]) : 12;
            if (!explicit || !Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high < low || high > 1e7 || months < 12 || months > 24) {
                result.sourceWarning = '薪资金额、单位或发薪月数不明确，请手动核实填写。';
            } else {
                result.salaryMonths = months;
                if (high === low) result.monthlyGross = low;
                else result.salaryRange = {min: low, max: high};
                result.sourceWarning = high === low ? '已带入招聘月薪；请核实是否为固定工资。' : '招聘薪资是范围，请选择下限或上限试算，也可自行填写协商金额。';
                if (months > 12) result.sourceWarning += ' 额外薪月暂按12月发放并入工资，不自动认定为可单独计税的年终奖。';
            }
        }
        if (!result.city) result.sourceWarning += ' 岗位城市未识别为北上广深杭，请核对计算器中选择的城市。';
        return result;
    }
    return {prepare};
});

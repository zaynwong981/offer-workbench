/* Financial calculation regressions; no browser, network or personal files. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const engine = require('../salary-engine.js');
const cents = value => Math.round(value * 100);
const input = extra => ({monthlyGross: 15000, ...extra});

test('annual tax table agrees with all official band boundaries', () => {
    const cases = [[0, 0], [36000, 1080], [144000, 11880], [300000, 43080],
        [420000, 73080], [660000, 145080], [960000, 250080], [1000000, 268080]];
    for (const [amount, tax] of cases) assert.equal(engine.annualTax(amount), tax);
    assert.equal(engine.annualTax(36000.10), 1080.01);
    assert.equal(engine.annualTax(144000.10), 11880.02);
    assert.equal(engine.annualTax(960000.10), 250080.05);
});

test('bonus uses monthly quick deduction and preserves the 36000 cliff', () => {
    assert.equal(engine.bonusTax(0), 0);
    assert.equal(engine.bonusTax(36000), 1080);
    assert.equal(engine.bonusTax(36000.01), 3390);
    assert.equal(engine.bonusTax(144000), 14190);
    assert.equal(engine.bonusTax(144000.01), 27390);
    assert.equal(engine.bonusTax(300000), 58590);
    assert.equal(engine.bonusTax(420000), 102340);
    assert.equal(engine.bonusTax(660000), 193590);
    assert.equal(engine.bonusTax(960000), 328840);
    assert.equal(engine.bonusTax(1000000), 434840);
});

test('15000 fixed salary has cumulative withholding rather than flat monthly tax', () => {
    const result = engine.calculate(input());
    assert.deepEqual(result.months.map(m => m.tax), [300, 300, 300, 580, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000]);
    assert.equal(result.annual.gross, 180000);
    assert.equal(result.annual.tax, 9480);
    assert.equal(result.annual.net, 170520);
    assert.equal(result.annual.monthlyAverageNet, 14210);
});

test('zero and salary at the 5000 deduction produce no tax', () => {
    for (const salary of [0, 1000, 5000]) {
        const result = engine.calculate(input({monthlyGross: salary}));
        assert.equal(result.annual.tax, 0);
        assert.equal(result.annual.net, salary * 12);
        assert.ok(result.months.every(m => m.tax === 0));
    }
});

test('contributions reduce cash and taxable income but special deductions only reduce tax', () => {
    const result = engine.calculate(input({
        specialDeductionMonthly: 1500, otherDeductionMonthly: 100,
        contributions: {pension: {base: 15000, rate: .08}, medical: {base: 15000, rate: .02},
            unemployment: {base: 15000, rate: .002}, housing: {base: 15000, rate: .05}}
    }));
    assert.deepEqual(result.monthlyContributions, {pension: 1200, medical: 300, unemployment: 30, housing: 750, total: 2280});
    assert.equal(result.annual.social, 18360);
    assert.equal(result.annual.housing, 9000);
    assert.equal(result.annual.tax, 4824); // (180000-60000-27360-18000-1200)*10%-2520
    assert.equal(result.annual.net, 147816);
    assert.equal(result.months.at(-1).taxableCumulative, 73440);
});

test('high deductions cannot produce negative tax or refund fictitious tax', () => {
    const result = engine.calculate(input({monthlyGross: 1000, specialDeductionMonthly: 5000,
        contributions: {housing: {base: 15000, rate: .12}}}));
    assert.equal(result.annual.tax, 0);
    assert.ok(result.months.every(m => m.tax === 0 && m.taxableCumulative === 0));
    assert.equal(result.annual.net, -9600);
    assert.ok(result.warnings.some(w => w.includes('负到手额')));
});

test('extra salary defaults to merged taxation and the two bonus outcomes are explicit', () => {
    const result = engine.calculate(input({salaryMonths: 14}));
    assert.equal(result.input.bonusMode, 'merged');
    assert.equal(result.bonus.amount, 30000);
    assert.equal(result.annual.gross, 210000);
    assert.equal(result.annual.tax, 13080);
    assert.equal(result.comparison.separate.tax, 10380);
    assert.equal(result.comparison.difference, 2700);
    assert.equal(result.bonus.tax, 3600);
    assert.ok(result.months.slice(0, 11).every(m => m.gross === 15000 && m.bonusTax === 0));
    assert.equal(result.months[11].gross, 45000);
    const separate = engine.calculate(input({salaryMonths: 14, bonusMode: 'separate'}));
    assert.equal(separate.annual.tax, 10380);
    assert.equal(separate.months[11].bonusTax, 900);
    assert.equal(separate.bonus.tax, 900);
    assert.ok(separate.warnings.some(w => w.includes('不自动符合')));
});

test('merged bonus can beat separate taxation when basic deductions remain unused', () => {
    const result = engine.calculate(input({monthlyGross: 4000, additionalBonus: 10000, bonusMode: 'separate'}));
    assert.equal(result.comparison.merged.tax, 0);
    assert.equal(result.comparison.separate.tax, 300);
    assert.equal(result.comparison.difference, -300);
});

test('fractional months and decimal contribution rates round once to integer fen', () => {
    const result = engine.calculate(input({monthlyGross: 10000.01, salaryMonths: 12.1, additionalBonus: .01,
        contributions: {pension: {base: 10000.01, rate: .08}, medical: {base: 6733, rate: .005},
            unemployment: {base: 1.005, rate: .5}, housing: {base: 10000.01, rate: .12}}}));
    assert.equal(result.bonus.amount, 1000.01);
    assert.equal(result.monthlyContributions.medical, 33.67); // exact half-fen rounds up
    assert.equal(result.input.contributions.unemployment.base, 1.01);
    assert.equal(result.monthlyContributions.unemployment, .51);
    assert.equal(result.monthlyContributions.pension, 800);
});

test('all monthly amounts reconcile with annual amounts in both tax modes', () => {
    for (const mode of ['merged', 'separate']) {
        const result = engine.calculate(input({monthlyGross: 22888.88, salaryMonths: 13.5, additionalBonus: 10001.21,
            specialDeductionMonthly: 1500, bonusMode: mode, contributions: {housing: {base: 12345.67, rate: .12}}}));
        for (const key of ['gross', 'tax', 'net', 'contributions']) {
            assert.equal(result.months.reduce((sum, m) => sum + cents(m[key]), 0), cents(result.annual[key]));
        }
        assert.equal(cents(result.annual.gross) - cents(result.annual.contributions) - cents(result.annual.tax), cents(result.annual.net));
        assert.doesNotThrow(() => JSON.stringify(result));
    }
});

test('invalid money, rates, months and tax modes fail with usable errors', () => {
    const invalid = [null, [], {}, input({monthlyGross: -1}), input({monthlyGross: NaN}), input({monthlyGross: Infinity}),
        input({monthlyGross: '15000'}), input({monthlyGross: true}), input({monthlyGross: 1e10}),
        input({salaryMonths: 11}), input({salaryMonths: 25}), input({salaryMonths: NaN}),
        input({additionalBonus: -1}), input({specialDeductionMonthly: -1}), input({otherDeductionMonthly: Infinity}),
        input({bonusMode: 'auto'}), input({contributions: null}), input({contributions: []}), input({contributions: {housing: null}}),
        input({contributions: {housing: {base: 1000, rate: .13}}}),
        input({contributions: {medical: {base: -1, rate: .02}}}),
        input({contributions: {medical: {base: 1000, rate: NaN}}})];
    for (const value of invalid) assert.throws(() => engine.calculate(value), /请|须|参数/);
});

test('calculation is pure and browser global matches the Node module API', () => {
    const source = input({contributions: {housing: {base: 10000, rate: .05}}});
    const original = structuredClone(source);
    const a = engine.calculate(source), b = engine.calculate(source);
    assert.deepEqual(source, original);
    assert.deepEqual(a, b);
    const context = vm.createContext({});
    vm.runInContext(fs.readFileSync(require.resolve('../salary-engine.js'), 'utf8'), context);
    assert.equal(context.SalaryEngine.calculate({monthlyGross: 15000}).annual.tax, 9480);
});

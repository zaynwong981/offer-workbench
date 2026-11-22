const test = require('node:test');
const assert = require('node:assert/strict');
const {prepare} = require('../salary-job.js');

test('monthly range requires a deliberate endpoint choice, preserving extra salary count', () => {
    const value = prepare({salary:'20–30K·14薪',city:'深圳',company:'匿名公司'});
    assert.equal(value.monthlyGross, null);
    assert.deepEqual(value.salaryRange, {min:20000,max:30000});
    assert.equal(value.salaryMonths,14);
    assert.equal(value.city,'shenzhen');
    assert.equal(value.bonusMode,'merged');
    assert.equal(value.additionalBonus,0);
});
test('explicit single monthly amount and decimal wan ranges are supported', () => {
    assert.equal(prepare({salary:'15,000元/月',city:'广州市'}).monthlyGross,15000);
    assert.deepEqual(prepare({salary:'2.5-3万/月'}).salaryRange,{min:25000,max:30000});
    assert.equal(prepare({salary:'20K-30K·13薪'}).salaryMonths,13);
});
test('annual, daily, negotiated and ambiguous amounts never inherit previous pay', () => {
    for (const salary of ['30-50万/年','1000元/天','面议','20-30','', '30-20K','20K·8薪','10K·30薪']) {
        const value=prepare({salary,city:'杭州'});
        assert.equal(value.monthlyGross,null,salary);
        assert.equal(value.salaryRange,undefined,salary);
        assert.equal(value.city,undefined);
        assert.match(value.sourceWarning,/核实|核对/);
    }
});

/* Resident employee salary estimate. No network, storage or personal-data access.
 * Sources checked 2026-11-18:
 * https://www.chinatax.gov.cn/n810341/n810760/c3959585/content.html
 * https://fgk.chinatax.gov.cn/zcfgk/c102416/c5211524/content.html
 * City contribution bases/rates and deduction eligibility are supplied by the UI.
 */
(function (root, factory) {
    const engine = factory();
    if (typeof module === "object" && module.exports) module.exports = engine;
    if (root) root.SalaryEngine = engine;
})(typeof globalThis === "object" ? globalThis : this, function () {
    "use strict";
    const MAX_AMOUNT = 1e9;
    const PARTS = ["pension", "medical", "unemployment", "housing"];
    const LABELS = {pension: "养老保险", medical: "医疗保险", unemployment: "失业保险", housing: "住房公积金"};
    // All monetary arithmetic below uses integer fen. Rates are integer percents.
    const BRACKETS = [
        [36000, 3, 0], [144000, 10, 2520], [300000, 20, 16920],
        [420000, 25, 31920], [660000, 30, 52920], [960000, 35, 85920],
        [Infinity, 45, 181920]
    ];
    const BONUS_QUICK = [0, 210, 1410, 2660, 4410, 7160, 15160];

    function number(value, label, minimum = 0, maximum = MAX_AMOUNT) {
        if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum)
            throw new Error(`${label}须为 ${minimum} 至 ${maximum} 之间的有效数字。`);
        return value;
    }

    // Parse the decimal representation rather than multiplying floating-point money.
    function fraction(value) {
        const [mantissa, exponent = "0"] = String(value).toLowerCase().split("e");
        const [whole, decimal = ""] = mantissa.split(".");
        const scale = decimal.length - Number(exponent);
        const numerator = BigInt(whole + decimal);
        return scale >= 0 ? [numerator, 10n ** BigInt(scale)] : [numerator * 10n ** BigInt(-scale), 1n];
    }

    function roundedRatio(numerator, denominator) {
        return Number((numerator * 2n + denominator) / (denominator * 2n));
    }

    function fen(value, label) {
        const [n, d] = fraction(number(value, label));
        return roundedRatio(n * 100n, d);
    }

    function multiply(valueInFen, factor) {
        const [n, d] = fraction(factor);
        return roundedRatio(BigInt(valueInFen) * n, d);
    }

    const yuan = value => value / 100;
    function taxInFen(taxable) {
        if (taxable <= 0) return 0;
        const [, percent, quick] = BRACKETS.find(([limit]) => taxable <= limit * 100);
        return Math.max(0, roundedRatio(BigInt(taxable) * BigInt(percent), 100n) - quick * 100);
    }

    function bonusTaxInFen(amount) {
        if (amount <= 0) return 0;
        // Compare the undivided bonus to annual thresholds: do not round bonus / 12.
        const index = BRACKETS.findIndex(([limit]) => amount <= limit * 100);
        return Math.max(0, roundedRatio(BigInt(amount) * BigInt(BRACKETS[index][1]), 100n) - BONUS_QUICK[index] * 100);
    }

    function annualTax(taxable) { return yuan(taxInFen(fen(taxable, "应纳税所得额"))); }
    function bonusTax(amount) { return yuan(bonusTaxInFen(fen(amount, "全年一次性奖金"))); }

    function normalize(input) {
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("请填写薪酬测算参数。");
        const amount = (key, label, defaultValue = 0) => yuan(fen(input[key] === undefined ? defaultValue : input[key], label));
        const monthlyGross = amount("monthlyGross", "税前月薪", NaN);
        const salaryMonths = number(input.salaryMonths === undefined ? 12 : input.salaryMonths, "年薪月数", 12, 24);
        const bonusMode = input.bonusMode === undefined ? "merged" : input.bonusMode;
        if (!["merged", "separate"].includes(bonusMode)) throw new Error("请选择并入工资或符合条件的全年一次性奖金单独计税。");
        if (input.contributions !== undefined && (!input.contributions || typeof input.contributions !== "object" || Array.isArray(input.contributions)))
            throw new Error("社保公积金参数格式不正确。");
        const contributions = {};
        for (const part of PARTS) {
            const value = input.contributions?.[part] === undefined ? {base: 0, rate: 0} : input.contributions[part];
            if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${LABELS[part]}参数格式不正确。`);
            contributions[part] = {
                base: yuan(fen(value.base, `${LABELS[part]}缴费基数`)),
                rate: number(value.rate, `${LABELS[part]}个人缴费比例`, 0, part === "housing" ? 0.12 : 1),
                fixedMonthly: yuan(fen(number(value.fixedMonthly === undefined ? 0 : value.fixedMonthly, `${LABELS[part]}固定附加额`, 0, part === "medical" ? MAX_AMOUNT : 0), "固定附加额")),
                supplementalRate: number(value.supplementalRate === undefined ? 0 : value.supplementalRate, "补充公积金比例", 0, part === "housing" ? .05 : 0),
                roundToYuan: value.roundToYuan === true
            };
        }
        if (contributions.housing.rate + contributions.housing.supplementalRate > .12 + 1e-10) throw new Error("基本与补充公积金个人比例合计不得超过12%。");
        return {monthlyGross, salaryMonths, additionalBonus: amount("additionalBonus", "额外奖金"), bonusMode,
            specialDeductionMonthly: amount("specialDeductionMonthly", "每月专项附加扣除"),
            otherDeductionMonthly: amount("otherDeductionMonthly", "每月其他依法扣除"), contributions};
    }

    function calculate(input) {
        const clean = normalize(input);
        const monthlyGross = fen(clean.monthlyGross, "税前月薪");
        const additionalBonus = fen(clean.additionalBonus, "额外奖金");
        // Subtracting already-normalized decimal months as floating point would lose cents.
        const [monthsN, monthsD] = fraction(clean.salaryMonths);
        const extraSalary = roundedRatio(BigInt(monthlyGross) * (monthsN - 12n * monthsD), monthsD);
        const bonus = extraSalary + additionalBonus;
        const special = fen(clean.specialDeductionMonthly, "每月专项附加扣除");
        const other = fen(clean.otherDeductionMonthly, "每月其他依法扣除");
        const contributionFen = Object.fromEntries(PARTS.map(part => {
            const c = clean.contributions[part];
            const base = fen(c.base, "缴费基数");
            const round = v => c.roundToYuan ? Math.round(v / 100) * 100 : v;
            return [part, round(multiply(base, c.rate)) + round(multiply(base, c.supplementalRate)) + fen(c.fixedMonthly, "固定附加额")];
        }));
        const contributionTotal = PARTS.reduce((sum, part) => sum + contributionFen[part], 0);
        const gross = monthlyGross * 12 + bonus;
        const deductions = 500000 + contributionTotal + special + other;

        function scenario(mode) {
            let withheld = 0;
            const months = [];
            const separateBonusTax = mode === "separate" ? bonusTaxInFen(bonus) : 0;
            for (let month = 1; month <= 12; month++) {
                const bonusThisMonth = month === 12 ? bonus : 0;
                const grossThisMonth = monthlyGross + bonusThisMonth;
                const taxable = Math.max(0, monthlyGross * month + (mode === "merged" ? bonusThisMonth : 0) - deductions * month);
                const salaryTax = Math.max(0, taxInFen(taxable) - withheld);
                withheld += salaryTax;
                const bonusTaxThisMonth = month === 12 ? separateBonusTax : 0;
                const totalTax = salaryTax + bonusTaxThisMonth;
                months.push({month, gross: yuan(grossThisMonth), contributions: yuan(contributionTotal),
                    specialDeduction: yuan(special), otherDeduction: yuan(other), standardDeduction: 5000,
                    taxableCumulative: yuan(taxable), salaryTax: yuan(salaryTax), bonusTax: yuan(bonusTaxThisMonth),
                    tax: yuan(totalTax), net: yuan(grossThisMonth - contributionTotal - totalTax)});
            }
            const tax = withheld + separateBonusTax;
            return {months, tax, net: gross - contributionTotal * 12 - tax,
                bonusTax: mode === "separate" ? separateBonusTax : withheld - taxInFen(Math.max(0, (monthlyGross - deductions) * 12))};
        }

        const merged = scenario("merged"), separate = scenario("separate");
        const selected = clean.bonusMode === "separate" ? separate : merged;
        const warnings = ["按居民个人全年 12 个月在同一单位、固定月薪及固定合法扣除测算；额外月薪和奖金统一假设在 12 月发放，不含年度汇算退补税。"];
        if (bonus > 0) warnings.push("多薪或额外奖金不自动符合全年一次性奖金条件；只有符合条件且本年度尚未使用该计税方法时，才能采用单独计税方案。政策执行至 2027 年 12 月 31 日。");
        if (contributionTotal > monthlyGross) warnings.push("每月社保公积金超过固定月薪，可能出现负到手额，请核对缴费基数与工资。扣除超出部分不会产生负个税。");
        return {
            input: clean,
            monthlyContributions: {...Object.fromEntries(PARTS.map(part => [part, yuan(contributionFen[part])])), total: yuan(contributionTotal)},
            annual: {gross: yuan(gross), tax: yuan(selected.tax), net: yuan(selected.net),
                social: yuan((contributionFen.pension + contributionFen.medical + contributionFen.unemployment) * 12),
                housing: yuan(contributionFen.housing * 12), contributions: yuan(contributionTotal * 12),
                monthlyAverageNet: yuan(Math.round(selected.net / 12))},
            months: selected.months,
            bonus: {amount: yuan(bonus), mode: clean.bonusMode, tax: yuan(selected.bonusTax)},
            comparison: {merged: {tax: yuan(merged.tax), net: yuan(merged.net)}, separate: {tax: yuan(separate.tax), net: yuan(separate.net)},
                difference: yuan(merged.tax - separate.tax)},
            warnings
        };
    }

    return Object.freeze({calculate, annualTax, bonusTax});
});

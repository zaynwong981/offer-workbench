/* Explainable local screening. Unknown salary or location is never a hard mismatch. */
(function(root,factory){const api=factory(typeof module==='object'?require('./salary-job.js'):root.SalaryJob);if(typeof module==='object')module.exports=api;else root.JobRules=api;})(globalThis,function(SalaryJob){
 const groups=['hard','preferred','explore'];
 const empty=()=>({cities:[],roles:[],keywords:[],excludedCompanies:[],salaryMin:0,salaryMax:0});
 function normalize(value={}){return Object.fromEntries(groups.map(g=>[g,{...empty(),...(value[g]||{})}]))}
 const norm=s=>String(s||'').replace(/\s+/g,'').toLowerCase();
 function hit(text,terms){return (terms||[]).filter(t=>norm(text).includes(norm(t)))}
 function evaluate(job,value){
  const rules=normalize(value),all={};
  for(const g of groups){
   const r=rules[g],checks=[];const add=(label,status,detail)=>checks.push({label,status,detail});
   for(const [key,label,source] of [['cities','城市',[job.city,job.workMode].filter(Boolean).join(' ')],['roles','岗位方向',job.title],['keywords','业务关键词',[job.title,job.description].filter(Boolean).join(' ')]]){
    if(!r[key]?.length)continue;const found=hit(source,r[key]);
    add(label,found.length?'match':key==='cities'&&job.city?'mismatch':'unknown',found.length?'包含 '+found.join('、'):source?(key==='cities'?'与所选城市不同':'未直接出现，需结合职责核实'):'岗位尚未提供这项信息');
   }
   if(r.salaryMin||r.salaryMax){const p=SalaryJob.prepare(job),range=p.salaryRange||(p.monthlyGross!==null&&p.monthlyGross!==undefined?{min:p.monthlyGross,max:p.monthlyGross}:null);
    if(!range)add('税前月薪','unknown','金额或单位不明确，先保留待核实');
    else{const lo=Number(r.salaryMin||0)*1000,hi=Number(r.salaryMax||0)*1000||Infinity;const outside=range.max<lo||range.min>hi,inside=range.min>=lo&&range.max<=hi;add('税前月薪',outside?'mismatch':inside?'match':'unknown',`招聘范围 ${range.min/1000}–${range.max/1000}K；`+(outside?'与所设范围不重叠':inside?'在所设范围内，实际报价待确认':'范围部分重叠，实际报价待确认'));}
   }
   if(r.excludedCompanies?.length){const excluded=hit(job.company,r.excludedCompanies);add('排除公司',excluded.length?'mismatch':job.company?'match':'unknown',excluded.length?'命中 '+excluded.join('、'):job.company?'未命中主动设置的名单':'公司名称待补充');}
   all[g]=checks;
  }
  return {...all,conflicts:all.hard.filter(c=>c.status==='mismatch').length,preferredCount:all.preferred.filter(c=>c.status==='match').length,exploreCount:all.explore.filter(c=>c.status==='match').length};
 }
 function order(jobs,rules,mode='relevance'){const rows=jobs.map((job,index)=>({job,index,assessment:evaluate(job,rules)}));if(mode==='relevance')rows.sort((a,b)=>a.assessment.conflicts-b.assessment.conflicts||b.assessment.preferredCount-a.assessment.preferredCount||b.assessment.exploreCount-a.assessment.exploreCount||a.index-b.index);return rows;}
 return {normalize,evaluate,order};
});

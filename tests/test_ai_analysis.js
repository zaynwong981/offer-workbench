const {test}=require('node:test');
const assert=require('node:assert/strict');
const {render,plainText}=require('../app/frontend/js/ai-analysis.js');
test('requirements show grouped tags and profile without quotes or questions',()=>{
 const r={groups:[{category:'专业',tags:[{label:'计算机优先',quote:'private original'}]}],profile:{text:'产品经验优先',quotes:['private original']},questions:['pending']};
 const html=render(r,'extract');assert.match(html,/计算机优先/);assert.match(html,/候选人画像/);assert.doesNotMatch(html,/private original|pending|blockquote/);assert.match(plainText(r),/专业：计算机优先/);
});
test('directions provide search keywords and escape model supplied markup',()=>{
 const r={directions:[{industry:'SaaS',role:'产品',reason:'<img src=x onerror=alert(1)>',keywords:['AI产品经理','" onclick="alert(1)'],quote:'private evidence'}]};
 const html=render(r,'explore');assert.match(html,/data-search-keyword="AI产品经理"/);assert.doesNotMatch(html,/<img|private evidence|" onclick=/);assert.match(plainText(r),/岗位搜索词：AI产品经理/);
});
test('legacy saved drafts still have a useful text representation',()=>{
 assert.equal(plainText({items:[{text:'旧建议',quote:'旧证据'}]}),'旧建议');assert.equal(plainText({text:'润色正文'}),'润色正文');assert.equal(plainText(), '');
});

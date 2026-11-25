/* Phase-one workflow. Extends the existing editor and platform boundary. */
(() => {
 const key='offer-workbench-job-workflow-v1';
 let local={};try{local=JSON.parse(sessionStorage.getItem(key)||'{}')||{}}catch{}
 local.views ||= {};local.preparations ||= {};local.submissionDrafts ||= {};
 let currentRules=JobRules.normalize({preferred:career.preferences||{}});
 let decisionFilter=local.decisionFilter||'all',sortMode=local.sortMode||'relevance';
 let operation=0,restoring=false,lastDetailId='';
 const dialog=$('#job-dialog');
 const storedView=t=>(local.views[t] ||= {list:0,detail:0,page:0,selected:'',detailTab:'job'});
 function remember(){
  if(restoring)return;
  const v=storedView(tab);if($('#opportunity-list'))v.list=$('#opportunity-list').scrollTop;
  if(dialog.open){v.detail=dialog.scrollTop;v.selected=activeJob?.id||'';v.detailTab=dialog.dataset.detailTab||'job'}
  v.page=window.scrollY;
  local.decisionFilter=decisionFilter;local.sortMode=sortMode;
  try{sessionStorage.setItem(key,JSON.stringify(local))}catch{error('浏览器暂时存不下这些草稿，请先保存准备内容，再离开页面。')}
 }
 function capturePreparation(){
  const form=$('#preparation-form');if(form&&renderedJobKey){const f=new FormData(form);local.preparations[renderedJobKey]={greeting:String(f.get('greeting')||''),worksText:String(f.get('works')||''),submitUrl:String(f.get('submitUrl')||'')};}
  const sub=$('#submission-form');if(sub&&renderedJobKey){const f=new FormData(sub);const old=local.submissionDrafts[renderedJobKey]||{};local.submissionDrafts[renderedJobKey]={...old,artifactId:String(f.get('artifactId')||''),channel:String(f.get('channel')||''),submittedAt:String(f.get('submittedAt')||''),notes:String(f.get('notes')||'')};}
 }
 const originalPersist=persistSession;
 persistSession=function(){originalPersist();remember()};
 const originalCapture=captureJobDraft;
 captureJobDraft=function(){capturePreparation();originalCapture()};
 function detach(){
  remember();capturePreparation();if(dialog.parentNode!==document.body){dialog.classList.remove('inline-job');document.body.append(dialog);if(dialog.open)dialog.close();}
 }
 const originalNavigate=navigate;
 navigate=function(next){remember();captureJobDraft();detach();const prior=restoring;restoring=true;try{originalNavigate(next);restoreView()}finally{restoring=prior}};
 function restoreView(){const v=storedView(tab),prior=restoring;restoring=true;if($('#opportunity-list'))$('#opportunity-list').scrollTop=v.list;if(dialog.open)dialog.scrollTop=v.detail;window.scrollTo({top:v.page||0,behavior:'instant'});restoring=prior;}
 const baseRender=render;
 render=function(){remember();const prior=restoring;restoring=true;try{detach();baseRender();restoreView()}finally{restoring=prior}};
 const originalSearch=renderSearch,originalPipeline=renderPipeline;
 renderSearch=function(){detach();originalSearch();mountList(results,true)};
 renderPipeline=function(){detach();originalPipeline();const jobs=career.jobs.filter(j=>(pipelineStatus==='all'||j.status===pipelineStatus)&&`${j.title} ${j.company} ${j.notes||''}`.toLowerCase().includes(pipelineText.toLowerCase()));mountList(jobs,false)};
 const decisionName={open:'继续了解',later:'稍后考虑',skip:'不考虑'};
 function mountList(jobs,isSearch){
  const previousView=structuredClone(storedView(tab));const priorRestore=restoring;restoring=true;
  currentRules=JobRules.normalize({preferred:career.preferences});
  const host=isSearch?$('#search-results'):$('#content > section.panel');if(!host){restoring=priorRestore;return;}
  let rows=JobRules.order(jobs.map(j=>savedJob(j)||j),currentRules,sortMode);
  rows=rows.filter(({job,assessment})=>(decisionFilter==='all'||decisionFilter==='unseen'&&!job.lastViewedAt||decisionFilter==='seen'&&job.lastViewedAt||job.decision===decisionFilter));
  host.innerHTML=`<div class="local-filter"><label>浏览与取舍<select id="decision-filter">${[['all','全部岗位'],['unseen','还没看过'],['seen','已看过'],['later','稍后考虑'],['skip','不考虑']].map(([v,n])=>`<option value="${v}" ${v===decisionFilter?'selected':''}>${n}</option>`).join('')}</select></label><label>排序<select id="local-sort"><option value="relevance" ${sortMode==='relevance'?'selected':''}>按已保存偏好排序</option><option value="original" ${sortMode==='original'?'selected':''}>保留原顺序</option></select></label></div><p class="hint">${rows.length} 个岗位。按已保存偏好的命中情况排序；同分保留原顺序。缺失信息不直接排除。</p><div class="opportunity-split"><div id="opportunity-list" class="opportunity-list" aria-label="岗位列表" tabindex="0">${rows.length?rows.map(({job:j,assessment:a})=>`<article class="opportunity-row ${activeJob?.id===j.id?'selected':''}"><button class="opportunity-open" data-workflow="open" data-id="${esc(j.id)}" data-index="${jobs.findIndex(x=>x.id===j.id||jobDraftKey(x)===jobDraftKey(j))}" aria-label="查看 ${esc(j.title)}"><strong>${esc(j.title)}</strong><span class="salary">${esc(j.salary||'薪资待核实')}</span><span>${esc(j.company||'公司待补充')} · ${esc(j.city||'地点待补充')}</span><span class="row-status">${j.lastViewedAt?'已看过':'未看过'} · ${decisionName[j.decision]||'继续了解'}${j.status?' · '+esc(statuses[j.status]||j.status):''}</span></button>${j.decisionReason?`<p class="row-reason">${esc(j.decisionReason)}</p>`:''}</article>`).join(''):empty('没有符合当前条件的岗位','可以调整已保存偏好，或切回“全部岗位”；已保存的记录仍然保留。')}</div><div id="job-side" class="job-side"><div class="detail-placeholder"><h2>先选一个岗位</h2><p>在这里看职责、准备简历和记录进度。切换岗位后，列表会停在原来的位置。</p></div></div></div>`;
  host.dataset.workflowJobs=JSON.stringify(jobs.map(j=>j.id));host._workflowJobs=jobs;
  for(const id of ['decision-filter','local-sort'])$('#'+id).onchange=()=>{remember();decisionFilter=$('#decision-filter').value;sortMode=$('#local-sort').value;(isSearch?renderSearch:renderPipeline)();};
  const selected=storedView(tab).selected;
  const found=jobs.map(j=>savedJob(j)||j).find(j=>j.id===selected||activeJob&&j.id===activeJob.id);
  if(found){activeJob=found;renderJob();placeDetail(false)}
  local.views[tab]=previousView;restoreView();restoring=priorRestore;
 }
 function placeDetail(openMobile=true){
  const host=$('#job-side');
  if(host&&innerWidth>1000){if(dialog.open)dialog.close();host.querySelector('.detail-placeholder')?.remove();host.append(dialog);dialog.classList.add('inline-job');dialog.setAttribute('open','');}
  else if(openMobile){if(dialog.classList.contains('inline-job')){dialog.close();dialog.classList.remove('inline-job');document.body.append(dialog)}if(!dialog.open)dialog.showModal()}
 }
 const originalOpen=openJob;
 openJob=function(job){
  if(!job)return;
  remember();captureJobDraft();const id=++operation;activeJob=normalizeJob(job);matching=null;
  storedView(tab).selected=activeJob.id;storedView(tab).detail=0;renderJob();placeDetail();dialog.scrollTop=0;remember();
  // Viewing records only local history; it never contacts a recruiter or changes pipeline status.
  const viewed={...activeJob};
  (async()=>{let saved=savedJob(viewed);if(!saved)saved=(await api('/api/career/upsert',{job:viewed})).job;
   const data=await api('/api/career/view',{id:saved.id});await refresh();
   if(id===operation&&activeJob&&jobDraftKey(activeJob)===jobDraftKey(viewed)){captureJobDraft();activeJob=data.job;storedView(tab).selected=data.job.id;renderJob();placeDetail();remember();}
  })().catch(e=>{if(id===operation)error('浏览记录未保存：'+e.message)});
 };
 const originalRenderJob=renderJob;
 renderJob=function(){
  capturePreparation();originalRenderJob();if(!activeJob)return;
  const j=savedJob(activeJob)||activeJob,k=jobDraftKey(j),root=$('#job-detail');
  const tabs=document.createElement('div');tabs.className='detail-tabs';tabs.innerHTML=[['job','岗位与条件'],['prepare','准备投递'],['follow','跟进与留档']].map(([id,label])=>`<button data-workflow="detail-tab" data-detail-tab="${id}">${label}</button>`).join('');root.querySelector('.detail-grid').before(tabs);
  const origin=document.createElement('p');origin.className='hint';origin.textContent='来源：'+(j.sourceLabel||(j.source==='boss'?'BOSS':'手动收录'));root.querySelector('h1').after(origin);
  const assessment=JobRules.evaluate(j,currentRules),section=document.createElement('section');section.className='panel decision-panel';section.dataset.detailGroup='job';section.innerHTML=`<h2>我的考虑</h2><form id="decision-form"><label>现在怎么考虑这个岗位<select name="decision">${Object.entries(decisionName).map(([v,n])=>`<option value="${v}" ${(j.decision||'open')===v?'selected':''}>${n}</option>`).join('')}</select></label><label>原因（可选）<input name="reason" maxlength="2000" value="${esc(j.decisionReason||'')}" placeholder="例如：通勤偏远，先保留其他选择"></label><button type="submit" class="secondary">保存我的考虑</button></form><p class="hint">只影响你的取舍记录。招聘方的反馈另记，不会因此屏蔽整家公司。</p><details><summary>已保存偏好的判断依据</summary>${[['preferred','优先考虑']].map(([g,n])=>`<h3>${n}</h3>${assessment[g].length?assessment[g].map(c=>`<p>${{match:'符合',mismatch:'不符',unknown:'待核实'}[c.status]} · ${esc(c.label)}：${esc(c.detail)}</p>`).join(''):'<p class="hint">本组未设置条件</p>'}`).join('')}</details>`;
  const grid=root.querySelector('.detail-grid');grid.before(section);
  const columns=[...grid.children];columns[0].querySelectorAll('section').forEach(s=>s.dataset.detailGroup='job');columns[1].querySelectorAll('section').forEach((s,i)=>s.dataset.detailGroup=i<2?'prepare':'follow');
  const tracking=$('#job-update-form');if(tracking){const follow=document.createElement('section');follow.className='panel workflow-follow-form';follow.dataset.detailGroup='follow';follow.innerHTML='<h2>跟进记录</h2>';follow.append(tracking);grid.append(follow);const applied=tracking.querySelector('option[value=applied]');if(applied&&j.status!=='applied')applied.disabled=true;}
  const first=columns[1].querySelector('section');first.querySelector('h2').textContent='选择这次使用的简历';
  const target=$('#target-version');target?.closest('label')?.insertAdjacentHTML('beforebegin','<p class="hint">直接复用现有版本可导出PDF；需要调整时复制一份，原简历保留。</p>');
  const c=columns[1].querySelectorAll('section')[1];const savedPrep=j.preparation||{};const draft=local.preparations[k]||{greeting:contactDrafts.get(k)??savedPrep.greeting??contactDraft(j),worksText:list(savedPrep.works).map(w=>w.label+' | '+w.url).join('\n'),submitUrl:savedPrep.submitUrl||j.url||''};
  c.innerHTML=`<h2>沟通与作品</h2><form id="preparation-form"><label>准备发送的文字<textarea id="contact-draft" name="greeting" rows="5" maxlength="10000">${esc(draft.greeting)}</textarea></label><button type="button" class="text-button" data-action="copy-draft">复制文字</button><label>作品链接（每行：名称 | 链接）<textarea name="works" rows="3" placeholder="作品名称 | https://…">${esc(draft.worksText)}</textarea></label><label>这次的提交入口<input name="submitUrl" type="url" maxlength="3000" value="${esc(draft.submitUrl)}" placeholder="可填写公司官网或招聘页面"></label><div class="button-row"><button class="primary" type="submit">保存准备内容</button>${safeUrl(savedPrep.submitUrl||j.url)?`<a class="secondary" href="${esc(safeUrl(savedPrep.submitUrl||j.url))}" target="_blank" rel="noopener">打开已保存的提交入口 ↗</a>`:''}</div><p class="hint">保存到本机后，换窗口仍能找到。复制文字或打开入口不会发送消息；确认链接分享权限后，再自行发给招聘方。</p></form>`;
  const artifacts=list(career.artifacts).filter(a=>a.jobId===j.id),subs=list(career.submissions).filter(s=>s.jobId===j.id);
  const subdraft=local.submissionDrafts[k] ||= {requestId:crypto.randomUUID(),submittedAt:new Date().toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,16).replace(' ','T')};
  const submit=document.createElement('section');submit.className='panel';submit.dataset.detailGroup='prepare';submit.innerHTML=`<h2>已经提交？留下这次的版本</h2><p class="hint">先在原渠道完成提交，再选择实际使用的PDF。记录后会保留当时的简历与岗位内容，后续编辑不会覆盖。</p>${artifacts.length?`<form id="submission-form"><label>实际提交的PDF<select name="artifactId" required><option value="">请核对后选择</option>${artifacts.map(a=>`<option value="${esc(a.id)}" ${a.id===subdraft.artifactId?'selected':''}>${esc(a.versionName)} · ${new Date(a.exportedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})} · ${a.pages}页</option>`).join('')}</select></label><a id="check-artifact" target="_blank" rel="noopener" ${subdraft.artifactId?'href="/api/career/artifact-pdf?id='+encodeURIComponent(subdraft.artifactId)+'"':'hidden'}>先打开这份PDF核对 ↗</a><div class="form-grid"><label>投递渠道<select name="channel" required><option value="">请选择渠道</option>${['BOSS','公司官网','邮件','内推','其他'].map(x=>`<option ${x===subdraft.channel?'selected':''}>${x}</option>`).join('')}</select></label><label>实际提交时间（北京时间）<input name="submittedAt" type="datetime-local" value="${esc(subdraft.submittedAt)}" required></label></div><label>这次提交的说明（可选）<input name="notes" maxlength="2000" value="${esc(subdraft.notes||'')}" placeholder="例如：内推给哪个团队，或使用的邮箱"></label><label class="check"><input name="confirmed" type="checkbox" required>我已在所选渠道提交，所选PDF与实际使用的版本一致</label><button type="submit" class="primary">确认并记录本次投递</button></form>`:'<p>先从上方导出一份PDF。导出后可核对文件，再回来记录实际提交。</p>'}`;grid.append(submit);
  const history=document.createElement('section');history.className='panel';history.dataset.detailGroup='follow';history.innerHTML=`<h2>已确认的投递版本</h2>${subs.length?subs.map(s=>{const a=artifacts.find(a=>a.id===s.artifactId);return `<article class="submission-record"><strong>${esc(s.channel)} · ${new Date(s.submittedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</strong><p>${esc(a?.versionName||'留档简历')} · ${esc(s.notes||'未填写备注')}</p><a href="/api/career/artifact-pdf?id=${encodeURIComponent(s.artifactId)}" target="_blank" rel="noopener">查看当时的PDF ↗</a><small>文件校验 ${esc(a?.pdfSha256?.slice(0,12)||'')}</small></article>`}).join(''):`<p class="hint">${j.status==='applied'?'这是一条旧版进度记录，没有当时的PDF留档；不会用现在的简历补造历史。':'还没有确认投递。导出PDF、复制文字或打开网页都不会自动记为已投递。'}</p>`}`;grid.prepend(history);const follow=root.querySelector('.workflow-follow-form');if(follow)history.after(follow);
  $('#decision-form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);busy(e.submitter,async()=>{const saved=await ensureSaved(j);await api('/api/career/decision',{id:saved.id,decision:f.get('decision'),reason:f.get('reason')});await refresh();renderJob();toast('已保存你的考虑，招聘进度保持原样')})};
  $('#preparation-form').onsubmit=e=>{e.preventDefault();capturePreparation();const value=local.preparations[k];busy(e.submitter,async()=>{const saved=await ensureSaved(j);const works=value.worksText.split('\n').map(x=>x.trim()).filter(Boolean).map(line=>{const i=line.indexOf('|');return i<0?{label:'作品',url:line}:{label:line.slice(0,i).trim(),url:line.slice(i+1).trim()}});await api('/api/career/preparation',{id:saved.id,preparation:{greeting:value.greeting,works,submitUrl:value.submitUrl}});await refresh();renderJob();toast('准备内容已保存到本机')})};
  const form=$('#submission-form');if(form){form.elements.artifactId.onchange=()=>{const a=$('#check-artifact');a.href='/api/career/artifact-pdf?id='+encodeURIComponent(form.elements.artifactId.value);a.hidden=!form.elements.artifactId.value;captureJobDraft()};form.onsubmit=e=>{e.preventDefault();capturePreparation();const f=new FormData(form),d=local.submissionDrafts[k];busy(e.submitter,async()=>{await api('/api/career/submission-confirm',{jobId:j.id,requestId:d.requestId,artifactId:f.get('artifactId'),channel:f.get('channel'),submittedAt:f.get('submittedAt')+':00+08:00',notes:f.get('notes'),confirmed:f.get('confirmed')==='on'});delete local.submissionDrafts[k];form.remove();if(activeJob?.id===j.id)storedView(tab).detailTab='follow';await refresh();if(dialog.open)renderJob();toast('本次投递已记录，可随时查回当时的PDF')})};}
  // Legacy applied is displayed, but new applications go through the explicit confirmation form.
  document.querySelectorAll('[data-job-status]').forEach(s=>{const option=s.querySelector('option[value=applied]');if(option&&s.value!=='applied')option.disabled=true});
  setDetailTab(storedView(tab).detailTab||'job');
 };
 const enhancedRenderJob=renderJob;
 renderJob=function(){
  const offset=lastDetailId===activeJob?.id?dialog.scrollTop:0,prior=restoring;restoring=true;
  try{enhancedRenderJob();dialog.scrollTop=offset;lastDetailId=activeJob?.id||'';
   document.querySelectorAll('[data-status-filter]').forEach(b=>{const count=b.querySelector('small');if(count)count.textContent=career.jobs.filter(j=>b.dataset.statusFilter==='all'||j.status===b.dataset.statusFilter).length});
   document.querySelectorAll('.opportunity-open').forEach(b=>{const j=career.jobs.find(j=>j.id===b.dataset.id);b.closest('.opportunity-row').classList.toggle('selected',b.dataset.id===activeJob?.id);if(j){const status=b.querySelector('.row-status');const row=b.closest('.opportunity-row');let reason=row.querySelector('.row-reason');if(j.decisionReason){if(!reason){reason=document.createElement('p');reason.className='row-reason';row.append(reason)}reason.textContent=j.decisionReason}else reason?.remove();if(status)status.textContent=(j.lastViewedAt?'已看过':'未看过')+' · '+(decisionName[j.decision]||'继续了解')+' · '+(statuses[j.status]||j.status);}});
  }finally{restoring=prior;}
 };
 function setDetailTab(value){storedView(tab).detailTab=value;dialog.dataset.detailTab=value;dialog.querySelectorAll('[data-detail-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.detailTab===value);b.setAttribute('aria-pressed',String(b.dataset.detailTab===value))});remember()}
 async function ensureSaved(job){const existing=savedJob(job);if(existing)return existing;const r=await api('/api/career/upsert',{job});await refresh();if(activeJob&&jobDraftKey(activeJob)===jobDraftKey(job))activeJob=r.job;return r.job;}
 const originalAction=action;
 action=async function(button){capturePreparation();return originalAction(button)};
 document.addEventListener('click',e=>{const b=e.target.closest('[data-workflow]');if(!b)return;busy(b,async()=>{const a=b.dataset.workflow;
  if(a==='open'){const host=b.closest('[data-workflow-jobs]');const job=career.jobs.find(j=>j.id===b.dataset.id)||host?._workflowJobs[Number(b.dataset.index)];return openJob(job)}
  if(a==='detail-tab'){setDetailTab(b.dataset.detailTab);dialog.scrollTop=0;return}
 });});
 document.addEventListener('input',e=>{if(e.target.closest('#preparation-form,#submission-form')){capturePreparation();remember()}});
 document.addEventListener('scroll',e=>{if(e.target.id==='opportunity-list'||e.target===dialog)remember()},true);
 window.addEventListener('beforeunload',()=>{capturePreparation();remember()});
 window.addEventListener('resize',()=>{if(!activeJob||!$('#job-side'))return;if(innerWidth>1000){renderJob();placeDetail(false)}else if(dialog.classList.contains('inline-job')){dialog.close();dialog.classList.remove('inline-job');document.body.append(dialog)} });
 // Add explicit source selection without fetching the supplied URL.
 const f=$('#manual-form'),source=document.createElement('label');source.textContent='岗位来自哪里';source.innerHTML+=' <select name="sourceLabel"><option>BOSS直聘</option><option>智联招聘</option><option>前程无忧</option><option>猎聘</option><option>公司官网</option><option>学校资源</option><option>熟人内推</option><option>社交软件</option><option>其他</option></select>';f.querySelector('.form-grid').prepend(source);
 const originalManual=manual;manual=function(job=null){originalManual(job);const select=f.elements.sourceLabel;select.querySelectorAll('[data-legacy]').forEach(o=>o.remove());const value=job?.sourceLabel||'BOSS直聘';if(![...select.options].some(o=>o.value===value)){const o=new Option(value+'（原记录）',value);o.dataset.legacy='true';select.add(o)}select.value=value;window.StudioUI?.sync();$('#manual-note').textContent='粘贴职位描述或链接即可保存，公司、薪资和地点可以后补。工作台不会自动打开或抓取这个链接。';};
 const originalSubmit=f.onsubmit;f.onsubmit=e=>{if(!f.elements.title.value.trim()&&!f.elements.description.value.trim()&&!f.elements.url.value.trim()){e.preventDefault();$('#manual-error').hidden=false;$('#manual-error').textContent='先粘贴职位描述或岗位链接，再保存。';return}editingJob={...(editingJob||{}),source:editingJob?.source||'manual',sourceLabel:f.elements.sourceLabel.value};return originalSubmit(e)};
 if($('#search-form')||$('#pipeline-filter'))render();
})();

/* Preparation stays in the resume editor. */
if(typeof MutationObserver!=="undefined") new MutationObserver(()=>{const form=document.querySelector('#preparation-form');if(form&&!form.querySelector('[data-assist-link]')&&activeJob){const a=document.createElement('a');a.dataset.assistLink='true';a.className='secondary';a.textContent='打开简历润色与素材库';a.href='/?version='+encodeURIComponent(activeJob.resumeId||resumes.versions[0]?.id||'')+'&returnJob='+encodeURIComponent(activeJob.id);form.prepend(a);}}).observe(document.querySelector('#job-detail'),{childList:true,subtree:true});

/* A dependency-free local calendar. Dates entered here always mean UTC+08:00. */
"use strict";
const CalendarUI = (() => {
    const kinds = {interview:'面试',test:'笔试',deadline:'截止时间',followup:'跟进',offer:'Offer 回复',onboarding:'入职'};
    const states = {planned:'待办',done:'已完成',cancelled:'已取消'};
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const today = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const dayKey = date => date.toISOString().slice(0,10);
    function occurs(e, day) { return e.start.slice(0,10) <= day && (e.end ? e.end.slice(11,16)==='00:00' ? dayKey(new Date(new Date(e.end).getTime()-1+8*3600000)) : e.end.slice(0,10) : e.start.slice(0,10)) >= day; }
    function when(e) { return e.allDay ? e.start + ' · 时刻待确认' : e.start.slice(0,16).replace('T',' ') + (e.end ? ' — ' + (e.end.slice(0,10)===e.start.slice(0,10)?e.end.slice(11,16):e.end.slice(0,16).replace('T',' ')) : ' 截止'); }
    let fitMonth = () => {};
    if (typeof window !== 'undefined') window.addEventListener('resize', () => fitMonth());
    let month = today().slice(0,7), selected = '', filter = '', showHistory = false;
    function mount(host, {state,api,refresh,openJob,confirm,initialJob=''}) {
        let data = state, dialog, pending = false, timer, requestNumber=0;
        if (initialJob) filter=initialJob;
        if (!data.jobs.some(j=>j.id===filter)) filter='';
        const jobName = id => {const j=data.jobs.find(j=>j.id===id);return j ? j.company+' · '+j.title : '独立日程'};
        const related = e => (!filter || e.jobId===filter) && (showHistory || e.status==='planned');
        function render() {
            const visible=(data.events||[]).filter(related).sort((a,b)=>a.start.localeCompare(b.start));
            const start=new Date(month+'-01T00:00:00Z'), offset=(start.getUTCDay()+6)%7;
            const last=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate();
            const dates=Array.from({length:Math.ceil((offset+last)/7)*7},(_,i)=>new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth(),1-offset+i)));
            const shown=visible.filter(e=>selected?occurs(e,selected):e.start.slice(0,7)<=month&&(e.end||e.start).slice(0,7)>=month);
            const warnings=(data.conflicts||[]).filter(c=>shown.some(e=>c.ids.includes(e.id)));
            const legacy=data.jobs.filter(j=>j.nextDate&&(!filter||filter===j.id)&& !['rejected','archived'].includes(j.status));
            host.innerHTML=`<section class="panel calendar-panel"><div class="calendar-toolbar"><div class="button-row"><button class="secondary" data-cal="prev" aria-label="上个月">←</button><h2>${esc(month.replace('-',' 年 '))} 月</h2><button class="secondary" data-cal="next" aria-label="下个月">→</button><button class="text-button" data-cal="today">今天</button></div><div class="button-row"><a class="secondary" href="/api/career/calendar.ics" download>导出日历 .ics</a><button class="primary" data-cal="new">＋ 新建日程</button></div></div><details class="calendar-filter-options"><summary>筛选机会与状态</summary><div class="calendar-filters"><label>关联机会<select id="calendar-job-filter"><option value="">全部机会</option>${data.jobs.map(j=>`<option value="${esc(j.id)}" ${j.id===filter?'selected':''}>${esc(j.company+' · '+j.title)}</option>`).join('')}</select></label><label class="calendar-check"><input id="calendar-history" type="checkbox" ${showHistory?'checked':''}> 显示已完成／取消</label><span class="hint">北京时间 UTC+08:00</span></div></details><div class="calendar-grid" aria-label="月历"><div class="calendar-week">${['一','二','三','四','五','六','日'].map(d=>`<span>${d}</span>`).join('')}</div><div class="calendar-days" style="--weeks:${dates.length/7}">${dates.map(date=>{const day=dayKey(date),events=visible.filter(e=>occurs(e,day)),conflict=events.some(e=>(data.conflicts||[]).some(c=>c.ids.includes(e.id)));return `<button class="calendar-day ${day.slice(0,7)!==month?'outside':''} ${day===today()?'is-today':''} ${day===selected?'is-selected':''}" data-day="${day}" aria-label="${day}，${events.length}项日程${conflict?'，有时间冲突':''}" aria-pressed="${day===selected}"><span class="day-number">${date.getUTCDate()}</span>${events.slice(0,1).map(e=>`<span class="calendar-chip ${e.status!=='planned'?'is-muted':''}">${esc(e.allDay?'待定':e.start.slice(11,16))} ${esc(e.title)}</span>`).join('')}${events.length>1?`<span class="hint">+${events.length-1} 项</span>`:''}${conflict?'<span class="conflict-dot" aria-label="有冲突">!</span>':''}</button>`}).join('')}</div></div></section><section class="panel"><div class="panel-heading"><h2>${selected?esc(selected):'本月'} · ${shown.length} 项日程</h2>${selected?'<button class="text-button" data-cal="clear-day">查看整月</button>':''}</div>${warnings.length?`<div class="calendar-warnings" role="status">${warnings.map(c=>`<p>${esc(c.message)}</p>`).join('')}<small>可调整时间或保留安排；已完成、取消和时刻待定项不计算重叠。</small></div>`:''}<div class="calendar-agenda">${shown.map(e=>`<article class="calendar-event"><div class="grow"><span class="tag">${kinds[e.kind]} · ${states[e.status]}</span><h3>${esc(e.title)}</h3><p>${esc(when(e))}</p><p>${esc(jobName(e.jobId))}${e.location?' · '+esc(e.location):''}</p></div><div class="button-row">${e.jobId?`<button class="text-button" data-open-job="${esc(e.jobId)}">岗位详情</button>`:''}<button class="secondary" data-edit-event="${esc(e.id)}">编辑</button></div></article>`).join('')||'<p class="empty">这个时间段还没有日程。添加面试、笔试或截止时间，让下一步清楚可见。</p>'}</div></section>${legacy.length?`<details class="panel"><summary>原跟进日期 · ${legacy.length} 项</summary><p class="hint">原记录仍保留，时刻待确认，不计入时间冲突。创建日程后可在岗位详情清空旧日期，避免重复提醒。</p>${legacy.map(j=>`<div class="calendar-event"><span class="grow">${esc(j.nextDate)} · ${esc(j.company)} · ${esc(j.nextAction||'跟进')}</span><button class="text-button" data-convert-job="${esc(j.id)}">补充为日程</button></div>`).join('')}</details>`:''}<p class="hint">日历保存在本机；网页关闭后不会主动通知。ICS 是手动导入快照，提醒与重复导入规则由你的日历应用决定。</p>`;
            fitMonth = () => {
                if (!host.isConnected) return;
                const grid = host.querySelector('.calendar-days');
                if (!grid) return;
                const height = Math.max(192, window.innerHeight - grid.getBoundingClientRect().top - 54);
                grid.style.setProperty('--month-height', Math.min(540, height) + 'px');
            };
            requestAnimationFrame(fitMonth);
            host.querySelector('.calendar-filter-options').ontoggle = fitMonth;
            host.querySelector('#calendar-job-filter').onchange=e=>{filter=e.target.value;render()};
            host.querySelector('#calendar-history').onchange=e=>{showHistory=e.target.checked;render()};
            host.onclick=e=>{
                const b=e.target.closest('button');if(!b)return;
                if(b.dataset.day){selected=selected===b.dataset.day?'':b.dataset.day;render();return}
                if(b.dataset.editEvent){edit(data.events.find(x=>x.id===b.dataset.editEvent));return}
                if(b.dataset.openJob){openJob(data.jobs.find(j=>j.id===b.dataset.openJob));return}
                if(b.dataset.convertJob){const j=data.jobs.find(j=>j.id===b.dataset.convertJob);edit({jobId:j.id,title:j.nextAction||'跟进机会',start:j.nextDate,kind:'followup',allDay:true});return}
                if(b.dataset.cal==='new')return edit({});
                if(b.dataset.cal==='clear-day'){selected='';render();return}
                if(b.dataset.cal==='today'){month=today().slice(0,7);selected=today();render();return}
                if(['prev','next'].includes(b.dataset.cal)){const d=new Date(month+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+(b.dataset.cal==='next'?1:-1));month=dayKey(d).slice(0,7);selected='';render()}
            };
        }
        function edit(event) {
            dialog=document.createElement('dialog');dialog.className='calendar-dialog';
            dialog.innerHTML=`<form><div class="dialog-top"><h2>${event.id?'编辑日程':'新建日程'}</h2><button type="button" data-calendar-close aria-label="关闭">×</button></div><p class="hint">通知未写明具体时间时，选择“仅知道日期”。不会自动变更岗位投递进度。</p><div class="form-grid"><label class="wide">日程标题<input name="title" maxlength="200" required value="${esc(event.title||'')}" placeholder="例如：产品经理二面"></label><label>类型<select name="kind">${Object.entries(kinds).map(([k,v])=>`<option value="${k}" ${k===(event.kind||'interview')?'selected':''}>${v}</option>`).join('')}</select></label><label>状态<select name="status">${Object.entries(states).map(([k,v])=>`<option value="${k}" ${k===(event.status||'planned')?'selected':''}>${v}</option>`).join('')}</select></label><label class="wide">关联机会<select name="jobId"><option value="">独立日程（暂不关联）</option>${data.jobs.map(j=>`<option value="${esc(j.id)}" ${j.id===(event.jobId||filter)?'selected':''}>${esc(jobName(j.id))}</option>`).join('')}</select></label><label class="calendar-check wide"><input name="allDay" type="checkbox" ${event.allDay?'checked':''}> 仅知道日期，具体时刻待确认</label><label><span id="calendar-start-label">开始（北京时间）</span><input name="start" required></label><label id="calendar-end-label">结束（北京时间）<input name="end"></label><label class="wide">地点／会议入口<input name="location" maxlength="1000" value="${esc(event.location||'')}"></label><label class="wide">备注<textarea name="notes" rows="3" maxlength="6000">${esc(event.notes||'')}</textarea></label></div><div id="calendar-check-result" role="status" class="hint"></div><div id="calendar-error" role="alert" class="error-banner" hidden></div><div class="dialog-actions">${event.id?'<button type="button" class="text-button danger" data-delete-event>删除</button>':''}<button type="button" class="secondary" data-calendar-close>取消</button><button class="primary" type="submit">保存日程</button></div></form>`;
            document.body.append(dialog);const form=dialog.querySelector('form'),f=form.elements;
            function types(){const dateOnly=f.allDay.checked,point=['deadline','offer'].includes(f.kind.value);const val=f.start.value;f.start.type=dateOnly?'date':'datetime-local';f.start.value=dateOnly?val.slice(0,10):val.length===10?val+'T09:00':val;f.end.type='datetime-local';f.end.required=!dateOnly&&!point;dialog.querySelector('#calendar-end-label').hidden=dateOnly||point;dialog.querySelector('#calendar-start-label').textContent=dateOnly?'日期（时刻待确认）':point?'截止时刻（北京时间）':'开始（北京时间）'}
            types();f.start.value=event.start?event.start.slice(0,event.allDay?10:16):(f.allDay.checked?(selected||today()):(selected||today())+'T09:00');f.end.value=event.end?event.end.slice(0,16):'';
            function payload(){return {id:event.id||'',revision:event.revision||0,title:f.title.value,jobId:f.jobId.value,kind:f.kind.value,status:f.status.value,allDay:f.allDay.checked,start:f.start.value+(f.allDay.checked?'':'+08:00'),end:!f.allDay.checked&&!['deadline','offer'].includes(f.kind.value)&&f.end.value?f.end.value+'+08:00':'',location:f.location.value,notes:f.notes.value}}
            async function preview(){const n=++requestNumber;if(!form.checkValidity())return;try{const result=await api('/api/career/event-check',{event:payload()});if(n===requestNumber&&dialog.isConnected){dialog.querySelector('#calendar-check-result').textContent=result.conflicts.length?result.conflicts.map(c=>c.message).join('；')+'。仍可保存，或先调整时间。':f.allDay.checked?'时刻未确认，不计算时间冲突。':'与已记录的待办没有时间重叠。'}}catch(e){if(n===requestNumber&&dialog.isConnected)dialog.querySelector('#calendar-check-result').textContent=e.message}}
            function dirty(){return JSON.stringify(payload())!==original}
            async function close(){if(pending)return;if(dirty()&&!await confirm('放弃未保存日程？','当前修改尚未写入本机，关闭将放弃这些修改。'))return;dialog.close()}
            const original=JSON.stringify(payload());
            const unload=e=>{if(dirty()){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',unload);
            dialog.addEventListener('close',()=>{clearTimeout(timer);requestNumber++;window.removeEventListener('beforeunload',unload);dialog.remove()},{once:true});
            dialog.addEventListener('cancel',e=>{e.preventDefault();close()});dialog.querySelectorAll('[data-calendar-close]').forEach(b=>b.onclick=close);
            form.onchange=()=>{types();clearTimeout(timer);timer=setTimeout(preview,200)};form.oninput=()=>{requestNumber++;dialog.querySelector('#calendar-check-result').textContent='';clearTimeout(timer);timer=setTimeout(preview,300)};
            async function save(route){pending=true;const submit=form.querySelector('[type=submit]');submit.disabled=true;try{await api('/api/career/'+route,{event:payload()});data=await refresh();dialog.close();render()}catch(e){dialog.querySelector('#calendar-error').textContent=e.message;dialog.querySelector('#calendar-error').hidden=false}finally{pending=false;submit.disabled=false}}
            form.onsubmit=e=>{e.preventDefault();if(!pending)save('event-save')};
            const del=dialog.querySelector('[data-delete-event]');if(del)del.onclick=async()=>{if(!pending&&await confirm('删除这项日程？','只删除本机日程，不会取消招聘方的面试邀请。'))save('event-delete')};
            dialog.showModal();preview();
        }
        render();return {add:()=>edit({jobId:initialJob||filter})};
    }
    return {mount,occurs,when};
})();
if(typeof module!=='undefined')module.exports=CalendarUI;

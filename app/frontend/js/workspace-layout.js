/* Browser-only layout preferences. No resume or career data is read or changed. */
(() => {
  const resume = document.body.classList.contains('resume-page');
  const rail = document.querySelector(resume ? '.sidebar' : '.rail');
  if (!rail) return;
  const key = 'offer-workbench-layout-v1';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch {}
  const mode = resume ? 'resume' : 'career';
  let collapsed = saved[mode] === true;
  let ratio = typeof saved.ratio === 'number' && Number.isFinite(saved.ratio) ? Math.min(1, Math.max(0, saved.ratio)) : .5;
  const paths = {
    overview:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    search:'M15 15l6 6 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
    pipeline:'M3 6h18v15H3z M8 6V3h8v3 M3 11h18 M10 11v3h4v-3',
    calendar:'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h2 M14 14h2 M8 18h2',
    salary:'M5 3h14v18H5z M8 6h8v4H8z M8 14h1 M15 14h1 M8 18h1 M15 18h1',
    materials:'M4 3h12v18H4z M8 7h5 M8 11h5 M18 8h3v13h-3',
    preferences:'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',
    profile:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-3a8 8 0 0 1 16 0v3',
    file:'M5 3h9l5 5v13H5z M14 3v6h5 M8 13h8 M8 17h6',
    download:'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5',
    upload:'M12 16V4 M7 9l5-5 5 5 M4 16v5h16v-5',
    plus:'M12 4v16 M4 12h16',
    collapse:'M3 4h18v16H3z M8 4v16 M16 8l-4 4 4 4',
    expand:'M3 4h18v16H3z M8 4v16 M12 8l4 4-4 4'
  };
  function icon(name) { return `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.file}"/></svg>`; }
  function decorate(button, name) {
    if (!button || button.dataset.layoutIcon) return;
    const label = button.textContent.trim();
    button.dataset.layoutIcon = name;
    button.title = label; button.setAttribute('aria-label', label);
    const text = document.createElement('span'); text.className='nav-label';
    while(button.firstChild) text.append(button.firstChild);
    button.append(text); button.insertAdjacentHTML('afterbegin',icon(name));
  }
  if (!resume) rail.querySelectorAll('#sections button').forEach(b => {
    b.querySelector('span')?.remove(); decorate(b,b.dataset.tab);
  });
  decorate(document.querySelector('#common-nav'),'profile');
  decorate(rail.querySelector('#backup'),'download');
  decorate(rail.querySelector('#restore') || rail.querySelector('#import'),'upload');
  decorate(rail.querySelector('#export-all'),'download');
  const versionNav = rail.querySelector('#versions');
  const decorateVersions = () => versionNav?.querySelectorAll('button').forEach(b=>decorate(b,'file'));
  decorateVersions();
  if(versionNav) new MutationObserver(decorateVersions).observe(versionNav,{childList:true});
  const toggle=document.createElement('button');toggle.type='button';toggle.className='rail-toggle';
  toggle.innerHTML=icon('collapse')+'<span class="nav-label">收起菜单</span>';
  toggle.setAttribute('aria-controls',resume?'resume-navigation':'career-navigation');
  rail.id=resume?'resume-navigation':'career-navigation';rail.prepend(toggle);
  function persist(){try{const latest=JSON.parse(localStorage.getItem(key)||'{}')||{};localStorage.setItem(key,JSON.stringify({...latest,[mode]:collapsed,ratio}))}catch{}}
  function applyCollapse(){
    document.body.classList.toggle('rail-collapsed',collapsed);
    toggle.innerHTML=icon(collapsed?'expand':'collapse')+`<span class="nav-label">${collapsed?'展开':'收起'}菜单</span>`;
    toggle.setAttribute('aria-expanded',String(!collapsed));toggle.setAttribute('aria-label',(collapsed?'展开':'收起')+'左侧菜单');toggle.title=toggle.getAttribute('aria-label');
    fit();window.dispatchEvent(new Event('resize'));
  }
  toggle.onclick=()=>{collapsed=!collapsed;persist();applyCollapse()};
  const panels=document.querySelector('.panels'), separator=document.querySelector('#panel-divider');
  let dragging=false;
  function fit(){
    if(!panels||!separator)return;
    const available=panels.clientWidth-12;
    const wide=window.innerWidth>1100 && available>=640;
    separator.hidden=!wide;
    if(!wide){panels.style.removeProperty('--editor-width');return}
    const width=Math.max(320,Math.min(available-300,available*ratio));
    panels.style.setProperty('--editor-width',width+'px');
    separator.setAttribute('aria-valuemin',Math.ceil(320/available*100));
    separator.setAttribute('aria-valuemax',Math.floor((available-300)/available*100));
    separator.setAttribute('aria-valuenow',Math.round(width/available*100));
    separator.setAttribute('aria-valuetext',`编辑区 ${Math.round(width)} 像素，预览区 ${Math.round(available-width)} 像素`);
  }
  if(separator){
    function setWidth(x){const r=panels.getBoundingClientRect(),available=r.width-12;ratio=Math.max(320,Math.min(available-300,x-r.left))/available;fit()}
    separator.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();dragging=true;separator.setPointerCapture(e.pointerId);document.body.classList.add('resizing-panels')};
    separator.onpointermove=e=>{if(dragging)setWidth(e.clientX)};
    const finish=()=>{if(!dragging)return;dragging=false;document.body.classList.remove('resizing-panels');persist()};
    separator.onpointerup=finish;separator.onpointercancel=finish;separator.onlostpointercapture=finish;
    separator.ondblclick=()=>{ratio=.5;fit();persist()};
    separator.onkeydown=e=>{
      if(!['ArrowLeft','ArrowRight','Home','End','Enter'].includes(e.key))return;e.preventDefault();
      const available=panels.clientWidth-12,width=parseFloat(panels.style.getPropertyValue('--editor-width'));
      ratio=e.key==='Home'?320/available:e.key==='End'?(available-300)/available:e.key==='Enter'?.5:(width+(e.key==='ArrowLeft'?-20:20))/available;
      fit();persist();
    };
    window.addEventListener('resize',fit);
    if(typeof ResizeObserver!=='undefined')new ResizeObserver(fit).observe(panels);
  }
  applyCollapse();
})();

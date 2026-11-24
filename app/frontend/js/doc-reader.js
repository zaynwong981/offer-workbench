/* Local Markdown reader. Source text is rendered as DOM nodes; raw HTML never runs. */
(() => {
  const files = { 'reference/BOSS_FILTER_SOURCES.md': '/docs/BOSS_FILTER_SOURCES.md', 'docs/reference/BOSS_FILTER_SOURCES.md': '/docs/BOSS_FILTER_SOURCES.md', 'BOSS_FILTER_SOURCES.md': '/docs/BOSS_FILTER_SOURCES.md', 'USER_JOURNEY.md': '/docs/USER_JOURNEY.md', 'reference/SALARY_POLICY_SOURCES.md': '/docs/SALARY_POLICY_SOURCES.md', 'README.md': '/help', 'docs/USER_GUIDE.md': '/help', 'docs/reference/SALARY_POLICY_SOURCES.md': '/docs/SALARY_POLICY_SOURCES.md', 'CHANGELOG.md': '/docs/CHANGELOG.md', 'SALARY_POLICY_SOURCES.md': '/docs/SALARY_POLICY_SOURCES.md' };
  const names = { 'BOSS_FILTER_SOURCES.md': '岗位筛选依据与限制', 'USER_JOURNEY.md': '用户旅程与流程对照', 'README.md': '完整使用文档', 'CHANGELOG.md': '版本更新记录', 'SALARY_POLICY_SOURCES.md': '薪酬政策与来源' };
  const make = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
  function inline(parent, text) {
    const pattern = /`([^`\n]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^\s)]+)\)/g;
    let start = 0;
    for (const match of text.matchAll(pattern)) {
      parent.append(document.createTextNode(text.slice(start, match.index)));
      if (match[1] !== undefined) parent.append(make('code', match[1]));
      else if (match[2] !== undefined) { const strong = make('strong'); inline(strong, match[2]); parent.append(strong); }
      else {
        const label = match[3], destination = match[4];
        if (files[destination]) { const link = make('a', label); link.href = files[destination]; link.dataset.docFile = destination; parent.append(link); }
        else if (['../images/user-journey.png', '../images/user-journey.svg'].includes(destination)) { const link=make('a', label);link.href='/docs/images/'+destination.split('/').pop();link.target='_blank';link.rel='noopener';parent.append(link); }
        else {
          let url; try { url = new URL(destination); } catch {}
          if (url && ['https:', 'http:'].includes(url.protocol)) {
            const link = make('a', label); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; parent.append(link);
          } else parent.append(document.createTextNode(label + ' (' + destination + ')'));
        }
      }
      start = match.index + match[0].length;
    }
    parent.append(document.createTextNode(text.slice(start)));
  }
  const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim());
  const isTableRule = line => line?.includes('|') && cells(line).every(s => /^:?-{3,}:?$/.test(s));
  const isBlock = line => /^(#{1,6}\s|\s*```|\s*[-+*]\s|\s*\d+\.\s|>\s?|(?:---+|\*\*\*+)\s*$)/.test(line);
  function markdown(source) {
    const fragment = document.createDocumentFragment(), lines = source.replace(/\r\n?/g, '\n').split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      if (/^\s*```/.test(line)) {
        const language = line.trim().slice(3).trim(), code = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
        if (i < lines.length) i++;
        const pre = make('pre'); pre.append(make('code', code.join('\n')));
        if (language) pre.setAttribute('aria-label', language + ' 代码');
        fragment.append(pre); continue;
      }
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) { const el = make('h' + heading[1].length); inline(el, heading[2]); fragment.append(el); i++; continue; }
      if (isTableRule(lines[i + 1])) {
        const wrap = make('div', undefined, 'doc-table-wrap'), table = make('table'), head = make('thead'), row = make('tr');
        cells(line).forEach(value => { const th = make('th'); th.scope = 'col'; inline(th, value); row.append(th); }); head.append(row); table.append(head); i += 2;
        const body = make('tbody');
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
          const tr = make('tr'); cells(lines[i++]).forEach(value => { const td = make('td'); inline(td, value); tr.append(td); }); body.append(tr);
        }
        table.append(body); wrap.append(table); fragment.append(wrap); continue;
      }
      const list = line.match(/^\s*([-+*]|\d+\.)\s+(.+)$/);
      if (list) {
        const ordered = /\d/.test(list[1]), el = make(ordered ? 'ol' : 'ul'); if (ordered) el.start = parseInt(list[1], 10);
        while (i < lines.length) {
          const item = lines[i].match(/^\s*([-+*]|\d+\.)\s+(.+)$/);
          if (!item || /\d/.test(item[1]) !== ordered) break;
          const li = make('li'); inline(li, item[2]); el.append(li); i++;
          while (i < lines.length && /^\s+\S/.test(lines[i]) && !isBlock(lines[i])) { li.append(document.createTextNode(' ')); inline(li, lines[i++].trim()); }
        }
        fragment.append(el); continue;
      }
      if (/^>/.test(line)) {
        const quote = []; while (i < lines.length && /^>/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''));
        const el = make('blockquote'); el.append(markdown(quote.join('\n'))); fragment.append(el); continue;
      }
      if (/^(---+|\*\*\*+)\s*$/.test(line)) { fragment.append(make('hr')); i++; continue; }
      const paragraph = [lines[i++]];
      while (i < lines.length && lines[i].trim() && !isBlock(lines[i]) && !isTableRule(lines[i + 1])) paragraph.push(lines[i++]);
      const el = make('p'); inline(el, paragraph.join('\n')); fragment.append(el);
    }
    return fragment;
  }

  const dialog = make('dialog', undefined, 'doc-dialog'); dialog.id = 'doc-dialog'; dialog.setAttribute('aria-labelledby', 'doc-title');
  dialog.innerHTML = `<header class="doc-header"><div><h2 id="doc-title">完整使用文档</h2></div><div class="doc-actions"><button type="button" id="doc-back" hidden>← 返回使用文档</button><button type="button" id="doc-close" aria-label="关闭完整使用文档">×</button></div></header><div class="doc-layout"><nav class="doc-toc" aria-label="文档目录"><p>目录</p><div id="doc-toc-items"></div></nav><div class="doc-scroll" tabindex="0" aria-label="文档正文，可上下滚动"><article class="doc-markdown" id="doc-content"></article></div></div><footer class="doc-footer"><span>上下滚动阅读全文</span><span>Esc 关闭</span></footer>`;
  document.body.append(dialog);
  const content = dialog.querySelector('#doc-content'), scroll = dialog.querySelector('.doc-scroll'), toc = dialog.querySelector('#doc-toc-items'), back = dialog.querySelector('#doc-back');
  let request = null, sequence = 0, opener = null, previousOverflow, previousPadding, pageY = 0;
  async function load(file = 'README.md') {
    if (!files[file]) return;
    const current = ++sequence; request?.abort(); request = new AbortController();
    dialog.querySelector('#doc-title').textContent = names[file]; back.hidden = file === 'README.md';
    content.setAttribute('aria-busy', 'true'); content.replaceChildren(make('p', '正在读取文档…', 'doc-message')); toc.replaceChildren(); scroll.scrollTop = 0;
    try {
      const response = await fetch(files[file], {signal: request.signal, cache: 'no-store'});
      if (!response.ok) throw new Error('文档暂时无法读取，请确认工作台服务仍在运行。');
      const source = await response.text(); if (current !== sequence || !dialog.open) return;
      content.replaceChildren(markdown(source));
      content.querySelectorAll('h2, h3').forEach((heading, index) => {
        heading.id = 'doc-heading-' + index;
        const button = make('button', heading.textContent); button.type = 'button'; button.className = heading.tagName === 'H3' ? 'doc-toc-sub' : '';
        button.onclick = () => { scroll.scrollTop += heading.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 24; scroll.focus({preventScroll: true}); };
        toc.append(button);
      });
      scroll.scrollTop = 0;
    } catch (error) {
      if (current !== sequence || error.name === 'AbortError') return;
      const message = make('p', error.message, 'doc-message'); message.setAttribute('role', 'alert');
      const retry = make('button', '重新读取文档', 'secondary'); retry.type = 'button'; retry.onclick = () => load(file); content.replaceChildren(message, retry);
    } finally { if (current === sequence) content.removeAttribute('aria-busy'); }
  }
  function open(button) {
    if (dialog.open) return;
    opener = button; pageY = window.scrollY;
    const root = document.documentElement, gutter = innerWidth - root.clientWidth;
    previousOverflow = root.style.overflow; previousPadding = root.style.paddingRight;
    if (gutter) root.style.paddingRight = parseFloat(getComputedStyle(root).paddingRight) + gutter + 'px';
    root.style.overflow = 'hidden'; dialog.showModal(); dialog.querySelector('#doc-close').focus(); load();
  }
  dialog.querySelector('#doc-close').onclick = () => dialog.close();
  back.onclick = () => load();
  dialog.addEventListener('close', () => {
    sequence++; request?.abort();
    document.documentElement.style.overflow = previousOverflow; document.documentElement.style.paddingRight = previousPadding;
    window.scrollTo(0, pageY); opener?.focus({preventScroll: true});
  });
  let backdropDown = false;
  const outside = event => { const r = dialog.getBoundingClientRect(); return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom; };
  dialog.addEventListener('pointerdown', e => { backdropDown = e.target === dialog && outside(e); });
  dialog.addEventListener('click', e => { if (backdropDown && e.target === dialog && outside(e)) dialog.close(); backdropDown = false; });
  content.addEventListener('click', e => { const link = e.target.closest('[data-doc-file]'); if (link) { e.preventDefault(); load(link.dataset.docFile); } });
  document.querySelectorAll('[data-open-docs]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); open(button); }));
})();

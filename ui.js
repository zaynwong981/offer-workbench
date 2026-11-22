/* Shared controls. Native selects remain the source of truth for FormData and app events. */
(() => {
  let sequence = 0, opened = null;
  const controls = new WeakMap();
  function enhance(select) {
    if (controls.has(select) || select.multiple) return;
    const wrap = document.createElement('span'); wrap.className = 'ui-select';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'ui-select-trigger';
    button.setAttribute('role', 'combobox'); button.setAttribute('aria-haspopup', 'listbox'); button.setAttribute('aria-expanded', 'false');
    const text = document.createElement('span'); button.append(text);
    const list = document.createElement('div'); list.className = 'ui-select-list'; list.id = 'ui-options-' + ++sequence;
    list.setAttribute('role', 'listbox'); list.setAttribute('popover', 'manual'); list.hidden = true;
    button.setAttribute('aria-controls', list.id);
    const originalTabIndex = select.tabIndex;
    select.before(wrap); wrap.append(select, button, list);
    select.classList.add('ui-select-native'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
    let active = -1, buffer = '', typedAt = 0;
    const enabled = () => Array.from(select.options).map((o, i) => ({o, i})).filter(({o}) => !o.disabled && !o.hidden && !o.closest('optgroup')?.disabled);
    function sync() {
      const value = select.selectedOptions[0]?.textContent || '请选择';
      if (text.textContent !== value) text.textContent = value;
      button.disabled = select.matches(':disabled'); button.tabIndex = originalTabIndex;
      const label = select.getAttribute('aria-label') || Array.from(select.labels || []).map(l => Array.from(l.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim()).join(' ') || select.name || '选择选项';
      button.setAttribute('aria-label', label.trim());
      if (select.getAttribute('aria-describedby')) button.setAttribute('aria-describedby', select.getAttribute('aria-describedby'));
    }
    function close() {
      if (!list.hidden && list.hidePopover) { try { list.hidePopover(); } catch {} }
      list.hidden = true; button.setAttribute('aria-expanded', 'false'); button.removeAttribute('aria-activedescendant');
      if (opened?.select === select) opened = null;
    }
    function position() {
      const r = button.getBoundingClientRect(), height = Math.min(280, Math.max(120, innerHeight - 24));
      const below = innerHeight - r.bottom - 8, above = r.top - 8;
      const down = below >= Math.min(height, list.scrollHeight) || below >= above;
      list.style.width = Math.min(Math.max(r.width, 160), innerWidth - 16) + 'px';
      list.style.left = Math.max(8, Math.min(r.left, innerWidth - parseFloat(list.style.width) - 8)) + 'px';
      list.style.maxHeight = Math.max(60, Math.min(height, down ? below : above)) + 'px';
      list.style.top = down ? r.bottom + 4 + 'px' : 'auto';
      list.style.bottom = down ? 'auto' : innerHeight - r.top + 4 + 'px';
    }
    function highlight(index) {
      active = index;
      list.querySelectorAll('[role=option]').forEach(el => el.classList.toggle('is-active', Number(el.dataset.index) === active));
      const row = list.querySelector(`[data-index="${active}"]`);
      if (row) {
        button.setAttribute('aria-activedescendant', row.id);
        if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
        else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
      }
    }
    function choose(index) {
      const option = select.options[index];
      if (!option || !enabled().some(item => item.i === index)) return;
      const changed = select.selectedIndex !== index;
      select.selectedIndex = index; sync(); close(); button.focus();
      if (changed) { select.dispatchEvent(new Event('input', {bubbles: true})); select.dispatchEvent(new Event('change', {bubbles: true})); }
    }
    function open() {
      sync(); if (button.disabled) return;
      opened?.close(); list.replaceChildren();
      Array.from(select.options).forEach((option, i) => {
        if (option.hidden) return;
        const row = document.createElement('div'); row.className = 'ui-select-option'; row.id = list.id + '-' + i;
        row.setAttribute('role', 'option'); row.dataset.index = i; row.textContent = option.textContent;
        row.setAttribute('aria-selected', String(i === select.selectedIndex));
        row.setAttribute('aria-disabled', String(option.disabled || !!option.closest('optgroup')?.disabled));
        row.addEventListener('pointerdown', e => e.preventDefault());
        row.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); choose(i); });
        list.append(row);
      });
      list.hidden = false; if (list.showPopover) list.showPopover();
      position(); button.setAttribute('aria-expanded', 'true'); opened = {select, close, wrap, list};
      highlight(enabled().some(x => x.i === select.selectedIndex) ? select.selectedIndex : enabled()[0]?.i ?? -1);
    }
    button.addEventListener('click', () => list.hidden ? open() : close());
    button.addEventListener('keydown', e => {
      if (e.key === 'Escape' && list.hidden) return;
      const options = enabled(); let position = options.findIndex(x => x.i === active);
      if (['ArrowDown','ArrowUp','Home','End','Enter',' ','Escape'].includes(e.key)) e.preventDefault();
      if (e.key === 'Escape') { if (!list.hidden) { e.stopPropagation(); close(); } return; }
      if (e.key === 'Tab') { close(); return; }
      if (e.key === 'Enter' || e.key === ' ') { if (list.hidden) open(); else choose(active); return; }
      if (['ArrowDown','ArrowUp','Home','End'].includes(e.key)) {
        if (list.hidden) { open(); position = options.findIndex(x => x.i === active); }
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : Math.max(0, Math.min(options.length - 1, position + (e.key === 'ArrowDown' ? 1 : -1)));
        highlight(options[next]?.i ?? -1); return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (list.hidden) open(); buffer = Date.now() - typedAt > 700 ? e.key : buffer + e.key; typedAt = Date.now();
        const found = options.find(x => x.o.textContent.trim().toLowerCase().startsWith(buffer.toLowerCase()));
        if (found) highlight(found.i);
      }
    });
    select.addEventListener('change', sync); select.addEventListener('input', sync);
    select.addEventListener('invalid', e => { e.preventDefault(); button.focus(); });
    controls.set(select, {sync, close}); sync();
  }
  function scan() { document.querySelectorAll('select').forEach(enhance); }
  new MutationObserver(records => {
    if (opened && (!opened.select.isConnected || opened.select.matches(':disabled'))) opened.close();
    scan();
    for (const r of records) {
      const s = r.target.nodeType === 1 ? r.target.closest('select') : r.target.parentElement?.closest('select');
      if (s) controls.get(s)?.sync();
      if (r.type === 'attributes' && r.target.tagName === 'FIELDSET') r.target.querySelectorAll('select').forEach(s => controls.get(s)?.sync());
    }
  }).observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['disabled','selected','label','aria-label']});
  document.addEventListener('pointerdown', e => { if (opened && !opened.wrap.contains(e.target)) opened.close(); });
  document.addEventListener('focusin', e => { if (opened && !opened.wrap.contains(e.target)) opened.close(); });
  document.addEventListener('scroll', e => { if (opened && !opened.list.contains(e.target)) opened.close(); }, true);
  window.addEventListener('resize', () => opened?.close());
  document.addEventListener('reset', () => setTimeout(() => document.querySelectorAll('select').forEach(s => controls.get(s)?.sync()), 0));
  window.StudioUI = {sync: () => { scan(); document.querySelectorAll('select').forEach(s => controls.get(s)?.sync()); }};
  scan();
})();

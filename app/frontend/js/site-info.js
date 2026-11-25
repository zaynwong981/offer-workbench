/* Local metadata and an optional link to the project. No GitHub API or tracking. */
(() => {
  const repository = 'https://github.com/zaynwong981/offer-workbench';
  function createSupport() {
    const note = document.createElement('aside');
    note.className = 'support-note'; note.setAttribute('aria-label', '支持开源项目');
    const star = document.createElement('button');
    star.type = 'button'; star.className = 'support-star';
    star.title = star.ariaLabel = '暂停星星转动';
    star.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2 2 9.3l6.9-1Z"/></svg>';
    star.onclick = () => {
      const paused = star.classList.toggle('is-paused');
      star.title = star.ariaLabel = paused ? '继续星星转动' : '暂停星星转动';
    };
    const message = document.createElement('p');
    message.textContent = '如果 Offer Workbench 帮到了你，请在 GitHub 点个 Star，这对我们意义重大';
    const link = document.createElement('a');
    link.className = 'support-link'; link.href = repository;
    link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = '去点 Star';
    link.setAttribute('aria-label', '去点 Star（在新标签页打开 GitHub 项目）');
    note.append(star, message, link); return note;
  }
  window.WorkbenchSupport = {create: createSupport};
  function init() {
    document.querySelectorAll('[data-star-support]').forEach(el => el.replaceWith(createSupport()));
    fetch('/api/about').then(response => {
      if (!response.ok) throw new Error('metadata unavailable');
      return response.json();
    }).then(info => {
      document.querySelectorAll('[data-build-info]').forEach(el => {
        const link = document.createElement('a');
        link.href = repository; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.textContent = 'GitHub';
        el.replaceChildren(document.createTextNode(`Offer Workbench v${info.version} · `), link);
      });
      document.querySelectorAll('[data-release-detail]').forEach(el => {
        el.textContent = `当前版本 v${info.version} · 更新于 ${info.updatedOn}`;
      });
    }).catch(() => {
      document.querySelectorAll('[data-build-info]').forEach(el => {el.textContent = 'Offer Workbench · 版本暂不可用'});
      document.querySelectorAll('[data-release-detail]').forEach(el => {el.textContent = '版本信息暂不可用，请检查本机服务'});
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();

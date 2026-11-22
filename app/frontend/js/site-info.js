/* Display release metadata from the local server; no external requests. */
(() => {
  fetch('/api/about').then(response => {
    if (!response.ok) throw new Error('metadata unavailable');
    return response.json();
  }).then(info => {
    document.querySelectorAll('[data-build-info]').forEach(el => {
      el.replaceChildren();
      const link = document.createElement('a');
      link.href = 'https://github.com/zaynwong981/offer-workbench';
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = `${info.developer} · GitHub`;
      el.append(document.createTextNode(`v${info.version} · `), link);
    });
    document.querySelectorAll('[data-release-detail]').forEach(el => {
      el.textContent = `当前版本 v${info.version} · 更新于 ${info.updatedOn}`;
    });
  }).catch(() => {
    document.querySelectorAll('[data-build-info]').forEach(el => {el.textContent = 'OfferWorkbench · 版本暂不可用'});
    document.querySelectorAll('[data-release-detail]').forEach(el => {el.textContent = '版本信息暂不可用，请检查本机服务'});
  });
})();

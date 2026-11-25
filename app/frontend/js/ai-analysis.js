/* Compact analysis presentation. Evidence stays in the local draft. */
(function (root) {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  function plainText(result = {}) {
    if (result.groups) return result.groups.map(g => g.category + '：' + g.tags.map(t => t.label).join('、'))
      .concat(['候选人画像：' + result.profile.text]).join('\n');
    if (result.directions) return result.directions.map(d =>
      d.industry + ' · ' + d.role + '\n' + d.reason + '\n岗位搜索词：' + d.keywords.join('、')).join('\n\n');
    return result.text || (result.items || []).map(i => i.text).join('\n');
  }

  function render(result, task) {
    if (task === 'extract' && result.groups) {
      return '<div class="ai-keyword-groups">' + result.groups.map(g =>
        '<section><h3>' + escape(g.category) + '</h3><div class="ai-tags">' +
        g.tags.map(t => '<span class="ai-tag">' + escape(t.label) + '</span>').join('') +
        '</div></section>').join('') + '</div><section class="ai-candidate-profile"><h3>候选人画像</h3><p>' +
        escape(result.profile.text) + '</p></section>';
    }
    if (task === 'explore' && result.directions) {
      return '<p class="hint">点击岗位词可填入搜索框，保留其他筛选条件；由你决定是否搜索。</p>' +
        result.directions.map(d => '<article class="ai-direction"><p class="ai-industry">' + escape(d.industry) +
          '</p><h3>' + escape(d.role) + '</h3><p>' + escape(d.reason) + '</p><div class="ai-tags">' +
          d.keywords.map(k => '<button type="button" class="ai-keyword" data-search-keyword="' + escape(k) +
            '" title="填入搜索框">' + escape(k) + '</button>').join('') + '</div></article>').join('');
    }
    return (result.items || []).map(i => '<article><p>' + escape(i.text) + '</p></article>').join('');
  }

  const api = {render, plainText};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AnalysisResults = api;
})(typeof globalThis === 'object' ? globalThis : this);

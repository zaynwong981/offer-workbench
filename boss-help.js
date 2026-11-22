(() => {
  const commands = {
    mac: 'open -na "Google Chrome" --args --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir="$HOME/.career-studio-chrome" "https://www.zhipin.com/"',
    windows: '"%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\\career-studio-chrome" https://www.zhipin.com/',
    linux: 'google-chrome --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir="$HOME/.career-studio-chrome" https://www.zhipin.com/'
  };
  const instructions = {
    mac: '推荐：在工作台所在文件夹双击「连接BOSS浏览器.command」。也可按 Command + 空格，搜索并打开「终端」，粘贴下方命令后按回车。',
    windows: '按 Win + R，输入 cmd 并回车，打开「命令提示符」（此命令不要粘贴到 PowerShell）。粘贴下方命令后按回车。',
    linux: '打开 Terminal（终端），粘贴下方命令后按回车。Chrome 命令名因安装方式可能不同。'
  };
  function select(os) {
    document.querySelector('#launch-command').textContent = commands[os];
    document.querySelector('#launch-instruction').textContent = instructions[os];
    document.querySelector('#launch-panel').setAttribute('aria-labelledby','tab-' + os);
    document.querySelectorAll('[data-os]').forEach(b => { b.setAttribute('aria-selected', String(b.dataset.os === os)); b.tabIndex = b.dataset.os === os ? 0 : -1; });
  }
  document.querySelectorAll('[data-os]').forEach(b => {
    b.onclick = () => select(b.dataset.os);
    b.onkeydown = e => { if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return; e.preventDefault(); const keys = Object.keys(commands), i = keys.indexOf(b.dataset.os), next = e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (i + (e.key === 'ArrowRight' ? 1 : 2)) % 3; select(keys[next]); document.querySelector('#tab-' + keys[next]).focus(); };
  });
  select(/Win/.test(navigator.platform) ? 'windows' : /Linux/.test(navigator.platform) ? 'linux' : 'mac');
  document.querySelectorAll('[data-copy]').forEach(button => button.onclick = async () => {
    const content = document.getElementById(button.dataset.copy).textContent;
    try { await navigator.clipboard.writeText(content); button.textContent = '已复制，请在终端执行'; }
    catch { const range = document.createRange(); range.selectNodeContents(document.getElementById(button.dataset.copy)); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); button.textContent = '已选中命令，请按系统复制快捷键'; }
  });
  document.querySelector('#check-boss').onclick = async event => {
    const button = event.currentTarget, status = document.querySelector('#help-status'); button.disabled = true; status.textContent = '正在检查本机工具…';
    try { const r = await fetch('/api/boss/status'); if (!r.ok) throw new Error('服务暂不可用，请确认工作台仍在运行。'); const data = await r.json(); status.textContent = (data.available ? 'CLI 已安装' : 'CLI 未就绪') + (data.version ? ' · ' + data.version : '') + (data.blocked ? '。检测到本机风险停止状态；本次没有发起平台请求。请按下方风险排障指南处理。' : '。未检测到本机风险停止状态；在线登录和平台可用性仍未验证。' + (data.message || '')); }
    catch (e) { status.textContent = e.message; }
    finally { button.disabled = false; }
  };
})();

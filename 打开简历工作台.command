#!/bin/zsh
set -eu
studio_dir="${0:A:h}"
cd "$studio_dir"
if [[ -x "$studio_dir/.venv/bin/python" ]]; then
  runtime_python="$studio_dir/.venv/bin/python"
elif [[ -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3" ]]; then
  runtime_python="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
else
  runtime_python="$(command -v python3)"
fi
if ! "$runtime_python" -c 'import reportlab, PIL' 2>/dev/null; then
  print '请先运行：python3 -m venv .venv && .venv/bin/pip install -r requirements.txt'
  read -k 1 '?按任意键退出'
  exit 1
fi
nohup "$runtime_python" "$studio_dir/server.py" --open >> "$studio_dir/server.log" 2>&1 &
print 'OfferWorkbench 已启动：http://127.0.0.1:8766/'
print '浏览器将自动打开；此窗口可以关闭。'

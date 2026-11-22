#!/bin/zsh
set -eu
if [[ ! -d '/Applications/Google Chrome.app' ]]; then
  print '请先安装 Google Chrome；详见工作台中的连接说明。'
  read -k 1 '?按任意键退出'
  exit 1
fi
open -na 'Google Chrome' --args --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir="$HOME/.career-studio-chrome" 'https://www.zhipin.com/'
print '请在新打开的专用 Chrome 窗口登录 BOSS，并保持该窗口运行。'
print '随后回到求职工作台点击搜索。此脚本不处理账号、验证码或投递。'

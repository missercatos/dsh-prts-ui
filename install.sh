#!/bin/sh
#
# PRTS v0.0.1(new) — Linux / macOS 整合包安装器入口。
# 只是一个薄启动器：真正工作交给零依赖的 Node wizard(wizard/server.mjs)。
# 引导策略见 wizard（新整合包不附带任何自研界面）：
#   1) 检查系统是否自带 dsh，没有则自动安装(国内镜像回退)；
#   2) 询问要安装哪些插件，安装到官方 dsh web 的 web profile；
#   3) 生成 prts 启动命令与桌面快捷方式，打开官方 dsh web。
#
#   sh install.sh [path/to/dsh-prts-ui-<ver>.tgz]
#
set -eu

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "PRTS: 需要 Node.js —— 请从 https://nodejs.org 安装（中国大陆可用 https://npmmirror.com/mirrors/node/）后重试。" >&2
  exit 1
fi
# 显式指定安装包（可选）：相对路径按脚本所在目录解析，避免依赖调用者的 cwd。
if [ -n "${1:-}" ]; then
  case "$1" in
    /*) export PRTS_WIZARD_TGZ="$1" ;;
    *)  export PRTS_WIZARD_TGZ="$SRC_DIR/$1" ;;
  esac
fi
exec node "$SRC_DIR/wizard/server.mjs"

#!/usr/bin/env bash
# ============================================================
# VECTRA — 一键安装脚本 (Linux / macOS)
# 用法: bash install.sh
# 行为: 拉取代码 → 生成启动器 → 创建桌面快捷方式
# ============================================================

set -u
REPO_URL="https://github.com/ChinaHaJiMi/Vectra.git"
INSTALL_DIR="$HOME/Vectra"
PROJECT_URL="http://localhost:8080"
UPDATE_EVERY=20

# 颜色
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}!${NC} %s\n" "$1"; }
fail() { printf "${RED}✗${NC} %s\n" "$1"; }

echo "======================================"
echo "  VECTRA — AI NPC 模拟系统 一键安装"
echo "======================================"

OS="$(uname -s)"

# ---- 0. 环境检测 ----
command -v python3 >/dev/null 2>&1 || { fail "未找到 python3。请先安装: https://www.python.org/downloads/"; exit 1; }
command -v git >/dev/null 2>&1 || { fail "未找到 git。请先安装: Linux: sudo apt install git / macOS: brew install git"; exit 1; }
ok "检测到 $(python3 --version 2>&1) / git"

# ---- 1. 拉取代码 ----
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "检测到已安装版本，正在更新..."
  git -C "$INSTALL_DIR" pull --ff-only --quiet && ok "代码已更新" || warn "更新失败(可能无网络)，继续使用现有版本"
else
  echo "正在克隆仓库到 $INSTALL_DIR ..."
  mkdir -p "$HOME"
  if git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"; then
    ok "代码克隆完成"
  else
    fail "克隆失败。请检查网络或仓库地址: $REPO_URL"
    exit 1
  fi
fi

cd "$INSTALL_DIR" || { fail "无法进入目录 $INSTALL_DIR"; exit 1; }

# ---- 2. 生成启动器 run-vectra.sh ----
cat > "$INSTALL_DIR/run-vectra.sh" <<EOF
#!/usr/bin/env bash
# VECTRA 启动器（安装器自动生成，请勿修改）
DIR="\$(cd "\$(dirname "\$0")" && pwd)"
cd "\$DIR"

COUNT_FILE="\$DIR/.vectra_launch_count"
COUNT=0
[ -f "\$COUNT_FILE" ] && COUNT="\$(cat "\$COUNT_FILE" 2>/dev/null || echo 0)"
COUNT=\$((COUNT + 1))
echo "\$COUNT" > "\$COUNT_FILE"

if [ \$((COUNT % $UPDATE_EVERY)) -eq 0 ] && command -v git >/dev/null 2>&1; then
  echo "[Vectra] 第 \$COUNT 次启动，检查更新..."
  git pull --ff-only --quiet 2>/dev/null && echo "[Vectra] 已更新" || echo "[Vectra] 无更新或离线"
fi

command -v python3 >/dev/null 2>&1 || { echo "缺少 python3，无法启动。"; read -p "按回车退出"; exit 1; }

VECTRA_NO_SSL=1 python3 server.py &
SRV=\$!
sleep 2
if [ "\$(uname -s)" = "Darwin" ]; then
  open "$PROJECT_URL"
else
  command -v xdg-open >/dev/null 2>&1 && xdg-open "$PROJECT_URL" >/dev/null 2>&1
fi
echo "Vectra 已启动: $PROJECT_URL  (Ctrl+C 停止)"
wait \$SRV
EOF
chmod +x "$INSTALL_DIR/run-vectra.sh"
ok "启动器已生成: $INSTALL_DIR/run-vectra.sh"

# ---- 3. 创建桌面快捷方式 ----
if [ "$OS" = "Darwin" ]; then
  # macOS: 生成可双击的 .command（双击自动打开终端运行）
  DESKTOP_DIR="$HOME/Desktop"
  [ -d "$HOME/桌面" ] && DESKTOP_DIR="$HOME/桌面"
  CMD_FILE="$DESKTOP_DIR/Vectra.command"
  cat > "$CMD_FILE" <<EOF
#!/usr/bin/env bash
exec bash "$INSTALL_DIR/run-vectra.sh"
EOF
  chmod +x "$CMD_FILE"
  ok "已创建: $CMD_FILE（双击启动）"
  warn "若 macOS 提示「无法验证开发者」，请右键→打开 或执行: xattr -dr com.apple.quarantine \"$CMD_FILE\""
else
  # Linux: .desktop 文件
  DESKTOP_DIR="$HOME/Desktop"
  [ -d "$HOME/桌面" ] && DESKTOP_DIR="$HOME/桌面"
  if [ -n "${XDG_DESKTOP_DIR:-}" ] && [ -d "$XDG_DESKTOP_DIR" ]; then DESKTOP_DIR="$XDG_DESKTOP_DIR"; fi

  DESKTOP_FILE="$DESKTOP_DIR/vectra.desktop"
  cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Vectra
Name[zh_CN]=Vectra
Comment=AI NPC Simulation
Comment[zh_CN]=AI NPC 模拟系统
Exec=bash "$INSTALL_DIR/run-vectra.sh"
Icon=utilities-terminal
Terminal=true
Categories=Game;Simulation;
EOF
  chmod +x "$DESKTOP_FILE"
  # GNOME 信任标记，否则双击被拦截
  command -v gio >/dev/null 2>&1 && gio set "$DESKTOP_FILE" metadata::trusted true 2>/dev/null
  ok "已创建桌面快捷方式: $DESKTOP_FILE"
fi

# ---- 4. 完成 ----
echo ""
echo "======================================"
echo "  VECTRA 安装完成！"
echo "  安装目录: $INSTALL_DIR"
echo "  数据目录: ~/VectraData"
echo "  双击桌面 Vectra 图标即可启动"
echo "======================================"

#!/bin/sh
# 音乐可视化 - 跨平台启动脚本（Linux / macOS）
cd "$(dirname "$0")"

PORT=8080

# 检查端口是否已被占用（已有服务器则直接打开）
if command -v lsof >/dev/null 2>&1; then
  if lsof -i :"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "端口 $PORT 已有服务器在运行"
    OPENED=1
  fi
elif command -v ss >/dev/null 2>&1; then
  if ss -ltn 2>/dev/null | grep -q ":$PORT "; then
    echo "端口 $PORT 已有服务器在运行"
    OPENED=1
  fi
fi

# 启动服务器（优先 python3，其次 python）
if [ -z "$OPENED" ]; then
  if command -v python3 >/dev/null 2>&1; then
    python3 -m http.server "$PORT" --bind 127.0.0.1 &
    SRV_PID=$!
  elif command -v python >/dev/null 2>&1; then
    python -m http.server "$PORT" --bind 127.0.0.1 &
    SRV_PID=$!
  else
    echo "未找到 Python，请先安装 Python 3。"
    echo "或使用任意静态服务器：npx serve . / php -S localhost:8080"
    exit 1
  fi
  sleep 2
fi

URL="http://127.0.0.1:$PORT"
echo "已启动: $URL"

# 打开浏览器（按平台）
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1
elif command -v open >/dev/null 2>&1; then
  open "$URL" >/dev/null 2>&1
fi

echo "停止服务器: Ctrl+C（或关闭终端）"
[ -n "$SRV_PID" ] && wait "$SRV_PID"

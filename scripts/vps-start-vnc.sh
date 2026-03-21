#!/usr/bin/env bash
# Start Xvfb on :99 and x11vnc so you can VNC in and run: DISPLAY=:99 npm run login
# Usage: bash scripts/vps-start-vnc.sh
# Requires: apt install -y xvfb x11vnc

set -e
DISPLAY_NUM="${VPS_DISPLAY:-:99}"
PORT="${VNC_PORT:-5900}"

if ! command -v Xvfb >/dev/null || ! command -v x11vnc >/dev/null; then
  echo "Install dependencies: apt update && apt install -y xvfb x11vnc"
  exit 1
fi

# Start Xvfb if not already running for this display
if ! pgrep -f "Xvfb ${DISPLAY_NUM}" >/dev/null; then
  echo "Starting Xvfb on ${DISPLAY_NUM}..."
  Xvfb "${DISPLAY_NUM}" -screen 0 1920x1080x24 -ac &
  sleep 2
else
  echo "Xvfb ${DISPLAY_NUM} already running."
fi

echo ""
echo "Starting x11vnc on port ${PORT} (display ${DISPLAY_NUM})..."
echo "  INSECURE: using -nopw. For production set a password: x11vnc -storepasswd ~/.vnc/passwd"
echo "  Then: x11vnc -display ${DISPLAY_NUM} -forever -shared -rfbport ${PORT} -rfbauth ~/.vnc/passwd"
echo ""
echo "Connect: VNC Viewer -> SERVER_IP:${PORT}"
echo "Or SSH tunnel:  ssh -L ${PORT}:127.0.0.1:${PORT} root@SERVER_IP"
echo "              then VNC -> 127.0.0.1:${PORT}"
echo ""
echo "In another SSH session:"
echo "  export DISPLAY=${DISPLAY_NUM}"
echo "  cd /opt/Shopify-Playwright && PLAYWRIGHT_CHANNEL=chrome node index.js login"
echo ""

exec x11vnc -display "${DISPLAY_NUM}" -forever -shared -rfbport "${PORT}" -nopw

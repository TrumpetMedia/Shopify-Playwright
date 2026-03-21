# Shopify login on VPS via VNC + Xvfb

Headed Chrome needs a display. On a server there is no monitor, so we use **Xvfb** (virtual framebuffer) and **x11vnc** so you can **see the same screen** from your PC with a VNC client.

## 1. One-time install (on the VPS)

```bash
apt update && apt install -y xvfb x11vnc
```

## 2. Open the firewall (if needed)

Allow **TCP 5900** from **your IP only** (InterServer panel / `ufw`), **or** skip opening the public internet and use **SSH tunnel** (recommended, section 5).

## 3. Start virtual display + VNC (SSH session 1)

Pick a fixed display **`:99`** (must match what you use for login).

```bash
export DISPLAY=:99

# Kill old Xvfb on :99 if you restart (optional)
# pkill -f "Xvfb :99" 2>/dev/null; sleep 1

Xvfb :99 -screen 0 1920x1080x24 -ac &
sleep 2

# VNC server attached to that display (set a password the first time)
x11vnc -display :99 -forever -shared -rfbport 5900 -nopw
```

For production, use a password instead of `-nopw`:

```bash
x11vnc -storepasswd ~/.vnc/passwd   # interactive, enter password twice
x11vnc -display :99 -forever -shared -rfbport 5900 -rfbauth ~/.vnc/passwd
```

Leave this SSH session **open** while you work (or run it under `screen`/`tmux`).

## 4. Connect with VNC from your PC

- **VNC Viewer** (RealVNC, TigerVNC, etc.): connect to `YOUR_VPS_IP:5900`
- You should see a **blank desktop** (grey/black) — that is display `:99` with no window yet.

## 5. (Recommended) SSH tunnel instead of exposing port 5900

On **your PC** (PowerShell or terminal):

```bash
ssh -L 5900:127.0.0.1:5900 root@YOUR_VPS_IP
```

Keep that SSH session open. In VNC Viewer connect to **`127.0.0.1:5900`** (localhost). No need to open 5900 on the public firewall.

## 6. Run Shopify login on the **same** display (SSH session 2)

Open a **second** SSH to the same VPS:

```bash
cd /opt/Shopify-Playwright   # or your project path
export DISPLAY=:99
export LIBGL_ALWAYS_SOFTWARE=1
PLAYWRIGHT_CHANNEL=chrome node index.js login
```

A Chrome window should appear **inside the VNC session**. Log in to Shopify, then press **Enter** in the terminal when done.

If Playwright ever picks the wrong display, ensure **`DISPLAY=:99`** is set in **this** shell before running `node`.

## 7. Daily runs (cron / manual)

Use the same virtual display for consistency, **or** use `xvfb-run` for unattended runs:

```bash
export DISPLAY=:99
PLAYWRIGHT_CHANNEL=chrome HEADFUL_RUN=1 node index.js run
```

(Requires Xvfb still running on `:99` from step 3.)

Alternatively keep using:

```bash
xvfb-run -a -s "-screen 0 1920x1080x24" npm run run
```

## Troubleshooting

| Problem | What to try |
|--------|-------------|
| Black screen in VNC, no Chrome | Confirm `DISPLAY=:99` in the shell where you run `node index.js login`. |
| Chrome still says no display | Start `Xvfb :99` first (step 3), wait `sleep 2`, then login. |
| Port in use | `ss -tlnp \| grep 5900` — change port: `-rfbport 5901` and tunnel `-L 5901:127.0.0.1:5901`. |
| x11vnc fails | Install `apt install -y x11vnc xvfb` and retry. |

## Security

- Prefer **SSH tunnel** for VNC; avoid `-nopw` on a server reachable from the internet.
- After login, you can stop x11vnc/Xvfb if you only need `xvfb-run` for cron.

# Full steps: VPS + Xvfb + x11vnc + RealVNC Viewer + Shopify login

Use this when you must **log in on the VPS** (session tied to server IP). You need **two SSH sessions** (or one SSH + one that stays on VNC) and **RealVNC Viewer** on your PC.

---

## Part 1 — RealVNC Viewer (Windows, one-time install)

1. Download: https://www.realvnc.com/en/connect/download/viewer/
2. Install **VNC Viewer** (not Server).
3. Open **VNC Viewer** from the Start menu.

---

## Part 2 — SSH “Terminal A” (start virtual screen + VNC server)

Open **PowerShell** or **Terminal** on your PC:

```text
ssh root@YOUR_VPS_IP
```

(Replace `YOUR_VPS_IP` with your server IP, e.g. `74.50.69.236`.)

**Run these commands on the VPS:**

```bash
# One-time packages (skip if already installed)
apt update && apt install -y xvfb x11vnc
```

```bash
# Stop old instances (safe if nothing was running)
pkill -f "Xvfb :99" 2>/dev/null
pkill x11vnc 2>/dev/null
sleep 1

# Start virtual display :99
export DISPLAY=:99
Xvfb :99 -screen 0 1920x1080x24 -ac &
sleep 2

# Share that display over VNC on port 5900 (no password for testing)
x11vnc -display :99 -forever -shared -rfbport 5900 -nopw
```

**Wait until you see a line like:** `Listening for VNC connections on TCP port 5900`

**Leave this SSH window open** while you work. (Do not close it.)

---

## Part 3 — RealVNC Viewer (on your PC)

### Option A — Direct connection (if port 5900 is allowed)

1. In **VNC Viewer**, click the search bar: **Enter a device address or search**
2. Type: **`YOUR_VPS_IP:5900`** (example: `74.50.69.236:5900`)
3. Press **Enter** and accept any certificate prompt.

You should see a **grey/black** screen (empty desktop). That is normal.

### Option B — If connection fails (firewall blocks 5900)

**On your PC**, open a **new** PowerShell window (keep Terminal A SSH running on the VPS):

```powershell
ssh -L 5900:127.0.0.1:5900 root@YOUR_VPS_IP
```

Enter password, **leave this window open**.

In **VNC Viewer**, connect to:

**`127.0.0.1:5900`**

---

## Part 4 — SSH “Terminal B” (run Shopify login)

Open a **second** SSH session to the same VPS:

```text
ssh root@YOUR_VPS_IP
```

```bash
cd /opt/Shopify-Playwright
```

(Adjust path if your project is elsewhere.)

```bash
export DISPLAY=:99
export LIBGL_ALWAYS_SOFTWARE=1
PLAYWRIGHT_CHANNEL=chrome node index.js login
```

**Watch the RealVNC window** (not the SSH text): **Chrome** should open on the grey screen.

1. Log in to Shopify in that Chrome window (email, password, 2FA if asked).
2. Wait until the **Shopify admin** loads.
3. Go back to **Terminal B** and press **Enter** when it says:  
   `Press Enter after login is complete and the admin loads…`

Terminal B will exit; the session is saved under `profiles/main`.

---

## Part 5 — Stop VNC (when finished)

In **Terminal A**, press **Ctrl+C** to stop `x11vnc`.

Optional — kill Xvfb:

```bash
pkill -f "Xvfb :99"
```

---

## Part 6 — Daily scrape (after login works)

Use the same profile; headful under Xvfb:

```bash
cd /opt/Shopify-Playwright
export LIBGL_ALWAYS_SOFTWARE=1
HEADFUL_RUN=1 PLAYWRIGHT_CHANNEL=chrome xvfb-run -a -s "-screen 0 1920x1080x24" npm run run
```

Or if you keep **Xvfb :99** running:

```bash
export DISPLAY=:99
PLAYWRIGHT_CHANNEL=chrome HEADFUL_RUN=1 node index.js run
```

---

## Quick checklist

| Step | Where | What |
|------|--------|------|
| 1 | PC | Install VNC Viewer |
| 2 | SSH A | `Xvfb` + `x11vnc` on `:99` / port `5900`, leave running |
| 3 | PC | VNC → `IP:5900` or tunnel → `127.0.0.1:5900` |
| 4 | SSH B | `DISPLAY=:99` + `node index.js login` |
| 5 | VNC window | Log in to Shopify in Chrome |
| 6 | SSH B | Press Enter when admin is loaded |

---

## Security note

`-nopw` is for quick testing. For production, set a VNC password (`x11vnc -storepasswd`) or **always use SSH tunnel** (`-L 5900:...`) so VNC is not exposed to the internet.

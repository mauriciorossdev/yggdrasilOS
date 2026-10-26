import { BrowserWindow } from "electron";

// Shown from the first moment of app.whenReady until the first project window
// is ready, so the multi-second gateway boot doesn't look like the app never
// opened. Self-contained on purpose (inline HTML, no preload/IPC, no bundled
// assets): it has to exist before anything else in startup is set up, and a
// failure here must never get in the way of the real window.
const HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; height: 100%; background: #1a1918; color: #f1efe7;
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif; overflow: hidden;
    -webkit-user-select: none; user-select: none; }
  body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px;
    box-sizing: border-box; border: 1px solid #3a3835; }
  h1 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-weight: 500; font-size: 34px; letter-spacing: 0.5px; }
  .spinner { width: 26px; height: 26px; border-radius: 50%; border: 3px solid #3a3835; border-top-color: #d97757;
    animation: spin 0.9s linear infinite; }
  #status { font-size: 13px; color: #9a968c; min-height: 16px; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <h1>Yggdrasil</h1>
  <div class="spinner"></div>
  <div id="status">Starting…</div>
</body>
</html>`;

export type Splash = {
  setStatus(text: string): void;
  close(): void;
};

export function createSplash(): Splash {
  let win: BrowserWindow | null = null;
  let ready = false;
  let pending: string | null = null;

  const push = (text: string): void => {
    if (!win || win.isDestroyed()) return;
    void win.webContents
      .executeJavaScript(`document.getElementById("status").textContent = ${JSON.stringify(text)}`)
      .catch(() => {});
  };

  try {
    win = new BrowserWindow({
      width: 420,
      height: 260,
      frame: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      center: true,
      show: false,
      backgroundColor: "#1a1918",
    });
    win.once("ready-to-show", () => win?.show());
    win.webContents.once("did-finish-load", () => {
      ready = true;
      if (pending !== null) push(pending);
    });
    win.on("closed", () => {
      win = null;
    });
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`).catch(() => {});
  } catch {
    win = null;
  }

  return {
    setStatus(text) {
      pending = text;
      if (ready) push(text);
    },
    close() {
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
    },
  };
}

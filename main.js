// Winampify desktop shell (castLabs Electron, which can play Spotify's protected audio).
//
// One frameless, see-through window covers the screen's work area. Only the Winampify
// windows drawn by the page are visible; everywhere else the mouse passes straight
// through to the desktop and other apps, so the player windows float freely like a
// classic desktop player. The page is served from http://127.0.0.1:8888/ (the Redirect
// URI registered with Spotify) by a tiny built-in server, so no Python is needed.
const { app, BrowserWindow, components, screen, ipcMain, shell, Menu, session, desktopCapturer } = require('electron');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = 8888;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ICON = path.join(ROOT, 'icons', 'winampify.ico');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp',
};
// only the app's own files are served (never node_modules or anything else in the folder)
const PUBLIC = new Set(['index.html', 'app.js', 'style.css', 'manifest.json']);
const isPublic = rel => PUBLIC.has(rel) || /^icons\/[\w.-]+\.(png|ico|webp)$/.test(rel) || /^vendor\/[\w.-]+\.js$/.test(rel);

function startServer() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let rel;
      try { rel = decodeURIComponent(new URL(req.url, ORIGIN).pathname).replace(/^\/+/, '') || 'index.html'; }
      catch { res.writeHead(400); return res.end(); }
      if (!isPublic(rel)) { res.writeHead(404); return res.end('Not found'); }
      fs.readFile(path.join(ROOT, rel), (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(data);
      });
    });
    srv.once('error', reject);
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}
// Port already taken? If it's Winampify's own Python server (start.bat), just use it.
function isOurServer() {
  return new Promise(resolve => {
    http.get(ORIGIN + '/manifest.json', res => {
      let body = '';
      res.on('data', d => (body += d));
      res.on('end', () => resolve(res.statusCode === 200 && /"Winampify"/.test(body)));
    }).on('error', () => resolve(false));
  });
}

// troubleshooting only: set WINAMPIFY_DEBUG=1 to allow a local debugger on port 9229
if (process.env.WINAMPIFY_DEBUG) app.commandLine.appendSwitch('remote-debugging-port', '9229');

// a music player keeps running at full speed in the background
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

let win = null;   // the see-through layer that draws every Winampify window
let host = null;  // small player-sized window: the one the taskbar and Alt-Tab show
app.setAppUserModelId('Winampify');
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (host) { if (host.isMinimized()) host.restore(); host.show(); } if (win) win.focus(); });
app.on('window-all-closed', () => app.quit());

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  // Spotify says how long to wait in a "Retry-After" header, but browsers hide it from the
  // page unless the response allows it. Allow it, so Winampify waits exactly as long as asked.
  // (Electron keeps only one such hook, so it also lets the page read Deezer's public
  // "related artists" lists, used for the mix of similar music after a searched song.)
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['https://api.spotify.com/*', 'https://api.deezer.com/*'] }, (d, cb) => {
    const h = d.responseHeaders || {};
    if (d.url.startsWith('https://api.deezer.com/')) {
      for (const k of Object.keys(h)) if (k.toLowerCase() === 'access-control-allow-origin') delete h[k];
      h['Access-Control-Allow-Origin'] = ['*'];
      return cb({ responseHeaders: h });
    }
    const key = Object.keys(h).find(k => k.toLowerCase() === 'access-control-expose-headers');
    const cur = key ? [].concat(h[key]).join(', ') : '';
    if (key) delete h[key];
    h['Access-Control-Expose-Headers'] = [cur ? cur + ', Retry-After' : 'Retry-After'];
    cb({ responseHeaders: h });
  });
  // MilkDrop and the visualizer listen to what your PC is playing (Windows "loopback" capture).
  // Only Winampify's own page can ask, it never opens a picker, and the sound stays on this PC.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    if (!String(request.securityOrigin || request.frame?.url || '').startsWith(ORIGIN)) return callback({});
    desktopCapturer.getSources({ types: ['screen'] })
      .then(sources => callback(sources[0] ? { video: sources[0], audio: 'loopback' } : {}))
      .catch(() => callback({}));
  });
  try { await components.whenReady(); } catch (e) { console.error('Widevine component:', e); }
  try { await startServer(); }
  catch (e) {
    if (e.code !== 'EADDRINUSE' || !(await isOurServer())) {
      const { dialog } = require('electron');
      dialog.showErrorBox('Winampify', `Winampify needs port ${PORT}, but another program is using it.\nClose that program (or run stop-server.bat) and try again.`);
      return app.quit();
    }
  }

  // The see-through layer spans every monitor (the box around all their work areas), so
  // Winampify windows can be dragged from one screen to another like normal windows.
  const span = () => {
    const ds = screen.getAllDisplays();
    const L = Math.min(...ds.map(d => d.workArea.x)), T = Math.min(...ds.map(d => d.workArea.y));
    const R = Math.max(...ds.map(d => d.workArea.x + d.workArea.width)), B = Math.max(...ds.map(d => d.workArea.y + d.workArea.height));
    const prim = screen.getPrimaryDisplay().id;
    return {
      bounds: { x: L, y: T, width: R - L, height: B - T },
      // each monitor's usable area in page coordinates, for snapping and keeping windows visible
      displays: ds.map(d => ({ x: d.workArea.x - L, y: d.workArea.y - T, w: d.workArea.width, h: d.workArea.height, primary: d.id === prim })),
    };
  };
  const first = span().bounds;

  // Like the classic player, Winampify has one main window that the taskbar and Alt-Tab know
  // about, sized to just the player. It sits right underneath the player and shows a picture
  // of it (that picture is what Alt-Tab and the taskbar preview display). The full-screen
  // layer is "owned" by it: it stays on top of it, minimizes and restores with it, and is
  // left out of Alt-Tab and the taskbar.
  host = new BrowserWindow({
    x: first.x + 16, y: first.y + 16, width: 275, height: 232,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, maximizable: false, fullscreenable: false,
    title: 'Winampify', icon: ICON, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  host.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<!DOCTYPE html><html><head><title>Winampify</title><style>html,body{margin:0;background:transparent;overflow:hidden}' +
    'img{display:block;width:100vw;height:100vh;visibility:hidden}img.on{visibility:visible}</style></head>' +
    "<body><img id=\"i\" alt=\"\" onload=\"this.classList.add('on')\" onerror=\"this.classList.remove('on')\"></body></html>"));
  host.setAppDetails({
    appId: 'Winampify', appIconPath: ICON, appIconIndex: 0,
    // packaged Winampify.exe relaunches itself; the dev copy needs the folder path too
    relaunchCommand: app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${ROOT}"`, relaunchDisplayName: 'Winampify',
  });
  // picked from the taskbar or Alt-Tab: put the real player in front and give it the keyboard
  // A taskbar click while Winampify is already in front first takes the keyboard away from the
  // player, then hands it to this window. Seeing those two right after each other means
  // "click to minimize", like any other app.
  let playerBlurAt = 0;
  host.on('focus', () => {
    if (!win || win.isDestroyed()) return;
    if (Date.now() - playerBlurAt < 400) { playerBlurAt = 0; host.minimize(); return; }
    win.moveTop(); win.focus();
  });
  app.on('browser-window-blur', (_e, w) => { if (w === win) playerBlurAt = Date.now(); });
  host.on('closed', () => app.quit());

  // Buttons under the taskbar preview (point at Winampify on the taskbar):
  // previous, play, pause, stop, next. They work without bringing Winampify to the front.
  const thumbIcons = {};
  const drawIcon = shapes => {
    // 32x32 picture (shown at 16x16 on normal screens), white shapes, smoothed edges
    const W = 32, S = 4, buf = Buffer.alloc(W * W * 4);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      let hit = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const px = x + (sx + 0.5) / S, py = y + (sy + 0.5) / S;
        if (shapes.some(f => f(px, py))) hit++;
      }
      const a = Math.round(255 * hit / (S * S)), o = (y * W + x) * 4;
      buf[o] = buf[o + 1] = buf[o + 2] = a; buf[o + 3] = a;   // premultiplied white
    }
    return require('electron').nativeImage.createFromBitmap(buf, { width: W, height: W, scaleFactor: 2 });
  };
  const rect = (x1, y1, x2, y2) => (x, y) => x >= x1 && x <= x2 && y >= y1 && y <= y2;
  const triR = (x1, y1, x2, y2) => (x, y) => x >= x1 && x <= x2 && Math.abs(y - (y1 + y2) / 2) <= ((y2 - y1) / 2) * (x2 - x) / (x2 - x1);
  const triL = (x1, y1, x2, y2) => (x, y) => x >= x1 && x <= x2 && Math.abs(y - (y1 + y2) / 2) <= ((y2 - y1) / 2) * (x - x1) / (x2 - x1);
  const getIcons = () => {
    if (thumbIcons.play) return thumbIcons;
    thumbIcons.prev = drawIcon([rect(6, 7, 9, 25), triL(9, 7, 26, 25)]);
    thumbIcons.play = drawIcon([triR(8, 6, 26, 26)]);
    thumbIcons.pause = drawIcon([rect(8, 7, 13, 25), rect(19, 7, 24, 25)]);
    thumbIcons.stop = drawIcon([rect(8, 8, 24, 24)]);
    thumbIcons.next = drawIcon([triR(6, 7, 23, 25), rect(23, 7, 26, 25)]);
    return thumbIcons;
  };
  const send = cmd => () => { if (win && !win.isDestroyed()) win.webContents.send('thumb-cmd', cmd); };
  function setThumbar() {
    if (!host || host.isDestroyed() || process.platform !== 'win32') return;
    const i = getIcons();
    host.setThumbarButtons([
      { tooltip: 'Previous', icon: i.prev, click: send('prev') },
      { tooltip: 'Play', icon: i.play, click: send('play') },
      { tooltip: 'Pause', icon: i.pause, click: send('pause') },
      { tooltip: 'Stop', icon: i.stop, click: send('stop') },
      { tooltip: 'Next', icon: i.next, click: send('next') },
    ]);
  }

  win = new BrowserWindow({
    parent: host, skipTaskbar: true,
    x: first.x, y: first.y, width: first.width, height: first.height,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, movable: false, maximizable: false, fullscreenable: false,
    title: 'Winampify', icon: ICON, show: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required', // a music player may start audio without an extra click
      backgroundThrottling: false,                // keep playback and timers running when the app isn't focused
    },
  });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.once('ready-to-show', () => { host.show(); win.show(); setThumbar(); });
  // Windows forgets the buttons when the taskbar restarts or the window is restored: set them again
  host.on('show', setThumbar); host.on('restore', setThumbar);

  // page log, for troubleshooting: %APPDATA%/winampify/winampify.log (kept small)
  const logFile = path.join(app.getPath('userData'), 'winampify.log');
  try { if (fs.statSync(logFile).size > 2e6) fs.unlinkSync(logFile); } catch {}
  win.webContents.on('console-message', (e) => {
    const msg = e.message ?? '';
    fs.appendFile(logFile, new Date().toISOString() + ' ' + msg + String.fromCharCode(10), () => {});
  });

  // links that open in a new tab (Wikipedia, artist links, Spotify dashboard) go to the real browser
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  // stay on Winampify or Spotify's login page; anything else opens in the browser
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(ORIGIN) || url.startsWith('https://accounts.spotify.com/') || url.startsWith('https://challenge.spotify.com/')) return;
    e.preventDefault(); shell.openExternal(url);
  });

  // The layer's real shape: just the Winampify windows (plus open menus / dialogs), so
  // screenshot tools and other window pickers see the desktop and other apps everywhere else.
  // Spotify's login page gets the full rectangle.
  let shapeKey = '';
  const setShape = rects => {
    if (!win || win.isDestroyed()) return;
    const key = JSON.stringify(rects || []);
    if (key === shapeKey) return;
    shapeKey = key;
    try { win.setShape(rects && rects.length ? rects : []); } catch (e) { console.error('setShape', e); }
  };
  ipcMain.on('layer-shape', (_e, rects) => setShape(rects));
  win.webContents.on('did-start-navigation', (d) => { if (d.isMainFrame && !String(d.url).startsWith(ORIGIN)) setShape([]); });

  // Spotify login pop-up: a small window just for Spotify's sign-in page. When Spotify sends
  // you back to Winampify's address, the pop-up closes and the player picks up the login.
  let loginWin = null;
  ipcMain.on('open-login', (_e, url) => {
    if (!String(url).startsWith('https://accounts.spotify.com/')) return;
    if (loginWin && !loginWin.isDestroyed()) { loginWin.loadURL(url); loginWin.focus(); return; }
    const W = 500, H = 720;
    const area = screen.getDisplayMatching(host.getBounds()).workArea;
    loginWin = new BrowserWindow({
      width: W, height: H, x: Math.round(area.x + (area.width - W) / 2), y: Math.round(area.y + Math.max(0, (area.height - H) / 2)),
      parent: host, modal: false, minimizable: false, maximizable: false, fullscreenable: false,
      title: 'Winampify - Log in to Spotify', icon: ICON, backgroundColor: '#121212', autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    loginWin.setMenu(null);
    const showSite = () => {
      let site = ''; try { site = new URL(loginWin.webContents.getURL()).host; } catch {}
      loginWin.setTitle(`Winampify - Log in to Spotify (${site || 'loading'})`);
    };
    loginWin.webContents.on('did-navigate', showSite);
    // show which site you're on in the title, so you can see it's really Spotify
    loginWin.webContents.on('page-title-updated', ev => { ev.preventDefault(); showSite(); });
    const finish = (ev, to) => {
      if (!String(to).startsWith(ORIGIN)) return;
      ev.preventDefault();
      loginWin.close();
      win.loadURL(to); // the player reloads with Spotify's answer and finishes connecting
    };
    loginWin.webContents.on('will-redirect', finish);
    loginWin.webContents.on('will-navigate', finish);
    // links inside the login page that open new windows (help, sign up) go to the real browser
    loginWin.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: 'deny' }; });
    loginWin.on('closed', () => { loginWin = null; });
    loginWin.loadURL(url);
  });

  ipcMain.on('ui-hover', (_e, over) => { if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!over, { forward: true }); });
  // Balance: a tiny helper sets the left/right volume of Winampify's own sound in Windows
  // (the same per-app volume the Windows mixer uses). It quits when Winampify does.
  let balancer = null;
  try {
    const exe = path.join(ROOT, 'helpers', 'balance.exe');
    if (fs.existsSync(exe)) {
      balancer = spawn(exe, [path.parse(process.execPath).name], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
      balancer.on('error', () => { balancer = null; });
      balancer.on('exit', () => { balancer = null; });
    }
  } catch { balancer = null; }
  // Settings > Always on top: keep the Winampify windows above other apps
  ipcMain.on('on-top', (_e, on) => { if (win && !win.isDestroyed()) win.setAlwaysOnTop(!!on, 'floating'); });

  ipcMain.on('balance', (_e, v) => {
    const n = Math.max(-100, Math.min(100, Math.round(+v || 0)));
    try { balancer?.stdin.write(`pan ${n}\n`); } catch {}
  });
  app.on('before-quit', () => { try { balancer?.kill(); } catch {} });

  ipcMain.on('app-cmd', (_e, cmd) => { if (cmd === 'minimize') host.minimize(); else if (cmd === 'quit') app.quit(); });

  // The page reports where the player is (main + EQ + playlist). Keep the main window under
  // it and refresh the picture Alt-Tab shows. While a window is being dragged the picture is
  // cleared, so no ghost of the old position shows through.
  let player = null, dragging = false, shotTimer = 0, lastShot = '';
  // while dragging: make the picture window fully see-through, so it never shows a stale or
  // empty picture behind the moving player (it comes back with a fresh picture afterwards)
  const blank = () => { try { host.setOpacity(0); } catch {} host.webContents.executeJavaScript("document.getElementById('i').classList.remove('on')").catch(() => {}); };
  const snap = async () => {
    if (!player || dragging || !win.isVisible() || host.isMinimized()) return;
    try {
      const img = await win.webContents.capturePage({ x: Math.round(player.x), y: Math.round(player.y), width: Math.round(player.w), height: Math.round(player.h) });
      if (img.isEmpty()) return;
      const url = img.toDataURL();
      if (url === lastShot) return;
      lastShot = url;
      await host.webContents.executeJavaScript(`document.getElementById('i').src=${JSON.stringify(url)}`);
      try { host.setOpacity(1); } catch {}
    } catch {}
  };
  ipcMain.on('player-rect', (_e, r) => {
    if (!r || !host || host.isDestroyed()) return;
    player = r;
    const ob = win.getBounds();
    const b = { x: Math.round(ob.x + r.x), y: Math.round(ob.y + r.y), width: Math.max(1, Math.round(r.w)), height: Math.max(1, Math.round(r.h)) };
    if (!host.isMinimized()) host.setBounds(b);
    if (r.dragging && !dragging) { lastShot = ''; blank(); }
    dragging = !!r.dragging;
    clearTimeout(shotTimer);
    if (!dragging) shotTimer = setTimeout(snap, 250);
  });
  setInterval(snap, 8000); // keeps the Alt-Tab preview fresh without costly constant captures

  const fit = () => {
    if (!win || win.isDestroyed()) return;
    const sp = span();
    win.setBounds(sp.bounds);
    win.webContents.send('displays', sp.displays);
  };
  let fitTimer = 0;
  const fitSoon = () => { clearTimeout(fitTimer); fitTimer = setTimeout(fit, 300); };
  screen.on('display-metrics-changed', fitSoon);
  screen.on('display-added', fitSoon);
  screen.on('display-removed', fitSoon);
  ipcMain.handle('get-displays', () => span().displays);
  win.webContents.on('did-finish-load', fit);

  // sound (Chromium's audio service) and Spotify's decryption (the Widevine CDM) get an
  // above-normal priority, so the music keeps flowing smoothly while other apps work hard
  const os = require('os');
  const boosted = new Set();
  const boost = () => {
    for (const m of app.getAppMetrics()) {
      const name = String(m.serviceName || m.name || '');
      if (boosted.has(m.pid) || !(m.type === 'Utility' && /audio|cdm|media/i.test(name))) continue;
      try { os.setPriority(m.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL); boosted.add(m.pid); } catch {}
    }
  };
  setInterval(boost, 5000);

  win.loadURL(ORIGIN + '/');
});

const { app, BrowserWindow, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

const PORT = Number(process.env.PORT || 3007);
let mainWindow = null;
let serverInstance = null;

const desktopUpdateState = {
  status: 'idle',
  error: null,
  progress: null,
  version: null
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    title: 'Karaarslan Kömür Satış Otomasyonu',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const updateUrl = String(process.env.ELECTRON_UPDATE_URL || '').trim();
  if (updateUrl) {
    autoUpdater.setFeedURL({ provider: 'generic', url: updateUrl });
  }

  autoUpdater.on('checking-for-update', () => {
    Object.assign(desktopUpdateState, { status: 'checking', error: null });
  });

  autoUpdater.on('update-available', (info) => {
    Object.assign(desktopUpdateState, { status: 'downloading', version: info.version, error: null });
  });

  autoUpdater.on('update-not-available', () => {
    Object.assign(desktopUpdateState, { status: 'up-to-date', error: null });
  });

  autoUpdater.on('download-progress', (prog) => {
    Object.assign(desktopUpdateState, {
      status: 'downloading',
      progress: {
        percent: prog.percent,
        transferred: prog.transferred,
        total: prog.total,
        bytesPerSecond: prog.bytesPerSecond
      }
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    Object.assign(desktopUpdateState, { status: 'ready', version: info.version, progress: null });
  });

  autoUpdater.on('error', (err) => {
    Object.assign(desktopUpdateState, { status: 'error', error: err?.message || String(err) });
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('Guncelleme kontrolu basarisiz:', err?.message || err);
  });
}

function registerDesktopUpdateAPI() {
  const { app: expressApp } = require('./index');

  expressApp.get('/api/desktop-update-status', (req, res) => {
    res.json({ success: true, ...desktopUpdateState });
  });

  expressApp.post('/api/desktop-update-install', (req, res) => {
    if (desktopUpdateState.status !== 'ready') {
      return res.json({ success: false, message: 'Güncelleme henüz hazır değil.' });
    }
    res.json({ success: true, message: 'Yeniden başlatılıyor...' });
    setTimeout(() => autoUpdater.quitAndInstall(), 500);
  });

  expressApp.post('/api/desktop-update-check', (req, res) => {
    if (!app.isPackaged) {
      return res.json({ success: false, message: 'Masaüstü modunda değil.' });
    }
    Object.assign(desktopUpdateState, { status: 'checking', error: null });
    autoUpdater.checkForUpdates().catch((err) => {
      Object.assign(desktopUpdateState, { status: 'error', error: err?.message || 'Kontrol başarısız' });
    });
    res.json({ success: true, message: 'Kontrol başlatıldı.' });
  });
}

function stopServer() {
  if (!serverInstance) return;
  try {
    serverInstance.close();
  } catch (_) {}
  serverInstance = null;
}

function killPortProcess(port) {
  return new Promise((resolve) => {
    const { execSync } = require('child_process');
    try {
      const result = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8' });
      const lines = result.trim().split('\n');
      const pids = new Set();
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0' && pid !== String(process.pid)) pids.add(pid);
      }
      for (const pid of pids) {
        try { execSync(`taskkill /F /PID ${pid}`, { encoding: 'utf8' }); } catch (_) {}
      }
    } catch (_) {}
    setTimeout(resolve, 1000);
  });
}

app.whenReady().then(async () => {
  await killPortProcess(PORT);

  try {
    const { sunucuyuBaslat } = require('./index');
    serverInstance = await sunucuyuBaslat({ exitOnError: false });
  } catch (_) {
    serverInstance = null;
  }

  try { registerDesktopUpdateAPI(); } catch (e) { console.error('Desktop API kayit hatasi:', e); }
  createWindow();
  try { setupAutoUpdater(); } catch (e) { console.error('Auto-updater hatasi:', e); }

  if (!serverInstance && mainWindow) {
    dialog.showErrorBox(
      'Sunucu Hatası',
      'Sunucu başlatılamadı. Lütfen veritabanı bağlantısı ve .env ayarlarını kontrol edin.'
    );
  }
});

app.on('window-all-closed', () => {
  stopServer();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

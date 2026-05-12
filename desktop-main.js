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

app.whenReady().then(async () => {
  try {
    const { sunucuyuBaslat } = require('./index');
    serverInstance = await sunucuyuBaslat({ exitOnError: false });
  } catch (_) {
    serverInstance = null;
  }

  registerDesktopUpdateAPI();
  createWindow();
  setupAutoUpdater();

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

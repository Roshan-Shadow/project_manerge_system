import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { registerIpcHandlers } from './store.js';
import { repoSelfTest } from './repo.js';
import { getSettings, getWorkspaceBoot, settingsSelfTest } from './settings.js';

let mainWin: BrowserWindow | null = null;

/** 初始化测试环境：清除所有持久化数据，模拟首次使用 */
function initFreshEnv(): void {
  const userData = app.getPath('userData');
  for (const f of ['workspace-pointer.json', 'repos-list.json', 'repo-defaults.json', 'settings.json']) {
    try { fs.unlinkSync(path.join(userData, f)); } catch { /* ignore */ }
  }
  console.log(`[pms-fresh] 已清除 ${userData} 下的持久化数据`);
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#07080d',
    show: false,
    autoHideMenuBar: true,
    title: '项目管理系统 · Project Management System',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWin = win;
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '../../../src/renderer/index.html'));

  if (process.env.PMS_SMOKE) {
    win.webContents.on('console-message', (_e, _level, message) => {
      const msg = String(message);
      if (msg.includes('[pms-ready]')) console.log('[smoke] renderer ready');
      if (msg.includes('[pms-monaco]')) console.log('[smoke] monaco:', msg);
    });
    win.webContents.once('did-finish-load', () => {
      console.log('[smoke] page loaded');
      try {
        const boot = getWorkspaceBoot();
        console.log(`[smoke] workspace: ready=${boot.ready} restored=${boot.restored} dir=${boot.workDir}`);
        console.log('[smoke] settings:', settingsSelfTest());
        console.log('[smoke] repo selftest:', repoSelfTest());
        void getSettings();
      } catch (e) {
        console.log('[smoke] selftest FAILED:', (e as Error).message);
      }
      setTimeout(() => app.quit(), 3000);
    });
  }
}

app.setName('pms');

app.whenReady().then(() => {
  // --fresh 标志：初始化测试环境（清除所有持久化数据）
  if (process.argv.includes('--fresh')) initFreshEnv();
  registerIpcHandlers(() => mainWin);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

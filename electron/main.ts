import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
import path from "node:path";
import { autoUpdater } from "electron-updater";

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const appIcon = path.join(app.getAppPath(), "logo.png");
const RELEASES_URL = "https://github.com/orbit-chat/orbit-chat/releases/latest";
// Re-check for updates while the app stays open, so users are prompted
// when a new GitHub release ships without needing to restart the app.
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

type UpdaterStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

type UpdaterStatusPayload = {
  status: UpdaterStatus;
  version?: string;
  progress?: number;
  message?: string;
};

// Remove the default application menu (File, Edit, View, Window, Help)
Menu.setApplicationMenu(null);

function isAllowedExternalUrl(url: string): boolean {
  // Keep this conservative; expand only if you need more schemes.
  return url.startsWith("https://") || url.startsWith("http://");
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: "#0d1117",
    title: "Orbit Chat",
    icon: appIcon,
    frame: false,
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: isDev
    }
  });

  // Auto-open devTools in dev mode
  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  // Window control IPC handlers
  ipcMain.on("window:minimize", () => mainWindow.minimize());
  ipcMain.on("window:maximize", () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  ipcMain.on("window:close", () => mainWindow.close());
  ipcMain.handle("window:isMaximized", () => mainWindow.isMaximized());

  // Notify renderer when maximized state changes
  mainWindow.on("maximize", () => mainWindow.webContents.send("window:maximized-changed", true));
  mainWindow.on("unmaximize", () => mainWindow.webContents.send("window:maximized-changed", false));

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL as string);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  return mainWindow;
}

function setupAutoUpdater(mainWindow: BrowserWindow) {
  const sendStatus = (payload: UpdaterStatusPayload) => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("updater:status", payload);
  };

  ipcMain.handle("app:getPlatform", () => process.platform);

  ipcMain.handle("updater:openReleases", async () => {
    await shell.openExternal(RELEASES_URL);
    return { ok: true };
  });

  ipcMain.handle("updater:checkForUpdates", async () => {
    if (isDev) {
      sendStatus({ status: "idle", message: "Auto-update is disabled in development." });
      return { ok: false, reason: "dev-mode" };
    }
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (error: any) {
      sendStatus({ status: "error", message: error?.message ?? "Failed to check for updates." });
      return { ok: false, reason: error?.message ?? "unknown-error" };
    }
  });

  ipcMain.handle("updater:quitAndInstall", async () => {
    if (process.platform === "darwin") {
      await shell.openExternal(RELEASES_URL);
      return { mode: "manual-download" as const };
    }
    autoUpdater.quitAndInstall();
    return { mode: "install" as const };
  });

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    sendStatus({ status: "checking", message: "Checking for updates..." });
  });

  autoUpdater.on("update-available", (info) => {
    sendStatus({
      status: "available",
      version: info.version,
      message: `Update ${info.version} available. Downloading in background...`,
    });
  });

  autoUpdater.on("update-not-available", () => {
    sendStatus({ status: "not-available", message: "You are up to date." });
  });

  autoUpdater.on("download-progress", (progress) => {
    sendStatus({
      status: "downloading",
      progress: progress.percent,
      message: `Downloading update (${Math.round(progress.percent)}%)`,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    sendStatus({
      status: "downloaded",
      version: info.version,
      message: process.platform === "darwin"
        ? `Update ${info.version} is ready. Download and install from Releases.`
        : `Update ${info.version} downloaded. Restart to install.`,
    });
  });

  autoUpdater.on("error", (error) => {
    sendStatus({ status: "error", message: error?.message ?? "Auto-update failed." });
  });

  if (!isDev) {
    autoUpdater.checkForUpdates().catch(() => {});
    const recheck = setInterval(() => {
      autoUpdater.checkForUpdates().catch(() => {});
    }, UPDATE_CHECK_INTERVAL_MS);
    mainWindow.on("closed", () => clearInterval(recheck));
  }
}

// Helps notifications + taskbar grouping on Windows.
app.setAppUserModelId("com.orbit.chat");

// Prevent multiple instances (common Electron production expectation).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [existingWindow] = BrowserWindow.getAllWindows();
    if (!existingWindow) return;
    if (existingWindow.isMinimized()) existingWindow.restore();
    existingWindow.focus();
  });
  app.whenReady().then(() => {
    ipcMain.handle("app:getVersion", () => app.getVersion());
    const mainWindow = createWindow();
    setupAutoUpdater(mainWindow);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const appIcon = path.join(app.getAppPath(), "logo.png");

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
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: isDev
    }
  });

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
    createWindow();

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

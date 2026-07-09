const { app, BrowserWindow, Menu, shell, ipcMain, nativeTheme } = require("electron");
const path = require("path");

const isDev = !app.isPackaged;
const DEV_URL = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";

let mainWindow = null;

function send(action, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("loreforge:menu", { action, payload });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: "#0e0d12",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  // Open external links in the system browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const current = mainWindow.webContents.getURL();
    if (url !== current && (url.startsWith("http://") || url.startsWith("https://"))) {
      const isOwn = isDev ? url.startsWith(DEV_URL) : false;
      if (!isOwn) {
        event.preventDefault();
        shell.openExternal(url);
      }
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const template = [
    {
      label: "Loreforge",
      submenu: [
        { role: "about", label: "About Loreforge" },
        { type: "separator" },
        {
          label: "Settings…",
          accelerator: "CmdOrCtrl+,",
          click: () => send("settings"),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide", label: "Hide Loreforge" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit", label: "Quit Loreforge" },
      ],
    },
    {
      label: "File",
      submenu: [
        { label: "New Page", accelerator: "CmdOrCtrl+N", click: () => send("new-page") },
        { label: "New Database", accelerator: "CmdOrCtrl+Shift+N", click: () => send("new-database") },
        { type: "separator" },
        { label: "Close Window", role: "close" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "selectAll" },
        { type: "separator" },
        {
          label: "Find Page…",
          accelerator: "CmdOrCtrl+K",
          click: () => send("quick-switcher"),
        },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Toggle Sidebar", accelerator: "CmdOrCtrl+\\", click: () => send("toggle-sidebar") },
        { label: "Toggle Dice Tray", accelerator: "CmdOrCtrl+J", click: () => send("toggle-dice") },
        { type: "separator" },
        { label: "Appearance", submenu: [
          { label: "Dark", click: () => send("theme", "dark") },
          { label: "Light", click: () => send("theme", "light") },
        ]},
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        ...(isDev ? [{ role: "toggleDevTools" }, { role: "reload" }, { type: "separator" }] : []),
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Roll",
      submenu: [
        { label: "Roll d20", accelerator: "CmdOrCtrl+D", click: () => send("roll", "1d20") },
        { label: "Roll with Advantage", accelerator: "CmdOrCtrl+Shift+A", click: () => send("roll", "adv") },
        { label: "Duality Roll (Hope & Fear)", accelerator: "CmdOrCtrl+Shift+H", click: () => send("roll", "duality") },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Loreforge on GitHub",
          click: () => shell.openExternal("https://github.com/codysuter/codysuter"),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  nativeTheme.themeSource = "system";
  ipcMain.handle("loreforge:platform", () => process.platform);
  buildMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

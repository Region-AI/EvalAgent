import { app, BrowserWindow, ipcMain, dialog, screen, Menu } from "electron";
import * as path from "path";
import axios from "axios";
import * as fs from "fs";
import * as os from "os";
import * as crypto from "crypto";

import { Orchestrator } from "./core/orchestrator";
import { LogEntry, Logger } from "./core/logger";
import { API_BASE_URL, EXECUTOR_ID, EXECUTOR_ID_PATH } from "./config";
import { APIClient } from "./api/client";

// Native capture addon
import { NativeCapture } from "./agent/capture/native/index";

// --- Global state ---
let mainWindow: BrowserWindow | null = null;
let compactWindow: BrowserWindow | null = null;
let orchestrator: Orchestrator | null = null;
let logger: Logger | null = null;
let historyClient: APIClient | null = null;

let isAgentRunning = false;
let workflowState: "idle" | "running" | "paused" = "idle";
let evaluationStatusSocket: any | null = null;
let evaluationStatusPingTimer: NodeJS.Timeout | null = null;
let evaluationStatusStartTimer: NodeJS.Timeout | null = null;
let evaluationStatusId: number | null = null;
let evaluationStatusManualClose = false;
let agentToggleInFlight = false;
let isCompactMode = false;
let isMainWindowCapturable = false;
let isCompactWindowCapturable = false;
let currentLanguage: "en" | "zh" = "en";

// --- Paths ---
// Force userData/cache into a writable temp directory to avoid Windows cache permission issues.
const userDataDir = path.join(app.getPath("temp"), "app_eval_desktop");
const cacheDir = path.join(userDataDir, "Cache");
const logsDir = app.getPath("logs");
app.setPath("userData", userDataDir);
fs.mkdirSync(cacheDir, { recursive: true });
app.commandLine.appendSwitch("disk-cache-dir", cacheDir);

// --- Structured log buffer ---
const logBuffer: LogEntry[] = [];
const MAX_LOGS = 300;

// Convert Electron native window handle → HWND
function hwndFromBrowserWindow(win: BrowserWindow): bigint {
  const handle = win.getNativeWindowHandle();
  if (handle.length >= 8) return handle.readBigUInt64LE(0);
  return BigInt(handle.readUInt32LE(0));
}

// Toggle exclude-from-capture
function excludeWindowFromCapture(win: BrowserWindow | null, enable: boolean) {
  if (!win || process.platform !== "win32") return;
  try {
    if (!NativeCapture.isExcludeSupported()) {
      logger?.warn("WDA_EXCLUDEFROMCAPTURE not supported on this OS.");
      return;
    }
    const hwnd = hwndFromBrowserWindow(win);
    const res = NativeCapture.setExcludedFromCapture(hwnd, enable);
    if (!res.ok) {
      logger?.warn(`ExcludeFromCapture failed: ${res.error}`);
    } else {
      logger?.system(
        `Window ${enable ? "excluded" : "included"} from capture.`
      );
    }
  } catch (e) {
    logger?.warn(`Exclude-from-capture toggle failed: ${e}`);
  }
}

function applyCaptureExclusions() {
  excludeWindowFromCapture(mainWindow, !isMainWindowCapturable);
  excludeWindowFromCapture(compactWindow, !isCompactWindowCapturable);
}

// Broadcast structured logs to UI
function logToUI(entry: LogEntry) {
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) logBuffer.shift();

  mainWindow?.webContents.send("log-update", entry);
  compactWindow?.webContents.send("log-update", entry);
}

function broadcastToast(payload: { message: string; ttlMs?: number }) {
  if (!payload?.message) return;

  const normalizedTtl =
    typeof payload.ttlMs === "number" && payload.ttlMs > 0
      ? payload.ttlMs
      : 2000;

  mainWindow?.webContents.send("toast:show", {
    message: payload.message,
    ttlMs: normalizedTtl,
  });
  compactWindow?.webContents.send("toast:show", {
    message: payload.message,
    ttlMs: normalizedTtl,
  });
}

function broadcastLanguage(lang: "en" | "zh") {
  mainWindow?.webContents.send("language-changed", lang);
  compactWindow?.webContents.send("language-changed", lang);
}

function broadcastAgentStopped() {
  isAgentRunning = false;
  workflowState = "idle";

  mainWindow?.webContents.send("agent-state-changed", "stopped");
  compactWindow?.webContents.send("agent-state-changed", "stopped");

  mainWindow?.webContents.send("agent-workflow-state", "idle");
  compactWindow?.webContents.send("agent-workflow-state", "idle");
}

function handleOrchestratorAutoStop(reason: "no_jobs") {
  if (reason === "no_jobs") {
    logger?.system("No tasks remaining. Agent stopped automatically.");
  } else {
    logger?.system("Agent stopped automatically.");
  }

  broadcastAgentStopped();
}

// Create MAIN window
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: "#0b0d11",
    frame: true,
    transparent: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Hide the default app menu bar (File/Edit/View/Window/Help)
  // Menu.setApplicationMenu(null);
  // mainWindow.setMenuBarVisibility(false);

  mainWindow
    .loadFile(path.join(__dirname, "renderer", "pages", "main", "index.html"))
    .catch((err) => console.error("[Main] Failed to load:", err));

  logger = new Logger(logToUI);
  historyClient = new APIClient(logger);
  orchestrator = new Orchestrator(logger, mainWindow, {
    onAutoStop: handleOrchestratorAutoStop,
  });

  excludeWindowFromCapture(mainWindow, true);

  mainWindow.on("closed", () => (mainWindow = null));
}

// Create COMPACT window
function createCompactWindow() {
  if (compactWindow) return;

  const work = screen.getPrimaryDisplay().workAreaSize;
  const width = 380;
  const height = 520;

  compactWindow = new BrowserWindow({
    width,
    height,
    x: work.width - width - 10,
    y: work.height - height - 10,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    minWidth: 320,
    minHeight: 420,
    thickFrame: true,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  compactWindow
    .loadFile(
      path.join(__dirname, "renderer", "pages", "compact", "index.html")
    )
    .catch((err) =>
      console.error("[Main] Failed to load compact renderer:", err)
    );

  excludeWindowFromCapture(compactWindow, !isCompactWindowCapturable);
  compactWindow.on("closed", () => (compactWindow = null));
}

function bootstrapCompactWindow() {
  compactWindow?.webContents.send("init-log-buffer", logBuffer);
  compactWindow?.webContents.send(
    "agent-state-changed",
    isAgentRunning ? "running" : "stopped"
  );
  compactWindow?.webContents.send("agent-workflow-state", workflowState);
  compactWindow?.webContents.send("compact-mode-changed", true);
  compactWindow?.webContents.send(
    "compact-window-capturability-changed",
    isCompactWindowCapturable
  );
  compactWindow?.webContents.send("language-changed", currentLanguage);
}

function enterCompactMode() {
  if (!mainWindow || isCompactMode) return;
  isCompactMode = true;

  createCompactWindow();
  mainWindow.hide();
  applyCaptureExclusions();

  if (compactWindow?.webContents.isLoading()) {
    compactWindow?.webContents.once("did-finish-load", () => {
      bootstrapCompactWindow();
    });
  } else {
    bootstrapCompactWindow();
  }

  mainWindow?.webContents.send("compact-mode-changed", true);
}

function exitCompactMode() {
  if (!mainWindow || !isCompactMode) return;
  isCompactMode = false;

  compactWindow?.close();
  compactWindow = null;
  mainWindow.show();
  mainWindow.focus();
  applyCaptureExclusions();
  mainWindow.webContents.send("compact-mode-changed", false);
}

// ------------------------------------------------
// APP LIFECYCLE
// ------------------------------------------------

app.whenReady().then(async () => {
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ------------------------------------------------
// WINDOW CAPTURABILITY TOGGLE
// ------------------------------------------------

ipcMain.on("toggle-window-capturability", () => {
  isMainWindowCapturable = !isMainWindowCapturable;

  const shouldExclude = !isMainWindowCapturable;
  excludeWindowFromCapture(mainWindow, shouldExclude);

  mainWindow?.webContents.send(
    "window-capturability-changed",
    isMainWindowCapturable
  );
});

ipcMain.handle("set-window-capturability", (_event, capturable: boolean) => {
  isMainWindowCapturable = Boolean(capturable);
  const shouldExclude = !isMainWindowCapturable;
  excludeWindowFromCapture(mainWindow, shouldExclude);
  mainWindow?.webContents.send(
    "window-capturability-changed",
    isMainWindowCapturable
  );
  return { ok: true, capturable: isMainWindowCapturable };
});

ipcMain.on("toggle-compact-window-capturability", () => {
  isCompactWindowCapturable = !isCompactWindowCapturable;

  const shouldExclude = !isCompactWindowCapturable;
  excludeWindowFromCapture(compactWindow, shouldExclude);

  compactWindow?.webContents.send(
    "compact-window-capturability-changed",
    isCompactWindowCapturable
  );
});

// ------------------------------------------------
// COMPACT MODE
// ------------------------------------------------

ipcMain.on("toggle-compact-mode", () => {
  if (isCompactMode) exitCompactMode();
  else enterCompactMode();
});

ipcMain.handle("get-log-buffer", async () => logBuffer);
ipcMain.handle("get-agent-state", async () => ({
  agentState: isAgentRunning ? "running" : "stopped",
  workflowState,
}));

ipcMain.handle("app:get-settings", () => ({
  name: app.getName(),
  version: app.getVersion(),
  apiBaseUrl: API_BASE_URL,
  executorId: EXECUTOR_ID,
  userDataPath: app.getPath("userData"),
  cachePath: cacheDir,
  logsPath: logsDir,
  platform: `${process.platform} ${os.release()} (${process.arch})`,
}));

ipcMain.handle("app:reset-executor-id", () => {
  try {
    const nextId = crypto.randomUUID
      ? `uuid-${crypto.randomUUID()}`
      : `uuid-${crypto.randomBytes(16).toString("hex")}`;
    fs.mkdirSync(path.dirname(EXECUTOR_ID_PATH), { recursive: true });
    fs.writeFileSync(EXECUTOR_ID_PATH, nextId, "utf8");
    return { ok: true, executorId: nextId };
  } catch (err) {
    logger?.warn(`Failed to reset executor id: ${err}`);
    return { ok: false, error: "reset_failed" };
  }
});

// Let renderer request a native file picker for executable uploads
ipcMain.handle("pick-task-file", async () => {
  const hostWindow = BrowserWindow.getFocusedWindow() ?? mainWindow ?? null;
  const options: Electron.OpenDialogOptions = {
    properties: ["openFile"],
    title: "Select application to evaluate",
    filters: [
      {
        name: "Executables",
        extensions: ["exe", "msi", "bat", "cmd", "app"],
      },
      { name: "All Files", extensions: ["*"] },
    ],
  };

  const { canceled, filePaths } = hostWindow
    ? await dialog.showOpenDialog(hostWindow, options)
    : await dialog.showOpenDialog(options);

  if (canceled || !filePaths?.length) return null;
  return filePaths[0];
});

// ------------------------------------------------
// TOAST SYNC
// ------------------------------------------------

ipcMain.on(
  "toast:show",
  (_event, payload: { message?: string; ttlMs?: number }) => {
    if (!payload?.message) return;
    broadcastToast({
      message: payload.message,
      ttlMs: payload.ttlMs,
    });
  }
);

// ------------------------------------------------
// LANGUAGE SYNC
// ------------------------------------------------

ipcMain.handle("get-language", () => currentLanguage);

ipcMain.on("set-language", (_event, lang: string) => {
  const normalized = lang === "zh" ? "zh" : "en";
  currentLanguage = normalized;
  broadcastLanguage(normalized);
});

// Pause workflow
ipcMain.on("pause-workflow", () => {
  orchestrator?.pauseWorkflow();
  workflowState = "paused";
  mainWindow?.webContents.send("agent-workflow-state", "paused");
  compactWindow?.webContents.send("agent-workflow-state", "paused");
});

// Resume workflow
ipcMain.on("resume-workflow", () => {
  orchestrator?.resumeWorkflow();
  workflowState = "running";
  mainWindow?.webContents.send("agent-workflow-state", "running");
  compactWindow?.webContents.send("agent-workflow-state", "running");
});

// Evaluation status WebSocket watcher
const stopEvaluationStatusSocket = (evaluationId?: number) => {
  if (evaluationStatusStartTimer) {
    clearTimeout(evaluationStatusStartTimer);
    evaluationStatusStartTimer = null;
  }
  if (evaluationStatusPingTimer) {
    clearInterval(evaluationStatusPingTimer);
    evaluationStatusPingTimer = null;
  }
  if (evaluationStatusSocket) {
    evaluationStatusManualClose = true;
    if (evaluationStatusSocket.readyState === 1 && evaluationStatusId != null) {
      try {
        evaluationStatusSocket.send(
          JSON.stringify({
            action: "unsubscribe",
            channel: "evaluation.status",
            evaluation_id: evaluationStatusId,
          })
        );
      } catch {
        // ignore send failures during shutdown
      }
    }
    evaluationStatusSocket.close();
    evaluationStatusSocket = null;
  }
  if (evaluationId == null || evaluationStatusId === evaluationId) {
    evaluationStatusId = null;
  }
};

ipcMain.on("evaluation:watch-status", (event, evaluationId: number) => {
  const sender = event.sender;
  const WebSocketCtor = (globalThis as any).WebSocket;
  if (!WebSocketCtor) {
    sender.send("evaluation:status-event", {
      evaluationId,
      event: "error",
      data: "WebSocket not available.",
    });
    return;
  }
  if (!Number.isFinite(evaluationId)) {
    sender.send("evaluation:status-event", {
      evaluationId,
      event: "error",
      data: "Invalid evaluation id.",
    });
    return;
  }

  if (
    evaluationStatusId === evaluationId &&
    evaluationStatusSocket &&
    (evaluationStatusSocket.readyState === 0 ||
      evaluationStatusSocket.readyState === 1)
  ) {
    return;
  }

  stopEvaluationStatusSocket(evaluationId);
  evaluationStatusId = evaluationId;
  evaluationStatusManualClose = false;

  const openStatusSocket = () => {
    let wsUrl: string;
    try {
      const url = new URL(API_BASE_URL);
      url.protocol = "ws:";
      url.pathname = "/api/v1/events/ws";
      url.search = "";
      wsUrl = url.toString();
    } catch (err: any) {
      sender.send("evaluation:status-event", {
        evaluationId,
        event: "error",
        data: err?.message || "Invalid API base URL.",
      });
      return;
    }

    const socket = new WebSocketCtor(wsUrl);
    evaluationStatusSocket = socket;

    const addSocketListener = (
      type: string,
      handler: (...args: any[]) => void
    ) => {
      if (typeof socket.addEventListener === "function") {
        socket.addEventListener(type, handler as any);
      } else if (typeof socket.on === "function") {
        socket.on(type, handler);
      }
    };

    addSocketListener("open", () => {
      if (evaluationStatusSocket !== socket) return;
      socket.send(
        JSON.stringify({
          action: "subscribe",
          channel: "evaluation.status",
          evaluation_id: evaluationId,
        })
      );

      evaluationStatusPingTimer = setInterval(() => {
        if (socket.readyState !== 1) return;
        socket.send(JSON.stringify({ type: "ping" }));
      }, 25000);
    });

    addSocketListener("message", (message: any) => {
      if (evaluationStatusSocket !== socket) return;
      const raw =
        typeof message?.data === "string"
          ? message.data
          : typeof message === "string"
            ? message
            : (message?.toString?.() ?? "");
      let payload: any = null;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      if (!payload || typeof payload !== "object") return;
      if (payload.type === "pong" || payload.type === "subscribed") return;

      if (payload.type === "status" && payload.status) {
        sender.send("evaluation:status-event", {
          evaluationId,
          event: "status",
          data: payload.status,
        });
        return;
      }

      if (payload.type === "close") {
        sender.send("evaluation:status-event", {
          evaluationId,
          event: "close",
          data: "closed",
        });
        stopEvaluationStatusSocket(evaluationId);
        return;
      }

      if (payload.type === "error") {
        sender.send("evaluation:status-event", {
          evaluationId,
          event: "error",
          data: payload.message || "WebSocket error.",
        });
      }
    });

    addSocketListener("close", () => {
      if (evaluationStatusSocket !== socket) return;
      if (evaluationStatusPingTimer) {
        clearInterval(evaluationStatusPingTimer);
        evaluationStatusPingTimer = null;
      }
      evaluationStatusSocket = null;
      if (!evaluationStatusManualClose) {
        sender.send("evaluation:status-event", {
          evaluationId,
          event: "error",
          data: "Status socket closed.",
        });
      }
    });

    addSocketListener("error", (err: any) => {
      if (evaluationStatusSocket !== socket) return;
      const details =
        err?.message ||
        err?.error?.message ||
        err?.type ||
        (typeof err === "string" ? err : "");
      logger?.warn(
        `Evaluation status socket error (evaluationId=${evaluationId})${
          details ? `: ${details}` : "."
        }`
      );
      sender.send("evaluation:status-event", {
        evaluationId,
        event: "error",
        data: "Status socket error.",
      });
    });
  };

  evaluationStatusStartTimer = setTimeout(() => {
    evaluationStatusStartTimer = null;
    if (evaluationStatusId !== evaluationId) return;
    openStatusSocket();
  }, 300);
});

ipcMain.on("evaluation:stop-status", () => {
  stopEvaluationStatusSocket();
});

// Start/stop agent
ipcMain.on("toggle-agent", () => {
  if (!orchestrator || agentToggleInFlight) return;
  agentToggleInFlight = true;

  if (isAgentRunning) {
    orchestrator.stop();
    broadcastAgentStopped();
  } else {
    orchestrator.start(null);
    isAgentRunning = true;
    workflowState = "running";

    mainWindow?.webContents.send("agent-state-changed", "running");
    compactWindow?.webContents.send("agent-state-changed", "running");

    mainWindow?.webContents.send("agent-workflow-state", "running");
    compactWindow?.webContents.send("agent-workflow-state", "running");

    enterCompactMode();
  }

  // Small debounce to avoid rapid-fire toggles disrupting orchestrator state
  setTimeout(() => {
    agentToggleInFlight = false;
  }, 500);
});

// ------------------------------------------------
// JOB CREATION IPC
// ------------------------------------------------

ipcMain.on("new-task", async () => {
  if (!mainWindow || !orchestrator) return;
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    title: "Select application to evaluate",
  });

  if (filePaths?.length) {
    const filePath = filePaths[0];
    const appName = path.basename(filePath, path.extname(filePath));
    const appVersion = "1.0.0";
    const appType = "desktop_app";
    const jobId = await orchestrator.createNewEvaluation(
      filePath,
      null,
      appName,
      appVersion,
      appType
    );
    if (jobId != null) {
      mainWindow.webContents.send("task-uploaded", { jobId, kind: "file" });
      compactWindow?.webContents.send("task-uploaded", {
        jobId,
        kind: "file",
      });
    }
  }
});

ipcMain.on(
  "new-url-task",
  async (
    _event,
    targetUrl: string,
    highLevelGoal?: string | null,
    appName?: string | null,
    appVersion?: string | null,
    appType?: string | null
  ) => {
    if (!orchestrator) return;
    try {
      logger?.system(`Submitting URL evaluation: ${targetUrl}`);
      const normalizedGoal = (highLevelGoal ?? "").trim() || null;
      const normalizedName = (appName ?? "").trim() || null;
      const normalizedVersion = (appVersion ?? "").trim() || null;
      const normalizedType =
        appType === "web_app"
          ? "web_app"
          : appType === "desktop_app"
            ? "desktop_app"
            : null;
      const jobId = await orchestrator.createNewUrlEvaluation(
        targetUrl,
        normalizedGoal,
        normalizedName,
        normalizedVersion,
        normalizedType
      );
      if (jobId != null) {
        mainWindow?.webContents.send("task-uploaded", { jobId, kind: "url" });
        compactWindow?.webContents.send("task-uploaded", {
          jobId,
          kind: "url",
          url: targetUrl,
        });
      }
    } catch (err) {
      logger?.error(`Failed to create URL evaluation: ${err}`);
    }
  }
);

ipcMain.on(
  "new-live-task",
  async (
    _event,
    highLevelGoal?: string | null,
    appName?: string | null,
    appVersion?: string | null,
    appType?: string | null
  ) => {
    if (!orchestrator) return;
    try {
      logger?.system("Submitting live evaluation (current screen)");
      const normalizedGoal = (highLevelGoal ?? "").trim() || null;
      const normalizedName = (appName ?? "").trim() || null;
      const normalizedVersion = (appVersion ?? "").trim() || null;
      const normalizedType =
        appType === "web_app"
          ? "web_app"
          : appType === "desktop_app"
            ? "desktop_app"
            : null;
      const jobId = await orchestrator.createNewLiveEvaluation(
        normalizedGoal,
        normalizedType,
        normalizedName,
        normalizedVersion
      );
      if (jobId != null) {
        mainWindow?.webContents.send("task-uploaded", { jobId, kind: "live" });
        compactWindow?.webContents.send("task-uploaded", {
          jobId,
          kind: "live",
        });
      }
    } catch (err) {
      logger?.error(`Failed to create live evaluation: ${err}`);
    }
  }
);

ipcMain.on(
  "submit-file-task",
  async (
    _event,
    filePath: string,
    highLevelGoal?: string | null,
    appName?: string | null,
    appVersion?: string | null,
    appType?: string | null
  ) => {
    if (!orchestrator || !filePath) return;
    try {
      logger?.system(
        `Submitting executable evaluation: ${path.basename(filePath)}`
      );
      const normalizedGoal = (highLevelGoal ?? "").trim() || null;
      const normalizedName = (appName ?? "").trim() || null;
      const normalizedVersion = (appVersion ?? "").trim() || null;
      const normalizedType =
        appType === "web_app"
          ? "web_app"
          : appType === "desktop_app"
            ? "desktop_app"
            : null;
      const jobId = await orchestrator.createNewEvaluation(
        filePath,
        normalizedGoal,
        normalizedName,
        normalizedVersion,
        normalizedType
      );
      if (jobId != null) {
        mainWindow?.webContents.send("task-uploaded", { jobId, kind: "file" });
        compactWindow?.webContents.send("task-uploaded", {
          jobId,
          kind: "file",
        });
      }
    } catch (err) {
      logger?.error(`Failed to create executable evaluation: ${err}`);
    }
  }
);

// ------------------------------------------------
// NATIVE CAPTURE IPC
// ------------------------------------------------

ipcMain.handle("native-capture:primary", () =>
  NativeCapture.captureMonitorByIndex(0)
);

ipcMain.handle("native-capture:list-monitors", () =>
  NativeCapture.getMonitors()
);

// ------------------------------------------------
// SERVER STATUS PING
// ------------------------------------------------

ipcMain.handle("server-status:ping", async () => {
  const started = Date.now();
  try {
    const response = await axios.get(API_BASE_URL, {
      timeout: 3000,
      // Treat any HTTP status as "reachable" for the purposes of ping.
      validateStatus: () => true,
    });
    const latencyMs = Date.now() - started;
    return {
      ok: true,
      latencyMs,
      statusCode: response.status,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - started;
    return {
      ok: false,
      latencyMs,
      error: err?.message ?? String(err),
    };
  }
});

// ------------------------------------------------
// APP BROWSER (apps -> versions)
// ------------------------------------------------

ipcMain.handle(
  "app:list",
  async (
    _event,
    args:
      | {
          search?: string;
          appType?: "desktop_app" | "web_app";
          limit?: number;
          offset?: number;
        }
      | undefined = undefined
  ) => {
    const limitRaw = args?.limit;
    const offsetRaw = args?.offset;
    const limit =
      Number.isFinite(limitRaw) && (limitRaw as number) > 0
        ? Math.min(200, Math.max(1, Math.floor(limitRaw as number)))
        : 50;
    const offset =
      Number.isFinite(offsetRaw) && (offsetRaw as number) >= 0
        ? Math.floor(offsetRaw as number)
        : 0;

    if (!historyClient && logger) {
      historyClient = new APIClient(logger);
    }
    if (!historyClient) return { ok: false, error: "API client unavailable" };

    try {
      const apps = await historyClient.getApps({
        app_type: args?.appType,
        search: args?.search,
        limit,
        offset,
      });
      return { ok: true, apps };
    } catch (err: any) {
      const message = err?.message ?? "Failed to fetch apps";
      logger?.warn(message);
      return { ok: false, error: message };
    }
  }
);

ipcMain.handle(
  "app:create",
  async (
    _event,
    args:
      | {
          name?: string;
          appType?: "desktop_app" | "web_app";
          version?: string;
          source?: "file" | "url";
          appUrl?: string;
          filePath?: string;
        }
      | undefined = undefined
  ) => {
    const name = (args?.name ?? "").trim();
    const version = (args?.version ?? "").trim();
    const appType =
      args?.appType === "web_app" ? "web_app" : "desktop_app";
    const source = args?.source === "url" ? "url" : "file";
    const appUrl = (args?.appUrl ?? "").trim();
    const filePath = (args?.filePath ?? "").trim();

    if (!name) {
      return { ok: false, error: "App name is required" };
    }
    if (!version) {
      return { ok: false, error: "App version is required" };
    }
    if (source === "url") {
      if (!/^https?:\/\/.+/i.test(appUrl)) {
        return { ok: false, error: "Invalid app URL" };
      }
    } else {
      if (!filePath || !fs.existsSync(filePath)) {
        return { ok: false, error: "Invalid file path" };
      }
    }

    if (!historyClient && logger) {
      historyClient = new APIClient(logger);
    }
    if (!historyClient) return { ok: false, error: "API client unavailable" };

    try {
      const app = await historyClient.createApp({
        name,
        app_type: appType,
      });
      const versionPayload = {
        version,
        appUrl: source === "url" ? appUrl : null,
        filePath: source === "file" ? filePath : null,
      };
      const createdVersion = await historyClient.createAppVersion(
        app.id,
        versionPayload
      );
      return { ok: true, app, version: createdVersion };
    } catch (err: any) {
      const message = err?.message ?? "Failed to submit app";
      logger?.warn(message);
      return { ok: false, error: message };
    }
  }
);

ipcMain.handle(
  "app:version-create",
  async (
    _event,
      args:
        | {
            appId?: number | string;
            version?: string;
            source?: "file" | "url" | "path";
            appUrl?: string;
            appPath?: string;
            filePath?: string;
            previousVersionIds?: number[] | null;
            releaseDate?: string | null;
            changeLog?: string | null;
          }
        | undefined = undefined
    ) => {
    const appId = Number(args?.appId);
    if (!Number.isFinite(appId) || appId <= 0) {
      return { ok: false, error: "Invalid app id" };
    }

    const version = (args?.version ?? "").trim();
    if (!version) {
      return { ok: false, error: "App version is required" };
    }

    const source =
      args?.source === "url"
        ? "url"
        : args?.source === "path"
          ? "path"
          : "file";
    const appUrl = (args?.appUrl ?? "").trim();
    const appPath = (args?.appPath ?? "").trim();
    const filePath = (args?.filePath ?? "").trim();

    if (source === "url") {
      if (!/^https?:\/\/.+/i.test(appUrl)) {
        return { ok: false, error: "Invalid app URL" };
      }
    } else if (source === "path") {
      if (!appPath) {
        return { ok: false, error: "Artifact path is required" };
      }
    } else {
      if (!filePath || !fs.existsSync(filePath)) {
        return { ok: false, error: "Invalid file path" };
      }
    }

    if (!historyClient && logger) {
      historyClient = new APIClient(logger);
    }
    if (!historyClient) return { ok: false, error: "API client unavailable" };

      const previousVersionIds = Array.isArray(args?.previousVersionIds)
        ? args.previousVersionIds
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id) && id > 0)
        : [];

    const releaseDate =
      typeof args?.releaseDate === "string" && args.releaseDate.trim()
        ? args.releaseDate.trim()
        : null;
    const changeLog =
      typeof args?.changeLog === "string" && args.changeLog.trim()
        ? args.changeLog.trim()
        : null;

    try {
        const createdVersion = await historyClient.createAppVersion(appId, {
          version,
          appUrl: source === "url" ? appUrl : null,
          appPath: source === "path" ? appPath : null,
          filePath: source === "file" ? filePath : null,
          previousVersionIds,
          releaseDate,
          changeLog,
        });
      return { ok: true, version: createdVersion };
    } catch (err: any) {
      const message = err?.message ?? "Failed to create app version";
      logger?.warn(message);
      return { ok: false, error: message };
    }
  }
);

ipcMain.handle(
  "app:version-update",
  async (
    _event,
      args:
        | {
            appId?: number | string;
            versionId?: number | string;
            version?: string;
            source?: "url" | "path";
            appUrl?: string;
            appPath?: string;
            previousVersionIds?: number[] | null;
            releaseDate?: string | null;
            changeLog?: string | null;
          }
        | undefined = undefined
    ) => {
    const appId = Number(args?.appId);
    const versionId = Number(args?.versionId);
    if (!Number.isFinite(appId) || appId <= 0) {
      return { ok: false, error: "Invalid app id" };
    }
    if (!Number.isFinite(versionId) || versionId <= 0) {
      return { ok: false, error: "Invalid version id" };
    }

    const version = (args?.version ?? "").trim();
    if (!version) {
      return { ok: false, error: "App version is required" };
    }

    const source = args?.source === "path" ? "path" : "url";
    const appUrl = (args?.appUrl ?? "").trim();
    const appPath = (args?.appPath ?? "").trim();

    if (source === "url") {
      if (!/^https?:\/\/.+/i.test(appUrl)) {
        return { ok: false, error: "Invalid app URL" };
      }
    } else {
      if (!appPath) {
        return { ok: false, error: "Artifact path is required" };
      }
    }

    if (!historyClient && logger) {
      historyClient = new APIClient(logger);
    }
    if (!historyClient) return { ok: false, error: "API client unavailable" };

      const previousVersionIds = Array.isArray(args?.previousVersionIds)
        ? args.previousVersionIds
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id) && id > 0)
        : [];

    const releaseDate =
      typeof args?.releaseDate === "string" && args.releaseDate.trim()
        ? args.releaseDate.trim()
        : null;
    const changeLog =
      typeof args?.changeLog === "string" && args.changeLog.trim()
        ? args.changeLog.trim()
        : null;

    try {
        const updatedVersion = await historyClient.updateAppVersion(
          appId,
          versionId,
          {
            version,
            appUrl: source === "url" ? appUrl : null,
            artifactUri: source === "path" ? appPath : null,
            previousVersionIds,
            releaseDate,
            changeLog,
          }
        );
      return { ok: true, version: updatedVersion };
    } catch (err: any) {
      const message = err?.message ?? "Failed to update app version";
      logger?.warn(message);
      return { ok: false, error: message };
    }
  }
);

ipcMain.handle(
  "app:delete",
  async (_event, appId: number | string) => {
    const parsedId = Number(appId);
    if (!Number.isFinite(parsedId) || parsedId <= 0) {
      return { ok: false, error: "Invalid app id" };
    }

    if (!historyClient && logger) {
      historyClient = new APIClient(logger);
    }
    if (!historyClient) return { ok: false, error: "API client unavailable" };

    const success = await historyClient.deleteApp(parsedId);
    if (!success) {
      return { ok: false, error: `Failed to delete app ${parsedId}` };
    }
    return { ok: true };
  }
);

ipcMain.handle(
  "app:version-delete",
  async (
    _event,
    args: { appId: number | string; versionId: number | string }
  ) => {
    const appId = Number(args?.appId);
    const versionId = Number(args?.versionId);
    if (!Number.isFinite(appId) || appId <= 0) {
      return { ok: false, error: "Invalid app id" };
    }
    if (!Number.isFinite(versionId) || versionId <= 0) {
      return { ok: false, error: "Invalid version id" };
    }

    if (!historyClient && logger) {
      historyClient = new APIClient(logger);
    }
    if (!historyClient) return { ok: false, error: "API client unavailable" };

    const result = await historyClient.deleteAppVersion(appId, versionId);
    if (!result.ok) {
      return {
        ok: false,
        error:
          result.error ||
          `Failed to delete app ${appId} version ${versionId}`,
      };
    }
    return { ok: true };
  }
);

ipcMain.handle(
  "app:versions",
  async (
    _event,
    args:
      | { appId: number | string; limit?: number; offset?: number }
      | undefined = undefined
  ) => {
    const parsedId = Number(args?.appId);
    if (!Number.isFinite(parsedId) || parsedId <= 0) {
      return { ok: false, error: "Invalid app id" };
    }

    const limitRaw = args?.limit;
    const offsetRaw = args?.offset;
    const limit =
      Number.isFinite(limitRaw) && (limitRaw as number) > 0
        ? Math.min(200, Math.max(1, Math.floor(limitRaw as number)))
        : 50;
    const offset =
      Number.isFinite(offsetRaw) && (offsetRaw as number) >= 0
        ? Math.floor(offsetRaw as number)
        : 0;

    if (!historyClient && logger) {
      historyClient = new APIClient(logger);
    }
    if (!historyClient) return { ok: false, error: "API client unavailable" };

    try {
      const versions = await historyClient.getAppVersions(parsedId, {
        limit,
        offset,
      });
      return { ok: true, versions };
    } catch (err: any) {
      const message = err?.message ?? "Failed to fetch app versions";
      logger?.warn(message);
      return { ok: false, error: message };
    }
  }
);

ipcMain.handle(
  "app:versions-graph",
  async (_event, args: { appId: number | string } | undefined = undefined) => {
    const parsedId = Number(args?.appId);
    if (!Number.isFinite(parsedId) || parsedId <= 0) {
      return { ok: false, error: "Invalid app id" };
    }

    if (!historyClient && logger) {
      historyClient = new APIClient(logger);
    }
    if (!historyClient) return { ok: false, error: "API client unavailable" };

    try {
      const graph = await historyClient.getAppVersionGraph(parsedId);
      return { ok: true, graph };
    } catch (err: any) {
      const message = err?.message ?? "Failed to fetch app version graph";
      logger?.warn(message);
      return { ok: false, error: message };
    }
  }
);

// ------------------------------------------------
// EVALUATION FETCH
// ------------------------------------------------

ipcMain.handle(
  "evaluation:fetch",
  async (_event, evaluationId: number | string) => {
    const parsedId = Number(evaluationId);
    if (!Number.isFinite(parsedId) || parsedId <= 0) {
      return { ok: false, error: "Invalid evaluation id" };
    }

    if (!historyClient && logger) {
      historyClient = new APIClient(logger);
    }
    if (!historyClient) {
      return { ok: false, error: "API client unavailable" };
    }

    try {
      const evaluation = await historyClient.getEvaluation(parsedId);
      return { ok: true, evaluation };
    } catch (err: any) {
      const message = err?.message ?? String(err);
      logger?.warn(`Failed to fetch evaluation ${parsedId}: ${message}`);
      return { ok: false, error: message };
    }
  }
);

ipcMain.handle(
  "evaluation:regenerate-summary",
  async (_event, evaluationId: number | string) => {
    const parsedId = Number(evaluationId);
    if (!Number.isFinite(parsedId) || parsedId <= 0) {
      return { ok: false, error: "Invalid evaluation id" };
    }

    if (!historyClient && logger) {
      historyClient = new APIClient(logger);
    }
    if (!historyClient) {
      return { ok: false, error: "API client unavailable" };
    }

    try {
      const evaluation =
        await historyClient.regenerateEvaluationSummary(parsedId);
      return { ok: true, evaluation };
    } catch (err: any) {
      const message =
        err?.message ??
        `Failed to regenerate summary for evaluation ${parsedId}`;
      logger?.warn(message);
      return { ok: false, error: message };
    }
  }
);

ipcMain.handle(
  "evaluation:update-summary",
  async (_event, args: { evaluationId: number | string; summary: string }) => {
    const parsedId = Number(args?.evaluationId);
    if (!Number.isFinite(parsedId) || parsedId <= 0) {
      return { ok: false, error: "Invalid evaluation id" };
    }

    if (typeof args?.summary !== "string") {
      return { ok: false, error: "Invalid summary" };
    }

    if (!historyClient && logger) {
      historyClient = new APIClient(logger);
    }
    if (!historyClient) {
      return { ok: false, error: "API client unavailable" };
    }

    try {
      const evaluation = await historyClient.updateEvaluationSummary(
        parsedId,
        args.summary
      );
      return { ok: true, evaluation };
    } catch (err: any) {
      const message =
        err?.message ?? `Failed to update summary for evaluation ${parsedId}`;
      logger?.warn(message);
      return { ok: false, error: message };
    }
  }
);

ipcMain.handle(
  "evaluation:delete",
  async (_event, evaluationId: number | string) => {
    const parsedId = Number(evaluationId);
    if (!Number.isFinite(parsedId) || parsedId <= 0) {
      return { ok: false, error: "Invalid evaluation id" };
    }

    if (!historyClient && logger) {
      historyClient = new APIClient(logger);
    }
    if (!historyClient) {
      return { ok: false, error: "API client unavailable" };
    }

    const success = await historyClient.deleteEvaluation(parsedId);
    if (!success) {
      return { ok: false, error: `Failed to delete evaluation ${parsedId}` };
    }
    return { ok: true };
  }
);

// ------------------------------------------------
// TEST CASE CRUD
// ------------------------------------------------

ipcMain.handle(
  "testcase:create",
  async (
    _event,
    payload: {
      evaluation_id: number;
      plan_id: number;
      name: string;
      description?: string;
      input_data?: Record<string, any>;
      execution_order?: number;
      assigned_executor_id?: string;
    }
  ) => {
    if (!payload?.evaluation_id || !payload?.plan_id || !payload?.name) {
      return { ok: false, error: "Missing required fields" };
    }
    if (!historyClient && logger) {
      historyClient = new APIClient(logger);
    }
    if (!historyClient) return { ok: false, error: "API client unavailable" };

    const res = await historyClient.createTestCase(payload);
    if (!res) return { ok: false, error: "Failed to create test case" };
    return { ok: true, testcase: res };
  }
);

ipcMain.handle(
  "testcase:update",
  async (_event, args: { id: number; data: any }) => {
    const id = Number(args?.id);
    if (!Number.isFinite(id) || id <= 0) {
      return { ok: false, error: "Invalid test case id" };
    }
    if (!historyClient && logger) {
      historyClient = new APIClient(logger);
    }
    if (!historyClient) return { ok: false, error: "API client unavailable" };

    const res = await historyClient.updateTestCase(id, args?.data || {});
    if (!res) return { ok: false, error: "Failed to update test case" };
    return { ok: true, testcase: res };
  }
);

ipcMain.handle(
  "testcase:delete",
  async (_event, testcaseId: number | string) => {
    const parsedId = Number(testcaseId);
    if (!Number.isFinite(parsedId) || parsedId <= 0) {
      return { ok: false, error: "Invalid test case id" };
    }

    if (!historyClient && logger) {
      historyClient = new APIClient(logger);
    }
    if (!historyClient) return { ok: false, error: "API client unavailable" };

    const success = await historyClient.deleteTestCase(parsedId);
    if (!success) {
      return { ok: false, error: `Failed to delete test case ${parsedId}` };
    }
    return { ok: true };
  }
);

// ------------------------------------------------
// BUGS
// ------------------------------------------------

ipcMain.handle(
  "bugs:list",
  async (
    _event,
    args:
      | {
          appId?: number | string;
          filters?: {
            status?: string;
            severity_level?: string;
            app_version_id?: number;
            evaluation_id?: number;
            test_case_id?: number;
            limit?: number;
            offset?: number;
          };
        }
      | undefined = undefined
  ) => {
    const appId = Number(args?.appId);
    if (!Number.isFinite(appId) || appId <= 0) {
      return { ok: false, error: "Invalid app id" };
    }

    if (!historyClient && logger) {
      historyClient = new APIClient(logger);
    }
    if (!historyClient) return { ok: false, error: "API client unavailable" };

    try {
      const bugs = await historyClient.getBugsForApp(
        appId,
        args?.filters || {}
      );
      return { ok: true, bugs };
    } catch (err: any) {
      const message = err?.message ?? "Failed to fetch bugs";
      logger?.warn(message);
      return { ok: false, error: message };
    }
  }
);

ipcMain.handle("bugs:get", async (_event, bugId: number | string) => {
  const parsedId = Number(bugId);
  if (!Number.isFinite(parsedId) || parsedId <= 0) {
    return { ok: false, error: "Invalid bug id" };
  }
  if (!historyClient && logger) {
    historyClient = new APIClient(logger);
  }
  if (!historyClient) return { ok: false, error: "API client unavailable" };

  try {
    const bug = await historyClient.getBug(parsedId);
    return { ok: true, bug };
  } catch (err: any) {
    const message = err?.message ?? "Failed to fetch bug";
    logger?.warn(message);
    return { ok: false, error: message };
  }
});

ipcMain.handle(
  "bugs:create",
  async (_event, payload: { app_id?: number; title?: string } & any) => {
    if (!payload?.app_id || !payload?.title) {
      return { ok: false, error: "Missing required fields" };
    }
    if (!historyClient && logger) {
      historyClient = new APIClient(logger);
    }
    if (!historyClient) return { ok: false, error: "API client unavailable" };

    try {
      const bug = await historyClient.createBug(payload);
      return { ok: true, bug };
    } catch (err: any) {
      const message = err?.message ?? "Failed to create bug";
      logger?.warn(message);
      return { ok: false, error: message };
    }
  }
);

ipcMain.handle(
  "bugs:update",
  async (_event, args: { bugId?: number | string; data?: any }) => {
    const bugId = Number(args?.bugId);
    if (!Number.isFinite(bugId) || bugId <= 0) {
      return { ok: false, error: "Invalid bug id" };
    }
    if (!historyClient && logger) {
      historyClient = new APIClient(logger);
    }
    if (!historyClient) return { ok: false, error: "API client unavailable" };

    try {
      const bug = await historyClient.updateBug(bugId, args?.data || {});
      return { ok: true, bug };
    } catch (err: any) {
      const message = err?.message ?? "Failed to update bug";
      logger?.warn(message);
      return { ok: false, error: message };
    }
  }
);

ipcMain.handle("bugs:delete", async (_event, bugId: number | string) => {
  const parsedId = Number(bugId);
  if (!Number.isFinite(parsedId) || parsedId <= 0) {
    return { ok: false, error: "Invalid bug id" };
  }
  if (!historyClient && logger) {
    historyClient = new APIClient(logger);
  }
  if (!historyClient) return { ok: false, error: "API client unavailable" };

  const success = await historyClient.deleteBug(parsedId);
  if (!success) {
    return { ok: false, error: `Failed to delete bug ${parsedId}` };
  }
  return { ok: true };
});

ipcMain.handle(
  "bugs:occurrences",
  async (
    _event,
    args:
      | {
          bugId?: number | string;
          params?: {
            evaluation_id?: number;
            test_case_id?: number;
            app_version_id?: number;
            limit?: number;
            offset?: number;
          };
        }
      | undefined = undefined
  ) => {
    const bugId = Number(args?.bugId);
    if (!Number.isFinite(bugId) || bugId <= 0) {
      return { ok: false, error: "Invalid bug id" };
    }
    if (!historyClient && logger) {
      historyClient = new APIClient(logger);
    }
    if (!historyClient) return { ok: false, error: "API client unavailable" };

    try {
      const occurrences = await historyClient.listBugOccurrences(
        bugId,
        args?.params || {}
      );
      return { ok: true, occurrences };
    } catch (err: any) {
      const message = err?.message ?? "Failed to fetch occurrences";
      logger?.warn(message);
      return { ok: false, error: message };
    }
  }
);

ipcMain.handle(
  "bugs:occurrence-create",
  async (_event, args: { bugId?: number | string; data?: any }) => {
    const bugId = Number(args?.bugId);
    if (!Number.isFinite(bugId) || bugId <= 0) {
      return { ok: false, error: "Invalid bug id" };
    }
    if (!historyClient && logger) {
      historyClient = new APIClient(logger);
    }
    if (!historyClient) return { ok: false, error: "API client unavailable" };

    try {
      const occurrence = await historyClient.createBugOccurrence(
        bugId,
        args?.data || {}
      );
      return { ok: true, occurrence };
    } catch (err: any) {
      const message = err?.message ?? "Failed to create occurrence";
      logger?.warn(message);
      return { ok: false, error: message };
    }
  }
);

ipcMain.handle(
  "bugs:fixes",
  async (_event, args: { bugId?: number | string } | undefined = undefined) => {
    const bugId = Number(args?.bugId);
    if (!Number.isFinite(bugId) || bugId <= 0) {
      return { ok: false, error: "Invalid bug id" };
    }
    if (!historyClient && logger) {
      historyClient = new APIClient(logger);
    }
    if (!historyClient) return { ok: false, error: "API client unavailable" };

    try {
      const fixes = await historyClient.listBugFixes(bugId);
      return { ok: true, fixes };
    } catch (err: any) {
      const message = err?.message ?? "Failed to fetch fixes";
      logger?.warn(message);
      return { ok: false, error: message };
    }
  }
);

ipcMain.handle(
  "bugs:fix-create",
  async (_event, args: { bugId?: number | string; data?: any }) => {
    const bugId = Number(args?.bugId);
    if (!Number.isFinite(bugId) || bugId <= 0) {
      return { ok: false, error: "Invalid bug id" };
    }
    if (!historyClient && logger) {
      historyClient = new APIClient(logger);
    }
    if (!historyClient) return { ok: false, error: "API client unavailable" };

    try {
      const fix = await historyClient.createBugFix(bugId, args?.data || {});
      return { ok: true, fix };
    } catch (err: any) {
      const message = err?.message ?? "Failed to create fix";
      logger?.warn(message);
      return { ok: false, error: message };
    }
  }
);

ipcMain.handle(
  "bugs:fix-delete",
  async (_event, args: { bugId?: number | string; fixId?: number | string }) => {
    const bugId = Number(args?.bugId);
    const fixId = Number(args?.fixId);
    if (!Number.isFinite(bugId) || bugId <= 0) {
      return { ok: false, error: "Invalid bug id" };
    }
    if (!Number.isFinite(fixId) || fixId <= 0) {
      return { ok: false, error: "Invalid fix id" };
    }
    if (!historyClient && logger) {
      historyClient = new APIClient(logger);
    }
    if (!historyClient) return { ok: false, error: "API client unavailable" };

    const success = await historyClient.deleteBugFix(bugId, fixId);
    if (!success) {
      return {
        ok: false,
        error: `Failed to delete bug fix ${fixId} for bug ${bugId}`,
      };
    }
    return { ok: true };
  }
);

// ------------------------------------------------
// TASK HISTORY
// ------------------------------------------------

ipcMain.handle(
  "history:get-assigned",
  async (
    _event,
    args: { limit?: number; offset?: number } | undefined = undefined
  ) => {
    const limitRaw = args?.limit;
    const offsetRaw = args?.offset;
    const limit =
      Number.isFinite(limitRaw) && (limitRaw as number) > 0
        ? Math.min(200, Math.max(1, Math.floor(limitRaw as number)))
        : 20;
    const offset =
      Number.isFinite(offsetRaw) && (offsetRaw as number) >= 0
        ? Math.floor(offsetRaw as number)
        : 0;

    if (!historyClient && logger) {
      historyClient = new APIClient(logger);
    }
    if (!historyClient) return [];

    return await historyClient.getAssignedEvaluations(
      EXECUTOR_ID,
      limit,
      offset
    );
  }
);

ipcMain.handle("history:rerun", async (_event, record: any) => {
  if (!orchestrator) {
    logger?.error("Cannot rerun history task: orchestrator not ready.");
    return { ok: false, error: "Orchestrator not ready." };
  }

  try {
    const appType =
      typeof record?.app_type === "string"
        ? (record.app_type as string)
        : undefined;
    const appName =
      record?.app_name || record?.app?.name || record?.appName || null;
    const versionRaw = record?.app_version ?? record?.version ?? null;
    const appVersion =
      typeof versionRaw === "string"
        ? versionRaw
        : versionRaw && typeof versionRaw === "object"
          ? versionRaw.version || versionRaw.name || null
          : null;
    const hasUrl = Boolean(record?.app_url);
    const exePath =
      record?.local_application_path ||
      record?.app_path ||
      record?.application_path;
    let resolvedAppName = appName ? String(appName).trim() : "";
    let resolvedAppVersion = appVersion ? String(appVersion).trim() : "";

    if (!resolvedAppName) {
      if (record?.app_url) {
        try {
          const parsed = new URL(record.app_url);
          resolvedAppName = parsed.hostname.replace(/^www\./i, "");
        } catch {
          resolvedAppName = "Web App";
        }
      } else if (exePath) {
        resolvedAppName = path.basename(exePath, path.extname(exePath));
      } else {
        resolvedAppName = "Live Session";
      }
    }

    if (!resolvedAppVersion) {
      if (record?.app_url) {
        resolvedAppVersion = "web-rerun";
      } else if (exePath) {
        resolvedAppVersion = "1.0.0";
      } else {
        resolvedAppVersion = "live-rerun";
      }
    }

    if (!hasUrl && !exePath) {
      const jobId = await orchestrator.createNewLiveEvaluation(
        record?.high_level_goal ?? null,
        appType === "web_app" ? "web_app" : "desktop_app",
        resolvedAppName,
        resolvedAppVersion
      );
      if (jobId != null) return { ok: true, jobId };
      return { ok: false, error: "Failed to create live evaluation." };
    }

    if (record?.app_url) {
      const jobId = await orchestrator.createNewUrlEvaluation(
        record.app_url,
        record?.high_level_goal ?? null,
        resolvedAppName,
        resolvedAppVersion,
        appType === "web_app" ? "web_app" : "desktop_app"
      );
      if (jobId != null) return { ok: true, jobId };
      return { ok: false, error: "Failed to create web evaluation." };
    }

    if (!exePath || !fs.existsSync(exePath)) {
      const msg = `Executable missing for history task #${record?.id ?? "?"}: ${
        exePath || "not provided"
      }`;
      logger?.error(msg);
      return { ok: false, error: msg };
    }

    const jobId = await orchestrator.createNewEvaluation(
      exePath,
      record?.high_level_goal ?? null,
      resolvedAppName,
      resolvedAppVersion,
      appType === "web_app" ? "web_app" : "desktop_app"
    );
    if (jobId != null) return { ok: true, jobId };

    logger?.error(
      `Failed to recreate evaluation for file task ${record?.id ?? ""}.`
    );
    return { ok: false, error: "Failed to create file evaluation." };
  } catch (err: any) {
    const message = `History rerun failed: ${err?.message ?? String(err)}`;
    logger?.error(message);
    return { ok: false, error: message };
  }
});

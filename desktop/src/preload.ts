import { contextBridge, ipcRenderer } from "electron";

/**
 * Secure bridge between renderer and Electron main.
 * Only exposes safe, explicitly allowed IPC methods.
 */

// --- Type Definitions ---
export type LogLevel =
  | "SYSTEM"
  | "JOB"
  | "AGENT"
  | "TOOL"
  | "CAPTURE"
  | "WARN"
  | "ERROR";

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string; // ISO 8601
  divider?: boolean;
  label?: string;
}

export interface MonitorInfo {
  index: number;
  name: string;
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface NativeCaptureResult {
  buffer: Buffer;
  width: number;
  height: number;
  originX: number;
  originY: number;
}

export interface ServerStatus {
  ok: boolean;
  latencyMs: number | null;
  statusCode?: number;
  error?: string;
}

export interface AgentContextPayload {
  high_level_goal: string;
  test_case_description: string;
  test_case_id: number;
  scratchpad: string;
  // Human-readable action summaries (e.g., "clicked username field").
  action_history: string[];
  // Optional: descriptions sent to backend (without coords).
  action_history_descriptions?: string[];
  variables?: Record<string, any>;
  last_focus?: {
    x: number;
    y: number;
    normalized?: boolean;
    raw_model_coords?: {
      x: number;
      y: number;
      normalized?: boolean;
    };
  } | null;
}

export interface ToastPayload {
  message: string;
  ttlMs?: number;
}

export type LanguageCode = "en" | "zh";

// --- Exposed API ---
contextBridge.exposeInMainWorld("electronAPI", {
  /**
   * --- Agent Controls ---
   */
  toggleAgent: (): void => ipcRenderer.send("toggle-agent"),
  newTask: (): void => ipcRenderer.send("new-task"),
  submitFileTask: (
    filePath: string,
    highLevelGoal?: string | null,
    appName?: string | null,
    appVersion?: string | null,
    appType?: string | null
  ): void =>
    ipcRenderer.send(
      "submit-file-task",
      filePath,
      highLevelGoal,
      appName,
      appVersion,
      appType
    ),
  pickTaskFile: async (): Promise<string | null> =>
    await ipcRenderer.invoke("pick-task-file"),

  /**
   * Submit URL-based evaluations
   */
  newUrlTask: (
    url: string,
    highLevelGoal?: string | null,
    appName?: string | null,
    appVersion?: string | null,
    appType?: string | null
  ): void => {
    ipcRenderer.send(
      "new-url-task",
      url,
      highLevelGoal,
      appName,
      appVersion,
      appType
    );
  },
  /**
   * Submit a live evaluation (attach to current screen)
   */
  newLiveTask: (
    highLevelGoal?: string | null,
    appName?: string | null,
    appVersion?: string | null,
    appType?: string | null
  ): void => {
    ipcRenderer.send(
      "new-live-task",
      highLevelGoal,
      appName,
      appVersion,
      appType
    );
  },

  /**
   * --- Window Capturability Control ---
   */
  toggleWindowCapturability: (): void =>
    ipcRenderer.send("toggle-window-capturability"),
  onWindowCapturabilityChanged: (
    callback: (capturable: boolean) => void
  ): void => {
    ipcRenderer.on("window-capturability-changed", (_event, capturable) =>
      callback(capturable)
    );
  },
  toggleCompactWindowCapturability: (): void =>
    ipcRenderer.send("toggle-compact-window-capturability"),
  onCompactWindowCapturabilityChanged: (
    callback: (capturable: boolean) => void
  ): void => {
    ipcRenderer.on(
      "compact-window-capturability-changed",
      (_event, capturable) => callback(capturable)
    );
  },

  /**
   * --- Compact Mode Controls ---
   */
  toggleCompactMode: (): void => ipcRenderer.send("toggle-compact-mode"),
  onCompactModeChanged: (callback: (active: boolean) => void): void => {
    ipcRenderer.on("compact-mode-changed", (_event, active) =>
      callback(active)
    );
  },

  /**
   * --- Log Monitoring ---
   */
  onLogUpdate: (callback: (entry: LogEntry) => void): void => {
    ipcRenderer.on("log-update", (_event, entry) => callback(entry));
  },

  /** Pause workflow between steps */
  pauseWorkflow: (): void => {
    ipcRenderer.send("pause-workflow", true);
  },

  /** Resume workflow */
  resumeWorkflow: (): void => {
    ipcRenderer.send("resume-workflow", false);
  },


  /** Notify renderer when workflow state changes */
  onAgentWorkflowStateChanged: (
    callback: (state: "running" | "paused" | "idle") => void
  ): void => {
    ipcRenderer.on("agent-workflow-state", (_e, state) => callback(state));
  },

  getLogBuffer: async (): Promise<LogEntry[]> => {
    return await ipcRenderer.invoke("get-log-buffer");
  },

  getAgentState: async (): Promise<{
    agentState: "running" | "stopped";
    workflowState: "running" | "paused" | "idle";
  }> => {
    return await ipcRenderer.invoke("get-agent-state");
  },

  getSettingsInfo: async (): Promise<{
    name: string;
    version: string;
    apiBaseUrl: string;
    executorId: string;
    userDataPath: string;
    cachePath: string;
    logsPath: string;
    platform: string;
  }> => {
    return await ipcRenderer.invoke("app:get-settings");
  },
  resetExecutorId: async (): Promise<{
    ok: boolean;
    executorId?: string;
    error?: string;
  }> => {
    return await ipcRenderer.invoke("app:reset-executor-id");
  },
  setWindowCapturability: async (
    capturable: boolean
  ): Promise<{ ok: boolean; capturable: boolean }> => {
    return await ipcRenderer.invoke("set-window-capturability", capturable);
  },

  onInitLogBuffer: (callback: (logs: LogEntry[]) => void): void => {
    ipcRenderer.on("init-log-buffer", (_event, logs) => callback(logs));
  },

  /**
   * --- Toasts ---
   */
  sendToast: (message: string, ttlMs?: number): void => {
    ipcRenderer.send("toast:show", { message, ttlMs });
  },
  onToast: (callback: (payload: ToastPayload) => void): void => {
    ipcRenderer.on("toast:show", (_event, payload) => callback(payload));
  },

  /**
   * --- Language Sync ---
   */
  setLanguage: (lang: LanguageCode): void => {
    ipcRenderer.send("set-language", lang);
  },
  getLanguage: async (): Promise<LanguageCode> => {
    const lang = await ipcRenderer.invoke("get-language");
    return lang === "zh" ? "zh" : "en";
  },
  onLanguageChanged: (callback: (lang: LanguageCode) => void): void => {
    ipcRenderer.on("language-changed", (_event, lang) =>
      callback(lang === "zh" ? "zh" : "en")
    );
  },

  /**
   * --- Agent Lifecycle Events ---
   */
  onAgentStateChanged: (
    callback: (state: "running" | "stopped") => void
  ): void => {
    ipcRenderer.on("agent-state-changed", (_event, state) => callback(state));
  },

  /**
   * --- Agent View Update ---
   * UI can display snapshots if main sends them.
   */
  onAgentViewUpdate: (callback: (imageBase64: string) => void): void => {
    ipcRenderer.on("agent-view-update", (_event, imageBase64) =>
      callback(imageBase64)
    );
  },

  /**
   * --- Agent context updates (goal, scratchpad, history) ---
   */
  onAgentContextUpdated: (
    callback: (context: AgentContextPayload) => void
  ): void => {
    ipcRenderer.on("agent-context-updated", (_event, context) =>
      callback(context)
    );
  },

  /**
   * --- Backend server status ping ---
   */
  getServerStatus: async (): Promise<ServerStatus> => {
    return await ipcRenderer.invoke("server-status:ping");
  },

  /**
   * --- Task history ---
   */
  getAssignedEvaluations: async (
    limit?: number,
    offset?: number
  ): Promise<any[]> => {
    return await ipcRenderer.invoke("history:get-assigned", {
      limit,
      offset,
    });
  },

  rerunHistoryTask: async (
    record: any
  ): Promise<{ ok: boolean; jobId?: number; error?: string }> => {
    return await ipcRenderer.invoke("history:rerun", record);
  },
  onHistoryRefresh: (callback: () => void): void => {
    ipcRenderer.on("history:refresh", () => callback());
  },

  /**
   * --- App browser (apps -> versions) ---
   */
  listApps: async (args?: {
    search?: string;
    appType?: "desktop_app" | "web_app";
    limit?: number;
    offset?: number;
  }): Promise<{ ok: boolean; apps?: any[]; error?: string }> => {
    return await ipcRenderer.invoke("app:list", args);
  },
  listAppVersions: async (
    appId: number,
    limit?: number,
    offset?: number
  ): Promise<{ ok: boolean; versions?: any[]; error?: string }> => {
    return await ipcRenderer.invoke("app:versions", {
      appId,
      limit,
      offset,
    });
  },
  getAppVersionGraph: async (
    appId: number
  ): Promise<{ ok: boolean; graph?: any; error?: string }> => {
    return await ipcRenderer.invoke("app:versions-graph", { appId });
  },
  deleteApp: async (
    appId: number
  ): Promise<{ ok: boolean; error?: string }> => {
    return await ipcRenderer.invoke("app:delete", appId);
  },
  deleteAppVersion: async (
    appId: number,
    versionId: number
  ): Promise<{ ok: boolean; error?: string }> => {
    return await ipcRenderer.invoke("app:version-delete", {
      appId,
      versionId,
    });
  },
    updateAppVersion: async (payload: {
      appId: number;
      versionId: number;
      version: string;
      source: "url" | "path";
      appUrl?: string;
      appPath?: string;
      previousVersionIds?: number[] | null;
      releaseDate?: string | null;
      changeLog?: string | null;
    }): Promise<{ ok: boolean; version?: any; error?: string }> => {
      return await ipcRenderer.invoke("app:version-update", payload);
    },
    createAppVersion: async (payload: {
      appId: number;
      version: string;
      source: "file" | "url" | "path";
      appUrl?: string;
      appPath?: string;
      filePath?: string;
      previousVersionIds?: number[] | null;
      releaseDate?: string | null;
      changeLog?: string | null;
    }): Promise<{ ok: boolean; version?: any; error?: string }> => {
      return await ipcRenderer.invoke("app:version-create", payload);
    },
  submitApp: async (payload: {
    name: string;
    appType: "desktop_app" | "web_app";
    version: string;
    source: "file" | "url";
    appUrl?: string;
    filePath?: string;
  }): Promise<{ ok: boolean; app?: any; version?: any; error?: string }> => {
    return await ipcRenderer.invoke("app:create", payload);
  },

  /**
   * --- Bugs ---
   */
  listBugs: async (
    appId: number,
    filters?: {
      status?: string;
      severity_level?: string;
      app_version_id?: number;
      evaluation_id?: number;
      test_case_id?: number;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ ok: boolean; bugs?: any[]; error?: string }> => {
    return await ipcRenderer.invoke("bugs:list", { appId, filters });
  },
  getBug: async (
    bugId: number
  ): Promise<{ ok: boolean; bug?: any; error?: string }> => {
    return await ipcRenderer.invoke("bugs:get", bugId);
  },
  createBug: async (
    payload: any
  ): Promise<{ ok: boolean; bug?: any; error?: string }> => {
    return await ipcRenderer.invoke("bugs:create", payload);
  },
  updateBug: async (
    bugId: number,
    data: any
  ): Promise<{ ok: boolean; bug?: any; error?: string }> => {
    return await ipcRenderer.invoke("bugs:update", { bugId, data });
  },
  deleteBug: async (
    bugId: number
  ): Promise<{ ok: boolean; error?: string }> => {
    return await ipcRenderer.invoke("bugs:delete", bugId);
  },
  listBugOccurrences: async (
    bugId: number,
    params?: {
      evaluation_id?: number;
      test_case_id?: number;
      app_version_id?: number;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ ok: boolean; occurrences?: any[]; error?: string }> => {
    return await ipcRenderer.invoke("bugs:occurrences", { bugId, params });
  },
  createBugOccurrence: async (
    bugId: number,
    data: any
  ): Promise<{ ok: boolean; occurrence?: any; error?: string }> => {
    return await ipcRenderer.invoke("bugs:occurrence-create", { bugId, data });
  },
  listBugFixes: async (
    bugId: number
  ): Promise<{ ok: boolean; fixes?: any[]; error?: string }> => {
    return await ipcRenderer.invoke("bugs:fixes", { bugId });
  },
  createBugFix: async (
    bugId: number,
    data: any
  ): Promise<{ ok: boolean; fix?: any; error?: string }> => {
    return await ipcRenderer.invoke("bugs:fix-create", { bugId, data });
  },
  deleteBugFix: async (
    bugId: number,
    fixId: number
  ): Promise<{ ok: boolean; error?: string }> => {
    return await ipcRenderer.invoke("bugs:fix-delete", { bugId, fixId });
  },

  /**
   * --- Evaluation overview ---
   */
  fetchEvaluation: async (
    evaluationId: number
  ): Promise<{ ok: boolean; evaluation?: any; error?: string }> => {
    return await ipcRenderer.invoke("evaluation:fetch", evaluationId);
  },
  regenerateEvaluationSummary: async (
    evaluationId: number
  ): Promise<{ ok: boolean; evaluation?: any; error?: string }> => {
    return await ipcRenderer.invoke(
      "evaluation:regenerate-summary",
      evaluationId
    );
  },
  updateEvaluationSummary: async (
    evaluationId: number,
    summary: string
  ): Promise<{ ok: boolean; evaluation?: any; error?: string }> => {
    return await ipcRenderer.invoke("evaluation:update-summary", {
      evaluationId,
      summary,
    });
  },
  deleteEvaluation: async (
    evaluationId: number
  ): Promise<{ ok: boolean; error?: string }> => {
    return await ipcRenderer.invoke("evaluation:delete", evaluationId);
  },
  createTestCase: async (
    data: any
  ): Promise<{ ok: boolean; testcase?: any; error?: string }> => {
    return await ipcRenderer.invoke("testcase:create", data);
  },
  updateTestCase: async (
    id: number,
    data: any
  ): Promise<{ ok: boolean; testcase?: any; error?: string }> => {
    return await ipcRenderer.invoke("testcase:update", { id, data });
  },
  deleteTestCase: async (
    id: number
  ): Promise<{ ok: boolean; error?: string }> => {
    return await ipcRenderer.invoke("testcase:delete", id);
  },
  watchEvaluationStatus: (evaluationId: number): void => {
    ipcRenderer.send("evaluation:watch-status", evaluationId);
  },
  stopEvaluationStatus: (): void => {
    ipcRenderer.send("evaluation:stop-status");
  },
  onEvaluationStatus: (
    callback: (payload: {
      evaluationId: number;
      event: string;
      data: string;
    }) => void
  ): void => {
    ipcRenderer.on("evaluation:status-event", (_event, payload) =>
      callback(payload)
    );
  },
  onEvaluationAttached: (callback: (evaluation: any | null) => void): void => {
    ipcRenderer.on("evaluation-attached", (_event, evaluation) =>
      callback(evaluation)
    );
  },

  /**
   * --- Task upload acknowledgements ---
   */
  onTaskUploaded: (
    callback: (payload: {
      jobId: number;
      kind: "file" | "url";
      url?: string;
    }) => void
  ): void => {
    ipcRenderer.on("task-uploaded", (_event, payload) => callback(payload));
  },
});

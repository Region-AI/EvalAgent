// --- Element References ---
const newTaskBtn = document.getElementById("newTaskBtn");
const taskModal = document.getElementById("taskModal");
const taskModeBtns = document.querySelectorAll("[data-task-mode]");
const taskPanels = document.querySelectorAll("[data-task-panel]");
const taskUrlInput = document.getElementById("taskUrlInput");
const taskAppSelect = document.getElementById("taskAppSelect");
const taskAppVersionSelect = document.getElementById("taskAppVersionSelect");
const taskAppVersionInputWrap = document.getElementById(
  "taskAppVersionInputWrap"
);
const taskAppVersionInput = document.getElementById("taskAppVersionInput");
const taskFileInput = document.getElementById("taskFileInput");
const fileBrowseBtn = document.getElementById("fileBrowseBtn");
const fileDropZone = document.getElementById("fileDropZone");
const taskPhaseSlider = document.getElementById("taskPhaseSlider");
const taskPhasePanels = document.querySelectorAll("[data-task-phase]");
const taskActionButtons = document.querySelectorAll("[data-task-action]");
const taskPhaseNextBtn = document.getElementById("taskPhaseNextBtn");
const taskPhaseBackBtn = document.getElementById("taskPhaseBackBtn");
const submitTaskBtn = document.getElementById("submitTaskBtn");
const toggleAgentBtn = document.getElementById("toggleAgentBtn");
const logContainer = document.getElementById("log-container");
const agentViewImage = document.getElementById("agent-view-image");
const placeholderText = document.getElementById("placeholder-text");
const clearLogsBtn = document.getElementById("clearLogs");
const pauseLogsBtn = document.getElementById("pauseLogs");
const statusPill = document.getElementById("status-pill");
const timeLabel = document.getElementById("timestamp");
const toastRoot = document.getElementById("toast-root");
const languageToggle = document.getElementById("languageToggle");
const themeToggle = document.getElementById("themeToggle");
const captureToggleBtn = document.getElementById("captureToggleBtn");
const compactModeBtn = document.getElementById("compactModeBtn");
const pauseAgentBtn = document.getElementById("pauseAgentBtn");
const logFilterControls = document.getElementById("log-filter-controls");
const toggleViewRefreshBtn = document.getElementById("toggleViewRefreshBtn");
const serverStatusDot = document.getElementById("server-status-dot");
const serverStatusText = document.getElementById("server-status-text");
const settingsBtn = document.getElementById("settingsBtn");
const settingsModal = document.getElementById("settingsModal");
const settingsVersion = document.getElementById("settingsVersion");
const settingsExecutorId = document.getElementById("settingsExecutorId");
const settingsExecutorResetBtn = document.getElementById(
  "settingsExecutorResetBtn"
);
const settingsUserDataPath = document.getElementById("settingsUserDataPath");
const settingsCachePath = document.getElementById("settingsCachePath");
const settingsLogsPath = document.getElementById("settingsLogsPath");
const settingsAutostartToggle = document.getElementById(
  "settingsAutostartToggle"
);
const settingsThemeButtons = document.querySelectorAll("[data-settings-theme]");
const settingsLanguageButtons = document.querySelectorAll(
  "[data-settings-language]"
);
const settingsCaptureButtons = document.querySelectorAll(
  "[data-settings-capture]"
);
const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanes = document.querySelectorAll(".tab-pane");

// --- Agent Context Panel ---
const contextGoalEl = document.getElementById("context-goal");
const contextScratchpadEl = document.getElementById("context-scratchpad");
const contextScratchpadLengthEl = document.getElementById(
  "context-scratchpad-count"
);
const contextActionHistoryEl = document.getElementById("context-actions-list");
const contextActionCountEl = document.getElementById("context-actions-count");
const contextActionTotalEl = document.getElementById("context-actions-total");
const coordsPill = document.getElementById("coords-pill");
const agentViewContainer = document.getElementById("agent-view-container");

const {
  initThemeToggle,
  initLogView,
  setStatusPill,
  startLiveClock,
  createToastManager,
} = window.UIHelpers;
const ContextHelpers = window?.ContextHelpers;
const I18n = window?.I18n;
let i18nReady = false;
const tr = (key, vars) =>
  (i18nReady ? I18n?.t?.(key, vars) : key) ?? key;
window.__appTr = tr;
const TaskHistoryUI = window?.TaskHistoryUI;
const ModalHelpers = window?.ModalHelpers;

// --- Agent / workflow state ---
let isLogsPaused = false;
let isViewRefreshPaused = false;
let isAgentRunning = false;
let workflowState = "idle";
let latestContext = null;
let agentToggleLocked = false;
let agentToggleTimer = null;
let workflowToggleLocked = false;
let workflowToggleTimer = null;
let isWindowCapturable = false;
let activeTab = null;
let settingsInfoCache = null;
let suppressCaptureToast = true;
let customAppsTypeFilter;
let customTaskAppSelect = null;
let customTaskAppVersionSelect = null;
let taskModalController = null;

if (taskModal && ModalHelpers?.createStepperModal) {
  taskModalController = ModalHelpers.createStepperModal(taskModal, {
    steps: ["app", "source"],
    actionSelector: "[data-task-action]",
    onStepChange: applyTaskPhase,
  });
}

if (settingsModal && ModalHelpers?.createModal) {
  ModalHelpers.createModal(settingsModal);
}

function updateAgentToggleUI() {
  if (!toggleAgentBtn) return;
  const isActive = workflowState !== "idle" || isAgentRunning;
  toggleAgentBtn.textContent = isActive
    ? tr("controls.agent.stop")
    : tr("controls.agent.start");
  toggleAgentBtn.classList.toggle("running", isActive);
}

async function syncAgentState() {
  if (!window.electronAPI?.getAgentState) return;
  try {
    const { agentState, workflowState: wfState } =
      (await window.electronAPI.getAgentState()) || {};
    const state = wfState || agentState;
    if (state === "running") {
      isAgentRunning = true;
      workflowState = "running";
      setStatus(tr("status.running"), "running");
    } else if (state === "paused") {
      isAgentRunning = true;
      workflowState = "paused";
      setStatus(tr("status.paused"), "warn");
    } else {
      isAgentRunning = false;
      workflowState = "idle";
      setStatus(tr("status.idle"), "idle");
    }
    updateAgentToggleUI();
    updatePauseButton();
  } catch (err) {
    // ignore sync failures
  }
}

// --- Helper Functions ---
function setStatus(text, tone = "idle") {
  setStatusPill(statusPill, text, tone, timeLabel);
}

function lockAgentToggle() {
  agentToggleLocked = true;
  toggleAgentBtn.disabled = true;
  toggleAgentBtn.classList.add("disabled");
  if (agentToggleTimer) clearTimeout(agentToggleTimer);
  // Safety unlock in case no response comes back
  agentToggleTimer = setTimeout(() => {
    agentToggleLocked = false;
    toggleAgentBtn.disabled = false;
    toggleAgentBtn.classList.remove("disabled");
  }, 5000);
}

function unlockAgentToggle() {
  agentToggleLocked = false;
  toggleAgentBtn.disabled = false;
  toggleAgentBtn.classList.remove("disabled");
  if (agentToggleTimer) {
    clearTimeout(agentToggleTimer);
    agentToggleTimer = null;
  }
}

function lockWorkflowToggle() {
  workflowToggleLocked = true;
  if (pauseAgentBtn) pauseAgentBtn.disabled = true;
  if (workflowToggleTimer) clearTimeout(workflowToggleTimer);
  workflowToggleTimer = setTimeout(() => unlockWorkflowToggle(), 4000);
}

function unlockWorkflowToggle() {
  workflowToggleLocked = false;
  if (pauseAgentBtn) pauseAgentBtn.disabled = false;
  if (workflowToggleTimer) {
    clearTimeout(workflowToggleTimer);
    workflowToggleTimer = null;
  }
}

function enforceIntegerInput(input) {
  if (!input) return;
  const sanitize = () => {
    const raw = String(input.value || "");
    const cleaned = raw.replace(/[^\d]/g, "");
    if (raw !== cleaned) input.value = cleaned;
  };
  input.addEventListener("keydown", (e) => {
    if (
      e.key === "." ||
      e.key === "," ||
      e.key === "e" ||
      e.key === "E" ||
      e.key === "+" ||
      e.key === "-"
    ) {
      e.preventDefault();
    }
  });
  input.addEventListener("input", sanitize);
}

function updatePauseButton() {
  if (!pauseAgentBtn) return;
  const isPaused = workflowState === "paused";

  if (!isAgentRunning) {
    pauseAgentBtn.disabled = true;
    pauseAgentBtn.textContent = tr("controls.agent.pause");
    pauseAgentBtn.classList.add("disabled");
    return;
  }

  pauseAgentBtn.disabled = workflowToggleLocked;
  pauseAgentBtn.classList.toggle("disabled", workflowToggleLocked);
  pauseAgentBtn.textContent = isPaused
    ? tr("controls.agent.resume")
    : tr("controls.agent.pause");
  pauseAgentBtn.title = isPaused
    ? tr("status.resumeWorkflow")
    : tr("status.pauseWorkflow");
}

function updateServerStatusView(status) {
  if (!serverStatusDot || !serverStatusText) return;

  const { ok, latencyMs } = status || {};

  serverStatusDot.classList.remove(
    "status-offline",
    "status-ok",
    "status-warn",
    "status-err"
  );
  if (!ok || latencyMs == null) {
    serverStatusDot.classList.add("status-offline");
    serverStatusText.textContent = tr("server.offline");
    serverStatusText.style.opacity = "0.6";
    return;
  }
  serverStatusText.style.opacity = "1";
  let tone = "err";
  if (latencyMs < 100) {
    tone = "ok";
  } else if (latencyMs < 400) {
    tone = "warn";
  }

  serverStatusDot.classList.add(`status-${tone}`);
  serverStatusText.textContent = `${latencyMs} ms`;
}

async function refreshServerStatus() {
  try {
    const status = await window.electronAPI.getServerStatus();
    updateServerStatusView(status);
  } catch (err) {
    updateServerStatusView({ ok: false, latencyMs: null });
  }
}

if (agentViewContainer && agentViewImage && coordsPill) {
  agentViewContainer.addEventListener("mousemove", (e) => {
    if (!agentViewImage.src || agentViewImage.style.display === "none") {
      coordsPill.classList.remove("show");
      return;
    }

    const rect = agentViewImage.getBoundingClientRect();
    const naturalW = agentViewImage.naturalWidth;
    const naturalH = agentViewImage.naturalHeight;
    const renderW = rect.width;
    const renderH = rect.height;

    if (!naturalW || !naturalH) return;

    const naturalRatio = naturalW / naturalH;
    const renderRatio = renderW / renderH;

    let drawW;
    let drawH;
    let startX;
    let startY;

    if (renderRatio > naturalRatio) {
      drawH = renderH;
      drawW = renderH * naturalRatio;
      startX = (renderW - drawW) / 2;
      startY = 0;
    } else {
      drawW = renderW;
      drawH = renderW / naturalRatio;
      startX = 0;
      startY = (renderH - drawH) / 2;
    }

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const imgX = Math.floor((mouseX - startX) * (naturalW / drawW));
    const imgY = Math.floor((mouseY - startY) * (naturalH / drawH));

    if (imgX >= 0 && imgX < naturalW && imgY >= 0 && imgY < naturalH) {
      coordsPill.textContent = `${imgX}, ${imgY}`;
      coordsPill.classList.add("show");
    } else {
      coordsPill.classList.remove("show");
    }
  });
}

const { showToast } = createToastManager(toastRoot, window.electronAPI);
window.__appShowToast = showToast;
TaskHistoryUI?.init?.({
  translate: tr,
  showToast,
  openTaskModal,
});

let activeTaskMode = "file";
let activeTaskPhase = "app";
let selectedFilePath = "";
let taskSourceTouched = false;
let fileDialogInFlight = false;
let appVersionEdited = false;
let taskAppOptions = [];
let taskAppVersionOptions = [];
let taskAppsRequestId = 0;
let selectedAppVersionMeta = null;
const NEW_VERSION_VALUE = "__new_version__";

// --- Language Toggle + i18n ---
let currentLanguage = "en";

function renderLanguageToggle(lang) {
  if (!languageToggle) return;
  const isChinese = lang === "zh";
  languageToggle.innerHTML = isChinese
    ? '<i data-lucide="languages"></i>'
    : '<i data-lucide="case-upper"></i>';
  languageToggle.title = tr("topbar.language.title");
  lucide.createIcons();
}

function refreshDynamicText() {
  // Buttons and status based on current state
  const isPaused = workflowState === "paused";
  updateAgentToggleUI();
  pauseAgentBtn.textContent = isPaused
    ? tr("controls.agent.resume")
    : tr("controls.agent.pause");
  pauseAgentBtn.title = isPaused
    ? tr("status.resumeWorkflow")
    : tr("status.pauseWorkflow");

  pauseLogsBtn.title = isLogsPaused ? tr("logs.resume") : tr("logs.pause");
  toggleViewRefreshBtn.title = isViewRefreshPaused
    ? tr("view.resume")
    : tr("view.pause");

  captureToggleBtn.title = isWindowCapturable
    ? tr("topbar.capture.title.disable")
    : tr("topbar.capture.title.enable");

  if (placeholderText) {
    placeholderText.textContent = tr("view.placeholder");
  }

  document.title = tr("app.title");

  if (workflowState === "paused") {
    setStatus(tr("status.paused"), "warn");
  } else if (workflowState === "running" && isAgentRunning) {
    setStatus(tr("status.running"), "ok");
  } else {
    setStatus(tr("status.idle"), "idle");
  }

  if (latestContext) {
    ContextHelpers?.renderContextPanel(
      {
        goalEl: contextGoalEl,
        scratchpadEl: contextScratchpadEl,
        scratchpadLengthEl: contextScratchpadLengthEl,
        actionListEl: contextActionHistoryEl,
        actionCountEl: contextActionCountEl,
        actionTotalEl: contextActionTotalEl,
      },
      latestContext,
      {
        scratchpadPlaceholder: tr("compact.context.scratchpad.placeholder"),
        actionEmptyLabel: tr("context.actions.empty"),
        goalPlaceholder: tr("context.goal.placeholder"),
        charsLabel: tr("context.chars"),
        actionCountSuffix: tr("context.steps.suffix"),
        stepLabel: tr("context.step"),
        actionLabelFallback: tr("context.action.fallback"),
        listMaxLen: 240,
      }
    );
  }

  refreshServerStatus();
}

async function initLanguage() {
  const preferred =
    (await window.electronAPI?.getLanguage?.().catch(() => null)) || undefined;
  await I18n?.init?.({ preferredLanguage: preferred });
  i18nReady = true;
  currentLanguage = I18n?.getLanguage?.() || "en";
  renderLanguageToggle(currentLanguage);
  renderSettingsLanguageSelection(currentLanguage);
  I18n?.applyTranslations?.(document);
  document.title = tr("app.title");
  window.electronAPI?.setLanguage?.(currentLanguage);
  refreshDynamicText();
  updateSelectedFileLabel(selectedFilePath);
  window.EvaluationUI?.rerender?.();
  window.AppsUI?.rerender?.();
  window.BugsUI?.rerender?.();
  TaskHistoryUI?.renderHistory();
  TaskHistoryUI?.renderDetail();

  I18n?.onChange?.((lang) => {
    currentLanguage = lang;
    renderLanguageToggle(lang);
    renderSettingsLanguageSelection(lang);
    I18n?.applyTranslations?.(document);
    document.title = tr("app.title");
    refreshDynamicText();
    updateSelectedFileLabel(selectedFilePath);
    window.AppsUI?.rerender?.();
    window.EvaluationUI?.rerender?.();
    window.BugsUI?.rerender?.();
    TaskHistoryUI?.renderHistory();
    TaskHistoryUI?.renderDetail();
  });

  window.electronAPI?.onLanguageChanged?.((lang) => {
    if (!lang) return;
    I18n?.setLanguage?.(lang);
    renderSettingsLanguageSelection(lang);
  });

  languageToggle?.addEventListener("click", () => {
    const next = currentLanguage === "en" ? "zh" : "en";
    I18n?.setLanguage?.(next);
    window.electronAPI?.setLanguage?.(next);
    showToast(tr(`toast.language.${next}`));
  });
}

async function startApp() {
  await initLanguage();
  window.AppsUI?.init?.();
  window.EvaluationUI?.init?.();
  window.BugsUI?.init?.();

  if (window.TaskHistoryUI) {
    window.TaskHistoryUI.init({
      translate: tr,
      showToast,
      openTaskModal,
    });
    window.TaskHistoryUI.loadHistory();
  }
  window.I18n?.applyTranslations?.(document);
  syncAgentState();
  refreshServerStatus();
  setInterval(refreshServerStatus, 5000);
}

startApp();

function updateSelectedFileLabel(pathText = "") {
  const wrapper =
    taskModal?.querySelector(".file-selected-wrapper") ||
    document.querySelector("#taskModal .file-selected-wrapper");
  if (!wrapper) return;

  const hasFile = Boolean(pathText);
  const name = hasFile ? pathText.split(/[\\/]/).pop() : tr("input.noFile");
  if (hasFile) {
    wrapper.classList.add("has-file");
    wrapper.classList.remove("no-file");
  } else {
    wrapper.classList.add("no-file");
    wrapper.classList.remove("has-file");
  }
  const iconName = hasFile ? "file-check" : "file-question";
  wrapper.innerHTML = `
    <i data-lucide="${iconName}"></i>
    <span id="selectedFileName">${name}</span>
  `;
  if (window.lucide && window.lucide.createIcons) {
    window.lucide.createIcons({
      root: wrapper,
      attrs: {
        class: "file-status-icon",
      },
    });
  }
}

const storageKeyFor = (prefix, mode) => `${prefix}${mode}`;
const APP_ID_KEY = "task.lastAppId.";
const APP_VERSION_KEY = "task.lastAppVersion.";

function getStoredValue(prefix, mode) {
  try {
    return localStorage.getItem(storageKeyFor(prefix, mode)) || "";
  } catch {
    return "";
  }
}

function setStoredValue(prefix, mode, value) {
  try {
    localStorage.setItem(storageKeyFor(prefix, mode), value);
  } catch {
    // Ignore storage failures.
  }
}

function getDateStamp() {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function defaultVersionForMode(mode) {
  if (mode === "url") return `web-${getDateStamp()}`;
  if (mode === "live") return `live-${getDateStamp()}`;
  return "1.0.0";
}

function isCreatingNewVersion() {
  if (!taskAppVersionSelect) return true;
  return taskAppVersionSelect.value === NEW_VERSION_VALUE;
}

function getTaskAppVersionValue() {
  if (!taskAppVersionSelect) {
    return taskAppVersionInput?.value?.trim() || "";
  }
  if (taskAppVersionSelect.value === NEW_VERSION_VALUE) {
    return taskAppVersionInput?.value?.trim() || "";
  }
  const match = taskAppVersionOptions.find(
    (version) => `${version.id}` === `${taskAppVersionSelect.value}`
  );
  return (match?.version || "").trim();
}

function setTaskVersionInputVisible(show) {
  if (!taskAppVersionInputWrap) return;
  taskAppVersionInputWrap.classList.toggle("hidden", !show);
}

function applyVersionDefaults(mode) {
  if (
    taskAppVersionInput &&
    isCreatingNewVersion() &&
    !taskAppVersionInput.value.trim() &&
    !appVersionEdited
  ) {
    taskAppVersionInput.value = "";
  }
}

function getAppTypeForMode(mode) {
  return mode === "url" ? "web_app" : "desktop_app";
}

function getSelectedApp() {
  const selectedId = taskAppSelect?.value;
  if (!selectedId) return null;
  return taskAppOptions.find((app) => `${app.id}` === `${selectedId}`) || null;
}

function isLikelyLocalPath(value) {
  if (!value) return false;
  const text = normalizeLocalPath(value);
  if (!text) return false;
  if (/^[a-zA-Z]:[\\/]/.test(text)) return true;
  if (/^\\\\/.test(text)) return true;
  return text.startsWith("/");
}

function normalizeLocalPath(value) {
  if (!value) return "";
  let text = String(value).trim();
  if (!text) return "";
  if (/^file:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      text = decodeURIComponent(url.pathname || "");
      if (/^\/[a-zA-Z]:/.test(text)) {
        text = text.slice(1);
      }
    } catch {
      // fall back to the original text
    }
  }
  return text;
}

function pickPreferredVersion(versions, desiredVersion) {
  if (!Array.isArray(versions) || !versions.length) return null;
  const desired = (desiredVersion || "").trim();
  if (desired) {
    const match = versions.find(
      (version) => `${version.version || ""}`.trim() === desired
    );
    if (match) return match;
  }
  return versions.reduce((best, current) => {
    if (!best) return current;
    const bestDate = best.created_at ? Date.parse(best.created_at) : NaN;
    const currentDate = current.created_at
      ? Date.parse(current.created_at)
      : NaN;
    if (!Number.isNaN(bestDate) && !Number.isNaN(currentDate)) {
      return currentDate > bestDate ? current : best;
    }
    if (Number.isNaN(bestDate) && !Number.isNaN(currentDate)) return current;
    if (!Number.isNaN(bestDate) && Number.isNaN(currentDate)) return best;
    return (current.id || 0) > (best.id || 0) ? current : best;
  }, null);
}

function applyDefaultTargetsFromApp() {
  const selectedApp = getSelectedApp();

  if (!selectedAppVersionMeta) return;
  const { appUrl, appPath } = selectedAppVersionMeta;
  const targetMode = activeTaskMode;

  if (targetMode === "url" && taskUrlInput) {
    if (!taskUrlInput.value.trim() && appUrl) {
      taskUrlInput.value = appUrl;
    }
  }

  if (targetMode === "file" && !selectedFilePath && appPath) {
    const normalizedPath = normalizeLocalPath(appPath);
    if (isLikelyLocalPath(normalizedPath)) {
      selectedFilePath = normalizedPath;
      updateSelectedFileLabel(normalizedPath);
    }
  }
}

function renderTaskAppVersions(versions, preferredVersion) {
  if (!taskAppVersionSelect) return;
  taskAppVersionSelect.disabled = false;
  const list = Array.isArray(versions) ? versions : [];
  taskAppVersionOptions = list;
  const previousSelection = taskAppVersionSelect.value;

  const options = [
    `<option value="">${tr("modal.app.version.select")}</option>`,
  ].concat(
    list.map(
      (version) =>
        `<option value="${version.id}">${version.version || "--"}</option>`
    )
  );
  options.push(
    `<option value="${NEW_VERSION_VALUE}">Create new version...</option>`
  );
  taskAppVersionSelect.innerHTML = options.join("");
  const wrap = document.getElementById("custom-wrap-taskAppVersionSelect");
  if (wrap && wrap.refresh) wrap.refresh();
  if (!customTaskAppVersionSelect) {
    customTaskAppVersionSelect = window.UIHelpers.createCustomSelect(
      "taskAppVersionSelect"
    );
  } else {
    customTaskAppVersionSelect.refresh();
  }

  let selected = null;
  const currentSelection = previousSelection;
  const wasCreatingNew = currentSelection === NEW_VERSION_VALUE;
  if (currentSelection && currentSelection !== NEW_VERSION_VALUE) {
    selected = list.find(
      (version) => `${version.id}` === `${currentSelection}`
    );
  }
  if (!selected && preferredVersion) {
    selected = list.find(
      (version) => `${version.version || ""}`.trim() === preferredVersion
    );
  }

  if (selected) {
    taskAppVersionSelect.value = `${selected.id}`;
    setTaskVersionInputVisible(false);
  } else if (wasCreatingNew) {
    taskAppVersionSelect.value = NEW_VERSION_VALUE;
    setTaskVersionInputVisible(true);
    applyVersionDefaults(activeTaskMode);
  } else {
    taskAppVersionSelect.value = "";
    setTaskVersionInputVisible(false);
  }
}

function updateSelectedAppVersionMeta() {
  if (!taskAppVersionSelect) {
    selectedAppVersionMeta = null;
    return;
  }
  if (!taskAppVersionSelect.value) {
    selectedAppVersionMeta = null;
    return;
  }
  if (taskAppVersionSelect.value === NEW_VERSION_VALUE) {
    selectedAppVersionMeta = null;
    return;
  }
  const selected = taskAppVersionOptions.find(
    (version) => `${version.id}` === `${taskAppVersionSelect.value}`
  );
  if (!selected) {
    selectedAppVersionMeta = null;
    return;
  }
  selectedAppVersionMeta = {
    appUrl: selected.app_url || null,
    appPath: selected.app_path || selected.artifact_uri || null,
  };
  applyDefaultTargetsFromApp();
}

async function loadAppVersionsForSelectedApp(preferredVersion) {
  if (!window.electronAPI?.listAppVersions) return;
  const selectedAppId = Number(taskAppSelect?.value || 0);
  if (!selectedAppId) {
    taskAppVersionOptions = [];
    selectedAppVersionMeta = null;
    if (taskAppVersionSelect) {
      taskAppVersionSelect.innerHTML = `<option value="">${tr("modal.app.version.select")}</option>`;
      taskAppVersionSelect.value = "";
      taskAppVersionSelect.disabled = true;
    }
    setTaskVersionInputVisible(false);
    return;
  }
  if (taskAppVersionSelect) taskAppVersionSelect.disabled = false;

  try {
    const res = await window.electronAPI.listAppVersions(selectedAppId, 200, 0);
    if (!res?.ok || !Array.isArray(res.versions)) {
      taskAppVersionOptions = [];
      renderTaskAppVersions([], preferredVersion);
      selectedAppVersionMeta = null;
      return;
    }
    renderTaskAppVersions(res.versions, preferredVersion);
    updateSelectedAppVersionMeta();
  } catch (err) {
    taskAppVersionOptions = [];
    renderTaskAppVersions([], preferredVersion);
    selectedAppVersionMeta = null;
  }
}

async function refreshTaskApps(mode, prefill, appTypeOverride) {
  if (!window.electronAPI?.listApps || !taskAppSelect) return;
  const appType = appTypeOverride;
  const preferredId = prefill?.appId;
  const preferredName = prefill?.appName;
  const requestId = ++taskAppsRequestId;

  taskAppSelect.disabled = true;
  taskAppSelect.innerHTML = `<option value="">${tr("modal.app.loading")}</option>`;

  try {
    const res = await window.electronAPI.listApps({
      appType: appType || undefined,
      limit: 200,
      offset: 0,
    });
    if (requestId !== taskAppsRequestId) return;
    if (!res?.ok) {
      throw new Error(res?.error || "Failed to fetch apps");
    }

    taskAppOptions = Array.isArray(res.apps) ? res.apps : [];
    if (!taskAppOptions.length) {
      taskAppSelect.innerHTML = `<option value="">${tr("modal.app.none")}</option>`;
      taskAppSelect.disabled = true;
      taskAppVersionOptions = [];
      if (taskAppVersionSelect) {
        taskAppVersionSelect.innerHTML = `<option value="">${tr("modal.app.version.select")}</option>`;
        taskAppVersionSelect.value = "";
        taskAppVersionSelect.disabled = true;
      }
      setTaskVersionInputVisible(false);
      return;
    }

    const optionsHtml = [
      `<option value="">${tr("modal.app.select")}</option>`,
      ...taskAppOptions.map(
        (app) => `<option value="${app.id}">${app.name}</option>`
      ),
    ].join("");
    taskAppSelect.innerHTML = optionsHtml;
    const wrap = document.getElementById("custom-wrap-taskAppSelect");
    if (wrap && wrap.refresh) wrap.refresh();

    if (!customTaskAppSelect) {
      customTaskAppSelect =
        window.UIHelpers.createCustomSelect("taskAppSelect");
    } else {
      customTaskAppSelect.refresh();
    }

    taskAppSelect.disabled = false;

    if (preferredId) {
      taskAppSelect.value = `${preferredId}`;
    } else if (preferredName) {
      const match = taskAppOptions.find(
        (app) => (app.name || "").toLowerCase() === preferredName.toLowerCase()
      );
      if (match) taskAppSelect.value = `${match.id}`;
    }
    const preferredVersion = prefill?.appVersion || "";
    loadAppVersionsForSelectedApp(preferredVersion);
  } catch (err) {
    if (requestId !== taskAppsRequestId) return;
    console.error("[Renderer] Failed to load apps:", err);
    taskAppOptions = [];
    taskAppSelect.innerHTML = `<option value="">${tr("modal.app.error")}</option>`;
    taskAppSelect.disabled = true;
    taskAppVersionOptions = [];
    if (taskAppVersionSelect) {
      taskAppVersionSelect.innerHTML = `<option value="">${tr("modal.app.version.select")}</option>`;
      taskAppVersionSelect.value = "";
      taskAppVersionSelect.disabled = true;
    }
    setTaskVersionInputVisible(false);
  }
}

async function chooseExecutableViaDialog() {
  if (!window.electronAPI?.pickTaskFile || fileDialogInFlight) return null;
  fileDialogInFlight = true;
  try {
    const picked = await window.electronAPI.pickTaskFile();
    if (picked) {
      selectedFilePath = picked;
      updateSelectedFileLabel(picked);
      taskSourceTouched = true;
      applyVersionDefaults("file");
    }
    return picked;
  } catch (err) {
    console.error("[Renderer] File picker failed:", err);
    return null;
  } finally {
    fileDialogInFlight = false;
  }
}

function applyTaskPhase(phase) {
  activeTaskPhase = phase === "source" ? "source" : "app";
  if (taskPhaseSlider) {
    taskPhaseSlider.dataset.phase = activeTaskPhase;
  }
  taskPhasePanels.forEach((panel) => {
    panel.setAttribute(
      "aria-hidden",
      panel.dataset.taskPhase === activeTaskPhase ? "false" : "true"
    );
  });
  taskActionButtons.forEach((btn) => {
    const action = btn.dataset.taskAction;
    const shouldShow =
      action === "cancel" ||
      (activeTaskPhase === "app" && action === "next") ||
      (activeTaskPhase === "source" &&
        (action === "back" || action === "submit"));
    btn.classList.toggle("hidden", !shouldShow);
  });

  if (activeTaskPhase === "app") {
    refreshTaskApps(activeTaskMode, null, null);
  }
}

function setTaskPhase(phase) {
  const nextPhase = phase === "source" ? "source" : "app";
  if (taskModalController) {
    taskModalController.goTo(nextPhase);
    return;
  }
  const modalContainer = document.querySelector("#taskModal .modal");
  window.UIHelpers.performModalTransition(modalContainer, () => {
    applyTaskPhase(nextPhase);
  });
}

function setTaskMode(mode) {
  ModalHelpers?.transition?.(taskModal, () => {
    activeTaskMode = mode;
    taskModeBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.taskMode === mode);
    });
    taskPanels.forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.taskPanel !== mode);
    });

    applyVersionDefaults(mode);
    refreshTaskApps(mode);
    applyDefaultTargetsFromApp();
  });
}

function resetTaskModal() {
  selectedFilePath = "";
  taskSourceTouched = false;
  appVersionEdited = false;
  updateSelectedFileLabel("");
  if (taskFileInput) taskFileInput.value = "";
  if (taskUrlInput) taskUrlInput.value = "";
  if (taskAppSelect) taskAppSelect.value = "";
  if (taskAppVersionInput) taskAppVersionInput.value = "";
  if (taskAppVersionSelect) {
    taskAppVersionSelect.innerHTML = "";
    taskAppVersionSelect.value = "";
  }
  setTaskVersionInputVisible(false);
  setTaskMode("file");
  setTaskPhase("app");
}

function bindTextareaDropPrevention(textarea) {
  if (!textarea) return;
  ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    textarea.addEventListener(
      eventName,
      (e) => {
        e.preventDefault();
        e.stopPropagation();
      },
      false
    );
  });
}

document.querySelectorAll(".modal-textarea").forEach((textarea) => {
  bindTextareaDropPrevention(textarea);
});

if (taskAppSelect) {
  taskAppSelect.addEventListener("change", () => {
    const selectedId = taskAppSelect.value;
    if (selectedId) {
      setStoredValue(APP_ID_KEY, activeTaskMode, selectedId);
    }
    loadAppVersionsForSelectedApp(
      getTaskAppVersionValue() ||
        getStoredValue(APP_VERSION_KEY, activeTaskMode) ||
        ""
    );
  });
}

if (taskAppVersionSelect) {
  taskAppVersionSelect.addEventListener("change", () => {
    const isNew = taskAppVersionSelect.value === NEW_VERSION_VALUE;
    setTaskVersionInputVisible(isNew);
    if (isNew) {
      applyVersionDefaults(activeTaskMode);
      if (taskAppVersionInput && taskAppVersionInput.value.trim()) {
        appVersionEdited = true;
      }
    }
    updateSelectedAppVersionMeta();
  });
}

if (taskAppVersionInput) {
  taskAppVersionInput.addEventListener("input", () => {
    appVersionEdited = true;
    updateSelectedAppVersionMeta();
  });
}

if (taskPhaseNextBtn) {
  taskPhaseNextBtn.addEventListener("click", () => {
    const selectedAppId = taskAppSelect?.value?.trim() || "";
    const appVersion = getTaskAppVersionValue();

    if (!selectedAppId) {
      showToast(tr("toast.appSelectRequired"));
      return;
    }
    if (!appVersion) {
      showToast(tr("toast.appVersionRequired"));
      return;
    }

    setTaskPhase("source");
    if (activeTaskMode === "url") {
      taskUrlInput?.focus();
    } else if (activeTaskMode === "live") {
      submitTaskBtn?.focus();
    } else if (selectedFilePath) {
      submitTaskBtn?.focus();
    }
  });
}

if (taskPhaseBackBtn) {
  taskPhaseBackBtn.addEventListener("click", () => {
    setTaskPhase("app");
    if (taskAppSelect && !taskAppSelect.disabled) {
      taskAppSelect.focus();
    } else {
      if (isCreatingNewVersion()) {
        taskAppVersionInput?.focus();
      } else {
        taskAppVersionSelect?.focus();
      }
    }
  });
}

function applyTaskPrefill(prefill) {
  if (!prefill) return;
  const mode =
    prefill.mode === "url" ? "url" : prefill.mode === "live" ? "live" : "file";
  setTaskMode(mode);
  const hasPrefillTarget =
    (mode === "url" && Boolean(prefill.url)) ||
    (mode === "file" && Boolean(prefill.filePath)) ||
    mode === "live";
  if (hasPrefillTarget) taskSourceTouched = true;

  if (mode === "url") {
    if (taskUrlInput) taskUrlInput.value = prefill.url || "";
  } else if (mode === "live") {
    // No inputs to populate for live mode
  } else if (prefill.filePath) {
    selectedFilePath = prefill.filePath;
    updateSelectedFileLabel(prefill.filePath);
  }

  if (prefill.appVersion && taskAppVersionInput) {
    taskAppVersionInput.value = prefill.appVersion;
    appVersionEdited = true;
    setTaskVersionInputVisible(true);
    if (taskAppVersionSelect) {
      taskAppVersionSelect.value = NEW_VERSION_VALUE;
    }
  }

  refreshTaskApps(mode, {
    appName: prefill.appName,
    appVersion: prefill.appVersion,
  });
}

function openTaskModal(prefill) {
  if (!taskModal) return;
  resetTaskModal();
  applyTaskPrefill(prefill);
  const shouldStartSource =
    Boolean(prefill) &&
    (prefill.mode === "url" || prefill.mode === "live" || prefill.filePath);
  setTaskPhase(shouldStartSource ? "source" : "app");
  ModalHelpers?.open?.(taskModal);
  if (activeTaskPhase === "app") {
    if (taskAppSelect && !taskAppSelect.disabled) {
      taskAppSelect.focus();
    } else {
      if (isCreatingNewVersion()) {
        taskAppVersionInput?.focus();
      } else {
        taskAppVersionSelect?.focus();
      }
    }
  } else if (prefill?.mode === "url") {
    taskUrlInput?.focus();
  } else if (prefill?.mode === "live") {
    submitTaskBtn?.focus();
  } else if (selectedFilePath) {
    submitTaskBtn?.focus();
  } else {
    taskUrlInput?.focus();
  }
  lucide.createIcons();
}

function applySettingsInfo(info) {
  if (!info) return;
  if (settingsVersion) settingsVersion.textContent = info.version || "--";
  if (settingsExecutorId)
    settingsExecutorId.textContent = info.executorId || "--";
  if (settingsUserDataPath)
    settingsUserDataPath.textContent = info.userDataPath || "--";
  if (settingsCachePath) settingsCachePath.textContent = info.cachePath || "--";
  if (settingsLogsPath) settingsLogsPath.textContent = info.logsPath || "--";
}

async function refreshSettingsInfo() {
  if (!window.electronAPI?.getSettingsInfo) return;
  try {
    settingsInfoCache = await window.electronAPI.getSettingsInfo();
    applySettingsInfo(settingsInfoCache);
  } catch (err) {
    console.warn("[Renderer] Failed to load settings info:", err);
  }
}

function openSettingsModal() {
  if (!settingsModal) return;
  ModalHelpers?.open?.(settingsModal);
  applySettingsInfo(settingsInfoCache);
  renderSettingsThemePreference(getThemePreference());
  renderSettingsLanguageSelection(currentLanguage);
  renderCaptureDefault(getCaptureDefault());
  refreshSettingsInfo();
  lucide.createIcons();
}

const CAPTURE_DEFAULT_KEY = "captureDefault";

function getThemePreference() {
  return localStorage.getItem("theme") || "system";
}

function renderSettingsThemePreference(pref) {
  settingsThemeButtons.forEach((btn) => {
    btn.classList.toggle(
      "active",
      btn.dataset.settingsTheme === (pref || "system")
    );
  });
}

function renderSettingsLanguageSelection(lang) {
  settingsLanguageButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.settingsLanguage === lang);
  });
}

function getCaptureDefault() {
  return localStorage.getItem(CAPTURE_DEFAULT_KEY) || "excluded";
}

function renderCaptureDefault(mode) {
  settingsCaptureButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.settingsCapture === mode);
  });
}

async function applyCaptureDefault(mode) {
  const next = mode === "capturable" ? "capturable" : "excluded";
  localStorage.setItem(CAPTURE_DEFAULT_KEY, next);
  renderCaptureDefault(next);
  if (window.electronAPI?.setWindowCapturability) {
    await window.electronAPI.setWindowCapturability(next === "capturable");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("appsTypeFilter")) {
    customAppsTypeFilter =
      window.UIHelpers.createCustomSelect("appsTypeFilter");
  }
});

// --- Log Rendering ---
const { pushLog: basePushLog, applyFilters: applyLogFilters } = initLogView(
  logContainer,
  logFilterControls
);

function pushLog(entry, animate = true) {
  if (isLogsPaused || !entry) return;
  basePushLog(entry, { animate });
  applyLogFilters();
}

// --- Theme (synced across windows via localStorage) ---
const setThemePreference = initThemeToggle(themeToggle, {
  onChange: (next) => {
    renderSettingsThemePreference(next);
  },
});
renderSettingsThemePreference(getThemePreference());

function initGlobalTooltip() {
  let tooltip = document.getElementById("global-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "global-tooltip";
    document.body.appendChild(tooltip);
  }

  let activeTarget = null;

  document.addEventListener("mouseover", (e) => {
    const target = e.target.closest("[data-title]");

    if (target && target !== activeTarget) {
      activeTarget = target;
      const text = target.getAttribute("data-title");

      if (text) {
        tooltip.textContent = text;
        updatePosition(target);
        requestAnimationFrame(() => {
          tooltip.style.opacity = "1";
        });
      }
    }
  });

  document.addEventListener("mouseout", (e) => {
    if (!activeTarget) return;
    if (activeTarget.contains(e.relatedTarget)) {
      return;
    }

    activeTarget = null;
    tooltip.style.opacity = "0";
    setTimeout(() => {
      if (!activeTarget) tooltip.style.top = "250px";
    }, 200);
  });

  function updatePosition(target) {
    const rect = target.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    let top = rect.top - tipRect.height - 8;
    let left = rect.left + rect.width / 2 - tipRect.width / 2;

    if (top < 0) {
      top = rect.bottom + 8;
    }

    if (left < 4) left = 4;
    if (left + tipRect.width > window.innerWidth) {
      left = window.innerWidth - tipRect.width - 4;
    }

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initGlobalTooltip);
} else {
  initGlobalTooltip();
}

// --- Log + View pause controls ---
pauseLogsBtn.addEventListener("click", () => {
  isLogsPaused = !isLogsPaused;
  pauseLogsBtn.innerHTML = isLogsPaused
    ? '<i data-lucide="play"></i>'
    : '<i data-lucide="pause"></i>';
  pauseLogsBtn.title = isLogsPaused ? tr("logs.resume") : tr("logs.pause");
  lucide.createIcons();
  showToast(
    isLogsPaused ? tr("toast.loggingPaused") : tr("toast.loggingResumed")
  );
});

toggleViewRefreshBtn.addEventListener("click", () => {
  isViewRefreshPaused = !isViewRefreshPaused;
  toggleViewRefreshBtn.innerHTML = isViewRefreshPaused
    ? '<i data-lucide="play"></i>'
    : '<i data-lucide="pause"></i>';
  toggleViewRefreshBtn.title = isViewRefreshPaused
    ? tr("view.resume")
    : tr("view.pause");
  lucide.createIcons();
  showToast(
    isViewRefreshPaused ? tr("toast.viewPaused") : tr("toast.viewResumed")
  );
});

if (window.electronAPI?.onHistoryRefresh) {
  window.electronAPI.onHistoryRefresh(() => {
    TaskHistoryUI?.loadHistory();
  });
}

// --- Button Listeners ---
newTaskBtn.addEventListener("click", () => {
  openTaskModal();
});

settingsBtn?.addEventListener("click", () => {
  openSettingsModal();
});

settingsThemeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const pref = btn.dataset.settingsTheme;
    if (!pref) return;
    setThemePreference(pref);
    renderSettingsThemePreference(pref);
  });
});

settingsLanguageButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const lang = btn.dataset.settingsLanguage;
    if (!lang) return;
    I18n?.setLanguage?.(lang);
    window.electronAPI?.setLanguage?.(lang);
    showToast(tr(`toast.language.${lang}`));
  });
});

settingsCaptureButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.settingsCapture;
    if (!mode) return;
    applyCaptureDefault(mode);
  });
});

async function resetExecutorId() {
  if (!window.electronAPI?.resetExecutorId) return;
  try {
    const res = await window.electronAPI.resetExecutorId();
    if (!res?.ok) {
      showToast(tr("settings.executor.reset.error"));
      return;
    }
    if (settingsExecutorId && res.executorId) {
      settingsExecutorId.textContent = res.executorId;
    }
    showToast(tr("settings.executor.reset.success"));
  } catch (err) {
    console.error("[Renderer] Reset executor id failed:", err);
    showToast(tr("settings.executor.reset.error"));
  }
}

settingsExecutorResetBtn?.addEventListener("click", async () => {
  const spec = window.ModalIntents?.confirmResetExecutor?.({
    onConfirm: () => resetExecutorId(),
  });
  if (spec && window.UIHelpers?.openModalSpec) {
    window.UIHelpers.openModalSpec(spec);
  }
});

captureToggleBtn.addEventListener("click", () => {
  window.electronAPI.toggleWindowCapturability();
});

taskModeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.taskMode || "file";
    taskSourceTouched = true;
    setTaskMode(mode);
  });
});

if (taskUrlInput) {
  taskUrlInput.addEventListener("input", () => {
    if (activeTaskMode !== "url") return;
    taskSourceTouched = true;
    applyVersionDefaults("url");
  });
}

if (fileBrowseBtn && taskFileInput) {
  fileBrowseBtn.addEventListener("click", async () => {
    if (window.electronAPI?.pickTaskFile) {
      const picked = await window.electronAPI.pickTaskFile();
      if (picked) {
        selectedFilePath = picked;
        updateSelectedFileLabel(picked);
        taskSourceTouched = true;
        applyVersionDefaults("file");
      }
    } else {
      taskFileInput.click();
    }
  });
}

if (taskFileInput) {
  taskFileInput.addEventListener("change", () => {
    const file = taskFileInput.files?.[0];
    const identifier = file?.path || file?.name || "";
    selectedFilePath = identifier;
    updateSelectedFileLabel(identifier);
    taskSourceTouched = true;
    applyVersionDefaults("file");
  });
}

if (fileDropZone) {
  fileDropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    fileDropZone.classList.add("dragging");
  });
  fileDropZone.addEventListener("dragleave", () => {
    fileDropZone.classList.remove("dragging");
  });
  fileDropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    fileDropZone.classList.remove("dragging");
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const identifier = file.path || file.name || "";
    selectedFilePath = identifier;
    updateSelectedFileLabel(identifier);
    taskSourceTouched = true;
    applyVersionDefaults("file");
  });
  fileDropZone.addEventListener("click", async () => {
    if (window.electronAPI?.pickTaskFile) {
      const picked = await window.electronAPI.pickTaskFile();
      if (picked) {
        selectedFilePath = picked;
        updateSelectedFileLabel(picked);
        taskSourceTouched = true;
        applyVersionDefaults("file");
      }
    } else if (taskFileInput) {
      taskFileInput.click();
    } else {
      await chooseExecutableViaDialog();
    }
  });
}

if (window.UIHelpers?.initConfirmModal) {
  window.UIHelpers.initConfirmModal();
}

enforceIntegerInput(document.getElementById("testCaseOrder"));
enforceIntegerInput(document.getElementById("bugPriorityInput"));
enforceIntegerInput(document.getElementById("bugOccurrenceEvaluationInput"));
enforceIntegerInput(document.getElementById("bugOccurrenceTestCaseInput"));
enforceIntegerInput(document.getElementById("bugOccurrenceStepInput"));

document.querySelectorAll(".settings-copy-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const targetId = btn.getAttribute("data-copy-target") || "";
    const value = document.getElementById(targetId)?.textContent?.trim() || "";
    if (!value) {
      showToast(tr("settings.toast.copyEmpty"));
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      showToast(tr("settings.toast.copySuccess"));
    } catch (err) {
      console.error("[Renderer] Copy failed:", err);
      showToast(tr("settings.toast.copyError"));
    }
  });
});

if (submitTaskBtn) {
  submitTaskBtn.addEventListener("click", () => {
    const selectedApp = getSelectedApp();
    const appName = selectedApp?.name?.trim() || "";
    const appVersion = getTaskAppVersionValue();

    if (!appName) {
      showToast(tr("toast.appSelectRequired"));
      return;
    }
    if (!appVersion) {
      showToast(tr("toast.appVersionRequired"));
      return;
    }

    applyDefaultTargetsFromApp();

    if (activeTaskMode === "file") {
      if (!selectedFilePath) {
        showToast(tr("toast.selectExecutable"));
        return;
      }
      const appType = selectedApp?.app_type || "desktop_app";
      setStoredValue(APP_VERSION_KEY, "file", appVersion);
      window.electronAPI.submitFileTask(
        selectedFilePath,
        null,
        appName,
        appVersion,
        appType
      );
      showToast(tr("toast.uploadingExecutable"));
    } else if (activeTaskMode === "url") {
      const url = taskUrlInput?.value?.trim() || "";
      if (!/^https?:\/\/.*/i.test(url)) {
        showToast(tr("toast.invalidUrl"));
        return;
      }
      const appType = selectedApp?.app_type || "web_app";
      setStoredValue(APP_VERSION_KEY, "url", appVersion);
      window.electronAPI.newUrlTask(
        url,
        null,
        appName,
        appVersion,
        appType
      );
      showToast(tr("toast.submittingUrl"));
    } else if (activeTaskMode === "live") {
      const appType = selectedApp?.app_type || "desktop_app";
      setStoredValue(APP_VERSION_KEY, "live", appVersion);
      window.electronAPI.newLiveTask(
        null,
        appName,
        appVersion,
        appType
      );
      showToast(tr("toast.submittingLive"));
    } else {
      showToast(tr("toast.invalidMode"));
      return;
    }

    ModalHelpers?.close?.(taskModal);
  });
}

toggleAgentBtn.addEventListener("click", () => {
  if (agentToggleLocked) return;
  lockAgentToggle();
  window.electronAPI.toggleAgent();
});

if (pauseAgentBtn) {
  pauseAgentBtn.addEventListener("click", () => {
    if (!isAgentRunning || workflowToggleLocked) return;

    const isPaused = workflowState === "paused";
    lockWorkflowToggle();
    if (isPaused) {
      window.electronAPI.resumeWorkflow();
      showToast(tr("toast.workflowResumed"));
    } else {
      window.electronAPI.pauseWorkflow();
      showToast(tr("toast.workflowPaused"));
    }
  });
}

clearLogsBtn.addEventListener("click", () => {
  logContainer.innerHTML = "";
  showToast(tr("toast.logsCleared"));
});

const tabConfig = {
  run: { onEnter: null },
  apps: {
    onEnter: () => {
      window.AppsUI?.onEnter?.();
    },
  },
  evaluation: {
    onEnter: () => {
      window.EvaluationUI?.onEnter?.();
    },
  },
  bugs: {
    onEnter: () => {
      window.BugsUI?.onEnter?.();
    },
  },
  history: {
    onEnter: () => {
      TaskHistoryUI?.loadHistory(true);
    },
  },
};

function activateTab(tab) {
  const target = tabConfig[tab] ? tab : "run";
  const isSame = activeTab === target;
  activeTab = target;

  tabButtons.forEach((btn) => {
    const isActive = btn.dataset.tab === target;
    btn.classList.toggle("active", isActive);
  });
  tabPanes.forEach((pane) => {
    const isActive = pane.dataset.tab === target;
    pane.classList.toggle("active", isActive);
  });

  if (!isSame && tabConfig[target]?.onEnter) {
    tabConfig[target].onEnter();
  }
  lucide.createIcons();
}

window.AppTabs = { activateTab };

if (tabButtons && tabButtons.length) {
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab || "run";
      activateTab(tab);
    });
  });
  activateTab("run");
}

// --- IPC Listeners ---
window.electronAPI.onLogUpdate((entry) => {
  pushLog(entry, true);
  applyLogFilters();
});

window.electronAPI.onWindowCapturabilityChanged((capturable) => {
  isWindowCapturable = capturable;
  captureToggleBtn.innerHTML = capturable
    ? '<i data-lucide="eye"></i>'
    : '<i data-lucide="eye-off"></i>';

  captureToggleBtn.title = capturable
    ? tr("topbar.capture.title.disable")
    : tr("topbar.capture.title.enable");

  if (!suppressCaptureToast) {
    showToast(
      capturable ? tr("toast.captureIncluded") : tr("toast.captureExcluded")
    );
  }
  suppressCaptureToast = false;
  lucide.createIcons();
});

applyCaptureDefault(getCaptureDefault());

window.electronAPI.onAgentStateChanged((state) => {
  if (state === "running") {
    isAgentRunning = true;
    workflowState = workflowState === "paused" ? "paused" : "running";
    updateAgentToggleUI();
    setStatus(tr("status.running"), "ok");
  } else {
    isAgentRunning = false;
    workflowState = "idle";
    updateAgentToggleUI();
    setStatus(tr("status.idle"), "idle");
  }
  updatePauseButton();
  unlockAgentToggle();
  unlockWorkflowToggle();
});

window.electronAPI.onAgentViewUpdate((imageBase64) => {
  if (isViewRefreshPaused) return;
  placeholderText.style.display = "none";
  agentViewImage.style.display = "block";
  agentViewImage.src = imageBase64;
});

// --- Clock ---
startLiveClock(timeLabel);

// --- Compact Mode ---
compactModeBtn.addEventListener("click", () => {
  window.electronAPI.toggleCompactMode();
});

window.electronAPI.onCompactModeChanged((state) => {
  compactModeBtn.innerHTML = state
    ? '<i data-lucide="maximize-2"></i>'
    : '<i data-lucide="minimize-2"></i>';

  showToast(state ? tr("toast.compactOn") : tr("toast.compactOff"));
  lucide.createIcons();

  // Refresh agent toggle text based on current status when returning to main UI.
  if (!state) {
    syncAgentState();
  }
});

// --- Agent Context Stream ---
window.electronAPI.onAgentContextUpdated((context) => {
  latestContext = context;
  ContextHelpers?.renderContextPanel(
    {
      goalEl: contextGoalEl,
      scratchpadEl: contextScratchpadEl,
      scratchpadLengthEl: contextScratchpadLengthEl,
      actionListEl: contextActionHistoryEl,
      actionCountEl: contextActionCountEl,
      actionTotalEl: contextActionTotalEl,
    },
    context,
    {
      scratchpadPlaceholder: tr("compact.context.scratchpad.placeholder"),
      actionEmptyLabel: tr("context.actions.empty"),
      goalPlaceholder: tr("context.goal.placeholder"),
      charsLabel: tr("context.chars"),
      actionCountSuffix: tr("context.steps.suffix"),
      stepLabel: tr("context.step"),
      actionLabelFallback: tr("context.action.fallback"),
      listMaxLen: 240,
    }
  );
});

// --- Task upload acknowledgements ---
if (window.electronAPI?.onTaskUploaded) {
  window.electronAPI.onTaskUploaded(({ jobId, kind, url }) => {
    const isUrl = kind === "url";
    const isLive = kind === "live";
    const label = isUrl
      ? `URL task #${jobId}`
      : isLive
        ? `Live task #${jobId}`
        : `Task #${jobId}`;
    const suffix = isUrl && url ? ` (${url})` : "";
    showToast(tr("toast.taskUploaded", { label, suffix }));

    TaskHistoryUI?.loadHistory(true);
    window.AppTabs?.activateTab?.("evaluation");
    window.EvaluationUI?.refreshFeed?.(true)?.then?.(() => {
      window.EvaluationUI?.selectEvaluation?.(jobId);
    });
  });
}

// --- Load Initial Logs ---
(async () => {
  try {
    const logs = await window.electronAPI.getLogBuffer();
    logs.forEach((entry) => pushLog(entry, false));
    applyLogFilters();
  } catch (err) {
    console.error("[Renderer] Failed to load initial logs:", err);
  }
})();

lucide.createIcons();

// --- Workflow lifecycle signals ---
window.electronAPI.onAgentWorkflowStateChanged((state) => {
  const stateLabel =
    state === "paused"
      ? tr("status.paused")
      : state === "running"
        ? tr("status.running")
        : tr("status.idle");
  pushLog({
    level: "system",
    message: tr("log.workflow.state", { state: stateLabel }),
    timestamp: new Date().toISOString(),
  });

  if (state === "paused") {
    setStatus(tr("status.paused"), "warn");
  } else if (state === "running") {
    setStatus(tr("status.running"), "ok");
  } else {
    setStatus(tr("status.idle"), "idle");
  }
  workflowState = state;
  updateAgentToggleUI();
  updatePauseButton();
  unlockAgentToggle();
  unlockWorkflowToggle();
});

// --- Server status poller ---

// --- Task history: load once on start (manual refresh afterward) ---
TaskHistoryUI?.loadHistory();

// Ctrl+Shift+P → Pause
// Ctrl+Shift+R → Resume
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
    if (e.key.toLowerCase() === "p") {
      window.electronAPI.pauseWorkflow();
      showToast(tr("toast.workflowPaused"));
    }
    if (e.key.toLowerCase() === "r") {
      window.electronAPI.resumeWorkflow();
      showToast(tr("toast.workflowResumed"));
    }
  }
});

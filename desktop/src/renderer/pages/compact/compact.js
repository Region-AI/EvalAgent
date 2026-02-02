// --- Element References ---
const logContainer = document.getElementById("log-container");
const clearLogsBtn = document.getElementById("clearLogs");
const statusPill = document.getElementById("status-pill");
const agentToggleBtn = document.getElementById("compactAgentToggle");
const pauseToggleBtn = document.getElementById("compactPauseToggle");
const expandBtn = document.getElementById("expandBtn");
const languageToggle = document.getElementById("languageToggle");
const themeToggle = document.getElementById("themeToggle");
const captureToggleBtn = document.getElementById("captureToggleBtn");
const timeLabel = document.getElementById("time-label");
const logFilterControls = document.getElementById(
  "log-filter-controls-compact"
);
const tabTestCase = document.getElementById("tabTestCase");
const tabContext = document.getElementById("tabContext");
const tabLogs = document.getElementById("tabLogs");
const testCasePane = document.getElementById("testCasePane");
const contextPane = document.getElementById("contextPane");
const logsPane = document.getElementById("logsPane");
const toastRoot = document.getElementById("toast-root");
const contextGoalEl = document.getElementById("context-goal");
const contextScratchpadEl = document.getElementById("context-scratchpad");
const contextScratchpadLengthEl = document.getElementById(
  "context-scratchpad-count"
);
const contextActionHistoryEl = document.getElementById("context-actions-list");
const contextActionCountEl = document.getElementById("context-actions-count");
const testCaseEvaluationIdEl = document.getElementById("testCaseEvaluationId");
const testCaseAppTypeEl = document.getElementById("testCaseAppType");
const testCaseTargetEl = document.getElementById("testCaseTarget");
const testCaseIdEl = document.getElementById("testCaseId");
const testCaseDescriptionEl = document.getElementById("testCaseDescription");
const testCaseStatusPill = document.getElementById("testCaseStatusPill");
const testCaseEvaluationGoalEl = document.getElementById(
  "testCaseEvaluationGoal"
);
const {
  initThemeToggle,
  setStatusPill,
  setPillContent,
  startLiveClock,
  createToastManager,
  initLogView,
} = window.UIHelpers;
const ContextHelpers = window?.ContextHelpers;
const I18n = window?.I18n;
const tr = (key, vars) => I18n?.t?.(key, vars) ?? key;

function renderWorkflowPill(state) {
  const normalized = (state || "idle").toString().toLowerCase();
  const label =
    normalized === "running"
      ? tr("status.running")
      : normalized === "paused"
        ? tr("status.paused")
        : tr("status.idle");
  const tone =
    normalized === "running"
      ? "running"
      : normalized === "paused"
        ? "warn"
        : "idle";
  setStatusPill(statusPill, label, tone, timeLabel);
}

function renderAgentStatePill(state) {
  if (!state) return;
  const normalized = state.toLowerCase();
  if (normalized === "running") {
    renderWorkflowPill("running");
  } else {
    renderWorkflowPill("idle");
  }
}

function renderAgentToggle(state) {
  if (!agentToggleBtn) return;
  const normalized = state?.toLowerCase();
  const isRunning = normalized === "running";
  agentToggleBtn.innerHTML = isRunning
    ? '<i data-lucide="square"></i>'
    : '<i data-lucide="play"></i>';
  agentToggleBtn.classList.toggle("running", isRunning);
  agentToggleBtn.title = isRunning
    ? tr("controls.agent.stop")
    : tr("controls.agent.start");
  lucide.createIcons();
}

function renderPauseToggle() {
  if (!pauseToggleBtn) return;
  const isRunning = agentState?.toLowerCase() === "running";
  const isPaused = currentWorkflowState === "paused";
  pauseToggleBtn.disabled = !isRunning;
  pauseToggleBtn.classList.toggle("disabled", !isRunning);
  pauseToggleBtn.innerHTML = isPaused
    ? '<i data-lucide="play"></i>'
    : '<i data-lucide="pause"></i>';
  pauseToggleBtn.title = isPaused
    ? tr("status.resumeWorkflow")
    : tr("status.pauseWorkflow");
  lucide.createIcons();
}

function renderContextPanel(context) {
  if (!context) return;
  ContextHelpers?.renderContextPanel(
    {
      goalEl: contextGoalEl,
      scratchpadEl: contextScratchpadEl,
      scratchpadLengthEl: contextScratchpadLengthEl,
      actionListEl: contextActionHistoryEl,
      actionCountEl: contextActionCountEl,
    },
    context,
    {
      scratchpadPlaceholder: tr("compact.context.scratchpad.placeholder"),
      actionEmptyLabel: tr("compact.context.actions.empty"),
      goalPlaceholder: tr("context.goal.placeholder"),
      charsLabel: tr("context.chars"),
      actionCountSuffix: tr("context.steps.suffix"),
      stepLabel: tr("context.step"),
      actionLabelFallback: tr("context.action.fallback"),
      actionMaxItems: 6,
      actionMaxLen: 240,
    }
  );
}

const { showToast } = createToastManager(toastRoot, window.electronAPI);

let currentLanguage = "en";
let isWindowCapturable = false;
let currentWorkflowState = "idle";
let latestContext = null;
let agentState = "stopped";
let latestEvaluation = null;

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
  renderLanguageToggle(currentLanguage);
  document.title = tr("compact.title");
  renderCaptureToggle(isWindowCapturable);
  renderWorkflowPill(currentWorkflowState);
  renderAgentToggle(agentState);
  renderPauseToggle();
  renderTestCasePanel();
  if (latestContext) {
    renderContextPanel(latestContext);
  }
}

async function initLanguage() {
  const preferred =
    (await window.electronAPI?.getLanguage?.().catch(() => null)) || undefined;
  await I18n?.init?.({ preferredLanguage: preferred });
  currentLanguage = I18n?.getLanguage?.() || "en";
  I18n?.applyTranslations?.(document);
  document.title = tr("compact.title");
  window.electronAPI?.setLanguage?.(currentLanguage);
  refreshDynamicText();

  I18n?.onChange?.((lang) => {
    currentLanguage = lang;
    I18n?.applyTranslations?.(document);
    document.title = tr("compact.title");
    refreshDynamicText();
  });

  window.electronAPI?.onLanguageChanged?.((lang) => {
    if (!lang) return;
    I18n?.setLanguage?.(lang);
  });

  languageToggle?.addEventListener("click", () => {
    const next = currentLanguage === "en" ? "zh" : "en";
    I18n?.setLanguage?.(next);
    window.electronAPI?.setLanguage?.(next);
    showToast(tr(`toast.language.${next}`));
  });
}

initLanguage();

// --- Logging ---
const { pushLog, applyFilters: applyLogFilters } = initLogView(
  logContainer,
  logFilterControls
);

// --- Button Events ---
clearLogsBtn.addEventListener("click", () => {
  logContainer.innerHTML = "";
  showToast(tr("toast.logsCleared"));
});

expandBtn.addEventListener("click", () => {
  window.electronAPI.toggleCompactMode(); // return to full mode
});

// Capture toggle
function renderCaptureToggle(capturable) {
  if (!captureToggleBtn) return;
  isWindowCapturable = capturable;
  captureToggleBtn.innerHTML = capturable
    ? '<i data-lucide="eye"></i>'
    : '<i data-lucide="eye-off"></i>';
  captureToggleBtn.title = capturable
    ? tr("compact.toolbar.capture.on")
    : tr("compact.toolbar.capture.off");
  lucide.createIcons();
}
renderCaptureToggle(false);

captureToggleBtn?.addEventListener("click", () => {
  window.electronAPI.toggleCompactWindowCapturability();
});

// --- Theme Toggle (synced via storage) ---
initThemeToggle(themeToggle);
renderWorkflowPill("idle");

// Grab initial agent state if exposed by preload
if (window.electronAPI?.getAgentState) {
  window.electronAPI
    .getAgentState()
    .then(({ agentState: aState, workflowState }) => {
      agentState = aState || "stopped";
      currentWorkflowState = (workflowState || aState || "idle").toLowerCase();
      renderWorkflowPill(currentWorkflowState);
      renderAgentToggle(agentState);
      renderPauseToggle();
      refreshDynamicText();
    })
    .catch(() => renderWorkflowPill("idle"));
}

// --- Live Clock ---
startLiveClock(timeLabel, { showDateTooltip: true });

// --- Electron IPC Events (Updated) ---
window.electronAPI.onLogUpdate((entry) => {
  // New logs: animate by default
  pushLog(entry);
  applyLogFilters();
});

window.electronAPI.onCompactWindowCapturabilityChanged((capturable) => {
  renderCaptureToggle(capturable);
  showToast(
    capturable ? tr("toast.captureIncluded") : tr("toast.captureExcluded")
  );
});

window.electronAPI.onAgentStateChanged((state) => {
  agentState = state || "stopped";
  currentWorkflowState =
    state?.toLowerCase() === "running" ? "running" : "idle";
  renderAgentStatePill(state);
  renderAgentToggle(state);
  renderPauseToggle();
  refreshDynamicText();
});

// --- Load previous logs from main process (Updated) ---
(async () => {
  try {
    const logs = await window.electronAPI.getLogBuffer();
    // Historical logs: render without slide animation
    logs.forEach((entry) => pushLog(entry, false));
  } catch (err) {
    console.error("[Compact] Failed to load initial logs:", err);
  }
})();

// --- Also handle one-time sync on window creation (Updated) ---
window.electronAPI.onInitLogBuffer((logs) => {
  logContainer.innerHTML = "";
  // Buffer contains structured log entries; show without animation
  logs.forEach((entry) => pushLog(entry, false));
  applyLogFilters();
});

// Initial filter application in case there are no buffered logs yet
applyLogFilters();

// Workflow state (pause/resume) updates
window.electronAPI.onAgentWorkflowStateChanged((state) => {
  currentWorkflowState = (state || "idle").toLowerCase();
  renderWorkflowPill(state);
  renderPauseToggle();
  refreshDynamicText();
});

function switchTab(target) {
  const isTest = target === "testcase";
  const isContext = target === "context";
  const isLogs = target === "logs";

  tabTestCase.classList.toggle("active", isTest);
  tabContext.classList.toggle("active", isContext);
  tabLogs.classList.toggle("active", isLogs);

  testCasePane.classList.toggle("hidden", !isTest);
  contextPane.classList.toggle("hidden", !isContext);
  logsPane.classList.toggle("hidden", !isLogs);
  lucide.createIcons();
}

tabTestCase.addEventListener("click", () => switchTab("testcase"));
tabContext.addEventListener("click", () => switchTab("context"));
tabLogs.addEventListener("click", () => switchTab("logs"));
switchTab("context");

function formatField(value, fallbackKey) {
  if (value === null || value === undefined || value === "") {
    return tr(fallbackKey);
  }
  return value;
}

function formatAppType(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  if (normalized === "desktop_app") return tr("app.type.desktop_app");
  if (normalized === "web_app") return tr("app.type.web_app");
  return value;
}

function renderTestCasePanel() {
  if (
    !testCaseEvaluationIdEl ||
    !testCaseAppTypeEl ||
    !testCaseTargetEl ||
    !testCaseIdEl ||
    !testCaseDescriptionEl ||
    !testCaseStatusPill
  ) {
    return;
  }

  testCaseEvaluationIdEl.textContent =
    latestEvaluation?.id != null ? `${latestEvaluation.id}` : "—";

  const statusRaw = latestEvaluation?.status;
  const status =
    statusRaw != null ? `${statusRaw}`.toString().toUpperCase() : null;
  const statusLabel = formatField(status, "compact.test.unknown");
  setPillContent(testCaseStatusPill, status || "unknown", {
    label: statusLabel,
  });

  const appType = formatAppType(latestEvaluation?.app_type);
  testCaseAppTypeEl.textContent = formatField(appType, "compact.test.unknown");

  const target =
    latestEvaluation?.app_url ||
    latestEvaluation?.app_path ||
    latestEvaluation?.local_application_path ||
    null;
  testCaseTargetEl.textContent = formatField(
    target,
    "compact.test.notAvailable"
  );

  if (testCaseEvaluationGoalEl) {
    const goal =
      typeof latestEvaluation?.high_level_goal === "string" &&
      latestEvaluation.high_level_goal.trim()
        ? latestEvaluation.high_level_goal.trim()
        : null;
    testCaseEvaluationGoalEl.textContent = formatField(
      goal,
      "compact.test.notAvailable"
    );
  }

  testCaseIdEl.textContent =
    latestContext?.test_case_id != null
      ? `#${latestContext.test_case_id}`
      : "#—";

  const desc =
    latestContext?.test_case_description?.trim() ||
    latestContext?.high_level_goal ||
    null;
  testCaseDescriptionEl.textContent = formatField(
    desc,
    "compact.test.notAvailable"
  );
}

window.electronAPI.onAgentContextUpdated((context) => {
  latestContext = context;
  renderContextPanel(context);
  renderTestCasePanel();
});

window.electronAPI.onEvaluationAttached?.((evaluation) => {
  latestEvaluation = evaluation || null;
  renderTestCasePanel();
});

agentToggleBtn.addEventListener("click", () => {
  window.electronAPI.toggleAgent();
});

pauseToggleBtn?.addEventListener("click", () => {
  const isRunning = agentState?.toLowerCase() === "running";
  if (!isRunning) return;
  const isPaused = currentWorkflowState === "paused";
  if (isPaused) {
    window.electronAPI.resumeWorkflow();
    showToast(tr("toast.workflowResumed"));
  } else {
    window.electronAPI.pauseWorkflow();
    showToast(tr("toast.workflowPaused"));
  }
});

// --- Initialize icons ---
lucide.createIcons();

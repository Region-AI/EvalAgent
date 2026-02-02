(() => {
  const historyList = document.getElementById("historyList");
  const historyDetail = document.getElementById("historyDetail");
  const historyTop = document.getElementById("historyTop");
  const refreshHistoryBtn = document.getElementById("refreshHistoryBtn");

  let translate = (key) => key;
  let toast = () => {};
  let openTaskModal = () => {};
  const { renderPillHtml } = window.UIHelpers || {};

  const state = {
    records: [],
    offset: 0,
    loading: false,
    exhausted: false,
    selectedId: null,
    detailTab: "testcases",
    summaryRegenerating: false,
    summaryRegeneratingId: null,
    summaryEditing: false,
    summaryEditingId: null,
    summaryEditingOriginal: null,
    expandedApps: new Set(),
    expandedVersions: new Set(),
    hierarchyTouched: false,
    activeEditor: null,
    tocVisible: false,
  };
  const evaluationCache = new Map();
  const MAX_CACHE_SIZE = 200;
  const VIRTUAL_ITEM_HEIGHT = 84;
  const VIRTUAL_ITEM_GAP = 6;
  const VIRTUAL_STRIDE = VIRTUAL_ITEM_HEIGHT + VIRTUAL_ITEM_GAP;
  let activeStatusWatchId = null;
  let statusWatchRetryTimer = null;
  let statusRenderFrame = null;
  let pendingSelectedRender = false;
  const pendingStatusIds = new Set();
  let exitEditPendingRecord = null;
  let listenersBound = false;

  const shorten = (text = "", max = 120) =>
    text && text.length > max ? `${text.slice(0, max - 1)}...` : text || "";

  const formatTimestamp = (iso) => {
    if (!iso) return "--";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "--";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const renderPill = (status, options = {}) => {
    const { label, extraClasses, includeStatusClass } = options;
    if (renderPillHtml) {
      return renderPillHtml(status, { label, extraClasses, includeStatusClass });
    }
    const raw = status == null ? "" : String(status);
    const safe = raw.trim() || "unknown";
    const className = safe.toLowerCase().replace(/\s+/g, "_");
    const classes = ["pill"];
    if (includeStatusClass !== false) classes.push(`pill-${className}`);
    if (Array.isArray(extraClasses)) {
      extraClasses.filter(Boolean).forEach((entry) => classes.push(entry));
    }
    const text = label != null ? String(label) : safe;
    return `<span class="${classes.join(" ")}">${text}</span>`;
  };

  const deriveSummary = (record) => {
    const results = record?.results ?? {};
    const summaryCandidate =
      results?.summary ?? results?.message ?? results?.notes ?? null;
    if (typeof summaryCandidate === "string" && summaryCandidate.trim()) {
      return summaryCandidate.trim();
    }
    if (
      summaryCandidate &&
      typeof summaryCandidate === "object" &&
      Object.keys(summaryCandidate).length
    ) {
      return JSON.stringify(summaryCandidate);
    }
    return translate("history.result.missing");
  };

  const getEditableSummary = (record) => {
    const summary = record?.results?.summary;
    if (typeof summary === "string") return summary;
    if (summary && typeof summary === "object") {
      try {
        return JSON.stringify(summary, null, 2);
      } catch (err) {
        return String(summary);
      }
    }
    return "";
  };

  const deriveGoal = (record) => {
    if (record?.high_level_goal && record.high_level_goal.trim()) {
      return record.high_level_goal.trim();
    }
    return translate("history.goal.missing");
  };

  const deriveAppName = (record) => {
    const name =
      record?.app_name ||
      record?.app?.name ||
      (record?.app_id ? `App ${record.app_id}` : "");
    return name ? String(name).trim() : translate("history.app.unknown");
  };

  const deriveAppType = (record) => {
    const typeRaw =
      record?.app_type ||
      record?.app?.app_type ||
      record?.appType ||
      record?.app?.type ||
      "";
    if (typeof typeRaw === "string" && typeRaw.trim()) {
      const normalized = typeRaw.trim().toLowerCase();
      if (normalized.includes("web")) return "web_app";
      if (normalized.includes("desktop")) return "desktop_app";
      return typeRaw.trim();
    }

    const versionRaw = record?.app_version ?? record?.version ?? null;
    const url =
      record?.app_url ||
      record?.target_url ||
      (versionRaw && typeof versionRaw === "object"
        ? versionRaw.app_url
        : null);
    if (url) return "web_app";

    const path =
      record?.app_path ||
      record?.local_application_path ||
      record?.application_path ||
      (versionRaw && typeof versionRaw === "object"
        ? versionRaw.app_path || versionRaw.artifact_uri
        : null);
    if (path) return "desktop_app";

    return translate("history.na");
  };

  const formatAppType = (value) => {
    if (typeof value !== "string") return translate("history.na");
    const normalized = value.trim().toLowerCase();
    if (!normalized) return translate("history.na");
    if (normalized === "desktop_app") return translate("app.type.desktop_app");
    if (normalized === "web_app") return translate("app.type.web_app");
    return value;
  };

  const deriveVersionLabel = (record) => {
    const versionRaw = record?.app_version ?? record?.version;
    if (typeof versionRaw === "string" && versionRaw.trim()) {
      return versionRaw.trim();
    }
    if (versionRaw && typeof versionRaw === "object") {
      const v =
        versionRaw.version || versionRaw.name || versionRaw.label || null;
      if (v) return String(v).trim();
    }
    return translate("history.version.unknown");
  };

  const deriveVersionKey = (record) => {
    const versionRaw = record?.app_version ?? record?.version;
    const id =
      record?.app_version_id ||
      (versionRaw && typeof versionRaw === "object" ? versionRaw.id : null);
    if (id != null) return `version-${id}`;
    return `version-${deriveVersionLabel(record)}`;
  };

  const deriveSource = (record) => {
    const versionRaw = record?.app_version ?? null;
    const source =
      record?.app_url ||
      record?.app_path ||
      record?.local_application_path ||
      record?.application_path ||
      (versionRaw && typeof versionRaw === "object"
        ? versionRaw.app_url || versionRaw.artifact_uri || versionRaw.app_path
        : null);
    return source ? String(source) : translate("history.source.live");
  };

  const deriveSourceType = (source) => {
    const text = typeof source === "string" ? source.toLowerCase() : "";
    if (!text) return translate("history.source.live");
    if (text.startsWith("http://") || text.startsWith("https://")) {
      return translate("history.source.url");
    }
    return translate("history.source.artifact");
  };

  const buildTaskPrefillFromRecord = (record) => {
    if (!record) return null;

    const urlRaw = record.app_url || record.target_url || "";
    const url = typeof urlRaw === "string" ? urlRaw.trim() : "";

    const filePathRaw =
      record.local_application_path ||
      record.application_path ||
      record.app_path ||
      "";
    const filePath =
      typeof filePathRaw === "string" && filePathRaw.trim()
        ? filePathRaw.trim()
        : "";

    const appType =
      typeof record.app_type === "string" ? record.app_type.toLowerCase() : "";

    const isLive = appType === "live" || (!url && !filePath);
    const appNameRaw = record.app_name || record.app?.name || "";
    const appName = typeof appNameRaw === "string" ? appNameRaw.trim() : "";
    const versionRaw = record.app_version ?? record.version ?? null;
    const appVersion =
      typeof versionRaw === "string"
        ? versionRaw.trim()
        : versionRaw && typeof versionRaw === "object"
          ? (versionRaw.version || versionRaw.name || "").trim()
          : "";

    return {
      mode: isLive ? "live" : url ? "url" : "file",
      url: url || "",
      filePath: filePath || "",
      appType: appType || undefined,
      appName: appName || undefined,
      appVersion: appVersion || undefined,
    };
  };

  const escapeHtml = (str = "") =>
    str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const escapeSelector = (value = "") => {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, "\\$&");
  };

  const normalizeErrorMessage = (message, fallbackKey) => {
    const text = typeof message === "string" ? message.trim() : "";
    if (!text) return translate(fallbackKey);
    const lower = text.toLowerCase();
    if (
      lower.includes("network") ||
      lower.includes("failed to fetch") ||
      lower.includes("timeout") ||
      lower.includes("socket") ||
      lower.includes("ssl") ||
      lower.includes("handshake") ||
      lower.includes("connection")
    ) {
      return translate(fallbackKey);
    }
    return text;
  };

  const toggleTOC = (visible) => {
    state.tocVisible =
      typeof visible === "boolean" ? visible : !state.tocVisible;
    const dropdown = document.getElementById("historyTocDropdown");
    const btn = document.getElementById("historyTocBtn");

    if (dropdown && btn) {
      if (state.tocVisible) {
        dropdown.classList.add("show");
        btn.classList.add("active");
        btn.style.color = "var(--accent)";
        btn.style.background = "rgba(122, 162, 255, 0.1)";

        generateAndRenderTOC(dropdown);
      } else {
        dropdown.classList.remove("show");
        btn.classList.remove("active");
        btn.style.color = "";
        btn.style.background = "";
      }
    }
  };

  const closeTOC = () => {
    if (state.tocVisible) toggleTOC(false);
  };

  const generateAndRenderTOC = (container) => {
    container.innerHTML = "";

    let markdown = "";
    if (state.summaryEditing && state.activeEditor) {
      markdown = state.activeEditor.getValue();
    } else {
      const record = getSelectedRecord();
      markdown = deriveSummary(record);
    }

    if (!markdown || !window.marked) {
      container.innerHTML = `<div class="history-toc-empty">No content</div>`;
      return;
    }

    const tokens = window.marked.lexer(markdown);
    const headings = tokens
      .map((t, idx) => ({ ...t, index: idx }))
      .filter((t) => t.type === "heading");

    if (headings.length === 0) {
      container.innerHTML = `<div class="history-toc-empty">No headers found</div>`;
      return;
    }
    const headerEl = document.createElement("div");
    headerEl.className = "history-toc-header";
    headerEl.textContent = "Table of Contents";
    container.appendChild(headerEl);
    headings.forEach((h, domIndex) => {
      const btn = document.createElement("button");
      btn.className = "history-toc-item";
      btn.setAttribute("data-depth", h.depth);
      const text = h.text
        .replace(/\*\*/g, "")
        .replace(/\*/g, "")
        .replace(/`/g, "");
      btn.textContent = text;
      btn.title = text;

      btn.onclick = (e) => {
        e.stopPropagation();
        handleTOCClick(h, domIndex);
      };
      container.appendChild(btn);
    });
  };

  const handleTOCClick = (headingToken, domIndex) => {
    if (state.summaryEditing && state.activeEditor) {
      if (state.activeEditor.scrollToBlock) {
        state.activeEditor.scrollToBlock(headingToken.index);
      }
    } else {
      const viewEl = document.getElementById("historyDetailSummary");
      if (!viewEl) return;

      const headers = viewEl.querySelectorAll("h1, h2, h3, h4, h5, h6");
      if (headers[domIndex]) {
        headers[domIndex].scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
        headers[domIndex].style.transition = "background-color 0.5s";
        headers[domIndex].style.backgroundColor = "rgba(122, 162, 255, 0.2)";
        setTimeout(() => {
          headers[domIndex].style.backgroundColor = "";
        }, 1000);
      }
    }
  };

  const updateCache = (record) => {
    if (!record?.id) return;
    const key = `${record.id}`;
    evaluationCache.set(key, record);
    if (evaluationCache.size > MAX_CACHE_SIZE) {
      const firstKey = evaluationCache.keys().next().value;
      if (firstKey) evaluationCache.delete(firstKey);
    }
  };

  const getSummaryKey = (record) => {
    const results = record?.results ?? {};
    const candidate =
      results?.summary ?? results?.message ?? results?.notes ?? "";
    if (typeof candidate === "string") return candidate;
    if (candidate && typeof candidate === "object") {
      try {
        return JSON.stringify(candidate);
      } catch {
        return String(candidate);
      }
    }
    return String(candidate || "");
  };

  const hasRecordChanged = (prev, next) => {
    if (!prev) return true;
    if (!next) return false;
    const prevStatus = (prev.status || "").toLowerCase();
    const nextStatus = (next.status || "").toLowerCase();
    if (prevStatus !== nextStatus) return true;
    if ((prev.updated_at || "") !== (next.updated_at || "")) return true;
    return getSummaryKey(prev) !== getSummaryKey(next);
  };

  const sanitizeHtml = (html = "") => {
    const allowedTags = [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "strike",
      "ul",
      "ol",
      "li",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "code",
      "pre",
      "blockquote",
      "hr",
      "div",
      "span",
      "img",
      "a",
      "section",
      "article",
      "header",
      "footer",
      "label",
      "input",
      "button",
      "form",
    ];

    const allowedAttrs = [
      "href",
      "src",
      "alt",
      "title",
      "class",
      "id",
      "style",
      "target",
      "width",
      "height",
      "type",
      "checked",
      "value",
    ];

    if (window.DOMPurify?.sanitize) {
      return window.DOMPurify.sanitize(html, {
        ALLOWED_TAGS: allowedTags,
        ALLOWED_ATTR: allowedAttrs,
        USE_PROFILES: { html: true },
      });
    }

    const allowedTagSet = new Set(allowedTags.map((tag) => tag.toUpperCase()));
    const allowedAttrSet = new Set(allowedAttrs);
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const cleanNode = (node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (!allowedTagSet.has(node.tagName.toUpperCase())) {
          const textNode = document.createTextNode(node.textContent || "");
          node.replaceWith(textNode);
          return;
        }

        Array.from(node.attributes).forEach((attr) => {
          if (!allowedAttrSet.has(attr.name.toLowerCase())) {
            node.removeAttribute(attr.name);
          }
        });
      }
      Array.from(node.childNodes).forEach(cleanNode);
    };

    Array.from(doc.body.childNodes).forEach(cleanNode);
    return doc.body.innerHTML;
  };

  const renderMarkdownTo = (el, md = "") => {
    if (!el) return;
    const safeMd = md || "";

    if (window.marked?.parse) {
      const rawHtml = window.marked.parse(safeMd, {
        mangle: false,
        headerIds: false,
        breaks: true,
      });
      el.innerHTML = sanitizeHtml(rawHtml);
      return;
    }

    el.innerHTML = `<pre>${escapeHtml(safeMd)}</pre>`;
  };

  const setHistoryLoading = (isLoading) => {
    state.loading = isLoading;
    if (refreshHistoryBtn) {
      refreshHistoryBtn.disabled = isLoading;
      refreshHistoryBtn.innerHTML = isLoading
        ? '<i data-lucide="loader-2"></i>'
        : '<i data-lucide="refresh-cw"></i>';
      refreshHistoryBtn.classList.toggle("spinning", isLoading);
      lucide.createIcons();
    }
    if (historyList && isLoading && !state.records.length) {
      historyList.innerHTML = `<div class="history-empty">${translate(
        "history.loading"
      )}</div>`;
    }
  };

  const getSelectedRecord = () =>
    state.records.find((r) => `${r.id}` === `${state.selectedId}`) || null;

  const applyRecordUpdate = (record) => {
    if (!record?.id) return null;
    const idx = state.records.findIndex((r) => `${r.id}` === `${record.id}`);
    const merged =
      idx >= 0 ? { ...state.records[idx], ...record } : { ...record };
    if (idx >= 0) {
      state.records[idx] = merged;
    } else {
      state.records.unshift(merged);
    }
    updateCache(merged);
    return merged;
  };

  const updateHistoryCard = (record) => {
    if (!historyList || !record?.id) return false;
    const card = historyList.querySelector(`[data-record-id="${record.id}"]`);
    if (!card) return false;
    card.classList.toggle("selected", `${record.id}` === `${state.selectedId}`);
    const status = (record.status || "unknown").toLowerCase();
    const pillWrap = card.querySelector('[data-role="status-pill"]');
    if (pillWrap) {
      pillWrap.innerHTML = renderPill(status, { label: status });
    }
    const updatedEl = card.querySelector('[data-role="updated-at"]');
    if (updatedEl) updatedEl.textContent = formatTimestamp(record.updated_at);
    const sourceEl = card.querySelector('[data-role="source"]');
    if (sourceEl) {
      const sourceStr = deriveSource(record);
      sourceEl.textContent = sourceStr;
      sourceEl.title = sourceStr;
    }
    const versionEl = card.querySelector('[data-role="version"]');
    if (versionEl) {
      const versionStr = deriveVersionLabel(record);
      versionEl.textContent = versionStr;
      versionEl.title = versionStr;
    }
    const goalEl = card.querySelector('[data-role="goal"]');
    if (goalEl) {
      const goalStr = deriveGoal(record);
      goalEl.textContent = goalStr;
      goalEl.title = goalStr;
    }
    return true;
  };

  const scheduleStatusRender = (selectedChanged = false) => {
    if (selectedChanged) pendingSelectedRender = true;
    if (statusRenderFrame) return;
    statusRenderFrame = requestAnimationFrame(() => {
      statusRenderFrame = null;
      const ids = Array.from(pendingStatusIds);
      pendingStatusIds.clear();

      if (historyList?.classList.contains("history-list--virtual")) {
        renderHistory(state.records, { windowOnly: true });
      } else {
        ids.forEach((id) => {
          const record = state.records.find((r) => `${r.id}` === `${id}`);
          if (record) updateHistoryCard(record);
        });
      }

      if (pendingSelectedRender) {
        renderDetail(getSelectedRecord());
        pendingSelectedRender = false;
      }
    });
  };

  const setSummaryRegenerating = (isLoading, evaluationId = null) => {
    state.summaryRegenerating = Boolean(isLoading);
    state.summaryRegeneratingId = isLoading ? evaluationId : null;
  };

  const refreshEvaluationRecord = async (evaluationId) => {
    if (!evaluationId || !window.electronAPI?.fetchEvaluation) return null;
    const res = (await window.electronAPI.fetchEvaluation(evaluationId)) || {};
    if (!res.ok || !res.evaluation) return null;
    const evaluation = res.evaluation;
    const cached =
      evaluationCache.get(`${evaluationId}`) ||
      state.records.find((r) => `${r.id}` === `${evaluationId}`) ||
      null;
    if (!hasRecordChanged(cached, evaluation)) return evaluation;
    const updated = applyRecordUpdate(evaluation);
    if (historyList?.classList.contains("history-list--virtual")) {
      renderHistory(state.records);
    } else {
      updateHistoryCard(updated);
    }
    if (`${state.selectedId}` === `${evaluationId}`) {
      renderDetail(getSelectedRecord());
    }
    return evaluation;
  };

  const setSummaryEditing = (isEditing, record = null) => {
    state.summaryEditing = Boolean(isEditing);
    state.summaryEditingId = isEditing ? (record?.id ?? null) : null;
    state.summaryEditingOriginal = isEditing
      ? getEditableSummary(record)
      : null;
  };

  const hasUnsavedSummaryChanges = () => {
    if (!state.summaryEditing || !state.activeEditor) return false;
    const current = state.activeEditor.getValue();
    return current !== (state.summaryEditingOriginal ?? "");
  };

  const showExitEditModal = (record) => {
    exitEditPendingRecord = record || null;
    const spec = {
      id: "exit-edit",
      kind: "confirm",
      intent: "exitEdit",
      category: translate("history.detail.exitConfirm.eyebrow"),
      title: translate("history.detail.exitConfirm.title"),
      body: translate("history.detail.exitConfirm.desc"),
      actions: [
        {
          id: "save",
          label: translate("history.detail.exitConfirm.save"),
          kind: "primary",
          handler: async () => {
            if (!exitEditPendingRecord) return false;
            const ok = await saveSummary(exitEditPendingRecord);
            if (!ok) return false;
            exitEdit(getSelectedRecord());
            return ok;
          },
        },
        {
          id: "discard",
          label: translate("history.detail.exitConfirm.discard"),
          kind: "danger",
          handler: () => {
            exitEdit(exitEditPendingRecord || getSelectedRecord());
          },
        },
        {
          id: "cancel",
          label: translate("history.detail.exitConfirm.cancel"),
          kind: "secondary",
        },
      ],
    };

    if (window.UIHelpers?.openModalSpec) {
      window.UIHelpers
        .openModalSpec(spec)
        .finally(() => (exitEditPendingRecord = null));
      return;
    }
    const pending = exitEditPendingRecord;
    exitEditPendingRecord = null;
    exitEdit(pending || getSelectedRecord());
  };

  const saveSummary = async (record, btnElement) => {
    if (!record || !state.activeEditor) return false;
    const newSummary = state.activeEditor.getValue();
    if (btnElement) {
      btnElement.disabled = true;
      btnElement.classList.add("spinning");
    }
    try {
      await window.electronAPI.updateEvaluationSummary(record.id, newSummary);
      applySummaryUpdate(record.id, { results: { summary: newSummary } });
      toast(translate("history.detail.save.success"));
      return true;
    } catch (err) {
      console.error(err);
      toast(translate("history.detail.save.error"));
      return false;
    } finally {
      if (btnElement) {
        btnElement.disabled = false;
        btnElement.classList.remove("spinning");
      }
    }
  };

  const exitEdit = (record) => {
    setSummaryEditing(false);
    renderDetail(record || getSelectedRecord());
  };

  const attemptExitEdit = (record) => {
    if (!hasUnsavedSummaryChanges()) {
      exitEdit(record);
      return;
    }
    showExitEditModal(record);
  };

  const applySummaryUpdate = (recordId, evaluation) => {
    if (!recordId) return;
    const updated = applyRecordUpdate({ id: recordId, ...evaluation });
    if (historyList?.classList.contains("history-list--virtual")) {
      renderHistory(state.records);
    } else {
      updateHistoryCard(updated);
    }
  };

  const regenerateSummary = async (record = getSelectedRecord()) => {
    if (!record || !record.id) return;
    if (!window.electronAPI?.regenerateEvaluationSummary) return;
    if (state.summaryRegenerating) return;

    const status = (record.status || "").toLowerCase();
    if (status !== "completed") {
      toast(translate("history.toast.regenerate.ineligible"));
      return;
    }

    setSummaryRegenerating(true, record.id);
    renderDetail(record);
    try {
      const res =
        (await window.electronAPI.regenerateEvaluationSummary(record.id)) || {};
      if (!res.ok) {
        const msg = normalizeErrorMessage(
          res.error,
          "history.toast.regenerate.error"
        );
        toast(msg);
        setSummaryRegenerating(false);
        return;
      }

      toast(translate("history.toast.regenerate.success"));
    } catch (err) {
      console.error("[History] Regenerate summary failed:", err);
      const msg = normalizeErrorMessage(
        err?.message,
        "history.toast.regenerate.error"
      );
      toast(msg);
      setSummaryRegenerating(false);
    }
  };

  const buildHistoryCard = (record, isSelected, positionIndex = null) => {
    const card = document.createElement("div");
    card.className = `history-card selectable-item selectable-item--card${
      isSelected ? " selected" : ""
    }`;
    card.dataset.recordId = record.id;

    if (positionIndex !== null) {
      card.style.top = `${positionIndex * VIRTUAL_STRIDE}px`;
      card.style.height = `${VIRTUAL_ITEM_HEIGHT}px`;
    } else {
      card.style.removeProperty("top");
      card.style.removeProperty("height");
    }

    const status = (record.status || "unknown").toLowerCase();
    const sourceStr = deriveSource(record);
    const goalStr = deriveGoal(record);
    const versionStr = deriveVersionLabel(record);

    card.innerHTML = `
      <div class="history-card-header">
        <div style="display: flex; gap: 8px; white-space: nowrap;">
          <div class="history-id">#${record.id}</div>
        </div>
        <span data-role="status-pill">
          ${renderPill(status, { label: status })}
        </span>
      </div>
      <div class="history-meta-row">
        <span class="history-version" data-role="version" title="${escapeHtml(
          versionStr
        )}">${escapeHtml(versionStr)}</span>
        <span data-role="updated-at">${formatTimestamp(record.updated_at)}</span>
      </div>
      <div class="history-target-row" data-role="source" title="${escapeHtml(
        sourceStr
      )}">
        ${escapeHtml(sourceStr)}
      </div>
      <div class="history-goal" data-role="goal" title="${escapeHtml(goalStr)}">
        ${escapeHtml(goalStr)}
      </div>
    `;

    card.addEventListener("click", () => {
      if (`${state.selectedId}` === `${record.id}`) return;
      state.selectedId = record.id;
      renderHistory(state.records);
      renderDetail(record);
      startStatusWatch(record.id, true);
      refreshEvaluationRecord(record.id);
    });

    return card;
  };

  const buildHistoryHierarchy = (records) => {
    const appMap = new Map();
    records.forEach((record) => {
      const appName = deriveAppName(record);
      const appType = formatAppType(deriveAppType(record));
      const appKey =
        record?.app_id != null ? `app-${record.app_id}` : `app-${appName}`;
      if (!appMap.has(appKey)) {
        appMap.set(appKey, {
          key: appKey,
          name: appName,
          type: appType,
          versions: new Map(),
          count: 0,
        });
      }
      const appGroup = appMap.get(appKey);
      appGroup.count += 1;

      const versionKey = deriveVersionKey(record);
      if (!appGroup.versions.has(versionKey)) {
        const versionLabel = deriveVersionLabel(record);
        const source = deriveSource(record);
        appGroup.versions.set(versionKey, {
          key: versionKey,
          label: versionLabel,
          source,
          sourceType: deriveSourceType(source),
          records: [],
        });
      }
      appGroup.versions.get(versionKey).records.push(record);
    });

    return Array.from(appMap.values()).map((group) => ({
      ...group,
      versions: Array.from(group.versions.values()),
    }));
  };

  const isAppExpanded = (key) =>
    !state.hierarchyTouched || state.expandedApps.has(key);
  const isVersionExpanded = (key) =>
    !state.hierarchyTouched || state.expandedVersions.has(key);

  const expandForRecord = (record) => {
    if (!record) return;
    const appKey =
      record?.app_id != null
        ? `app-${record.app_id}`
        : `app-${deriveAppName(record)}`;
    const versionKey = deriveVersionKey(record);
    state.expandedApps.add(appKey);
    state.expandedVersions.add(versionKey);
  };

  const renderHistory = (records = state.records, options = {}) => {
    const data = Array.isArray(records) ? records : [];
    state.records = data;
    if (!historyList) return;

    if (!data.length) {
      historyList.classList.remove("history-list--virtual");
      historyList.style.height = "";
      historyList.innerHTML = `<div class="history-empty">${translate(
        "history.empty"
      )}</div>`;
      return;
    }

    historyList.classList.remove("history-list--virtual");
    historyList.style.height = "";
    historyList.innerHTML = "";

    if (state.selectedId) {
      const selected = data.find((r) => `${r.id}` === `${state.selectedId}`);
      expandForRecord(selected);
    }

    const hierarchy = buildHistoryHierarchy(data);
    if (!state.hierarchyTouched) {
      hierarchy.forEach((group) => {
        state.expandedApps.add(group.key);
        group.versions.forEach((version) => {
          state.expandedVersions.add(version.key);
        });
      });
    }

    const fragment = document.createDocumentFragment();
    hierarchy.forEach((group) => {
      const appGroupEl = document.createElement("div");
      appGroupEl.className = `history-group${
        isAppExpanded(group.key) ? "" : " is-collapsed"
      }`;
      appGroupEl.dataset.appKey = group.key;

      const appHeader = document.createElement("button");
      appHeader.type = "button";
      appHeader.className =
        "history-group-header selectable-item selectable-item--row";
      appHeader.dataset.role = "app-toggle";
      appHeader.dataset.appKey = group.key;
      appHeader.innerHTML = `
        <span class="history-group-title">
          <span class="history-toggle-icon" data-role="toggle-icon">
            <i data-lucide="chevron-down"></i>
          </span>
          <span class="history-group-name">${escapeHtml(group.name)}</span>
          ${renderPill(group.type, {
            label: escapeHtml(group.type),
            extraClasses: ["subtle"],
            includeStatusClass: false,
          })}
        </span>
        <span class="history-group-count">${group.count}</span>
      `;

      const appBody = document.createElement("div");
      appBody.className = "history-group-body";

      group.versions.forEach((version) => {
        const versionGroupEl = document.createElement("div");
        versionGroupEl.className = `history-version-group${
          isVersionExpanded(version.key) ? "" : " is-collapsed"
        }`;
        versionGroupEl.dataset.versionKey = version.key;

        const versionHeader = document.createElement("button");
        versionHeader.type = "button";
        versionHeader.className =
          "history-version-header selectable-item selectable-item--row";
        versionHeader.dataset.role = "version-toggle";
        versionHeader.dataset.versionKey = version.key;
        versionHeader.innerHTML = `
          <span class="history-group-title">
            <span class="history-toggle-icon" data-role="toggle-icon">
              <i data-lucide="chevron-down"></i>
            </span>
            <span class="history-version-name">${escapeHtml(
              version.label
            )}</span>
          </span>
          <span class="history-version-meta">
            ${renderPill(version.sourceType, {
              label: escapeHtml(version.sourceType),
              extraClasses: ["subtle"],
              includeStatusClass: false,
            })}
          </span>
        `;

        const versionBody = document.createElement("div");
        versionBody.className = "history-version-body";

        version.records.forEach((record) => {
          const isSelected = `${record.id}` === `${state.selectedId}`;
          versionBody.appendChild(buildHistoryCard(record, isSelected));
        });

        versionGroupEl.appendChild(versionHeader);
        versionGroupEl.appendChild(versionBody);
        appBody.appendChild(versionGroupEl);
      });

      appGroupEl.appendChild(appHeader);
      appGroupEl.appendChild(appBody);
      fragment.appendChild(appGroupEl);
    });

    historyList.appendChild(fragment);

    if (state.loading && !state.records.length) {
      const loader = document.createElement("div");
      loader.className = "history-empty";
      loader.textContent = translate("history.loading");
      historyList.appendChild(loader);
    }

    lucide.createIcons();
  };

  const renderDetail = (record = getSelectedRecord()) => {
    if (!historyDetail) return;

    state.tocVisible = false;

    if (!record) {
      if (state.summaryEditing) {
        setSummaryEditing(false);
      }
      historyDetail.innerHTML = `<div class="history-empty">${translate(
        "history.detail.empty"
      )}</div>`;
      return;
    }

    const goal = deriveGoal(record);
    const target = deriveSource(record);
    const appName = deriveAppName(record);
    const versionLabel = deriveVersionLabel(record);
    const appType = formatAppType(deriveAppType(record));
    const summaryMd = deriveSummary(record);
    const status = (record.status || "unknown").toLowerCase();
    const isRegenerating =
      state.summaryRegenerating &&
      `${state.summaryRegeneratingId}` === `${record.id}`;
    const isEditing =
      state.summaryEditing && `${state.summaryEditingId}` === `${record.id}`;
    if (state.summaryEditing && !isEditing) {
      setSummaryEditing(false);
    }
    setTimeout(() => {
      if (window.lucide && window.lucide.createIcons) {
        window.lucide.createIcons({ root: historyDetail });
      }
    }, 0);
    const canRegenerate = status === "completed";

    const summarySheenClass =
      status === "summarizing" || isRegenerating ? "summary-sheen" : "";
    const regenerateDisabledAttr =
      canRegenerate && !isRegenerating && !isEditing ? "" : "disabled";
    const iconName = isRegenerating ? "loader-2" : "refresh-cw";
    const regenerateIconClass = isRegenerating ? "spinning" : "";
    const summaryEditDisabledAttr = isRegenerating ? "disabled" : "";

    historyDetail.innerHTML = `
      <div class="history-detail__header-wrapper history-content-animate">
        <div class="history-detail__header">
          <div>
            <p class="eyebrow">${translate("history.detail.title")}</p>
            <h3>#${record.id}</h3>
            <div class="history-detail__breadcrumb">${escapeHtml(
              appName
            )} / ${escapeHtml(versionLabel)}</div>
          </div>
          <div class="history-detail__actions">
            ${renderPill(status, { label: status })}
            <button class="btn secondary history-rerun-btn" id="historyDetailRerun">
              ${translate("history.rerun")}
            </button>
          </div>
        </div>

        <div class="history-detail__meta">
          <div class="meta-item">
            <span class="meta-label">${translate("history.detail.app")}</span>
            <span class="meta-value" title="${escapeHtml(appName)}">${shorten(appName, 40)}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">${translate("history.detail.version")}</span>
            <span class="meta-value" title="${escapeHtml(
              versionLabel
            )}">${shorten(versionLabel, 40)}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">${translate("history.detail.source")}</span>
            <span class="meta-value code" title="${escapeHtml(
              target
            )}">${shorten(target, 40)}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">${translate("history.detail.mode")}</span>
            <span class="meta-value">${appType}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">${translate("history.detail.goal")}</span>
            <span class="meta-value" title="${escapeHtml(goal)}">${shorten(goal, 60)}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">${translate("history.detail.updated")}</span>
            <span class="meta-value">${formatTimestamp(record.updated_at)}</span>
          </div>
        </div>
      </div>

      <div class="history-detail-scroll">
        <div class="history-detail__content history-content-animate ${summarySheenClass}" style="animation-delay: 0.05s;">
          <div class="section-heading">
            <div class="section-heading-left">
              <div class="history-subtabs">
                <button class="history-subtab-btn" data-history-tab="testcases">
                  ${translate("history.detail.testcases")}
                </button>
                <button class="history-subtab-btn" data-history-tab="summary">
                  ${translate("history.detail.summary")}
                </button>
              </div>
            </div>
            <div class="section-heading-actions" id="historySummaryActions">
              <div class="history-actions-group" style="${isEditing ? "display:none" : "display:flex; align-items:center; gap:2px;"}">
                <button class="icon-btn" id="historySummaryCopyBtn" title="${translate("history.detail.copy")}"><i data-lucide="copy"></i></button>
                <button class="icon-btn" id="historySummaryDownloadBtn" title="${translate("history.detail.download")}"><i data-lucide="download"></i></button>
                <button class="icon-btn" id="historySummaryExportPdfBtn" title="${translate("history.detail.exportPdf")}"><i data-lucide="file-down"></i></button>
                <div class="actions-divider"></div>
                <button class="btn subtle history-regenerate-btn" id="historySummaryRegenerateBtn" ${regenerateDisabledAttr}>
                  <span class="history-regenerate-icon ${regenerateIconClass}"><i data-lucide="${iconName}"></i></span>
                  <span>${translate("history.detail.regenerate")}</span>
                </button>
              </div>
              
              <div style="display:flex; align-items:center; gap:2px;">
                 <button class="btn subtle history-edit-btn" id="historySummaryEditBtn" ${summaryEditDisabledAttr} style="${isEditing ? "margin-right:8px;" : ""}">
                  <span class="history-edit-icon"><i data-lucide="${isEditing ? "x" : "edit-3"}"></i></span>
                  <span>${isEditing ? translate("history.detail.exit") : translate("history.detail.edit")}</span>
                </button>
                
                <div class="history-toc-wrapper">
                  <button class="icon-btn" id="historyTocBtn" title="Table of Contents">
                    <i data-lucide="list"></i>
                  </button>
                  <div class="history-toc-dropdown" id="historyTocDropdown"></div>
                </div>
              </div>
            </div>
          </div>
          
          <div class="history-tab-panels">
            <div class="history-tab-panel" data-history-panel="testcases">
              <div class="history-testcases">
                <div
                  class="evaluation-panel-shell hidden-empty"
                  id="evaluationTasksPanel"
                >
                  <div class="history-empty">
                    ${translate("evaluation.tasks.empty")}
                  </div>
                </div>
                <div
                  class="evaluation-panel-shell hidden-empty"
                  id="evaluationTaskDetail"
                >
                  <div class="history-empty">
                    ${translate("evaluation.task.empty")}
                  </div>
                </div>
              </div>
            </div>
            <div class="history-tab-panel" data-history-panel="summary">
              <div id="historySummaryContainer"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    const container = document.getElementById("historySummaryContainer");
    const summaryActions = document.getElementById("historySummaryActions");
    const tabButtons = historyDetail.querySelectorAll("[data-history-tab]");
    const tabPanels = historyDetail.querySelectorAll("[data-history-panel]");

    const setDetailTab = (nextTab) => {
      const targetTab =
        state.summaryEditing && nextTab !== "summary" ? "summary" : nextTab;
      state.detailTab = targetTab;
      tabButtons.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.historyTab === targetTab);
      });
      tabPanels.forEach((panel) => {
        panel.classList.toggle(
          "active",
          panel.dataset.historyPanel === targetTab
        );
      });
      if (summaryActions) {
        summaryActions.style.display = targetTab === "summary" ? "" : "none";
      }
    };

    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        setDetailTab(btn.dataset.historyTab);
      });
    });

    setDetailTab(state.detailTab || "testcases");

    if (isEditing) {
      if (window.BlockEditor) {
        state.activeEditor = new window.BlockEditor(
          container,
          getEditableSummary(record),
          {
            onSave: async (_newSummary, btnElement) => {
              const ok = await saveSummary(record, btnElement);
              if (ok) {
                state.summaryEditingOriginal =
                  state.activeEditor?.getValue?.() ?? "";
              }
            },
            onCancel: () => {
              attemptExitEdit(record);
            },
          }
        );
      } else {
        container.innerHTML = translate("history.detail.editorMissing");
      }

      const editorSaveBtn = document.getElementById("editorSaveBtn");
      if (editorSaveBtn) {
        editorSaveBtn.onclick = async () => {
          const ok = await saveSummary(record, editorSaveBtn);
          if (ok) {
            state.summaryEditingOriginal =
              state.activeEditor?.getValue?.() ?? "";
          }
        };
      }

      const editorCancelBtn = document.getElementById("editorCancelBtn");
      if (editorCancelBtn) {
        editorCancelBtn.onclick = () => {
          attemptExitEdit(record);
        };
      }
    } else {
      state.activeEditor = null;
      const viewEl = document.createElement("div");
      viewEl.className = "markdown-body";
      viewEl.id = "historyDetailSummary";
      container.appendChild(viewEl);
      renderMarkdownTo(viewEl, summaryMd);
    }

    const tocBtn = document.getElementById("historyTocBtn");
    if (tocBtn) {
      tocBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleTOC();
      });
    }
    document.addEventListener("click", (e) => {
      const dropdown = document.getElementById("historyTocDropdown");
      if (
        dropdown &&
        !dropdown.contains(e.target) &&
        e.target !== tocBtn &&
        !tocBtn.contains(e.target)
      ) {
        closeTOC();
      }
    });

    window.EvaluationUI?.selectEvaluation?.(record.id);

    const copyBtn = document.getElementById("historySummaryCopyBtn");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(summaryMd || "");
          toast(translate("history.detail.copy.success"));
        } catch (err) {
          console.error("[History] Copy failed:", err);
          toast(translate("history.detail.copy.error"));
        }
      });
    }

    const downloadBtn = document.getElementById("historySummaryDownloadBtn");
    if (downloadBtn) {
      downloadBtn.addEventListener("click", () => {
        const blob = new Blob([summaryMd || ""], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `history-${record.id || "summary"}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast(translate("history.detail.download.success"));
      });
    }

    const exportPdfBtn = document.getElementById("historySummaryExportPdfBtn");
    if (exportPdfBtn) {
      exportPdfBtn.addEventListener("click", () => {
        if (!window.html2pdf) {
          toast(translate("history.detail.exportPdf.missingLib"));
          return;
        }
        const element = document.getElementById("historyDetailSummary");
        toast(translate("history.detail.exportPdf.generating"));
        const opt = {
          margin: [15, 15, 15, 15],
          filename: `history-${record.id || "summary"}.pdf`,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            backgroundColor: "#ffffff",
            onclone: (clonedDoc) => {
              const root = clonedDoc.documentElement;
              root.classList.remove("dark");
              root.classList.add("light");
              const style = clonedDoc.createElement("style");
              style.textContent = `
                  #historyDetailSummary p,
                  #historyDetailSummary li,
                  #historyDetailSummary blockquote,
                  #historyDetailSummary pre,
                  #historyDetailSummary table {
                    break-inside: avoid;
                    page-break-inside: avoid;
                  }
                `;
              clonedDoc.head.appendChild(style);
              const clonedContent = clonedDoc.getElementById(
                "historyDetailSummary"
              );
              if (clonedContent) {
                clonedContent.style.color = "#0c1117";
                clonedContent.style.backgroundColor = "#ffffff";
              }
            },
          },
          pagebreak: { mode: ["avoid-all", "css", "legacy"] },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        };

        window
          .html2pdf()
          .set(opt)
          .from(element)
          .save()
          .then(() => {
            toast(translate("history.detail.exportPdf.success"));
          })
          .catch((err) => {
            console.error(err);
            toast(translate("history.detail.exportPdf.error"));
          });
      });
    }

    const regenerateBtn = document.getElementById(
      "historySummaryRegenerateBtn"
    );
    if (regenerateBtn) {
      regenerateBtn.addEventListener("click", () => {
        if (!canRegenerate || state.summaryRegenerating) return;
        regenerateSummary(record);
      });
    }

    const editBtn = document.getElementById("historySummaryEditBtn");
    if (editBtn) {
      editBtn.addEventListener("click", () => {
        if (state.summaryRegenerating) return;
        if (isEditing) {
          attemptExitEdit(record);
          return;
        }
        setSummaryEditing(true, record);
        renderDetail(record);
      });
    }

    const rerunFromDetail = document.getElementById("historyDetailRerun");
    if (rerunFromDetail) {
      rerunFromDetail.addEventListener("click", () => {
        const prefill = buildTaskPrefillFromRecord(record);
        const hasTarget =
          prefill &&
          (prefill.mode === "live" || prefill.url || prefill.filePath);
        if (!hasTarget) {
          toast(translate("history.toast.missingTarget"));
          return;
        }
        openTaskModal(prefill);
        toast(translate("history.toast.retriggerring"));
      });
    }

    lucide.createIcons();
  };

  const stopStatusWatch = () => {
    activeStatusWatchId = null;
    if (statusWatchRetryTimer) {
      clearTimeout(statusWatchRetryTimer);
      statusWatchRetryTimer = null;
    }
    window.electronAPI?.stopEvaluationStatus?.();
  };

  const startStatusWatch = (evaluationId, force = false) => {
    if (!evaluationId) return;
    if (!force && `${activeStatusWatchId}` === `${evaluationId}`) return;
    stopStatusWatch();
    activeStatusWatchId = evaluationId;
    window.electronAPI?.watchEvaluationStatus?.(evaluationId);
  };

  const scheduleStatusRetry = (evaluationId) => {
    if (!evaluationId) return;
    if (statusWatchRetryTimer) clearTimeout(statusWatchRetryTimer);
    statusWatchRetryTimer = setTimeout(() => {
      if (`${state.selectedId}` === `${evaluationId}`) {
        startStatusWatch(evaluationId, true);
      }
    }, 1200);
  };

  const loadHistory = async (reset = false, targetId = null) => {
    if (!window.electronAPI?.getAssignedEvaluations) return;
    if (state.loading) return;
    if (reset) {
      state.offset = 0;
      state.records = [];
      state.exhausted = false;
      state.selectedId = targetId || null;
      renderHistory(state.records);
    }
    if (state.exhausted && !reset) return false;

    state.loading = true;
    setHistoryLoading(true);
    try {
      const limit = 20;
      const records =
        (await window.electronAPI.getAssignedEvaluations(
          limit,
          state.offset
        )) ?? [];

      state.offset += records.length;
      if (!records.length || records.length < limit) {
        state.exhausted = true;
      }

      const mergedRecords = records.map((record) => {
        const cached = evaluationCache.get(`${record.id}`);
        const merged = cached ? { ...cached, ...record } : record;
        updateCache(merged);
        return merged;
      });

      state.records = reset
        ? mergedRecords
        : [...state.records, ...mergedRecords];

      if (!state.selectedId && state.records.length) {
        state.selectedId = targetId || state.records[0].id;
      }

      renderHistory(state.records);
      renderDetail();
      if (
        reset &&
        state.selectedId &&
        `${activeStatusWatchId}` !== `${state.selectedId}`
      ) {
        startStatusWatch(state.selectedId, true);
      }
      const found = state.records.some(
        (r) => `${r.id}` === `${state.selectedId}`
      );
      return found;
    } catch (err) {
      console.error("[Renderer] Failed to load task history:", err);
      if (historyList) {
        historyList.innerHTML = `<div class="history-empty">${translate(
          "history.error"
        )}</div>`;
      }
      return false;
    } finally {
      state.loading = false;
      setHistoryLoading(false);
    }
  };

  const selectById = async (id) => {
    if (!id) return;
    state.selectedId = id;
    let found = await loadHistory(true, id);
    while (!found && !state.exhausted) {
      // eslint-disable-next-line no-await-in-loop
      found = await loadHistory(false, id);
    }
    renderDetail();
    if (state.selectedId) {
      startStatusWatch(state.selectedId, true);
      refreshEvaluationRecord(state.selectedId);
    }
  };

  const bindListeners = () => {
    if (refreshHistoryBtn) {
      refreshHistoryBtn.addEventListener("click", () => {
        loadHistory(true);
      });
    }

    if (historyList) {
      historyList.addEventListener("click", (event) => {
        const appToggle = event.target.closest('[data-role="app-toggle"]');
        if (appToggle) {
          event.preventDefault();
          event.stopPropagation();
          const key = appToggle.dataset.appKey;
          if (!key) return;
          const groupEl = historyList.querySelector(
            `.history-group[data-app-key="${escapeSelector(key)}"]`
          );
          if (!groupEl) return;
          const isCollapsed = groupEl.classList.contains("is-collapsed");
          state.hierarchyTouched = true;
          if (isCollapsed) {
            groupEl.classList.remove("is-collapsed");
            state.expandedApps.add(key);
          } else {
            groupEl.classList.add("is-collapsed");
            state.expandedApps.delete(key);
          }
          return;
        }

        const versionToggle = event.target.closest(
          '[data-role="version-toggle"]'
        );
        if (versionToggle) {
          event.preventDefault();
          event.stopPropagation();
          const key = versionToggle.dataset.versionKey;
          if (!key) return;
          const groupEl = historyList.querySelector(
            `.history-version-group[data-version-key="${escapeSelector(key)}"]`
          );
          if (!groupEl) return;
          const isCollapsed = groupEl.classList.contains("is-collapsed");
          state.hierarchyTouched = true;
          if (isCollapsed) {
            groupEl.classList.remove("is-collapsed");
            state.expandedVersions.add(key);
          } else {
            groupEl.classList.add("is-collapsed");
            state.expandedVersions.delete(key);
          }
        }
      });
    }

    if (historyTop) {
      historyTop.addEventListener("scroll", () => {
        if (historyList?.classList.contains("history-list--virtual")) {
          renderHistory(state.records, { windowOnly: true });
        }
        if (
          historyTop.scrollTop + historyTop.clientHeight >=
            historyTop.scrollHeight - 12 &&
          !state.loading
        ) {
          loadHistory();
        }
      });
    }

  };

  const init = (options = {}) => {
    translate = options.translate || translate;
    toast = options.showToast || toast;
    openTaskModal = options.openTaskModal || openTaskModal;
    if (!listenersBound) {
      bindListeners();
      listenersBound = true;
    }

    if (window.electronAPI?.onEvaluationStatus) {
      window.electronAPI.onEvaluationStatus(({ evaluationId, event, data }) => {
        if (!evaluationId) return;

        if (event === "status") {
          const nextStatus = (data || "").toLowerCase();
          let changed = false;

          state.records = state.records.map((rec) => {
            if (`${rec.id}` !== `${evaluationId}`) return rec;
            const currentStatus = (rec.status || "").toLowerCase();
            if (currentStatus === nextStatus) return rec;
            changed = true;
            const updated = { ...rec, status: data };
            updateCache(updated);
            return updated;
          });

          if (!changed) return;

          pendingStatusIds.add(`${evaluationId}`);
          scheduleStatusRender(`${state.selectedId}` === `${evaluationId}`);

          if (
            nextStatus === "completed" &&
            `${state.summaryRegeneratingId}` === `${evaluationId}`
          ) {
            refreshEvaluationRecord(evaluationId).finally(() => {
              setSummaryRegenerating(false);
              renderDetail(getSelectedRecord());
            });
          }
        } else if (event === "error") {
          const msg = data || "";
          const isAbort =
            typeof msg === "string" && msg.toLowerCase().includes("aborted");
          if (!isAbort) {
            toast(normalizeErrorMessage(msg, "history.error"));
          }
          scheduleStatusRetry(evaluationId);
        }
      });
    }
  };

  window.TaskHistoryUI = {
    init,
    loadHistory,
    renderHistory,
    renderDetail,
    selectById,
  };
})();

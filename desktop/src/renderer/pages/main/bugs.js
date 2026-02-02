(() => {
  const translate = (key, vars) =>
    window.I18n?.t?.(key, vars) ?? (window.__appTr || ((k) => k))(key, vars);
  const notify = (msg, ttl) => (window.__appShowToast || (() => {}))(msg, ttl);
  const tr = translate;
  const showToast = notify;
  const { renderPillHtml } = window.UIHelpers || {};

  const BUG_STATUSES = [
    "NEW",
    "IN_PROGRESS",
    "PENDING_VERIFICATION",
    "CLOSED",
    "REOPENED",
  ];
  const BUG_SEVERITIES = ["P0", "P1", "P2", "P3"];
  const customSelects = {};
  const multiSelects = {};

  const state = {
    apps: [],
    versions: [],
    bugs: [],
    selectedAppId: null,
    selectedBugId: null,
    loading: false,
    detailTab: "details",
    filters: {
      status: [],
      severity: [],
      versionIds: [],
      fix: [],
      search: "",
    },
  };

  const bugsListEl = document.getElementById("bugsList");
  const bugsDetailEl = document.getElementById("bugsDetail");
  const bugsAppSelect = document.getElementById("bugsAppSelect");
  const bugsStatusFilter = document.getElementById("bugsStatusFilter");
  const bugsSeverityFilter = document.getElementById("bugsSeverityFilter");
  const bugsVersionFilter = document.getElementById("bugsVersionFilter");
  const bugsFixFilter = document.getElementById("bugsFixFilter");
  const bugsSearchInput = document.getElementById("bugsSearchInput");
  const bugsNewBtn = document.getElementById("bugsNewBtn");
  const bugsRefreshBtn = document.getElementById("bugsRefreshBtn");

  const bugModal = document.getElementById("bugModal");
  const bugModalTitle = document.getElementById("bugModalTitle");
  const bugTitleInput = document.getElementById("bugTitleInput");
  const bugDescriptionInput = document.getElementById("bugDescriptionInput");
  const bugStatusInput = document.getElementById("bugStatusInput");
  const bugSeverityInput = document.getElementById("bugSeverityInput");
  const bugPriorityInput = document.getElementById("bugPriorityInput");
  const bugDiscoveredVersionInput = document.getElementById(
    "bugDiscoveredVersionInput"
  );
  const bugFingerprintInput = document.getElementById("bugFingerprintInput");
  const bugEnvironmentInput = document.getElementById("bugEnvironmentInput");
  const bugReproInput = document.getElementById("bugReproInput");
  const submitBugModalBtn = document.getElementById("submitBugModalBtn");

  const bugOccurrenceModal = document.getElementById("bugOccurrenceModal");
  const bugOccurrenceEvaluationInput = document.getElementById(
    "bugOccurrenceEvaluationInput"
  );
  const bugOccurrenceTestCaseInput = document.getElementById(
    "bugOccurrenceTestCaseInput"
  );
  const bugOccurrenceVersionInput = document.getElementById(
    "bugOccurrenceVersionInput"
  );
  const bugOccurrenceStepInput = document.getElementById(
    "bugOccurrenceStepInput"
  );
  const bugOccurrenceActionInput = document.getElementById(
    "bugOccurrenceActionInput"
  );
  const bugOccurrenceExpectedInput = document.getElementById(
    "bugOccurrenceExpectedInput"
  );
  const bugOccurrenceActualInput = document.getElementById(
    "bugOccurrenceActualInput"
  );
  const bugOccurrenceScreenshotInput = document.getElementById(
    "bugOccurrenceScreenshotInput"
  );
  const bugOccurrenceLogInput = document.getElementById(
    "bugOccurrenceLogInput"
  );
  const bugOccurrenceRawInput = document.getElementById(
    "bugOccurrenceRawInput"
  );
  const bugOccurrenceObservedInput = document.getElementById(
    "bugOccurrenceObservedInput"
  );
  const bugOccurrenceExecutorInput = document.getElementById(
    "bugOccurrenceExecutorInput"
  );
  const submitBugOccurrenceModalBtn = document.getElementById(
    "submitBugOccurrenceModalBtn"
  );

  const ModalHelpers = window?.ModalHelpers;
  if (bugModal && ModalHelpers?.createModal) {
    ModalHelpers.createModal(bugModal, {
      transitionMs: 180,
      bodyLayout: "columns",
    });
  }
  if (bugOccurrenceModal && ModalHelpers?.createModal) {
    ModalHelpers.createModal(bugOccurrenceModal, {
      transitionMs: 180,
      bodyLayout: "columns",
    });
  }

  let bugModalMode = "create";
  let editingBugId = null;
  let activeBugDetail = null;
  let activeOccurrences = [];
  let activeFixes = [];
  let listenersBound = false;
  let bugFixElements = null;

  const ensureCustomSelect = (selectId) => {
    if (!window.UIHelpers?.createCustomSelect) return null;
    const cached = customSelects[selectId];
    if (cached) {
      if (!cached.isConnected) {
        delete customSelects[selectId];
      } else {
        return cached;
      }
    }
    const wrapper = window.UIHelpers.createCustomSelect(selectId);
    if (wrapper) customSelects[selectId] = wrapper;
    return wrapper;
  };

  const refreshCustomSelect = (selectId) => {
    const wrapper = customSelects[selectId] || ensureCustomSelect(selectId);
    wrapper?.refresh?.();
  };

  const ensureMultiSelect = (selectId, options = {}) => {
    if (!window.UIHelpers?.createMultiSelect) return null;
    if (multiSelects[selectId]) return multiSelects[selectId];
    const wrapper = window.UIHelpers.createMultiSelect(selectId, options);
    if (wrapper) multiSelects[selectId] = wrapper;
    return wrapper;
  };

  const refreshMultiSelect = (selectId, options = {}) => {
    const wrapper = multiSelects[selectId] || ensureMultiSelect(selectId, options);
    wrapper?.refresh?.(options);
  };

  const getBugFixElements = () => {
    const versionInput = document.getElementById("bugFixVersionInput");
    if (!versionInput) return null;
    const evaluationInput = document.getElementById("bugFixEvaluationInput");
    const noteInput = document.getElementById("bugFixNoteInput");
    bugFixElements = {
      versionInput,
      evaluationInput,
      noteInput,
    };
    return bugFixElements;
  };

  const initCustomSelects = () => {
    [
      "bugsAppSelect",
      "bugStatusInput",
      "bugSeverityInput",
      "bugDiscoveredVersionInput",
      "bugOccurrenceVersionInput",
      "bugFixVersionInput",
    ].forEach((selectId) => refreshCustomSelect(selectId));

    refreshMultiSelect("bugsStatusFilter");
    refreshMultiSelect("bugsSeverityFilter");
    refreshMultiSelect("bugsVersionFilter");
    refreshMultiSelect("bugsFixFilter");
  };

  const escapeHtml = (value) => {
    const str = value == null ? "" : String(value);
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  const renderPill = (status, label) => {
    if (renderPillHtml) {
      return renderPillHtml(status, { label });
    }
    const raw = status == null ? "" : String(status);
    const safe = raw.trim() || "unknown";
    const className = safe.toLowerCase().replace(/\s+/g, "_");
    const text = label != null ? String(label) : safe;
    return `<span class="pill pill-${className}">${text}</span>`;
  };

  const formatTimestamp = (iso) => {
    if (window.DateUtils?.formatDateTime) {
      return window.DateUtils.formatDateTime(iso, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
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

  const enforceIntegerInput = (input) => {
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
  };

  const normalizeErrorMessage = (message, fallbackKey) => {
    const text = typeof message === "string" ? message.trim() : "";
    if (!text) return tr(fallbackKey);
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
      return tr(fallbackKey);
    }
    return text;
  };

  const getFixCount = (bug) => {
    if (!bug) return 0;
    if (Number.isFinite(bug.fix_count)) return Number(bug.fix_count) || 0;
    if (Array.isArray(bug.fixes)) return bug.fixes.length;
    if (bug.latest_fix || bug.fixed_in_version_id) return 1;
    return 0;
  };

  const parseOptionalJson = (raw, emptyValue = null) => {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) return emptyValue;
    const parsed = JSON.parse(text);
    return parsed;
  };

  const parseOptionalNumber = (raw) => {
    if (raw == null || raw === "") return null;
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  };

  const getMultiSelectValues = (selectEl) => {
    if (!selectEl) return [];
    const selected = Array.from(selectEl.options).filter((opt) => opt.selected);
    const hasAll = selected.some(
      (opt) => !String(opt.value || "").trim()
    );
    if (hasAll) return [];
    return selected
      .map((opt) => String(opt.value || "").trim())
      .filter((value) => value);
  };

  const setSelectOptions = (selectEl, options, placeholder) => {
    if (!selectEl) return;
    const items = Array.isArray(options) ? options : [];
    const head = placeholder
      ? `<option value="">${escapeHtml(placeholder)}</option>`
      : "";
    selectEl.innerHTML =
      head +
      items
        .map(
          (opt) =>
            `<option value="${escapeHtml(opt.value)}">${escapeHtml(
              opt.label
            )}</option>`
        )
        .join("");
  };

  const updateBugStatusOptions = () => {
    const options = BUG_STATUSES.map((value) => ({
      value,
      label: tr(`bugs.status.${value.toLowerCase()}`),
    }));

    setSelectOptions(
      bugStatusInput,
      options,
      tr("bugs.form.status.placeholder")
    );
    refreshCustomSelect("bugStatusInput");

    const filterOptions = [
      { value: "", label: tr("bugs.filter.status.all") },
      ...options,
    ];
    setSelectOptions(bugsStatusFilter, filterOptions, null);
    refreshMultiSelect("bugsStatusFilter");
  };

  const updateBugSeverityOptions = () => {
    const options = BUG_SEVERITIES.map((value) => ({
      value,
      label: tr(`bugs.severity.${value.toLowerCase()}`),
    }));

    setSelectOptions(
      bugSeverityInput,
      options,
      tr("bugs.form.severity.placeholder")
    );
    refreshCustomSelect("bugSeverityInput");

    const filterOptions = [
      { value: "", label: tr("bugs.filter.severity.all") },
      ...options,
    ];
    setSelectOptions(bugsSeverityFilter, filterOptions, null);
    refreshMultiSelect("bugsSeverityFilter");
  };

  const updateVersionOptions = () => {
    const options = state.versions.map((version) => ({
      value: `${version.id}`,
      label: version.version || `#${version.id}`,
    }));

    setSelectOptions(
      bugsVersionFilter,
      [{ value: "", label: tr("bugs.filter.version.all") }, ...options],
      null
    );
    refreshMultiSelect("bugsVersionFilter");

    setSelectOptions(
      bugDiscoveredVersionInput,
      [{ value: "", label: tr("bugs.form.version.none") }, ...options],
      null
    );
    refreshCustomSelect("bugDiscoveredVersionInput");

    setSelectOptions(
      bugOccurrenceVersionInput,
      [{ value: "", label: tr("bugs.occurrence.version.none") }, ...options],
      null
    );
    refreshCustomSelect("bugOccurrenceVersionInput");

    const fixEls = getBugFixElements();
    if (fixEls?.versionInput) {
      setSelectOptions(
        fixEls.versionInput,
        [{ value: "", label: tr("bugs.fix.version.none") }, ...options],
        null
      );
      refreshCustomSelect("bugFixVersionInput");
    }
  };

  const renderApps = () => {
    if (!bugsAppSelect) return;
    const options = state.apps.map((app) => ({
      value: `${app.id}`,
      label: app.name || `App ${app.id}`,
    }));
    setSelectOptions(bugsAppSelect, options, tr("bugs.app.select"));
    if (state.selectedAppId) {
      bugsAppSelect.value = `${state.selectedAppId}`;
    }
    refreshCustomSelect("bugsAppSelect");
  };

  const renderBugList = () => {
    if (!bugsListEl) return;

    if (!state.selectedAppId) {
      bugsListEl.innerHTML = `<div class="bugs-empty">${tr(
        "bugs.empty.app"
      )}</div>`;
      return;
    }

    if (state.loading) {
      bugsListEl.innerHTML = `<div class="bugs-empty">${tr(
        "bugs.loading"
      )}</div>`;
      return;
    }

    const results = applyLocalFilters(state.bugs);
    if (!results.length) {
      bugsListEl.innerHTML = `<div class="bugs-empty">${tr(
        "bugs.empty.list"
      )}</div>`;
      return;
    }

    bugsListEl.innerHTML = results
      .map((bug) => {
        const isSelected = `${bug.id}` === `${state.selectedBugId}`;
        const status = (bug.status || "").toLowerCase();
        const severity = (bug.severity_level || "").toUpperCase();
        const occurrenceCount = bug.occurrence_count ?? 0;
        const fixCount = getFixCount(bug);

        const updatedAt = bug.updated_at || bug.created_at;
        const updatedLabel = bug.updated_at
          ? tr("bugs.list.updated")
          : tr("bugs.detail.created");
        return `
          <div class="bug-card selectable-item selectable-item--card ${isSelected ? "selected" : ""}" data-bug-id="${bug.id}">
            <div class="bug-card-header">
              <span class="bug-title">${escapeHtml(bug.title || tr("bugs.untitled"))}</span>
              ${renderPill(status || "unknown", escapeHtml(status || tr("bugs.status.unknown")))}
            </div>
            <div class="bug-card-meta">
              <span class="bug-severity bug-severity-${severity.toLowerCase()}">${escapeHtml(
                severity || tr("bugs.severity.unknown")
              )}</span>
              <span class="bug-meta">${tr("bugs.list.occurrences", {
                count: occurrenceCount,
              })}</span>
              <span class="bug-meta">${tr("bugs.list.fixes", {
                count: fixCount,
              })}</span>
            </div>
            <div class="bug-card-footer">
              <span class="bug-meta bug-found">
                ${tr("bugs.list.foundIn")}: ${escapeHtml(
                  resolveVersionLabel(bug.discovered_version_id)
                )}
              </span>
              <span class="bug-meta bug-updated">${updatedLabel}: ${formatTimestamp(
                updatedAt
              )}</span>
            </div>
          </div>
        `;
      })
      .join("");

    bugsListEl.querySelectorAll(".bug-card").forEach((card) => {
      card.addEventListener("click", () => {
        const bugId = card.getAttribute("data-bug-id");
        if (bugId) selectBug(Number(bugId));
      });
    });
  };

  const renderBugDetail = () => {
    if (!bugsDetailEl) return;

    if (!state.selectedAppId) {
      bugsDetailEl.innerHTML = `<div class="bugs-empty">${tr(
        "bugs.empty.detail"
      )}</div>`;
      return;
    }

    if (!state.selectedBugId || !activeBugDetail) {
      bugsDetailEl.innerHTML = `<div class="bugs-empty">${tr(
        "bugs.empty.detail"
      )}</div>`;
      return;
    }

    const bug = activeBugDetail;
    const status = (bug.status || "unknown").toLowerCase();
    const severity = (bug.severity_level || "").toUpperCase();
    const updatedAt = bug.updated_at || bug.created_at;
    const env = bug.environment ? JSON.stringify(bug.environment, null, 2) : "";
    const repro = bug.reproduction_steps
      ? JSON.stringify(bug.reproduction_steps, null, 2)
      : "";

    bugsDetailEl.innerHTML = `
      <div class="bugs-detail-header">
        <div class="bugs-detail-title">
          <div class="bugs-detail-eyebrow">${tr("bugs.detail.eyebrow")}</div>
          <h3>${escapeHtml(bug.title || tr("bugs.untitled"))}</h3>
          <div class="bugs-detail-subtitle">${escapeHtml(
            bug.description || tr("bugs.detail.noDescription")
          )}</div>
          <div class="bugs-detail-chips">
            ${renderPill(status, escapeHtml(status || tr("bugs.status.unknown")))}
            <span class="bug-severity bug-severity-${severity.toLowerCase()}">${escapeHtml(
              severity || tr("bugs.severity.unknown")
            )}</span>
            <span class="bugs-detail-priority">${tr("bugs.detail.priority")}: ${
              bug.priority != null ? escapeHtml(bug.priority) : "--"
            }</span>
          </div>
        </div>
        <div class="bugs-detail-actions">
          <button class="btn subtle" id="bugEditBtn">${tr(
            "bugs.actions.edit"
          )}</button>
          <button class="btn danger" id="bugDeleteBtn">${tr(
            "bugs.actions.delete"
          )}</button>
        </div>
      </div>

      <div class="bugs-detail-meta">
        <div class="meta-item">
          <span class="meta-label">${tr("bugs.detail.discovered")}</span>
          <span class="meta-value">${escapeHtml(
            resolveVersionLabel(bug.discovered_version_id)
          )}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">${tr("bugs.detail.created")}</span>
          <span class="meta-value">${formatTimestamp(bug.created_at)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">${tr("bugs.detail.updated")}</span>
          <span class="meta-value">${formatTimestamp(updatedAt)}</span>
        </div>
      </div>

      <div class="bugs-subtabs">
        <button class="bugs-subtab-btn" data-bug-tab="details">${tr(
          "bugs.tab.details"
        )}</button>
        <button class="bugs-subtab-btn" data-bug-tab="occurrences">${tr(
          "bugs.tab.occurrences"
        )}</button>
        <button class="bugs-subtab-btn" data-bug-tab="fixes">${tr(
          "bugs.tab.fixes"
        )}</button>
      </div>

      <div class="bugs-tab-panels">
        <div class="bugs-tab-panel" data-bug-panel="details">
          <div class="bugs-detail-block">
            <div class="meta-item">
              <span class="meta-label">${tr("bugs.detail.fingerprint")}</span>
              <span class="meta-value">${escapeHtml(
                bug.fingerprint || "--"
              )}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">${tr("bugs.detail.environment")}</span>
              <pre class="bugs-code">${escapeHtml(env || "--")}</pre>
            </div>
            <div class="meta-item">
              <span class="meta-label">${tr("bugs.detail.reproduction")}</span>
              <pre class="bugs-code">${escapeHtml(repro || "--")}</pre>
            </div>
          </div>
        </div>
        <div class="bugs-tab-panel" data-bug-panel="occurrences">
          <div class="bugs-panel-actions">
            <button class="btn secondary" id="bugAddOccurrenceBtn">${tr(
              "bugs.occurrence.add"
            )}</button>
          </div>
          <div class="bugs-occurrence-list">
            ${renderOccurrences()}
          </div>
        </div>
        <div class="bugs-tab-panel" data-bug-panel="fixes">
          <div class="bugs-panel-actions">
            <button class="btn secondary" id="bugAddFixBtn">${tr(
              "bugs.fix.add"
            )}</button>
          </div>
          <div class="bugs-fix-list">
            ${renderFixes()}
          </div>
        </div>
      </div>
    `;

    const tabButtons = bugsDetailEl.querySelectorAll("[data-bug-tab]");
    const tabPanels = bugsDetailEl.querySelectorAll("[data-bug-panel]");

    const applyTab = (tab) => {
      state.detailTab = tab;
      tabButtons.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.bugTab === tab);
      });
      tabPanels.forEach((panel) => {
        panel.classList.toggle("active", panel.dataset.bugPanel === tab);
      });
    };

    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => applyTab(btn.dataset.bugTab));
    });

    applyTab(state.detailTab || "details");

    const editBtn = document.getElementById("bugEditBtn");
    editBtn?.addEventListener("click", () => openBugModal("edit", bug));

    const deleteBtn = document.getElementById("bugDeleteBtn");
    deleteBtn?.addEventListener("click", () => confirmDeleteBug(bug));

    const addOccurrenceBtn = document.getElementById("bugAddOccurrenceBtn");
    addOccurrenceBtn?.addEventListener("click", () => openOccurrenceModal());

    const addFixBtn = document.getElementById("bugAddFixBtn");
    addFixBtn?.addEventListener("click", () => openFixModal());

    bugsDetailEl.querySelectorAll("[data-open-evaluation]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = Number(btn.getAttribute("data-open-evaluation"));
        if (!Number.isFinite(id) || id <= 0) return;
        openEvaluation(id);
      });
    });

    bugsDetailEl.querySelectorAll("[data-delete-fix]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const fixId = Number(btn.getAttribute("data-delete-fix"));
        if (!Number.isFinite(fixId)) return;
        confirmDeleteFix(fixId);
      });
    });

  };

  const renderOccurrences = () => {
    if (!activeOccurrences.length) {
      return `<div class="bugs-empty-inline">${tr(
        "bugs.occurrence.empty"
      )}</div>`;
    }

    return activeOccurrences
      .map((occ) => {
        const evaluationId = occ.evaluation_id || "--";
        const testCaseId = occ.test_case_id || "--";
        const observed = formatTimestamp(occ.observed_at);
        const versionLabel = resolveVersionLabel(occ.app_version_id);
        const expected = occ.expected || "--";
        const actual = occ.actual || "--";
        const canOpen =
          Number.isFinite(Number(occ.evaluation_id)) &&
          Number(occ.evaluation_id) > 0;

        return `
          <div class="bugs-occurrence-item selectable-item--card">
            <div class="bugs-occurrence-header">
              <span>${tr("bugs.occurrence.evaluation")}: ${escapeHtml(
                evaluationId
              )}</span>
              <span>${tr("bugs.occurrence.testcase")}: ${escapeHtml(
                testCaseId
              )}</span>
              <span>${tr("bugs.occurrence.version")}: ${escapeHtml(
                versionLabel
              )}</span>
            </div>
            <div class="bugs-occurrence-body">
              <div><strong>${tr("bugs.occurrence.expected")}:</strong> ${escapeHtml(
                expected
              )}</div>
              <div><strong>${tr("bugs.occurrence.actual")}:</strong> ${escapeHtml(
                actual
              )}</div>
              <div><strong>${tr("bugs.occurrence.observed")}:</strong> ${escapeHtml(
                observed
              )}</div>
            </div>
            <div class="bugs-occurrence-actions">
              <button class="btn subtle" data-open-evaluation="${
                canOpen ? occ.evaluation_id : ""
              }" ${canOpen ? "" : "disabled"}>${tr(
                "bugs.actions.openEvaluation"
              )}</button>
            </div>
          </div>
        `;
      })
      .join("");
  };

  const renderFixes = () => {
    if (!activeFixes.length) {
      return `<div class="bugs-empty-inline">${tr("bugs.fix.empty")}</div>`;
    }

    return activeFixes
      .map((fix) => {
        const versionLabel = resolveVersionLabel(fix.fixed_in_version_id);
        const verified = fix.verified_by_evaluation_id || "--";
        const note = fix.note || "--";
        const created = formatTimestamp(fix.created_at);
        return `
          <div class="bugs-fix-item selectable-item--card">
            <div class="bugs-fix-header">
              <span>${tr("bugs.fix.version")}:</span>
              <strong>${escapeHtml(versionLabel)}</strong>
              <span>${tr("bugs.fix.verified")}: ${escapeHtml(verified)}</span>
            </div>
            <div class="bugs-fix-body">
              <div>${escapeHtml(note)}</div>
              <div class="bugs-fix-meta">${tr("bugs.fix.created")}: ${escapeHtml(
                created
              )}</div>
            </div>
            <div class="bugs-fix-actions">
              <button class="btn subtle" data-delete-fix="${fix.id}">${tr(
                "bugs.actions.delete"
              )}</button>
            </div>
          </div>
        `;
      })
      .join("");
  };

  const resolveVersionLabel = (versionId) => {
    if (!versionId) return "--";
    const found = state.versions.find((v) => `${v.id}` === `${versionId}`);
    return found?.version || `#${versionId}`;
  };

  const applyLocalFilters = (items) => {
    let results = [...items];
    const search = (state.filters.search || "").toLowerCase();
    const fixFilter = Array.isArray(state.filters.fix)
      ? state.filters.fix
      : [];
    const statusFilter = Array.isArray(state.filters.status)
      ? state.filters.status
      : [];
    const severityFilter = Array.isArray(state.filters.severity)
      ? state.filters.severity
      : [];
    const versionFilter = Array.isArray(state.filters.versionIds)
      ? state.filters.versionIds
      : [];

    if (search) {
      results = results.filter((bug) => {
        const title = String(bug.title || "").toLowerCase();
        const desc = String(bug.description || "").toLowerCase();
        const fingerprint = String(bug.fingerprint || "").toLowerCase();
        return (
          title.includes(search) ||
          desc.includes(search) ||
          fingerprint.includes(search)
        );
      });
    }

    if (statusFilter.length) {
      results = results.filter((bug) =>
        statusFilter.includes(String(bug.status || "").toUpperCase())
      );
    }

    if (severityFilter.length) {
      results = results.filter((bug) =>
        severityFilter.includes(String(bug.severity_level || "").toUpperCase())
      );
    }

    if (versionFilter.length) {
      results = results.filter((bug) =>
        versionFilter.includes(String(bug.discovered_version_id || ""))
      );
    }

    if (fixFilter.length === 1 && fixFilter[0] === "fixed") {
      results = results.filter((bug) => getFixCount(bug) > 0);
    } else if (fixFilter.length === 1 && fixFilter[0] === "open") {
      results = results.filter((bug) => getFixCount(bug) === 0);
    }

    const severityRank = (value) => {
      const key = String(value || "").toUpperCase();
      if (key === "P0") return 0;
      if (key === "P1") return 1;
      if (key === "P2") return 2;
      if (key === "P3") return 3;
      return 4;
    };

    const statusRank = (value) => {
      const key = String(value || "").toUpperCase();
      if (key === "NEW") return 0;
      if (key === "IN_PROGRESS") return 1;
      if (key === "PENDING_VERIFICATION") return 2;
      if (key === "REOPENED") return 3;
      if (key === "CLOSED") return 99;
      return 98;
    };

    const isClosed = (value) =>
      String(value || "").toUpperCase() === "CLOSED";

    const textKey = (value) => String(value || "").toLowerCase();

    results.sort((a, b) => {
      const closedA = isClosed(a.status);
      const closedB = isClosed(b.status);
      if (closedA !== closedB) return closedA ? 1 : -1;

      const sevDiff =
        severityRank(a.severity_level) - severityRank(b.severity_level);
      if (sevDiff) return sevDiff;

      const statusDiff = statusRank(a.status) - statusRank(b.status);
      if (statusDiff) return statusDiff;

      const fixDiff = getFixCount(a) - getFixCount(b);
      if (fixDiff) return fixDiff;

      const tA = new Date(a.updated_at || a.created_at || 0).getTime();
      const tB = new Date(b.updated_at || b.created_at || 0).getTime();
      if (tA !== tB) return tB - tA;

      const cA = new Date(a.created_at || 0).getTime();
      const cB = new Date(b.created_at || 0).getTime();
      if (cA !== cB) return cB - cA;

      const titleDiff = textKey(a.title).localeCompare(textKey(b.title));
      if (titleDiff) return titleDiff;

      return Number(b.id || 0) - Number(a.id || 0);
    });

    return results;
  };

  const openBugModal = (mode = "create", bug = null) => {
    bugModalMode = mode === "edit" ? "edit" : "create";
    editingBugId = bug?.id ?? null;
    if (bugModalTitle) {
      bugModalTitle.textContent =
        bugModalMode === "edit"
          ? tr("bugs.modal.title.edit")
          : tr("bugs.modal.title.create");
    }

    if (bugTitleInput) bugTitleInput.value = bug?.title || "";
    if (bugDescriptionInput) bugDescriptionInput.value = bug?.description || "";
    if (bugStatusInput) bugStatusInput.value = bug?.status || BUG_STATUSES[0];
    if (bugSeverityInput)
      bugSeverityInput.value = bug?.severity_level || BUG_SEVERITIES[2];
    if (bugPriorityInput)
      bugPriorityInput.value = bug?.priority != null ? `${bug.priority}` : "";
    if (bugDiscoveredVersionInput)
      bugDiscoveredVersionInput.value = bug?.discovered_version_id
        ? `${bug.discovered_version_id}`
        : "";
    if (bugFingerprintInput) bugFingerprintInput.value = bug?.fingerprint || "";
    if (bugEnvironmentInput)
      bugEnvironmentInput.value = bug?.environment
        ? JSON.stringify(bug.environment, null, 2)
        : "";
    if (bugReproInput)
      bugReproInput.value = bug?.reproduction_steps
        ? JSON.stringify(bug.reproduction_steps, null, 2)
        : "";

    refreshCustomSelect("bugStatusInput");
    refreshCustomSelect("bugSeverityInput");
    refreshCustomSelect("bugDiscoveredVersionInput");

    if (!bugModal) return;
    ModalHelpers?.open?.(bugModal);
  };


  const openOccurrenceModal = () => {
    if (!bugOccurrenceModal) return;
    if (bugOccurrenceEvaluationInput) bugOccurrenceEvaluationInput.value = "";
    if (bugOccurrenceTestCaseInput) bugOccurrenceTestCaseInput.value = "";
    if (bugOccurrenceVersionInput)
      bugOccurrenceVersionInput.value = activeBugDetail?.discovered_version_id
        ? `${activeBugDetail.discovered_version_id}`
        : "";
    if (bugOccurrenceStepInput) bugOccurrenceStepInput.value = "";
    if (bugOccurrenceActionInput) bugOccurrenceActionInput.value = "";
    if (bugOccurrenceExpectedInput) bugOccurrenceExpectedInput.value = "";
    if (bugOccurrenceActualInput) bugOccurrenceActualInput.value = "";
    if (bugOccurrenceScreenshotInput) bugOccurrenceScreenshotInput.value = "";
    if (bugOccurrenceLogInput) bugOccurrenceLogInput.value = "";
    if (bugOccurrenceRawInput) bugOccurrenceRawInput.value = "";
    if (bugOccurrenceObservedInput) bugOccurrenceObservedInput.value = "";
    if (bugOccurrenceExecutorInput) bugOccurrenceExecutorInput.value = "";

    refreshCustomSelect("bugOccurrenceVersionInput");

    ModalHelpers?.open?.(bugOccurrenceModal);
  };


  const openFixModal = () => {
    if (!window.UIHelpers?.openFormModal) return;
    window.UIHelpers.openFormModal({
      eyebrow: tr("bugs.fix.eyebrow"),
      title: tr("bugs.fix.title"),
      desc: tr("bugs.fix.desc"),
      body: `
        <div class="form-group">
          <label data-i18n="bugs.fix.version">Fixed In Version</label>
          <select id="bugFixVersionInput" class="select"></select>
        </div>
        <div class="form-group">
          <label data-i18n="bugs.fix.evaluation">Verified By Evaluation</label>
          <input id="bugFixEvaluationInput" type="number" min="1" step="1" />
        </div>
        <div class="form-group">
          <label data-i18n="bugs.fix.note">Note</label>
          <textarea id="bugFixNoteInput" class="modal-textarea" rows="2"></textarea>
        </div>
      `,
      actions: [
        {
          id: "cancel",
          label: tr("modal.cancel"),
          kind: "secondary",
        },
        {
          id: "save",
          label: tr("bugs.fix.save"),
          kind: "primary",
          primary: true,
          handler: handleFixSubmit,
        },
      ],
      initialFocusSelector: "#bugFixVersionInput",
      onOpen: () => {
        const fixEls = getBugFixElements();
        if (fixEls?.versionInput) fixEls.versionInput.value = "";
        if (fixEls?.evaluationInput) fixEls.evaluationInput.value = "";
        if (fixEls?.noteInput) fixEls.noteInput.value = "";
        enforceIntegerInput(fixEls?.evaluationInput);
        updateVersionOptions();
        refreshCustomSelect("bugFixVersionInput");
        window.I18n?.applyTranslations?.(
          document.getElementById("formModal")
        );
      },
      onClose: () => {
        bugFixElements = null;
      },
    });
  };


  const confirmDeleteBug = (bug) => {
    if (!bug) return;
    const spec = window.ModalIntents?.confirmDeleteBug?.({
      bugTitle: bug.title || "Bug",
      onConfirm: () => deleteBug(bug.id),
    });
    if (spec && window.UIHelpers?.openModalSpec) {
      window.UIHelpers.openModalSpec(spec);
    }
  };

  const confirmDeleteFix = (fixId) => {
    if (!activeBugDetail) return;
    const spec = window.ModalIntents?.confirmDeleteFix?.({
      onConfirm: () => deleteFix(fixId),
    });
    if (spec && window.UIHelpers?.openModalSpec) {
      window.UIHelpers.openModalSpec(spec);
    }
  };

  const deleteBug = async (bugId) => {
    const res = await window.electronAPI?.deleteBug?.(bugId);
    if (!res?.ok) {
      showToast(normalizeErrorMessage(res?.error, "bugs.error.delete"));
      return;
    }
    showToast(tr("bugs.toast.deleted"));
    if (`${state.selectedBugId}` === `${bugId}`) {
      state.selectedBugId = null;
      activeBugDetail = null;
    }
    await refreshBugs();
    renderBugDetail();
  };

  const deleteFix = async (fixId) => {
    if (!activeBugDetail?.id) return;
    const res = await window.electronAPI?.deleteBugFix?.(
      activeBugDetail.id,
      fixId
    );
    if (!res?.ok) {
      showToast(normalizeErrorMessage(res?.error, "bugs.fix.error.delete"));
      return;
    }
    showToast(tr("bugs.fix.toast.deleted"));
    await refreshBugDetail();
  };

  const openEvaluation = (evaluationId) => {
    if (!evaluationId || !window.TaskHistoryUI?.selectById) {
      showToast(tr("bugs.error.openEvaluation"));
      return;
    }
    window.AppTabs?.activateTab?.("history");
    window.TaskHistoryUI.selectById(evaluationId);
  };

  const refreshApps = async () => {
    if (!window.electronAPI?.listApps) return;
    try {
      const res = await window.electronAPI.listApps({ limit: 200, offset: 0 });
      if (!res?.ok) throw new Error(res?.error || "Failed to fetch apps");
      state.apps = Array.isArray(res.apps) ? res.apps : [];
      if (
        state.selectedAppId &&
        !state.apps.find((app) => `${app.id}` === `${state.selectedAppId}`)
      ) {
        state.selectedAppId = null;
        state.selectedBugId = null;
      }
      renderApps();
      if (state.selectedAppId) {
        await fetchVersions(state.selectedAppId);
      } else {
        state.versions = [];
        updateVersionOptions();
      }
    } catch (err) {
      state.apps = [];
      renderApps();
      showToast(tr("bugs.error.apps"));
    }
  };

  const fetchVersions = async (appId) => {
    if (!window.electronAPI?.listAppVersions) return;
    try {
      const res = await window.electronAPI.listAppVersions(appId, 200, 0);
      if (!res?.ok) throw new Error(res?.error || "Failed to fetch versions");
      state.versions = Array.isArray(res.versions) ? res.versions : [];
    } catch (err) {
      state.versions = [];
      showToast(tr("bugs.error.versions"));
    }
    updateVersionOptions();
  };

  const refreshBugs = async () => {
    if (!state.selectedAppId || !window.electronAPI?.listBugs) {
      state.bugs = [];
      renderBugList();
      renderBugDetail();
      return;
    }

    state.loading = true;
    renderBugList();

    try {
      const statusFilter = state.filters.status || [];
      const severityFilter = state.filters.severity || [];
      const versionFilter = state.filters.versionIds || [];
      const res = await window.electronAPI.listBugs(state.selectedAppId, {
        status:
          Array.isArray(statusFilter) && statusFilter.length === 1
            ? statusFilter[0]
            : undefined,
        severity_level:
          Array.isArray(severityFilter) && severityFilter.length === 1
            ? severityFilter[0]
            : undefined,
        app_version_id:
          Array.isArray(versionFilter) && versionFilter.length === 1
            ? Number(versionFilter[0])
            : undefined,
        limit: 200,
        offset: 0,
      });
      if (!res?.ok) {
        throw new Error(res?.error || "Failed to fetch bugs");
      }
      state.bugs = Array.isArray(res.bugs) ? res.bugs : [];
      if (
        state.selectedBugId &&
        !state.bugs.find((bug) => `${bug.id}` === `${state.selectedBugId}`)
      ) {
        state.selectedBugId = null;
        activeBugDetail = null;
        activeOccurrences = [];
        activeFixes = [];
      }
    } catch (err) {
      state.bugs = [];
      showToast(normalizeErrorMessage(err?.message, "bugs.error.list"));
    } finally {
      state.loading = false;
      renderBugList();
      renderBugDetail();
    }
  };

  const refreshBugDetail = async () => {
    if (!state.selectedBugId) return;
    try {
      const [bugRes, occRes, fixRes] = await Promise.all([
        window.electronAPI.getBug(state.selectedBugId),
        window.electronAPI.listBugOccurrences(state.selectedBugId),
        window.electronAPI.listBugFixes(state.selectedBugId),
      ]);

      if (bugRes?.ok && bugRes.bug) {
        activeBugDetail = bugRes.bug;
      }
      activeOccurrences = Array.isArray(occRes?.occurrences)
        ? occRes.occurrences
        : [];
      activeFixes = Array.isArray(fixRes?.fixes) ? fixRes.fixes : [];
      renderBugDetail();
    } catch (err) {
      showToast(normalizeErrorMessage(err?.message, "bugs.error.detail"));
    }
  };

  const selectBug = async (bugId) => {
    if (!bugId) return;
    state.selectedBugId = bugId;
    activeBugDetail =
      state.bugs.find((bug) => `${bug.id}` === `${bugId}`) || null;
    renderBugList();
    renderBugDetail();
    await refreshBugDetail();
  };

  const setSelectedApp = async (appId) => {
    state.selectedAppId = appId;
    state.selectedBugId = null;
    activeBugDetail = null;
    activeOccurrences = [];
    activeFixes = [];
    await fetchVersions(appId);
    await refreshBugs();
  };

  const handleBugSubmit = async () => {
    if (!state.selectedAppId) {
      showToast(tr("bugs.error.noApp"));
      return;
    }

    const title = bugTitleInput?.value?.trim() || "";
    if (!title) {
      showToast(tr("bugs.error.titleRequired"));
      return;
    }

    let environment = null;
    let reproduction_steps = null;
    try {
      environment = parseOptionalJson(bugEnvironmentInput?.value || "", null);
      reproduction_steps = parseOptionalJson(bugReproInput?.value || "", null);
    } catch (err) {
      showToast(tr("bugs.error.invalidJson"));
      return;
    }

    const payload = {
      app_id: state.selectedAppId,
      title,
      description: bugDescriptionInput?.value?.trim() || undefined,
      status: bugStatusInput?.value || undefined,
      severity_level: bugSeverityInput?.value || undefined,
      priority: parseOptionalNumber(bugPriorityInput?.value),
      discovered_version_id: parseOptionalNumber(
        bugDiscoveredVersionInput?.value
      ),
      fingerprint: bugFingerprintInput?.value?.trim() || undefined,
      environment,
      reproduction_steps,
    };

    if (submitBugModalBtn) submitBugModalBtn.disabled = true;
    try {
      if (bugModalMode === "edit" && editingBugId) {
        const res = await window.electronAPI.updateBug(editingBugId, payload);
        if (!res?.ok) throw new Error(res?.error || "Failed to update bug");
        showToast(tr("bugs.toast.updated"));
        state.selectedBugId = res.bug?.id || editingBugId;
      } else {
        const res = await window.electronAPI.createBug(payload);
        if (!res?.ok || !res.bug) {
          throw new Error(res?.error || "Failed to create bug");
        }
        showToast(tr("bugs.toast.created"));
        state.selectedBugId = res.bug.id;
      }
      ModalHelpers?.close?.(bugModal);
      await refreshBugs();
      await refreshBugDetail();
    } catch (err) {
      showToast(normalizeErrorMessage(err?.message, "bugs.error.save"));
    } finally {
      if (submitBugModalBtn) submitBugModalBtn.disabled = false;
    }
  };

  const handleOccurrenceSubmit = async () => {
    if (!state.selectedBugId) return;

    let action = null;
    let raw_model_coords = null;
    try {
      action = parseOptionalJson(bugOccurrenceActionInput?.value || "", null);
      raw_model_coords = parseOptionalJson(
        bugOccurrenceRawInput?.value || "",
        null
      );
    } catch (err) {
      showToast(tr("bugs.error.invalidJson"));
      return;
    }

    const payload = {
      evaluation_id: parseOptionalNumber(bugOccurrenceEvaluationInput?.value),
      test_case_id: parseOptionalNumber(bugOccurrenceTestCaseInput?.value),
      app_version_id: parseOptionalNumber(bugOccurrenceVersionInput?.value),
      step_index: parseOptionalNumber(bugOccurrenceStepInput?.value),
      action,
      expected: bugOccurrenceExpectedInput?.value?.trim() || undefined,
      actual: bugOccurrenceActualInput?.value?.trim() || undefined,
      screenshot_uri: bugOccurrenceScreenshotInput?.value?.trim() || undefined,
      log_uri: bugOccurrenceLogInput?.value?.trim() || undefined,
      raw_model_coords,
      observed_at: bugOccurrenceObservedInput?.value
        ? new Date(bugOccurrenceObservedInput.value).toISOString()
        : undefined,
      executor_id: bugOccurrenceExecutorInput?.value?.trim() || undefined,
    };

    if (submitBugOccurrenceModalBtn)
      submitBugOccurrenceModalBtn.disabled = true;
    try {
      const res = await window.electronAPI.createBugOccurrence(
        state.selectedBugId,
        payload
      );
      if (!res?.ok) {
        throw new Error(res?.error || "Failed to create occurrence");
      }
      showToast(tr("bugs.occurrence.toast.created"));
      ModalHelpers?.close?.(bugOccurrenceModal);
      await refreshBugDetail();
    } catch (err) {
      showToast(normalizeErrorMessage(err?.message, "bugs.occurrence.error"));
    } finally {
      if (submitBugOccurrenceModalBtn)
        submitBugOccurrenceModalBtn.disabled = false;
    }
  };

  const handleFixSubmit = async () => {
    if (!state.selectedBugId) return false;
    const fixEls = getBugFixElements();
    const fixedVersion = parseOptionalNumber(fixEls?.versionInput?.value);
    if (!fixedVersion) {
      showToast(tr("bugs.fix.error.version"));
      return false;
    }

    const payload = {
      fixed_in_version_id: fixedVersion,
      verified_by_evaluation_id: parseOptionalNumber(
        fixEls?.evaluationInput?.value
      ),
      note: fixEls?.noteInput?.value?.trim() || undefined,
    };

    try {
      const res = await window.electronAPI.createBugFix(
        state.selectedBugId,
        payload
      );
      if (!res?.ok) throw new Error(res?.error || "Failed to create fix");
      showToast(tr("bugs.fix.toast.created"));
      await refreshBugDetail();
      return true;
    } catch (err) {
      showToast(normalizeErrorMessage(err?.message, "bugs.fix.error"));
      return false;
    }
  };

  const bindListeners = () => {
    if (listenersBound) return;
    listenersBound = true;

    bugsAppSelect?.addEventListener("change", (e) => {
      const value = e.target.value;
      if (!value) {
        state.selectedAppId = null;
        state.bugs = [];
        renderBugList();
        renderBugDetail();
        return;
      }
      setSelectedApp(Number(value));
    });

    bugsStatusFilter?.addEventListener("change", () => {
      state.filters.status = getMultiSelectValues(bugsStatusFilter);
      refreshBugs();
    });

    bugsSeverityFilter?.addEventListener("change", () => {
      state.filters.severity = getMultiSelectValues(bugsSeverityFilter);
      refreshBugs();
    });

    bugsVersionFilter?.addEventListener("change", () => {
      state.filters.versionIds = getMultiSelectValues(bugsVersionFilter);
      refreshBugs();
    });

    bugsFixFilter?.addEventListener("change", () => {
      state.filters.fix = getMultiSelectValues(bugsFixFilter);
      renderBugList();
    });

    bugsSearchInput?.addEventListener("input", (e) => {
      state.filters.search = e.target.value;
      renderBugList();
    });

    bugsNewBtn?.addEventListener("click", () => openBugModal("create"));
    bugsRefreshBtn?.addEventListener("click", () => refreshBugs());

    submitBugModalBtn?.addEventListener("click", handleBugSubmit);

    submitBugOccurrenceModalBtn?.addEventListener(
      "click",
      handleOccurrenceSubmit
    );
  };

  const init = () => {
    updateBugStatusOptions();
    updateBugSeverityOptions();
    initCustomSelects();
    bindListeners();
    renderBugList();
    renderBugDetail();
    refreshApps();
  };

  const rerender = () => {
    updateBugStatusOptions();
    updateBugSeverityOptions();
    renderApps();
    updateVersionOptions();
    initCustomSelects();
    renderBugList();
    renderBugDetail();
  };

  const onEnter = () => {
    if (!state.apps.length) refreshApps();
  };

  window.BugsUI = {
    init,
    onEnter,
    refreshBugs,
    rerender,
  };
})();

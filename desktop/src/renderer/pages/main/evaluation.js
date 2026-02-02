(() => {
  // Prefer direct I18n.t (available before renderer.js sets __appTr) to avoid showing raw i18n keys on first render.
  const translate = (key, vars) =>
    window.I18n?.t?.(key, vars) ?? (window.__appTr || ((k) => k))(key, vars);
  const notify = (msg, ttl) => (window.__appShowToast || (() => {}))(msg, ttl);
  const tr = translate;
  const showToast = notify;
  const { renderPillHtml } = window.UIHelpers || {};
  const normalizeErrorMessage = (message, fallback) => {
    const text = typeof message === "string" ? message.trim() : "";
    if (!text) return tr(fallback);
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
      return tr(fallback);
    }
    return text;
  };

  const getEvaluationTaskDetailEl = () =>
    document.getElementById("evaluationTaskDetail");
  const getEvaluationTasksEl = () =>
    document.getElementById("evaluationTasksPanel");
  const testCaseModal = document.getElementById("testCaseModal");
  const testCaseNameInput = document.getElementById("testCaseName");
  const testCaseDescriptionInput = document.getElementById(
    "testCaseDescription"
  );
  const testCaseOrderInput = document.getElementById("testCaseOrder");
  const testCaseExecutorInput = document.getElementById("testCaseExecutor");
  const testCaseInputTextarea = document.getElementById("testCaseInput");
  const submitTestCaseBtn = document.getElementById("submitTestCaseBtn");
  const testCaseModalTitle = document.getElementById("testCaseModalTitle");
  const testCaseModalSubtitle = document.getElementById(
    "testCaseModalSubtitle"
  );
  const ModalHelpers = window?.ModalHelpers;
  let testCaseModalMode = "create";
  let editingTestCaseId = null;
  if (testCaseModal && ModalHelpers?.createModal) {
    ModalHelpers.createModal(testCaseModal, {
      transitionMs: 180,
      onClose: () => resetTestCaseModal(),
    });
  }

  const evaluationCache = new Map();
  const state = {
    selectedEvaluationId: null,
    selectedTaskId: null,
    selectedEvaluationData: null,
  };
  let activeStatusWatchId = null;
  let statusWatchRetryTimer = null;

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

  const renderPill = (status) => {
    const raw = (status ?? "unknown").toString();
    const className = raw.toLowerCase().replace(/\s+/g, "_");
    const label = className.replace(/_/g, " ");
    if (renderPillHtml) {
      return renderPillHtml(className, { label });
    }
    return `<span class="pill pill-${className}">${label}</span>`;
  };

  function resetTestCaseModal() {
    editingTestCaseId = null;
    testCaseModalMode = "create";
    if (testCaseNameInput) testCaseNameInput.value = "";
    if (testCaseDescriptionInput) testCaseDescriptionInput.value = "";
    if (testCaseOrderInput) testCaseOrderInput.value = "";
    if (testCaseExecutorInput) testCaseExecutorInput.value = "";
    if (testCaseInputTextarea) testCaseInputTextarea.value = "";
  }

  function openTestCaseModal(mode = "create", testCase = null) {
    testCaseModalMode = mode === "edit" ? "edit" : "create";
    editingTestCaseId = testCase?.id ?? null;
    if (testCaseModalTitle)
      testCaseModalTitle.textContent =
        testCaseModalMode === "edit"
          ? tr("testcase.modal.title.edit")
          : tr("testcase.modal.title.create");
    if (testCaseModalSubtitle)
      testCaseModalSubtitle.textContent = tr("testcase.modal.subtitle");

    if (testCase) {
      if (testCaseNameInput) testCaseNameInput.value = testCase.name || "";
      if (testCaseDescriptionInput)
        testCaseDescriptionInput.value = testCase.description || "";
      if (testCaseOrderInput)
        testCaseOrderInput.value =
          testCase.execution_order != null ? `${testCase.execution_order}` : "";
      if (testCaseExecutorInput)
        testCaseExecutorInput.value = testCase.assigned_executor_id || "";
      if (testCaseInputTextarea) {
        testCaseInputTextarea.value =
          testCase.input_data != null
            ? JSON.stringify(testCase.input_data, null, 2)
            : "";
      }
    }

    if (!testCaseModal) return;
    ModalHelpers?.open?.(testCaseModal);
  }

  function parseInputData(raw) {
    if (!raw || !raw.trim()) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed;
    } catch (err) {
      throw new Error(tr("testcase.error.invalidJson"));
    }
  }

  async function handleSubmitTestCase() {
    if (!state.selectedEvaluationData) {
      showToast(tr("testcase.error.noEvaluation"));
      return;
    }
    const evalData = state.selectedEvaluationData;
    const tasks = Array.isArray(evalData?.tasks) ? evalData.tasks : [];
    const currentTask =
      state.selectedTaskId &&
      tasks.find((t) => `${t.id}` === `${state.selectedTaskId}`);
    const planId =
      currentTask?.plan_id || evalData.plan_id || evalData.plan?.id;
    if (!planId) {
      showToast(tr("testcase.error.noPlan"));
      return;
    }

    const name = testCaseNameInput?.value?.trim();
    if (!name) {
      showToast(tr("testcase.error.nameRequired"));
      return;
    }
    const description = testCaseDescriptionInput?.value?.trim() || "";
    const execution_order = testCaseOrderInput?.value
      ? Number(testCaseOrderInput.value)
      : undefined;
    if (execution_order != null && Number.isNaN(execution_order)) {
      showToast(tr("testcase.error.invalidOrder"));
      return;
    }
    let input_data = {};
    try {
      input_data = parseInputData(testCaseInputTextarea?.value || "");
    } catch (err) {
      showToast(err?.message || tr("testcase.error.invalidJson"));
      return;
    }

    const payload = {
      evaluation_id: evalData.id,
      plan_id: planId,
      name,
      description,
      input_data,
      execution_order,
      assigned_executor_id: testCaseExecutorInput?.value?.trim() || undefined,
    };

    if (submitTestCaseBtn) {
      submitTestCaseBtn.disabled = true;
      submitTestCaseBtn.classList.add("disabled");
    }
    try {
      if (testCaseModalMode === "edit" && editingTestCaseId) {
        const res = await window.electronAPI?.updateTestCase?.(
          editingTestCaseId,
          {
            ...payload,
            status: "PENDING",
          }
        );
        if (!res?.ok) {
          throw new Error(res?.error || "Failed to update test case");
        }
        state.selectedTaskId = editingTestCaseId;
        showToast(tr("testcase.toast.updated"));
      } else {
        const res = await window.electronAPI?.createTestCase?.(payload);
        if (!res?.ok || !res?.testcase) {
          throw new Error(res?.error || "Failed to create test case");
        }
        state.selectedTaskId = res.testcase.id;
        showToast(tr("testcase.toast.created"));
      }
      await refreshSelectionDetail();
      ModalHelpers?.close?.(testCaseModal);
    } catch (err) {
      console.error("[Renderer] TestCase submit failed:", err);
      showToast(normalizeErrorMessage(err?.message, "testcase.error.generic"));
    } finally {
      if (submitTestCaseBtn) {
        submitTestCaseBtn.disabled = false;
        submitTestCaseBtn.classList.remove("disabled");
      }
    }
  }

  async function handleDeleteTestCase(testCaseId) {
    const spec = window.ModalIntents?.confirmDeleteTestCase?.({
      onConfirm: () => deleteTestCase(testCaseId),
    });
    if (spec && window.UIHelpers?.openModalSpec) {
      window.UIHelpers.openModalSpec(spec);
    }
  }

  function cacheEvaluation(record) {
    if (!record || !record.id) return;
    const existing = evaluationCache.get(record.id);
    const merged = existing
      ? {
          ...existing,
          ...record,
          // Preserve tasks from a detailed fetch if the new payload lacks them.
          tasks:
            Array.isArray(record.tasks) && record.tasks.length
              ? record.tasks
              : existing.tasks,
        }
      : record;
    evaluationCache.set(record.id, merged);
    return merged;
  }

  function hasEvaluationChanged(prev, next) {
    if (!prev) return true;
    if (!next) return false;
    const statusChanged =
      (prev.status || "").toLowerCase() !== (next.status || "").toLowerCase();
    const updatedChanged = (prev.updated_at || "") !== (next.updated_at || "");
    const prevTasks = Array.isArray(prev.tasks) ? prev.tasks : [];
    const nextTasks = Array.isArray(next.tasks) ? next.tasks : [];
    if (
      statusChanged ||
      updatedChanged ||
      prevTasks.length !== nextTasks.length
    ) {
      return true;
    }
    for (let i = 0; i < prevTasks.length; i++) {
      if (
        (prevTasks[i]?.id || "") !== (nextTasks[i]?.id || "") ||
        (prevTasks[i]?.status || "").toLowerCase() !==
          (nextTasks[i]?.status || "").toLowerCase()
      ) {
        return true;
      }
    }
    return false;
  }

  function stopStatusWatch() {
    activeStatusWatchId = null;
    if (statusWatchRetryTimer) {
      clearTimeout(statusWatchRetryTimer);
      statusWatchRetryTimer = null;
    }
    window.electronAPI?.stopEvaluationStatus?.();
  }

  function startStatusWatch(evaluationId, force = false) {
    if (!evaluationId) return;
    if (!force && `${activeStatusWatchId}` === `${evaluationId}`) return;
    stopStatusWatch();
    activeStatusWatchId = evaluationId;
    window.electronAPI?.watchEvaluationStatus?.(evaluationId);
  }

  function scheduleStatusRetry(evaluationId) {
    if (!evaluationId) return;
    if (statusWatchRetryTimer) clearTimeout(statusWatchRetryTimer);
    statusWatchRetryTimer = setTimeout(() => {
      if (`${state.selectedEvaluationId}` === `${evaluationId}`) {
        startStatusWatch(evaluationId, true);
      }
    }, 1200);
  }

  function renderEvaluationDetail(evaluation) {
    const emptyMsg = (msg) => `<div class="history-empty">${msg}</div>`;
    const evaluationTasksEl = getEvaluationTasksEl();
    const evaluationTaskDetailEl = getEvaluationTaskDetailEl();

    if (!evaluation) {
      state.selectedTaskId = null;
      state.selectedEvaluationData = null;
      if (evaluationTasksEl)
        evaluationTasksEl.innerHTML = emptyMsg(tr("evaluation.tasks.empty"));
      if (evaluationTaskDetailEl)
        evaluationTaskDetailEl.innerHTML = emptyMsg(
          tr("evaluation.task.empty")
        );
      return;
    }

    state.selectedEvaluationData = evaluation;
    const tasks = Array.isArray(evaluation.tasks) ? evaluation.tasks : [];
    const normalizedStatus = (evaluation.status || "unknown").toLowerCase();
    const isGenerating = normalizedStatus === "generating";

    if (evaluationTasksEl) {
      if (isGenerating) {
        evaluationTasksEl.innerHTML = `
          <div class="panel-section-header" style="padding-bottom:8px; margin-bottom:8px; border-bottom:none;">
            <div class="panel-title-block">
              <div class="panel-subtitle">TASKS (Generating...)</div>
            </div>
          </div>
          <div class="tasks-list-container">
            <div class="task-skeleton-item"></div>
          </div>
        `;
      } else {
        const tasksHtml = tasks
          .map((t) => {
            const isSel =
              state.selectedTaskId && `${t.id}` === `${state.selectedTaskId}`;
            const displayName = t.execution_order
              ? `${t.execution_order}. ${t.name || "Untitled"}`
              : t.name || `Task ${t.id}`;
            return `
            <div class="task-item selectable-item selectable-item--row ${isSel ? "selected" : ""}" data-task-id="${t.id}" data-title="${displayName}">
              <span class="task-item__name">${displayName}</span>
              ${renderPill(t.status)}
            </div>
          `;
          })
          .join("");

        evaluationTasksEl.innerHTML = `
          <div class="panel-section-header" style="padding-bottom:8px; margin-bottom:8px; border-bottom:none;">
            <div class="panel-title-block">
              <div class="panel-subtitle">${tr("evaluation.tasks.subtitle")}</div>
              <h2>${tr("evaluation.tasks.title", { count: tasks.length })}</h2>
            </div>
            <div class="panel-actions" style="display:flex; gap:6px; align-items:center;">
              <button class="icon-btn" id="addTestCaseBtn" title="${tr("testcase.actions.add")}" data-i18n-attr="title">
                <i data-lucide="plus"></i>
              </button>
              <button class="icon-btn" id="editTestCaseBtn" title="${tr("testcase.actions.edit")}" data-i18n-attr="title">
                <i data-lucide="edit-3"></i>
              </button>
              <button class="icon-btn" id="deleteTestCaseBtn" title="${tr("testcase.actions.delete")}" data-i18n-attr="title">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </div>
          <div class="tasks-list-container">
            ${tasksHtml || emptyMsg(tr("evaluation.tasks.noneRecorded"))}
          </div>
        `;
        evaluationTasksEl.querySelectorAll(".task-item").forEach((el) => {
          el.addEventListener("click", () => {
            state.selectedTaskId = el.dataset.taskId;
            renderEvaluationDetail(evaluation);
          });
        });

        const addBtn = document.getElementById("addTestCaseBtn");
        const editBtn = document.getElementById("editTestCaseBtn");
        const deleteBtn = document.getElementById("deleteTestCaseBtn");
        addBtn?.addEventListener("click", () => openTestCaseModal("create"));
        editBtn?.addEventListener("click", () => {
          const current =
            state.selectedTaskId &&
            tasks.find((t) => `${t.id}` === `${state.selectedTaskId}`);
          if (!current) {
            showToast(tr("testcase.error.noSelection"));
            return;
          }
          openTestCaseModal("edit", current);
        });
        deleteBtn?.addEventListener("click", () => {
          const current =
            state.selectedTaskId &&
            tasks.find((t) => `${t.id}` === `${state.selectedTaskId}`);
          if (!current) {
            showToast(tr("testcase.error.noSelection"));
            return;
          }
          handleDeleteTestCase(current.id);
        });
      }
    }

    if (evaluationTaskDetailEl) {
      const selectedTask = state.selectedTaskId
        ? tasks.find((t) => `${t.id}` === `${state.selectedTaskId}`)
        : tasks.length > 0
          ? tasks[0]
          : null;

      if (!isGenerating && !state.selectedTaskId && selectedTask) {
        state.selectedTaskId = selectedTask.id;
      }

      if (isGenerating) {
        evaluationTaskDetailEl.innerHTML = `
          <div class="panel-section-header">
            <div class="panel-title-block">
              <div class="panel-subtitle">TEST CASE DETAILS</div>
              <h2>Generating...</h2> 
            </div>
            ${renderPill("generating")}
          </div>

          <div class="detail-content">
            <div class="skeleton-group">
              <span class="meta-label">${tr("evaluation.task.description")}</span>
              <div class="skeleton-wrapper skeleton-row-1"></div>
            </div>

            <div class="skeleton-group">
              <div class="skeleton-label-row-2">
                <span class="meta-label">${tr("evaluation.task.order")}</span>
                <span class="meta-label">${tr("evaluation.meta.updated")}</span>
              </div>
              <div class="skeleton-wrapper skeleton-row-2"></div>
            </div>

            <div class="skeleton-group" style="flex:1; display:flex; flex-direction:column;">
              <span class="meta-label">${tr("evaluation.task.input")}</span>
              <div class="generating-box">
                Generating...
              </div>
            </div>
          </div>
        `;
      } else if (!selectedTask) {
        evaluationTaskDetailEl.innerHTML = emptyMsg(
          tr("evaluation.task.noSelection")
        );
      } else {
        evaluationTaskDetailEl.innerHTML = `
          <div class="panel-section-header">
            <div class="panel-title-block">
              <div class="panel-subtitle">${tr("evaluation.task.detailSubtitle")}</div>
              <h2>${selectedTask.name}</h2>
            </div>
            ${renderPill(selectedTask.status)}
          </div>

          <div class="detail-content">
            <div class="meta-item">
              <span class="meta-label">${tr("evaluation.task.description")}</span>
              <span class="meta-value">${selectedTask.description || tr("evaluation.noDescription")}</span>
            </div>

            <div class="meta-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:12px; flex:none;">
              <div class="meta-item">
                <span class="meta-label">${tr("evaluation.task.order")}</span>
                <span class="meta-value">${selectedTask.execution_order ?? "--"}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">${tr("evaluation.meta.updated")}</span>
                <span class="meta-value">${formatTimestamp(selectedTask.updated_at)}</span>
              </div>
            </div>

            <div class="meta-item" style="flex:1; min-height:0; display:flex; flex-direction:column;">
              <span class="meta-label" style="margin-bottom:6px;">${tr("evaluation.task.input")}</span>
              <div class="code-block" style="flex:1;">${JSON.stringify(selectedTask.input_data || {}, null, 2)}</div>
            </div>
          </div>
        `;
      }
    }

    lucide.createIcons();
  }

  async function refreshSelectionDetail() {
    if (!state.selectedEvaluationId || !window.electronAPI?.fetchEvaluation) {
      return;
    }
    try {
      const res = await window.electronAPI.fetchEvaluation(
        Number(state.selectedEvaluationId)
      );
      if (res?.ok && res.evaluation) {
        const merged = cacheEvaluation(res.evaluation);
        const prev = evaluationCache.get(Number(state.selectedEvaluationId));
        if (hasEvaluationChanged(prev, merged)) {
          evaluationCache.set(Number(state.selectedEvaluationId), merged);
        }
        renderEvaluationDetail(merged);
      }
    } catch (err) {
      console.error("[Renderer] Failed to refresh selected evaluation:", err);
    }
  }

  async function handleEvaluationClick(evaluationId) {
    if (!evaluationId) return;
    state.selectedEvaluationId = evaluationId;
    state.selectedTaskId = null;
    startStatusWatch(evaluationId);
    const evaluationTaskDetailEl = getEvaluationTaskDetailEl();
    if (evaluationTaskDetailEl) {
      evaluationTaskDetailEl.innerHTML = `<div class="history-empty">${tr(
        "history.loading"
      )}</div>`;
    }

    const cached = evaluationCache.get(Number(evaluationId));
    const hasCachedTasks =
      cached && Array.isArray(cached.tasks) && cached.tasks.length > 0;
    if (cached && hasCachedTasks) {
      state.selectedTaskId = cached.tasks[0].id;
      renderEvaluationDetail(cached);
      return;
    }

    if (!window.electronAPI?.fetchEvaluation) return;
    try {
      const res = await window.electronAPI.fetchEvaluation(
        Number(evaluationId)
      );
      if (!res?.ok || !res.evaluation) {
        throw new Error(res?.error || "Unable to load evaluation.");
      }
      const evaluation = cacheEvaluation(res.evaluation);
      const hasTasks =
        evaluation?.tasks &&
        Array.isArray(evaluation.tasks) &&
        evaluation.tasks.length > 0;
      state.selectedTaskId = hasTasks ? evaluation.tasks[0].id : null;
      renderEvaluationDetail(evaluation || cached);
    } catch (err) {
      console.error("[Renderer] Failed to fetch evaluation details:", err);
      renderEvaluationDetail(null);
      showToast(
        normalizeErrorMessage(err?.message, "Failed to fetch evaluation.")
      );
    }
  }

  async function deleteTestCase(id) {
    if (!id) return;
    const res = await window.electronAPI?.deleteTestCase?.(Number(id));
    if (!res?.ok) {
      showToast(normalizeErrorMessage(res?.error, "testcase.error.delete"));
      return;
    }
    if (`${state.selectedTaskId}` === `${id}`) {
      state.selectedTaskId = null;
    }
    showToast(tr("testcase.toast.deleted"));
    await refreshSelectionDetail();
  }

  function bindUiListeners() {
    submitTestCaseBtn?.addEventListener("click", () => {
      handleSubmitTestCase();
    });

  }

  function onEnter() {
    if (state.selectedEvaluationId) {
      startStatusWatch(state.selectedEvaluationId, true);
      refreshSelectionDetail();
    }
  }

  function rerender() {
    if (state.selectedEvaluationData) {
      renderEvaluationDetail(state.selectedEvaluationData);
    } else {
      renderEvaluationDetail(null);
    }
  }

  function refreshFeed(reset = true) {
    return refreshSelectionDetail();
  }

  async function selectEvaluation(evaluationId) {
    if (!evaluationId) return;
    await handleEvaluationClick(evaluationId);
  }

  function init() {
    bindUiListeners();
    renderEvaluationDetail(null);
    lucide.createIcons();

    window.electronAPI?.onEvaluationStatus?.(
      ({ evaluationId, event, data }) => {
        if (!evaluationId) return;

        if (event === "status") {
          const nextStatus = (data || "").toLowerCase();
          const cached = evaluationCache.get(Number(evaluationId));
          const currentStatus = (cached?.status || "").toLowerCase();
          if (cached && currentStatus !== nextStatus) {
            evaluationCache.set(Number(evaluationId), {
              ...cached,
              status: data,
            });
          }

          if (`${state.selectedEvaluationId}` === `${evaluationId}`) {
            if (state.selectedEvaluationData) {
              state.selectedEvaluationData = {
                ...state.selectedEvaluationData,
                status: data,
              };
              renderEvaluationDetail(state.selectedEvaluationData);
            }
            // Fetch fresh details (tasks, timestamps) once when status changes.
            refreshSelectionDetail();
          }
        } else if (event === "error") {
          const msg = data || "";
          const isAbort =
            typeof msg === "string" && msg.toLowerCase().includes("aborted");
          if (!isAbort) {
            showToast(
              normalizeErrorMessage(msg, "Evaluation status stream error.")
            );
          }
          scheduleStatusRetry(evaluationId);
        }
      }
    );
  }

  window.EvaluationUI = {
    init,
    onEnter,
    rerender,
    refreshFeed,
    selectEvaluation,
  };
})();

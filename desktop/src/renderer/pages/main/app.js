(() => {
  const translate = (key, vars) =>
    window.I18n?.t?.(key, vars) ?? (window.__appTr || ((k) => k))(key, vars);
  const notify = (msg, ttl) => (window.__appShowToast || (() => {}))(msg, ttl);
  const tr = translate;
  const showToast = notify;

  const GRAPH_CONFIG = {
    rowHeight: 40,
    laneWidth: 20,
    dotRadius: 4,
    xOffset: 14,
  };

  const COLORS = [
    "var(--accent)",
    "var(--theme-success)",
    "var(--theme-agent)",
    "var(--theme-job)",
    "var(--theme-error)",
    "var(--theme-tool)",
    "var(--theme-warn)",
  ];

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

  class GitGraphCalculator {
    constructor(nodes) {
      this.nodeIds = new Set(nodes.map((node) => node.id));
      this.nodes = [...nodes].sort((a, b) => {
        const timeA = new Date(a.created_at).getTime();
        const timeB = new Date(b.created_at).getTime();
        if (timeA !== timeB) return timeB - timeA;
        return b.id - a.id;
      });
      this.lanes = [];
    }

    calculate() {
      const outputRows = [];
      const parentLookups = new Map(); // id -> node

      this.nodes.forEach((node) => parentLookups.set(node.id, node));
      this.nodes.forEach((node, index) => {
        this.lanes = this.lanes.map((id) =>
          id && this.nodeIds.has(id) ? id : null
        );
        if (this.lanes.some((lane) => lane === null)) {
          this.lanes = this.lanes.filter((lane) => lane !== null);
        }
        const branchLaneIndices = this.lanes
          .map((id, idx) => (id === node.id ? idx : null))
          .filter((idx) => idx !== null);
        let parentIds = [];
        if (Array.isArray(node.previous_version_ids)) {
          parentIds = node.previous_version_ids;
        } else if (node.previous_version_id) {
          parentIds = [node.previous_version_id];
        }
        parentIds = parentIds.filter((id) => this.nodeIds.has(id));
        let laneIndex = this.lanes.indexOf(node.id);
        if (laneIndex === -1) {
          laneIndex = this.lanes.findIndex((l) => l === null);
          if (laneIndex === -1) {
            laneIndex = this.lanes.length;
          }
        }
        this.lanes.forEach((targetId, idx) => {
          if (targetId === node.id && idx !== laneIndex) {
            this.lanes[idx] = null;
          }
        });
        const primaryParent = parentIds.length > 0 ? parentIds[0] : null;
        this.lanes[laneIndex] = primaryParent;
        for (let i = 1; i < parentIds.length; i++) {
          const pid = parentIds[i];
          if (!this.lanes.includes(pid)) {
            let subLane = this.lanes.findIndex((l) => l === null);
            if (subLane === -1) subLane = this.lanes.length;
            this.lanes[subLane] = pid;
          }
        }
        if (this.lanes.some((lane) => lane === null)) {
          this.lanes = this.lanes.filter((lane) => lane !== null);
        }
        const activeLanes = this.lanes
          .map((id, idx) => (id !== null ? idx : null))
          .filter((i) => i !== null);
        const displayMaxLane = Math.max(
          laneIndex,
          ...(branchLaneIndices.length ? branchLaneIndices : [laneIndex]),
          ...(activeLanes.length ? activeLanes : [laneIndex])
        );

        outputRows.push({
          node,
          laneIndex,
          activeLanes,
          displayMaxLane,
          parentIds,
          x: GRAPH_CONFIG.xOffset + laneIndex * GRAPH_CONFIG.laneWidth,
          y: index * GRAPH_CONFIG.rowHeight + GRAPH_CONFIG.rowHeight / 2,
          color: COLORS[laneIndex % COLORS.length],
        });
      });
      const coordsMap = new Map();
      outputRows.forEach((row) =>
        coordsMap.set(row.node.id, {
          x: row.x,
          y: row.y,
          color: row.color,
          laneIndex: row.laneIndex,
        })
      );

      const paths = [];
      outputRows.forEach((row) => {
        const { node, x, y, color, parentIds } = row;

        const useParentStroke = parentIds.length > 1;
        const buildPowerCurve = (sx, sy, ex, ey, power) => {
          const segments = 8;
          let segPath = "";
          for (let i = 1; i <= segments; i++) {
            const t = i / segments;
            const eased = Math.pow(t, power);
            const cx = sx + (ex - sx) * eased;
            const cy = sy + (ey - sy) * t;
            segPath += ` L ${cx} ${cy}`;
          }
          return segPath;
        };

        parentIds.forEach((pid) => {
          const parentCoord = coordsMap.get(pid);
          if (parentCoord) {
            const px = parentCoord.x;
            const py = parentCoord.y;
            let d = "";
            if (x === px) {
              d = `M ${x} ${y} L ${px} ${py}`;
            } else {
              const gap = Math.abs(y - py);
              const span = Math.max(
                10,
                Math.min(GRAPH_CONFIG.rowHeight * 0.9, gap * 0.8)
              );
              if (span <= 10) {
                d = `M ${x} ${y} L ${px} ${py}`;
              } else {
                const dir = py < y ? -1 : 1;
                const isMerge = parentIds.length > 1;
                const laneDiff = Math.max(
                  1,
                  Math.abs(row.laneIndex - parentCoord.laneIndex)
                );
                if (isMerge) {
                  const curveEndY = y + span;
                  const curveStartX = px;
                  const curveStartY = curveEndY;
                  const power = laneDiff + 1;
                  if (laneDiff === 1) {
                    const c1y = curveStartY + (y - curveStartY) * 0.6;
                    d = `M ${px} ${py} L ${px} ${curveEndY} Q ${curveStartX} ${c1y}, ${x} ${y}`;
                  } else {
                    d =
                      `M ${px} ${py} L ${px} ${curveEndY}` +
                      buildPowerCurve(curveStartX, curveStartY, x, y, power);
                  }
                } else {
                  const curveStartY = py - dir * span;
                  const curveStartX = x;
                  const power = laneDiff + 1;
                  if (laneDiff === 1) {
                    const c1y = curveStartY + (py - curveStartY) * 0.6;
                    d = `M ${x} ${y} L ${x} ${curveStartY} Q ${curveStartX} ${c1y}, ${px} ${py}`;
                  } else {
                    d =
                      `M ${x} ${y} L ${x} ${curveStartY}` +
                      buildPowerCurve(curveStartX, curveStartY, px, py, power);
                  }
                }
              }
            }
            paths.push({
              d,
              stroke: useParentStroke ? parentCoord.color || color : color,
              opacity: 0.6,
            });
          } else {
          }
        });
      });

      return {
        rows: outputRows,
        paths,
        totalHeight: this.nodes.length * GRAPH_CONFIG.rowHeight,
      };
    }
  }

  const state = {
    apps: [],
    versions: [],
    selectedAppId: null,
    selectedVersionId: null,
    loadingApps: false,
    loadingVersions: false,
    lastQuery: { search: "", appType: "" },
    versionFocusId: null,
  };

  const appsListEl = document.getElementById("appsList");
  const versionsListEl = document.getElementById("appVersionsList");
  const versionsViewToggleEl = document.getElementById("appVersionsViewToggle");
  const versionDetailsEl = document.getElementById("appVersionDetails");
  const editVersionBtn = document.getElementById("editVersionBtn");
  const deleteVersionBtn = document.getElementById("deleteVersionBtn");
  const searchInput = document.getElementById("appsSearchInput");
  const typeFilter = document.getElementById("appsTypeFilter");
  const submitAppBtn = document.getElementById("submitAppBtn");
  const appsRefreshBtn = document.getElementById("appsRefreshBtn");
  const addVersionBtn = document.getElementById("addAppVersionBtn");
  const addVersionModal = document.getElementById("addVersionModal");
  const submitAddVersionBtn = document.getElementById("submitAddVersionBtn");
  const addVersionAppName = document.getElementById("addVersionAppName");
  const addVersionSourceBtns = document.querySelectorAll(
    "[data-version-source]"
  );
  const addVersionSourcePanels = document.querySelectorAll(
    "[data-version-source-panel]"
  );
  const addVersionDropZone = document.getElementById("addVersionDropZone");
  const addVersionFileInput = document.getElementById("addVersionFileInput");
  const addVersionUrlInput = document.getElementById("addVersionUrlInput");
  const addVersionPathInput = document.getElementById("addVersionPathInput");
  const addVersionLabelInput = document.getElementById("addVersionLabelInput");
  const addVersionPreviousSelect = document.getElementById(
    "addVersionPreviousSelect"
  );
  const addVersionReleaseDateInput = document.getElementById(
    "addVersionReleaseDateInput"
  );
  const addVersionChangeLogInput = document.getElementById(
    "addVersionChangeLogInput"
  );
  const editVersionModal = document.getElementById("editVersionModal");
  const submitEditVersionBtn = document.getElementById("submitEditVersionBtn");
  const editVersionAppName = document.getElementById("editVersionAppName");
  const editVersionSourceBtns = document.querySelectorAll(
    "[data-edit-version-source]"
  );
  const editVersionSourcePanels = document.querySelectorAll(
    "[data-edit-version-source-panel]"
  );
  const editVersionUrlInput = document.getElementById("editVersionUrlInput");
  const editVersionPathInput = document.getElementById("editVersionPathInput");
  const editVersionLabelInput = document.getElementById(
    "editVersionLabelInput"
  );
  const editVersionPreviousSelect = document.getElementById(
    "editVersionPreviousSelect"
  );
  const editVersionReleaseDateInput = document.getElementById(
    "editVersionReleaseDateInput"
  );
  const editVersionChangeLogInput = document.getElementById(
    "editVersionChangeLogInput"
  );
  const submitAppModal = document.getElementById("submitAppModal");
  const ModalHelpers = window?.ModalHelpers;
  if (addVersionModal && ModalHelpers?.createModal) {
    ModalHelpers.createModal(addVersionModal);
  }
  if (editVersionModal && ModalHelpers?.createModal) {
    ModalHelpers.createModal(editVersionModal);
  }
  if (submitAppModal && ModalHelpers?.createModal) {
    ModalHelpers.createModal(submitAppModal);
  }
  const submitAppCommitBtn = document.getElementById("submitAppCommitBtn");
  const appSubmitNameInput = document.getElementById("appSubmitNameInput");
  const appSubmitVersionInput = document.getElementById(
    "appSubmitVersionInput"
  );
  const appSubmitUrlInput = document.getElementById("appSubmitUrlInput");
  const appSubmitFileInput = document.getElementById("appSubmitFileInput");
  const appSubmitDropZone = document.getElementById("appSubmitDropZone");
  const appSubmitTypeBtns = document.querySelectorAll("[data-app-type]");
  const appSubmitPanels = document.querySelectorAll("[data-app-submit-panel]");

  const deleteInFlight = new Set();
  const deleteVersionInFlight = new Set();
  let submitAppType = "desktop_app";
  let submitAppFilePath = "";
  let submitAppSubmitting = false;
  let addVersionSource = "file";
  let addVersionFilePath = "";
  let addVersionSubmitting = false;
  let customAddVersionPreviousSelect = null;
  let editVersionSource = "url";
  let editVersionSubmitting = false;
  let customEditVersionPreviousSelect = null;

  const escapeHtml = (value) => {
    const str = value == null ? "" : String(value);
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  const getSelectedIds = (selectEl) =>
    Array.from(selectEl?.selectedOptions || [])
      .map((opt) => Number(opt.value))
      .filter((value) => Number.isFinite(value) && value > 0);

  const setSelectedIds = (selectEl, ids = []) => {
    if (!selectEl) return;
    const selection = new Set(ids.map((id) => String(id)));
    Array.from(selectEl.options).forEach((opt) => {
      opt.selected = selection.has(String(opt.value));
    });
  };

  const sanitizeHtml = (html = "") => {
    if (window.DOMPurify?.sanitize) {
      return window.DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
      });
    }
    return html;
  };

  const renderMarkdown = (markdown = "") => {
    const safeMd = String(markdown || "").trim();
    if (!safeMd) return "";
    if (window.marked?.parse) {
      const rawHtml = window.marked.parse(safeMd, {
        breaks: true,
      });
      return sanitizeHtml(rawHtml);
    }
    return escapeHtml(safeMd);
  };

  const emptyMsg = (text) => `<div class="apps-empty"><div>${text}</div></div>`;

  const formatTimestamp = (iso) => {
    if (window.DateUtils?.formatDate) {
      return window.DateUtils.formatDate(iso);
    }
    if (!iso) return "--";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "--";
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const getVersionTimestamp = (version) =>
    version?.release_date ??
    version?.releaseDate ??
    version?.created_at ??
    "";

  const traverseFamilyTree = (allNodes, rootId) => {
    const relevantIds = new Set();
    relevantIds.add(rootId);

    const findAncestors = (currentId) => {
      const node = allNodes.find((n) => n.id === currentId);
      if (!node) return;

      let pids = [];
      if (Array.isArray(node.previous_version_ids))
        pids = node.previous_version_ids;
      else if (node.previous_version_id) pids = [node.previous_version_id];

      pids.forEach((pid) => {
        if (!relevantIds.has(pid)) {
          relevantIds.add(pid);
          findAncestors(pid);
        }
      });
    };
    findAncestors(rootId);

    const childMap = new Map();
    allNodes.forEach((node) => {
      let pids = [];
      if (Array.isArray(node.previous_version_ids))
        pids = node.previous_version_ids;
      else if (node.previous_version_id) pids = [node.previous_version_id];

      pids.forEach((pid) => {
        if (!childMap.has(pid)) childMap.set(pid, []);
        childMap.get(pid).push(node.id);
      });
    });

    const findDescendants = (currentId) => {
      const children = childMap.get(currentId) || [];
      children.forEach((cid) => {
        if (!relevantIds.has(cid)) {
          relevantIds.add(cid);
          findDescendants(cid);
        }
      });
    };
    findDescendants(rootId);

    return relevantIds;
  };

  const formatDateInputValue = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const formatAppType = (value) => {
    if (typeof value !== "string") return "--";
    const normalized = value.trim().toLowerCase();
    if (!normalized) return "--";
    if (normalized === "desktop_app") return tr("app.type.desktop_app");
    if (normalized === "web_app") return tr("app.type.web_app");
    return value;
  };

  const updateAddVersionButtonState = () => {
    if (!addVersionBtn) return;
    addVersionBtn.disabled = !state.selectedAppId;
  };

  const setAddVersionSource = (source) => {
    addVersionSource =
      source === "url" ? "url" : source === "path" ? "path" : "file";
    addVersionSourceBtns.forEach((btn) => {
      btn.classList.toggle(
        "active",
        btn.dataset.versionSource === addVersionSource
      );
    });
    addVersionSourcePanels.forEach((panel) => {
      panel.classList.toggle(
        "hidden",
        panel.dataset.versionSourcePanel !== addVersionSource
      );
    });
  };

  const setEditVersionSource = (source) => {
    editVersionSource = source === "path" ? "path" : "url";
    editVersionSourceBtns.forEach((btn) => {
      btn.classList.toggle(
        "active",
        btn.dataset.editVersionSource === editVersionSource
      );
    });
    editVersionSourcePanels.forEach((panel) => {
      panel.classList.toggle(
        "hidden",
        panel.dataset.editVersionSourcePanel !== editVersionSource
      );
    });
  };

  const updateAddVersionFileLabel = (pathText = "") => {
    if (!addVersionModal) return;
    const wrapper = addVersionModal.querySelector(".file-selected-wrapper");
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
    const i18nAttr = hasFile ? "" : 'data-i18n="input.noFile"';
    wrapper.innerHTML = `
      <i data-lucide="${iconName}"></i>
      <span id="addVersionSelectedFileName" ${i18nAttr}>${escapeHtml(name)}</span>
    `;
    if (window.lucide?.createIcons) {
      window.lucide.createIcons({
        root: wrapper,
        attrs: {
          class: "file-status-icon",
        },
      });
    }
  };

  const resetAddVersionForm = (source = "file") => {
    addVersionFilePath = "";
    if (addVersionLabelInput) addVersionLabelInput.value = "";
    if (addVersionUrlInput) addVersionUrlInput.value = "";
    if (addVersionPathInput) addVersionPathInput.value = "";
    if (addVersionReleaseDateInput) addVersionReleaseDateInput.value = "";
    if (addVersionChangeLogInput) addVersionChangeLogInput.value = "";
    setSelectedIds(addVersionPreviousSelect, []);
    customAddVersionPreviousSelect?.refresh?.();
    updateAddVersionFileLabel("");
    setAddVersionSource(source);
  };

  const populatePreviousVersionOptions = () => {
    if (!addVersionPreviousSelect) return;
    const options = state.versions.map((version) => {
      const label = escapeHtml(version.version || "--");
      return `<option value="${version.id}">${label}</option>`;
    });
    addVersionPreviousSelect.innerHTML = options.join("");
    if (state.selectedVersionId) {
      setSelectedIds(addVersionPreviousSelect, [state.selectedVersionId]);
    }
    if (window.UIHelpers?.createMultiSelect) {
      if (!customAddVersionPreviousSelect) {
        customAddVersionPreviousSelect = window.UIHelpers.createMultiSelect(
          "addVersionPreviousSelect",
          { placeholder: tr("apps.version.add.previous.none") }
        );
      } else {
        customAddVersionPreviousSelect.refresh?.();
      }
    }
  };

  const populateEditPreviousVersionOptions = (currentVersionId) => {
    if (!editVersionPreviousSelect) return;
    const options = state.versions
      .filter((version) => `${version.id}` !== `${currentVersionId}`)
      .map((version) => {
        const label = escapeHtml(version.version || "--");
        return `<option value="${version.id}">${label}</option>`;
      });
    editVersionPreviousSelect.innerHTML = options.join("");
    if (window.UIHelpers?.createMultiSelect) {
      if (!customEditVersionPreviousSelect) {
        customEditVersionPreviousSelect = window.UIHelpers.createMultiSelect(
          "editVersionPreviousSelect",
          { placeholder: tr("apps.version.add.previous.none") }
        );
      } else {
        customEditVersionPreviousSelect.refresh?.();
      }
    }
  };

  const openAddVersionModal = () => {
    if (!addVersionModal) return;
    if (!state.selectedAppId) return;
    const selectedApp = state.apps.find(
      (app) => `${app.id}` === `${state.selectedAppId}`
    );
    if (addVersionAppName) {
      addVersionAppName.textContent = selectedApp?.name || "--";
    }
    const defaultSource = selectedApp?.app_type === "web_app" ? "url" : "file";
    resetAddVersionForm(defaultSource);
    populatePreviousVersionOptions();
    ModalHelpers?.open?.(addVersionModal);
  };

  const openEditVersionModal = (versionId) => {
    if (!editVersionModal) return;
    if (!state.selectedAppId || !versionId) return;
    const selectedApp = state.apps.find(
      (app) => `${app.id}` === `${state.selectedAppId}`
    );
    const version = state.versions.find(
      (entry) => `${entry.id}` === `${versionId}`
    );
    if (!version) return;

    if (editVersionAppName) {
      editVersionAppName.textContent = selectedApp?.name || "--";
    }

    populateEditPreviousVersionOptions(version.id);

    if (editVersionLabelInput) {
      editVersionLabelInput.value = version.version || "";
    }
    if (editVersionUrlInput) {
      editVersionUrlInput.value = version.app_url || "";
    }
    if (editVersionPathInput) {
      editVersionPathInput.value =
        version.app_path || version.artifact_uri || "";
    }
    if (editVersionReleaseDateInput) {
      editVersionReleaseDateInput.value = formatDateInputValue(
        getVersionTimestamp(version)
      );
    }
    if (editVersionChangeLogInput) {
      editVersionChangeLogInput.value = version.change_log || "";
    }
    if (editVersionPreviousSelect) {
      const previousIds = Array.isArray(version.previous_version_ids)
        ? version.previous_version_ids
        : version.previous_version_id
          ? [version.previous_version_id]
          : [];
      setSelectedIds(editVersionPreviousSelect, previousIds);
      customEditVersionPreviousSelect?.refresh?.();
    }

    const defaultSource = version.app_url ? "url" : "path";
    setEditVersionSource(defaultSource);

    ModalHelpers?.open?.(editVersionModal);
  };

  const setLoading = (targetEl, isLoading) => {
    if (!targetEl) return;
    if (isLoading) {
      targetEl.innerHTML = emptyMsg(tr("apps.loading"));
    }
  };

  const renderApps = () => {
    if (!appsListEl) return;
    if (state.loadingApps) {
      setLoading(appsListEl, true);
      return;
    }
    if (!state.apps.length) {
      appsListEl.innerHTML = emptyMsg(tr("apps.empty.apps"));
      return;
    }

    appsListEl.innerHTML = state.apps
      .map((app) => {
        const active = `${app.id}` === `${state.selectedAppId}`;
        return `
        <div class="apps-list-item selectable-item selectable-item--card ${active ? "active" : ""}" data-app-id="${app.id}">
          <button class="apps-item-body" type="button">
            <div class="apps-item-row">
              <div class="apps-item-title">${escapeHtml(app.name)}</div>
              <div class="apps-item-tag">${escapeHtml(
                formatAppType(app.app_type)
              )}</div>
            </div>
          </button>
          <div class="apps-item-footer">
            <div class="apps-meta-line apps-meta-inline">
              <i data-lucide="calendar"></i>
              <span>${tr("apps.meta.created")}: ${formatTimestamp(app.created_at)}</span>
            </div>
            <button class="icon-btn apps-delete-btn" data-app-delete-id="${app.id}" title="${tr("apps.delete.title")}">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>
      `;
      })
      .join("");

    lucide.createIcons({ root: appsListEl });

    appsListEl
      .querySelectorAll(".apps-list-item[data-app-id]")
      .forEach((el) => {
        el.addEventListener("click", (event) => {
          if (event.target?.closest("[data-app-delete-id]")) return;
          selectApp(Number(el.getAttribute("data-app-id")));
        });
      });

    appsListEl.querySelectorAll("[data-app-delete-id]").forEach((el) => {
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        const appId = Number(el.getAttribute("data-app-delete-id"));
        const app = state.apps.find((entry) => `${entry.id}` === `${appId}`);
        handleDeleteApp(appId, app?.name);
      });
    });
  };

  const renderVersions = () => {
    if (!versionsListEl) return;

    versionsListEl.classList.remove("hidden");

    if (state.loadingVersions) {
      versionsListEl.innerHTML = `<div class="apps-empty">Loading...</div>`;
      return;
    }
    if (!state.selectedAppId) {
      versionsListEl.innerHTML = `<div class="apps-empty">${tr("apps.empty.versions")}</div>`;
      return;
    }
    if (!state.versions.length) {
      versionsListEl.innerHTML = `<div class="apps-empty">${tr("apps.lineage.empty.versions")}</div>`;
      return;
    }

    let displayNodes = state.versions;
    if (state.versionFocusId) {
      const relevantSet = traverseFamilyTree(
        state.versions,
        state.versionFocusId
      );
      displayNodes = state.versions.filter((v) => relevantSet.has(v.id));
    }
    const graph = new GitGraphCalculator(displayNodes);
    const { rows, paths, totalHeight } = graph.calculate();

    let selectionGuide = "";

    const listHtml = rows
      .map((row) => {
        const node = row.node;
        const isSelected = state.selectedVersionId === node.id;
        const maxLane =
          typeof row.displayMaxLane === "number"
            ? row.displayMaxLane
            : Math.max(row.laneIndex, ...row.activeLanes);
        const paddingLeft =
          GRAPH_CONFIG.xOffset + (maxLane + 1) * GRAPH_CONFIG.laneWidth + 10;

        if (isSelected) {
          selectionGuide = `<line 
          x1="${row.x}" 
          y1="${row.y}" 
          x2="${paddingLeft - 8}" 
          y2="${row.y}" 
          stroke="${row.color}" 
          stroke-width="1.5" 
          stroke-dasharray="3 3" 
          stroke-linecap="round"
          opacity="0.8" 
        />`;
        }

        return `
        <li class="graph-item ${isSelected ? "selected" : ""}" 
            data-version-id="${node.id}"
            style="padding-left: ${paddingLeft}px;">
          
          <div class="graph-content">
            <div class="graph-info-col">
              <div class="graph-title-row">
                <span class="graph-ver">${escapeHtml(node.version || "--")}</span>
                ${node.app_url ? '<span class="graph-tag">WEB</span>' : ""}
                ${node.app_path ? '<span class="graph-tag">EXE</span>' : ""}
              </div>
              <div class="graph-msg" title="${escapeHtml(node.change_log)}">
                ${escapeHtml(node.change_log || "No description")}
              </div>
            </div>
            
            <div class="graph-right-col">
               <span class="graph-meta">${formatTimestamp(
                 getVersionTimestamp(node)
               )}</span>
               
               <div class="graph-actions">
                 ${
                   state.versionFocusId === node.id
                     ? ""
                     : `<button class="graph-btn focus" data-action="focus" data-id="${node.id}" title="Focus on this branch">
                         <i data-lucide="filter" width="14" height="14"></i>
                       </button>`
                 }
                 <button class="graph-btn delete" data-action="delete" data-id="${node.id}" title="${tr("apps.version.delete.title")}">
                    <i data-lucide="trash-2" width="14" height="14"></i>
                 </button>
               </div>
            </div>
          </div>
        </li>
      `;
      })
      .join("");

    const svgContent = `
      <svg class="graph-svg-layer" height="${totalHeight}" style="min-height: 100%;">
        <defs>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
        <g class="graph-paths">
          ${paths.map((p) => `<path d="${p.d}" stroke="${p.stroke}" stroke-width="2" fill="none" />`).join("")}
        </g>
        ${selectionGuide}
        <g class="graph-dots">
          ${rows
            .map((r) => {
              const isSel = state.selectedVersionId === r.node.id;
              const fill = isSel ? "var(--bg)" : r.color;
              const stroke = r.color;
              const radius = isSel ? 5 : 3.5;
              const strokeWidth = isSel ? 3 : 2;
              return `<circle cx="${r.x}" cy="${r.y}" r="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
            })
            .join("")}
        </g>
      </svg>
    `;

    let toolbarHtml = "";
    if (state.versionFocusId) {
      toolbarHtml = `
        <div class="graph-toolbar">
          <div class="graph-filter-tag">
             <i data-lucide="filter" width="12" height="12"></i>
             <span>Focused View (${escapeHtml(
               state.versions.find((v) => v.id === state.versionFocusId)
                 ?.version || `#${state.versionFocusId}`
             )})</span>
             <div class="graph-reset-btn" data-action="reset-focus" title="Show all versions">
               <i data-lucide="x" width="12" height="12"></i>
             </div>
          </div>
        </div>
      `;
    }
    versionsListEl.innerHTML = `
      <div class="apps-graph-view">
        ${toolbarHtml}
        <div class="graph-scroll-container">
          ${svgContent}
          <ul class="graph-list-layer">
             ${listHtml}
          </ul>
        </div>
      </div>
    `;
    const viewContainer = versionsListEl.querySelector(".apps-graph-view");
    viewContainer.addEventListener("click", (e) => {
      const btn =
        e.target.closest("button") || e.target.closest(".graph-reset-btn");
      const item = e.target.closest(".graph-item");
      if (btn) {
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = Number(btn.dataset.id);

        if (action === "focus") {
          state.versionFocusId = id;
          renderVersions();
        } else if (action === "reset-focus") {
          state.versionFocusId = null;
          renderVersions();
        } else if (action === "delete") {
          const version = state.versions.find((v) => v.id === id);
          handleDeleteVersion(state.selectedAppId, id, version?.version);
        }
        return;
      }
      if (item) {
        const vid = Number(item.dataset.versionId);
        selectVersion(vid);
      }
    });

    lucide.createIcons({ root: versionsListEl });
  };

  const renderVersionDetails = () => {
    if (!versionDetailsEl) return;
    if (!state.selectedVersionId) {
      versionDetailsEl.innerHTML = emptyMsg(tr("apps.empty.versionDetails"));
      if (editVersionBtn) editVersionBtn.disabled = true;
      if (deleteVersionBtn) deleteVersionBtn.disabled = true;
      return;
    }

    const version = state.versions.find(
      (entry) => `${entry.id}` === `${state.selectedVersionId}`
    );
    if (!version) {
      versionDetailsEl.innerHTML = emptyMsg(tr("apps.empty.versionDetails"));
      if (editVersionBtn) editVersionBtn.disabled = true;
      if (deleteVersionBtn) deleteVersionBtn.disabled = true;
      return;
    }

    const artifactValue =
      version.app_url || version.app_path || version.artifact_uri || "--";
    const changeLogHtml = renderMarkdown(version.change_log || "");
    const changeLogContent = changeLogHtml
      ? changeLogHtml
      : `<div class="apps-detail-placeholder">--</div>`;

    const previousVersionLabel = (() => {
      const previousIds = Array.isArray(version.previous_version_ids)
        ? version.previous_version_ids
        : version.previous_version_id
          ? [version.previous_version_id]
          : [];
      if (!previousIds.length) {
        return tr("apps.version.add.previous.none");
      }
      return previousIds
        .map((pid) => {
          const previous = state.versions.find(
            (entry) => `${entry.id}` === `${pid}`
          );
          return previous?.version || String(pid);
        })
        .join(", ");
    })();

    versionDetailsEl.innerHTML = `
      <div class="apps-details">
        <div class="apps-detail-hero">
          <div class="apps-detail-label">${tr("history.detail.version")}</div>
          <div class="apps-detail-title">${escapeHtml(
            version.version || "--"
          )}</div>
        </div>
        <div class="apps-detail-grid">
          <div class="apps-detail-row">
            <div class="apps-detail-label">${tr("apps.version.add.releaseDate")}</div>
            <div class="apps-detail-value">${escapeHtml(
              formatTimestamp(getVersionTimestamp(version))
            )}</div>
          </div>
        <div class="apps-detail-row">
          <div class="apps-detail-label">${tr("apps.version.add.previous")}</div>
          <div class="apps-detail-value">${escapeHtml(
            previousVersionLabel
          )}</div>
        </div>
        </div>
        <div class="apps-detail-row">
          <div class="apps-detail-label">${tr("history.detail.source")}</div>
          <div class="apps-detail-value apps-detail-mono">${escapeHtml(
            artifactValue
          )}</div>
        </div>
        <div class="apps-detail-block apps-detail-changelog">
          <div class="apps-detail-label">${tr("apps.version.add.changeLog")}</div>
          <div class="apps-detail-markdown">${changeLogContent}</div>
        </div>
      </div>
    `;
    if (editVersionBtn) editVersionBtn.disabled = false;
    if (deleteVersionBtn) deleteVersionBtn.disabled = false;
  };

  const renderAll = () => {
    renderApps();
    renderVersions();
    renderVersionDetails();
    updateAddVersionButtonState();
  };

  const handleDeleteApp = (appId, appName) => {
    if (!appId) return;
    const spec = window.ModalIntents?.confirmDeleteApp?.({
      appName,
      onConfirm: () => deleteApp(appId),
    });
    if (spec && window.UIHelpers?.openModalSpec) {
      window.UIHelpers.openModalSpec(spec);
    }
  };

  const handleDeleteVersion = (appId, versionId, versionLabel) => {
    if (!appId || !versionId) return;
    const spec = window.ModalIntents?.confirmDeleteVersion?.({
      versionLabel,
      onConfirm: () => deleteVersion(appId, versionId),
    });
    if (spec && window.UIHelpers?.openModalSpec) {
      window.UIHelpers.openModalSpec(spec);
    }
  };

  const deleteApp = async (appId) => {
    if (!window.electronAPI?.deleteApp) return;
    if (!appId || deleteInFlight.has(appId)) return;
    deleteInFlight.add(appId);
    try {
      const res = await window.electronAPI.deleteApp(appId);
      if (!res?.ok) {
        throw new Error(res?.error || "Failed to delete app");
      }
      showToast(tr("apps.delete.success"));
      if (`${state.selectedAppId}` === `${appId}`) {
        state.selectedAppId = null;
        state.selectedVersionId = null;
        state.versions = [];
      }
      await refreshApps();
    } catch (err) {
      console.error("[Renderer] Failed to delete app:", err);
      showToast(normalizeErrorMessage(err?.message, "apps.delete.error"));
    } finally {
      deleteInFlight.delete(appId);
    }
  };

  const deleteVersion = async (appId, versionId) => {
    if (!window.electronAPI?.deleteAppVersion) return;
    if (!appId || !versionId) return;
    const key = `${appId}:${versionId}`;
    if (deleteVersionInFlight.has(key)) return;
    deleteVersionInFlight.add(key);
    try {
      const res = await window.electronAPI.deleteAppVersion(appId, versionId);
      if (!res?.ok) {
        const message = res?.error || "Failed to delete app version";
        if (message.toLowerCase().includes("not found")) {
          showToast(tr("apps.version.delete.notFound"));
        } else {
          showToast(
            normalizeErrorMessage(message, "apps.version.delete.error")
          );
        }
        return;
      }
      showToast(tr("apps.version.delete.success"));
      if (`${state.selectedVersionId}` === `${versionId}`) {
        state.selectedVersionId = null;
        renderVersionDetails();
      }
      await fetchVersions(appId);
    } catch (err) {
      console.error("[Renderer] Failed to delete app version:", err);
      showToast(tr("apps.version.delete.error"));
    } finally {
      deleteVersionInFlight.delete(key);
    }
  };

  const updateSubmitAppFileLabel = (pathText = "") => {
    if (!submitAppModal) return;
    const wrapper = submitAppModal.querySelector(".file-selected-wrapper");
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
    const i18nAttr = hasFile ? "" : 'data-i18n="input.noFile"';
    wrapper.innerHTML = `
      <i data-lucide="${iconName}"></i>
      <span id="appSubmitSelectedFileName" ${i18nAttr}>${escapeHtml(name)}</span>
    `;
    if (window.lucide?.createIcons) {
      window.lucide.createIcons({
        root: wrapper,
        attrs: {
          class: "file-status-icon",
        },
      });
    }
  };

  const setSubmitAppMode = (mode) => {
    appSubmitPanels.forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.appSubmitPanel !== mode);
    });
  };

  const setSubmitAppType = (type) => {
    ModalHelpers?.transition?.(submitAppModal, () => {
      submitAppType = type === "web_app" ? "web_app" : "desktop_app";
      appSubmitTypeBtns.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.appType === submitAppType);
      });
      setSubmitAppMode(submitAppType === "web_app" ? "url" : "file");
    });
  };

  const openSubmitAppModal = () => {
    if (!submitAppModal) return;
    if (appSubmitNameInput && !appSubmitNameInput.value.trim()) {
      const selected = state.apps.find(
        (app) => `${app.id}` === `${state.selectedAppId}`
      );
      if (selected?.name) appSubmitNameInput.value = selected.name;
    }
    if (appSubmitVersionInput && !appSubmitVersionInput.value.trim()) {
      appSubmitVersionInput.value = "1.0.0";
    }
    if (state.selectedAppId) {
      const selected = state.apps.find(
        (app) => `${app.id}` === `${state.selectedAppId}`
      );
      if (selected?.app_type) setSubmitAppType(selected.app_type);
    } else {
      setSubmitAppType(submitAppType);
    }

    ModalHelpers?.open?.(submitAppModal);
  };

  const refreshApps = async () => {
    if (!window.electronAPI?.listApps) return;
    if (appsRefreshBtn) {
      appsRefreshBtn.disabled = true;
      appsRefreshBtn.classList.add("spinning");
    }
    state.loadingApps = true;
    renderApps();
    try {
      const res = await window.electronAPI.listApps({
        search: state.lastQuery.search || undefined,
        appType: state.lastQuery.appType || undefined,
        limit: 200,
        offset: 0,
      });
      if (!res?.ok) {
        throw new Error(res?.error || "Failed to fetch apps");
      }
      state.apps = Array.isArray(res.apps) ? res.apps : [];
      if (
        state.selectedAppId &&
        !state.apps.find((app) => `${app.id}` === `${state.selectedAppId}`)
      ) {
        state.selectedAppId = null;
        state.selectedVersionId = null;
        state.versions = [];
      }
    } catch (err) {
      console.error("[Renderer] Failed to fetch apps:", err);
      state.apps = [];
      showToast(tr("apps.error.apps"));
    } finally {
      state.loadingApps = false;
      if (appsRefreshBtn) {
        appsRefreshBtn.disabled = false;
        appsRefreshBtn.classList.remove("spinning");
      }
      renderApps();
      renderVersions();
      renderVersionDetails();
      updateAddVersionButtonState();
    }
  };

  const fetchVersions = async (appId) => {
    if (!window.electronAPI?.listAppVersions) return;
    state.loadingVersions = true;
    renderVersions();

    try {
      const res = await window.electronAPI.listAppVersions(appId, 200, 0);
      state.versions = Array.isArray(res?.versions) ? res.versions : [];

      if (
        state.selectedVersionId &&
        !state.versions.find((v) => v.id === state.selectedVersionId)
      ) {
        state.selectedVersionId = null;
      }
    } catch (err) {
      state.versions = [];
      showToast(tr("apps.error.versions"));
    } finally {
      state.loadingVersions = false;
      renderVersions();
      renderVersionDetails();
    }
  };

  const selectApp = async (appId) => {
    if (!appId) return;
    if (`${state.selectedAppId}` === `${appId}`) return;

    state.selectedAppId = appId;
    state.selectedVersionId = null;
    state.versions = [];
    state.versionFocusId = null;

    renderApps();
    versionsListEl.classList.remove("hidden");
    versionsListEl.innerHTML = `<div class="apps-empty">${tr("apps.loading")}</div>`;
    renderVersionDetails();

    await fetchVersions(appId);
    updateAddVersionButtonState();
  };

  const selectVersion = async (versionId) => {
    if (!versionId || !state.selectedAppId) return;
    if (`${state.selectedVersionId}` === `${versionId}`) return;
    state.selectedVersionId = versionId;
    const scrollTop =
      versionsListEl?.querySelector(".graph-scroll-container")?.scrollTop ?? 0;
    renderVersions();
    const nextContainer = versionsListEl?.querySelector(
      ".graph-scroll-container"
    );
    if (nextContainer) nextContainer.scrollTop = scrollTop;
    renderVersionDetails();
  };

  const bindListeners = () => {
    if (searchInput) {
      let searchTimer = null;
      searchInput.addEventListener("input", (event) => {
        const value = event?.target?.value ?? "";
        state.lastQuery.search = String(value).trim();
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => refreshApps(), 300);
      });
    }

    if (typeFilter) {
      typeFilter.addEventListener("change", (e) => {
        state.lastQuery.appType = e.target.value.trim();
        refreshApps();
      });
    }

    if (submitAppBtn) {
      submitAppBtn.addEventListener("click", () => openSubmitAppModal());
    }
    if (appsRefreshBtn) {
      appsRefreshBtn.addEventListener("click", () => refreshApps());
    }
    if (addVersionBtn) {
      addVersionBtn.addEventListener("click", () => openAddVersionModal());
    }
    if (editVersionBtn) {
      editVersionBtn.addEventListener("click", () => {
        if (!state.selectedVersionId) return;
        openEditVersionModal(state.selectedVersionId);
      });
    }
    if (deleteVersionBtn) {
      deleteVersionBtn.addEventListener("click", () => {
        if (!state.selectedVersionId || !state.selectedAppId) return;
        const version = state.versions.find(
          (entry) => `${entry.id}` === `${state.selectedVersionId}`
        );
        const label = `${version?.version || "--"}`;
        handleDeleteVersion(
          state.selectedAppId,
          state.selectedVersionId,
          label
        );
      });
    }
    if (addVersionSourceBtns?.length) {
      addVersionSourceBtns.forEach((btn) => {
        btn.addEventListener("click", () =>
          setAddVersionSource(btn.dataset.versionSource)
        );
      });
    }
    if (editVersionSourceBtns?.length) {
      editVersionSourceBtns.forEach((btn) => {
        btn.addEventListener("click", () =>
          setEditVersionSource(btn.dataset.editVersionSource)
        );
      });
    }
    if (addVersionFileInput) {
      addVersionFileInput.addEventListener("change", () => {
        const file = addVersionFileInput.files?.[0];
        const identifier = file?.path || file?.name || "";
        addVersionFilePath = identifier;
        updateAddVersionFileLabel(identifier);
      });
    }
    if (addVersionReleaseDateInput?.showPicker) {
      const openPicker = () => addVersionReleaseDateInput.showPicker();
      addVersionReleaseDateInput.addEventListener("click", openPicker);
      addVersionReleaseDateInput.addEventListener("focus", openPicker);
    }
    if (editVersionReleaseDateInput?.showPicker) {
      const openPicker = () => editVersionReleaseDateInput.showPicker();
      editVersionReleaseDateInput.addEventListener("click", openPicker);
      editVersionReleaseDateInput.addEventListener("focus", openPicker);
    }
    if (addVersionDropZone) {
      addVersionDropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        addVersionDropZone.classList.add("dragging");
      });
      addVersionDropZone.addEventListener("dragleave", () => {
        addVersionDropZone.classList.remove("dragging");
      });
      addVersionDropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        addVersionDropZone.classList.remove("dragging");
        const file = e.dataTransfer?.files?.[0];
        if (!file) return;
        const identifier = file.path || file.name || "";
        addVersionFilePath = identifier;
        updateAddVersionFileLabel(identifier);
      });
      addVersionDropZone.addEventListener("click", async () => {
        if (window.electronAPI?.pickTaskFile) {
          const picked = await window.electronAPI.pickTaskFile();
          if (picked) {
            addVersionFilePath = picked;
            updateAddVersionFileLabel(picked);
          }
        } else if (addVersionFileInput) {
          addVersionFileInput.click();
        }
      });
    }
    if (submitAddVersionBtn) {
      submitAddVersionBtn.addEventListener("click", async () => {
        if (addVersionSubmitting) return;
        if (!state.selectedAppId) return;
        const version = addVersionLabelInput?.value?.trim() || "";
        const appUrl = addVersionUrlInput?.value?.trim() || "";
        const appPath = addVersionPathInput?.value?.trim() || "";
        const previousVersionIds = getSelectedIds(addVersionPreviousSelect);
        const releaseDate = addVersionReleaseDateInput?.value?.trim() || "";
        const changeLog = addVersionChangeLogInput?.value?.trim() || "";

        if (!version) {
          showToast(tr("toast.appVersionRequired"));
          return;
        }
        if (addVersionSource === "file" && !addVersionFilePath) {
          showToast(tr("toast.selectExecutable"));
          return;
        }
        if (addVersionSource === "url" && !/^https?:\/\/.*/i.test(appUrl)) {
          showToast(tr("toast.invalidUrl"));
          return;
        }
        if (addVersionSource === "path" && !appPath) {
          showToast(tr("apps.version.add.path.required"));
          return;
        }

        addVersionSubmitting = true;
        submitAddVersionBtn.disabled = true;
        submitAddVersionBtn.classList.add("spinning");
        try {
          const res = await window.electronAPI?.createAppVersion?.({
            appId: state.selectedAppId,
            version,
            source: addVersionSource,
            appUrl: addVersionSource === "url" ? appUrl : undefined,
            appPath: addVersionSource === "path" ? appPath : undefined,
            filePath:
              addVersionSource === "file" ? addVersionFilePath : undefined,
            previousVersionIds,
            releaseDate: releaseDate || null,
            changeLog: changeLog || null,
          });
          if (!res?.ok) {
            showToast(tr("apps.version.add.error"));
            return;
          }
          showToast(tr("apps.version.add.success"));
          ModalHelpers?.close?.(addVersionModal);
          resetAddVersionForm();
          const createdId = res.version?.id;
          await fetchVersions(state.selectedAppId);
          if (createdId) {
            await selectVersion(createdId);
          }
        } catch (err) {
          console.error("[Renderer] Failed to create app version:", err);
          showToast(tr("apps.version.add.error"));
        } finally {
          addVersionSubmitting = false;
          submitAddVersionBtn.disabled = false;
          submitAddVersionBtn.classList.remove("spinning");
        }
      });
    }
    if (submitEditVersionBtn) {
      submitEditVersionBtn.addEventListener("click", async () => {
        if (editVersionSubmitting) return;
        if (!state.selectedAppId || !state.selectedVersionId) return;
        const versionId = state.selectedVersionId;
        const version = editVersionLabelInput?.value?.trim() || "";
        const appUrl = editVersionUrlInput?.value?.trim() || "";
        const appPath = editVersionPathInput?.value?.trim() || "";
        const previousVersionIds = getSelectedIds(editVersionPreviousSelect);
        const releaseDate = editVersionReleaseDateInput?.value?.trim() || "";
        const changeLog = editVersionChangeLogInput?.value?.trim() || "";

        if (!version) {
          showToast(tr("toast.appVersionRequired"));
          return;
        }
        if (editVersionSource === "url" && !/^https?:\/\/.*/i.test(appUrl)) {
          showToast(tr("toast.invalidUrl"));
          return;
        }
        if (editVersionSource === "path" && !appPath) {
          showToast(tr("apps.version.add.path.required"));
          return;
        }

        editVersionSubmitting = true;
        submitEditVersionBtn.disabled = true;
        submitEditVersionBtn.classList.add("spinning");
        try {
          const res = await window.electronAPI?.updateAppVersion?.({
            appId: state.selectedAppId,
            versionId,
            version,
            source: editVersionSource,
            appUrl: editVersionSource === "url" ? appUrl : undefined,
            appPath: editVersionSource === "path" ? appPath : undefined,
            previousVersionIds,
            releaseDate: releaseDate || null,
            changeLog: changeLog || null,
          });
          if (!res?.ok) {
            showToast(tr("apps.version.edit.error"));
            return;
          }
          showToast(tr("apps.version.edit.success"));
          ModalHelpers?.close?.(editVersionModal);
          await fetchVersions(state.selectedAppId);
          await selectVersion(versionId);
        } catch (err) {
          console.error("[Renderer] Failed to update app version:", err);
          showToast(tr("apps.version.edit.error"));
        } finally {
          editVersionSubmitting = false;
          submitEditVersionBtn.disabled = false;
          submitEditVersionBtn.classList.remove("spinning");
        }
      });
    }

    appSubmitTypeBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = btn.dataset.appType || "desktop_app";
        setSubmitAppType(next);
      });
    });

    if (appSubmitFileInput) {
      appSubmitFileInput.addEventListener("change", () => {
        const file = appSubmitFileInput.files?.[0];
        const identifier = file?.path || file?.name || "";
        submitAppFilePath = identifier;
        updateSubmitAppFileLabel(identifier);
      });
    }

    if (appSubmitDropZone) {
      appSubmitDropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        appSubmitDropZone.classList.add("dragging");
      });
      appSubmitDropZone.addEventListener("dragleave", () => {
        appSubmitDropZone.classList.remove("dragging");
      });
      appSubmitDropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        appSubmitDropZone.classList.remove("dragging");
        const file = e.dataTransfer?.files?.[0];
        if (!file) return;
        const identifier = file.path || file.name || "";
        submitAppFilePath = identifier;
        updateSubmitAppFileLabel(identifier);
      });
      appSubmitDropZone.addEventListener("click", async () => {
        if (window.electronAPI?.pickTaskFile) {
          const picked = await window.electronAPI.pickTaskFile();
          if (picked) {
            submitAppFilePath = picked;
            updateSubmitAppFileLabel(picked);
          }
        } else if (appSubmitFileInput) {
          appSubmitFileInput.click();
        }
      });
    }

    if (submitAppCommitBtn) {
      submitAppCommitBtn.addEventListener("click", async () => {
        if (submitAppSubmitting) return;
        const name = appSubmitNameInput?.value?.trim() || "";
        const version = appSubmitVersionInput?.value?.trim() || "";
        const url = appSubmitUrlInput?.value?.trim() || "";

        if (!name) {
          showToast(tr("toast.appNameRequired"));
          return;
        }
        if (!version) {
          showToast(tr("toast.appVersionRequired"));
          return;
        }
        if (submitAppType === "desktop_app" && !submitAppFilePath) {
          showToast(tr("toast.selectExecutable"));
          return;
        }
        if (submitAppType === "web_app" && !/^https?:\/\/.*/i.test(url)) {
          showToast(tr("toast.invalidUrl"));
          return;
        }

        submitAppSubmitting = true;
        submitAppCommitBtn.disabled = true;
        submitAppCommitBtn.classList.add("spinning");
        try {
          const res = await window.electronAPI?.submitApp?.({
            name,
            appType: submitAppType,
            version,
            source: submitAppType === "web_app" ? "url" : "file",
            appUrl: submitAppType === "web_app" ? url : undefined,
            filePath:
              submitAppType === "desktop_app" ? submitAppFilePath : undefined,
          });
          if (!res?.ok) {
            showToast(tr("apps.submit.error"));
            return;
          }
          showToast(tr("toast.appSubmitted"));
          ModalHelpers?.close?.(submitAppModal);
          submitAppFilePath = "";
          updateSubmitAppFileLabel("");
          await refreshApps();
          if (res.app?.id) {
            await selectApp(res.app.id);
          }
          if (res.version?.id) {
            await selectVersion(res.version.id);
          }
        } catch (err) {
          console.error("[Renderer] Failed to submit app:", err);
          showToast(tr("apps.submit.error"));
        } finally {
          submitAppSubmitting = false;
          submitAppCommitBtn.disabled = false;
          submitAppCommitBtn.classList.remove("spinning");
        }
      });
    }
  };

  const init = () => {
    const subLabel = document.getElementById("appSubmitSelectedFileName");
    if (subLabel) subLabel.textContent = tr("input.noFile");

    bindListeners();
    renderAll();
    refreshApps();
  };

  window.AppsUI = {
    init,
    onEnter: () => !state.apps.length && refreshApps(),
    rerender: renderAll,
    refreshApps,
  };
})();

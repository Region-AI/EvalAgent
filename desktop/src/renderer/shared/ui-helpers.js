(function () {
  const DEFAULT_THEME = "system";
  const THEME_STORAGE_KEY = "theme";
  let currentTheme = null;
  let currentThemePreference = null;
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

  const ACTION_CLASS_MAP = {
    primary: "primary",
    danger: "danger",
    secondary: "subtle",
    subtle: "subtle",
  };

  function resolvePrimaryIndex(actions) {
    const list = Array.isArray(actions) ? actions : [];
    let idx = list.findIndex((action) => action?.primary);
    if (idx >= 0) return idx;
    idx = list.findIndex((action) => action?.kind === "primary");
    return idx >= 0 ? idx : 0;
  }

  function resolveActionClass(action, index, primaryIndex) {
    const kind = action?.kind;
    const base =
      ACTION_CLASS_MAP[kind] ||
      (index === primaryIndex ? "primary" : "subtle");
    const extra = action?.className ? ` ${action.className}` : "";
    return `btn ${base}${extra}`.trim();
  }

  function renderModalActions(container, actions, options = {}) {
    if (!container) return { primaryAction: null, primaryIndex: 0 };
    const list = Array.isArray(actions) ? actions.filter(Boolean) : [];
    const primaryIndex = resolvePrimaryIndex(list);
    const primaryAction = list[primaryIndex] || null;

    container.innerHTML = "";
    list.forEach((action, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = resolveActionClass(action, index, primaryIndex);
      btn.textContent =
        action?.label ||
        (index === primaryIndex ? "Confirm" : "Cancel");
      if (index === primaryIndex) {
        btn.setAttribute("data-modal-submit", "");
      } else if (!action?.handler) {
        btn.setAttribute("data-modal-close", "");
      }

      if (index !== primaryIndex && action?.handler) {
        btn.addEventListener("click", async (event) => {
          event.preventDefault();
          try {
            const result = await action.handler();
            options.onResolve?.(action, result, index);
          } catch (err) {
            console.error("Modal secondary action failed:", err);
            if (action.onError) action.onError(err);
            return;
          }
          if (action.autoClose !== false) {
            options.modalController?.close();
          }
        });
      }

      container.appendChild(btn);
    });

    return { primaryAction, primaryIndex };
  }

  const ConfirmModal = (function () {
    let elements = {
      modal: null,
      category: null,
      title: null,
      desc: null,
      body: null,
      actions: null,
      closeBtn: null,
    };
    let modalController = null;

    let currentConfig = {
      resolve: null,
      resolved: false,
      pendingSpec: null,
      onDone: null,
    };

    function init() {
      elements.modal =
        window.ModalHelpers?.mountModalShell?.({ id: "confirmModal" }) ||
        document.getElementById("confirmModal");
      if (!elements.modal) return false;

      elements.category =
        elements.modal.querySelector("[data-modal-eyebrow]") ||
        document.getElementById("confirmCategory");
      elements.title =
        elements.modal.querySelector("[data-modal-title]") ||
        document.getElementById("confirmTitle");
      elements.desc =
        elements.modal.querySelector("[data-modal-desc]") ||
        document.getElementById("confirmDesc");
      elements.body =
        elements.modal.querySelector("[data-modal-body]") || null;
      elements.actions =
        elements.modal.querySelector("[data-modal-actions]") || null;
      elements.closeBtn =
        elements.modal.querySelector("[data-modal-close]") ||
        document.getElementById("confirmCloseBtn");
      if (window.lucide?.createIcons) {
        window.lucide.createIcons({ root: elements.modal });
      }

      if (window.ModalHelpers?.Modal) {
        modalController = new window.ModalHelpers.Modal(elements.modal, {
          onClose: () => {
            if (currentConfig.resolve && !currentConfig.resolved) {
              currentConfig.resolved = true;
              currentConfig.resolve({ action: "cancel" });
            }
            currentConfig.resolve = null;
            currentConfig.pendingSpec = null;
            currentConfig.onDone?.();
            currentConfig.onDone = null;
            currentConfig.resolved = false;
          },
        });
      } else if (typeof bindBackdropClose === "function") {
        const closeHandler = () => hide();
        if (elements.closeBtn) elements.closeBtn.onclick = closeHandler;
        bindBackdropClose(elements.modal, hide);
      }

      return true;
    }

    function renderSpec(
      { category, title, body, actions = [] },
      resolve,
      onDone
    ) {
      if (!elements.modal && !init()) {
        console.error("Confirm modal elements not found in DOM");
        return;
      }

      if (modalController?.setText) {
        modalController.setText(
          elements.category,
          category || "Confirmation"
        );
        modalController.setText(elements.title, title || "Are you sure?");
        modalController.setText(elements.desc, body || "");
      } else {
        if (elements.category)
          elements.category.textContent = category || "Confirmation";
        if (elements.title) elements.title.textContent = title || "Are you sure?";
        if (elements.desc) elements.desc.textContent = body || "";
      }

      if (elements.body) {
        elements.body.classList.add("hidden");
        elements.body.innerHTML = "";
      }

      const actionList = Array.isArray(actions) ? actions : [];
      const primary = actionList[0] || null;
      const secondary = actionList[1] || null;
      currentConfig.resolve = resolve || null;
      currentConfig.resolved = false;
      currentConfig.pendingSpec = { category, title, body, actions };
      currentConfig.onDone = typeof onDone === "function" ? onDone : null;
      const { primaryAction } = renderModalActions(elements.actions, actionList, {
        modalController,
        onResolve: (action, result, index) => {
          if (currentConfig.resolve && !currentConfig.resolved) {
            currentConfig.resolved = true;
            currentConfig.resolve({
              action: action?.id || `action-${index}`,
              result,
            });
          }
        },
      });

      if (modalController?.setSubmitHandler) {
        if (primaryAction) {
          modalController.setSubmitHandler(async () => {
            try {
              const result = primaryAction.handler
                ? await primaryAction.handler()
                : undefined;
              if (currentConfig.resolve && !currentConfig.resolved) {
                currentConfig.resolved = true;
                currentConfig.resolve({
                  action: primaryAction.id || "primary",
                  result,
                });
              }
              if (primaryAction.autoClose === false) return false;
              return result;
            } catch (err) {
              console.error("Modal action failed:", err);
              if (primaryAction.onError) primaryAction.onError(err);
              return false;
            }
          });
        } else {
          modalController.setSubmitHandler(null);
        }
      }

      if (modalController) {
        modalController.open();
      } else {
        elements.modal.classList.remove("hidden");
        requestAnimationFrame(() => elements.modal.classList.add("show"));
      }
    }

    function hide() {
      if (!elements.modal) return;
      if (modalController) {
        modalController.close();
        return;
      }
      currentConfig.onConfirm = null;
      elements.modal.classList.remove("show");
      setTimeout(() => elements.modal.classList.add("hidden"), 200);
    }

    return {
      init,
      showSpec: renderSpec,
    };
  })();

  const FormModal = (function () {
    let elements = {
      modal: null,
      category: null,
      title: null,
      desc: null,
      body: null,
      actions: null,
    };
    let modalController = null;
    let currentConfig = {
      onClose: null,
      onOpen: null,
    };

    function init() {
      elements.modal =
        window.ModalHelpers?.mountModalShell?.({ id: "formModal" }) ||
        document.getElementById("formModal");
      if (!elements.modal) return false;

      elements.category =
        elements.modal.querySelector("[data-modal-eyebrow]") || null;
      elements.title =
        elements.modal.querySelector("[data-modal-title]") || null;
      elements.desc =
        elements.modal.querySelector("[data-modal-desc]") || null;
      elements.body =
        elements.modal.querySelector("[data-modal-body]") || null;
      elements.actions =
        elements.modal.querySelector("[data-modal-actions]") || null;

      if (window.ModalHelpers?.Modal) {
        modalController = new window.ModalHelpers.Modal(elements.modal, {
          onOpen: () => {
            currentConfig.onOpen?.();
          },
          onClose: () => {
            currentConfig.onClose?.();
            currentConfig.onOpen = null;
            currentConfig.onClose = null;
          },
        });
      } else if (typeof bindBackdropClose === "function") {
        bindBackdropClose(elements.modal, () => hide());
      }

      if (window.lucide?.createIcons) {
        window.lucide.createIcons({ root: elements.modal });
      }

      return true;
    }

    function setText(el, value) {
      if (!el) return;
      el.textContent = value ?? "";
    }

    function renderBody(body) {
      if (!elements.body) return;
      elements.body.classList.remove("hidden");
      if (typeof body === "string") {
        elements.body.innerHTML = body;
        return;
      }
      elements.body.innerHTML = "";
      if (body instanceof HTMLElement) {
        elements.body.appendChild(body);
      }
    }

    function show({
      eyebrow,
      title,
      desc,
      body,
      actions = [],
      onClose,
      onOpen,
      initialFocusSelector,
      bodyLayout,
    }) {
      if (!elements.modal && !init()) return;

      setText(elements.category, eyebrow || "");
      setText(elements.title, title || "");
      setText(elements.desc, desc || "");
      renderBody(body);
      if (modalController?.setBodyLayout) {
        modalController.setBodyLayout(bodyLayout);
      } else if (elements.body) {
        elements.body.classList.toggle(
          "modal-body-columns",
          bodyLayout === "columns"
        );
        elements.modal?.classList.toggle(
          "modal-columns-wide",
          bodyLayout === "columns"
        );
      }

      currentConfig.onClose =
        typeof onClose === "function" ? onClose : null;
      currentConfig.onOpen =
        typeof onOpen === "function" ? onOpen : null;

      if (modalController) {
        modalController.initialFocusSelector = initialFocusSelector || null;
      }

      const { primaryAction } = renderModalActions(elements.actions, actions, {
        modalController,
      });

      if (modalController?.setSubmitHandler) {
        if (primaryAction) {
          modalController.setSubmitHandler(async (event, controller) => {
            try {
              const result = primaryAction.handler
                ? await primaryAction.handler(event, controller)
                : undefined;
              if (primaryAction.autoClose === false) return false;
              return result;
            } catch (err) {
              console.error("Modal action failed:", err);
              if (primaryAction.onError) primaryAction.onError(err);
              return false;
            }
          });
        } else {
          modalController.setSubmitHandler(null);
        }
      }

      if (modalController) {
        modalController.open();
      } else {
        elements.modal.classList.remove("hidden");
        requestAnimationFrame(() => elements.modal.classList.add("show"));
      }
    }

    function hide() {
      if (!elements.modal) return;
      if (modalController) {
        modalController.close();
        return;
      }
      elements.modal.classList.remove("show");
      setTimeout(() => elements.modal.classList.add("hidden"), 200);
    }

    return {
      init,
      show,
      hide,
    };
  })();

  function formatTimestamp(isoString) {
    if (!isoString) {
      return new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    }
    return new Date(isoString).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function resolveTheme(mode) {
    if (mode === "system") {
      return mediaQuery.matches ? "dark" : "light";
    }
    return mode === "light" ? "light" : "dark";
  }

  function renderThemeToggleIcon(toggleEl, preference, resolved) {
    if (!toggleEl) return;
    if (preference === "system") {
      toggleEl.innerHTML = '<i data-lucide="monitor"></i>';
      return;
    }
    toggleEl.innerHTML =
      resolved === "light"
        ? '<i data-lucide="moon"></i>'
        : '<i data-lucide="sun"></i>';
  }

  function performModalTransition(container, changeStateFn) {
    if (!container) {
      changeStateFn();
      return;
    }
    const startHeight = container.offsetHeight;
    changeStateFn();
    container.style.height = "auto";
    container.style.minHeight = "0";
    const endHeight = container.offsetHeight;
    if (Math.abs(startHeight - endHeight) < 1) {
      container.style.height = "auto";
      return;
    }
    container.style.height = `${startHeight}px`;
    container.style.overflow = "hidden";
    const animation = container.animate(
      [{ height: `${startHeight}px` }, { height: `${endHeight}px` }],
      {
        duration: 300,
        easing: "cubic-bezier(0.2, 0, 0.2, 1)",
        fill: "forwards",
      }
    );
    animation.onfinish = () => {
      container.style.height = "auto";
      container.style.overflow = "visible";
      animation.cancel();
    };
  }

  function createCustomSelect(selectId) {
    const nativeSelect = document.getElementById(selectId);
    if (!nativeSelect) return null;

    nativeSelect.style.display = "none";

    const existingWrap = document.getElementById(`custom-wrap-${selectId}`);
    if (existingWrap) existingWrap.remove();

    const wrapper = document.createElement("div");
    wrapper.className = "custom-select-wrapper";
    wrapper.id = `custom-wrap-${selectId}`;

    const trigger = document.createElement("div");
    trigger.className = "custom-select-trigger";

    const labelSpan = document.createElement("span");
    labelSpan.className = "custom-select-label";

    const arrow = document.createElement("div");
    arrow.className = "custom-select-arrow";
    arrow.innerHTML = `<i data-lucide="chevron-down"></i>`;

    trigger.appendChild(labelSpan);
    trigger.appendChild(arrow);
    wrapper.appendChild(trigger);

    const optionsContainer = document.createElement("div");
    optionsContainer.className = "custom-options";
    wrapper.appendChild(optionsContainer);

    nativeSelect.parentNode.insertBefore(wrapper, nativeSelect);

    const syncDisabled = () => {
      wrapper.classList.toggle("is-disabled", Boolean(nativeSelect.disabled));
    };

    const refresh = () => {
      optionsContainer.innerHTML = "";
      const options = Array.from(nativeSelect.options);
      
      const placeholderOption = options.find((opt) => !String(opt.value || "").trim());
      const placeholderText = placeholderOption?.text || nativeSelect.dataset.placeholder || "---";
      const allowEmptyOption = placeholderOption && /^all\b/i.test(String(placeholderOption.text || "").trim());
      
      const selectableOptions = options.filter((opt) => {
        const valueText = String(opt.value || "").trim();
        if (valueText) return true;
        return allowEmptyOption && opt === placeholderOption;
      });

      if (selectableOptions.length === 0) {
        labelSpan.textContent = placeholderText;
        return;
      }

      selectableOptions.forEach((opt) => {
        const optionDiv = document.createElement("div");
        optionDiv.className = `custom-option ${opt.selected ? "selected" : ""}`;
        optionDiv.textContent = opt.text;
        optionDiv.onclick = (e) => {
          e.stopPropagation();
          nativeSelect.value = opt.value;
          nativeSelect.dispatchEvent(new Event("change"));
          wrapper.classList.remove("open");
          refresh();
        };
        optionsContainer.appendChild(optionDiv);
      });

      const selectedOption = selectableOptions.find((opt) => opt.selected) || null;
      labelSpan.textContent = selectedOption?.text || placeholderText;
      syncDisabled();
    };

    const modalInputParent = wrapper.closest(".modal-input");
    const actualTrigger = modalInputParent || trigger;

    actualTrigger.onclick = (e) => {
      if (e.target.closest(".custom-options")) return;
      if (nativeSelect.disabled) return;
      e.stopPropagation();
      const isOpen = wrapper.classList.contains("open");
      document
        .querySelectorAll(".custom-select-wrapper")
        .forEach((w) => w.classList.remove("open"));
      document
        .querySelectorAll(".multi-select-wrapper")
        .forEach((w) => w.classList.remove("open"));
      if (!isOpen) wrapper.classList.add("open");
    };

    if (!window.__customSelectAutoCollapse) {
      window.__customSelectAutoCollapse = true;
      const closeAll = () => {
        document.querySelectorAll(".custom-select-wrapper.open").forEach((w) => w.classList.remove("open"));
        document.querySelectorAll(".multi-select-wrapper.open").forEach((w) => w.classList.remove("open"));
      };
      document.addEventListener("click", (e) => {
          if (e.target.closest(".custom-select-wrapper") || e.target.closest(".multi-select-wrapper")) return;
          closeAll();
        }, true
      );
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeAll();
      });
      window.addEventListener("resize", closeAll);
    }

    const observer = new MutationObserver(() => {
      refresh();
      if (window.lucide) window.lucide.createIcons({ root: wrapper });
    });
    observer.observe(nativeSelect, {
      childList: true,
      attributes: true,
      attributeFilter: ["disabled"],
    });
    
    wrapper.refresh = refresh;
    refresh();
    if (window.lucide) window.lucide.createIcons({ root: wrapper });
    return wrapper;
  }

  function createMultiSelect(selectId, options = {}) {
    const nativeSelect = document.getElementById(selectId);
    if (!nativeSelect) return null;

    nativeSelect.classList.add("hidden-native-select");

    const existingWrap = document.getElementById(`multi-wrap-${selectId}`);
    if (existingWrap) existingWrap.remove();

    const wrapper = document.createElement("div");
    wrapper.className = "multi-select-wrapper";
    wrapper.id = `multi-wrap-${selectId}`;

    const trigger = document.createElement("div");
    trigger.className = "multi-select-trigger";

    const label = document.createElement("span");
    label.className = "multi-select-label";

    const arrow = document.createElement("div");
    arrow.className = "multi-select-arrow";
    arrow.innerHTML = `<i data-lucide="chevron-down"></i>`;

    trigger.appendChild(label);
    trigger.appendChild(arrow);
    wrapper.appendChild(trigger);

    const optionsContainer = document.createElement("div");
    optionsContainer.className = "multi-options";
    wrapper.appendChild(optionsContainer);

    nativeSelect.parentNode.insertBefore(wrapper, nativeSelect);

    const getSelectConfig = () => {
      const placeholderOption = Array.from(nativeSelect.options).find(
        (opt) => !String(opt.value || "").trim()
      );
      const placeholderText =
        placeholderOption?.text ||
        options.placeholder ||
        nativeSelect.dataset.placeholder ||
        "All";
      const allowEmptyOption =
        placeholderOption &&
        /^all\b/i.test(String(placeholderOption.text || "").trim());
      return { placeholderOption, placeholderText, allowEmptyOption };
    };

    const getSelectedOptions = () => {
      const { placeholderOption, allowEmptyOption } = getSelectConfig();
      return Array.from(nativeSelect.options).filter((opt) => {
        if (!opt.selected) return false;
        const valueText = String(opt.value || "").trim();
        if (valueText) return true;
        return allowEmptyOption && opt === placeholderOption;
      });
    };

    const refresh = () => {
      const { placeholderOption, placeholderText, allowEmptyOption } = getSelectConfig();
      const selectedOptions = getSelectedOptions();
      
      const realSelection = selectedOptions.filter(opt => String(opt.value || "").trim());
      const count = realSelection.length;

      if (count === 0) {
        label.textContent = placeholderText;
        label.classList.add("placeholder");
      } else if (count === 1) {
        label.textContent = realSelection[0].text;
        label.classList.remove("placeholder");
      } else {
        const suffix = "selected"; 
        label.textContent = `${count} ${suffix}`;
        label.classList.remove("placeholder");
      }

      optionsContainer.innerHTML = "";
      Array.from(nativeSelect.options).forEach((opt) => {
        const valueText = String(opt.value || "").trim();
        if (!valueText && !(allowEmptyOption && opt === placeholderOption)) {
          return;
        }

        const optionDiv = document.createElement("div");
        optionDiv.className = `multi-option${opt.selected ? " selected" : ""}${
          opt.disabled ? " disabled" : ""
        }`;

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = opt.selected;
        checkbox.disabled = opt.disabled;
        checkbox.tabIndex = -1;

        const optLabel = document.createElement("span");
        optLabel.textContent = opt.text;

        optionDiv.appendChild(checkbox);
        optionDiv.appendChild(optLabel);
        
        optionDiv.onclick = (e) => {
          e.stopPropagation();
          if (opt.disabled) return;
          
          if (allowEmptyOption && opt === placeholderOption) {
            Array.from(nativeSelect.options).forEach((item) => {
              item.selected = false;
            });
            opt.selected = true;
          } else {
            opt.selected = !opt.selected;
            if (allowEmptyOption && placeholderOption) {
              placeholderOption.selected = false;
            }
          }
          
          nativeSelect.dispatchEvent(new Event("change"));
          refresh();
        };

        optionsContainer.appendChild(optionDiv);
      });
    };

    trigger.onclick = (e) => {
      if (e.target.closest(".multi-options")) return;
      e.stopPropagation();
      const isOpen = wrapper.classList.contains("open");
      document
        .querySelectorAll(".multi-select-wrapper")
        .forEach((w) => w.classList.remove("open"));
      document
        .querySelectorAll(".custom-select-wrapper")
        .forEach((w) => w.classList.remove("open"));
      if (!isOpen) wrapper.classList.add("open");
    };

    const observer = new MutationObserver(() => {
      refresh();
      if (window.lucide) window.lucide.createIcons({ root: wrapper });
    });
    observer.observe(nativeSelect, { childList: true });
    nativeSelect.addEventListener("change", refresh);

    wrapper.refresh = (newOptions) => {
        if(newOptions) Object.assign(options, newOptions);
        refresh();
    };
    refresh();
    if (window.lucide) window.lucide.createIcons({ root: wrapper });
    return wrapper;
  }

  function applyTheme(mode, toggleEl, options = {}) {
    const { persist = true } = options;
    const root = document.documentElement;
    const resolved = resolveTheme(mode);
    const isLight = resolved === "light";

    currentThemePreference = mode;
    currentTheme = resolved;
    root.classList.toggle("light", isLight);
    root.classList.toggle("dark", !isLight);

    renderThemeToggleIcon(toggleEl, mode, resolved);
    if (window.lucide?.createIcons) {
      window.lucide.createIcons();
    }
    if (persist) {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    }
  }

  function initThemeToggle(toggleEl, options = {}) {
    if (!toggleEl) return () => { };

    const { defaultTheme = DEFAULT_THEME, onChange } = options;
    const saved = localStorage.getItem(THEME_STORAGE_KEY) || defaultTheme;
    applyTheme(saved, toggleEl, { persist: false });

    const handler = () => {
      const next =
        currentThemePreference === "light"
          ? "dark"
          : currentThemePreference === "dark"
            ? "system"
            : "light";
      applyTheme(next, toggleEl);
      onChange?.(next);
    };

    toggleEl.addEventListener("click", handler);

    const sync = (e) => {
      if (e.key !== THEME_STORAGE_KEY) return;
      const next = e.newValue;
      if (!next || next === currentThemePreference) return;
      applyTheme(next, toggleEl, { persist: false });
      onChange?.(next);
    };
    window.addEventListener("storage", sync);

    const handleSystemChange = () => {
      if (currentThemePreference !== "system") return;
      applyTheme("system", toggleEl, { persist: false });
      onChange?.("system");
    };
    mediaQuery.addEventListener("change", handleSystemChange);

    return (mode) => applyTheme(mode, toggleEl);
  }

  function createLogRow(entry) {
    const {
      level = "system",
      message = "",
      timestamp,
      divider = false,
      label = "",
    } = entry || {};
    const levelLower = (level || "system").toString().toLowerCase();

    if (divider) {
      const row = document.createElement("div");
      row.className = `log-line log-divider log-line-${levelLower}`;
      row.dataset.level = levelLower;

      const left = document.createElement("span");
      left.className = "log-divider-line";

      const text = document.createElement("span");
      text.className = "log-divider-label";
      text.textContent = label || message || "";

      const right = document.createElement("span");
      right.className = "log-divider-line";

      row.append(left, text, right);
      return row;
    }

    const row = document.createElement("div");
    row.className = `log-line log-line-${levelLower}`;
    row.dataset.level = levelLower;

    const time = document.createElement("div");
    time.className = "log-time";
    time.textContent = formatTimestamp(timestamp);

    const text = document.createElement("div");
    text.className = "log-text";
    text.textContent = message;

    row.appendChild(time);
    row.appendChild(text);
    return row;
  }

  function pushLog(container, entry, options = {}) {
    if (!container || !entry) return null;
    const row = createLogRow(entry);
    const animate = options.animate ?? false;

    if (animate) {
      row.classList.add("log-animate");
      requestAnimationFrame(() => row.classList.add("log-animate-in"));
    }

    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
    return row;
  }

  function bindLogFilters(filterRoot, logContainer) {
    if (!filterRoot || !logContainer) return () => { };

    const handler = () => {
      const enabled = new Set();
      const boxes = filterRoot.querySelectorAll('input[type="checkbox"]');
      boxes.forEach((box) => {
        if (box.checked) enabled.add(box.dataset.level);
      });

      logContainer.querySelectorAll(".log-line").forEach((line) => {
        line.style.display = enabled.has(line.dataset.level) ? "grid" : "none";
      });
    };

    filterRoot.addEventListener("change", handler);
    return handler;
  }

  function initLogView(logContainer, filterRoot) {
    const applyFilters = bindLogFilters(filterRoot, logContainer);
    const pushLogBound = (entry, options = {}) =>
      pushLog(logContainer, entry, options);

    // Initial pass to respect default checkbox state
    applyFilters?.();

    return {
      pushLog: pushLogBound,
      applyFilters: applyFilters || (() => { }),
    };
  }

  const STATUS_CLASSES = [
    "pill-running",
    "pill-paused",
    "pill-idle",
    "pill-warn",
    "pill-err",
  ];

  function normalizeTone(tone) {
    const t = (tone || "").toLowerCase();
    if (t === "ok" || t === "running") return "running";
    if (t === "warn" || t === "paused") return "warn";
    if (t === "err" || t === "error") return "err";
    return "idle";
  }

  function normalizePillStatus(status) {
    const raw = status == null ? "" : String(status);
    const trimmed = raw.trim();
    const safe = trimmed || "unknown";
    const className = safe.toLowerCase().replace(/\s+/g, "_");
    return { raw: safe, className };
  }

  function renderPillHtml(status, options = {}) {
    const { label, extraClasses, includeStatusClass = true } = options;
    const { raw, className } = normalizePillStatus(status);
    const classes = ["pill"];
    if (includeStatusClass) classes.push(`pill-${className}`);
    if (Array.isArray(extraClasses)) {
      extraClasses.filter(Boolean).forEach((entry) => classes.push(entry));
    }
    const text = label != null ? String(label) : raw;
    return `<span class="${classes.join(" ")}">${text}</span>`;
  }

  function setPillContent(pillEl, status, options = {}) {
    if (!pillEl) return;
    const { label, extraClasses, includeStatusClass = true } = options;
    const { raw, className } = normalizePillStatus(status);
    const classes = ["pill"];
    if (includeStatusClass) classes.push(`pill-${className}`);
    if (Array.isArray(extraClasses)) {
      extraClasses.filter(Boolean).forEach((entry) => classes.push(entry));
    }
    pillEl.className = classes.join(" ");
    pillEl.textContent = label != null ? String(label) : raw;
  }

  function setStatusPill(pillEl, label, tone = "idle", timeEl) {
    if (!pillEl) return;

    pillEl.textContent = label;
    const normalizedTone = normalizeTone(tone);

    pillEl.classList.remove(...STATUS_CLASSES);
    pillEl.classList.add("pill-switch");
    pillEl.addEventListener(
      "animationend",
      () => pillEl.classList.remove("pill-switch"),
      { once: true }
    );

    if (normalizedTone === "running") {
      pillEl.classList.add("pill-running");
    } else if (normalizedTone === "warn") {
      pillEl.classList.add("pill-paused", "pill-warn");
    } else if (normalizedTone === "err") {
      pillEl.classList.add("pill-err");
    } else {
      pillEl.classList.add("pill-idle");
    }

    if (timeEl) {
      timeEl.textContent = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    }
  }

  function startLiveClock(timeEl, options = {}) {
    if (!timeEl) return () => { };
    const { showDateTooltip = false } = options;

    const update = () => {
      const now = new Date();
      timeEl.textContent = now.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      if (showDateTooltip) {
        timeEl.title = now.toLocaleDateString([], {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
      }
    };

    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }

  function bindBackdropClose(modalEl, closeFn) {
    if (!modalEl) return;

    let isBackdropPress = false;

    modalEl.addEventListener("mousedown", (e) => {
      if (e.target === modalEl) {
        isBackdropPress = true;
      } else {
        isBackdropPress = false;
      }
    });

    modalEl.addEventListener("mouseup", (e) => {
      if (isBackdropPress && e.target === modalEl) {
        closeFn();
      }
      isBackdropPress = false;
    });

    const content = modalEl.querySelector(".modal");
    if (content) {
      content.addEventListener("click", (e) => {
        e.stopPropagation();
      });
    }
  }

  function createToastManager(toastRoot, electronAPI) {
    function renderToast(message, ttlMs = 2000) {
      if (!toastRoot || !message) return;

      const el = document.createElement("div");
      el.className = "toast";
      el.innerHTML = `<span class="dot"></span><span>${message}</span>`;
      const existing = Array.from(toastRoot.querySelectorAll(".toast"));
      const firstRects = new Map(
        existing.map((toast) => [toast, toast.getBoundingClientRect()])
      );

      toastRoot.appendChild(el);

      // FLIP: animate existing toasts to new positions instead of jumping
      requestAnimationFrame(() => {
        existing.forEach((toast) => {
          const first = firstRects.get(toast);
          const last = toast.getBoundingClientRect();
          if (!first) return;
          const dx = first.left - last.left;
          const dy = first.top - last.top;
          if (!dx && !dy) return;

          toast.style.transition = "transform 0s, opacity 0.2s ease";
          toast.style.transform = `translate(${dx}px, ${dy}px)`;

          requestAnimationFrame(() => {
            toast.style.transition = "transform 0.2s ease, opacity 0.2s ease";
            toast.style.transform = "";
          });
        });

        el.classList.add("show");
      });

      setTimeout(() => {
        el.classList.remove("show");
        setTimeout(() => el.remove(), 200);
      }, ttlMs);
    }

    const showToast = (message, ttlMs = 2000) => {
      if (electronAPI?.sendToast) {
        electronAPI.sendToast(message, ttlMs);
        return;
      }
      renderToast(message, ttlMs);
    };

    electronAPI?.onToast?.(({ message, ttlMs }) => {
      renderToast(message, ttlMs ?? 2000);
    });

    return { showToast, renderToast };
  }

  const modalSpecStack = [];
  let activeModalSpec = null;

  function validateModalSpec(spec) {
    const errors = [];
    if (!spec || typeof spec !== "object") {
      errors.push("spec is not an object");
      return { ok: false, errors };
    }
    if (!spec.kind) errors.push("spec.kind is required");
    if (!spec.title) errors.push("spec.title is required");
    if (!spec.body) errors.push("spec.body is required");
    if (!Array.isArray(spec.actions) || !spec.actions.length) {
      errors.push("spec.actions must be a non-empty array");
    }
    if (!spec.intent) {
      errors.push("spec.intent is required");
    }
    return { ok: errors.length === 0, errors };
  }

  function renderNextModalSpec() {
    if (activeModalSpec || !modalSpecStack.length) return;
    activeModalSpec = modalSpecStack.shift();
    ConfirmModal.showSpec(
      activeModalSpec.spec,
      activeModalSpec.resolve,
      () => {
        activeModalSpec = null;
        renderNextModalSpec();
      }
    );
  }

  function openModalSpec(spec) {
    if (!spec) return Promise.resolve(null);
    const validation = validateModalSpec(spec);
    if (!validation.ok) {
      console.warn("[ModalSpec] Invalid spec:", validation.errors, spec);
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      modalSpecStack.push({ spec, resolve });
      renderNextModalSpec();
    });
  }

  window.UIHelpers = {
    formatTimestamp: window.UIHelpers?.formatTimestamp || formatTimestamp,
    applyTheme,
    initThemeToggle,
    createLogRow,
    pushLog,
    bindLogFilters,
    initLogView,
    setStatusPill,
    startLiveClock,
    renderPillHtml,
    setPillContent,
    bindBackdropClose,
    createToastManager,
    initConfirmModal: ConfirmModal.init,
    openModalSpec,
    openFormModal: FormModal.show,
    closeFormModal: FormModal.hide,
    renderModalActions,
    performModalTransition,
    createCustomSelect,
    createMultiSelect,
  };
})();

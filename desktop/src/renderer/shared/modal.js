(function () {
  const DEFAULT_TRANSITION_MS = 200;
  const FOCUSABLE_SELECTOR =
    "a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex='-1'])";

  class Modal {
    constructor(backdropEl, options = {}) {
      this.backdropEl = backdropEl;
      this.modalEl = backdropEl
        ? backdropEl.querySelector(options.modalSelector || ".modal")
        : null;
      this.transitionMs =
        typeof options.transitionMs === "number"
          ? options.transitionMs
          : DEFAULT_TRANSITION_MS;
      this.onOpen = options.onOpen || null;
      this.onClose = options.onClose || null;
      this.onBeforeClose = options.onBeforeClose || null;
      this.onSubmit = options.onSubmit || null;
      this.closeOnBackdrop = options.closeOnBackdrop !== false;
      this.closeOnEsc = options.closeOnEsc !== false;
      this.trapFocus = options.trapFocus !== false;
      this.returnFocus = options.returnFocus !== false;
      this.closeSelector = options.closeSelector || "[data-modal-close]";
      this.submitSelector = options.submitSelector || "[data-modal-submit]";
      this.initialFocusSelector = options.initialFocusSelector || null;
      this.bodyLayout = options.bodyLayout || null;

      this.isOpen = false;
      this.isSubmitting = false;
      this.previousFocusEl = null;
      this.boundKeydown = null;

      this.setBodyLayout(this.bodyLayout);

      if (this.closeOnBackdrop) {
        this.bindBackdropClose();
      }

      this.bindCloseButtons();
      this.bindSubmitButtons();
    }

    bindBackdropClose() {
      if (!this.backdropEl) return;
      if (window.UIHelpers?.bindBackdropClose) {
        window.UIHelpers.bindBackdropClose(this.backdropEl, () => this.close());
      } else {
        this.backdropEl.addEventListener("click", (event) => {
          if (event.target === this.backdropEl) {
            this.close();
          }
        });
      }
    }

    bindCloseButtons() {
      if (!this.backdropEl) return;
      this.backdropEl.querySelectorAll(this.closeSelector).forEach((btn) => {
        if (btn.dataset.modalBoundClose) return;
        btn.dataset.modalBoundClose = "true";
        btn.addEventListener("click", (event) => {
          event.preventDefault();
          this.close();
        });
      });
    }

    bindSubmitButtons() {
      if (!this.backdropEl) return;
      this.backdropEl.querySelectorAll(this.submitSelector).forEach((btn) => {
        if (btn.dataset.modalBoundSubmit) return;
        btn.dataset.modalBoundSubmit = "true";
        btn.addEventListener("click", (event) => {
          event.preventDefault();
          this.handleSubmit(btn, event);
        });
      });
    }

    setSubmitHandler(handler) {
      this.onSubmit = handler;
    }

    transition(callback) {
      if (this.modalEl && window.UIHelpers?.performModalTransition) {
        window.UIHelpers.performModalTransition(this.modalEl, callback);
        return;
      }
      if (typeof callback === "function") {
        callback();
      }
    }

    getFocusableElements() {
      if (!this.modalEl) return [];
      return Array.from(this.modalEl.querySelectorAll(FOCUSABLE_SELECTOR));
    }

    focusFirst() {
      if (!this.modalEl) return;
      const initial =
        (this.initialFocusSelector &&
          this.modalEl.querySelector(this.initialFocusSelector)) ||
        this.getFocusableElements()[0] ||
        this.modalEl;
      if (typeof initial?.focus === "function") {
        initial.focus();
      }
    }

    bindFocusTrap() {
      if (!this.trapFocus) return;
      this.boundKeydown = (event) => {
        if (!this.isOpen) return;
        if (this.closeOnEsc && event.key === "Escape") {
          event.preventDefault();
          this.close();
          return;
        }
        if (event.key !== "Tab") return;
        const focusable = this.getFocusableElements();
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };
      document.addEventListener("keydown", this.boundKeydown);
    }

    unbindFocusTrap() {
      if (!this.boundKeydown) return;
      document.removeEventListener("keydown", this.boundKeydown);
      this.boundKeydown = null;
    }

    setText(target, text) {
      const el =
        typeof target === "string"
          ? this.backdropEl?.querySelector(target)
          : target;
      if (el) el.textContent = text ?? "";
    }

    setHtml(target, html) {
      const el =
        typeof target === "string"
          ? this.backdropEl?.querySelector(target)
          : target;
      if (el) el.innerHTML = html ?? "";
    }

    setBodyLayout(layout) {
      this.bodyLayout = layout || null;
      if (!this.modalEl) return;
      const body = this.modalEl.querySelector(".modal-body");
      if (!body) return;
      body.classList.toggle("modal-body-columns", layout === "columns");
      this.modalEl.classList.toggle(
        "modal-columns-wide",
        layout === "columns"
      );
    }

    setButtonState(button, isSubmitting) {
      if (!button) return;
      button.disabled = isSubmitting;
      button.classList.toggle("spinning", isSubmitting);
    }

    async handleSubmit(button, event) {
      if (this.isSubmitting) return;
      if (typeof this.onSubmit !== "function") return;
      this.isSubmitting = true;
      this.setButtonState(button, true);
      try {
        const result = await this.onSubmit(event, this);
        if (result !== false) {
          this.close();
        }
      } catch (err) {
        console.error("Modal submit failed:", err);
      } finally {
        this.setButtonState(button, false);
        this.isSubmitting = false;
      }
    }

    open() {
      if (!this.backdropEl) return;
      this.bindCloseButtons();
      this.bindSubmitButtons();
      if (this.returnFocus) {
        this.previousFocusEl = document.activeElement;
      }
      this.backdropEl.classList.remove("hidden");
      requestAnimationFrame(() => {
        this.backdropEl.classList.add("show");
      });
      this.isOpen = true;
      this.bindFocusTrap();
      this.focusFirst();
      if (typeof this.onOpen === "function") {
        this.onOpen(this);
      }
    }

    close() {
      if (!this.backdropEl) return;
      if (typeof this.onBeforeClose === "function") {
        const shouldClose = this.onBeforeClose(this);
        if (shouldClose === false) return;
      }
      this.isOpen = false;
      this.unbindFocusTrap();
      this.backdropEl.classList.remove("show");
      setTimeout(() => {
        this.backdropEl.classList.add("hidden");
      }, this.transitionMs);
      if (typeof this.onClose === "function") {
        this.onClose(this);
      }
      if (this.returnFocus && this.previousFocusEl?.focus) {
        this.previousFocusEl.focus();
        this.previousFocusEl = null;
      }
    }
  }

  class StepperModal extends Modal {
    constructor(backdropEl, options = {}) {
      super(backdropEl, options);
      this.steps = Array.isArray(options.steps) ? options.steps : [];
      this.activeStep = options.initialStep || this.steps[0] || null;
      this.onStepChange = options.onStepChange || null;
      this.actionSelector = options.actionSelector || "[data-step-action]";
      this.actionButtons = backdropEl
        ? Array.from(backdropEl.querySelectorAll(this.actionSelector))
        : [];
    }

    getActionButtons() {
      if (!this.actionButtons.length && this.backdropEl) {
        this.actionButtons = Array.from(
          this.backdropEl.querySelectorAll(this.actionSelector)
        );
      }
      return this.actionButtons;
    }

    setSteps(steps) {
      this.steps = Array.isArray(steps) ? steps : [];
      if (!this.activeStep && this.steps.length) {
        this.activeStep = this.steps[0];
      }
    }

    goTo(step) {
      const target = step || this.steps[0];
      if (!target) return;
      this.transition(() => {
        this.activeStep = target;
        if (typeof this.onStepChange === "function") {
          this.onStepChange(target, this);
        }
      });
    }

    next() {
      if (!this.steps.length) return;
      const idx = this.steps.indexOf(this.activeStep);
      const nextIdx = idx < 0 ? 0 : Math.min(idx + 1, this.steps.length - 1);
      this.goTo(this.steps[nextIdx]);
    }

    back() {
      if (!this.steps.length) return;
      const idx = this.steps.indexOf(this.activeStep);
      const prevIdx = idx <= 0 ? 0 : idx - 1;
      this.goTo(this.steps[prevIdx]);
    }
  }

  const registry = new Map();

  function registerModal(key, controller) {
    if (!key || !controller) return;
    registry.set(key, controller);
  }

  function registerModalForElement(el, controller) {
    if (!el || !controller) return;
    registerModal(el, controller);
    if (el.id) {
      registerModal(el.id, controller);
    }
  }

  function resolveModal(keyOrEl) {
    if (!keyOrEl) return null;
    if (registry.has(keyOrEl)) return registry.get(keyOrEl);
    if (typeof keyOrEl === "string") {
      return registry.get(keyOrEl) || null;
    }
    if (keyOrEl.id && registry.has(keyOrEl.id)) {
      return registry.get(keyOrEl.id);
    }
    return null;
  }

  function createModal(el, options) {
    if (!el) return null;
    const controller = new Modal(el, options);
    registerModalForElement(el, controller);
    return controller;
  }

  function createStepperModal(el, options) {
    if (!el) return null;
    const controller = new StepperModal(el, options);
    registerModalForElement(el, controller);
    return controller;
  }

  function openModal(keyOrEl) {
    const controller = resolveModal(keyOrEl);
    controller?.open();
  }

  function closeModal(keyOrEl) {
    const controller = resolveModal(keyOrEl);
    controller?.close();
  }

  function transitionModal(keyOrEl, callback) {
    const controller = resolveModal(keyOrEl);
    if (controller?.transition) {
      controller.transition(callback);
      return;
    }
    if (typeof callback === "function") {
      callback();
    }
  }

  function mountModalShell(options = {}) {
    const { id = "modalShell", templateId = "modal-template" } = options;
    let shell = document.getElementById(id);
    if (shell) return shell;

    const template = document.getElementById(templateId);
    if (template && template.content?.firstElementChild) {
      shell = template.content.firstElementChild.cloneNode(true);
    } else {
      shell = document.createElement("div");
      shell.className = "modal-backdrop hidden";
      shell.innerHTML = `
        <div class="modal glass task-modal">
          <div class="modal-header">
            <div>
              <p class="eyebrow" data-modal-eyebrow></p>
              <h3 data-modal-title></h3>
              <p class="modal-desc" data-modal-desc></p>
            </div>
            <button class="icon-btn modal-close" title="Close" data-modal-close>
              <i data-lucide="x"></i>
            </button>
          </div>
          <div class="modal-body" data-modal-body></div>
          <div class="modal-actions" data-modal-actions></div>
        </div>
      `;
    }

    shell.id = id;
    document.body.appendChild(shell);
    return shell;
  }

  window.ModalHelpers = {
    Modal,
    StepperModal,
    createModal,
    createStepperModal,
    registerModal,
    resolveModal,
    open: openModal,
    close: closeModal,
    transition: transitionModal,
    mountModalShell,
  };
})();

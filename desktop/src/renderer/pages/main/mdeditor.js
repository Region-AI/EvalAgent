(function () {
  const tr = (key, vars) =>
    window.I18n?.t?.(key, vars) ??
    (window.__appTr || ((fallback) => fallback))(key, vars);
  const sanitizeMarkdownHtml = (html = "") => {
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
  class BlockEditor {
    constructor(container, initialMarkdown = "", options = {}) {
      this.container = container;
      this.rawMarkdown = initialMarkdown;
      this.tokens = [];
      this.mode = "blocks";
      this.onSave = options.onSave || (() => { });
      this.onCancel = options.onCancel || (() => { });

      this.editingIndex = -1;
      this.editLock = false;

      this.history = [];
      this.historyPtr = -1;
      this.isUndoRedoAction = false;

      this.boundGlobalClick = this.handleGlobalClick.bind(this);
      this.boundKeydown = this.handleKeydown.bind(this);

      this.init();
    }

    init() {
      if (!window.marked || !window.marked.lexer) {
        this.container.innerHTML = `<div style='color:red'>${tr("editor.error.markedMissing")}</div>`;
        return;
      }
      this.parse(this.rawMarkdown);

      this.pushHistory(this.rawMarkdown);

      this.render();
      document.addEventListener("click", this.boundGlobalClick, true);
      document.addEventListener("keydown", this.boundKeydown);
    }

    destroy() {
      document.removeEventListener("click", this.boundGlobalClick, true);
      document.removeEventListener("keydown", this.boundKeydown);
    }

    pushHistory(md) {
      if (this.isUndoRedoAction) return;

      if (this.historyPtr < this.history.length - 1) {
        this.history = this.history.slice(0, this.historyPtr + 1);
      }

      if (this.history.length > 0 && this.history[this.historyPtr] === md) {
        return;
      }

      this.history.push(md);
      this.historyPtr++;

      if (this.history.length > 50) {
        this.history.shift();
        this.historyPtr--;
      }

      this.updateUndoRedoUI();
    }

    undo() {
      if (this.historyPtr > 0) {
        this.isUndoRedoAction = true;
        this.historyPtr--;
        const prevMd = this.history[this.historyPtr];
        this.rawMarkdown = prevMd;
        this.parse(prevMd);
        this.render();
        this.isUndoRedoAction = false;
        this.updateUndoRedoUI();
      }
    }

    redo() {
      if (this.historyPtr < this.history.length - 1) {
        this.isUndoRedoAction = true;
        this.historyPtr++;
        const nextMd = this.history[this.historyPtr];
        this.rawMarkdown = nextMd;
        this.parse(nextMd);
        this.render();
        this.isUndoRedoAction = false;
        this.updateUndoRedoUI();
      }
    }

    updateUndoRedoUI() {
      const undoBtn = this.container.querySelector('[data-action="undo"]');
      const redoBtn = this.container.querySelector('[data-action="redo"]');
      if (undoBtn) undoBtn.disabled = this.historyPtr <= 0;
      if (redoBtn)
        redoBtn.disabled = this.historyPtr >= this.history.length - 1;
    }

    handleKeydown(e) {
      const target = e.target;
      const isInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      if (isInput && (this.mode === "source" || this.editingIndex !== -1)) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        this.undo();
      }
      if (
        ((e.ctrlKey || e.metaKey) && e.key === "y") ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "z")
      ) {
        e.preventDefault();
        this.redo();
      }
    }

    handleGlobalClick(e) {
      if (this.tocVisible) {
        const tocDropdown = this.container.querySelector('.be-toc-dropdown');
        const tocBtn = this.container.querySelector('[data-action="toggle-toc"]');
        
        if (tocDropdown && !tocDropdown.contains(e.target) && tocBtn && !tocBtn.contains(e.target)) {
          this.toggleTOC(false);
        }
      }

      if (this.editingIndex === -1) return;

      const editingBlock = this.container.querySelector(
        `.be-block[data-index="${this.editingIndex}"]`
      );
      if (editingBlock && editingBlock.contains(e.target)) return;
      if (e.target.closest(".be-sidebar")) return;
      if (e.target.closest(".be-toc-dropdown")) return;

      this.editLock = true;
      const textarea = editingBlock
        ? editingBlock.querySelector("textarea")
        : null;
      if (textarea) {
        this.confirmBlockEdit(this.editingIndex, textarea.value);
      } else {
        this.cancelBlockEdit();
      }
      setTimeout(() => {
        this.editLock = false;
      }, 200);
    }

    updateToolbarPosition(blockEl) {
      const tools = blockEl.querySelector(".be-block-tools");
      if (!tools) return;

      const rect = blockEl.getBoundingClientRect();
      const toolbarHeight = 34;
      const HEADER_OFFSET = 60;

      if (rect.top - toolbarHeight < HEADER_OFFSET) {
        tools.classList.remove("pos-top");
        tools.classList.add("pos-bottom");
      } else {
        tools.classList.remove("pos-bottom");
        tools.classList.add("pos-top");
      }
    }

    parse(md) {
      this.tokens = window.marked.lexer(md);
      this.rawMarkdown = md;
    }

    reconstruct() {
      return this.tokens
        .filter((t) => t.type !== "space")
        .map((t) => t.raw.trimEnd())
        .join("\n\n");
    }

    moveBlock(index, direction) {
      let targetIndex = index + direction;
      while (
        targetIndex >= 0 &&
        targetIndex < this.tokens.length &&
        this.tokens[targetIndex].type === "space"
      ) {
        targetIndex += direction;
      }
      if (targetIndex < 0 || targetIndex >= this.tokens.length) return;
      const temp = this.tokens[index];
      this.tokens[index] = this.tokens[targetIndex];
      this.tokens[targetIndex] = temp;
      this.updateRaw();
    }

    render() {
      this.container.innerHTML = "";
      this.container.classList.add("block-editor-root");

      const mainCol = document.createElement("div");
      mainCol.className = "be-main-column";
      const workspace = document.createElement("div");
      workspace.id = "be-workspace";
      mainCol.appendChild(workspace);
      this.container.appendChild(mainCol);

      const sidebar = document.createElement("div");
      sidebar.className = "be-sidebar";

      sidebar.innerHTML = `
        <div class="be-sidebar-group">
          <button class="be-side-btn ${this.mode === "blocks" ? "active" : ""}" title="${tr("editor.mode.blocks")}" data-action="mode-blocks">
            <i data-lucide="layout-list"></i>
          </button>
          <button class="be-side-btn ${this.mode === "source" ? "active" : ""}" title="${tr("editor.mode.source")}" data-action="mode-source">
            <i data-lucide="code"></i>
          </button>
        </div>

        <div class="be-sidebar-group">
          <button class="be-side-btn" title="${tr("editor.undo")}" data-action="undo" disabled>
            <i data-lucide="undo-2"></i>
          </button>
          <button class="be-side-btn" title="${tr("editor.redo")}" data-action="redo" disabled>
            <i data-lucide="redo-2"></i>
          </button>
        </div>
        
        <div class="be-sidebar-group" style="margin-top: auto;">
          <button class="be-side-btn save-trigger" title="${tr("editor.save")}" data-action="global-save">
            <i data-lucide="save"></i>
          </button>
          <button class="be-side-btn" title="${tr("editor.cancel")}" data-action="global-cancel">
            <i data-lucide="x"></i>
          </button>
        </div>
      `;

      sidebar.addEventListener("click", (e) => {
        const btn = e.target.closest("button");
        if (!btn) return;
        const action = btn.dataset.action;

        if (
          this.editingIndex !== -1 &&
          action !== "undo" &&
          action !== "redo" &&
          action !== "toggle-toc"
        ) {
          this.saveAndCloseCurrent();
        }

        if (action === "mode-blocks") this.setMode("blocks");
        if (action === "mode-source") this.setMode("source");
        if (action === "global-save") this.triggerGlobalSave(btn);
        if (action === "global-cancel") this.onCancel();
        if (action === "undo") this.undo();
        if (action === "redo") this.redo();
        if (action === "toggle-toc") this.toggleTOC();
      });

      this.container.appendChild(sidebar);

      if (this.mode === "source") {
        this.renderSourceMode(workspace);
      } else {
        this.renderBlockMode(workspace);
      }

      this.updateUndoRedoUI();

      if (window.lucide && window.lucide.createIcons) {
        window.lucide.createIcons({ root: this.container });
      }
    }

    toggleTOC(forceState) {
      const dropdown = this.container.querySelector('#be-toc-dropdown');
      const btn = this.container.querySelector('[data-action="toggle-toc"]');
      
      if (!dropdown || !btn) return;

      const nextState = typeof forceState === 'boolean' ? forceState : !this.tocVisible;
      this.tocVisible = nextState;

      if (this.tocVisible) {
        dropdown.classList.add('show');
        btn.classList.add('active');
        this.renderTOCContent(dropdown);
      } else {
        dropdown.classList.remove('show');
        btn.classList.remove('active');
      }
    }

    renderTOCContent(container) {
      container.innerHTML = '';
      
      const headings = this.tokens
        .map((t, idx) => ({ ...t, index: idx }))
        .filter(t => t.type === 'heading');

      if (headings.length === 0) {
        container.innerHTML = `<div class="be-toc-empty">No headers found</div>`;
        return;
      }

      const headerDiv = document.createElement('div');
      headerDiv.className = 'be-toc-header';
      headerDiv.textContent = 'Table of Contents';
      container.appendChild(headerDiv);

      headings.forEach(h => {
        const item = document.createElement('button');
        item.className = `be-toc-item depth-${h.depth}`;
        item.textContent = h.text;
        item.title = h.text;
        
        item.onclick = (e) => {
          e.stopPropagation();
          this.scrollToBlock(h.index);
        };
        
        container.appendChild(item);
      });
    }

    scrollToBlock(index) {
      if (this.mode !== 'blocks') {
        this.setMode('blocks');
      }

      const attemptScroll = (retryCount = 0) => {
        const blockEl = this.container.querySelector(`.be-block[data-index="${index}"]`);
        
        if (blockEl) {
          blockEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          blockEl.style.transition = 'background-color 0.3s, box-shadow 0.3s';
          blockEl.style.backgroundColor = 'rgba(122, 162, 255, 0.2)';
          blockEl.style.boxShadow = '0 0 0 2px rgba(122, 162, 255, 0.4)';
          
          setTimeout(() => {
            blockEl.style.backgroundColor = '';
            blockEl.style.boxShadow = '';
          }, 1200);
        } else {
          if (retryCount < 5) {
            setTimeout(() => attemptScroll(retryCount + 1), 50 + (retryCount * 50));
          } else {
            console.warn(`[BlockEditor] Could not find block with index ${index} to scroll to.`);
          }
        }
      };
      setTimeout(() => attemptScroll(), 10);
    }

    renderSourceMode(target) {
      const textarea = document.createElement("textarea");
      textarea.className = "be-source-textarea";
      textarea.value = this.rawMarkdown;
      textarea.spellcheck = false;

      textarea.addEventListener("input", (e) => {
        this.rawMarkdown = e.target.value;
      });
      textarea.addEventListener("blur", () => {
        this.parse(this.rawMarkdown);
        this.pushHistory(this.rawMarkdown);
      });
      target.appendChild(textarea);
    }

    renderBlockMode(target) {
      const list = document.createElement("div");
      list.className = "be-blocks-container";

      if (this.editingIndex !== -1) {
        list.classList.add("has-editing");
      }

      list.addEventListener("click", (e) => {
        e.stopPropagation();

        if (this.editLock) return;

        const blockEl = e.target.closest(".be-block");
        if (!blockEl) {
          if (this.editingIndex !== -1) this.saveAndCloseCurrent();
          return;
        }

        if (e.target.tagName === "A") return;
        if (e.target.closest(".be-block-tools")) return;
        if (e.target.closest("textarea")) return;
        if (e.target.closest(".be-edit-tabs")) return;

        const clickedIndex = parseInt(blockEl.dataset.index, 10);

        if (this.editingIndex !== -1) {
          if (clickedIndex === this.editingIndex) return;
          this.saveAndCloseCurrent();
          return;
        }

        this.editingIndex = clickedIndex;
        this.render();
      });

      if (this.tokens.length === 0) {
        this.addBlock(0, "text");
      }

      this.tokens.forEach((token, index) => {
        if (token.type === "space") return;

        const blockEl = document.createElement("div");
        blockEl.className = `be-block ${this.editingIndex === index ? "editing" : ""}`;
        blockEl.dataset.index = index;

        blockEl.addEventListener("mouseenter", () => {
          if (this.editingIndex === -1) {
            this.updateToolbarPosition(blockEl);
          }
        });

        if (this.editingIndex === index) {
          this.renderBlockEditor(blockEl, token, index);
        } else {
          this.renderBlockPreview(blockEl, token, index);
        }
        list.appendChild(blockEl);
      });

      const appendBtn = document.createElement("button");
      appendBtn.className = "btn subtle small be-add-btn";
      appendBtn.innerHTML = `<i data-lucide="plus"></i> ${tr("editor.addParagraph")}`;
      appendBtn.onclick = (e) => {
        e.stopPropagation();
        if (this.editingIndex !== -1) {
          this.saveAndCloseCurrent();
        } else {
          this.addBlock(this.tokens.length, "text");
        }
      };

      list.appendChild(appendBtn);
      target.appendChild(list);
    }

    renderBlockPreview(container, token, index) {
      const tools = document.createElement("div");
      tools.className = "be-block-tools pos-top";
      tools.innerHTML = `
        <button class="be-tool-btn" title="${tr("editor.toolbar.edit")}" data-action="edit"><i data-lucide="edit-2"></i></button>
        <button class="be-tool-btn" title="${tr("editor.toolbar.addBelow")}" data-action="add"><i data-lucide="plus"></i></button>
        <button class="be-tool-btn" title="${tr("editor.toolbar.moveUp")}" data-action="up"><i data-lucide="arrow-up"></i></button>
        <button class="be-tool-btn" title="${tr("editor.toolbar.moveDown")}" data-action="down"><i data-lucide="arrow-down"></i></button>
        <button class="be-tool-btn danger" title="${tr("editor.toolbar.delete")}" data-action="del"><i data-lucide="trash-2"></i></button>
      `;

      tools.addEventListener("click", (e) => {
        e.stopPropagation();
        const btn = e.target.closest(".be-tool-btn");
        if (!btn) return;

        const action = btn.dataset.action;
        if (action === "up") this.moveBlock(index, -1);
        else if (action === "down") this.moveBlock(index, 1);
        else this.handleToolAction(action, index);
      });

      const preview = document.createElement("div");
      preview.className = "be-block-preview markdown-body";
      preview.innerHTML = sanitizeMarkdownHtml(window.marked.parse(token.raw));

      container.appendChild(tools);
      container.appendChild(preview);
    }

    saveAndCloseCurrent() {
      if (this.editingIndex === -1) return;
      const editingBlock = this.container.querySelector(
        `.be-block[data-index="${this.editingIndex}"]`
      );
      const textarea = editingBlock
        ? editingBlock.querySelector("textarea")
        : null;
      if (textarea) {
        this.confirmBlockEdit(this.editingIndex, textarea.value);
      } else {
        this.cancelBlockEdit();
      }
    }

    renderBlockEditor(container, token, index) {
      const textarea = document.createElement("textarea");
      textarea.className = "be-editor-textarea";
      textarea.value = token.raw;

      const autoResize = () => {
        textarea.style.height = "auto";
        textarea.style.height = textarea.scrollHeight + "px";
      };
      requestAnimationFrame(autoResize);
      textarea.addEventListener("input", autoResize);

      textarea.addEventListener("click", (e) => e.stopPropagation());

      textarea.addEventListener("keydown", (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          this.confirmBlockEdit(index, textarea.value);
        }
        if (e.key === "Escape") {
          this.cancelBlockEdit();
        }
      });

      const actions = document.createElement("div");
      actions.className = "be-edit-tabs";
      actions.innerHTML = `
        <button class="be-tab-btn cancel" id="be-cancel-btn">${tr("editor.esc")}</button>
        <button class="be-tab-btn save" id="be-save-btn">${tr("editor.done")}</button>
      `;

      actions.querySelector("#be-cancel-btn").onclick = (e) => {
        e.stopPropagation();
        this.cancelBlockEdit();
      };
      actions.querySelector("#be-save-btn").onclick = (e) => {
        e.stopPropagation();
        this.confirmBlockEdit(index, textarea.value);
      };

      container.appendChild(textarea);
      container.appendChild(actions);
      setTimeout(() => textarea.focus(), 50);
    }

    setMode(newMode) {
      if (this.mode === newMode) return;
      if (this.mode === "source") {
        this.parse(this.rawMarkdown);
      } else {
        this.rawMarkdown = this.reconstruct();
      }
      this.mode = newMode;
      this.editingIndex = -1;
      this.render();
    }

    triggerGlobalSave(btn) {
      const finalMd =
        this.mode === "blocks" ? this.reconstruct() : this.rawMarkdown;
      this.onSave(finalMd, btn);
    }

    handleToolAction(action, index) {
      if (action === "del") {
        this.tokens.splice(index, 1);
        this.updateRaw();
      }
      if (action === "add") {
        this.addBlock(index + 1);
      }
      if (action === "edit") {
        this.editingIndex = index;
        this.render();
      }
    }

    addBlock(index, type = "text") {
      const placeholder = `\n${tr("editor.newBlockPlaceholder")}\n`;
      const dummyToken = {
        type: "paragraph",
        raw: placeholder,
        text: placeholder.trim(),
      };
      this.tokens.splice(index, 0, dummyToken);
      this.editingIndex = index;
      this.updateRaw();
    }

    confirmBlockEdit(index, newText, shouldRender = true) {
      this.tokens[index].raw = newText;
      this.rawMarkdown = this.reconstruct();
      this.tokens = window.marked.lexer(this.rawMarkdown);
      this.editingIndex = -1;
      this.pushHistory(this.rawMarkdown);
      if (shouldRender) this.render();
    }

    cancelBlockEdit() {
      this.editingIndex = -1;
      this.render();
    }

    updateRaw() {
      this.rawMarkdown = this.reconstruct();
      this.tokens = window.marked.lexer(this.rawMarkdown);
      this.pushHistory(this.rawMarkdown);
      this.render();
    }

    getValue() {
      return this.mode === "blocks" ? this.reconstruct() : this.rawMarkdown;
    }
  }

  window.BlockEditor = BlockEditor;
})();

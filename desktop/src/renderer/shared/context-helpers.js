function trimForDisplay(text, maxLen = 140) {
  if (!text) return "";
  if (!maxLen || maxLen <= 0) return text;
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 3)}...`;
}

function renderContextList(
  target,
  items,
  emptyLabel,
  maxItems = 6,
  maxLen = 220
) {
  if (!target) return;
  target.innerHTML = "";
  if (!items || !items.length) {
    const li = document.createElement("li");
    li.textContent = emptyLabel;
    li.classList.add("context-actions-empty");
    target.appendChild(li);
    return;
  }

  items
    .slice(-(maxItems || 0) || undefined)
    .reverse()
    .forEach((item) => {
      const li = document.createElement("li");
      li.textContent = trimForDisplay(item, maxLen);
      target.appendChild(li);
    });
}

function parseActionEntry(text) {
  const raw = text || "";
  const match = raw.match(/Step\s*(\d+)\s*:\s*([^(]+)\((.*)\)\s*/i);

  let step = null;
  let tool = raw.trim();
  let paramsText = "";
  if (match) {
    step = parseInt(match[1], 10);
    tool = (match[2] || "").trim();
    paramsText = match[3] || "";
  }

  let params = null;
  if (paramsText) {
    try {
      params = JSON.parse(paramsText);
    } catch (e) {
      params = null;
    }
  }

  return { step, tool, params, paramsText };
}

function summarizeParams(tool, params, fallback) {
  if (!params || typeof params !== "object") return fallback;

  const toolName = (tool || "").toLowerCase();
  const coord = (p) =>
    p && typeof p.x === "number" && typeof p.y === "number"
      ? `(${Math.round(p.x)}, ${Math.round(p.y)})`
      : null;

  if (
    toolName === "single_click" ||
    toolName === "double_click" ||
    toolName === "right_click" ||
    toolName === "hover"
  ) {
    const pt = coord(params);
    return pt ? `at ${pt}` : fallback;
  }

  if (toolName === "drag") {
    const from = coord(params.from);
    const to = coord(params.to);
    if (from && to) return `${from} -> ${to}`;
    return fallback;
  }

  if (toolName === "direct_text_entry") {
    const txt =
      params.text ||
      params.text_to_enter ||
      params.text_to_type ||
      params.value ||
      "";
    return txt ? `text: "${trimForDisplay(txt, 60)}"` : fallback;
  }

  if (toolName === "simulate_text_entry") {
    const txt =
      params.text_to_type ||
      params.text ||
      params.text_to_enter ||
      params.value ||
      "";
    return txt ? `text: "${trimForDisplay(txt, 60)}"` : fallback;
  }

  if (toolName === "keyboard_shortcut") {
    const keys = Array.isArray(params.keys)
      ? params.keys
      : typeof params.keys === "string"
        ? params.keys.split("+")
        : [];
    return keys.length
      ? `keys: ${keys.map((k) => k.trim().toUpperCase()).join(" + ")}`
      : fallback;
  }

  if (toolName === "scroll") {
    return typeof params.amount === "number"
      ? `scroll ${params.amount > 0 ? "down" : "up"} (${params.amount})`
      : fallback;
  }

  if (toolName === "wait") {
    return typeof params.milliseconds === "number"
      ? `wait ${params.milliseconds} ms`
      : fallback;
  }

  if (toolName === "finish_task") {
    return params.status ? `status: ${params.status}` : fallback;
  }

  return fallback;
}

function renderActionBlocks(target, items, options = {}) {
  if (!target) return;
  target.innerHTML = "";

  const emptyLabel =
    options.actionEmptyLabel || "Actions will appear once the agent begins.";
  const stepLabel = options.stepLabel || "Step";
  const actionLabelFallback = options.actionLabelFallback || "action";
  const descriptions = options.actionDescriptions || [];

  const iconForTool = (tool) => {
    const t = (tool || "").toLowerCase();
    if (t === "single_click" || t === "double_click" || t === "right_click") {
      return "mouse-pointer";
    }
    if (t === "hover") return "move-horizontal";
    if (t === "drag") return "move";
    if (t === "simulate_text_entry" || t === "direct_text_entry") return "type";
    if (t === "keyboard_shortcut") return "keyboard";
    if (t === "scroll") return "mouse";
    if (t === "wait") return "timer";
    if (t === "finish_task") return "flag";
    return "dot";
  };

  if (!items || !items.length) {
    const li = document.createElement("li");
    li.textContent = emptyLabel;
    li.classList.add("context-actions-empty");
    target.appendChild(li);
    return;
  }

  const maxItems = options.actionMaxItems ?? 6;
  const maxLen = options.actionMaxLen ?? options.listMaxLen ?? 220;

  const start = Math.max(0, items.length - (maxItems || 0));
  const slicedItems = items.slice(start).reverse();
  const slicedDescriptions = descriptions.slice(start).reverse();

  slicedItems.forEach((item, idx) => {
    const { step, tool, params, paramsText } = parseActionEntry(item);
    const li = document.createElement("li");
    li.classList.add("action-block");

    const header = document.createElement("div");
    header.className = "action-block-header";

    const stepEl = document.createElement("span");
    stepEl.className = "action-step";
    stepEl.textContent = step ? `${stepLabel} ${step}` : stepLabel;

    const toolEl = document.createElement("span");
    toolEl.className = "action-tool";
    const iconEl = document.createElement("i");
    iconEl.className = "action-icon";
    iconEl.setAttribute("data-lucide", iconForTool(tool));
    const labelEl = document.createElement("span");
    labelEl.textContent = tool || actionLabelFallback;
    toolEl.appendChild(iconEl);
    toolEl.appendChild(labelEl);

    header.appendChild(stepEl);
    header.appendChild(toolEl);

    const summary = document.createElement("div");
    summary.className = "action-summary";
    const fallback = paramsText
      ? trimForDisplay(paramsText, maxLen)
      : trimForDisplay(item, maxLen);
    summary.textContent = summarizeParams(tool, params, fallback);

    li.appendChild(header);
    li.appendChild(summary);

    const descText = slicedDescriptions[idx];
    if (descText) {
      const descEl = document.createElement("div");
      descEl.className = "action-description";
      descEl.textContent = trimForDisplay(descText, maxLen);
      li.appendChild(descEl);
    }

    target.appendChild(li);
  });

  if (window.lucide?.createIcons) {
    window.lucide.createIcons({ icons: window.lucide.icons });
  }
}

function renderContextPanel(targets, context, options = {}) {
  if (!context || !targets) return;
  const {
    goalEl,
    scratchpadEl,
    scratchpadLengthEl,
    actionListEl,
    actionCountEl,
    actionTotalEl,
  } = targets;

  const {
    high_level_goal,
    scratchpad,
    action_history = [],
    action_history_descriptions = [],
  } = context || {};

  const actionMaxItems = options.actionMaxItems ?? 6;
  const actionMaxLen = options.actionMaxLen ?? options.listMaxLen ?? 220;
  const goalPlaceholder = options.goalPlaceholder || "Waiting for goal...";
  const charsLabel = options.charsLabel || "chars";
  const actionCountSuffix = options.actionCountSuffix ?? " steps";

  goalEl && (goalEl.textContent = high_level_goal || goalPlaceholder);

  if (scratchpadEl) {
    scratchpadEl.textContent =
      scratchpad?.trim() ||
      options.scratchpadPlaceholder ||
      "Scratchpad will stream live thinking.";
  }
  if (scratchpadLengthEl) {
    scratchpadLengthEl.textContent = `${scratchpad?.length || 0} ${charsLabel}`;
  }

  if (actionCountEl) {
    actionCountEl.textContent = `${action_history.length}${actionCountSuffix}`;
  }
  if (actionTotalEl) {
    actionTotalEl.textContent = `${action_history.length}${actionCountSuffix}`;
  }

  renderActionBlocks(actionListEl, action_history, {
    actionEmptyLabel: options.actionEmptyLabel,
    actionMaxItems,
    actionMaxLen,
    listMaxLen: options.listMaxLen,
    stepLabel: options.stepLabel,
    actionLabelFallback: options.actionLabelFallback,
    actionDescriptions: action_history_descriptions,
  });
}

window.ContextHelpers = {
  trimForDisplay,
  renderContextList,
  renderActionBlocks,
  renderContextPanel,
};

const fs = require("fs");
const path = require("path");
const postcss = require("postcss");
const { execSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const STYLES_ROOT = path.join(PROJECT_ROOT, "src", "renderer", "styles");
const RENDERER_ROOT = path.join(PROJECT_ROOT, "src", "renderer");

const GENERIC_SELECTORS = new Set([
  "html",
  "body",
  ":root",
  "*",
  "a",
  "p",
  "span",
  "strong",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "button",
  "input",
  "textarea",
  "select",
  "label",
  "img",
  "svg",
  "canvas",
  "main",
  "header",
  "footer",
  "section",
  "article",
  "nav",
]);

function isGeneric(selector) {
  const trimmed = selector.trim();
  if (trimmed.includes(",")) return false;
  if (trimmed.startsWith(".") || trimmed.startsWith("#")) return false;
  if (trimmed.includes("[")) return false;
  if (trimmed.includes(":") && trimmed !== ":root") {
    return GENERIC_SELECTORS.has(trimmed);
  }
  return GENERIC_SELECTORS.has(trimmed);
}

function hoistAndMerge(css) {
  const hoistedSelectors = [];
  const mergedSelectors = new Map();
  const processed = postcss([
    (root) => {
      const genericRules = [];
      root.walkRules((rule) => {
        if (isGeneric(rule.selector)) {
          hoistedSelectors.push(rule.selector);
          genericRules.push(rule.clone());
          rule.remove();
        }
      });

      let lastImport = null;
      root.nodes?.forEach((node) => {
        if (node.type === "atrule" && node.name === "import") {
          lastImport = node;
        }
      });

      genericRules.reverse().forEach((rule, index) => {
        if (lastImport) {
          if (index === 0) {
            rule.raws.before = "\n\n";
          }
          root.insertAfter(lastImport, rule);
          lastImport = rule;
        } else {
          root.prepend(rule);
        }
      });

      const seen = new Map();
      root.walkRules((rule) => {
        if (rule.parent?.type === "atrule") return;
        const sel = rule.selector;
        if (seen.has(sel)) {
          const existing = seen.get(sel);
          const mergedCount = mergedSelectors.get(sel) || 0;
          mergedSelectors.set(sel, mergedCount + 1);
          rule.nodes.forEach((decl) => {
            existing.append(decl.clone());
          });
          rule.remove();
        } else {
          seen.set(sel, rule);
        }
      });
    },
  ])
    .process(css, { from: undefined })
    .css;
  return { css: processed, hoistedSelectors, mergedSelectors };
}

function collectCssFiles(rootPath, results = []) {
  if (!fs.existsSync(rootPath)) return results;
  const stat = fs.statSync(rootPath);
  if (stat.isFile()) {
    if (path.extname(rootPath) === ".css") {
      results.push(rootPath);
    }
    return results;
  }
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  entries.forEach((entry) => {
    const nextPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      collectCssFiles(nextPath, results);
    } else if (entry.isFile() && entry.name.endsWith(".css")) {
      results.push(nextPath);
    }
  });
  return results;
}

function collectRendererFiles(rootPath, results = []) {
  if (!fs.existsSync(rootPath)) return results;
  const stat = fs.statSync(rootPath);
  if (stat.isFile()) {
    const ext = path.extname(rootPath);
    if (ext === ".html" || ext === ".js") {
      results.push(rootPath);
    }
    return results;
  }
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  entries.forEach((entry) => {
    const nextPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      collectRendererFiles(nextPath, results);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (ext === ".html" || ext === ".js") {
        results.push(nextPath);
      }
    }
  });
  return results;
}

function buildRendererIndex() {
  const files = collectRendererFiles(RENDERER_ROOT);
  const chunks = files.map((filePath) =>
    fs.readFileSync(filePath, "utf8")
  );
  return chunks.join("\n");
}

function appendDynamicTokens(rendererIndex) {
  const dynamicTokens = [
    "bug-severity-p0",
    "bug-severity-p1",
    "bug-severity-p2",
    "bug-severity-p3",
    "pill-new",
    "pill-in_progress",
    "pill-pending_verification",
    "pill-closed",
    "pill-reopened",
    "pill-unknown",
  ];
  return `${rendererIndex}\n${dynamicTokens.join(" ")}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSelectorTokens(selector) {
  const tokens = new Set();
  const parts = selector.split(",");
  parts.forEach((part) => {
    const regex = /([.#])([A-Za-z0-9_-]+)/g;
    let match;
    while ((match = regex.exec(part)) !== null) {
      tokens.add(match[2]);
    }
  });
  return Array.from(tokens);
}

function reportUnusedSelectors(css, filePath, rendererIndex, removeUnused) {
  const root = postcss.parse(css);
  root.walkRules((rule) => {
    const selector = rule.selector;
    if (!selector) return;
    const tokens = extractSelectorTokens(selector);
    if (!tokens.length) return;
    const hasMatch = tokens.some((token) =>
      new RegExp(`\\b${escapeRegExp(token)}\\b`).test(rendererIndex)
    );
    if (!hasMatch) {
      if (removeUnused) {
        rule.remove();
        console.log(
          `Removed ${selector} in ${path.relative(
            PROJECT_ROOT,
            filePath
          )} (no renderer usage found)`
        );
      } else {
        console.log(
          `Consider removing ${selector} in ${path.relative(
            PROJECT_ROOT,
            filePath
          )} (no renderer usage found)`
        );
      }
    }
  });
  if (!removeUnused) return css;
  return root.toString();
}

function buildAtRuleContext(rule) {
  const parts = [];
  let parent = rule.parent;
  while (parent) {
    if (parent.type === "atrule") {
      const params = parent.params ? ` ${parent.params}` : "";
      parts.unshift(`@${parent.name}${params}`);
    }
    parent = parent.parent;
  }
  return parts.join(" | ");
}

function collectCrossFileSelectors(css, filePath, selectorMap) {
  const root = postcss.parse(css);
  root.walkRules((rule) => {
    const selector = rule.selector;
    if (!selector) return;
    const context = buildAtRuleContext(rule);
    const key = context ? `${context} :: ${selector}` : selector;
    let entry = selectorMap.get(key);
    if (!entry) {
      entry = { selector, context, files: new Set() };
      selectorMap.set(key, entry);
    }
    entry.files.add(filePath);
  });
}

function logCrossFileDuplicates(selectorMap) {
  const duplicates = Array.from(selectorMap.values()).filter(
    (entry) => entry.files.size > 1
  );
  if (!duplicates.length) return;
  duplicates.sort((a, b) => {
    const aKey = a.context ? `${a.context} :: ${a.selector}` : a.selector;
    const bKey = b.context ? `${b.context} :: ${b.selector}` : b.selector;
    return aKey.localeCompare(bKey);
  });
  duplicates.forEach((entry) => {
    const files = Array.from(entry.files)
      .map((filePath) => path.relative(PROJECT_ROOT, filePath))
      .sort();
    const contextLabel = entry.context ? ` within ${entry.context}` : "";
    console.log(
      `Duplicate selector "${entry.selector}"${contextLabel} in: ${files.join(
        ", "
      )}`
    );
  });
}

function isWithinDir(root, target) {
  const rel = path.relative(root, target);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function resolveTargets(arg) {
  if (!arg) return collectCssFiles(STYLES_ROOT);
  const resolved = path.resolve(PROJECT_ROOT, arg);
  if (!isWithinDir(STYLES_ROOT, resolved) && resolved !== STYLES_ROOT) {
    throw new Error(
      `Target must live under ${path.relative(PROJECT_ROOT, STYLES_ROOT)}`
    );
  }
  return collectCssFiles(resolved);
}

const target = process.argv[2];
if (!fs.existsSync(STYLES_ROOT)) {
  console.error("Missing styles directory:", STYLES_ROOT);
  process.exit(1);
}

let targets = [];
try {
  targets = resolveTargets(target);
} catch (err) {
  console.error(err?.message || String(err));
  process.exit(1);
}

if (!targets.length) {
  console.error("No CSS files found.");
  process.exit(1);
}

const fileCache = new Map();
const crossFileSelectors = new Map();
targets.forEach((filePath) => {
  const cssText = fs.readFileSync(filePath, "utf8");
  fileCache.set(filePath, cssText);
  collectCrossFileSelectors(cssText, filePath, crossFileSelectors);
});

const rendererIndex = appendDynamicTokens(buildRendererIndex());
const removeUnused =
  process.argv.includes("--remove-unused") ||
  process.env.CLEAN_CSS_REMOVE_UNUSED === "1" ||
  process.env.CLEAN_CSS_REMOVE_UNUSED === "true" ||
  process.env.npm_config_remove_unused === "1" ||
  process.env.npm_config_remove_unused === "true";

targets.forEach((filePath) => {
  const cssText = fileCache.get(filePath);
  const { css, hoistedSelectors, mergedSelectors } = hoistAndMerge(cssText);
  const cleanedCss = reportUnusedSelectors(
    css,
    filePath,
    rendererIndex,
    removeUnused
  );
  fs.writeFileSync(filePath, cleanedCss, "utf8");
  hoistedSelectors.forEach((selector) => {
    console.log(`Hoisted ${selector} in ${path.relative(PROJECT_ROOT, filePath)}`);
  });
  mergedSelectors.forEach((count, selector) => {
    console.log(
      `Merged ${count + 1} blocks for ${selector} in ${path.relative(
        PROJECT_ROOT,
        filePath
      )}`
    );
  });
  try {
    execSync(`npx prettier --write "${filePath}"`, {
      cwd: PROJECT_ROOT,
      stdio: "ignore",
    });
    console.log(`Formatted ${path.relative(PROJECT_ROOT, filePath)}`);
  } catch (err) {
    console.warn(
      `Prettier failed for ${path.relative(PROJECT_ROOT, filePath)}`
    );
  }
  console.log(`Processed ${path.relative(PROJECT_ROOT, filePath)}`);
});

logCrossFileDuplicates(crossFileSelectors);

const fs = require("fs");
const path = require("path");

const DEFAULT_LOCALES_DIR = path.join(
  __dirname,
  "..",
  "src",
  "renderer",
  "locales"
);
const DEFAULT_SCAN_ROOT = path.join(__dirname, "..", "src", "renderer");
const ALLOWED_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".html"]);
const MISSING_VALUE = "[MISSING]";
const PUNCTUATION_REPLACEMENTS = [
  ["（", " ("],
  ["）", ") "],
  ["【", " ["],
  ["】", "] "],
  ["「", " \""],
  ["」", "\" "],
  ["『", " \""],
  ["』", "\" "],
  ["《", " <"],
  ["》", "> "],
  ["：", ": "],
  ["，", ", "],
  ["？", "?"]
];

function normalizePunctuation(value) {
  if (typeof value !== "string") return value;
  let next = value;
  PUNCTUATION_REPLACEMENTS.forEach(([from, to]) => {
    next = next.split(from).join(to);
  });
  return next;
}

function collectFiles(rootPath, results = []) {
  if (!fs.existsSync(rootPath)) return results;
  const stat = fs.statSync(rootPath);
  if (stat.isFile()) {
    if (ALLOWED_EXTENSIONS.has(path.extname(rootPath))) {
      results.push(rootPath);
    }
    return results;
  }
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  entries.forEach((entry) => {
    const nextPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      collectFiles(nextPath, results);
    } else if (entry.isFile() && ALLOWED_EXTENSIONS.has(path.extname(entry.name))) {
      results.push(nextPath);
    }
  });
  return results;
}

function extractKeys(text) {
  const keys = new Set();
  const patterns = [
    /data-i18n\s*=\s*["']([^"'<>]+)["']/g,
    /\btr\s*\(\s*["']([^"'<>]+)["']/g,
    /\btranslate\s*\(\s*["']([^"'<>]+)["']/g,
    /\bI18n\.t\s*\(\s*["']([^"'<>]+)["']/g,
  ];
  const templatePatterns = [
    /\btr\s*\(\s*`([^`]+)`\s*\)/g,
    /\btranslate\s*\(\s*`([^`]+)`\s*\)/g,
    /\bI18n\.t\s*\(\s*`([^`]+)`\s*\)/g,
  ];

  patterns.forEach((pattern) => {
    let match = pattern.exec(text);
    while (match) {
      keys.add(match[1]);
      match = pattern.exec(text);
    }
  });

  templatePatterns.forEach((pattern) => {
    let match = pattern.exec(text);
    while (match) {
      const template = match[1];
      if (/toast\.language\.\$\{[^}]+\}/.test(template)) {
        keys.add("toast.language.en");
        keys.add("toast.language.zh");
      }
      if (/bugs\.status\.\$\{[^}]+\}/.test(template)) {
        [
          "new",
          "in_progress",
          "pending_verification",
          "closed",
          "reopened",
        ].forEach((key) =>
          keys.add(`bugs.status.${key}`)
        );
      }
      if (/bugs\.severity\.\$\{[^}]+\}/.test(template)) {
        ["p0", "p1", "p2", "p3"].forEach((key) =>
          keys.add(`bugs.severity.${key}`)
        );
      }
      match = pattern.exec(text);
    }
  });

  return keys;
}

function collectUsedKeys(scanRoots) {
  const usedKeys = new Set();
  const files = scanRoots.flatMap((root) => collectFiles(root));
  files.forEach((filePath) => {
    const text = fs.readFileSync(filePath, "utf8");
    extractKeys(text).forEach((key) => usedKeys.add(key));
  });
  return usedKeys;
}

function reorderI18n(i18n) {
  const entries = Object.entries(i18n);

  entries.sort(([a], [b]) => a.localeCompare(b));

  const groups = {};
  for (const [key, value] of entries) {
    const firstLevel = key.split(".")[0];
    if (!groups[firstLevel]) {
      groups[firstLevel] = [];
    }
    groups[firstLevel].push([key, value]);
  }

  const groupKeys = Object.keys(groups).sort();
  const entryLines = [];

  groupKeys.forEach((group, groupIndex) => {
    const items = groups[group];

    items.forEach(([key, value]) => {
      entryLines.push({ line: `  "${key}": ${JSON.stringify(value)}` });
    });

    if (groupIndex < groupKeys.length - 1) {
      entryLines.push({ line: "", blank: true });
    }
  });

  const lastEntryIndex = (() => {
    for (let i = entryLines.length - 1; i >= 0; i -= 1) {
      if (!entryLines[i].blank) {
        return i;
      }
    }
    return -1;
  })();

  const formattedLines = entryLines.map((entry, index) => {
    if (entry.blank) {
      return "";
    }
    const suffix = index === lastEntryIndex ? "" : ",";
    return `${entry.line}${suffix}`;
  });

  if (formattedLines.length === 0) {
    return "{\n}\n";
  }

  return `{\n${formattedLines.join("\n")}\n}\n`;
}

function listLocaleFiles(localesPath) {
  if (!fs.existsSync(localesPath)) return [];
  const stat = fs.statSync(localesPath);
  if (stat.isFile()) {
    return localesPath.endsWith(".json") ? [localesPath] : [];
  }
  return fs
    .readdirSync(localesPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(localesPath, entry.name));
}

function pruneLocaleFile(filePath, usedKeys, options) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected a JSON object in ${filePath}`);
  }

  const pruned = {};
  const missingKeys = [];

  usedKeys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      pruned[key] = normalizePunctuation(parsed[key]);
    } else {
      pruned[key] = MISSING_VALUE;
      missingKeys.push(key);
    }
  });

  const removedCount = Object.keys(parsed).filter(
    (key) => !usedKeys.has(key)
  ).length;
  if (options.dryRun) {
    return { removedCount, missingCount: missingKeys.length };
  }

  const reordered = reorderI18n(pruned);
  fs.writeFileSync(filePath, reordered, "utf8");
  return { removedCount, missingCount: missingKeys.length };
}

function parseArgs(args) {
  const options = {
    localesPath: DEFAULT_LOCALES_DIR,
    scanRoots: [],
    dryRun: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--locales") {
      options.localesPath = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--scan") {
      options.scanRoots.push(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--help") {
      options.help = true;
      continue;
    }
  }

  if (options.scanRoots.length === 0) {
    options.scanRoots = [DEFAULT_SCAN_ROOT];
  }

  return options;
}

function printUsage() {
  const lines = [
    "Usage: node scripts/clean-i18n.js [--locales path] [--scan path] [--dry-run]",
    "Defaults:",
    `  --locales ${DEFAULT_LOCALES_DIR}`,
    `  --scan ${DEFAULT_SCAN_ROOT}`,
  ];
  console.log(lines.join("\n"));
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printUsage();
  process.exit(0);
}

const usedKeys = collectUsedKeys(
  options.scanRoots.map((root) => path.resolve(process.cwd(), root))
);
const localeFiles = listLocaleFiles(
  path.resolve(process.cwd(), options.localesPath)
);

let totalRemoved = 0;
let totalMissing = 0;

localeFiles.forEach((filePath) => {
  const { removedCount, missingCount } = pruneLocaleFile(
    filePath,
    usedKeys,
    options
  );
  totalRemoved += removedCount;
  totalMissing += missingCount;
});

const actionLabel = options.dryRun ? "Would remove" : "Removed";
console.log(
  `${actionLabel} ${totalRemoved} unused keys across ${localeFiles.length} locale files.`
);
const missingLabel = options.dryRun ? "Would add" : "Added";
console.log(
  `${missingLabel} ${totalMissing} missing keys across ${localeFiles.length} locale files.`
);

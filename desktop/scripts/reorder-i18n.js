const fs = require("fs");
const path = require("path");

function reorderI18n(i18n) {
  const entries = Object.entries(i18n);

  // Sort by full key alphabetically
  entries.sort(([a], [b]) => a.localeCompare(b));

  // Group by first-level namespace
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

function resolveTargetPaths(inputPaths) {
  if (inputPaths.length === 0) {
    return [path.join(__dirname, "..", "src", "renderer", "locales")];
  }
  return inputPaths.map((input) => path.resolve(process.cwd(), input));
}

function listJsonFiles(targetPath) {
  const stat = fs.statSync(targetPath);
  if (stat.isDirectory()) {
    return fs
      .readdirSync(targetPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(targetPath, entry.name));
  }
  return [targetPath];
}

function reorderFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected a JSON object in ${filePath}`);
  }

  const reordered = reorderI18n(parsed);
  fs.writeFileSync(filePath, reordered, "utf8");
}

const args = process.argv.slice(2);
const targets = resolveTargetPaths(args);

targets.forEach((targetPath) => {
  const files = listJsonFiles(targetPath);
  files.forEach(reorderFile);
});

console.log("Reordered i18n JSON files.");

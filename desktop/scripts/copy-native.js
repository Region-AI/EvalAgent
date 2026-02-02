const path = require("path");
const { copyRecursive } = require("./utils/copy-recursive");

const src = path.join(
  __dirname,
  "..",
  "src",
  "agent",
  "capture",
  "native",
  "build",
  "Release"
);
const dest = path.join(
  __dirname,
  "..",
  "dist",
  "agent",
  "capture",
  "native",
  "build",
  "Release"
);

copyRecursive(src, dest);
console.log(`Copied native build -> ${dest}`);

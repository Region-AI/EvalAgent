const path = require("path");
const { copyRecursive } = require("./utils/copy-recursive");

const src = path.join(__dirname, "..", "src", "renderer");
const dest = path.join(__dirname, "..", "dist", "renderer");

copyRecursive(src, dest);
console.log(`Copied renderer assets -> ${dest}`);

const path = require("path");

const root = globalThis;
root.window = root;
root.I18n = {
  t: (key, vars) => {
    if (!vars) return key;
    const pairs = Object.entries(vars)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return `${key}(${pairs})`;
  },
};
root.__appTr = (key) => key;

require(path.join(__dirname, "..", "src", "renderer", "shared", "modal-intents.js"));

const intents = root.ModalIntents || {};

const specs = {
  confirmDeleteApp: intents.confirmDeleteApp
    ? intents.confirmDeleteApp({ appName: "Example App", onConfirm: null })
    : null,
  confirmDeleteVersion: intents.confirmDeleteVersion
    ? intents.confirmDeleteVersion({ versionLabel: "1.0.0", onConfirm: null })
    : null,
  confirmDeleteBug: intents.confirmDeleteBug
    ? intents.confirmDeleteBug({ bugTitle: "Broken button", onConfirm: null })
    : null,
  confirmDeleteFix: intents.confirmDeleteFix
    ? intents.confirmDeleteFix({ onConfirm: null })
    : null,
  confirmDeleteTestCase: intents.confirmDeleteTestCase
    ? intents.confirmDeleteTestCase({ onConfirm: null })
    : null,
  confirmResetExecutor: intents.confirmResetExecutor
    ? intents.confirmResetExecutor({ onConfirm: null })
    : null,
};

process.stdout.write(`${JSON.stringify(specs, null, 2)}\n`);

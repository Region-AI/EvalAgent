(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const tr = (key, vars) =>
    root.I18n?.t?.(key, vars) ?? (root.__appTr || ((k) => k))(key, vars);

  const normalizeActions = (actions) =>
    Array.isArray(actions) ? actions.filter(Boolean) : [];

  const makeSpec = ({ id, kind, intent, category, title, body, actions }) => ({
    id,
    kind,
    intent,
    category,
    title,
    body,
    actions: normalizeActions(actions),
  });

  const confirmDelete = ({
    id,
    intent,
    category,
    title,
    body,
    confirmLabel,
    onConfirm,
  }) =>
    makeSpec({
      id,
      kind: "confirm",
      intent,
      category,
      title,
      body,
      actions: [
        {
          id: "confirm",
          label: confirmLabel,
          kind: "danger",
          handler: onConfirm,
        },
        {
          id: "cancel",
          label: tr("modal.cancel"),
          kind: "secondary",
        },
      ],
    });

  const confirmDeleteApp = ({ appName, onConfirm }) =>
    confirmDelete({
      id: "confirm-delete-app",
      intent: "confirmDeleteApp",
      category: tr("apps.delete.title"),
      title: tr("apps.delete.confirmTitle", {
        name: appName || tr("history.app.unknown"),
      }),
      body: tr("apps.delete.body"),
      confirmLabel: tr("apps.delete.confirm"),
      onConfirm,
    });

  const confirmDeleteVersion = ({ versionLabel, onConfirm }) =>
    confirmDelete({
      id: "confirm-delete-version",
      intent: "confirmDeleteVersion",
      category: tr("apps.version.delete.title"),
      title: tr("apps.version.delete.confirmTitle", {
        version: versionLabel || "--",
      }),
      body: tr("apps.version.delete.body"),
      confirmLabel: tr("apps.version.delete.confirm"),
      onConfirm,
    });

  const confirmDeleteBug = ({ bugTitle, onConfirm }) =>
    confirmDelete({
      id: "confirm-delete-bug",
      intent: "confirmDeleteBug",
      category: tr("bugs.delete.title"),
      title: tr("bugs.delete.confirmTitle", {
        name: bugTitle || tr("bugs.modal.eyebrow"),
      }),
      body: tr("bugs.delete.body"),
      confirmLabel: tr("bugs.delete.confirm"),
      onConfirm,
    });

  const confirmDeleteFix = ({ onConfirm }) =>
    confirmDelete({
      id: "confirm-delete-fix",
      intent: "confirmDeleteFix",
      category: tr("bugs.fix.delete.title"),
      title: tr("bugs.fix.delete.confirmTitle"),
      body: tr("bugs.fix.delete.body"),
      confirmLabel: tr("bugs.fix.delete.confirm"),
      onConfirm,
    });

  const confirmDeleteTestCase = ({ onConfirm }) =>
    confirmDelete({
      id: "confirm-delete-testcase",
      intent: "confirmDeleteTestCase",
      category: tr("testcase.delete.title"),
      title: tr("testcase.delete.confirmTitle"),
      body: tr("testcase.delete.body"),
      confirmLabel: tr("testcase.delete.confirm"),
      onConfirm,
    });

  const confirmResetExecutor = ({ onConfirm }) =>
    confirmDelete({
      id: "confirm-reset-executor",
      intent: "confirmResetExecutor",
      category: tr("settings.executor.reset.title"),
      title: tr("settings.executor.reset.confirm"),
      body: tr("settings.executor.reset.desc"),
      confirmLabel: tr("settings.executor.reset.confirm"),
      onConfirm,
    });

  root.ModalIntents = {
    confirmDeleteApp,
    confirmDeleteVersion,
    confirmDeleteBug,
    confirmDeleteFix,
    confirmDeleteTestCase,
    confirmResetExecutor,
  };
})();

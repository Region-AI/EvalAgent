export const MODAL_REGISTRY = {
  confirmModal: {
    type: "confirm",
    specDriven: true,
    notes: "ConfirmModal + ModalIntents",
  },
  exitEditModal: {
    type: "confirm",
    specDriven: false,
    actions: 3,
    notes: "Needs tertiary action support",
  },
  testCaseModal: { type: "form" },
  settingsModal: { type: "info" },
  submitAppModal: { type: "form" },
  addVersionModal: { type: "form" },
  editVersionModal: { type: "form" },
  bugModal: { type: "form" },
  bugOccurrenceModal: { type: "form" },
  bugFixModal: { type: "form" },
  taskModal: { type: "wizard" },
};

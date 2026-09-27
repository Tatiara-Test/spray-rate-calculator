import { getStorage, transactStorage } from "./durable-storage.mjs";
import { SPRAY_TEMPLATE } from "./spray-template.mjs";
import { mountSprayPreferencesUI } from "./spray-preferences-ui.mjs";
import { equipmentSnapshot, normalizeEquipmentSnapshot } from "./spray-preferences.mjs";
import { CALCULATOR_DRAFT_KEY, inspectCalculatorDraft, persistCalculatorDraft, removeRecovery, recordRecoveryContext, canResumeCalculatorDraft,
  inspectTankRecovery, deleteTankWithRecovery, restoreDeletedTank, filterPaddocksByName } from "./spray-recovery.mjs";
import {
  MACHINES,
  PADDOCK_LIBRARY_VERSION,
  PADDOCK_STORE_VERSION,
  PADDOCKS_KEY,
  PROPERTY_SETTINGS_KEY,
  PROFILE_VERSION,
  ensurePaddockLibrarySeeded,
  inspectPaddockLibraryStore,
  inspectPaddockStore,
  inspectProfileStore,
  normalizePaddockStore,
  persistPaddockLibrary,
  persistPaddockStore,
  persistProfile,
} from "./storage.mjs";
import {
  activeLibraryEntries,
  createLibraryEntry,
  createSelectedPaddockSnapshot,
  findLibraryEntryById,
  findLibraryEntryByName,
  updateLibraryEntry,
} from "./paddock-library.mjs";
import { calculatePaddockBalance } from "./paddock-balance.mjs";
import { renderPaddockRunningSummary } from "./paddock-running-summary.mjs";
import {
  MAX_ACTIVE_PADDOCKS,
  activePaddocks,
  archivedPaddocks,
  canRestorePaddock,
  findNamedPaddock,
  isArchivedPaddock,
  isCompletedPaddock,
  transitionPaddockCompletion,
  paddockCompletionBlockReason,
  transitionPaddockArchive,
} from "./paddock-lifecycle.mjs";
import {
  SPRAY_METHODS,
  addRunAllocation,
  addRunLitresAllocation,
  correctRunLitresAllocation,
  allowedSprayMethods,
  cancelEmptyPaddockRun,
  completePaddockRun,
  createPaddockRun,
  materializeRunAllocations,
  validateControllerStartAgainstMix,
} from "./paddock-runs.mjs";
import {
  buildExportFilenames,
  buildPaddockCsv,
  buildPaddockPdf,
  exportDescriptor,
  missingShareMetadata,
} from "./paddock-export.mjs";
import { handFilesToShareSheet } from "./share-files.mjs";
import { saveFileCopy } from "./native-files.mjs";
import { loadPropertySettings, propertyIdentitySnapshot } from "./property-settings.mjs";
import {
  cleanChemicalName,
  firstIncompleteProductRow,
  normalizeChemicalName,
  productDisplayName,
  snapshotProducts,
  usedCalculatorProducts,
} from "./product-records.mjs";

export async function mountSprayApp(host, options = {}) {
const root = host.shadowRoot || host.attachShadow({ mode: "open" });
root.innerHTML = SPRAY_TEMPLATE;
const browserDocument = globalThis.document;
const document = {
  querySelector: (selector) => root.querySelector(selector),
  querySelectorAll: (selector) => root.querySelectorAll(selector),
  createElement: (...args) => browserDocument.createElement(...args),
  addEventListener: (...args) => root.addEventListener(...args),
  body: root,
};

let operationBusy = false;
async function durableWrite(callback) {
  if (operationBusy) throw new Error("A save is already in progress.");
  operationBusy = true;
  host.setAttribute("aria-busy", "true");
  const controls = [...root.querySelectorAll("input, select, textarea, button")];
  const disabled = controls.map(control => control.disabled);
  controls.forEach(control => { control.disabled = true; });
  try { return await transactStorage(callback); }
  finally {
    controls.forEach((control, index) => { control.disabled = disabled[index]; });
    operationBusy = false;
    host.setAttribute("aria-busy", "false");
  }
}
for (const type of ["click", "submit", "cancel"]) root.addEventListener(type, event => {
  if (!operationBusy) return;
  event.preventDefault(); event.stopImmediatePropagation();
}, true);

function currentPropertySnapshot() {
  try { return propertyIdentitySnapshot(loadPropertySettings(getStorage(), PROPERTY_SETTINGS_KEY)); }
  catch { return propertyIdentitySnapshot(); }
}

const STORAGE_KEY = PADDOCKS_KEY;
const MAX_PADDOCKS = MAX_ACTIVE_PADDOCKS;
const QUICK_RATES = [60, 80, 90, 100];
const UNIT_LABELS = {
  l_ha: "L/ha",
  ml_ha: "mL/ha",
  g_ha: "g/ha",
  kg_ha: "kg/ha",
  ml_100: "mL/100 L",
  kg_100: "kg/100 L",
};

const mixVolumeInput = document.querySelector("#mix-volume");
const sprayRateInput = document.querySelector("#spray-rate");
const coverage = document.querySelector("#coverage");
const coverageResult = document.querySelector("#coverage-result");
const volumeError = document.querySelector("#volume-error");
const productList = document.querySelector("#product-list");
const productNameError = document.querySelector("#product-name-error");
const productTemplate = document.querySelector("#product-template");
const addProductButton = document.querySelector("#add-product");
const saveRecordButton = document.querySelector("#save-record-button");
const clearButton = document.querySelector("#clear-button");
let preferencesUI = null;
const viewButtons = [...document.querySelectorAll("[data-view-button]")];
const viewPanels = [...document.querySelectorAll("[data-view-panel]")];
const paddockList = document.querySelector("#paddock-list");
const paddockEmpty = document.querySelector("#paddock-empty");
const paddockCount = document.querySelector("#paddock-count");
const archivedPaddockSection = document.querySelector("#archived-paddocks");
const archivedPaddockSummary = document.querySelector("#archived-paddocks-summary");
const archivedPaddockList = document.querySelector("#archived-paddock-list");
const editBanner = document.querySelector("#edit-banner");
const editTitle = document.querySelector("#edit-title");
const cancelEditButton = document.querySelector("#cancel-edit");
const saveDialog = document.querySelector("#save-dialog");
const saveForm = document.querySelector("#save-form");
const saveDialogTitle = document.querySelector("#save-dialog-title");
const saveLibraryPaddock = document.querySelector("#save-library-paddock");
const saveNewPaddockFields = document.querySelector("#save-new-paddock-fields");
const savePaddockName = document.querySelector("#save-paddock-name");
const savePaddockSize = document.querySelector("#save-paddock-size");
const savePaddockTotal = document.querySelector("#save-paddock-total");
const savePlannedHectares = document.querySelector("#save-planned-hectares");
const saveSprayDate = document.querySelector("#save-spray-date");
const saveTankTotal = document.querySelector("#save-tank-total");
const saveSprayRate = document.querySelector("#save-spray-rate");
const saveArea = document.querySelector("#save-area");
const saveProductList = document.querySelector("#save-product-list");
const saveError = document.querySelector("#save-error");
const confirmSaveButton = document.querySelector("#confirm-save");
const chemicalSuggestions = document.querySelector("#chemical-suggestions");
const toast = document.querySelector("#toast");
const storageLockWarning = document.querySelector("#storage-lock-warning");
const storageLockTitle = document.querySelector("#storage-lock-title");
const storageLockMessage = document.querySelector("#storage-lock-message");
const downloadOriginalRecordsButton = document.querySelector("#download-original-records");
const profileLockWarning = document.querySelector("#profile-lock-warning");
const profileLockTitle = document.querySelector("#profile-lock-title");
const profileLockMessage = document.querySelector("#profile-lock-message");
const downloadOriginalProfileButton = document.querySelector("#download-original-profile");
const libraryLockWarning = document.querySelector("#library-lock-warning");
const libraryLockTitle = document.querySelector("#library-lock-title");
const libraryLockMessage = document.querySelector("#library-lock-message");
const writeRecoveryWarning = document.querySelector("#write-recovery-warning");
const retryRecordSaveButton = document.querySelector("#retry-record-save");
const downloadUnsavedRecordsButton = document.querySelector("#download-unsaved-records");
const saveOperator = document.querySelector("#save-operator");
const saveMachine = document.querySelector("#save-machine");
const saveSprayMethod = document.querySelector("#save-spray-method");
const sprayMethodNote = document.querySelector("#spray-method-note");
const operatorFirstHint = document.querySelector("#operator-first-hint");
const operatorProfileName = document.querySelector("#operator-profile-name");
const changeOperatorButton = document.querySelector("#change-operator");
const paddockStorageStatus = document.querySelector("#paddock-storage-status");
const shareReviewDialog = document.querySelector("#share-review-dialog");
const shareReviewForm = document.querySelector("#share-review-form");
const shareReviewList = document.querySelector("#share-review-list");
const shareReviewError = document.querySelector("#share-review-error");
const downloadDialog = document.querySelector("#download-dialog");
const downloadDialogMessage = document.querySelector("#download-dialog-message");
const sharePaddockPdfButton = document.querySelector("#share-paddock-pdf");
const sharePaddockCsvButton = document.querySelector("#share-paddock-csv");
const downloadPdfButton = document.querySelector("#download-pdf");
const downloadCsvButton = document.querySelector("#download-csv");
const startRunFromCalculatorButton = document.querySelector("#start-run-from-calculator");
const openRunDialogButton = document.querySelector("#open-run-dialog");
const runEmptyCard = document.querySelector("#run-empty-card");
const runCalculationStatus = document.querySelector("#run-calculation-status");
const activeRunCard = document.querySelector("#active-run-card");
const activeRunTitle = document.querySelector("#active-run-title");
const activeRunMethod = document.querySelector("#active-run-method");
const activeRunMeta = document.querySelector("#active-run-meta");
const runAllocationForm = document.querySelector("#run-allocation-form");
const runPaddockName = document.querySelector("#run-paddock-name");
const runPaddockSize = document.querySelector("#run-paddock-size");
const runSelectedPlan = document.querySelector("#run-selected-plan");
const runControllerBefore = document.querySelector("#run-controller-before");
const runControllerAfter = document.querySelector("#run-controller-after");
const runAllocationPreview = document.querySelector("#run-allocation-preview");
const runAllocationError = document.querySelector("#run-allocation-error");
const runAllocationList = document.querySelector("#run-allocation-list");
const finishRunButton = document.querySelector("#finish-run");
const cancelEmptyRunButton = document.querySelector("#cancel-empty-run");
const runStartDialog = document.querySelector("#run-start-dialog");
const runStartForm = document.querySelector("#run-start-form");
const runDate = document.querySelector("#run-date");
const runControllerStart = document.querySelector("#run-controller-start");
const runOperator = document.querySelector("#run-operator");
const runMachine = document.querySelector("#run-machine");
const runSprayMethod = document.querySelector("#run-spray-method");
const runMethodNote = document.querySelector("#run-method-note");
const runMixTotal = document.querySelector("#run-mix-total");
const runSprayRate = document.querySelector("#run-spray-rate");
const runProductCount = document.querySelector("#run-product-count");
const runStartError = document.querySelector("#run-start-error");
const confirmStartRun = document.querySelector("#confirm-start-run");
const runStartLibraryPaddock = document.querySelector("#run-start-library-paddock");
const runStartPlannedHectares = document.querySelector("#run-start-planned-hectares");
const runStartNewPaddockFields = document.querySelector("#run-start-new-paddock-fields");
const runStartNewPaddockName = document.querySelector("#run-start-new-paddock-name");
const runStartNewPaddockTotal = document.querySelector("#run-start-new-paddock-total");
const runStartAddPaddock = document.querySelector("#run-start-add-paddock");
const runStartSelectedPaddocks = document.querySelector("#run-start-selected-paddocks");
const runStartPaddockError = document.querySelector("#run-start-paddock-error");
const activeRunLibraryPaddock = document.querySelector("#active-run-library-paddock");
const activeRunPlannedHectares = document.querySelector("#active-run-planned-hectares");
const activeRunNewPaddockFields = document.querySelector("#active-run-new-paddock-fields");
const activeRunNewPaddockName = document.querySelector("#active-run-new-paddock-name");
const activeRunNewPaddockTotal = document.querySelector("#active-run-new-paddock-total");
const activeRunAddPaddock = document.querySelector("#active-run-add-paddock");
const activeRunSelectedPaddocks = document.querySelector("#active-run-selected-paddocks");
const activeRunPaddockError = document.querySelector("#active-run-paddock-error");

let visibleProducts = 1;
let draftReady = false;
let pendingDraft = inspectCalculatorDraft(getStorage());
let lastDraftSignature = null;
let lastSavedPaddockId = null;
let lastSavedTankId = null;
let paddockDetailsContext = null;
let bufferCorrectionContext = null;
let finishBufferContext = null;
let pendingTankSave = null;
const draftRecovery = document.querySelector("#draft-recovery");
const draftStatus = document.querySelector("#draft-status");
const draftWarning = document.querySelector("#draft-warning");
const savedTankActions = document.querySelector("#saved-tank-actions");
const paddockSearch = document.querySelector("#find-paddock");
let expandedPaddockId = null;
let editingNoteId = null;
let editingTankContext = null;
let toastTimer = null;
const storeInspection = inspectStore();
let storageWriteLocked = ["corrupt", "future"].includes(storeInspection.status);
let recoveryWriteUncertain = false;
let store = storeInspection.status === "ready"
  ? storeInspection.value
  : {
      version: PADDOCK_STORE_VERSION,
      paddocks: [],
      lastPaddockId: null,
      runs: [],
      activeRunId: null,
    };
let librarySeedResult = { status: "absent", value: null, seededCount: 0 };
if (storeInspection.status === "ready") {
  try {
    librarySeedResult = await transactStorage(storage => ensurePaddockLibrarySeeded(store, storage));
  } catch (error) {
    librarySeedResult = { status: "error", value: null, error };
  }
}
let libraryInspection = inspectPaddockLibraryStore(getStorage());
let libraryWriteLocked = ["corrupt", "future"].includes(libraryInspection.status)
  || (librarySeedResult.status === "error" && libraryInspection.status !== "ready");
let paddockLibrary = libraryInspection.status === "ready"
  ? libraryInspection.value
  : { version: PADDOCK_LIBRARY_VERSION, entries: [] };
let profileInspection = inspectProfile();
let profileWriteLocked = ["corrupt", "future"].includes(profileInspection.status);
let profile = profileInspection.status === "ready"
  ? profileInspection.value
  : { version: PROFILE_VERSION, operator: null, operatorPrompted: false, lastMachine: MACHINES[0] };
let pendingReview = null;
let pendingDownloads = null;
let pendingFileAction = false;
let pendingRunSelections = [];
const pendingPersistence = { records: false, profile: false, library: false };

function hasExternalUnsavedLibraryChanges() {
  try {
    return options.hasExternalUnsavedLibraryChanges?.() === true;
  } catch {
    return true;
  }
}

function libraryMutationLocked() {
  return libraryWriteLocked || hasExternalUnsavedLibraryChanges();
}

const twoDecimals = new Intl.NumberFormat("en-AU", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

const wholeNumber = new Intl.NumberFormat("en-AU", {
  maximumFractionDigits: 0,
});

const exportNumber = new Intl.NumberFormat("en-AU", {
  maximumFractionDigits: 6,
  useGrouping: false,
});

function inspectStore() {
  try {
    return inspectPaddockStore(getStorage());
  } catch (error) {
    return { status: "corrupt", value: null, raw: null, error };
  }
}

function inspectProfile() {
  try {
    return inspectProfileStore(getStorage());
  } catch (error) {
    return { status: "corrupt", value: null, raw: null, error };
  }
}

function renderStorageWarnings() {
  storageLockWarning.hidden = !storageWriteLocked;
  if (storageWriteLocked) {
    const newer = storeInspection.status === "future";
    storageLockTitle.textContent = newer
      ? "Newer paddock records protected"
      : "Unreadable paddock records protected";
    storageLockMessage.textContent = newer
      ? "These records were created by a newer app version. Saving is locked so the original data cannot be overwritten."
      : "These records could not be read. Saving is locked and the original stored data has been left untouched.";
    downloadOriginalRecordsButton.disabled = typeof storeInspection.raw !== "string";
    if (recoveryWriteUncertain) {
      storageLockTitle.textContent = "Reload to check tank recovery";
      storageLockMessage.textContent = "A recovery write could not be verified. Further record writes are locked. Close and reopen the app to check the saved state; the recovery copy has been retained.";
      downloadOriginalRecordsButton.disabled = true;
    }
  }
  profileLockWarning.hidden = !profileWriteLocked;
  if (profileWriteLocked) {
    const newer = profileInspection.status === "future";
    profileLockTitle.textContent = newer
      ? "Newer operator profile protected"
      : "Unreadable operator profile protected";
    profileLockMessage.textContent = newer
      ? "This device profile was created by a newer app version. Profile changes are locked, but tank records can still be saved with their own operator and machine details."
      : "This device profile could not be read. It remains untouched; tank records can still be saved with their own operator and machine details.";
    downloadOriginalProfileButton.disabled = typeof profileInspection.raw !== "string";
  }
  libraryLockWarning.hidden = !libraryWriteLocked;
  if (libraryWriteLocked) {
    const seedFailed = librarySeedResult.status === "error" && libraryInspection.status !== "ready";
    libraryLockTitle.textContent = seedFailed
      ? "Paddock Library could not be started"
      : "Paddock Library protected";
    libraryLockMessage.textContent = seedFailed
      ? "Existing paddock history was left unchanged. Open Settings to retry the first-use Library setup before adding a new paddock."
      : "The saved Paddock Library needs review in Settings and will not be overwritten from Spray Operations.";
  }
  writeRecoveryWarning.hidden = !pendingPersistence.records
    && !pendingPersistence.profile
    && !pendingPersistence.library;
  paddockStorageStatus.textContent = pendingPersistence.records || pendingPersistence.library
    ? "Recent changes are not saved on this device"
    : "Saved in this browser only";
}

function markPersistenceFailure(kind) {
  pendingPersistence[kind] = true;
  renderStorageWarnings();
}

async function persistStore() {
  if (storageWriteLocked) {
    renderStorageWarnings();
    storageLockWarning.focus();
    return false;
  }
  try {
    const snapshot = structuredClone(store);
    const completion = pendingTankSave;
    if (completion) completion.draftCleared = false;
    await durableWrite(storage => {
      persistPaddockStore(snapshot, storage);
      if (completion && tankSaveInputSignature() === completion.inputSignature) {
        const draft = inspectCalculatorDraft(storage);
        const signature = draft.status === "ready" ? JSON.stringify({
          mixVolume: draft.value.mixVolume, sprayRate: draft.value.sprayRate, products: draft.value.products,
        }) : null;
        if (storage.getItem(CALCULATOR_DRAFT_KEY) === completion.draftRaw || signature === completion.inputSignature) {
          removeRecovery(CALCULATOR_DRAFT_KEY, storage);
          completion.draftCleared = true;
        }
      }
    });
  } catch {
    markPersistenceFailure("records");
    return false;
  }
  pendingPersistence.records = false;
  renderStorageWarnings();
  // Every successful store write commits the pending tank, including a note
  // save or Buffer action that reaches this writer before Retry saving.
  const completion = pendingTankSave;
  pendingTankSave = null;
  if (completion) {
    try { finalizeTankSave(completion); }
    catch { warnDraft("The tank was saved, but draft finalisation could not be confirmed. Check saved records before resuming an old draft."); }
  }
  return true;
}

async function persistOperatorProfile() {
  if (profileWriteLocked) {
    renderStorageWarnings();
    profileLockWarning.focus();
    return false;
  }
  try {
    const snapshot = structuredClone(profile);
    await durableWrite(storage => persistProfile(snapshot, storage));
    pendingPersistence.profile = false;
    renderOperatorProfile();
    renderStorageWarnings();
    return true;
  } catch (error) {
    if (error?.code === "PROTECTED_EXISTING_DATA" && error.inspection) {
      profileInspection = error.inspection;
      profileWriteLocked = true;
    }
    markPersistenceFailure("profile");
    renderOperatorProfile();
    return false;
  }
}

function renderOperatorProfile() {
  operatorProfileName.textContent = profileWriteLocked ? "Profile protected" : profile.operator || "Not set";
  changeOperatorButton.disabled = profileWriteLocked;
}

function bumpContentRevision(paddock) {
  paddock.contentRevision = Math.max(1, Number(paddock.contentRevision) || 1) + 1;
  paddock.updatedAt = new Date().toISOString();
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeName(value) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-AU");
}

function cleanName(value) {
  return value.trim().replace(/\s+/g, " ");
}

function optionalPositiveValue(field) {
  if (!field || field.value === "") return null;
  const value = Number(field.value);
  return Number.isFinite(value) && value > 0 ? value : NaN;
}

const NEW_LIBRARY_ENTRY = "__new__";
const HISTORY_PADDOCK_PREFIX = "history:";

function formatOptionalHectares(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0
    ? `${twoDecimals.format(Number(value))} ha`
    : "Not set";
}

function refreshPaddockLibrary() {
  if (pendingPersistence.library) {
    return { status: "pending", value: paddockLibrary, raw: null };
  }
  libraryInspection = inspectPaddockLibraryStore(getStorage());
  libraryWriteLocked = ["corrupt", "future"].includes(libraryInspection.status)
    || (librarySeedResult.status === "error" && libraryInspection.status !== "ready");
  paddockLibrary = libraryInspection.status === "ready"
    ? libraryInspection.value
    : { version: PADDOCK_LIBRARY_VERSION, entries: [] };
  refreshSuggestions();
  if (getActiveRun()) renderRunView();
  return libraryInspection;
}

async function persistLibrary(nextLibrary) {
  if (hasExternalUnsavedLibraryChanges()) {
    renderStorageWarnings();
    return false;
  }
  paddockLibrary = nextLibrary;
  try {
    const snapshot = structuredClone(paddockLibrary);
    await durableWrite(storage => persistPaddockLibrary(snapshot, storage));
    libraryInspection = { status: "ready", value: paddockLibrary, raw: JSON.stringify(paddockLibrary) };
    libraryWriteLocked = false;
    pendingPersistence.library = false;
    renderStorageWarnings();
    return true;
  } catch (error) {
    if (error?.code === "PROTECTED_EXISTING_DATA" && error.inspection) {
      libraryInspection = error.inspection;
      libraryWriteLocked = true;
    }
    markPersistenceFailure("library");
    return false;
  }
}

function addSelectOption(select, value, label, { selected = false, disabled = false } = {}) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  option.selected = selected;
  option.disabled = disabled;
  select.append(option);
  return option;
}

function populateLibrarySelect(select, {
  selectedId = "",
  allowNew = true,
  includeHistoryFallback = false,
  excludeIds = [],
} = {}) {
  const excluded = new Set(excludeIds);
  select.replaceChildren();
  const placeholder = hasExternalUnsavedLibraryChanges()
    ? "Settings has an unsaved Paddock Library change"
    : libraryWriteLocked
      ? "Paddock Library needs review in Settings"
      : "Select a saved paddock";
  addSelectOption(select, "", placeholder, {
    selected: !selectedId,
  });
  select.disabled = hasExternalUnsavedLibraryChanges();
  const entries = activeLibraryEntries(paddockLibrary)
    .filter((entry) => !excluded.has(entry.id))
    .sort((left, right) => left.name.localeCompare(right.name));
  const selectedEntry = selectedId ? findLibraryEntryById(paddockLibrary, selectedId) : null;
  if (selectedEntry?.archivedAt && !excluded.has(selectedEntry.id)) entries.unshift(selectedEntry);
  for (const entry of entries) {
    addSelectOption(
      select,
      entry.id,
      `${entry.name}${entry.archivedAt ? " (archived snapshot)" : entry.totalHectares ? ` · ${twoDecimals.format(entry.totalHectares)} ha` : ""}`,
      { selected: entry.id === selectedId },
    );
  }
  if (includeHistoryFallback && libraryInspection.status !== "ready") {
    for (const paddock of activePaddocks(store.paddocks).sort((left, right) => left.name.localeCompare(right.name))) {
      const value = `${HISTORY_PADDOCK_PREFIX}${paddock.id}`;
      addSelectOption(select, value, `${paddock.name} · existing history`, { selected: value === selectedId });
    }
  }
  if (allowNew && !libraryMutationLocked()) {
    addSelectOption(select, NEW_LIBRARY_ENTRY, "Add new paddock…", { selected: selectedId === NEW_LIBRARY_ENTRY });
  }
}

function setNewPaddockFields(select, fields) {
  fields.hidden = select.value !== NEW_LIBRARY_ENTRY;
}

function libraryEntryFromSelection(select) {
  if (!select?.value || select.value === NEW_LIBRARY_ENTRY || select.value.startsWith(HISTORY_PADDOCK_PREFIX)) return null;
  return findLibraryEntryById(paddockLibrary, select.value);
}

async function createOperationalLibraryEntry(nameField, totalField, errorElement) {
  if (hasExternalUnsavedLibraryChanges()) {
    errorElement.textContent = "Resolve the unsaved Paddock Library change in Settings before adding another paddock here.";
    errorElement.hidden = false;
    return null;
  }
  const name = cleanName(nameField.value);
  const totalHectares = optionalPositiveValue(totalField);
  if (!name || Number.isNaN(totalHectares)) {
    errorElement.textContent = Number.isNaN(totalHectares)
      ? "Saved total hectares must be blank or greater than zero."
      : "Enter a name for the new paddock.";
    errorElement.hidden = false;
    return null;
  }
  const existing = findLibraryEntryByName(paddockLibrary, name, { includeArchived: true });
  if (existing) {
    errorElement.textContent = existing.archivedAt
      ? `${existing.name} is archived in Settings. Restore it there before selecting it for a new job.`
      : `${existing.name} is already saved. Select it from the paddock list.`;
    errorElement.hidden = false;
    return null;
  }
  try {
    const entry = createLibraryEntry({ name, totalHectares });
    const nextLibrary = {
      version: PADDOCK_LIBRARY_VERSION,
      entries: [...paddockLibrary.entries, entry],
    };
    if (!(await persistLibrary(nextLibrary))) {
      errorElement.textContent = "The new paddock could not be verified on this phone. Nothing was added to the spray job.";
      errorElement.hidden = false;
      return null;
    }
    return entry;
  } catch (error) {
    errorElement.textContent = error?.message || "The new paddock is not valid.";
    errorElement.hidden = false;
    return null;
  }
}

async function resolveOperationalSelection({
  select,
  plannedField,
  newNameField,
  newTotalField,
  errorElement,
  allowHistoryFallback = false,
}) {
  const plannedHectares = optionalPositiveValue(plannedField);
  if (Number.isNaN(plannedHectares)) {
    errorElement.textContent = "Planned hectares must be blank or greater than zero.";
    errorElement.hidden = false;
    return null;
  }
  if (allowHistoryFallback && select.value.startsWith(HISTORY_PADDOCK_PREFIX)) {
    const paddock = findPaddock(select.value.slice(HISTORY_PADDOCK_PREFIX.length));
    return paddock ? {
      entry: null,
      name: paddock.name,
      totalHectares: paddock.sizeHectares,
      plannedHectares,
      snapshot: null,
    } : null;
  }
  const entry = select.value === NEW_LIBRARY_ENTRY
    ? (await createOperationalLibraryEntry(newNameField, newTotalField, errorElement))
    : libraryEntryFromSelection(select);
  if (!entry) {
    if (errorElement.hidden) {
      errorElement.textContent = "Select a saved paddock or add a new one.";
      errorElement.hidden = false;
    }
    return null;
  }
  return {
    entry,
    name: entry.name,
    totalHectares: entry.totalHectares,
    plannedHectares,
    snapshot: createSelectedPaddockSnapshot(entry, plannedHectares),
  };
}

function updateMethodOptions(machineField, methodField, noteField) {
  const snapshot = selectedEquipment(machineField);
  const permitted = snapshot ? allowedSprayMethods(snapshot.name, snapshot) : [];
  [...methodField.options].forEach((option) => {
    option.disabled = !permitted.includes(option.value);
  });
  if (!permitted.includes(methodField.value)) methodField.value = permitted[0] || "";
  noteField.textContent = methodField.value === "Camera"
    ? "Camera records liquid and product allocation only; no whole-paddock hectares."
    : "Broadacre records treated hectares.";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function todayLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(date) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date || "Date not recorded";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function formatTime(dateTime) {
  const parsed = new Date(dateTime);
  if (Number.isNaN(parsed.getTime())) return "time not recorded";
  return new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function calculateHectares(litres, sprayRate) {
  return litres / sprayRate;
}

function calculateProductAmount(productRate, unit, litres, sprayRate) {
  const factor = unit.endsWith("_ha")
    ? calculateHectares(litres, sprayRate)
    : litres / 100;
  return productRate * factor;
}

function practicalAmount(amount, kind) {
  if (kind === "ml") {
    return amount >= 1000
      ? { value: amount / 1000, unit: "litres", shortUnit: "L", whole: false }
      : { value: amount, unit: "millilitres", shortUnit: "mL", whole: true };
  }
  return amount >= 1000
    ? { value: amount / 1000, unit: "kilograms", shortUnit: "kg", whole: false }
    : { value: amount, unit: "grams", shortUnit: "g", whole: true };
}

function formatPracticalAmount(amount, kind, fullUnit = true) {
  const practical = practicalAmount(amount, kind);
  const value = practical.whole
    ? wholeNumber.format(practical.value)
    : twoDecimals.format(practical.value);
  return `${value} ${fullUnit ? practical.unit : practical.shortUnit}`;
}

function formatSignedPracticalAmount(amount, kind) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return "Unavailable";
  const sign = Math.abs(numeric) <= 0.5 ? "" : numeric > 0 ? "+" : "−";
  return `${sign}${formatPracticalAmount(Math.abs(numeric), kind, false)}`;
}

function formatSignedHectares(amount) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return "Unavailable";
  const sign = Math.abs(numeric) <= 0.005 ? "" : numeric > 0 ? "+" : "−";
  return `${sign}${twoDecimals.format(Math.abs(numeric))} ha`;
}

function formatAmount(productRate, unit, litres, sprayRate, fullUnit = true) {
  const amount = calculateProductAmount(productRate, unit, litres, sprayRate);
  const kind = unit.startsWith("l_") || unit.startsWith("ml_") ? "ml" : "g";
  const baseAmount = unit.startsWith("l_") || unit.startsWith("kg_")
    ? amount * 1000
    : amount;
  return formatPracticalAmount(baseAmount, kind, fullUnit);
}

function canonicalAmount(productRate, unit, litres, sprayRate) {
  const amount = calculateProductAmount(productRate, unit, litres, sprayRate);
  if (unit.startsWith("l_")) return { amountBase: amount * 1000, baseUnit: "ml" };
  if (unit.startsWith("ml_")) return { amountBase: amount, baseUnit: "ml" };
  if (unit.startsWith("kg_")) return { amountBase: amount * 1000, baseUnit: "g" };
  return { amountBase: amount, baseUnit: "g" };
}

function addProductRow() {
  const index = productList.children.length + 1;
  const fragment = productTemplate.content.cloneNode(true);
  fragment.querySelector(".product-label").textContent = `Product ${index}`;
  fragment.querySelector(".product-rate-label").textContent = `Product ${index} rate`;
  fragment.querySelector(".product-unit-label").textContent = `Product ${index} rate unit`;
  fragment.querySelector(".product-name").setAttribute("aria-label", `Product ${index} chemical name`);
  productList.append(fragment);
}

function updateAddButton() {
  addProductButton.hidden = visibleProducts >= 6;
  if (!addProductButton.hidden) {
    addProductButton.textContent = `+ Add product ${visibleProducts + 1}`;
  }
}

function resetProductRows(count = 1) {
  productList.replaceChildren();
  visibleProducts = Math.min(6, Math.max(1, count));
  for (let index = 0; index < visibleProducts; index += 1) addProductRow();
  updateAddButton();
}

function getCalculation() {
  const litres = Number(mixVolumeInput.value);
  const sprayRate = Number(sprayRateInput.value);
  const volumeValid = mixVolumeInput.value !== "" && litres > 0 && litres <= 5000;
  const rateValid = sprayRateInput.value !== "" && sprayRate > 0;
  return {
    litres,
    sprayRate,
    volumeValid,
    rateValid,
    valid: volumeValid && rateValid,
    hectares: volumeValid && rateValid ? calculateHectares(litres, sprayRate) : 0,
  };
}

function getProductRows() {
  return [...productList.querySelectorAll(".product-row")].map((row, slot) => {
    const nameInput = row.querySelector(".product-name");
    const rateInput = row.querySelector(".product-rate");
    const unitSelect = row.querySelector(".product-unit");
    return {
      slot,
      name: nameInput.value,
      rate: Number(rateInput.value),
      rateText: rateInput.value,
      unit: unitSelect.value,
    };
  });
}

function getUsedProducts() {
  return usedCalculatorProducts(getProductRows());
}

function clearProductValidation() {
  productNameError.hidden = true;
  productNameError.textContent = "";
  productList.querySelectorAll("[aria-invalid='true']").forEach((control) => {
    control.removeAttribute("aria-invalid");
    control.closest(".product-row")?.classList.remove("has-product-error");
  });
}

function validateProductRows({ focus = true } = {}) {
  clearProductValidation();
  const incomplete = firstIncompleteProductRow(getProductRows());
  if (!incomplete) return true;
  const row = productList.children[incomplete.slot];
  const selector = {
    name: ".product-name",
    rate: ".product-rate",
    unit: ".product-unit",
  }[incomplete.field];
  const control = row?.querySelector(selector);
  const instruction = {
    name: "Enter a chemical name",
    rate: "Enter a rate greater than zero",
    unit: "Choose a rate unit",
  }[incomplete.field];
  productNameError.textContent = `${instruction} for Product ${incomplete.slot + 1} before saving.`;
  productNameError.hidden = false;
  control?.setAttribute("aria-invalid", "true");
  row?.classList.add("has-product-error");
  if (focus) {
    control?.focus();
    control?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  return false;
}

function calculate() {
  const calculation = getCalculation();
  if (!productNameError.hidden) validateProductRows({ focus: false });
  volumeError.hidden = !(calculation.litres > 5000);
  coverage.classList.toggle("has-result", Boolean(calculation.hectares));
  coverageResult.textContent = calculation.hectares
    ? `${twoDecimals.format(calculation.hectares)} hectares`
    : "—";

  preferencesUI?.renderRates(calculation.sprayRate);
  document.querySelectorAll("[data-rate]").forEach((button) => {
    const selected = Number(button.dataset.rate) === calculation.sprayRate;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });

  [...productList.querySelectorAll(".product-row")].forEach((row) => {
    const rateInput = row.querySelector(".product-rate");
    const unitSelect = row.querySelector(".product-unit");
    const result = row.querySelector(".product-result");
    const productRate = Number(rateInput.value);
    const unit = unitSelect.value;

    row.dataset.basis = unit.endsWith("_100")
      ? "water"
      : unit.endsWith("_ha")
        ? "hectare"
        : "unset";

    result.textContent =
      calculation.valid &&
      unit &&
      rateInput.value !== "" &&
      productRate >= 0
        ? formatAmount(
            productRate,
            unit,
            calculation.litres,
            calculation.sprayRate,
          )
        : "—";
  });

  saveRecordButton.disabled = storageWriteLocked || !calculation.valid;
  startRunFromCalculatorButton.disabled = storageWriteLocked || !calculation.valid;
  if (!document.querySelector("#run-view").hidden) renderRunView();
  rememberCalculation();
}

function draftInputs() {
  return { mixVolume: mixVolumeInput.value, sprayRate: sprayRateInput.value,
    wasEditing: Boolean(editingTankContext),
    recordContext: editingTankContext ? recordRecoveryContext(store) : null,
    products: getProductRows().map(({ name, rateText, unit }) => ({ name, rateText, unit })) };
}

function warnDraft(message) {
  draftWarning.textContent = message;
  draftWarning.hidden = false;
}

let draftSaveFailed = false;
let draftSequence = 0;
let queuedDraftSignature = null;
async function rememberCalculation() {
  if (!draftReady || pendingDraft.status !== "absent") return;
  const inputs = structuredClone(draftInputs());
  const signature = JSON.stringify(inputs);
  if (signature === queuedDraftSignature || (queuedDraftSignature === null && signature === lastDraftSignature)) return;
  const sequence = ++draftSequence;
  const hasValues = hasCalculationValues();
  queuedDraftSignature = signature;
  draftStatus.textContent = "Saving unfinished calculation...";
  savedTankActions.hidden = true;
  try {
    const draft = await transactStorage(storage => {
      if (!hasValues) { removeRecovery(CALCULATOR_DRAFT_KEY, storage); return null; }
      return persistCalculatorDraft(inputs, storage);
    });
    if (sequence !== draftSequence) return;
    draftStatus.textContent = draft
      ? `Unfinished calculation saved on this device - ${new Date(draft.savedAt).toLocaleString("en-AU")}` : "";
    lastDraftSignature = signature;
    draftSaveFailed = false;
    draftWarning.hidden = true;
  } catch {
    if (sequence === draftSequence) { draftSaveFailed = true; draftStatus.textContent = ""; warnDraft("This calculation could not be saved as a draft on this device. Keep the app open; changes may be lost if you close or reload it."); }
  } finally {
    if (sequence === draftSequence) queuedDraftSignature = null;
  }
}
async function clearStoredDraft() {
  const sequence = ++draftSequence;
  queuedDraftSignature = null;
  const signature = JSON.stringify(draftInputs());
  try {
    await durableWrite(storage => removeRecovery(CALCULATOR_DRAFT_KEY, storage));
    if (sequence === draftSequence) {
      lastDraftSignature = signature;
      draftSaveFailed = false;
      draftStatus.textContent = "";
      draftWarning.hidden = true;
    }
    return true;
  } catch {
    draftSaveFailed = true;
    warnDraft("The old draft could not be cleared on this device. It may be offered again after reopening; check saved records before saving another tank.");
    return false;
  }
}

function tankSaveInputSignature() {
  const { mixVolume, sprayRate, products } = draftInputs();
  return JSON.stringify({ mixVolume, sprayRate, products });
}

function captureTankSaveCompletion(paddock, tank, message) {
  let draftRaw;
  try { draftRaw = getStorage().getItem(CALCULATOR_DRAFT_KEY); } catch { /* No authority to clear an unreadable draft. */ }
  return { paddockId: paddock.id, tankId: tank.id, tankSignature: tankContentSignature(tank), message,
    inputSignature: tankSaveInputSignature(), draftRaw };
}

function finalizeTankSave(completion) {
  if (!completion) return;
  const tank = findTank(findPaddock(completion.paddockId), completion.tankId);
  if (!tank || tankContentSignature(tank) !== completion.tankSignature) return;
  const sameInputs = tankSaveInputSignature() === completion.inputSignature;
  if (sameInputs) {
    clearEditingState();
    saveDialog.close();
    saveError.hidden = true;
  }
  if (sameInputs && completion.draftCleared) {
    ++draftSequence;
    queuedDraftSignature = null;
    lastDraftSignature = JSON.stringify(draftInputs());
    draftSaveFailed = false;
    draftStatus.textContent = "";
    draftWarning.hidden = true;
  }
  lastSavedPaddockId = completion.paddockId;
  lastSavedTankId = completion.tankId;
  document.querySelector("#saved-tank-message").textContent = sameInputs
    ? completion.message : `${completion.message}. Your newer calculation has been kept.`;
  document.querySelector("#prepare-next-tank").hidden = !sameInputs;
  savedTankActions.hidden = false;
}

function showDraftRecovery() {
  const available = pendingDraft.status !== "absent";
  const stale = pendingDraft.status === "ready" && !canResumeCalculatorDraft(pendingDraft.value, store, getStorage());
  draftRecovery.hidden = !available;
  document.querySelector("#calculation-workspace").hidden = available;
  document.querySelector("#resume-calculation").hidden = pendingDraft.status !== "ready";
  document.querySelector("#resume-calculation").disabled = stale;
  document.querySelector("#draft-recovery-description").textContent = pendingDraft.status === "ready"
    ? `Saved ${new Date(pendingDraft.value.savedAt).toLocaleString("en-AU")}.${stale ? " Saved records or restore history changed or could not be checked. This old draft is retained but cannot safely resume. Start fresh discards it." : pendingDraft.value.wasEditing ? " This was an unfinished edit. Resume loads a new calculation; the original saved tank is unchanged." : ""}`
    : "The stored draft could not be read. Start fresh discards only the calculator draft.";
}

function renderTankRecovery() {
  const inspection = inspectTankRecovery(getStorage());
  const panel = document.querySelector("#tank-undo");
  panel.hidden = inspection.status === "absent";
  const present = inspection.status === "ready" && store.paddocks.some((p) => p.tanks.some((t) => t.id === inspection.value.tank.id));
  document.querySelector("#undo-tank-delete").disabled = storageWriteLocked || pendingPersistence.records || inspection.status !== "ready" || present;
  document.querySelector("#tank-undo-description").textContent = inspection.status === "ready"
    ? present ? "This tank is already present. It will not be restored twice."
      : `Tank ${inspection.value.tank.tankNumber} · ${inspection.value.afterPaddock.name} · deleted ${new Date(inspection.value.deletedAt).toLocaleString("en-AU")}`
    : inspection.message || "";
}

function reconcileRecoveryFailure() {
  const inspected = inspectPaddockStore(getStorage());
  if (inspected.status === "ready") store = inspected.value;
  else {
    recoveryWriteUncertain = true;
    storageWriteLocked = true;
  }
  renderStorageWarnings();
  renderPaddocks();
  renderRunView();
  calculate();
}

function hasCalculationValues() {
  return (
    mixVolumeInput.value !== "" ||
    sprayRateInput.value !== "" ||
    [...productList.querySelectorAll("input, select")].some((field) => field.value !== "")
  );
}

function clearEditingState() {
  editingTankContext = null;
  editBanner.hidden = true;
  saveRecordButton.textContent = "Save tank record";
}

async function clearCalculation(askFirst = true, draftAlreadyCleared = false) {
  if (askFirst && hasCalculationValues() && !window.confirm("Clear this calculation?")) return;
  if (!draftAlreadyCleared && !(await clearStoredDraft())) return;
  mixVolumeInput.value = "";
  sprayRateInput.value = "";
  resetProductRows();
  clearProductValidation();
  clearEditingState();
  calculate();
  mixVolumeInput.focus();
}

function switchView(view) {
  viewButtons.forEach((button) => {
    const selected = button.dataset.viewButton === view;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  viewPanels.forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== view;
  });
  if (view === "paddocks") renderPaddocks();
  if (view === "run") renderRunView();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function requestTopLevelView(view) {
  if (typeof host.requestTopLevelView === "function") {
    host.requestTopLevelView(view);
    return;
  }
  switchView(view);
}

function findPaddockByName(name) {
  const normalized = normalizeName(name);
  return findNamedPaddock(store.paddocks, normalized);
}

function findArchivedPaddockByName(name) {
  const normalized = normalizeName(name);
  return findNamedPaddock(store.paddocks, normalized, { archived: true });
}

function findPaddock(id) {
  return store.paddocks.find((paddock) => paddock.id === id);
}

function findTank(paddock, tankId) {
  return paddock?.tanks.find((tank) => tank.id === tankId);
}

function findPaddockByLibraryEntry(entry) {
  if (!entry?.id) return null;
  const seededSource = entry.sourcePaddockId ? findPaddock(entry.sourcePaddockId) : null;
  if (seededSource) return seededSource;
  const tankLinked = store.paddocks.find((paddock) =>
    paddock.tanks.some((tank) => tank.paddockSelection?.libraryEntryId === entry.id),
  );
  if (tankLinked) return tankLinked;
  for (const run of store.runs) {
    const selection = (run.selectedPaddocks || []).find(
      (candidate) => candidate.libraryEntryId === entry.id,
    );
    if (!selection) continue;
    const allocation = run.allocations.find(
      (candidate) => normalizeName(candidate.paddockName) === selection.normalizedName,
    );
    const runLinked = allocation ? findPaddock(allocation.paddockId) : null;
    if (runLinked) return runLinked;
  }
  return null;
}

function getActiveRun() {
  return store.runs.find((run) => run.id === store.activeRunId && run.status === "active") || null;
}

function runAllocationRecords() {
  return store.runs
    .filter((run) => run.status !== "cancelled")
    .flatMap((run) => materializeRunAllocations(run));
}

function recordsForPaddock(paddock) {
  return [
    ...(paddock?.tanks || []),
    ...runAllocationRecords().filter((record) => record.paddockId === paddock?.id),
  ];
}

function paddockHasActiveRunAllocation(paddockId) {
  const paddock = findPaddock(paddockId);
  return store.runs.some(
    (run) => run.status === "active" && (
      run.allocations.some((allocation) => allocation.paddockId === paddockId)
      || (paddock && (run.selectedPaddocks || []).some(
        (selection) => selection.normalizedName === paddock.normalizedName
          || findPaddockByLibraryEntry(findLibraryEntryById(paddockLibrary, selection.libraryEntryId))?.id === paddockId,
      ))
    ),
  );
}

function paddockHasRunAllocation(paddockId) {
  return store.runs.some(
    (run) => run.allocations.some((allocation) => allocation.paddockId === paddockId),
  );
}

function exportPaddockView(paddock) {
  return { ...paddock, tanks: recordsForPaddock(paddock) };
}

function findRunByAllocationId(allocationId) {
  return store.runs.find((run) => run.allocations.some((allocation) => allocation.id === allocationId)) || null;
}

function findDisplayRecord(paddock, recordId) {
  return recordsForPaddock(paddock).find((record) => record.id === recordId) || null;
}

function sourceRecordForDisplay(record) {
  return record?.recordType === "run-allocation"
    ? findRunByAllocationId(record.id)
    : record;
}

function refreshSuggestions() {
  const chemicals = new Map();
  store.paddocks.forEach((paddock) => {
    paddock.tanks.forEach((tank) => {
      tank.products.forEach((product) => {
        const name = cleanChemicalName(product.name);
        const normalized = normalizeChemicalName(name);
        if (name && !chemicals.has(normalized)) {
          chemicals.set(normalized, name);
        }
      });
    });
  });
  store.runs.forEach((run) => {
    run.products.forEach((product) => {
      const name = cleanChemicalName(product.name);
      const normalized = normalizeChemicalName(name);
      if (name && !chemicals.has(normalized)) chemicals.set(normalized, name);
    });
  });
  chemicalSuggestions.replaceChildren();
  [...chemicals.values()]
    .sort((left, right) => left.localeCompare(right))
    .forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      chemicalSuggestions.append(option);
    });
}

function openSaveDialog() {
  const calculation = getCalculation();
  if (!calculation.valid || !validateProductRows()) return;
  refreshPaddockLibrary();
  refreshSuggestions();
  saveError.hidden = true;
  confirmSaveButton.disabled = false;

  const editingPaddock = editingTankContext
    ? findPaddock(editingTankContext.paddockId)
    : null;
  const editingTank = editingTankContext
    ? findTank(editingPaddock, editingTankContext.tankId)
    : null;
  const defaultPaddock =
    editingPaddock ||
    (!isArchivedPaddock(findPaddock(store.lastPaddockId)) ? findPaddock(store.lastPaddockId) : null) ||
    activePaddocks(store.paddocks).sort(
      (left, right) => new Date(right.updatedAt) - new Date(left.updatedAt),
    )[0];
  const defaultLibraryEntry =
    findLibraryEntryById(paddockLibrary, editingTank?.paddockSelection?.libraryEntryId) ||
    findLibraryEntryByName(paddockLibrary, defaultPaddock?.name || "", { includeArchived: Boolean(editingTank) });
  const defaultSelectionId = defaultLibraryEntry?.id ||
    (libraryInspection.status !== "ready" && defaultPaddock ? `${HISTORY_PADDOCK_PREFIX}${defaultPaddock.id}` : "") ||
    (!activeLibraryEntries(paddockLibrary).length && !libraryMutationLocked() ? NEW_LIBRARY_ENTRY : "");

  saveDialogTitle.textContent = editingTank ? "Update tank record" : "Save tank record";
  confirmSaveButton.textContent = editingTank ? "Update tank" : "Save tank";
  populateLibrarySelect(saveLibraryPaddock, {
    selectedId: defaultSelectionId,
    includeHistoryFallback: true,
  });
  savePaddockName.value = defaultLibraryEntry ? "" : defaultPaddock?.name || "";
  savePaddockSize.value = defaultLibraryEntry ? "" : defaultPaddock?.sizeHectares || "";
  setNewPaddockFields(saveLibraryPaddock, saveNewPaddockFields);
  savePaddockTotal.textContent = formatOptionalHectares(defaultLibraryEntry?.totalHectares ?? defaultPaddock?.sizeHectares);
  savePlannedHectares.value = editingTank
    ? editingTank.paddockSelection?.plannedHectares ?? (editingTank.sprayMethod === "Broadacre" ? editingTank.hectares : "")
    : calculation.hectares || "";
  saveSprayDate.value = editingTank?.date || todayLocal();
  saveOperator.value = editingTank?.operator || profile.operator || "";
  populateEquipmentSelect(saveMachine, editingTank, profile.lastMachine);
  saveSprayMethod.value = SPRAY_METHODS.includes(editingTank?.sprayMethod)
    ? editingTank.sprayMethod
    : "Broadacre";
  updateMethodOptions(saveMachine, saveSprayMethod, sprayMethodNote);
  operatorFirstHint.hidden = profile.operatorPrompted;
  saveTankTotal.textContent = `${twoDecimals.format(calculation.litres)} litres`;
  saveSprayRate.textContent = `${twoDecimals.format(calculation.sprayRate)} L/ha`;
  saveArea.textContent = saveSprayMethod.value === "Camera"
    ? "Camera allocation"
    : `${twoDecimals.format(calculation.hectares)} hectares`;

  saveProductList.replaceChildren();
  const usedProducts = getUsedProducts();
  if (!usedProducts.length) {
    const empty = document.createElement("p");
    empty.className = "no-products-message";
    empty.textContent = "No products entered for this tank.";
    saveProductList.append(empty);
  }

  usedProducts.forEach((product) => {
    const row = document.createElement("div");
    row.className = "save-product-row";
    row.innerHTML = `
      <span>
        <strong>${escapeHtml(product.name)}</strong>
        <small>Product ${product.slot + 1} · ${twoDecimals.format(product.rate)} ${escapeHtml(UNIT_LABELS[product.unit])}</small>
      </span>
      <b>${escapeHtml(formatAmount(product.rate, product.unit, calculation.litres, calculation.sprayRate))}</b>
    `;
    saveProductList.append(row);
  });

  updatePlannedAreaNotice();
  document.querySelector("#edit-selected-paddock").disabled = !defaultLibraryEntry;
  saveDialog.showModal();
  (saveNewPaddockFields.hidden ? saveLibraryPaddock : savePaddockName).focus();
}

function buildTankRecord(calculation, existingTank = null, paddockSelection = null) {
  const sprayMethod = SPRAY_METHODS.includes(saveSprayMethod.value)
    ? saveSprayMethod.value
    : null;
  const record = {
    id: existingTank?.id || newId(),
    tankNumber: existingTank?.tankNumber || null,
    date: saveSprayDate.value,
    savedAt: existingTank?.savedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tankTotal: calculation.litres,
    sprayRate: calculation.sprayRate,
    hectares: sprayMethod === "Broadacre" ? calculation.hectares : 0,
    operator: cleanName(saveOperator.value) || null,
    machine: selectedEquipment(saveMachine)?.name || null,
    equipmentSnapshot: selectedEquipment(saveMachine),
    sprayMethod,
    recordType: "tank",
    products: snapshotProducts(getUsedProducts(), (product) => canonicalAmount(
        product.rate,
        product.unit,
        calculation.litres,
        calculation.sprayRate,
      )),
  };
  record.propertySnapshot = existingTank?.propertySnapshot || currentPropertySnapshot();
  if (paddockSelection) record.paddockSelection = paddockSelection;
  return record;
}

function tankContentSignature(tank) {
  return JSON.stringify({
    equipmentSnapshot: tank?.equipmentSnapshot || null,
    date: tank?.date || "",
    tankTotal: Number(tank?.tankTotal || 0),
    sprayRate: Number(tank?.sprayRate || 0),
    hectares: Number(tank?.hectares || 0),
    operator: tank?.operator || null,
    machine: tank?.machine || null,
    sprayMethod: tank?.sprayMethod || null,
    recordType: tank?.recordType || "tank",
    paddockSelection: tank?.paddockSelection || null,
    products: (tank?.products || []).map((product) => ({
      slot: product.slot,
      name: product.name,
      normalizedName: product.normalizedName,
      rate: Number(product.rate),
      unit: product.unit,
      amountBase: Number(product.amountBase),
      baseUnit: product.baseUnit,
    })),
  });
}

async function saveTankRecord(event) {
  event.preventDefault();
  if (confirmSaveButton.disabled) return;
  confirmSaveButton.disabled = true;
  saveError.hidden = true;
  const currentRecords = inspectPaddockStore(getStorage());
  const changedOnDisk = currentRecords.status === "ready"
    ? JSON.stringify(currentRecords.value) !== JSON.stringify(normalizePaddockStore(store))
    : currentRecords.status !== "absent" || store.paddocks.length > 0 || store.runs.length > 0;
  if (pendingPersistence.records || changedOnDisk) {
    saveError.textContent = pendingPersistence.records
      ? "The last change has not been saved yet. Use Retry saving before adding another tank."
      : "Saved records changed while this calculation was open. Reload and review the current records before saving; this calculation remains a draft.";
    saveError.hidden = false;
    confirmSaveButton.disabled = false;
    return;
  }

  const calculation = getCalculation();
  const selectedSnapshot = selectedEquipment(saveMachine);
  const selectedMachine = selectedSnapshot?.name || null;
  const selectedMethod = SPRAY_METHODS.includes(saveSprayMethod.value) ? saveSprayMethod.value : null;
  const incompleteProduct = firstIncompleteProductRow(getProductRows());

  if (
    !calculation.valid
    || !saveSprayDate.value
    || !selectedMethod
    || !selectedSnapshot
    || !allowedSprayMethods(selectedMachine, selectedSnapshot).includes(selectedMethod)
    || incompleteProduct
  ) {
    confirmSaveButton.disabled = false;
    if (incompleteProduct) {
      saveDialog.close();
      validateProductRows();
    } else {
      saveError.textContent = !selectedSnapshot || !allowedSprayMethods(selectedMachine, selectedSnapshot).includes(selectedMethod)
          ? "Choose equipment that supports the selected application method."
          : "Complete the paddock name, date and valid tank calculation.";
      saveError.hidden = false;
    }
    return;
  }

  const selection = (await resolveOperationalSelection({
    select: saveLibraryPaddock,
    plannedField: savePlannedHectares,
    newNameField: savePaddockName,
    newTotalField: savePaddockSize,
    errorElement: saveError,
    allowHistoryFallback: true,
  }));
  if (!selection) {
    confirmSaveButton.disabled = false;
    return;
  }
  const paddockName = selection.name;
  const paddockSize = selection.totalHectares;

  let targetPaddock = selection.entry
    ? findPaddockByLibraryEntry(selection.entry) || findPaddockByName(paddockName)
    : findPaddockByName(paddockName);
  const archivedTarget = targetPaddock && isArchivedPaddock(targetPaddock)
    ? targetPaddock
    : findArchivedPaddockByName(paddockName);
  if (archivedTarget) {
    saveError.textContent = `${archivedTarget.name} is archived. Restore it from Archived paddocks before saving another record to that name.`;
    saveError.hidden = false;
    confirmSaveButton.disabled = false;
    return;
  }

  const targetWasExisting = Boolean(targetPaddock);
  const targetNameChanged = targetPaddock ? targetPaddock.name !== paddockName : false;
  const sourcePaddock = editingTankContext
    ? findPaddock(editingTankContext.paddockId)
    : null;
  const existingTank = editingTankContext
    ? findTank(sourcePaddock, editingTankContext.tankId)
    : null;
  const completionError = tankCompletionBlockReason(targetPaddock, sourcePaddock, existingTank);
  if (completionError) {
    saveError.textContent = completionError;
    saveError.hidden = false;
    confirmSaveButton.disabled = false;
    return;
  }
  if (editingTankContext && (!existingTank || JSON.stringify(existingTank) !== editingTankContext.original)) {
    saveError.textContent = "The original tank has changed or was removed. Cancel this edit and review the current saved record before saving.";
    saveError.hidden = false;
    confirmSaveButton.disabled = false;
    return;
  }

  if (!targetPaddock) {
    if (activePaddocks(store.paddocks).length >= MAX_PADDOCKS) {
      saveError.textContent =
        "Twenty-five paddocks are already active. Export, then clear or archive one before adding another.";
      saveError.hidden = false;
      confirmSaveButton.disabled = false;
      return;
    }
    targetPaddock = {
      id: newId(),
      name: paddockName,
      normalizedName: normalizeName(paddockName),
      sizeHectares: paddockSize,
      archivedAt: null,
      note: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      contentRevision: 1,
      lastGeneratedRevision: null,
      lastGeneratedAt: null,
      lastGeneratedLabel: null,
      tanks: [],
    };
    store.paddocks.push(targetPaddock);
  }

  const paddockSelection = selection.snapshot || (
    existingTank?.paddockSelection
    && existingTank.paddockSelection.normalizedName === normalizeName(paddockName)
      ? {
          ...existingTank.paddockSelection,
          plannedHectares: selection.plannedHectares,
        }
      : null
  );
  const tank = buildTankRecord(calculation, existingTank, paddockSelection);
  const tankChanged = !existingTank || tankContentSignature(existingTank) !== tankContentSignature(tank);
  const movedTank = Boolean(existingTank && sourcePaddock && sourcePaddock.id !== targetPaddock.id);
  let message;

  if (existingTank && sourcePaddock) {
    const sourceIndex = sourcePaddock.tanks.findIndex(
      (record) => record.id === existingTank.id,
    );
    if (sourcePaddock.id === targetPaddock.id) {
      targetPaddock.tanks[sourceIndex] = tank;
    } else {
      sourcePaddock.tanks.splice(sourceIndex, 1);
      bumpContentRevision(sourcePaddock);
      tank.tankNumber =
        Math.max(0, ...targetPaddock.tanks.map((record) => record.tankNumber || 0)) + 1;
      targetPaddock.tanks.push(tank);
    }
    message = `Tank ${tank.tankNumber} updated in ${targetPaddock.name}`;
  } else {
    tank.tankNumber =
      Math.max(0, ...targetPaddock.tanks.map((record) => record.tankNumber || 0)) + 1;
    targetPaddock.tanks.push(tank);
    message = `Tank ${tank.tankNumber} saved to ${targetPaddock.name}`;
  }

  targetPaddock.name = paddockName;
  targetPaddock.normalizedName = normalizeName(paddockName);
  targetPaddock.updatedAt = new Date().toISOString();
  if (targetWasExisting && (tankChanged || movedTank || targetNameChanged)) {
    bumpContentRevision(targetPaddock);
  }
  store.lastPaddockId = targetPaddock.id;

  profile.operatorPrompted = true;
  if (tank.operator) profile.operator = tank.operator;
  if (tank.machine) profile.lastMachine = tank.machine;

  pendingTankSave = captureTankSaveCompletion(targetPaddock, tank, message);
  const recordsSaved = (await persistStore());
  let profileSaved = false;
  if (recordsSaved) {
    if (!profileWriteLocked) profileSaved = (await persistOperatorProfile());
  } else if (!profileWriteLocked) {
    markPersistenceFailure("profile");
  }
  refreshSuggestions();

  if (!recordsSaved) { saveError.textContent = "Tank changes are not saved. Use Retry saving before continuing."; saveError.hidden = false; return; }
  clearEditingState();
  expandedPaddockId = targetPaddock.id;
  saveDialog.close();
  renderPaddocks();
  if (profileWriteLocked) {
    showToast(`${message}. The protected device profile was not changed.`);
    return;
  }
  if (!profileSaved) {
    showToast(`${message}, but the operator profile is not saved yet.`);
    return;
  }
  showToast(message);
}

function renderJobPaddockList(container, selections, { removable = false } = {}) {
  if (!selections.length) {
    container.innerHTML = '<p class="no-tanks">No paddocks selected yet.</p>';
    return;
  }
  container.innerHTML = selections.map((selection) => `
    <div class="job-paddock-row">
      <span><strong>${escapeHtml(selection.name)}</strong><small>Paddock total: ${escapeHtml(formatOptionalHectares(selection.totalHectares))}</small></span>
      ${removable ? `<button type="button" data-remove-run-selection="${escapeHtml(selection.libraryEntryId)}" aria-label="Remove ${escapeHtml(selection.name)} from this buffer">Remove</button>` : ""}
    </div>
  `).join("");
}

function prepareRunSelectionControl(select, fields, selections) {
  populateLibrarySelect(select, {
    selectedId: activeLibraryEntries(paddockLibrary).length ? "" : NEW_LIBRARY_ENTRY,
    excludeIds: selections.map((selection) => selection.libraryEntryId),
  });
  if (!activeLibraryEntries(paddockLibrary).length && !libraryMutationLocked()) select.value = NEW_LIBRARY_ENTRY;
  setNewPaddockFields(select, fields);
}

async function addPendingRunSelection() {
  runStartPaddockError.hidden = true;
  const selection = (await resolveOperationalSelection({
    select: runStartLibraryPaddock,
    plannedField: null,
    newNameField: runStartNewPaddockName,
    newTotalField: runStartNewPaddockTotal,
    errorElement: runStartPaddockError,
  }));
  if (!selection) return;
  if (blockCompletedRunSelection(selection.snapshot, runStartPaddockError)) return;
  if (pendingRunSelections.some((item) => item.libraryEntryId === selection.snapshot.libraryEntryId)) {
    runStartPaddockError.textContent = `${selection.name} is already selected for this buffer.`;
    runStartPaddockError.hidden = false;
    return;
  }
  pendingRunSelections.push(selection.snapshot);
  renderJobPaddockList(runStartSelectedPaddocks, pendingRunSelections, { removable: true });
  runStartPlannedHectares.value = "";
  runStartNewPaddockName.value = "";
  runStartNewPaddockTotal.value = "";
  prepareRunSelectionControl(runStartLibraryPaddock, runStartNewPaddockFields, pendingRunSelections);
}

async function addActiveRunSelection() {
  const run = getActiveRun();
  if (!run) return;
  if (!canChangeBuffer(activeRunPaddockError)) return;
  activeRunPaddockError.hidden = true;
  const selection = (await resolveOperationalSelection({
    select: activeRunLibraryPaddock,
    plannedField: null,
    newNameField: activeRunNewPaddockName,
    newTotalField: activeRunNewPaddockTotal,
    errorElement: activeRunPaddockError,
  }));
  if (!selection) return;
  if (blockCompletedRunSelection(selection.snapshot, activeRunPaddockError)) return;
  const selectedPaddocks = run.selectedPaddocks || [];
  if (selectedPaddocks.some((item) => item.libraryEntryId === selection.snapshot.libraryEntryId)) {
    activeRunPaddockError.textContent = `${selection.name} is already selected for this buffer.`;
    activeRunPaddockError.hidden = false;
    return;
  }
  const updatedRun = {
    ...run,
    updatedAt: new Date().toISOString(),
    selectedPaddocks: [...selectedPaddocks, selection.snapshot],
  };
  store.runs[store.runs.findIndex((item) => item.id === run.id)] = updatedRun;
  const saved = (await persistStore());
  if (!saved) return;
  activeRunPlannedHectares.value = "";
  activeRunNewPaddockName.value = "";
  activeRunNewPaddockTotal.value = "";
  renderRunView();
  if (saved) showToast(`${selection.name} added to Buffer ${run.runNumber}.`);
}

function selectedRunPaddock(run, libraryEntryId) {
  return (run?.selectedPaddocks || []).find((selection) => selection.libraryEntryId === libraryEntryId) || null;
}

function updateRunSelectedPaddockDetails() {
  const run = getActiveRun();
  const selection = selectedRunPaddock(run, runPaddockName.value);
  runPaddockSize.value = selection?.totalHectares || "";
  runSelectedPlan.textContent = selection
    ? `Paddock total ${formatOptionalHectares(selection.totalHectares)}. Enter litres sprayed, not hectares.`
    : "Choose a paddock selected for this buffer.";
}

function openRunStartDialog() {
  if (getActiveRun()) {
    requestTopLevelView("run");
    showToast("A buffer is already in progress.");
    return;
  }
  const calculation = getCalculation();
  if (!calculation.valid || !validateProductRows()) {
    requestTopLevelView("calculator");
    showToast("Complete a valid tank mix before starting a buffer.");
    return;
  }
  refreshPaddockLibrary();
  pendingRunSelections = [];
  renderJobPaddockList(runStartSelectedPaddocks, pendingRunSelections, { removable: true });
  runStartPlannedHectares.value = "";
  runStartNewPaddockName.value = "";
  runStartNewPaddockTotal.value = "";
  prepareRunSelectionControl(runStartLibraryPaddock, runStartNewPaddockFields, pendingRunSelections);
  runStartPaddockError.hidden = true;
  runStartError.hidden = true;
  confirmStartRun.disabled = false;
  runDate.value = todayLocal();
  runControllerStart.value = calculation.litres;
  runOperator.value = profile.operator || "";
  populateEquipmentSelect(runMachine, null, profile.lastMachine);
  runSprayMethod.value = "Broadacre";
  updateMethodOptions(runMachine, runSprayMethod, runMethodNote);
  runMixTotal.textContent = `${twoDecimals.format(calculation.litres)} litres`;
  runSprayRate.textContent = `${twoDecimals.format(calculation.sprayRate)} L/ha`;
  runProductCount.textContent = String(getUsedProducts().length);
  runStartDialog.showModal();
  runDate.focus();
}

async function startPaddockRun(event) {
  event.preventDefault();
  if (confirmStartRun.disabled || getActiveRun()) return;
  if (!canChangeBuffer(runStartError)) return;
  confirmStartRun.disabled = true;
  runStartError.hidden = true;
  if (pendingRunSelections.some(selection => blockCompletedRunSelection(selection, runStartError))) {
    confirmStartRun.disabled = false;
    return;
  }
  const calculation = getCalculation();
  const controllerStartLitres = Number(runControllerStart.value);
  const selectedSnapshot = selectedEquipment(runMachine);
  const machine = selectedSnapshot?.name || null;
  const sprayMethod = SPRAY_METHODS.includes(runSprayMethod.value) ? runSprayMethod.value : null;
  if (
    !calculation.valid
    || !runDate.value
    || !Number.isFinite(controllerStartLitres)
    || controllerStartLitres <= 0
    || controllerStartLitres > 5000
    || !sprayMethod
    || !selectedSnapshot
    || !allowedSprayMethods(machine, selectedSnapshot).includes(sprayMethod)
    || pendingRunSelections.length === 0
  ) {
    runStartError.textContent = pendingRunSelections.length === 0
      ? "Add at least one paddock for this buffer."
      : controllerStartLitres > 5000
      ? "Starting litres cannot exceed 5,000 litres."
      : "Complete the date, starting litres, machine and compatible application method.";
    runStartError.hidden = false;
    confirmStartRun.disabled = false;
    return;
  }
  let validatedControllerStart;
  try {
    validatedControllerStart = validateControllerStartAgainstMix(
      controllerStartLitres,
      calculation.litres,
    );
  } catch (error) {
    runStartError.textContent = error?.message || "The controller start is not valid for this Calculator mix.";
    runStartError.hidden = false;
    confirmStartRun.disabled = false;
    return;
  }
  try {
    const timestamp = new Date().toISOString();
    const run = createPaddockRun({
      id: newId(),
      runNumber: Math.max(0, ...store.runs.map((item) => Number(item.runNumber) || 0)) + 1,
      date: runDate.value,
      savedAt: timestamp,
      operator: cleanName(runOperator.value) || null,
      machine,
      equipmentSnapshot: selectedSnapshot,
      sprayMethod,
      controllerStartLitres: validatedControllerStart,
      sprayRate: calculation.sprayRate,
      selectedPaddocks: pendingRunSelections,
      products: snapshotProducts(getUsedProducts(), (product) => canonicalAmount(
        product.rate,
        product.unit,
        validatedControllerStart,
        calculation.sprayRate,
      )),
      propertySnapshot: currentPropertySnapshot(),
    });
    store.runs.push(run);
    store.activeRunId = run.id;
    profile.operatorPrompted = true;
    if (run.operator) profile.operator = run.operator;
    if (run.machine) profile.lastMachine = run.machine;
    const recordsSaved = (await persistStore());
    if (recordsSaved && !profileWriteLocked) (await persistOperatorProfile());
    if (!recordsSaved) { runStartError.textContent = "Buffer changes are not saved. Use Retry saving before continuing."; runStartError.hidden = false; return; }
    pendingRunSelections = [];
    runStartDialog.close();
    requestTopLevelView("run");
    renderRunView();
    if (recordsSaved) showToast(`Buffer ${run.runNumber} started. Enter litres sprayed in the first paddock.`);
  } catch (error) {
    runStartError.textContent = error?.message || "The buffer could not be started.";
    runStartError.hidden = false;
    confirmStartRun.disabled = false;
  }
}

function tankCompletionBlockReason(target, source, existingTank) {
  if (isCompletedPaddock(source) && target?.id !== source.id) {
    return `${source.name} is completed. Reopen paddock before moving a tank to another paddock.`;
  }
  if (isCompletedPaddock(target) && !(existingTank && source?.id === target.id)) {
    return `${target.name} is completed. Reopen paddock before saving new tank work.`;
  }
  return "";
}

function blockCompletedRunSelection(selection, errorElement) {
  const entry = findLibraryEntryById(paddockLibrary, selection.libraryEntryId);
  const paddock = findPaddockByLibraryEntry(entry) || findPaddockByName(selection.name);
  if (!isCompletedPaddock(paddock)) return false;
  errorElement.textContent = `${paddock.name} is completed. Reopen paddock before adding it to a Buffer.`;
  errorElement.hidden = false;
  return true;
}

function ensureRunPaddock(name, sizeHectares, selection = null) {
  const entry = selection?.libraryEntryId
    ? findLibraryEntryById(paddockLibrary, selection.libraryEntryId)
    : null;
  let paddock = findPaddockByLibraryEntry(entry) || findPaddockByName(name);
  if (isCompletedPaddock(paddock)) throw new Error(`${paddock.name} is completed. Reopen paddock before recording new Buffer work.`);
  const archivedTarget = paddock && isArchivedPaddock(paddock)
    ? paddock
    : findArchivedPaddockByName(name);
  if (archivedTarget) {
    throw new Error(`${archivedTarget.name} is archived. Restore it from Archived paddocks before recording another allocation to that name.`);
  }
  const existed = Boolean(paddock);
  if (!paddock) {
    if (activePaddocks(store.paddocks).length >= MAX_PADDOCKS) {
      throw new Error("Twenty-five paddocks are already active. Export, then clear or archive one before adding another.");
    }
    const timestamp = new Date().toISOString();
    paddock = {
      id: newId(),
      name,
      normalizedName: normalizeName(name),
      sizeHectares,
      archivedAt: null,
      note: "",
      createdAt: timestamp,
      updatedAt: timestamp,
      contentRevision: 1,
      lastGeneratedRevision: null,
      lastGeneratedAt: null,
      lastGeneratedLabel: null,
      tanks: [],
    };
    store.paddocks.push(paddock);
  } else {
    bumpContentRevision(paddock);
  }
  store.lastPaddockId = paddock.id;
  return { paddock, existed };
}

function currentRunController(run) {
  return run.allocations.length
    ? Number(run.allocations.at(-1).controllerAfterLitres)
    : Number(run.controllerStartLitres);
}

function canChangeBuffer(errorElement) {
  const current = inspectPaddockStore(getStorage());
  const changed = current.status === "ready"
    ? JSON.stringify(current.value) !== JSON.stringify(normalizePaddockStore(store))
    : current.status !== "absent" || store.paddocks.length > 0 || store.runs.length > 0;
  if (storageWriteLocked || pendingPersistence.records || changed) {
    errorElement.textContent = "Saved records changed or a save is pending. Retry saving or reload and review before changing this Buffer.";
    errorElement.hidden = false;
    return false;
  }
  return true;
}

function openBufferCorrection(runId, allocationId) {
  const run = store.runs.find((item) => item.id === runId);
  const record = run && materializeRunAllocations(run).find((item) => item.id === allocationId);
  if (!record || run.status === "cancelled") return;
  if (runControllerAfter.value.trim() !== "") {
    requestTopLevelView("run");
    showToast("Save or clear the unsaved litres-sprayed entry before correcting an allocation.");
    return;
  }
  bufferCorrectionContext = { runId, allocationId, original: JSON.stringify(run) };
  document.querySelector("#buffer-correction-description").textContent = `Buffer ${run.runNumber} · ${record.paddockName}. Other allocations keep their sprayed litres. This correction updates this paddock's product quantities and the Buffer balance; a correction history is retained.`;
  document.querySelector("#buffer-correction-litres").value = record.litresUsed;
  document.querySelector("#buffer-correction-error").hidden = true;
  updateBufferCorrectionPreview();
  document.querySelector("#buffer-correction-dialog").showModal();
}

function updateBufferCorrectionPreview() {
  const context = bufferCorrectionContext;
  if (!context) return;
  const run = store.runs.find((item) => item.id === context.runId);
  const preview = document.querySelector("#buffer-correction-preview");
  try {
    const next = correctRunLitresAllocation(run, context.allocationId, {
      litresUsed: document.querySelector("#buffer-correction-litres").value,
      updatedAt: new Date().toISOString(),
    });
    const remaining = currentRunController(next);
    preview.textContent = `After correction: ${twoDecimals.format(next.controllerStartLitres - remaining)} L sprayed · ${twoDecimals.format(remaining)} L remaining. Other allocations are unchanged.`;
  } catch (error) { preview.textContent = error.message; }
}

async function saveBufferCorrection(event) {
  event.preventDefault();
  const context = bufferCorrectionContext;
  if (!context) return;
  const errorElement = document.querySelector("#buffer-correction-error");
  errorElement.hidden = true;
  if (!canChangeBuffer(errorElement)) return;
  const run = store.runs.find((item) => item.id === context.runId);
  try {
    if (!run || JSON.stringify(run) !== context.original) throw new Error("This Buffer changed. Close and reopen the correction.");
    const next = correctRunLitresAllocation(run, context.allocationId, {
      litresUsed: document.querySelector("#buffer-correction-litres").value,
      updatedAt: new Date().toISOString(), reason: "Operator corrected litres sprayed",
    });
    store.runs[store.runs.findIndex((item) => item.id === run.id)] = next;
    const beforeRecords = materializeRunAllocations(run);
    const affectedPaddocks = new Set(materializeRunAllocations(next)
      .filter((record, index) => JSON.stringify(record) !== JSON.stringify(beforeRecords[index]))
      .map((record) => record.paddockId));
    for (const paddockId of affectedPaddocks) {
      const paddock = findPaddock(paddockId);
      if (paddock) bumpContentRevision(paddock);
    }
    const saved = (await persistStore());
    if (!saved) { errorElement.textContent = "Correction is not saved. Use Retry saving before continuing."; errorElement.hidden = false; return; }
    document.querySelector("#buffer-correction-dialog").close();
    bufferCorrectionContext = null;
    renderRunView(); renderPaddocks();
    if (saved) showToast("Correction saved. Paddock totals and chemical quantities updated.");
  } catch (error) { errorElement.textContent = error.message; errorElement.hidden = false; }
}

function updatePlannedAreaNotice() {
  const planned = optionalPositiveValue(savePlannedHectares);
  const calculated = getCalculation().hectares;
  const mismatch = saveSprayMethod.value === "Broadacre" && Number.isFinite(planned) && Math.abs(planned - calculated) > 0.005;
  document.querySelector("#planned-area-notice").hidden = !mismatch;
  document.querySelector("#planned-area-notice-text").textContent = mismatch
    ? `Planned ${twoDecimals.format(planned)} ha differs from calculated ${twoDecimals.format(calculated)} ha. Keep your plan, or use the calculated area. Changing the plan does not change this mix.` : "";
}

function libraryEntryForPaddock(paddock) {
  if (!paddock) return null;
  const linkedIds = (paddock.tanks || []).map((tank) => tank.paddockSelection?.libraryEntryId).filter(Boolean);
  for (const run of store.runs) {
    for (const allocation of run.allocations.filter((item) => item.paddockId === paddock.id)) {
      const selection = (run.selectedPaddocks || []).find((item) => normalizeName(item.name) === normalizeName(allocation.paddockName));
      if (selection) linkedIds.push(selection.libraryEntryId);
    }
  }
  for (const id of linkedIds) {
    const entry = findLibraryEntryById(paddockLibrary, id);
    if (entry) return entry;
  }
  const seeded = paddockLibrary.entries.find((entry) => entry.sourcePaddockId === paddock.id);
  if (seeded) return seeded;
  // A lost explicit link must not silently bind to a different paddock reusing its old name.
  return linkedIds.length ? null : findLibraryEntryByName(paddockLibrary, paddock.name);
}

function openPaddockDetails(entryId) {
  refreshPaddockLibrary();
  const entry = findLibraryEntryById(paddockLibrary, entryId);
  if (!entry || libraryMutationLocked()) { showToast("Paddock details are unavailable. Review the Paddock Library in Settings."); return; }
  paddockDetailsContext = { entryId, original: JSON.stringify(paddockLibrary) };
  document.querySelector("#paddock-details-name").value = entry.name;
  document.querySelector("#paddock-details-total").value = entry.totalHectares ?? "";
  document.querySelector("#paddock-details-error").hidden = true;
  document.querySelector("#paddock-details-dialog").showModal();
}

async function savePaddockDetails(event) {
  event.preventDefault();
  const errorElement = document.querySelector("#paddock-details-error");
  const context = paddockDetailsContext;
  if (!context) return;
  try {
    refreshPaddockLibrary();
    if (libraryMutationLocked() || pendingPersistence.library || JSON.stringify(paddockLibrary) !== context.original) throw new Error("The library changed or a save is pending. Close and reopen this editor.");
    const entry = findLibraryEntryById(paddockLibrary, context.entryId);
    const name = document.querySelector("#paddock-details-name").value;
    const totalHectares = optionalPositiveValue(document.querySelector("#paddock-details-total"));
    if (Number.isNaN(totalHectares)) throw new Error("Paddock total must be blank or greater than zero.");
    const duplicate = findLibraryEntryByName(paddockLibrary, name, { includeArchived: true });
    if (duplicate && duplicate.id !== entry.id) throw new Error("That paddock name already exists in the library.");
    const updated = updateLibraryEntry(entry, { name, totalHectares }, new Date().toISOString());
    const next = { ...paddockLibrary, entries: paddockLibrary.entries.map((item) => item.id === entry.id ? updated : item) };
    if (!(await persistLibrary(next))) throw new Error("Paddock change is not saved yet. Close this editor and use Retry saving.");
    document.querySelector("#paddock-details-dialog").close();
    paddockDetailsContext = null;
    if (saveDialog.open) {
      populateLibrarySelect(saveLibraryPaddock, { selectedId: updated.id, includeHistoryFallback: true });
      savePaddockTotal.textContent = formatOptionalHectares(updated.totalHectares);
    }
    showToast("Paddock library updated. Existing saved records and active Buffer snapshots are unchanged.");
  } catch (error) { errorElement.textContent = error.message; errorElement.hidden = false; }
}

function updateRunAllocationPreview() {
  const run = getActiveRun();
  if (!run) return;
  const before = currentRunController(run);
  const used = Number(runControllerAfter.value);
  if (runControllerAfter.value === "" || !Number.isFinite(used)) {
    runAllocationPreview.textContent = "Enter litres sprayed in this paddock (for example, 500).";
    return;
  }
  if (used <= 0 || used > before) {
    runAllocationPreview.textContent = `Enter more than zero and no more than ${twoDecimals.format(before)} L available.`;
    return;
  }
  runAllocationPreview.textContent = run.sprayMethod === "Broadacre"
    ? `${twoDecimals.format(used)} L sprayed · ${twoDecimals.format(used / run.sprayRate)} calculated ha · ${twoDecimals.format(before - used)} L remaining`
    : `${twoDecimals.format(used)} L sprayed · ${twoDecimals.format(before - used)} L remaining · Camera: no measured ground area`;
}

async function recordRunAllocation(event) {
  event.preventDefault();
  const run = getActiveRun();
  if (!run) return;
  runAllocationError.hidden = true;
  if (!canChangeBuffer(runAllocationError)) return;
  const selection = selectedRunPaddock(run, runPaddockName.value);
  const paddockName = selection?.name || "";
  const paddockSize = selection?.totalHectares ?? null;
  const before = currentRunController(run);
  const used = Number(runControllerAfter.value);
  if (
    !selection
    || runControllerAfter.value === ""
    || !Number.isFinite(used)
    || used <= 0
    || used > before
  ) {
    runAllocationError.textContent = `Choose a paddock and enter litres sprayed greater than zero, up to ${twoDecimals.format(before)} L available.`;
    runAllocationError.hidden = false;
    return;
  }
  try {
    const { paddock } = ensureRunPaddock(paddockName, paddockSize, selection);
    const timestamp = new Date().toISOString();
    const updatedRun = addRunLitresAllocation(run, {
      id: newId(),
      paddockId: paddock.id,
      paddockName: selection.name,
      paddockSizeHectares: selection.totalHectares,
      litresUsed: used,
      savedAt: timestamp,
    });
    store.runs[store.runs.findIndex((item) => item.id === run.id)] = updatedRun;
    const saved = (await persistStore());
    if (!saved) { runAllocationError.textContent = "Allocation is not saved. Use Retry saving before continuing."; runAllocationError.hidden = false; return; }
    runPaddockName.value = "";
    runPaddockSize.value = "";
    updateRunSelectedPaddockDetails();
    runControllerAfter.value = "";
    refreshSuggestions();
    renderRunView();
    renderPaddocks();
    if (saved) showToast(`${twoDecimals.format(used)} litres sprayed allocated to ${paddock.name}.`);
  } catch (error) {
    runAllocationError.textContent = error?.message || "The paddock allocation could not be recorded.";
    runAllocationError.hidden = false;
  }
}

function finishActiveRun() {
  const run = getActiveRun();
  if (!run) return;
  if (!canChangeBuffer(runAllocationError)) return;
  if (runControllerAfter.value.trim() !== "") {
    runAllocationError.textContent = "This litres-sprayed entry is not saved. Save the allocation, or clear the entry before finishing.";
    runAllocationError.hidden = false;
    runControllerAfter.focus();
    return;
  }
  if (!run.allocations.length) {
    runAllocationError.textContent = "Record at least one paddock, or cancel the empty buffer.";
    runAllocationError.hidden = false;
    return;
  }
  finishBufferContext = { id: run.id, original: JSON.stringify(run) };
  document.querySelector("#finish-buffer-summary").textContent = `Finish Buffer ${run.runNumber}? ${twoDecimals.format(run.controllerStartLitres - currentRunController(run))} L sprayed; ${twoDecimals.format(currentRunController(run))} L remaining. Remaining liquid is not allocated automatically.`;
  document.querySelector("#finish-buffer-error").hidden = true;
  document.querySelector("#finish-buffer-dialog").showModal();
}

async function confirmFinishBuffer(event) {
  event.preventDefault();
  const run = getActiveRun();
  const errorElement = document.querySelector("#finish-buffer-error");
  if (!run || !finishBufferContext || run.id !== finishBufferContext.id || JSON.stringify(run) !== finishBufferContext.original || runControllerAfter.value.trim() !== "") {
    errorElement.textContent = "The Buffer or unsaved entry changed. Go back and review before finishing.";
    errorElement.hidden = false;
    return;
  }
  if (!canChangeBuffer(errorElement)) return;
  const completed = completePaddockRun(run, new Date().toISOString());
  store.runs[store.runs.findIndex((item) => item.id === run.id)] = completed;
  store.activeRunId = null;
  const saved = (await persistStore());
  if (!saved) { errorElement.textContent = "Buffer finish is not saved. Use Retry saving before continuing."; errorElement.hidden = false; return; }
  finishBufferContext = null;
  document.querySelector("#finish-buffer-dialog").close();
  renderRunView();
  renderPaddocks();
  if (saved) showToast(`Buffer ${run.runNumber} finished with ${twoDecimals.format(completed.controllerFinalLitres)} litres remaining.`);
}

async function cancelActiveEmptyRun() {
  const run = getActiveRun();
  if (!run || run.allocations.length) return;
  if (!window.confirm(`Cancel empty Buffer ${run.runNumber}? Its cancelled audit record will be retained.`)) return;
  const cancelled = cancelEmptyPaddockRun(run, new Date().toISOString());
  store.runs[store.runs.findIndex((item) => item.id === run.id)] = cancelled;
  store.activeRunId = null;
  const saved = (await persistStore());
  if (!saved) return;
  renderRunView();
  if (saved) showToast(`Empty Buffer ${run.runNumber} cancelled; its audit record was retained.`);
}

function renderRunView() {
  const calculation = getCalculation();
  const activeRun = getActiveRun();
  const completed = !activeRun && [...store.runs].reverse().find((run) => run.status === "completed");
  document.querySelector("#buffer-completion").hidden = !completed;
  if (completed) document.querySelector("#buffer-completion-summary").textContent = `${pendingPersistence.records ? "Not saved yet — " : ""}Buffer ${completed.runNumber}: prepared ${twoDecimals.format(completed.controllerStartLitres)} L · sprayed ${twoDecimals.format(completed.controllerStartLitres - completed.controllerFinalLitres)} L · remaining ${twoDecimals.format(completed.controllerFinalLitres)} L. Remaining liquid has not been allocated.`;
  runCalculationStatus.textContent = calculation.valid
    ? `${twoDecimals.format(calculation.litres)} L at ${twoDecimals.format(calculation.sprayRate)} L/ha is ready in Calculator.`
    : "Set up a tank mix in Calculator, then start a buffer.";
  openRunDialogButton.disabled = !calculation.valid || Boolean(activeRun) || storageWriteLocked;
  startRunFromCalculatorButton.disabled = !calculation.valid || storageWriteLocked;
  runEmptyCard.hidden = Boolean(activeRun);
  activeRunCard.hidden = !activeRun;
  if (!activeRun) return;
  const before = currentRunController(activeRun);
  const allocated = Number(activeRun.controllerStartLitres) - before;
  activeRunTitle.textContent = `Buffer ${activeRun.runNumber}`;
  activeRunMethod.textContent = activeRun.sprayMethod === "Camera" ? "Camera spray" : "Broadacre";
  activeRunMeta.innerHTML = `
    <span><small>Operator</small><strong>${escapeHtml(activeRun.operator || "Not set")}</strong></span>
    <span><small>Machine</small><strong>${escapeHtml(activeRun.machine || "Not set")}</strong></span>
    <span><small>Started</small><strong>${twoDecimals.format(activeRun.controllerStartLitres)} L</strong></span>
    <span><small>Allocated so far</small><strong>${twoDecimals.format(allocated)} L</strong></span>
  `;
  const selectedPaddocks = activeRun.selectedPaddocks || [];
  renderJobPaddockList(activeRunSelectedPaddocks, selectedPaddocks);
  prepareRunSelectionControl(activeRunLibraryPaddock, activeRunNewPaddockFields, selectedPaddocks);
  activeRunPaddockError.hidden = true;
  const currentAllocationSelection = runPaddockName.value;
  runPaddockName.replaceChildren();
  addSelectOption(runPaddockName, "", selectedPaddocks.length ? "Choose a selected paddock" : "Add a paddock to this buffer first");
  for (const selection of selectedPaddocks) {
    addSelectOption(runPaddockName, selection.libraryEntryId, selection.name, {
      selected: selection.libraryEntryId === currentAllocationSelection,
    });
  }
  runControllerBefore.textContent = `${twoDecimals.format(before)} L`;
  runControllerAfter.max = String(before);
  runAllocationList.innerHTML = activeRun.allocations.length
    ? materializeRunAllocations(activeRun).map((record) => `
        <div class="run-allocation-row"><span><strong>${escapeHtml(record.paddockName)}</strong><small>${twoDecimals.format(record.controllerAfterLitres)} L remaining</small></span><b>${twoDecimals.format(record.litresUsed)} L sprayed${record.sprayMethod === "Broadacre" ? ` · ${twoDecimals.format(record.hectares)} ha` : " · Camera"}</b><button type="button" data-correct-run="${escapeHtml(activeRun.id)}" data-allocation-id="${escapeHtml(record.id)}">Correct litres</button></div>
      `).join("")
    : `<p class="no-tanks">No paddocks recorded yet.</p>`;
  finishRunButton.disabled = activeRun.allocations.length === 0;
  cancelEmptyRunButton.hidden = activeRun.allocations.length > 0;
  updateRunSelectedPaddockDetails();
  updateRunAllocationPreview();
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

function getPaddockTotals(paddock) {
  const chemicals = new Map();
  let tankTotal = 0;
  let hectares = 0;
  let unknownMethodRecordCount = 0;

  recordsForPaddock(paddock).forEach((tank) => {
    tankTotal += tank.tankTotal;
    if (tank.sprayMethod === "Broadacre") {
      hectares += tank.hectares;
    } else if (tank.sprayMethod !== "Camera") {
      unknownMethodRecordCount += 1;
    }
    tank.products.forEach((product) => {
      const name = productDisplayName(product);
      const normalizedName = normalizeChemicalName(product.name) || `missing:${tank.id}:${product.slot}`;
      const key = `${normalizedName}|${product.baseUnit}`;
      const existing = chemicals.get(key);
      if (existing) {
        existing.amountBase += product.amountBase;
      } else {
        chemicals.set(key, {
          name,
          normalizedName,
          baseUnit: product.baseUnit,
          amountBase: product.amountBase,
        });
      }
    });
  });

  return {
    tankTotal,
    hectares,
    unknownMethodRecordCount,
    chemicals: [...chemicals.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
  };
}

function renderTankRecord(paddock, tank) {
  const isRunAllocation = tank.recordType === "run-allocation";
  const jobSelection = tank.paddockSelection || (tank.selectedPaddocks || []).find(
    (selection) => selection.normalizedName === normalizeName(tank.paddockName || paddock.name),
  ) || null;
  const products = tank.products.length
    ? tank.products
        .map(
          (product) => `
            <li>
              <span>
                <strong>${escapeHtml(productDisplayName(product))}</strong>
                <small>${twoDecimals.format(product.rate)} ${escapeHtml(UNIT_LABELS[product.unit])}</small>
              </span>
              <b>${escapeHtml(formatPracticalAmount(product.amountBase, product.baseUnit))}</b>
            </li>
          `,
        )
        .join("")
    : `<li class="record-empty-product">No products recorded</li>`;

  return `
    <article class="tank-record">
      <div class="tank-record-heading">
        <div>
          <strong>${isRunAllocation ? `Buffer ${tank.runNumber} · Allocation ${tank.allocationNumber}` : `Tank ${tank.tankNumber}`}</strong>
          <span>${pendingPersistence.records ? "Not saved on this device" : `${isRunAllocation && tank.runStatus === "active" ? "Active buffer · recorded" : "Saved"} ${escapeHtml(formatTime(tank.savedAt))}`}</span>
        </div>
        <b>${isRunAllocation ? "Allocated" : "Tank total"}: ${twoDecimals.format(tank.tankTotal)} litres</b>
      </div>
      <div class="tank-stats">
        <span>${twoDecimals.format(tank.sprayRate)} L/ha</span>
        <span>${tank.sprayMethod === "Camera" ? "Camera · liquid allocation only" : `${twoDecimals.format(tank.hectares)} calculated ha (not GPS-measured ground)`}</span>
      </div>
      ${isRunAllocation ? `<div class="record-actions"><button type="button" data-action="correct-buffer" data-run-id="${escapeHtml(tank.runId)}" data-tank-id="${escapeHtml(tank.id)}">Correct litres sprayed</button></div>` : `<div class="record-actions">
        <button type="button" data-action="edit-tank" data-paddock-id="${paddock.id}" data-tank-id="${tank.id}">Edit tank</button>
        <button class="danger-link" type="button" data-action="delete-tank" data-paddock-id="${paddock.id}" data-tank-id="${tank.id}">Delete</button>
      </div>`}
      <div class="tank-record-meta">
        <span><small>Operator</small><strong>${escapeHtml(tank.operator || "Not set")}</strong></span>
        <span><small>Machine</small><strong>${escapeHtml(tank.machine || "Not set")}</strong></span>
        <span><small>Application</small><strong>${escapeHtml(tank.sprayMethod || "Needs review")}</strong></span>
        ${jobSelection ? `<span><small>Saved total</small><strong>${escapeHtml(formatOptionalHectares(jobSelection.totalHectares))}</strong></span>${isRunAllocation ? "" : `<span><small>Planned for job</small><strong>${escapeHtml(formatOptionalHectares(jobSelection.plannedHectares))}</strong></span>`}` : ""}
        ${isRunAllocation ? `<span><small>Buffer balance</small><strong>${twoDecimals.format(tank.controllerBeforeLitres)} → ${twoDecimals.format(tank.controllerAfterLitres)} L</strong></span>` : ""}
      </div>
      <ul class="tank-products">${products}</ul>

    </article>
  `;
}

function renderPaddockBalance(paddock, records) {
  const balance = calculatePaddockBalance({
    sizeHectares: paddock.sizeHectares,
    records,
  });
  const savedSize = balance.sizeHectares === null
    ? "Not recorded"
    : `${twoDecimals.format(balance.sizeHectares)} ha`;
  const activeEquivalent = balance.includedRecordCount
    ? `${twoDecimals.format(balance.activeSprayEquivalentHectares)} ha`
    : balance.relevantRecordCount
      ? "Unavailable"
      : "0 ha";
  const equivalentCoverage = balance.activeSprayCoveragePercent === null
    ? "Unavailable"
    : `${twoDecimals.format(balance.activeSprayCoveragePercent)}%`;
  const broadacreReportedCoverage = balance.reportedBroadacreCoveragePercent === null
    ? "Unavailable"
    : `${twoDecimals.format(balance.reportedBroadacreCoveragePercent)}%`;
  const broadacreReported = balance.reportedBroadacreHectares === null
    ? "Unavailable"
    : `${twoDecimals.format(balance.reportedBroadacreHectares)} ha · ${broadacreReportedCoverage}`;
  const cameraEquivalent = balance.cameraActiveSprayEquivalentHectares === null
    ? "Unavailable"
    : `${twoDecimals.format(balance.cameraActiveSprayEquivalentHectares)} ha`;

  let onePassMessage = balance.activeSprayState === "unavailable"
    ? "One-paddock comparison unavailable until the invalid saved records are reviewed."
    : "Add a saved paddock total to compare this result with one complete paddock.";
  if (balance.activeSprayVarianceHectares !== null) {
    if (Math.abs(balance.activeSprayVarianceHectares) <= 0.005) {
      onePassMessage = "Calculated active-spray equivalent matches one complete saved paddock.";
    } else if (balance.activeSprayVarianceHectares > 0) {
      onePassMessage = `${twoDecimals.format(balance.activeSprayVarianceHectares)} ha equivalent beyond one complete saved paddock.`;
    } else {
      onePassMessage = `${twoDecimals.format(Math.abs(balance.activeSprayVarianceHectares))} ha equivalent short of one complete saved paddock.`;
    }
  }

  const issueMessages = [...new Set(balance.recordIssues.map((issue) => issue.message))];
  const issueList = issueMessages.length
    ? `<ul class="coverage-issues">${issueMessages.map((message) => `<li>${escapeHtml(message)}</li>`).join("")}</ul>`
    : "";

  const productRows = balance.productSummaries.map((product) => {
    if (product.status === "unavailable") {
      const reason = product.issues[0]?.message || "Required rate or amount details are unavailable.";
      return `<li data-state="unavailable"><strong>${escapeHtml(product.name)}</strong><span>Calculated chemical-equivalent unavailable</span><small>${escapeHtml(reason)}</small></li>`;
    }
    const chemicalCoverage = product.chemicalEquivalentCoveragePercent === null
      ? "saved-total percentage unavailable"
      : `${twoDecimals.format(product.chemicalEquivalentCoveragePercent)}% of saved paddock`;
    const varianceAmount = formatSignedPracticalAmount(product.varianceAmountBase, product.baseUnit);
    const varianceHectares = formatSignedHectares(product.varianceEquivalentHectares);
    let fullPaddockLine;
    if (product.fullPaddockVarianceAmountBase === null) {
      fullPaddockLine = product.rateStatus === "varied"
        ? "One-paddock amount comparison unavailable because saved rates differ."
        : "One-paddock amount comparison unavailable without a saved total and one clear rate.";
    } else {
      fullPaddockLine = `${formatSignedPracticalAmount(product.fullPaddockVarianceAmountBase, product.baseUnit)} against one complete saved paddock.`;
    }
    const warnings = [
      product.status === "partial" ? "Some records were unavailable, so this product result is partial." : "",
      product.incompatibleForm ? "Liquid and mass forms are kept separate and are not combined." : "",
    ].filter(Boolean).join(" ");
    return `<li data-state="${escapeHtml(product.state)}">
      <strong>${escapeHtml(product.name)}</strong>
      <span>Calculated chemical-equivalent: ${twoDecimals.format(product.chemicalEquivalentHectares)} ha · ${escapeHtml(chemicalCoverage)}</span>
      <small>${escapeHtml(`${varianceAmount} (${varianceHectares} equivalent) against calculated active-spray equivalent on records containing this product.`)}</small>
      <small>${escapeHtml(fullPaddockLine)}</small>
      ${warnings ? `<small class="balance-warning">${escapeHtml(warnings)}</small>` : ""}
    </li>`;
  }).join("");
  const chemicalSummary = productRows
    ? `<details class="chemical-equivalent-details"><summary>Chemical-equivalent summary · ${balance.productSummaries.length} product${balance.productSummaries.length === 1 ? "" : "s"}</summary><ul class="chemical-balance-list">${productRows}</ul></details>`
    : `<p>No chemical products are recorded for this paddock.</p>`;

  return `<section class="paddock-balance" data-state="${escapeHtml(balance.activeSprayState)}">
    <div class="paddock-balance-heading"><span><small>Calculated record summary</small><strong>Spray coverage &amp; chemical use</strong></span><b>${escapeHtml(equivalentCoverage)}</b></div>
    <div class="coverage-metrics">
      <span><small>Saved paddock</small><strong>${escapeHtml(savedSize)}</strong></span>
      <span><small>Active-spray equivalent</small><strong>${escapeHtml(activeEquivalent)}</strong></span>
      <span><small>Broadacre reported</small><strong>${escapeHtml(broadacreReported)}</strong></span>
      <span><small>Camera equivalent</small><strong>${escapeHtml(cameraEquivalent)}</strong></span>
    </div>
    <p class="one-pass-reference">${escapeHtml(onePassMessage)}</p>
    <p class="coverage-caveat">Calculated from saved litres and calibrated L/ha. This is not GPS-measured unique ground; Camera passes and overlaps may change actual coverage.</p>
    ${issueList}
    ${chemicalSummary}
  </section>`;
}

function renderPaddockCard(paddock) {
  const records = recordsForPaddock(paddock);
  const exportLockedByActiveRun = paddockHasActiveRunAllocation(paddock.id);
  const hasRunAllocation = paddockHasRunAllocation(paddock.id);
  const totals = getPaddockTotals(paddock);
  const reviewSuffix = totals.unknownMethodRecordCount
    ? ` · ${totals.unknownMethodRecordCount} record${totals.unknownMethodRecordCount === 1 ? " needs" : "s need"} application review`
    : "";
  const headlineCoverage = paddock.sizeHectares
    ? `${twoDecimals.format(totals.hectares)} ${totals.unknownMethodRecordCount ? "confirmed " : ""}Broadacre ha · ${twoDecimals.format(paddock.sizeHectares)} ha paddock${reviewSuffix}`
    : `${twoDecimals.format(totals.hectares)} ${totals.unknownMethodRecordCount ? "confirmed " : ""}Broadacre hectares${reviewSuffix}`;
  const expanded = expandedPaddockId === paddock.id;
  const groupedByDate = new Map();
  [...records]
    .sort((left, right) => {
      const dateOrder = right.date.localeCompare(left.date);
      return dateOrder || new Date(right.savedAt) - new Date(left.savedAt);
    })
    .forEach((tank) => {
      if (!groupedByDate.has(tank.date)) groupedByDate.set(tank.date, []);
      groupedByDate.get(tank.date).push(tank);
    });

  const tankGroups = [...groupedByDate.entries()]
    .map(
      ([date, tanks]) => `
        <section class="date-group">
          <h4>${escapeHtml(formatDate(date))}</h4>
          ${tanks.map((tank) => renderTankRecord(paddock, tank)).join("")}
        </section>
      `,
    )
    .join("");

  const noteEditor = editingNoteId === paddock.id
    ? `
      <div class="note-editor">
        <label for="note-${paddock.id}">Paddock note</label>
        <textarea id="note-${paddock.id}" maxlength="1000" rows="4">${escapeHtml(paddock.note || "")}</textarea>
        <div>
          <button type="button" data-action="save-note" data-paddock-id="${paddock.id}">Save note</button>
          <button type="button" data-action="cancel-note">Cancel</button>
        </div>
      </div>
    `
    : `
      <div class="paddock-note">
        ${paddock.note ? `<p>${escapeHtml(paddock.note)}</p>` : `<p class="muted-note">No paddock note added.</p>`}
        <button type="button" data-action="edit-note" data-paddock-id="${paddock.id}">${paddock.note ? "Edit note" : "Add note"}</button>
      </div>
    `;

  return `
    <article class="paddock-card">
      <button
        class="paddock-card-heading"
        type="button"
        data-action="toggle-paddock"
        data-paddock-id="${paddock.id}"
        aria-expanded="${expanded}"
      >
        <span>
          <strong>${escapeHtml(paddock.name)}</strong>
          <small>${escapeHtml(headlineCoverage)}</small>
        </span>
        <span>
          <b>Paddock total: ${twoDecimals.format(totals.tankTotal)} litres</b>
          <i aria-hidden="true">${expanded ? "−" : "+"}</i>
        </span>
      </button>
      ${renderPaddockRunningSummary(paddock, records)}
      <div class="paddock-completion-controls">
        <p>${isCompletedPaddock(paddock) ? `Completed ${escapeHtml(formatDate(paddock.completedAt.slice(0, 10)))}. Historical corrections remain available; totals may change. Reopen before adding new work.` : "Open for work. Completion is your decision, even above 100%."}</p>
        <button type="button" data-action="${isCompletedPaddock(paddock) ? "reopen-paddock" : "complete-paddock"}" data-paddock-id="${paddock.id}">${isCompletedPaddock(paddock) ? "Reopen paddock" : "Mark paddock completed"}</button>
        ${exportLockedByActiveRun ? '<p class="coverage-caveat">Finish the active Buffer before marking this paddock completed.</p>' : ""}
      </div>
      <div class="paddock-details" ${expanded ? "" : "hidden"}>
        <p class="coverage-caveat">Calculated area from saved records; not GPS-measured unique ground.</p>
        <section class="tank-history">
          <h3>Tank and Buffer records (${records.length})</h3>
          ${tankGroups || '<p class="no-tanks">No tank records saved.</p>'}
        </section>
        <details class="paddock-more-details">
          <summary>Coverage explanation</summary>
          ${renderPaddockBalance(paddock, records)}
        </details>
        <section class="note-section">
          <h3>Notes</h3>
          ${noteEditor}
        </section>
        <div class="paddock-actions">
          <button type="button" data-action="edit-paddock-details" data-paddock-id="${paddock.id}">Edit paddock details</button>
          <button type="button" data-action="export-paddock" data-paddock-id="${paddock.id}" ${exportLockedByActiveRun ? "disabled" : ""}>Export paddock</button>
          <button type="button" data-action="share-paddock" data-paddock-id="${paddock.id}" ${exportLockedByActiveRun ? "disabled" : ""}>Share / Save Copy</button>
        </div>
        <div class="paddock-destructive-actions">
          ${hasRunAllocation
            ? `<button class="danger-button" type="button" data-action="archive-paddock" data-paddock-id="${paddock.id}" ${exportLockedByActiveRun ? "disabled" : ""}>Archive paddock</button>`
            : `<button class="danger-button" type="button" data-action="clear-paddock" data-paddock-id="${paddock.id}" ${exportLockedByActiveRun ? "disabled" : ""}>Clear paddock</button>`}
        </div>
        ${exportLockedByActiveRun ? `<p class="active-run-export-note">Finish the active buffer before exporting, sharing, clearing or archiving this paddock.</p>` : ""}

      </div>
    </article>
  `;
}

function renderArchivedPaddocks() {
  const allArchived = archivedPaddocks(store.paddocks).sort(
    (left, right) => new Date(right.archivedAt) - new Date(left.archivedAt),
  );
  const archived = filterPaddocksByName(allArchived, paddockSearch.value);
  archivedPaddockSection.hidden = archived.length === 0;
  archivedPaddockSummary.textContent = `Archived paddocks · ${archived.length}`;
  const restoreAvailable = canRestorePaddock(store.paddocks, MAX_PADDOCKS);
  archivedPaddockList.innerHTML = archived.map((paddock) => `
    <div class="archived-paddock-row">
      <span>
        <strong>${escapeHtml(paddock.name)}</strong>
        <small>${restoreAvailable ? `Archived ${escapeHtml(formatDate(String(paddock.archivedAt).slice(0, 10)))}` : "Active paddock limit reached"}</small>
      </span>
      <button type="button" data-action="restore-paddock" data-paddock-id="${escapeHtml(paddock.id)}" ${restoreAvailable ? "" : "disabled"}>Restore</button>
    </div>
  `).join("");
}

function renderPaddocks() {
  renderTankRecovery();
  if (storageWriteLocked) {
    paddockCount.textContent = "Records unavailable";
    paddockEmpty.hidden = true;
    paddockList.hidden = true;
    paddockList.replaceChildren();
    archivedPaddockSection.hidden = true;
    archivedPaddockList.replaceChildren();
    return;
  }
  const paddocks = activePaddocks(store.paddocks).sort(
    (left, right) => new Date(right.updatedAt) - new Date(left.updatedAt),
  );
  paddockCount.textContent = `${paddocks.length} of ${MAX_PADDOCKS} paddocks`;
  paddockEmpty.hidden = paddocks.length > 0 || Boolean(paddockSearch.value.trim());
  paddockList.hidden = paddocks.length === 0;
  const matches = filterPaddocksByName(paddocks, paddockSearch.value);
  document.querySelector("#clear-paddock-search").hidden = !paddockSearch.value;
  document.querySelector("#paddock-no-matches").hidden = !paddockSearch.value.trim() || matches.length > 0 || filterPaddocksByName(archivedPaddocks(store.paddocks), paddockSearch.value).length > 0;
  paddockList.innerHTML = matches.map(renderPaddockCard).join("");
  renderArchivedPaddocks();
}

function editTankRecord(paddockId, tankId) {
  const paddock = findPaddock(paddockId);
  const tank = findTank(paddock, tankId);
  if (!paddock || !tank) return;

  if (pendingDraft.status !== "absent") {
    requestTopLevelView("calculator");
    showToast("Resume or discard the unfinished calculation before editing a saved tank.");
    return;
  }
  if (hasCalculationValues() && !window.confirm("Replace the current unfinished calculation with this saved tank for editing?")) return;
  mixVolumeInput.value = tank.tankTotal;
  sprayRateInput.value = tank.sprayRate;
  const requiredRows = Math.max(1, ...tank.products.map((product) => product.slot + 1));
  resetProductRows(requiredRows);
  const rows = [...productList.querySelectorAll(".product-row")];
  tank.products.forEach((product) => {
    rows[product.slot].querySelector(".product-name").value = product.name || "";
    rows[product.slot].querySelector(".product-rate").value = product.rate;
    rows[product.slot].querySelector(".product-unit").value = product.unit;
  });
  editingTankContext = { paddockId, tankId, original: JSON.stringify(tank) };
  editBanner.hidden = false;
  editTitle.textContent = `Editing ${paddock.name} · Tank ${tank.tankNumber}`;
  saveRecordButton.textContent = "Update tank record";
  calculate();
  requestTopLevelView("calculator");
  showToast("Tank record loaded into the calculator.");
}

async function deleteTankRecord(paddockId, tankId) {
  const paddock = findPaddock(paddockId);
  const tank = findTank(paddock, tankId);
  if (!paddock || !tank) return;
  if (storageWriteLocked || pendingPersistence.records) {
    showToast("Resolve unsaved or protected records before deleting a tank.");
    return;
  }
  if (!window.confirm(`Delete Tank ${tank.tankNumber} from ${paddock.name}? Undo will keep only this most recent deletion while saved records remain unchanged.`)) return;
  try {
    const snapshot = structuredClone(store);
    store = await durableWrite(storage => deleteTankWithRecovery(snapshot, paddockId, tankId, storage));
    if (editingTankContext?.tankId === tankId) { clearEditingState(); rememberCalculation(); }
    document.querySelector("#tank-undo-error").hidden = true;
    renderPaddocks();
    showToast(`Tank ${tank.tankNumber} deleted. Undo tank deletion is available above the paddocks.`);
  } catch (error) {
    reconcileRecoveryFailure();
    const message = document.querySelector("#tank-undo-error");
    document.querySelector("#tank-undo").hidden = false;
    message.textContent = `Deletion could not be confirmed: ${error.message} Reload to check saved records before continuing.`;
    message.hidden = false;
  }
}

async function savePaddockNote(paddockId) {
  const paddock = findPaddock(paddockId);
  const textarea = document.querySelector(`#note-${CSS.escape(paddockId)}`);
  if (!paddock || !textarea) return;
  const note = textarea.value.trim();
  if (note !== paddock.note) {
    paddock.note = note;
    bumpContentRevision(paddock);
  }
  const saved = (await persistStore());
  if (!saved) return;
  editingNoteId = null;
  renderPaddocks();
  showToast("Paddock note saved.");
}

async function changePaddockCompletion(paddockId, completed) {
  const paddock = findPaddock(paddockId);
  if (!paddock || isArchivedPaddock(paddock) || isCompletedPaddock(paddock) === completed) return;
  const blocker = getUnsavedBlocker();
  const draft = inspectCalculatorDraft(getStorage());
  const draftBlocks = draft.status !== "absent"
    && (completed || draft.status !== "ready" || draft.value.wasEditing);
  if (blocker || draftBlocks) {
    showToast(blocker?.message || "Save or clear the unfinished calculation before changing paddock completion.");
    return;
  }
  const reason = paddockHasActiveRunAllocation(paddockId)
    ? "Finish the active Buffer before changing this paddock's completion."
    : paddockCompletionBlockReason(paddock, { runs: store.runs });
  if (reason) { showToast(reason); return; }
  const errorElement = { textContent: "", hidden: true };
  if (!canChangeBuffer(errorElement)) { showToast(errorElement.textContent); return; }
  const timestamp = new Date().toISOString();
  const index = store.paddocks.findIndex(record => record.id === paddockId);
  store.paddocks[index] = transitionPaddockCompletion(paddock, completed ? timestamp : null, timestamp);
  const saved = await persistStore();
  if (!saved) { showToast("Paddock status is not saved. Use Retry saving before continuing."); return; }
  refreshSuggestions();
  renderPaddocks();
  renderRunView();
  showToast(`${paddock.name} ${completed ? "marked completed. Reopen it before adding new work" : "reopened for new work"}.`);
}

async function archivePaddock(paddockId) {
  const paddock = findPaddock(paddockId);
  if (!paddock || isArchivedPaddock(paddock) || !paddockHasRunAllocation(paddockId)) return;
  if (paddockHasActiveRunAllocation(paddockId)) {
    showToast("Finish the active buffer before archiving this paddock.");
    return;
  }
  if (!window.confirm(`Archive ${paddock.name}? Its tank and buffer-allocation audit will be retained and can be restored later.`)) return;
  const archivedAt = new Date().toISOString();
  const index = store.paddocks.findIndex((record) => record.id === paddockId);
  store.paddocks[index] = transitionPaddockArchive(paddock, archivedAt, archivedAt);
  if (store.lastPaddockId === paddockId) store.lastPaddockId = null;
  if (expandedPaddockId === paddockId) expandedPaddockId = null;
  const saved = (await persistStore());
  if (!saved) return;
  refreshSuggestions();
  renderPaddocks();
  if (saved) showToast(`${paddock.name} archived. Its full buffer audit was retained.`);
}

async function restorePaddock(paddockId) {
  const paddock = findPaddock(paddockId);
  if (!paddock || !isArchivedPaddock(paddock)) return;
  if (!canRestorePaddock(store.paddocks, MAX_PADDOCKS)) {
    showToast("Twenty-five paddocks are already active. Clear or archive one before restoring this paddock.");
    return;
  }
  const restoredAt = new Date().toISOString();
  const index = store.paddocks.findIndex((record) => record.id === paddockId);
  store.paddocks[index] = transitionPaddockArchive(paddock, null, restoredAt);
  store.lastPaddockId = paddockId;
  expandedPaddockId = paddockId;
  const saved = (await persistStore());
  if (!saved) return;
  refreshSuggestions();
  renderPaddocks();
  if (saved) showToast(`${paddock.name} restored to active paddocks.`);
}

async function clearPaddock(paddockId) {
  const paddock = findPaddock(paddockId);
  if (!paddock) return;
  if (paddockHasActiveRunAllocation(paddockId)) {
    showToast("Finish the active buffer before clearing or archiving this paddock.");
    return;
  }
  if (paddockHasRunAllocation(paddockId)) {
    (await archivePaddock(paddockId));
    return;
  }
  if (!window.confirm(`Clear all records for ${paddock.name}? This cannot be undone.`)) return;
  store.paddocks = store.paddocks.filter((record) => record.id !== paddockId);
  if (store.lastPaddockId === paddockId) store.lastPaddockId = null;
  if (expandedPaddockId === paddockId) expandedPaddockId = null;
  const saved = (await persistStore());
  if (!saved) return;
  refreshSuggestions();
  renderPaddocks();
  if (!saved) return;
  showToast(`${paddock.name} cleared.`);
}

async function downloadBlob(blob, filename) {
  try {
    const result = await saveFileCopy(blob, filename);
    if (result.mode === "cancelled" || result.mode === "saved" || result.mode === "downloaded") return result;
    if (result.mode !== "unsupported") throw new Error("File saving could not be confirmed.");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { mode: "download-started" };
  } catch (error) {
    showToast(error?.message || "The file could not be saved. Try again.", true);
    return { mode: "failed", message: error?.message || "The file could not be saved. Try again." };
  }
}

function recoveryDateStamp() {
  return todayLocal();
}

async function downloadOriginalRecords() {
  if (typeof storeInspection.raw !== "string") return;
  return await downloadBlob(
    new Blob([storeInspection.raw], { type: "application/json;charset=utf-8" }),
    `pallathorpe-paddock-records-original_${recoveryDateStamp()}.json`,
  );
}

async function downloadOriginalProfile() {
  if (typeof profileInspection.raw !== "string") return;
  return await downloadBlob(
    new Blob([profileInspection.raw], { type: "application/json;charset=utf-8" }),
    `pallathorpe-operator-profile-original_${recoveryDateStamp()}.json`,
  );
}

async function downloadUnsavedRecords() {
  const recovery = {
    format: "pallathorpe-spray-recovery",
    version: 1,
    generatedAt: new Date().toISOString(),
    storageKey: STORAGE_KEY,
    pending: { ...pendingPersistence },
    paddockRecords: store,
    paddockLibrary,
    profile,
  };
  const result = await downloadBlob(
    new Blob([`${JSON.stringify(recovery, null, 2)}\n`], {
      type: "application/json;charset=utf-8",
    }),
    `pallathorpe-spray-unsaved-recovery_${recoveryDateStamp()}.json`,
  );
  if (result.mode === "saved") showToast("Recovery copy saved. Changes are still not saved in the app.");
  if (result.mode === "download-started" || result.mode === "downloaded") showToast("Recovery download started. Changes are still not saved in the app.");
}

async function retryPendingPersistence() {
  const retryRecords = pendingPersistence.records;
  const retryProfile = pendingPersistence.profile;
  const retryLibrary = pendingPersistence.library;
  let saved = true;
  if (retryRecords) {
    if (!(await persistStore())) saved = false;
    else {
      renderPaddocks();
      renderRunView();
    }
  }
  if (retryProfile && !(await persistOperatorProfile())) saved = false;
  if (retryLibrary) {
    if (!(await persistLibrary(paddockLibrary))) saved = false;
    else {
      refreshSuggestions();
      renderRunView();
    }
  }
  if (
    saved
    && !pendingPersistence.records
    && !pendingPersistence.profile
    && !pendingPersistence.library
  ) {
    showToast("Unsaved changes are now safely stored.");
  }
}

function savedEquipment(record) {
  if (!record?.machine) return null;
  if (record.equipmentSnapshot) return normalizeEquipmentSnapshot(record.equipmentSnapshot);
  if (!MACHINES.includes(record.machine)) return null;
  return { id: `historical-${record.machine}`, name: record.machine, methods: allowedSprayMethods(record.machine) };
}

function equipmentOptions(record = null, preferredName = "", selectedId = null) {
  const entries = (preferencesUI?.getPreferences()?.equipment || []).filter((entry) => !entry.archived);
  const historical = savedEquipment(record);
  const choice = selectedId !== null ? selectedId : historical ? "__saved_equipment__"
    : entries.find((entry) => entry.name === preferredName)?.id || entries[0]?.id || "";
  const option = (id, snapshot, label) => `<option value="${escapeHtml(id)}" data-equipment="${escapeHtml(JSON.stringify(snapshot))}" ${id === choice ? "selected" : ""}>${escapeHtml(label)}</option>`;
  return '<option value="">Select sprayer</option>'
    + (historical ? option("__saved_equipment__", historical, `${historical.name} (saved job details)`) : "")
    + entries.map((entry) => option(entry.id, equipmentSnapshot(entry), entry.name)).join("");
}

function selectedEquipment(select) {
  const raw = select.selectedOptions?.[0]?.dataset.equipment;
  if (!raw) return null;
  try { return normalizeEquipmentSnapshot(JSON.parse(raw)); } catch { return null; }
}

function populateEquipmentSelect(select, record = null, preferredName = "", selectedId = null) {
  select.innerHTML = equipmentOptions(record, preferredName, selectedId);
  if (selectedId !== null) select.value = selectedId;
}

function refreshEquipmentChoices() {
  for (const [select, methods, note] of [[saveMachine, saveSprayMethod, sprayMethodNote], [runMachine, runSprayMethod, runMethodNote]]) {
    const id = select.value;
    const historical = id === "__saved_equipment__" ? selectedEquipment(select) : null;
    populateEquipmentSelect(select, historical ? { machine: historical.name, equipmentSnapshot: historical } : null, "", id);
    updateMethodOptions(select, methods, note);
  }
}

function machineOptions(selected, record = null) {
  return equipmentOptions(record, selected);
}

function sprayMethodOptions(selected) {
  return [
    `<option value="">Select application</option>`,
    ...SPRAY_METHODS.map(
      (method) => `<option value="${method}" ${method === selected ? "selected" : ""}>${method === "Camera" ? "Camera spray" : method}</option>`,
    ),
  ].join("");
}

function finishShareReview(approved) {
  const review = pendingReview;
  pendingReview = null;
  if (shareReviewDialog.open) shareReviewDialog.close();
  review?.resolve(approved);
}

function ensureShareMetadata(paddock) {
  const issues = missingShareMetadata(exportPaddockView(paddock));
  if (!issues.length) return Promise.resolve(true);

  shareReviewError.hidden = true;
  shareReviewList.innerHTML = issues
    .map((issue) => {
      const tank = findDisplayRecord(paddock, issue.tankId);
      const productFields = (issue.productNamesMissing || [])
        .map((slot) => `
          <label class="review-chemical-field"><span>Product ${slot + 1} chemical name</span><input data-review-product-slot="${slot}" maxlength="80" autocomplete="off" value="${escapeHtml(tank?.products.find((product) => product.slot === slot)?.name || "")}" /></label>
        `)
        .join("");
      return `
        <fieldset class="share-review-row" data-review-tank-id="${escapeHtml(issue.tankId)}">
          <legend>${issue.recordType === "run-allocation" ? `Buffer ${escapeHtml(issue.runNumber)} · Allocation ${escapeHtml(issue.allocationNumber)}` : `Tank ${escapeHtml(issue.tankNumber)}`} · ${escapeHtml(formatDate(issue.date))}</legend>
          <label><span>Operator</span><input data-review-operator maxlength="80" autocomplete="name" value="${escapeHtml(tank?.operator || profile.operator || "")}" /></label>
          <label><span>Machine</span><select data-review-machine>${machineOptions(tank?.machine || profile.lastMachine, tank)}</select></label>
          <label><span>Application</span><select data-review-method>${sprayMethodOptions(tank?.sprayMethod || "Broadacre")}</select></label>
          ${productFields}
        </fieldset>
      `;
    })
    .join("");
  shareReviewDialog.showModal();
  (shareReviewList.querySelector("[data-review-product-slot]") || shareReviewList.querySelector("input"))?.focus();
  return new Promise((resolve) => {
    pendingReview = { paddock, resolve };
  });
}

async function recordGeneratedCopy(paddock, descriptor) {
  paddock.lastGeneratedRevision = descriptor.revision;
  paddock.lastGeneratedAt = descriptor.generatedAt;
  paddock.lastGeneratedLabel = descriptor.label;
  return (await persistStore());
}

async function exportPaddock(paddockId) {
  const paddock = findPaddock(paddockId);
  if (!paddock) return;
  if (paddockHasActiveRunAllocation(paddockId)) {
    showToast("Finish the active buffer before exporting this paddock.");
    return;
  }
  if (!(await ensureShareMetadata(paddock))) return;
  const exportView = exportPaddockView(paddock);
  const descriptor = exportDescriptor(paddock);
  const filenames = buildExportFilenames(exportView, descriptor);
  const csvBlob = new Blob([buildPaddockCsv(exportView, descriptor)], {
    type: "text/csv;charset=utf-8",
  });
  const result = await downloadBlob(csvBlob, filenames.csv);
  if (!["saved", "download-started"].includes(result.mode)) return;
  if (!(await recordGeneratedCopy(paddock, descriptor))) return;
  showToast(result.mode === "saved" ? "CSV copy saved." : "CSV download started.");
}

async function sharePaddock(paddockId) {
  const paddock = findPaddock(paddockId);
  if (paddock && paddockHasActiveRunAllocation(paddockId)) {
    showToast("Finish the active buffer before sharing this paddock.");
    return;
  }
  if (!paddock || !(await ensureShareMetadata(paddock))) return;
  const exportView = exportPaddockView(paddock);
  const descriptor = exportDescriptor(paddock);
  const filenames = buildExportFilenames(exportView, descriptor);
  try {
    const [pdfBytes, csvText] = await Promise.all([
      buildPaddockPdf(exportView, descriptor),
      Promise.resolve(buildPaddockCsv(exportView, descriptor)),
    ]);
    const pdfBlob = new Blob([pdfBytes], { type: "application/pdf" });
    const csvBlob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
    pendingDownloads = {
      pdfBlob,
      csvBlob,
      files: typeof File === "function"
        ? {
            pdf: new File([pdfBlob], filenames.pdf, { type: pdfBlob.type }),
            csv: new File([csvBlob], filenames.csv, { type: csvBlob.type }),
          }
        : { pdf: null, csv: null },
      filenames,
      paddock,
      descriptor,
    };
    downloadDialogMessage.textContent = "Your PDF and CSV copies are prepared. Choose Share or Save.";
    downloadDialog.showModal();
    showToast("PDF and CSV copies are prepared. Choose Share or Save.");
  } catch (error) {
    if (error?.name !== "AbortError") {
      showToast(error?.message || "Copies could not be generated.");
    }
  }
}

function setPendingFileAction(busy) {
  pendingFileAction = busy;
  for (const button of [downloadPdfButton, downloadCsvButton, sharePaddockPdfButton, sharePaddockCsvButton,
    document.querySelector("#close-download-dialog")]) button.disabled = busy;
  downloadDialog.setAttribute("aria-busy", String(busy));
}
function guardDownloadDialogCancel(event) {
  if (pendingFileAction) event.preventDefault();
}

async function sharePendingPaddockFile(kind) {
  const pending = pendingDownloads;
  if (!pending || pendingFileAction) return;
  const file = pending.files?.[kind];
  const label = kind === "pdf" ? "PDF" : "CSV";
  if (!file) {
    downloadDialogMessage.textContent = "File sharing is unavailable. You can still save PDF and CSV copies.";
    return;
  }
  setPendingFileAction(true);
  downloadDialogMessage.textContent = "Opening sharing options...";
  try {
    const result = await handFilesToShareSheet({ navigatorLike: navigator, files: [file],
      title: pending.paddock.name + " spray record",
      text: pending.descriptor.label + " spray record, revision " + pending.descriptor.revision + "." });
    if (result.mode === "shared") {
      const recorded = await recordGeneratedCopy(pending.paddock, pending.descriptor);
      downloadDialogMessage.textContent = label + " copy handed to your phone for sharing." +
        (recorded ? "" : " The export receipt could not be saved in the app. Retry saving records.");
      return;
    }
    downloadDialogMessage.textContent = result.mode === "cancelled" ? "Sharing cancelled. No copy was shared." :
      (result.message || "Sharing is unavailable. You can still save PDF and CSV copies.");
  } catch (error) {
    downloadDialogMessage.textContent = error?.message || "The copy could not be shared. Try again.";
  } finally { setPendingFileAction(false); }
}

preferencesUI = mountSprayPreferencesUI(document, { onChange() {
  refreshEquipmentChoices();
  calculate();
} });
document.querySelector("#saved-rate-buttons").addEventListener("click", (event) => {
  const button = event.target.closest("[data-rate]");
  if (!button) return;
  sprayRateInput.value = button.dataset.rate;
  calculate();
});

viewButtons.forEach((button) => {
  button.addEventListener("click", () => requestTopLevelView(button.dataset.viewButton));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const currentIndex = viewButtons.indexOf(button);
    const nextButton = viewButtons[(currentIndex + direction + viewButtons.length) % viewButtons.length];
    requestTopLevelView(nextButton.dataset.viewButton);
    nextButton.focus();
  });
});

document.querySelectorAll("[data-switch-to-calculator]").forEach((button) => {
  button.addEventListener("click", () => requestTopLevelView("calculator"));
});

mixVolumeInput.addEventListener("input", calculate);
sprayRateInput.addEventListener("input", calculate);
productList.addEventListener("input", calculate);
productList.addEventListener("change", calculate);

addProductButton.addEventListener("click", () => {
  if (visibleProducts >= 6) return;
  visibleProducts += 1;
  addProductRow();
  updateAddButton();
  calculate();
});

saveRecordButton.addEventListener("click", openSaveDialog);
document.querySelector("#edit-saved-tank").addEventListener("click", () => {
  if (lastSavedPaddockId && lastSavedTankId) editTankRecord(lastSavedPaddockId, lastSavedTankId);
});
savePlannedHectares.addEventListener("input", updatePlannedAreaNotice);
saveSprayMethod.addEventListener("change", updatePlannedAreaNotice);
document.querySelector("#use-calculated-area").addEventListener("click", () => {
  savePlannedHectares.value = getCalculation().hectares;
  updatePlannedAreaNotice();
});
document.querySelector("#edit-selected-paddock").addEventListener("click", () => openPaddockDetails(saveLibraryPaddock.value));
document.querySelector("#paddock-details-form").addEventListener("submit", savePaddockDetails);
document.querySelector("#cancel-paddock-details").addEventListener("click", () => document.querySelector("#paddock-details-dialog").close());
document.querySelector("#buffer-correction-form").addEventListener("submit", saveBufferCorrection);
document.querySelector("#buffer-correction-litres").addEventListener("input", updateBufferCorrectionPreview);
document.querySelector("#cancel-buffer-correction").addEventListener("click", () => document.querySelector("#buffer-correction-dialog").close());
runAllocationList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-correct-run]");
  if (button) openBufferCorrection(button.dataset.correctRun, button.dataset.allocationId);
});
document.querySelector("#buffer-completion-view").addEventListener("click", () => requestTopLevelView("paddocks"));
document.querySelector("#finish-buffer-form").addEventListener("submit", confirmFinishBuffer);
document.querySelector("#cancel-finish-buffer").addEventListener("click", () => {
  finishBufferContext = null;
  document.querySelector("#finish-buffer-dialog").close();
});
document.querySelector("#buffer-completion-next").addEventListener("click", () => {
  requestTopLevelView("calculator");
  clearEditingState();
  mixVolumeInput.focus(); mixVolumeInput.select();
  showToast("Review the retained mix for your next tank. No remaining liquid is carried over automatically.");
});
startRunFromCalculatorButton.addEventListener("click", openRunStartDialog);
openRunDialogButton.addEventListener("click", openRunStartDialog);
clearButton.addEventListener("click", async () => (await clearCalculation(true)));
cancelEditButton.addEventListener("click", () => {
  clearEditingState();
  rememberCalculation();
  showToast("Editing cancelled. Values remain as a new calculation; saving again creates a new tank.");
});
saveForm.addEventListener("submit", saveTankRecord);
saveLibraryPaddock.addEventListener("change", () => {
  document.querySelector("#edit-selected-paddock").disabled = !findLibraryEntryById(paddockLibrary, saveLibraryPaddock.value);
  setNewPaddockFields(saveLibraryPaddock, saveNewPaddockFields);
  const entry = libraryEntryFromSelection(saveLibraryPaddock);
  const historyPaddock = saveLibraryPaddock.value.startsWith(HISTORY_PADDOCK_PREFIX)
    ? findPaddock(saveLibraryPaddock.value.slice(HISTORY_PADDOCK_PREFIX.length))
    : null;
  savePaddockTotal.textContent = formatOptionalHectares(entry?.totalHectares ?? historyPaddock?.sizeHectares);
  if (!saveNewPaddockFields.hidden) savePaddockName.focus();
});
savePaddockSize.addEventListener("input", () => {
  if (saveLibraryPaddock.value === NEW_LIBRARY_ENTRY) {
    savePaddockTotal.textContent = formatOptionalHectares(optionalPositiveValue(savePaddockSize));
  }
});
saveMachine.addEventListener("change", () => {
  updateMethodOptions(saveMachine, saveSprayMethod, sprayMethodNote);
  const calculation = getCalculation();
  saveArea.textContent = saveSprayMethod.value === "Camera"
    ? "Camera allocation"
    : `${twoDecimals.format(calculation.hectares)} hectares`;
});
saveSprayMethod.addEventListener("change", () => {
  updateMethodOptions(saveMachine, saveSprayMethod, sprayMethodNote);
  const calculation = getCalculation();
  saveArea.textContent = saveSprayMethod.value === "Camera"
    ? "Camera allocation"
    : `${twoDecimals.format(calculation.hectares)} hectares`;
});
document.querySelector("#close-save-dialog").addEventListener("click", () => saveDialog.close());
document.querySelector("#cancel-save").addEventListener("click", () => saveDialog.close());

runStartForm.addEventListener("submit", startPaddockRun);
runMachine.addEventListener("change", () => updateMethodOptions(runMachine, runSprayMethod, runMethodNote));
runSprayMethod.addEventListener("change", () => updateMethodOptions(runMachine, runSprayMethod, runMethodNote));
runStartLibraryPaddock.addEventListener("change", () => setNewPaddockFields(runStartLibraryPaddock, runStartNewPaddockFields));
runStartAddPaddock.addEventListener("click", addPendingRunSelection);
runStartSelectedPaddocks.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-run-selection]");
  if (!button) return;
  pendingRunSelections = pendingRunSelections.filter(
    (selection) => selection.libraryEntryId !== button.dataset.removeRunSelection,
  );
  renderJobPaddockList(runStartSelectedPaddocks, pendingRunSelections, { removable: true });
  prepareRunSelectionControl(runStartLibraryPaddock, runStartNewPaddockFields, pendingRunSelections);
});
document.querySelector("#close-run-start-dialog").addEventListener("click", () => {
  pendingRunSelections = [];
  runStartDialog.close();
});
document.querySelector("#cancel-run-start").addEventListener("click", () => {
  pendingRunSelections = [];
  runStartDialog.close();
});
activeRunLibraryPaddock.addEventListener("change", () => setNewPaddockFields(activeRunLibraryPaddock, activeRunNewPaddockFields));
activeRunAddPaddock.addEventListener("click", addActiveRunSelection);
runAllocationForm.addEventListener("submit", recordRunAllocation);
runControllerAfter.addEventListener("input", updateRunAllocationPreview);
runPaddockName.addEventListener("change", updateRunSelectedPaddockDetails);
finishRunButton.addEventListener("click", finishActiveRun);
cancelEmptyRunButton.addEventListener("click", cancelActiveEmptyRun);

changeOperatorButton.addEventListener("click", async () => {
  if (profileWriteLocked) {
    renderStorageWarnings();
    profileLockWarning.focus();
    return;
  }
  const response = window.prompt(
    "Operator name for future tank records (leave blank to clear):",
    profile.operator || "",
  );
  if (response === null) return;
  profile.operator = cleanName(response) || null;
  profile.operatorPrompted = true;
  if ((await persistOperatorProfile())) {
    showToast(profile.operator ? `Operator changed to ${profile.operator}.` : "Operator cleared.");
  }
});

shareReviewForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pendingReview) return;
  const updates = [...shareReviewList.querySelectorAll("[data-review-tank-id]")].map((row) => {
    const displayRecord = findDisplayRecord(pendingReview.paddock, row.dataset.reviewTankId);
    return {
      displayRecord,
      source: sourceRecordForDisplay(displayRecord),
      operator: cleanName(row.querySelector("[data-review-operator]").value),
      machine: selectedEquipment(row.querySelector("[data-review-machine]"))?.name || null,
      equipmentSnapshot: selectedEquipment(row.querySelector("[data-review-machine]")),
      sprayMethod: row.querySelector("[data-review-method]").value,
      products: [...row.querySelectorAll("[data-review-product-slot]")].map((input) => ({
        slot: Number(input.dataset.reviewProductSlot),
        name: cleanChemicalName(input.value),
      })),
    };
  });
  const invalid = updates.find((update) =>
    !update.source ||
    !update.operator ||
    !update.equipmentSnapshot ||
    !SPRAY_METHODS.includes(update.sprayMethod) ||
    !allowedSprayMethods(update.machine, update.equipmentSnapshot).includes(update.sprayMethod) ||
    update.products.some((product) => !product.name),
  );
  if (invalid) {
    shareReviewError.textContent = "Enter an operator, choose a compatible machine and application, and complete every chemical name.";
    shareReviewError.hidden = false;
    return;
  }
  const affectedPaddockIds = new Set();
  for (const update of updates) {
    update.source.operator = update.operator;
    update.source.machine = update.machine;
    update.source.equipmentSnapshot = update.equipmentSnapshot;
    update.source.sprayMethod = update.sprayMethod;
    update.products.forEach(({ slot, name }) => {
      const product = update.source.products.find((candidate) => candidate.slot === slot);
      if (!product) return;
      product.name = name;
      product.normalizedName = normalizeChemicalName(name);
    });
    update.source.updatedAt = new Date().toISOString();
    if (update.displayRecord?.recordType === "run-allocation") {
      update.source.allocations.forEach((allocation) => affectedPaddockIds.add(allocation.paddockId));
    } else {
      affectedPaddockIds.add(pendingReview.paddock.id);
    }
  }
  affectedPaddockIds.forEach((paddockId) => {
    const affected = findPaddock(paddockId);
    if (affected) bumpContentRevision(affected);
  });
  if (!profile.operator) profile.operator = updates[0]?.operator || null;
  if (updates.at(-1)?.machine) profile.lastMachine = updates.at(-1).machine;
  profile.operatorPrompted = true;
  if (!(await persistStore())) {
    shareReviewError.textContent = "Tank details could not be saved on this phone.";
    shareReviewError.hidden = false;
    return;
  }
  (await persistOperatorProfile());
  refreshSuggestions();
  renderPaddocks();
  finishShareReview(true);
});
document.querySelector("#close-share-review").addEventListener("click", () => finishShareReview(false));
document.querySelector("#cancel-share-review").addEventListener("click", () => finishShareReview(false));
shareReviewDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  finishShareReview(false);
});

sharePaddockPdfButton.addEventListener("click", async () => (await sharePendingPaddockFile("pdf")));
sharePaddockCsvButton.addEventListener("click", async () => (await sharePendingPaddockFile("csv")));
async function savePendingPaddockFile(kind) {
  const pending = pendingDownloads;
  if (!pending || pendingFileAction) return;
  setPendingFileAction(true);
  downloadDialogMessage.textContent = "Choose where to save the copy...";
  try {
    const result = await downloadBlob(pending[kind + "Blob"], pending.filenames[kind]);
    if (result.mode === "cancelled") { downloadDialogMessage.textContent = "Save cancelled. No copy was saved."; return; }
    if (!["saved", "download-started"].includes(result.mode)) {
      downloadDialogMessage.textContent = result.message || "The copy could not be saved. Try again."; return;
    }
    const recorded = await recordGeneratedCopy(pending.paddock, pending.descriptor);
    const label = kind === "pdf" ? "PDF" : "CSV";
    const message = result.mode === "saved" ? label + " copy saved and verified." : label + " download started. Check your browser downloads.";
    downloadDialogMessage.textContent = message + (recorded ? "" : " The export receipt could not be saved in the app. Retry saving records.");
    showToast(message);
  } catch (error) {
    downloadDialogMessage.textContent = error?.message || "The copy could not be saved. Try again.";
  } finally { setPendingFileAction(false); }
}
downloadPdfButton.addEventListener("click", async () => await savePendingPaddockFile("pdf"));
downloadCsvButton.addEventListener("click", async () => await savePendingPaddockFile("csv"));

document.querySelector("#close-download-dialog").addEventListener("click", () => {
  if (pendingFileAction) return;
  pendingDownloads = null;
  downloadDialog.close();
});
downloadDialog.addEventListener("cancel", guardDownloadDialogCancel);
downloadDialog.addEventListener("close", () => {
  pendingDownloads = null;
});

downloadOriginalRecordsButton.addEventListener("click", downloadOriginalRecords);
downloadOriginalProfileButton.addEventListener("click", downloadOriginalProfile);
downloadUnsavedRecordsButton.addEventListener("click", downloadUnsavedRecords);
retryRecordSaveButton.addEventListener("click", retryPendingPersistence);

paddockList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, paddockId, tankId } = button.dataset;

  if (action === "toggle-paddock") {
    expandedPaddockId = expandedPaddockId === paddockId ? null : paddockId;
    editingNoteId = null;
    renderPaddocks();
  }
  if (action === "edit-note") {
    editingNoteId = paddockId;
    renderPaddocks();
  }
  if (action === "cancel-note") {
    editingNoteId = null;
    renderPaddocks();
  }
  if (action === "save-note") (await savePaddockNote(paddockId));
  if (action === "complete-paddock") await changePaddockCompletion(paddockId, true);
  if (action === "reopen-paddock") await changePaddockCompletion(paddockId, false);
  if (action === "edit-tank") editTankRecord(paddockId, tankId);
  if (action === "correct-buffer") openBufferCorrection(button.dataset.runId, tankId);
  if (action === "edit-paddock-details") {
    refreshPaddockLibrary();
    const paddock = findPaddock(paddockId);
    const entry = libraryEntryForPaddock(paddock);
    openPaddockDetails(entry?.id);
  }
  if (action === "delete-tank") (await deleteTankRecord(paddockId, tankId));
  if (action === "export-paddock") (await exportPaddock(paddockId));
  if (action === "share-paddock") (await sharePaddock(paddockId));
  if (action === "archive-paddock") (await archivePaddock(paddockId));
  if (action === "clear-paddock") (await clearPaddock(paddockId));
});

archivedPaddockList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action='restore-paddock']");
  if (!button) return;
  (await restorePaddock(button.dataset.paddockId));
});

document.querySelector("#resume-calculation").addEventListener("click", () => {
  if (pendingDraft.status !== "ready") return;
  const freshRecords = inspectPaddockStore(getStorage());
  if (!canResumeCalculatorDraft(pendingDraft.value, freshRecords.status === "ready" ? freshRecords.value : store, getStorage())) {
    document.querySelector("#resume-calculation").disabled = true;
    document.querySelector("#draft-recovery-description").textContent = "Saved records or restore history changed or could not be checked. This old draft is retained but cannot safely resume. Start fresh discards it.";
    return;
  }
  const draft = pendingDraft.value;
  mixVolumeInput.value = draft.mixVolume;
  sprayRateInput.value = draft.sprayRate;
  resetProductRows(draft.products.length);
  [...productList.children].forEach((row, index) => {
    row.querySelector(".product-name").value = draft.products[index].name;
    row.querySelector(".product-rate").value = draft.products[index].rateText;
    row.querySelector(".product-unit").value = draft.products[index].unit;
  });
  clearEditingState();
  pendingDraft = { status: "absent" };
  showDraftRecovery();
  calculate();
  if (draft.wasEditing) draftStatus.textContent += " · Resumed as a new calculation; the original tank was not changed.";
  mixVolumeInput.focus();
});
document.querySelector("#start-fresh-calculation").addEventListener("click", async () => {
  if (!(await clearStoredDraft())) return;
  pendingDraft = { status: "absent" };
  showDraftRecovery();
  (await clearCalculation(false, true));
});
document.querySelector("#view-saved-record").addEventListener("click", () => {
  paddockSearch.value = "";
  expandedPaddockId = lastSavedPaddockId;
  requestTopLevelView("paddocks");
});
document.querySelector("#prepare-next-tank").addEventListener("click", () => {
  clearEditingState();
  lastDraftSignature = null;
  rememberCalculation();
  savedTankActions.hidden = true;
  mixVolumeInput.focus();
  mixVolumeInput.select();
  showToast("Mix retained for the next tank. Review tank total, products and units before saving.");
});
paddockSearch.addEventListener("input", renderPaddocks);
document.querySelector("#clear-paddock-search").addEventListener("click", () => {
  paddockSearch.value = "";
  renderPaddocks();
  paddockSearch.focus();
});
document.querySelector("#undo-tank-delete").addEventListener("click", async () => {
  if (storageWriteLocked || pendingPersistence.records) return;
  try {
    const snapshot = structuredClone(store);
    const result = await durableWrite(storage => restoreDeletedTank(snapshot, storage));
    store = result.store;
    expandedPaddockId = result.paddockId;
    document.querySelector("#tank-undo-error").hidden = true;
    renderPaddocks();
    showToast(`Tank ${result.tank.tankNumber} restored.${result.cleared ? "" : " Recovery cleanup failed; duplicate restoration is blocked."}`);
  } catch (error) {
    reconcileRecoveryFailure();
    const message = document.querySelector("#tank-undo-error");
    message.textContent = `Recovery was not confirmed: ${error.message} The recovery copy is retained.`;
    message.hidden = false;
  }
});

renderStorageWarnings();
resetProductRows();
calculate();
draftReady = true;
lastDraftSignature = JSON.stringify(draftInputs());
showDraftRecovery();
renderPaddocks();
renderRunView();
renderOperatorProfile();
refreshSuggestions();

function getResumeInfo() {
  // Home only advertises acknowledged storage, never optimistic in-memory work.
  try {
  const storage = getStorage();
  const records = inspectPaddockStore(storage);
  if (!["ready", "absent"].includes(records.status)) return null;
  const saved = records.status === "ready" ? records.value : normalizePaddockStore({
    version: PADDOCK_STORE_VERSION, paddocks: [], runs: [], activeRunId: null, lastPaddockId: null,
  });
  const run = saved.runs.find(item => item.id === saved.activeRunId && item.status === "active");
  if (run) return { kind: "buffer", title: "Continue Buffer " + run.runNumber,
    detail: twoDecimals.format(currentRunController(run)) + " L calculated remaining", tab: "run" };
  const draft = inspectCalculatorDraft(storage);
  if (draft.status !== "ready" || !canResumeCalculatorDraft(draft.value, saved, storage)) return null;
  return { kind: "draft", title: "Continue calculation", detail: "Unfinished calculation saved on this device", tab: "calculator" };
  } catch { return null; }
}

function getUnsavedBlocker() {
  const blocker = (message, tab) => ({ message, section: "spray", tab });
  if (pendingPersistence.records) return blocker("Spray record changes have not been saved. Retry saving before continuing.", "paddocks");
  if (pendingPersistence.library) return blocker("Paddock changes have not been saved. Retry saving before continuing.", "paddocks");
  if (pendingPersistence.profile) return blocker("Operator details have not been saved. Retry saving before continuing.", "calculator");
  if (draftSaveFailed) return blocker("The unfinished calculation could not be saved. Keep it open and retry before continuing.", "calculator");
  if (queuedDraftSignature !== null) return blocker("Your calculation is still saving. Wait for it to finish.", "calculator");
  if (operationBusy) return blocker("Spray changes are still saving. Wait for them to finish.", "calculator");
  if (preferencesUI?.hasUnsavedChanges()) return blocker("Finish or cancel the open spray preferences editor before continuing.", "calculator");
  if (runControllerAfter.value.trim()) return blocker("Litres sprayed have been entered but not recorded. Save or clear them before continuing.", "run");
  if (pendingRunSelections.length || runStartDialog.open
      || activeRunNewPaddockName.value.trim() || activeRunNewPaddockTotal.value.trim()
      || document.querySelector("#buffer-correction-dialog").open
      || document.querySelector("#finish-buffer-dialog").open)
    return blocker("Finish or cancel the open Buffer changes before continuing.", "run");
  if (editingNoteId || document.querySelector("#paddock-details-dialog").open)
    return blocker("Finish or cancel the paddock editor before continuing.", "paddocks");
  if (saveDialog.open || editingTankContext)
    return blocker("Finish or cancel the tank editor before continuing.", "calculator");
  return null;
}

host.showView = switchView;
return {
  showView: switchView,
  getResumeInfo,
  getUnsavedBlocker,
  renderPaddocks,
  refreshPaddockLibrary,
  hasUnsavedLibraryChanges: () => pendingPersistence.library,
  hasUnsavedChanges: () => pendingPersistence.records || pendingPersistence.profile || pendingPersistence.library
    || operationBusy || draftSaveFailed || queuedDraftSignature !== null
    || Boolean(preferencesUI?.hasUnsavedChanges())
    || Boolean(runControllerAfter.value.trim()) || pendingRunSelections.length > 0
    || Boolean(editingTankContext) || Boolean(editingNoteId) || saveDialog.open || runStartDialog.open
    || document.querySelector("#paddock-details-dialog").open
    || document.querySelector("#buffer-correction-dialog").open
    || document.querySelector("#finish-buffer-dialog").open
    || Boolean(activeRunNewPaddockName.value.trim()) || Boolean(activeRunNewPaddockTotal.value.trim()),
};
}

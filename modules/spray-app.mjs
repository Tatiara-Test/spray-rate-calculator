import { SPRAY_TEMPLATE } from "./spray-template.mjs";
import {
  MACHINES,
  PADDOCK_STORE_VERSION,
  PADDOCKS_KEY,
  PROFILE_VERSION,
  inspectPaddockStore,
  inspectProfileStore,
  persistPaddockStore,
  persistProfile,
} from "./storage.mjs";
import { calculatePaddockBalance } from "./paddock-balance.mjs";
import {
  MAX_ACTIVE_PADDOCKS,
  activePaddocks,
  archivedPaddocks,
  canRestorePaddock,
  findNamedPaddock,
  isArchivedPaddock,
  transitionPaddockArchive,
} from "./paddock-lifecycle.mjs";
import {
  SPRAY_METHODS,
  addRunAllocation,
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
import {
  cleanChemicalName,
  firstIncompleteProductRow,
  normalizeChemicalName,
  productDisplayName,
  snapshotProducts,
  usedCalculatorProducts,
} from "./product-records.mjs";

export function mountSprayApp(host) {
const root = host.shadowRoot || host.attachShadow({ mode: "open" });
root.innerHTML = SPRAY_TEMPLATE;
const browserDocument = globalThis.document;
const document = {
  querySelector: (selector) => root.querySelector(selector),
  querySelectorAll: (selector) => root.querySelectorAll(selector),
  createElement: (...args) => browserDocument.createElement(...args),
  body: root,
};

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
const quickRateButtons = [...document.querySelectorAll("[data-rate]")];
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
const savePaddockName = document.querySelector("#save-paddock-name");
const savePaddockSize = document.querySelector("#save-paddock-size");
const saveSprayDate = document.querySelector("#save-spray-date");
const saveTankTotal = document.querySelector("#save-tank-total");
const saveSprayRate = document.querySelector("#save-spray-rate");
const saveArea = document.querySelector("#save-area");
const saveProductList = document.querySelector("#save-product-list");
const saveError = document.querySelector("#save-error");
const confirmSaveButton = document.querySelector("#confirm-save");
const paddockSuggestions = document.querySelector("#paddock-suggestions");
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

let visibleProducts = 4;
let expandedPaddockId = null;
let editingNoteId = null;
let editingTankContext = null;
let toastTimer = null;
let autoFilledSavePaddockSize = null;
let autoFilledRunPaddockSize = null;
const storeInspection = inspectStore();
const storageWriteLocked = ["corrupt", "future"].includes(storeInspection.status);
let store = storeInspection.status === "ready"
  ? storeInspection.value
  : {
      version: PADDOCK_STORE_VERSION,
      paddocks: [],
      lastPaddockId: null,
      runs: [],
      activeRunId: null,
    };
let profileInspection = inspectProfile();
let profileWriteLocked = ["corrupt", "future"].includes(profileInspection.status);
let profile = profileInspection.status === "ready"
  ? profileInspection.value
  : { version: PROFILE_VERSION, operator: null, operatorPrompted: false, lastMachine: MACHINES[0] };
let pendingReview = null;
let pendingDownloads = null;
const pendingPersistence = { records: false, profile: false };

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
    return inspectPaddockStore();
  } catch (error) {
    return { status: "corrupt", value: null, raw: null, error };
  }
}

function inspectProfile() {
  try {
    return inspectProfileStore();
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
  writeRecoveryWarning.hidden = !pendingPersistence.records && !pendingPersistence.profile;
  paddockStorageStatus.textContent = pendingPersistence.records
    ? "Recent changes are not saved on this device"
    : "Saved on this phone only";
}

function markPersistenceFailure(kind) {
  pendingPersistence[kind] = true;
  renderStorageWarnings();
}

function persistStore() {
  if (storageWriteLocked) {
    renderStorageWarnings();
    storageLockWarning.focus();
    return false;
  }
  try {
    persistPaddockStore(store);
    pendingPersistence.records = false;
    renderStorageWarnings();
    return true;
  } catch {
    markPersistenceFailure("records");
    return false;
  }
}

function persistOperatorProfile() {
  if (profileWriteLocked) {
    renderStorageWarnings();
    profileLockWarning.focus();
    return false;
  }
  try {
    persistProfile(profile);
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

function updateMethodOptions(machineField, methodField, noteField) {
  const permitted = allowedSprayMethods(machineField.value);
  [...methodField.options].forEach((option) => {
    option.disabled = !permitted.includes(option.value);
  });
  if (!permitted.includes(methodField.value)) methodField.value = "Broadacre";
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

function resetProductRows(count = 4) {
  productList.replaceChildren();
  visibleProducts = Math.min(6, Math.max(4, count));
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

  quickRateButtons.forEach((button) => {
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

function clearCalculation(askFirst = true) {
  if (askFirst && hasCalculationValues() && !window.confirm("Clear this calculation?")) return;
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
  return store.runs.some(
    (run) => run.status === "active" && run.allocations.some((allocation) => allocation.paddockId === paddockId),
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
  paddockSuggestions.replaceChildren();
  activePaddocks(store.paddocks)
    .sort((left, right) => left.name.localeCompare(right.name))
    .forEach((paddock) => {
      const option = document.createElement("option");
      option.value = paddock.name;
      paddockSuggestions.append(option);
    });

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

  saveDialogTitle.textContent = editingTank ? "Update tank record" : "Save tank record";
  confirmSaveButton.textContent = editingTank ? "Update tank" : "Save tank";
  savePaddockName.value = defaultPaddock?.name || "";
  savePaddockSize.value = defaultPaddock?.sizeHectares || "";
  autoFilledSavePaddockSize = String(savePaddockSize.value);
  saveSprayDate.value = editingTank?.date || todayLocal();
  saveOperator.value = editingTank?.operator || profile.operator || "";
  saveMachine.value = MACHINES.includes(editingTank?.machine)
    ? editingTank.machine
    : profile.lastMachine || MACHINES[0];
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

  saveDialog.showModal();
  savePaddockName.focus();
}

function buildTankRecord(calculation, existingTank = null) {
  const sprayMethod = SPRAY_METHODS.includes(saveSprayMethod.value)
    ? saveSprayMethod.value
    : null;
  return {
    id: existingTank?.id || newId(),
    tankNumber: existingTank?.tankNumber || null,
    date: saveSprayDate.value,
    savedAt: existingTank?.savedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tankTotal: calculation.litres,
    sprayRate: calculation.sprayRate,
    hectares: sprayMethod === "Broadacre" ? calculation.hectares : 0,
    operator: cleanName(saveOperator.value) || null,
    machine: MACHINES.includes(saveMachine.value) ? saveMachine.value : null,
    sprayMethod,
    recordType: "tank",
    products: snapshotProducts(getUsedProducts(), (product) => canonicalAmount(
        product.rate,
        product.unit,
        calculation.litres,
        calculation.sprayRate,
      )),
  };
}

function tankContentSignature(tank) {
  return JSON.stringify({
    date: tank?.date || "",
    tankTotal: Number(tank?.tankTotal || 0),
    sprayRate: Number(tank?.sprayRate || 0),
    hectares: Number(tank?.hectares || 0),
    operator: tank?.operator || null,
    machine: tank?.machine || null,
    sprayMethod: tank?.sprayMethod || null,
    recordType: tank?.recordType || "tank",
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

function saveTankRecord(event) {
  event.preventDefault();
  if (confirmSaveButton.disabled) return;
  confirmSaveButton.disabled = true;
  saveError.hidden = true;

  const calculation = getCalculation();
  const paddockName = cleanName(savePaddockName.value);
  const paddockSize = optionalPositiveValue(savePaddockSize);
  const selectedMachine = MACHINES.includes(saveMachine.value) ? saveMachine.value : null;
  const selectedMethod = SPRAY_METHODS.includes(saveSprayMethod.value) ? saveSprayMethod.value : null;
  const incompleteProduct = firstIncompleteProductRow(getProductRows());

  if (
    !calculation.valid
    || !paddockName
    || !saveSprayDate.value
    || Number.isNaN(paddockSize)
    || !selectedMethod
    || !allowedSprayMethods(selectedMachine).includes(selectedMethod)
    || incompleteProduct
  ) {
    confirmSaveButton.disabled = false;
    if (incompleteProduct) {
      saveDialog.close();
      validateProductRows();
    } else {
      saveError.textContent = Number.isNaN(paddockSize)
        ? "Paddock size must be left blank or entered as a number greater than zero."
        : !allowedSprayMethods(selectedMachine).includes(selectedMethod)
          ? "Camera spray is available only for 412R and Hayes boom."
          : "Complete the paddock name, date and valid tank calculation.";
      saveError.hidden = false;
    }
    return;
  }

  const archivedTarget = findArchivedPaddockByName(paddockName);
  if (archivedTarget) {
    saveError.textContent = `${archivedTarget.name} is archived. Restore it from Archived paddocks before saving another record to that name.`;
    saveError.hidden = false;
    confirmSaveButton.disabled = false;
    return;
  }

  let targetPaddock = findPaddockByName(paddockName);
  const targetWasExisting = Boolean(targetPaddock);
  const targetNameChanged = targetPaddock ? targetPaddock.name !== paddockName : false;
  const sourcePaddock = editingTankContext
    ? findPaddock(editingTankContext.paddockId)
    : null;
  const existingTank = editingTankContext
    ? findTank(sourcePaddock, editingTankContext.tankId)
    : null;

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

  const tank = buildTankRecord(calculation, existingTank);
  const tankChanged = !existingTank || tankContentSignature(existingTank) !== tankContentSignature(tank);
  const movedTank = Boolean(existingTank && sourcePaddock && sourcePaddock.id !== targetPaddock.id);
  const targetSizeChanged = (targetPaddock.sizeHectares ?? null) !== paddockSize;
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
  targetPaddock.sizeHectares = paddockSize;
  targetPaddock.updatedAt = new Date().toISOString();
  if (targetWasExisting && (tankChanged || movedTank || targetNameChanged || targetSizeChanged)) {
    bumpContentRevision(targetPaddock);
  }
  store.lastPaddockId = targetPaddock.id;

  profile.operatorPrompted = true;
  if (tank.operator) profile.operator = tank.operator;
  if (MACHINES.includes(tank.machine)) profile.lastMachine = tank.machine;

  const recordsSaved = persistStore();
  let profileSaved = false;
  if (recordsSaved) {
    if (!profileWriteLocked) profileSaved = persistOperatorProfile();
  } else if (!profileWriteLocked) {
    markPersistenceFailure("profile");
  }
  refreshSuggestions();

  expandedPaddockId = targetPaddock.id;
  clearEditingState();
  saveDialog.close();
  renderPaddocks();
  if (!recordsSaved) return;
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

function openRunStartDialog() {
  if (getActiveRun()) {
    requestTopLevelView("run");
    showToast("A paddock run is already in progress.");
    return;
  }
  const calculation = getCalculation();
  if (!calculation.valid || !validateProductRows()) {
    requestTopLevelView("calculator");
    showToast("Complete a valid tank mix before starting a run.");
    return;
  }
  runStartError.hidden = true;
  confirmStartRun.disabled = false;
  runDate.value = todayLocal();
  runControllerStart.value = calculation.litres;
  runOperator.value = profile.operator || "";
  runMachine.value = profile.lastMachine || MACHINES[0];
  runSprayMethod.value = "Broadacre";
  updateMethodOptions(runMachine, runSprayMethod, runMethodNote);
  runMixTotal.textContent = `${twoDecimals.format(calculation.litres)} litres`;
  runSprayRate.textContent = `${twoDecimals.format(calculation.sprayRate)} L/ha`;
  runProductCount.textContent = String(getUsedProducts().length);
  runStartDialog.showModal();
  runDate.focus();
}

function startPaddockRun(event) {
  event.preventDefault();
  if (confirmStartRun.disabled || getActiveRun()) return;
  confirmStartRun.disabled = true;
  runStartError.hidden = true;
  const calculation = getCalculation();
  const controllerStartLitres = Number(runControllerStart.value);
  const machine = MACHINES.includes(runMachine.value) ? runMachine.value : null;
  const sprayMethod = SPRAY_METHODS.includes(runSprayMethod.value) ? runSprayMethod.value : null;
  if (
    !calculation.valid
    || !runDate.value
    || !Number.isFinite(controllerStartLitres)
    || controllerStartLitres <= 0
    || controllerStartLitres > 5000
    || !sprayMethod
    || !allowedSprayMethods(machine).includes(sprayMethod)
  ) {
    runStartError.textContent = controllerStartLitres > 5000
      ? "Controller start cannot exceed 5,000 litres."
      : "Complete the date, controller start, machine and compatible application method.";
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
      sprayMethod,
      controllerStartLitres: validatedControllerStart,
      sprayRate: calculation.sprayRate,
      products: snapshotProducts(getUsedProducts(), (product) => canonicalAmount(
        product.rate,
        product.unit,
        validatedControllerStart,
        calculation.sprayRate,
      )),
    });
    store.runs.push(run);
    store.activeRunId = run.id;
    profile.operatorPrompted = true;
    if (run.operator) profile.operator = run.operator;
    if (run.machine) profile.lastMachine = run.machine;
    const recordsSaved = persistStore();
    if (recordsSaved && !profileWriteLocked) persistOperatorProfile();
    runStartDialog.close();
    requestTopLevelView("run");
    renderRunView();
    if (recordsSaved) showToast(`Run ${run.runNumber} started. Record the first controller boundary.`);
  } catch (error) {
    runStartError.textContent = error?.message || "The run could not be started.";
    runStartError.hidden = false;
    confirmStartRun.disabled = false;
  }
}

function ensureRunPaddock(name, sizeHectares) {
  const archivedTarget = findArchivedPaddockByName(name);
  if (archivedTarget) {
    throw new Error(`${archivedTarget.name} is archived. Restore it from Archived paddocks before recording another allocation to that name.`);
  }
  let paddock = findPaddockByName(name);
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
    if (sizeHectares !== null) paddock.sizeHectares = sizeHectares;
    paddock.name = name;
    paddock.normalizedName = normalizeName(name);
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

function updateRunAllocationPreview() {
  const run = getActiveRun();
  if (!run) return;
  const before = currentRunController(run);
  const after = Number(runControllerAfter.value);
  if (runControllerAfter.value === "" || !Number.isFinite(after)) {
    runAllocationPreview.textContent = "Enter the next controller reading.";
    return;
  }
  if (after < 0 || after > before) {
    runAllocationPreview.textContent = "The reading must stay between zero and the controller-before value.";
    return;
  }
  const used = before - after;
  runAllocationPreview.textContent = run.sprayMethod === "Broadacre"
    ? `${twoDecimals.format(used)} L used · ${twoDecimals.format(used / run.sprayRate)} ha allocated`
    : `${twoDecimals.format(used)} L allocated · Camera spray does not calculate whole-paddock hectares`;
}

function recordRunAllocation(event) {
  event.preventDefault();
  const run = getActiveRun();
  if (!run) return;
  runAllocationError.hidden = true;
  const paddockName = cleanName(runPaddockName.value);
  const paddockSize = optionalPositiveValue(runPaddockSize);
  const before = currentRunController(run);
  const after = Number(runControllerAfter.value);
  if (
    !paddockName
    || Number.isNaN(paddockSize)
    || runControllerAfter.value === ""
    || !Number.isFinite(after)
    || after < 0
    || after >= before
  ) {
    runAllocationError.textContent = Number.isNaN(paddockSize)
      ? "Paddock size must be blank or greater than zero."
      : after === before
        ? "The controller reading has not changed; no liquid can be allocated."
        : "Enter a paddock and a controller-after reading below the controller-before value.";
    runAllocationError.hidden = false;
    return;
  }
  try {
    const { paddock } = ensureRunPaddock(paddockName, paddockSize);
    const timestamp = new Date().toISOString();
    const updatedRun = addRunAllocation(run, {
      id: newId(),
      paddockId: paddock.id,
      paddockName: paddock.name,
      paddockSizeHectares: paddock.sizeHectares,
      controllerAfterLitres: after,
      savedAt: timestamp,
    });
    store.runs[store.runs.findIndex((item) => item.id === run.id)] = updatedRun;
    const saved = persistStore();
    runPaddockName.value = "";
    runPaddockSize.value = "";
    autoFilledRunPaddockSize = null;
    runControllerAfter.value = "";
    refreshSuggestions();
    renderRunView();
    renderPaddocks();
    if (saved) showToast(`${twoDecimals.format(before - after)} litres allocated to ${paddock.name}.`);
  } catch (error) {
    runAllocationError.textContent = error?.message || "The paddock allocation could not be recorded.";
    runAllocationError.hidden = false;
  }
}

function finishActiveRun() {
  const run = getActiveRun();
  if (!run) return;
  if (!run.allocations.length) {
    runAllocationError.textContent = "Record at least one paddock, or cancel the empty run.";
    runAllocationError.hidden = false;
    return;
  }
  if (!window.confirm(`Finish Run ${run.runNumber} at ${twoDecimals.format(currentRunController(run))} litres remaining?`)) return;
  const completed = completePaddockRun(run, new Date().toISOString());
  store.runs[store.runs.findIndex((item) => item.id === run.id)] = completed;
  store.activeRunId = null;
  const saved = persistStore();
  renderRunView();
  renderPaddocks();
  if (saved) showToast(`Run ${run.runNumber} finished with ${twoDecimals.format(completed.controllerFinalLitres)} litres remaining.`);
}

function cancelActiveEmptyRun() {
  const run = getActiveRun();
  if (!run || run.allocations.length) return;
  if (!window.confirm(`Cancel empty Run ${run.runNumber}? Its cancelled audit record will be retained.`)) return;
  const cancelled = cancelEmptyPaddockRun(run, new Date().toISOString());
  store.runs[store.runs.findIndex((item) => item.id === run.id)] = cancelled;
  store.activeRunId = null;
  const saved = persistStore();
  renderRunView();
  if (saved) showToast(`Empty Run ${run.runNumber} cancelled; its audit record was retained.`);
}

function renderRunView() {
  const calculation = getCalculation();
  const activeRun = getActiveRun();
  runCalculationStatus.textContent = calculation.valid
    ? `${twoDecimals.format(calculation.litres)} L at ${twoDecimals.format(calculation.sprayRate)} L/ha is ready in Calculator.`
    : "Set up a tank mix in Calculator, then start a run.";
  openRunDialogButton.disabled = !calculation.valid || Boolean(activeRun) || storageWriteLocked;
  startRunFromCalculatorButton.disabled = !calculation.valid || storageWriteLocked;
  runEmptyCard.hidden = Boolean(activeRun);
  activeRunCard.hidden = !activeRun;
  if (!activeRun) return;
  const before = currentRunController(activeRun);
  const allocated = Number(activeRun.controllerStartLitres) - before;
  activeRunTitle.textContent = `Run ${activeRun.runNumber}`;
  activeRunMethod.textContent = activeRun.sprayMethod === "Camera" ? "Camera spray" : "Broadacre";
  activeRunMeta.innerHTML = `
    <span><small>Operator</small><strong>${escapeHtml(activeRun.operator || "Not set")}</strong></span>
    <span><small>Machine</small><strong>${escapeHtml(activeRun.machine || "Not set")}</strong></span>
    <span><small>Started</small><strong>${twoDecimals.format(activeRun.controllerStartLitres)} L</strong></span>
    <span><small>Allocated so far</small><strong>${twoDecimals.format(allocated)} L</strong></span>
  `;
  runControllerBefore.textContent = `${twoDecimals.format(before)} L`;
  runControllerAfter.max = String(before);
  runAllocationList.innerHTML = activeRun.allocations.length
    ? materializeRunAllocations(activeRun).map((record) => `
        <div class="run-allocation-row"><span><strong>${escapeHtml(record.paddockName)}</strong><small>${twoDecimals.format(record.controllerBeforeLitres)} → ${twoDecimals.format(record.controllerAfterLitres)} L</small></span><b>${twoDecimals.format(record.litresUsed)} L${record.sprayMethod === "Broadacre" ? ` · ${twoDecimals.format(record.hectares)} ha` : " · Camera"}</b></div>
      `).join("")
    : `<p class="no-tanks">No paddocks recorded yet.</p>`;
  finishRunButton.disabled = activeRun.allocations.length === 0;
  cancelEmptyRunButton.hidden = activeRun.allocations.length > 0;
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
          <strong>${isRunAllocation ? `Run ${tank.runNumber} · Allocation ${tank.allocationNumber}` : `Tank ${tank.tankNumber}`}</strong>
          <span>${pendingPersistence.records ? "Not saved on this device" : `${isRunAllocation && tank.runStatus === "active" ? "Active run · recorded" : "Saved"} ${escapeHtml(formatTime(tank.savedAt))}`}</span>
        </div>
        <b>${isRunAllocation ? "Allocated" : "Tank total"}: ${twoDecimals.format(tank.tankTotal)} litres</b>
      </div>
      <div class="tank-stats">
        <span>${twoDecimals.format(tank.sprayRate)} L/ha</span>
        <span>${tank.sprayMethod === "Camera" ? "Camera · liquid allocation only" : `${twoDecimals.format(tank.hectares)} hectares`}</span>
      </div>
      <div class="tank-record-meta">
        <span><small>Operator</small><strong>${escapeHtml(tank.operator || "Not set")}</strong></span>
        <span><small>Machine</small><strong>${escapeHtml(tank.machine || "Not set")}</strong></span>
        <span><small>Application</small><strong>${escapeHtml(tank.sprayMethod || "Needs review")}</strong></span>
        ${isRunAllocation ? `<span><small>Controller</small><strong>${twoDecimals.format(tank.controllerBeforeLitres)} → ${twoDecimals.format(tank.controllerAfterLitres)} L</strong></span>` : ""}
      </div>
      <ul class="tank-products">${products}</ul>
      ${isRunAllocation ? "" : `<div class="record-actions">
        <button type="button" data-action="edit-tank" data-paddock-id="${paddock.id}" data-tank-id="${tank.id}">Edit tank</button>
        <button class="danger-link" type="button" data-action="delete-tank" data-paddock-id="${paddock.id}" data-tank-id="${tank.id}">Delete</button>
      </div>`}
    </article>
  `;
}

function renderPaddockBalance(paddock, records) {
  const balance = calculatePaddockBalance({
    sizeHectares: paddock.sizeHectares,
    records,
  });
  let title = "Coverage reference";
  let message;
  if (balance.state === "missing-size") {
    message = "Add an optional paddock size the next time you save a record to compare Broadacre coverage.";
  } else if (balance.state === "unknown-method") {
    message = `${balance.unknownMethodRecordCount} legacy record${balance.unknownMethodRecordCount === 1 ? " needs" : "s need"} an application method before a whole-paddock balance can be shown.`;
  } else if (balance.state === "matched") {
    title = "Broadacre coverage matches";
    message = `${twoDecimals.format(balance.broadacreHectares)} ha recorded against a ${twoDecimals.format(balance.sizeHectares)} ha paddock.`;
  } else if (balance.state === "remaining") {
    title = `${twoDecimals.format(Math.abs(balance.varianceHectares))} ha remaining`;
    message = `${twoDecimals.format(balance.broadacreHectares)} ha of Broadacre coverage is recorded against the ${twoDecimals.format(balance.sizeHectares)} ha paddock size.`;
  } else {
    title = `${twoDecimals.format(balance.varianceHectares)} ha above paddock size`;
    message = `${twoDecimals.format(balance.broadacreHectares)} ha of Broadacre coverage is recorded against the ${twoDecimals.format(balance.sizeHectares)} ha paddock size.`;
  }
  const cameraMessage = balance.cameraRecordCount
    ? `<p>${twoDecimals.format(balance.cameraLitres)} L recorded as Camera allocation; it is excluded from whole-paddock coverage.</p>`
    : "";
  const chemicalRows = balance.chemicalVariances.length
    ? `<ul class="chemical-balance-list">${balance.chemicalVariances.map((chemical) => {
        const difference = formatPracticalAmount(Math.abs(chemical.varianceAmountBase), chemical.baseUnit);
        const relation = chemical.state === "matched"
          ? "matches one full-paddock mix amount"
          : chemical.state === "over"
            ? `${difference} above one full-paddock mix amount`
            : `${difference} below one full-paddock mix amount`;
        return `<li><strong>${escapeHtml(chemical.name)}: ${escapeHtml(relation)}</strong><small>Recorded Broadacre tank-mix equivalent; not a claim of chemical discharged.</small></li>`;
      }).join("")}</ul>`
    : "";
  return `<section class="paddock-balance" data-state="${balance.state}"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p>${cameraMessage}${chemicalRows}</section>`;
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
  const chemicalTotals = totals.chemicals.length
    ? totals.chemicals
        .map(
          (chemical) => `
            <li>
              <span>${escapeHtml(chemical.name)}</span>
              <strong>${escapeHtml(formatPracticalAmount(chemical.amountBase, chemical.baseUnit))}</strong>
            </li>
          `,
        )
        .join("")
    : `<li class="record-empty-product">No chemical totals recorded</li>`;

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
      <div class="paddock-details" ${expanded ? "" : "hidden"}>
        <section class="chemical-totals">
          <h3>Chemical totals</h3>
          <ul>${chemicalTotals}</ul>
        </section>
        ${renderPaddockBalance(paddock, records)}
        <section class="note-section">
          <h3>Notes</h3>
          ${noteEditor}
        </section>
        <div class="paddock-actions">
          <button type="button" data-action="export-paddock" data-paddock-id="${paddock.id}" ${exportLockedByActiveRun ? "disabled" : ""}>Export paddock</button>
          <button type="button" data-action="share-paddock" data-paddock-id="${paddock.id}" ${exportLockedByActiveRun ? "disabled" : ""}>Share / Save Copy</button>
          ${hasRunAllocation
            ? `<button class="danger-button" type="button" data-action="archive-paddock" data-paddock-id="${paddock.id}" ${exportLockedByActiveRun ? "disabled" : ""}>Archive paddock</button>`
            : `<button class="danger-button" type="button" data-action="clear-paddock" data-paddock-id="${paddock.id}">Clear paddock</button>`}
        </div>
        ${exportLockedByActiveRun ? `<p class="active-run-export-note">Finish the active run before exporting, sharing or archiving this paddock.</p>` : ""}
        <details class="tank-history">
          <summary>Tank and run records · ${records.length}</summary>
          ${tankGroups || `<p class="no-tanks">No tank records saved.</p>`}
        </details>
      </div>
    </article>
  `;
}

function renderArchivedPaddocks() {
  const archived = archivedPaddocks(store.paddocks).sort(
    (left, right) => new Date(right.archivedAt) - new Date(left.archivedAt),
  );
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
  paddockEmpty.hidden = paddocks.length > 0;
  paddockList.hidden = paddocks.length === 0;
  paddockList.innerHTML = paddocks.map(renderPaddockCard).join("");
  renderArchivedPaddocks();
}

function editTankRecord(paddockId, tankId) {
  const paddock = findPaddock(paddockId);
  const tank = findTank(paddock, tankId);
  if (!paddock || !tank) return;

  mixVolumeInput.value = tank.tankTotal;
  sprayRateInput.value = tank.sprayRate;
  const requiredRows = Math.max(4, ...tank.products.map((product) => product.slot + 1));
  resetProductRows(requiredRows);
  const rows = [...productList.querySelectorAll(".product-row")];
  tank.products.forEach((product) => {
    rows[product.slot].querySelector(".product-name").value = product.name || "";
    rows[product.slot].querySelector(".product-rate").value = product.rate;
    rows[product.slot].querySelector(".product-unit").value = product.unit;
  });
  editingTankContext = { paddockId, tankId };
  editBanner.hidden = false;
  editTitle.textContent = `Editing ${paddock.name} · Tank ${tank.tankNumber}`;
  saveRecordButton.textContent = "Update tank record";
  calculate();
  requestTopLevelView("calculator");
  showToast("Tank record loaded into the calculator.");
}

function deleteTankRecord(paddockId, tankId) {
  const paddock = findPaddock(paddockId);
  const tank = findTank(paddock, tankId);
  if (!paddock || !tank) return;
  if (!window.confirm(`Delete Tank ${tank.tankNumber} from ${paddock.name}?`)) return;
  paddock.tanks = paddock.tanks.filter((record) => record.id !== tankId);
  bumpContentRevision(paddock);
  const saved = persistStore();
  renderPaddocks();
  if (!saved) return;
  showToast(`Tank ${tank.tankNumber} deleted.`);
}

function savePaddockNote(paddockId) {
  const paddock = findPaddock(paddockId);
  const textarea = document.querySelector(`#note-${CSS.escape(paddockId)}`);
  if (!paddock || !textarea) return;
  const note = textarea.value.trim();
  if (note !== paddock.note) {
    paddock.note = note;
    bumpContentRevision(paddock);
  }
  editingNoteId = null;
  const saved = persistStore();
  renderPaddocks();
  if (!saved) return;
  showToast("Paddock note saved.");
}

function archivePaddock(paddockId) {
  const paddock = findPaddock(paddockId);
  if (!paddock || isArchivedPaddock(paddock) || !paddockHasRunAllocation(paddockId)) return;
  if (paddockHasActiveRunAllocation(paddockId)) {
    showToast("Finish the active run before archiving this paddock.");
    return;
  }
  if (!window.confirm(`Archive ${paddock.name}? Its tank and controller-run audit will be retained and can be restored later.`)) return;
  const archivedAt = new Date().toISOString();
  const index = store.paddocks.findIndex((record) => record.id === paddockId);
  store.paddocks[index] = transitionPaddockArchive(paddock, archivedAt, archivedAt);
  if (store.lastPaddockId === paddockId) store.lastPaddockId = null;
  if (expandedPaddockId === paddockId) expandedPaddockId = null;
  const saved = persistStore();
  refreshSuggestions();
  renderPaddocks();
  if (saved) showToast(`${paddock.name} archived. Its full run audit was retained.`);
}

function restorePaddock(paddockId) {
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
  const saved = persistStore();
  refreshSuggestions();
  renderPaddocks();
  if (saved) showToast(`${paddock.name} restored to active paddocks.`);
}

function clearPaddock(paddockId) {
  const paddock = findPaddock(paddockId);
  if (!paddock) return;
  if (paddockHasRunAllocation(paddockId)) {
    archivePaddock(paddockId);
    return;
  }
  if (!window.confirm(`Clear all records for ${paddock.name}? This cannot be undone.`)) return;
  store.paddocks = store.paddocks.filter((record) => record.id !== paddockId);
  if (store.lastPaddockId === paddockId) store.lastPaddockId = null;
  if (expandedPaddockId === paddockId) expandedPaddockId = null;
  const saved = persistStore();
  refreshSuggestions();
  renderPaddocks();
  if (!saved) return;
  showToast(`${paddock.name} cleared.`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function recoveryDateStamp() {
  return todayLocal();
}

function downloadOriginalRecords() {
  if (typeof storeInspection.raw !== "string") return;
  downloadBlob(
    new Blob([storeInspection.raw], { type: "application/json;charset=utf-8" }),
    `pallathorpe-paddock-records-original_${recoveryDateStamp()}.json`,
  );
}

function downloadOriginalProfile() {
  if (typeof profileInspection.raw !== "string") return;
  downloadBlob(
    new Blob([profileInspection.raw], { type: "application/json;charset=utf-8" }),
    `pallathorpe-operator-profile-original_${recoveryDateStamp()}.json`,
  );
}

function downloadUnsavedRecords() {
  const recovery = {
    format: "pallathorpe-spray-recovery",
    version: 1,
    generatedAt: new Date().toISOString(),
    storageKey: STORAGE_KEY,
    pending: { ...pendingPersistence },
    paddockRecords: store,
    profile,
  };
  downloadBlob(
    new Blob([`${JSON.stringify(recovery, null, 2)}\n`], {
      type: "application/json;charset=utf-8",
    }),
    `pallathorpe-spray-unsaved-recovery_${recoveryDateStamp()}.json`,
  );
  showToast("Recovery copy downloaded. Changes are still not saved in the app.");
}

function retryPendingPersistence() {
  const retryRecords = pendingPersistence.records;
  const retryProfile = pendingPersistence.profile;
  let saved = true;
  if (retryRecords) {
    if (!persistStore()) saved = false;
    else renderPaddocks();
  }
  if (retryProfile && !persistOperatorProfile()) saved = false;
  if (saved && !pendingPersistence.records && !pendingPersistence.profile) {
    showToast("Unsaved changes are now safely stored.");
  }
}

function machineOptions(selected) {
  return [
    `<option value="">Select machine</option>`,
    ...MACHINES.map(
      (machine) => `<option value="${escapeHtml(machine)}" ${machine === selected ? "selected" : ""}>${escapeHtml(machine)}</option>`,
    ),
  ].join("");
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
          <legend>${issue.recordType === "run-allocation" ? `Run ${escapeHtml(issue.runNumber)} · Allocation ${escapeHtml(issue.allocationNumber)}` : `Tank ${escapeHtml(issue.tankNumber)}`} · ${escapeHtml(formatDate(issue.date))}</legend>
          <label><span>Operator</span><input data-review-operator maxlength="80" autocomplete="name" value="${escapeHtml(tank?.operator || profile.operator || "")}" /></label>
          <label><span>Machine</span><select data-review-machine>${machineOptions(tank?.machine || profile.lastMachine)}</select></label>
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

function recordGeneratedCopy(paddock, descriptor) {
  paddock.lastGeneratedRevision = descriptor.revision;
  paddock.lastGeneratedAt = descriptor.generatedAt;
  paddock.lastGeneratedLabel = descriptor.label;
  return persistStore();
}

async function exportPaddock(paddockId) {
  const paddock = findPaddock(paddockId);
  if (!paddock) return;
  if (paddockHasActiveRunAllocation(paddockId)) {
    showToast("Finish the active run before exporting this paddock.");
    return;
  }
  if (!(await ensureShareMetadata(paddock))) return;
  const exportView = exportPaddockView(paddock);
  const descriptor = exportDescriptor(paddock);
  const filenames = buildExportFilenames(exportView, descriptor);
  const csvBlob = new Blob([buildPaddockCsv(exportView, descriptor)], {
    type: "text/csv;charset=utf-8",
  });
  downloadBlob(csvBlob, filenames.csv);
  if (!recordGeneratedCopy(paddock, descriptor)) return;
  showToast("CSV copy ready on this phone.");
}

async function sharePaddock(paddockId) {
  const paddock = findPaddock(paddockId);
  if (paddock && paddockHasActiveRunAllocation(paddockId)) {
    showToast("Finish the active run before sharing this paddock.");
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
    const canBuildFiles = typeof File === "function";
    const files = canBuildFiles
      ? [
          new File([pdfBlob], filenames.pdf, { type: pdfBlob.type }),
          new File([csvBlob], filenames.csv, { type: csvBlob.type }),
        ]
      : [];
    const shareResult = await handFilesToShareSheet({
      navigatorLike: navigator,
      files,
      title: `${paddock.name} spray record`,
      text: `${descriptor.label} spray record, revision ${descriptor.revision}.`,
    });
    if (shareResult.mode === "shared") {
      if (!recordGeneratedCopy(paddock, descriptor)) return;
      showToast("Copies handed to your phone for sharing.");
      return;
    }
    if (shareResult.mode === "cancelled") return;
    const nativeShareFailed = shareResult.reason === "share-failed";
    downloadDialogMessage.textContent = nativeShareFailed
      ? "Native sharing was unavailable. Your PDF and CSV copies are ready to download."
      : "Your phone cannot share both files together. Download each copy, then choose where to save or send it.";
    pendingDownloads = { pdfBlob, csvBlob, filenames, paddock, descriptor };
    downloadDialog.showModal();
    if (!recordGeneratedCopy(paddock, descriptor)) return;
    showToast(nativeShareFailed
      ? "Native sharing was unavailable. PDF and CSV copies are ready to download."
      : "PDF and CSV copies are ready to download.");
  } catch (error) {
    if (error?.name !== "AbortError") {
      showToast(error?.message || "Copies could not be generated.");
    }
  }
}

quickRateButtons.forEach((button) => {
  button.addEventListener("click", () => {
    sprayRateInput.value = button.dataset.rate;
    calculate();
  });
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
startRunFromCalculatorButton.addEventListener("click", openRunStartDialog);
openRunDialogButton.addEventListener("click", openRunStartDialog);
clearButton.addEventListener("click", () => clearCalculation(true));
cancelEditButton.addEventListener("click", () => {
  clearEditingState();
  showToast("Record editing cancelled.");
});
saveForm.addEventListener("submit", saveTankRecord);
savePaddockName.addEventListener("input", () => {
  const paddock = findPaddockByName(cleanName(savePaddockName.value));
  if (paddock) {
    savePaddockSize.value = paddock.sizeHectares || "";
    autoFilledSavePaddockSize = String(savePaddockSize.value);
  } else if (autoFilledSavePaddockSize !== null && savePaddockSize.value === autoFilledSavePaddockSize) {
    savePaddockSize.value = "";
    autoFilledSavePaddockSize = "";
  }
});
savePaddockSize.addEventListener("input", () => {
  autoFilledSavePaddockSize = null;
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
document.querySelector("#close-run-start-dialog").addEventListener("click", () => runStartDialog.close());
document.querySelector("#cancel-run-start").addEventListener("click", () => runStartDialog.close());
runAllocationForm.addEventListener("submit", recordRunAllocation);
runControllerAfter.addEventListener("input", updateRunAllocationPreview);
runPaddockName.addEventListener("input", () => {
  const paddock = findPaddockByName(cleanName(runPaddockName.value));
  if (paddock) {
    runPaddockSize.value = paddock.sizeHectares || "";
    autoFilledRunPaddockSize = String(runPaddockSize.value);
  } else if (autoFilledRunPaddockSize !== null && runPaddockSize.value === autoFilledRunPaddockSize) {
    runPaddockSize.value = "";
    autoFilledRunPaddockSize = "";
  }
});
runPaddockSize.addEventListener("input", () => {
  autoFilledRunPaddockSize = null;
});
finishRunButton.addEventListener("click", finishActiveRun);
cancelEmptyRunButton.addEventListener("click", cancelActiveEmptyRun);

changeOperatorButton.addEventListener("click", () => {
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
  if (persistOperatorProfile()) {
    showToast(profile.operator ? `Operator changed to ${profile.operator}.` : "Operator cleared.");
  }
});

shareReviewForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!pendingReview) return;
  const updates = [...shareReviewList.querySelectorAll("[data-review-tank-id]")].map((row) => {
    const displayRecord = findDisplayRecord(pendingReview.paddock, row.dataset.reviewTankId);
    return {
      displayRecord,
      source: sourceRecordForDisplay(displayRecord),
      operator: cleanName(row.querySelector("[data-review-operator]").value),
      machine: row.querySelector("[data-review-machine]").value,
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
    !MACHINES.includes(update.machine) ||
    !SPRAY_METHODS.includes(update.sprayMethod) ||
    !allowedSprayMethods(update.machine).includes(update.sprayMethod) ||
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
  if (!persistStore()) {
    shareReviewError.textContent = "Tank details could not be saved on this phone.";
    shareReviewError.hidden = false;
    return;
  }
  persistOperatorProfile();
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

downloadPdfButton.addEventListener("click", () => {
  if (!pendingDownloads) return;
  downloadBlob(pendingDownloads.pdfBlob, pendingDownloads.filenames.pdf);
  showToast("PDF copy ready on this phone.");
});
downloadCsvButton.addEventListener("click", () => {
  if (!pendingDownloads) return;
  downloadBlob(pendingDownloads.csvBlob, pendingDownloads.filenames.csv);
  showToast("CSV copy ready on this phone.");
});
document.querySelector("#close-download-dialog").addEventListener("click", () => {
  pendingDownloads = null;
  downloadDialog.close();
});
downloadDialog.addEventListener("close", () => {
  pendingDownloads = null;
});

downloadOriginalRecordsButton.addEventListener("click", downloadOriginalRecords);
downloadOriginalProfileButton.addEventListener("click", downloadOriginalProfile);
downloadUnsavedRecordsButton.addEventListener("click", downloadUnsavedRecords);
retryRecordSaveButton.addEventListener("click", retryPendingPersistence);

paddockList.addEventListener("click", (event) => {
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
  if (action === "save-note") savePaddockNote(paddockId);
  if (action === "edit-tank") editTankRecord(paddockId, tankId);
  if (action === "delete-tank") deleteTankRecord(paddockId, tankId);
  if (action === "export-paddock") exportPaddock(paddockId);
  if (action === "share-paddock") sharePaddock(paddockId);
  if (action === "archive-paddock") archivePaddock(paddockId);
  if (action === "clear-paddock") clearPaddock(paddockId);
});

archivedPaddockList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='restore-paddock']");
  if (!button) return;
  restorePaddock(button.dataset.paddockId);
});

renderStorageWarnings();
resetProductRows();
calculate();
renderPaddocks();
renderRunView();
renderOperatorProfile();
refreshSuggestions();
host.showView = switchView;
return {
  showView: switchView,
  renderPaddocks,
  hasUnsavedChanges: () => pendingPersistence.records || pendingPersistence.profile,
};
}

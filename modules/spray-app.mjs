import { SPRAY_TEMPLATE } from "./spray-template.mjs";
import {
  MACHINES,
  PADDOCKS_KEY,
  loadPaddockStore,
  loadProfile,
  persistPaddockStore,
  persistProfile,
} from "./storage.mjs";
import {
  buildExportFilenames,
  buildPaddockCsv,
  buildPaddockPdf,
  exportDescriptor,
  missingShareMetadata,
} from "./paddock-export.mjs";
import { handFilesToShareSheet } from "./share-files.mjs";

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
const MAX_PADDOCKS = 10;
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
const editBanner = document.querySelector("#edit-banner");
const editTitle = document.querySelector("#edit-title");
const cancelEditButton = document.querySelector("#cancel-edit");
const saveDialog = document.querySelector("#save-dialog");
const saveForm = document.querySelector("#save-form");
const saveDialogTitle = document.querySelector("#save-dialog-title");
const savePaddockName = document.querySelector("#save-paddock-name");
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
const saveOperator = document.querySelector("#save-operator");
const saveMachine = document.querySelector("#save-machine");
const operatorFirstHint = document.querySelector("#operator-first-hint");
const operatorProfileName = document.querySelector("#operator-profile-name");
const changeOperatorButton = document.querySelector("#change-operator");
const shareReviewDialog = document.querySelector("#share-review-dialog");
const shareReviewForm = document.querySelector("#share-review-form");
const shareReviewList = document.querySelector("#share-review-list");
const shareReviewError = document.querySelector("#share-review-error");
const downloadDialog = document.querySelector("#download-dialog");
const downloadDialogMessage = document.querySelector("#download-dialog-message");
const downloadPdfButton = document.querySelector("#download-pdf");
const downloadCsvButton = document.querySelector("#download-csv");

let visibleProducts = 4;
let expandedPaddockId = null;
let editingNoteId = null;
let editingTankContext = null;
let toastTimer = null;
let store = loadStore();
let profile = loadProfile();
let pendingReview = null;
let pendingDownloads = null;

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

function loadStore() {
  return loadPaddockStore();
}

function persistStore() {
  try {
    persistPaddockStore(store);
    return true;
  } catch {
    showToast("Records could not be saved on this phone.");
    return false;
  }
}

function persistOperatorProfile() {
  try {
    persistProfile(profile);
    renderOperatorProfile();
    return true;
  } catch {
    showToast("Operator settings could not be saved on this phone.");
    return false;
  }
}

function renderOperatorProfile() {
  operatorProfileName.textContent = profile.operator || "Not set";
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

function getUsedProducts() {
  return [...productList.querySelectorAll(".product-row")]
    .map((row, slot) => {
      const rateInput = row.querySelector(".product-rate");
      const unitSelect = row.querySelector(".product-unit");
      return {
        slot,
        rate: Number(rateInput.value),
        rateText: rateInput.value,
        unit: unitSelect.value,
      };
    })
    .filter((product) =>
      product.rateText !== "" &&
      product.rate > 0 &&
      product.unit,
    );
}

function calculate() {
  const calculation = getCalculation();
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

  saveRecordButton.disabled = !calculation.valid;
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
  clearEditingState();
  calculate();
  mixVolumeInput.focus();
}

function switchView(view) {
  viewButtons.forEach((button) => {
    const selected = button.dataset.viewButton === view;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  viewPanels.forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== view;
  });
  if (view === "paddocks") renderPaddocks();
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
  return store.paddocks.find((paddock) => paddock.normalizedName === normalized);
}

function findPaddock(id) {
  return store.paddocks.find((paddock) => paddock.id === id);
}

function findTank(paddock, tankId) {
  return paddock?.tanks.find((tank) => tank.id === tankId);
}

function latestTank(paddock) {
  return [...(paddock?.tanks || [])].sort(
    (left, right) => new Date(right.savedAt) - new Date(left.savedAt),
  )[0];
}

function refreshSuggestions() {
  paddockSuggestions.replaceChildren();
  [...store.paddocks]
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
        if (!chemicals.has(product.normalizedName)) {
          chemicals.set(product.normalizedName, product.name);
        }
      });
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

function namesBySlotForPaddock(paddock) {
  const names = new Map();
  latestTank(paddock)?.products.forEach((product) => {
    names.set(product.slot, product.name);
  });
  return names;
}

function updateSaveNamesFromPaddock() {
  if (editingTankContext) return;
  const paddock = findPaddockByName(savePaddockName.value);
  if (!paddock) return;
  const names = namesBySlotForPaddock(paddock);
  [...saveProductList.querySelectorAll("[data-product-slot]")].forEach((input) => {
    const remembered = names.get(Number(input.dataset.productSlot));
    if (remembered) input.value = remembered;
  });
}

function openSaveDialog() {
  const calculation = getCalculation();
  if (!calculation.valid) return;
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
    findPaddock(store.lastPaddockId) ||
    [...store.paddocks].sort(
      (left, right) => new Date(right.updatedAt) - new Date(left.updatedAt),
    )[0];

  saveDialogTitle.textContent = editingTank ? "Update tank record" : "Save tank record";
  confirmSaveButton.textContent = editingTank ? "Update tank" : "Save tank";
  savePaddockName.value = defaultPaddock?.name || "";
  saveSprayDate.value = editingTank?.date || todayLocal();
  saveOperator.value = editingTank?.operator || profile.operator || "";
  saveMachine.value = MACHINES.includes(editingTank?.machine)
    ? editingTank.machine
    : profile.lastMachine || MACHINES[0];
  operatorFirstHint.hidden = profile.operatorPrompted;
  saveTankTotal.textContent = `${twoDecimals.format(calculation.litres)} litres`;
  saveSprayRate.textContent = `${twoDecimals.format(calculation.sprayRate)} L/ha`;
  saveArea.textContent = `${twoDecimals.format(calculation.hectares)} hectares`;

  const rememberedNames = editingTank
    ? new Map(editingTank.products.map((product) => [product.slot, product.name]))
    : namesBySlotForPaddock(defaultPaddock);

  saveProductList.replaceChildren();
  const usedProducts = getUsedProducts();
  if (!usedProducts.length) {
    const empty = document.createElement("p");
    empty.className = "no-products-message";
    empty.textContent = "No products entered for this tank.";
    saveProductList.append(empty);
  }

  usedProducts.forEach((product) => {
    const row = document.createElement("label");
    row.className = "save-product-row";
    row.innerHTML = `
      <span>
        <strong>Product ${product.slot + 1}</strong>
        <small>${twoDecimals.format(product.rate)} ${escapeHtml(UNIT_LABELS[product.unit])} · ${escapeHtml(formatAmount(product.rate, product.unit, calculation.litres, calculation.sprayRate))}</small>
      </span>
      <input
        data-product-slot="${product.slot}"
        list="chemical-suggestions"
        maxlength="80"
        autocomplete="off"
        placeholder="Chemical name"
        value="${escapeHtml(rememberedNames.get(product.slot) || "")}"
        required
      />
    `;
    saveProductList.append(row);
  });

  saveDialog.showModal();
  savePaddockName.focus();
}

function buildTankRecord(calculation, namesBySlot, existingTank = null) {
  return {
    id: existingTank?.id || newId(),
    tankNumber: existingTank?.tankNumber || null,
    date: saveSprayDate.value,
    savedAt: existingTank?.savedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tankTotal: calculation.litres,
    sprayRate: calculation.sprayRate,
    hectares: calculation.hectares,
    operator: cleanName(saveOperator.value) || null,
    machine: MACHINES.includes(saveMachine.value) ? saveMachine.value : null,
    products: getUsedProducts().map((product) => {
      const name = cleanName(namesBySlot.get(product.slot));
      const canonical = canonicalAmount(
        product.rate,
        product.unit,
        calculation.litres,
        calculation.sprayRate,
      );
      return {
        slot: product.slot,
        name,
        normalizedName: normalizeName(name),
        rate: product.rate,
        unit: product.unit,
        ...canonical,
      };
    }),
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
  const productNameInputs = [
    ...saveProductList.querySelectorAll("[data-product-slot]"),
  ];
  const missingName = productNameInputs.find((input) => !cleanName(input.value));

  if (!calculation.valid || !paddockName || !saveSprayDate.value || missingName) {
    saveError.textContent = missingName
      ? "Enter a chemical name for every product used."
      : "Complete the paddock name, date and valid tank calculation.";
    saveError.hidden = false;
    confirmSaveButton.disabled = false;
    missingName?.focus();
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
    if (store.paddocks.length >= MAX_PADDOCKS) {
      saveError.textContent =
        "Ten paddocks are already active. Export and clear one before adding another.";
      saveError.hidden = false;
      confirmSaveButton.disabled = false;
      return;
    }
    targetPaddock = {
      id: newId(),
      name: paddockName,
      normalizedName: normalizeName(paddockName),
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

  const namesBySlot = new Map(
    productNameInputs.map((input) => [
      Number(input.dataset.productSlot),
      cleanName(input.value),
    ]),
  );
  const tank = buildTankRecord(calculation, namesBySlot, existingTank);
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
  if (MACHINES.includes(tank.machine)) profile.lastMachine = tank.machine;

  if (!persistStore()) {
    confirmSaveButton.disabled = false;
    return;
  }
  persistOperatorProfile();

  expandedPaddockId = targetPaddock.id;
  clearEditingState();
  saveDialog.close();
  renderPaddocks();
  showToast(message);
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

  paddock.tanks.forEach((tank) => {
    tankTotal += tank.tankTotal;
    hectares += tank.hectares;
    tank.products.forEach((product) => {
      const key = `${product.normalizedName}|${product.baseUnit}`;
      const existing = chemicals.get(key);
      if (existing) {
        existing.amountBase += product.amountBase;
      } else {
        chemicals.set(key, {
          name: product.name,
          normalizedName: product.normalizedName,
          baseUnit: product.baseUnit,
          amountBase: product.amountBase,
        });
      }
    });
  });

  return {
    tankTotal,
    hectares,
    chemicals: [...chemicals.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
  };
}

function renderTankRecord(paddock, tank) {
  const products = tank.products.length
    ? tank.products
        .map(
          (product) => `
            <li>
              <span>
                <strong>${escapeHtml(product.name)}</strong>
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
          <strong>Tank ${tank.tankNumber}</strong>
          <span>Saved ${escapeHtml(formatTime(tank.savedAt))}</span>
        </div>
        <b>Tank total: ${twoDecimals.format(tank.tankTotal)} litres</b>
      </div>
      <div class="tank-stats">
        <span>${twoDecimals.format(tank.sprayRate)} L/ha</span>
        <span>${twoDecimals.format(tank.hectares)} hectares</span>
      </div>
      <div class="tank-record-meta">
        <span><small>Operator</small><strong>${escapeHtml(tank.operator || "Not set")}</strong></span>
        <span><small>Machine</small><strong>${escapeHtml(tank.machine || "Not set")}</strong></span>
      </div>
      <ul class="tank-products">${products}</ul>
      <div class="record-actions">
        <button type="button" data-action="edit-tank" data-paddock-id="${paddock.id}" data-tank-id="${tank.id}">Edit tank</button>
        <button class="danger-link" type="button" data-action="delete-tank" data-paddock-id="${paddock.id}" data-tank-id="${tank.id}">Delete</button>
      </div>
    </article>
  `;
}

function renderPaddockCard(paddock) {
  const totals = getPaddockTotals(paddock);
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
  [...paddock.tanks]
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
          <small>${twoDecimals.format(totals.hectares)} hectares</small>
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
        <section class="note-section">
          <h3>Notes</h3>
          ${noteEditor}
        </section>
        <div class="paddock-actions">
          <button type="button" data-action="export-paddock" data-paddock-id="${paddock.id}">Export paddock</button>
          <button type="button" data-action="share-paddock" data-paddock-id="${paddock.id}">Share / Save Copy</button>
          <button class="danger-button" type="button" data-action="clear-paddock" data-paddock-id="${paddock.id}">Clear paddock</button>
        </div>
        <div class="tank-history">
          <h3>Tank records</h3>
          ${tankGroups || `<p class="no-tanks">No tank records saved.</p>`}
        </div>
      </div>
    </article>
  `;
}

function renderPaddocks() {
  const paddocks = [...store.paddocks].sort(
    (left, right) => new Date(right.updatedAt) - new Date(left.updatedAt),
  );
  paddockCount.textContent = `${paddocks.length} of ${MAX_PADDOCKS} paddocks`;
  paddockEmpty.hidden = paddocks.length > 0;
  paddockList.hidden = paddocks.length === 0;
  paddockList.innerHTML = paddocks.map(renderPaddockCard).join("");
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
  persistStore();
  renderPaddocks();
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
  persistStore();
  renderPaddocks();
  showToast("Paddock note saved.");
}

function clearPaddock(paddockId) {
  const paddock = findPaddock(paddockId);
  if (!paddock) return;
  if (!window.confirm(`Clear all records for ${paddock.name}? This cannot be undone.`)) return;
  store.paddocks = store.paddocks.filter((record) => record.id !== paddockId);
  if (store.lastPaddockId === paddockId) store.lastPaddockId = null;
  if (expandedPaddockId === paddockId) expandedPaddockId = null;
  persistStore();
  renderPaddocks();
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

function machineOptions(selected) {
  return [
    `<option value="">Select machine</option>`,
    ...MACHINES.map(
      (machine) => `<option value="${escapeHtml(machine)}" ${machine === selected ? "selected" : ""}>${escapeHtml(machine)}</option>`,
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
  const issues = missingShareMetadata(paddock);
  if (!issues.length) return Promise.resolve(true);

  shareReviewError.hidden = true;
  shareReviewList.innerHTML = issues
    .map((issue) => {
      const tank = findTank(paddock, issue.tankId);
      return `
        <fieldset class="share-review-row" data-review-tank-id="${escapeHtml(issue.tankId)}">
          <legend>Tank ${escapeHtml(issue.tankNumber)} · ${escapeHtml(formatDate(issue.date))}</legend>
          <label><span>Operator</span><input data-review-operator maxlength="80" autocomplete="name" value="${escapeHtml(tank?.operator || profile.operator || "")}" /></label>
          <label><span>Machine</span><select data-review-machine>${machineOptions(tank?.machine || profile.lastMachine)}</select></label>
        </fieldset>
      `;
    })
    .join("");
  shareReviewDialog.showModal();
  shareReviewList.querySelector("input")?.focus();
  return new Promise((resolve) => {
    pendingReview = { paddock, resolve };
  });
}

function recordGeneratedCopy(paddock, descriptor) {
  paddock.lastGeneratedRevision = descriptor.revision;
  paddock.lastGeneratedAt = descriptor.generatedAt;
  paddock.lastGeneratedLabel = descriptor.label;
  persistStore();
}

async function exportPaddock(paddockId) {
  const paddock = findPaddock(paddockId);
  if (!paddock) return;
  if (!(await ensureShareMetadata(paddock))) return;
  const descriptor = exportDescriptor(paddock);
  const filenames = buildExportFilenames(paddock, descriptor);
  const csvBlob = new Blob([buildPaddockCsv(paddock, descriptor)], {
    type: "text/csv;charset=utf-8",
  });
  downloadBlob(csvBlob, filenames.csv);
  recordGeneratedCopy(paddock, descriptor);
  showToast("CSV copy ready on this phone.");
}

async function sharePaddock(paddockId) {
  const paddock = findPaddock(paddockId);
  if (!paddock || !(await ensureShareMetadata(paddock))) return;
  const descriptor = exportDescriptor(paddock);
  const filenames = buildExportFilenames(paddock, descriptor);
  try {
    const [pdfBytes, csvText] = await Promise.all([
      buildPaddockPdf(paddock, descriptor),
      Promise.resolve(buildPaddockCsv(paddock, descriptor)),
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
      recordGeneratedCopy(paddock, descriptor);
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
    recordGeneratedCopy(paddock, descriptor);
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
  button.addEventListener("click", () => switchView(button.dataset.viewButton));
});

document.querySelector("[data-switch-to-calculator]").addEventListener("click", () => {
  requestTopLevelView("calculator");
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
clearButton.addEventListener("click", () => clearCalculation(true));
cancelEditButton.addEventListener("click", () => {
  clearEditingState();
  showToast("Record editing cancelled.");
});
savePaddockName.addEventListener("change", updateSaveNamesFromPaddock);
saveForm.addEventListener("submit", saveTankRecord);
document.querySelector("#close-save-dialog").addEventListener("click", () => saveDialog.close());
document.querySelector("#cancel-save").addEventListener("click", () => saveDialog.close());

changeOperatorButton.addEventListener("click", () => {
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
  const updates = [...shareReviewList.querySelectorAll("[data-review-tank-id]")].map((row) => ({
    tank: findTank(pendingReview.paddock, row.dataset.reviewTankId),
    operator: cleanName(row.querySelector("[data-review-operator]").value),
    machine: row.querySelector("[data-review-machine]").value,
  }));
  const invalid = updates.find((update) => !update.tank || !update.operator || !MACHINES.includes(update.machine));
  if (invalid) {
    shareReviewError.textContent = "Enter an operator and choose a machine for every tank.";
    shareReviewError.hidden = false;
    return;
  }
  for (const update of updates) {
    update.tank.operator = update.operator;
    update.tank.machine = update.machine;
    update.tank.updatedAt = new Date().toISOString();
  }
  bumpContentRevision(pendingReview.paddock);
  if (!profile.operator) profile.operator = updates[0]?.operator || null;
  if (updates.at(-1)?.machine) profile.lastMachine = updates.at(-1).machine;
  profile.operatorPrompted = true;
  if (!persistStore()) {
    shareReviewError.textContent = "Tank details could not be saved on this phone.";
    shareReviewError.hidden = false;
    return;
  }
  persistOperatorProfile();
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
  if (action === "clear-paddock") clearPaddock(paddockId);
});

resetProductRows();
calculate();
renderPaddocks();
renderOperatorProfile();
host.showView = switchView;
return { showView: switchView, renderPaddocks };
}

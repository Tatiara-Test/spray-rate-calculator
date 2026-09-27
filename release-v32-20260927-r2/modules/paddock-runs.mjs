import { normalizeEquipmentSnapshot, methodsForEquipment } from "./spray-preferences.mjs";
import { normalizePropertyIdentitySnapshot } from "./property-settings.mjs";

export const SPRAY_METHODS = Object.freeze(["Broadacre", "Camera"]);
export const CAMERA_CAPABLE_MACHINES = Object.freeze(["412R", "Hayes boom"]);

const ACTIVE = "active";

function cleanText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function optionalPositive(value, label) {
  if (value === null || value === undefined || value === "") return null;
  return finiteNumber(value, label, { minimum: 0, exclusiveMinimum: true });
}

function requiredText(value, label) {
  const cleaned = cleanText(value);
  if (!cleaned) throw new TypeError(`${label} is required.`);
  return cleaned;
}

function finiteNumber(value, label, { minimum = 0, exclusiveMinimum = false } = {}) {
  const number = Number(value);
  const outsideMinimum = exclusiveMinimum ? number <= minimum : number < minimum;
  if (!Number.isFinite(number) || outsideMinimum) {
    const comparison = exclusiveMinimum ? "greater than" : "at least";
    throw new RangeError(`${label} must be ${comparison} ${minimum}.`);
  }
  return number;
}

function timestampFrom(input, ...keys) {
  for (const key of keys) {
    const value = cleanText(input?.[key]);
    if (value) return value;
  }
  throw new TypeError("A timestamp is required.");
}

function cloneProduct(product, index) {
  if (!product || typeof product !== "object" || Array.isArray(product)) {
    throw new TypeError(`Product ${index + 1} must be a record.`);
  }
  return {
    ...product,
    rate: finiteNumber(product.rate, `Product ${index + 1} rate`),
    amountBase: finiteNumber(product.amountBase, `Product ${index + 1} amount`),
  };
}

function cloneAllocation(allocation) {
  return { ...allocation };
}

function cloneSelectedPaddock(selectedPaddock, index) {
  if (!selectedPaddock || typeof selectedPaddock !== "object" || Array.isArray(selectedPaddock)) {
    throw new TypeError(`Selected paddock ${index + 1} must be a record.`);
  }
  return {
    libraryEntryId: requiredText(
      selectedPaddock.libraryEntryId,
      `Selected paddock ${index + 1} library entry id`,
    ),
    name: requiredText(selectedPaddock.name, `Selected paddock ${index + 1} name`),
    normalizedName: requiredText(
      selectedPaddock.normalizedName,
      `Selected paddock ${index + 1} normalized name`,
    ),
    totalHectares: optionalPositive(
      selectedPaddock.totalHectares,
      `Selected paddock ${index + 1} total hectares`,
    ),
    plannedHectares: optionalPositive(
      selectedPaddock.plannedHectares,
      `Selected paddock ${index + 1} planned hectares`,
    ),
  };
}

function cloneSelectedPaddocks(selectedPaddocks) {
  if (!Array.isArray(selectedPaddocks)) {
    throw new TypeError("Buffer selected paddocks must be an array.");
  }
  const libraryEntryIds = new Set();
  const names = new Set();
  const normalizedNames = new Set();
  return selectedPaddocks.map((selectedPaddock, index) => {
    const cloned = cloneSelectedPaddock(selectedPaddock, index);
    if (libraryEntryIds.has(cloned.libraryEntryId)) {
      throw new TypeError(`Selected paddock library entry id ${cloned.libraryEntryId} is duplicated.`);
    }
    const nameKey = cloned.name.toLocaleLowerCase("en-AU");
    const normalizedNameKey = cloned.normalizedName.toLocaleLowerCase("en-AU");
    if (names.has(nameKey) || normalizedNames.has(normalizedNameKey)) {
      throw new TypeError(`Selected paddock name ${cloned.name} is duplicated.`);
    }
    libraryEntryIds.add(cloned.libraryEntryId);
    names.add(nameKey);
    normalizedNames.add(normalizedNameKey);
    return cloned;
  });
}

function cloneRun(run) {
  const cloned = {
    ...run,
    products: (run.products || []).map(cloneProduct),
    allocations: (run.allocations || []).map(cloneAllocation),
  };
  if (Object.hasOwn(run, "allocationCorrections")) {
    cloned.allocationCorrections = normalizeRunAllocationCorrections(run);
  }
  if (Object.hasOwn(run, "selectedPaddocks")) {
    cloned.selectedPaddocks = cloneSelectedPaddocks(run.selectedPaddocks);
  }
  if (Object.hasOwn(run, "propertySnapshot")) {
    cloned.propertySnapshot = normalizePropertyIdentitySnapshot(run.propertySnapshot);
  }
  if (Object.hasOwn(run, "equipmentSnapshot")) {
    cloned.equipmentSnapshot = normalizeEquipmentSnapshot(run.equipmentSnapshot);
  }
  return cloned;
}

function assertRun(run) {
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    throw new TypeError("A buffer is required.");
  }
  requiredText(run.id, "Buffer id");
  if (!["active", "completed", "cancelled"].includes(run.status)) {
    throw new RangeError("Buffer status must be active, completed or cancelled.");
  }
  finiteNumber(run.controllerStartLitres, "Controller start", {
    minimum: 0,
    exclusiveMinimum: true,
  });
  if (!SPRAY_METHODS.includes(run.sprayMethod)) {
    throw new RangeError("Spray method must be Broadacre or Camera.");
  }
  if (!allowedSprayMethods(run.machine, run.equipmentSnapshot).includes(run.sprayMethod)) {
    throw new RangeError(`${run.machine || "This machine"} cannot be recorded as ${run.sprayMethod} spray.`);
  }
  const sprayRate = finiteNumber(run.sprayRate, "Spray rate");
  if (run.sprayMethod === "Broadacre" && sprayRate <= 0) {
    throw new RangeError("Broadacre spray rate must be greater than 0.");
  }
  if (!Array.isArray(run.products)) throw new TypeError("Buffer products must be an array.");
  run.products.forEach(cloneProduct);
  const selectedPaddocks = Object.hasOwn(run, "selectedPaddocks")
    ? cloneSelectedPaddocks(run.selectedPaddocks)
    : null;
  if (Object.hasOwn(run, "propertySnapshot")) normalizePropertyIdentitySnapshot(run.propertySnapshot);
  if (!Array.isArray(run.allocations)) throw new TypeError("Buffer allocations must be an array.");
  if (Object.hasOwn(run, "allocationCorrections")) normalizeRunAllocationCorrections(run);

  let before = Number(run.controllerStartLitres);
  const ids = new Set();
  run.allocations.forEach((allocation, index) => {
    if (!allocation || typeof allocation !== "object" || Array.isArray(allocation)) {
      throw new TypeError(`Allocation ${index + 1} must be a record.`);
    }
    const allocationId = requiredText(allocation.id, `Allocation ${index + 1} id`);
    if (ids.has(allocationId)) throw new TypeError(`Allocation id ${allocationId} is duplicated.`);
    ids.add(allocationId);
    requiredText(allocation.paddockId, `Allocation ${index + 1} paddock id`);
    const allocationPaddockName = requiredText(allocation.paddockName, `Allocation ${index + 1} paddock name`);
    if (
      selectedPaddocks
      && !selectedPaddocks.some(
        (selection) => selection.name.toLocaleLowerCase("en-AU") === allocationPaddockName.toLocaleLowerCase("en-AU"),
      )
    ) {
      throw new TypeError(`Allocation ${index + 1} paddock is not selected for this buffer.`);
    }
    optionalPositive(allocation.paddockSizeHectares, `Allocation ${index + 1} paddock size`);
    const after = finiteNumber(
      allocation.controllerAfterLitres,
      `Allocation ${index + 1} controller after`,
    );
    if (after === before) {
      throw new RangeError("Controller readings must decrease so every allocation records liquid used.");
    }
    if (after > before) {
      throw new RangeError("Controller readings cannot increase within one buffer. Start a new buffer after a refill.");
    }
    before = after;
  });
  if (run.status === "completed" && !run.allocations.length) {
    throw new Error("A completed buffer must contain an allocation.");
  }
  if (run.status === "cancelled" && run.allocations.length) {
    throw new Error("A cancelled buffer cannot contain allocations.");
  }
  if (run.status !== "active") {
    const final = finiteNumber(run.controllerFinalLitres, "Final controller reading");
    if (final !== before) throw new Error("Final controller reading must match the last buffer boundary.");
  }
}

function assertActive(run) {
  assertRun(run);
  if (run.status !== ACTIVE) throw new Error("Only an active buffer can be changed.");
}

function finalControllerReading(run) {
  return run.allocations.length
    ? Number(run.allocations.at(-1).controllerAfterLitres)
    : Number(run.controllerStartLitres);
}

export function allowedSprayMethods(machine, snapshot) {
  return methodsForEquipment(machine, snapshot);
}

export function validateControllerStartAgainstMix(controllerStartLitres, mixTotalLitres) {
  const controllerStart = finiteNumber(controllerStartLitres, "Controller start", {
    minimum: 0,
    exclusiveMinimum: true,
  });
  const mixTotal = finiteNumber(mixTotalLitres, "Calculator mix total", {
    minimum: 0,
    exclusiveMinimum: true,
  });
  if (controllerStart > mixTotal) {
    throw new RangeError("Controller start cannot exceed the Calculator mix total.");
  }
  return controllerStart;
}

export function createPaddockRun(input = {}) {
  const id = requiredText(input.id, "Buffer id");
  const runNumber = finiteNumber(input.runNumber, "Buffer number", {
    minimum: 0,
    exclusiveMinimum: true,
  });
  if (!Number.isInteger(runNumber)) throw new RangeError("Buffer number must be a whole number.");
  const savedAt = timestampFrom(input, "savedAt", "createdAt", "startedAt");
  const updatedAt = cleanText(input.updatedAt) || savedAt;
  const machine = cleanText(input.machine) || null;
  if (machine && !["412R", "Hayes boom", "4830", "4023"].includes(machine) && !Object.hasOwn(input, "equipmentSnapshot")) {
    throw new TypeError("Custom equipment needs a saved equipment snapshot.");
  }
  const sprayMethod = requiredText(input.sprayMethod, "Spray method");
  if (!SPRAY_METHODS.includes(sprayMethod)) {
    throw new RangeError("Spray method must be Broadacre or Camera.");
  }
  if (!allowedSprayMethods(machine, input.equipmentSnapshot).includes(sprayMethod)) {
    throw new RangeError(`${machine || "This machine"} cannot be recorded as ${sprayMethod} spray.`);
  }
  const controllerStartLitres = finiteNumber(input.controllerStartLitres, "Controller start", {
    minimum: 0,
    exclusiveMinimum: true,
  });
  const sprayRate = finiteNumber(input.sprayRate, "Spray rate");
  if (sprayMethod === "Broadacre" && sprayRate <= 0) {
    throw new RangeError("Broadacre spray rate must be greater than 0.");
  }
  if (!Array.isArray(input.products)) throw new TypeError("Buffer products must be an array.");

  const run = {
    id,
    runNumber,
    status: ACTIVE,
    date: requiredText(input.date, "Buffer date"),
    savedAt,
    updatedAt,
    completedAt: null,
    cancelledAt: null,
    operator: cleanText(input.operator) || null,
    machine,
    sprayMethod,
    controllerStartLitres,
    controllerFinalLitres: null,
    sprayRate,
    products: input.products.map(cloneProduct),
    allocations: [],
  };
  if (input.selectedPaddocks !== undefined) {
    run.selectedPaddocks = cloneSelectedPaddocks(input.selectedPaddocks);
  }
  if (Object.hasOwn(input, "propertySnapshot")) {
    run.propertySnapshot = normalizePropertyIdentitySnapshot(input.propertySnapshot);
  }
  if (Object.hasOwn(input, "equipmentSnapshot")) {
    run.equipmentSnapshot = normalizeEquipmentSnapshot(input.equipmentSnapshot);
  }
  return run;
}

export function addRunAllocation(run, input = {}) {
  assertActive(run);
  const next = cloneRun(run);
  const id = requiredText(input.id, "Allocation id");
  if (next.allocations.some((allocation) => allocation.id === id)) {
    throw new TypeError(`Allocation id ${id} is duplicated.`);
  }
  const controllerBeforeLitres = finalControllerReading(next);
  const controllerAfterLitres = finiteNumber(input.controllerAfterLitres, "Controller after");
  if (controllerAfterLitres === controllerBeforeLitres) {
    throw new RangeError("Controller readings must decrease so every allocation records liquid used.");
  }
  if (controllerAfterLitres > controllerBeforeLitres) {
    throw new RangeError("Controller readings cannot increase within one buffer. Start a new buffer after a refill.");
  }
  const savedAt = timestampFrom(input, "savedAt", "createdAt", "recordedAt");
  const updatedAt = cleanText(input.updatedAt) || savedAt;
  const paddockName = requiredText(input.paddockName, "Paddock name");
  if (
    Object.hasOwn(next, "selectedPaddocks")
    && !next.selectedPaddocks.some(
      (selection) => selection.name.toLocaleLowerCase("en-AU") === paddockName.toLocaleLowerCase("en-AU"),
    )
  ) {
    throw new TypeError(`${paddockName} is not selected for this buffer.`);
  }

  next.allocations.push({
    id,
    paddockId: requiredText(input.paddockId, "Paddock id"),
    paddockName,
    paddockSizeHectares: optionalPositive(input.paddockSizeHectares, "Paddock size"),
    controllerAfterLitres,
    savedAt,
    updatedAt,
  });
  next.updatedAt = updatedAt;
  return next;
}

export function normalizeRunAllocationCorrections(run) {
  if (!Array.isArray(run.allocationCorrections)) {
    throw new TypeError("Buffer allocation corrections must be an array.");
  }
  return run.allocationCorrections.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError("Buffer allocation correction must be a record.");
    }
    if (Object.keys(entry).some((key) => !["allocationId", "previousLitresUsed", "litresUsed", "updatedAt", "reason"].includes(key))) {
      throw new TypeError("Buffer allocation correction has an unexpected field.");
    }
    if (typeof entry.allocationId !== "string" || !entry.allocationId.trim()
      || !run.allocations.some((allocation) => allocation.id === entry.allocationId)) {
      throw new TypeError("Buffer allocation correction must reference an existing allocation.");
    }
    for (const key of ["previousLitresUsed", "litresUsed"]) {
      if (typeof entry[key] !== "number" || !Number.isFinite(entry[key]) || entry[key] <= 0
        || entry[key] > Number(run.controllerStartLitres)) {
        throw new TypeError("Buffer allocation correction litres must be positive finite numbers within the buffer capacity.");
      }
    }
    if (typeof entry.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(entry.updatedAt)
      || !Number.isFinite(Date.parse(entry.updatedAt))) {
      throw new TypeError("Buffer allocation correction timestamp must be a valid date and time.");
    }
    if (entry.reason !== undefined && entry.reason !== null && typeof entry.reason !== "string") {
      throw new TypeError("Buffer allocation correction reason must be text or null.");
    }
    return { ...entry };
  });
}

function positiveSprayedLitres(value) {
  if (
    typeof value !== "number"
    && (typeof value !== "string" || !/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))
  ) {
    throw new TypeError("Litres sprayed must be a positive number.");
  }
  return finiteNumber(value, "Litres sprayed", { exclusiveMinimum: true });
}

// Keep the stored cumulative boundary schema so legacy records and reports agree.
export function addRunLitresAllocation(run, input = {}) {
  assertActive(run);
  const litresUsed = positiveSprayedLitres(input.litresUsed);
  const remaining = finalControllerReading(run);
  if (litresUsed > remaining) {
    throw new RangeError("Litres sprayed cannot exceed the liquid remaining in this buffer.");
  }
  return addRunAllocation(run, { ...input, controllerAfterLitres: remaining - litresUsed });
}

export function correctRunLitresAllocation(run, allocationId, input = {}) {
  assertRun(run);
  if (![ACTIVE, "completed"].includes(run.status)) {
    throw new Error("Only an active or completed buffer can be corrected.");
  }
  const id = requiredText(allocationId, "Allocation id");
  const index = run.allocations.findIndex((allocation) => allocation.id === id);
  if (index < 0) throw new RangeError(`Allocation ${id} does not exist in this buffer.`);
  const litresUsed = positiveSprayedLitres(input.litresUsed);
  const updatedAt = timestampFrom(input, "updatedAt");
  const records = materializeRunAllocations(run);
  const previousLitresUsed = records[index].litresUsed;
  const amounts = records.map((record, position) => position === index ? litresUsed : record.litresUsed);
  if (amounts.reduce((sum, amount) => sum + amount, 0) > Number(run.controllerStartLitres)) {
    throw new RangeError("Total litres sprayed cannot exceed the buffer starting litres.");
  }
  const next = cloneRun(run);
  let remaining = Number(next.controllerStartLitres);
  next.allocations.forEach((allocation, position) => {
    remaining -= amounts[position];
    allocation.controllerAfterLitres = remaining;
  });
  next.allocations[index].updatedAt = updatedAt;
  next.updatedAt = updatedAt;
  if (next.status === "completed") next.controllerFinalLitres = remaining;
  next.allocationCorrections = [...(next.allocationCorrections || []), {
    allocationId: id,
    previousLitresUsed,
    litresUsed,
    updatedAt,
    reason: cleanText(input.reason) || null,
  }];
  assertRun(next);
  return next;
}

export function completePaddockRun(run, completedAt) {
  assertActive(run);
  if (!run.allocations.length) {
    throw new Error("An empty buffer must be cancelled, not completed.");
  }
  const timestamp = requiredText(completedAt, "Completion timestamp");
  const next = cloneRun(run);
  next.status = "completed";
  next.completedAt = timestamp;
  next.updatedAt = timestamp;
  next.controllerFinalLitres = finalControllerReading(next);
  return next;
}

export function cancelEmptyPaddockRun(run, cancelledAt) {
  assertActive(run);
  if (run.allocations.length) {
    throw new Error("A buffer with allocations cannot be cancelled as empty.");
  }
  const timestamp = requiredText(cancelledAt, "Cancellation timestamp");
  const next = cloneRun(run);
  next.status = "cancelled";
  next.cancelledAt = timestamp;
  next.updatedAt = timestamp;
  next.controllerFinalLitres = Number(next.controllerStartLitres);
  return next;
}

export function materializeRunAllocations(run) {
  assertRun(run);
  const start = Number(run.controllerStartLitres);
  let before = start;
  return run.allocations.map((allocation, index) => {
    const after = Number(allocation.controllerAfterLitres);
    const litresUsed = before - after;
    const fractionUsed = litresUsed / start;
    const products = run.products.map((product) => ({
      ...product,
      amountBase: Number(product.amountBase) * fractionUsed,
    }));
    const materialized = {
      id: allocation.id,
      recordType: "run-allocation",
      runId: run.id,
      runNumber: run.runNumber,
      runStatus: run.status,
      allocationNumber: index + 1,
      paddockId: allocation.paddockId,
      paddockName: allocation.paddockName,
      paddockSizeHectares: allocation.paddockSizeHectares ?? null,
      date: run.date,
      savedAt: allocation.savedAt,
      updatedAt: allocation.updatedAt,
      operator: run.operator,
      machine: run.machine,
      sprayMethod: run.sprayMethod,
      controllerBeforeLitres: before,
      controllerAfterLitres: after,
      litresUsed,
      tankTotal: litresUsed,
      sprayRate: run.sprayRate,
      hectares: run.sprayMethod === "Broadacre" ? litresUsed / Number(run.sprayRate) : 0,
      products,
    };
    if (Object.hasOwn(run, "propertySnapshot")) {
      materialized.propertySnapshot = normalizePropertyIdentitySnapshot(run.propertySnapshot);
    }
    if (Object.hasOwn(run, "equipmentSnapshot")) {
      materialized.equipmentSnapshot = normalizeEquipmentSnapshot(run.equipmentSnapshot);
    }
    if (Object.hasOwn(run, "selectedPaddocks")) {
      materialized.selectedPaddocks = cloneSelectedPaddocks(run.selectedPaddocks);
    }
    before = after;
    return materialized;
  });
}

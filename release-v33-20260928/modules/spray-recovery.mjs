import { getStorage } from "./durable-storage.mjs";
import { COMBINED_PREFIX, PRE_RESTORE_RECOVERY_PREFIX, inspectPaddockStore, normalizePaddockStore, persistPaddockStore } from "./storage.mjs";

export const CALCULATOR_DRAFT_KEY = `${COMBINED_PREFIX}:calculator-draft:v1`;
export const TANK_DELETE_RECOVERY_KEY = `${COMBINED_PREFIX}:tank-delete-recovery:v1`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const units = ["", "l_ha", "ml_ha", "g_ha", "kg_ha", "ml_100", "kg_100"];
const timestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const boundedText = (value, max) => typeof value === "string" && value.length <= max;

export function captureRestoreEpoch(storage = getStorage()) {
  // Every attempted combined restore writes a unique pre-restore key. Enumerate
  // strictly: findLatestPreRestoreRecovery intentionally hides read failures.
  if (!Number.isInteger(storage.length) || typeof storage.key !== "function") throw new Error("Backup-restore history could not be checked.");
  const keys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (typeof key !== "string") throw new Error("Backup-restore history changed while it was checked.");
    if (key.startsWith(PRE_RESTORE_RECOVERY_PREFIX)) {
      if (typeof storage.getItem(key) !== "string") throw new Error("Backup-restore history could not be read.");
      keys.push(key);
    }
  }
  const nativeEpoch = storage.getItem(`${COMBINED_PREFIX}:restore-epoch`);
  return nativeEpoch === null ? JSON.stringify(keys.sort()) : JSON.stringify({ keys: keys.sort(), nativeEpoch });
}

function writeVerified(storage, key, value) {
  const raw = JSON.stringify(value);
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error("The recovery data could not be verified on this device.");
}

export function removeRecovery(key, storage = getStorage()) {
  if (![CALCULATOR_DRAFT_KEY, TANK_DELETE_RECOVERY_KEY].includes(key)) throw new Error("Unknown recovery key.");
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("The recovery data could not be cleared on this device.");
}

export function validateCalculatorDraft(value) {
  if (!value || value.version !== 1 || !timestamp(value.savedAt)
      || !boundedText(value.mixVolume, 64) || !boundedText(value.sprayRate, 64)
      || typeof value.wasEditing !== "boolean" || !Array.isArray(value.products)
      || !(value.recordContext === null || boundedText(value.recordContext, 4000000))
      || !boundedText(value.restoreEpoch, 1000000)
      || value.products.length < 1 || value.products.length > 6
      || value.products.some((p) => !p || !boundedText(p.name, 160) || !boundedText(p.rateText, 64) || !units.includes(p.unit))) {
    throw new Error("The unfinished calculation could not be read. Start fresh to discard this draft.");
  }
  // Never recover tank IDs, edit context, save-dialog state or Buffer state.
  return { version: 1, savedAt: value.savedAt, mixVolume: value.mixVolume,
    sprayRate: value.sprayRate, wasEditing: value.wasEditing, recordContext: value.recordContext, restoreEpoch: value.restoreEpoch,
    products: value.products.map(({ name, rateText, unit }) => ({ name, rateText, unit })) };
}

export function inspectCalculatorDraft(storage) {
  try {
    storage ??= getStorage();
    const raw = storage.getItem(CALCULATOR_DRAFT_KEY);
    return raw === null ? { status: "absent" } : { status: "ready", value: validateCalculatorDraft(JSON.parse(raw)) };
  } catch (error) { return { status: "unavailable", message: error.message }; }
}

export function persistCalculatorDraft(inputs, storage = getStorage(), savedAt = new Date().toISOString()) {
  const value = validateCalculatorDraft({ recordContext: null, ...inputs, version: 1, savedAt, restoreEpoch: captureRestoreEpoch(storage) });
  writeVerified(storage, CALCULATOR_DRAFT_KEY, value);
  return value;
}

export function recordRecoveryContext(store) { return JSON.stringify(normalizePaddockStore(store)); }

export function canResumeCalculatorDraft(draft, store, storage) {
  try {
    storage ??= getStorage();
    return draft.restoreEpoch === captureRestoreEpoch(storage)
      && (!draft.wasEditing || (Boolean(draft.recordContext) && draft.recordContext === recordRecoveryContext(store)));
  } catch { return false; }
}

export function filterPaddocksByName(paddocks, query) {
  const text = String(query || "").trim().toLocaleLowerCase("en-AU");
  return paddocks.filter((paddock) => paddock.name.toLocaleLowerCase("en-AU").includes(text));
}

function currentStore(storage, expectedStore) {
  const inspection = inspectPaddockStore(storage);
  if (inspection.status !== "ready") throw new Error("Paddock records cannot be read safely. Reload and review storage before continuing.");
  if (expectedStore && !same(inspection.value, normalizePaddockStore(expectedStore))) {
    throw new Error("Paddock records changed or have unsaved changes. Reload and review them before using tank recovery.");
  }
  return inspection.value;
}

function validateRecovery(value) {
  if (!value || value.version !== 1 || !timestamp(value.deletedAt)
      || !value.paddockId || !Number.isInteger(value.index) || value.index < 0
      || !value.tank?.id || !value.afterPaddock || value.afterPaddock.id !== value.paddockId
      || !boundedText(value.recordContext, 4000000)
      || !boundedText(value.restoreEpoch, 1000000)
      || !Array.isArray(value.afterPaddock.tanks) || value.afterPaddock.tanks.some((t) => t.id === value.tank.id)) {
    throw new Error("The tank recovery data could not be read safely.");
  }
  // Validate the exact saved tank rather than accepting silently repaired values.
  const candidate = { version: 3, paddocks: [{ ...clone(value.afterPaddock), tanks: [value.tank] }], runs: [], activeRunId: null, lastPaddockId: value.paddockId };
  const normalized = normalizePaddockStore(candidate);
  if (!same(normalized.paddocks[0].tanks[0], value.tank)
      || !sameRecoveryPaddock(normalizePaddockStore({ ...candidate, paddocks: [value.afterPaddock] }).paddocks[0], value.afterPaddock)) {
    throw new Error("The tank recovery data contains invalid record details.");
  }
  return clone(value);
}

// Older recovery snapshots predate completedAt. Compare their exact fields;
// only the known absent-to-null addition is compatible, never a completion.
function sameRecoveryPaddock(current, saved) {
  const comparable = clone(current);
  if (!Object.hasOwn(saved, "completedAt") && comparable.completedAt === null) delete comparable.completedAt;
  return same(comparable, saved);
}

function sameRecoveryContext(current, savedRaw) {
  if (recordRecoveryContext(current) === savedRaw) return true;
  try {
    const saved = JSON.parse(savedRaw);
    const comparable = normalizePaddockStore(current);
    if (!Array.isArray(saved.paddocks) || comparable.paddocks.length !== saved.paddocks.length) return false;
    comparable.paddocks = comparable.paddocks.map((paddock, index) => {
      if (!sameRecoveryPaddock(paddock, saved.paddocks[index])) throw new Error("Recovery context changed.");
      return saved.paddocks[index];
    });
    return same(comparable, saved);
  } catch { return false; }
}

export function inspectTankRecovery(storage) {
  try {
    storage ??= getStorage();
    const raw = storage.getItem(TANK_DELETE_RECOVERY_KEY);
    return raw === null ? { status: "absent" } : { status: "ready", value: validateRecovery(JSON.parse(raw)) };
  } catch (error) { return { status: "unavailable", message: error.message }; }
}

function assertNoActiveBuffer(store, paddockId) {
  const run = store.runs.find((run) => run.id === store.activeRunId);
  if (run && (run.allocations.some((a) => a.paddockId === paddockId)
      || run.selectedPaddocks?.some((p) => p.normalizedName === store.paddocks.find((p) => p.id === paddockId)?.normalizedName))) {
    throw new Error("Finish the active Buffer for this paddock before deleting or recovering a tank.");
  }
}

export function deleteTankWithRecovery(expectedStore, paddockId, tankId, storage = getStorage(), deletedAt = new Date().toISOString()) {
  const next = currentStore(storage, expectedStore);
  const paddock = next.paddocks.find((p) => p.id === paddockId);
  const index = paddock?.tanks.findIndex((tank) => tank.id === tankId) ?? -1;
  if (!paddock || paddock.archivedAt || index < 0) throw new Error("The original active paddock and tank must still exist.");
  assertNoActiveBuffer(next, paddockId);
  const [tank] = paddock.tanks.splice(index, 1);
  paddock.contentRevision += 1;
  paddock.updatedAt = deletedAt;
  const recovery = validateRecovery({ version: 1, deletedAt, paddockId, index, tank, afterPaddock: clone(paddock), recordContext: recordRecoveryContext(next), restoreEpoch: captureRestoreEpoch(storage) });
  // A failed recovery write prevents deletion. A failed record write leaves the recovery available.
  const previousRecovery = storage.getItem(TANK_DELETE_RECOVERY_KEY);
  try {
    writeVerified(storage, TANK_DELETE_RECOVERY_KEY, recovery);
    currentStore(storage, expectedStore);
    persistPaddockStore(next, storage);
    return currentStore(storage, next);
  } catch (error) {
    // Keep the previous successful deletion's recovery if this deletion is
    // positively known not to have changed records. Otherwise retain the new
    // snapshot, since its write outcome may be uncertain.
    try {
      currentStore(storage, expectedStore);
      if (previousRecovery !== null) {
        storage.setItem(TANK_DELETE_RECOVERY_KEY, previousRecovery);
        if (storage.getItem(TANK_DELETE_RECOVERY_KEY) !== previousRecovery) throw new Error("Recovery rollback could not be verified.");
      }
    } catch { /* Preserve whatever recovery remains; never claim deletion success. */ }
    throw error;
  }
}

export function restoreDeletedTank(expectedStore, storage = getStorage(), restoredAt = new Date().toISOString()) {
  const inspection = inspectTankRecovery(storage);
  if (inspection.status !== "ready") throw new Error(inspection.message || "There is no deleted tank to recover.");
  const recovery = inspection.value;
  if (recovery.restoreEpoch !== captureRestoreEpoch(storage)) {
    throw new Error("A backup restore was attempted since deletion. The old recovery is retained but cannot be applied after a restore.");
  }
  const next = currentStore(storage, expectedStore);
  if (next.paddocks.some((p) => p.tanks.some((t) => t.id === recovery.tank.id))) {
    throw new Error("This tank is already present. It will not be restored twice.");
  }
  if (!sameRecoveryContext(next, recovery.recordContext)) {
    throw new Error("Saved records changed or were restored since deletion. The old recovery is retained but cannot be applied to this record state.");
  }
  const paddock = next.paddocks.find((p) => p.id === recovery.paddockId);
  if (!paddock || paddock.archivedAt || !sameRecoveryPaddock(paddock, recovery.afterPaddock)) {
    throw new Error("This paddock has changed, been cleared or archived since deletion. Recovery is retained; it cannot safely replace the current paddock.");
  }
  if (paddock.tanks.some((t) => t.tankNumber === recovery.tank.tankNumber)) {
    throw new Error("That tank number is already in use. Recovery is retained.");
  }
  assertNoActiveBuffer(next, paddock.id);
  paddock.tanks.splice(Math.min(recovery.index, paddock.tanks.length), 0, clone(recovery.tank));
  paddock.contentRevision += 1;
  paddock.updatedAt = restoredAt;
  persistPaddockStore(next, storage);
  const result = currentStore(storage, next);
  let cleared = false;
  try { removeRecovery(TANK_DELETE_RECOVERY_KEY, storage); cleared = true; } catch { /* ID check prevents duplicates if cleanup fails. */ }
  return { store: result, tank: recovery.tank, paddockId: paddock.id, cleared };
}

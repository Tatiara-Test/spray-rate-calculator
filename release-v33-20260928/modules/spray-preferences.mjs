import { getStorage } from "./durable-storage.mjs";
export const SPRAY_PREFERENCES_KEY = "tatiara-test:spray-preferences:v1";
const LEGACY = ["412R", "Hayes boom", "4830", "4023"];
const METHODS = ["Broadacre", "Camera"];
const clean = value => typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

export function normalizeEquipmentSnapshot(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Equipment snapshot must be an object.");
  const id = clean(input.id), name = clean(input.name);
  if (!id || !name) throw new TypeError("Equipment needs a stable ID and name.");
  if (!Array.isArray(input.methods) || !input.methods.length || input.methods.some(method => !METHODS.includes(method)) || new Set(input.methods).size !== input.methods.length) {
    throw new TypeError("Equipment needs one or more supported spray methods.");
  }
  return { id, name, methods: METHODS.filter(method => input.methods.includes(method)) };
}

export function equipmentSnapshot(entry) {
  return normalizeEquipmentSnapshot(entry);
}

export function methodsForEquipment(machine, snapshot) {
  if (snapshot !== undefined) {
    const normalized = normalizeEquipmentSnapshot(snapshot);
    if (normalized.name !== machine) throw new TypeError("Equipment snapshot name must match the saved machine.");
    return normalized.methods;
  }
  return ["412R", "Hayes boom"].includes(machine) ? [...METHODS] : ["Broadacre"];
}

export function defaultSprayPreferences() {
  return { version: 1, rates: [60, 80, 90], equipment: LEGACY.map(name => ({
    id: `legacy-${name.toLowerCase().replaceAll(" ", "-")}`, name,
    methods: methodsForEquipment(name), archived: false,
  })) };
}

export function normalizeSprayPreferences(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || input.version !== 1) throw new TypeError("Unsupported spray preferences version.");
  if (!Array.isArray(input.rates) || input.rates.some(rate => typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) || new Set(input.rates).size !== input.rates.length) throw new TypeError("Saved rates must be unique positive numbers.");
  if (!Array.isArray(input.equipment)) throw new TypeError("Equipment must be an array.");
  const ids = new Set(), names = new Set();
  const equipment = input.equipment.map(entry => {
    const snapshot = normalizeEquipmentSnapshot(entry);
    if (typeof entry.archived !== "boolean") throw new TypeError("Equipment archive state must be true or false.");
    const nameKey = snapshot.name.toLocaleLowerCase("en-AU");
    if (ids.has(snapshot.id) || names.has(nameKey)) throw new TypeError("Equipment IDs and names must be unique.");
    ids.add(snapshot.id); names.add(nameKey);
    return { ...snapshot, archived: entry.archived };
  });
  return { version: 1, rates: [...input.rates], equipment };
}

export function loadSprayPreferences(storage = getStorage()) {
  const raw = storage.getItem(SPRAY_PREFERENCES_KEY);
  return raw === null ? defaultSprayPreferences() : normalizeSprayPreferences(JSON.parse(raw));
}

export function saveSprayPreferences(next, storage = getStorage()) {
  const normalized = normalizeSprayPreferences(next);
  const before = storage.getItem(SPRAY_PREFERENCES_KEY);
  // Refuse to overwrite a damaged or future settings record without recovery.
  if (before !== null) normalizeSprayPreferences(JSON.parse(before));
  const raw = JSON.stringify(normalized);
  try {
    storage.setItem(SPRAY_PREFERENCES_KEY, raw);
    if (storage.getItem(SPRAY_PREFERENCES_KEY) !== raw) throw new Error("Spray preferences did not persist correctly.");
  } catch (error) {
    try {
      if (before === null) storage.removeItem(SPRAY_PREFERENCES_KEY);
      else storage.setItem(SPRAY_PREFERENCES_KEY, before);
    } catch { /* Preserve the original persistence failure for the caller. */ }
    throw error;
  }
  return normalized;
}

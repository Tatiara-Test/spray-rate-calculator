/** Versioned, channel-local property and appearance settings. */
export const PROPERTY_SETTINGS_VERSION = 1;
export const PROPERTY_SETTINGS_KEY = "pallathorpe-combined:v1:property-settings";
export function propertySettingsKey(prefix = "pallathorpe-combined:v1") { return `${prefix}:property-settings`; }
export const PROPERTY_SETTINGS_DEFAULTS = Object.freeze({
  businessName: "Pallathorpe Enterprises",
  shortName: "Pallathorpe",
  defaultPeriod: "fortnight",
  theme: "pallathorpe",
  emblem: Object.freeze({ id: "farmer-assistant-fh", version: 1 }),
});

export const PROPERTY_THEMES = Object.freeze({
  pallathorpe: Object.freeze({ label: "Pallathorpe", tokens: Object.freeze({ ink: "#18231b", muted: "#5c685f", surface: "#ffffff", accent: "#236b38", accentStrong: "#174c28" }) }),
  fieldbook: Object.freeze({ label: "Fieldbook", tokens: Object.freeze({ ink: "#243019", muted: "#5c684c", surface: "#fffdf4", accent: "#59731f", accentStrong: "#3c5114" }) }),
  mallee: Object.freeze({ label: "Mallee Earth", tokens: Object.freeze({ ink: "#34251c", muted: "#6d5748", surface: "#fffaf3", accent: "#9a5a24", accentStrong: "#713d16" }) }),
  bluegum: Object.freeze({ label: "Blue Gum", tokens: Object.freeze({ ink: "#162d36", muted: "#536a72", surface: "#f5fbfc", accent: "#17657a", accentStrong: "#104957" }) }),
});
export const PROPERTY_THEME_KEYS = Object.freeze(Object.keys(PROPERTY_THEMES));
export const PROPERTY_PERIOD_KEYS = Object.freeze(["week", "fortnight", "month"]);

const text = (value) => typeof value === "string" ? value.trim() : "";

export function normalizePropertySettings(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Property settings must be an object.");
  const businessName = text(input.businessName) || PROPERTY_SETTINGS_DEFAULTS.businessName;
  const shortName = text(input.shortName) || businessName;
  const defaultPeriod = PROPERTY_PERIOD_KEYS.includes(input.defaultPeriod) ? input.defaultPeriod : PROPERTY_SETTINGS_DEFAULTS.defaultPeriod;
  const theme = PROPERTY_THEME_KEYS.includes(input.theme) ? input.theme : PROPERTY_SETTINGS_DEFAULTS.theme;
  if (businessName.length > 120 || shortName.length > 40) throw new TypeError("Property names are too long.");
  return {
    version: PROPERTY_SETTINGS_VERSION,
    businessName,
    shortName,
    defaultPeriod,
    theme,
    emblem: { id: PROPERTY_SETTINGS_DEFAULTS.emblem.id, version: PROPERTY_SETTINGS_DEFAULTS.emblem.version },
  };
}

export function createDefaultPropertySettings() {
  return normalizePropertySettings(PROPERTY_SETTINGS_DEFAULTS);
}

export function inspectPropertySettings(raw) {
  if (raw === null || raw === undefined) return { state: "absent", raw: null, data: createDefaultPropertySettings() };
  if (typeof raw !== "string") return { state: "corrupt", raw, data: null, error: "Property settings are not text." };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { state: "corrupt", raw, data: null, error: "Property settings are not valid JSON." }; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { state: "corrupt", raw, data: null, error: "Property settings are invalid." };
  if (Number.isInteger(parsed.version) && parsed.version > PROPERTY_SETTINGS_VERSION) return { state: "future", raw, data: null, version: parsed.version, error: `Property settings use unsupported version ${parsed.version}.` };
  try {
    const data = normalizePropertySettings(parsed);
    if (parsed.version !== PROPERTY_SETTINGS_VERSION) throw new TypeError("Property settings have an invalid version.");
    if (Object.keys(parsed).sort().join("|") !== Object.keys(data).sort().join("|")) throw new TypeError("Property settings contain unknown fields.");
    if (parsed.businessName !== data.businessName || parsed.shortName !== data.shortName || parsed.defaultPeriod !== data.defaultPeriod || parsed.theme !== data.theme) {
      throw new TypeError("Property settings are not in canonical form.");
    }
    if (Object.keys(parsed.emblem || {}).sort().join("|") !== "id|version") throw new TypeError("Property settings emblem contains unknown fields.");
    if (parsed.emblem && (parsed.emblem.id !== data.emblem.id || parsed.emblem.version !== data.emblem.version)) throw new TypeError("Property emblem identity is invalid.");
    return { state: "ready", raw, data };
  } catch (error) { return { state: "corrupt", raw, data: null, error: error instanceof Error ? error.message : "Property settings are invalid." }; }
}

export function loadPropertySettings(storage = globalThis.localStorage, key = PROPERTY_SETTINGS_KEY) {
  const inspected = inspectPropertySettings(storage?.getItem?.(key));
  if (inspected.state === "absent" || inspected.state === "ready") return inspected.data;
  throw new TypeError(inspected.error);
}

export function persistPropertySettings(storage, input, key = PROPERTY_SETTINGS_KEY) {
  if (!storage || typeof storage.setItem !== "function" || typeof storage.getItem !== "function") throw new TypeError("Browser storage is unavailable.");
  const data = normalizePropertySettings(input);
  const raw = JSON.stringify(data);
  const previousRaw = storage.getItem(key);
  try {
    storage.setItem(key, raw);
    if (storage.getItem(key) !== raw || inspectPropertySettings(raw).state !== "ready") throw new Error("The property settings save could not be verified.");
  } catch (error) {
    try {
      if (previousRaw === null) storage.removeItem(key);
      else storage.setItem(key, previousRaw);
      if (storage.getItem(key) !== previousRaw) throw new Error("The previous property settings could not be restored.");
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  }
  return { raw, data };
}

export function propertyIdentitySnapshot(settings = createDefaultPropertySettings()) {
  const data = normalizePropertySettings(settings);
  return { businessName: data.businessName, shortName: data.shortName, emblem: { ...data.emblem } };
}

export function normalizePropertyIdentitySnapshot(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Property identity snapshot must be an object.");
  if (Object.hasOwn(input, "raster") || Object.hasOwn(input, "bytes") || Object.hasOwn(input, "data")) {
    throw new TypeError("Property identity snapshots cannot contain raster data.");
  }
  const businessName = text(input.businessName);
  const shortName = text(input.shortName);
  if (!businessName || !shortName || businessName.length > 120 || shortName.length > 40) {
    throw new TypeError("Property identity snapshot names are invalid.");
  }
  if (!input.emblem || input.emblem.id !== PROPERTY_SETTINGS_DEFAULTS.emblem.id || input.emblem.version !== PROPERTY_SETTINGS_DEFAULTS.emblem.version) {
    throw new TypeError("Property identity snapshot emblem is invalid.");
  }
  return { businessName, shortName, emblem: { id: input.emblem.id, version: input.emblem.version } };
}

export function propertyTheme(theme) {
  return PROPERTY_THEMES[PROPERTY_THEME_KEYS.includes(theme) ? theme : PROPERTY_SETTINGS_DEFAULTS.theme];
}

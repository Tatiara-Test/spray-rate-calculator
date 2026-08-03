export const LEGACY_PADDOCKS_KEY = "pallathorpe-paddock-records-v1";
export const LEGACY_WORK_NOTES_KEY = "pallathorpe-work-notes:v1";
export const COMBINED_PREFIX = "tatiara-test:spray-rate-calculator:v1";
export const PADDOCKS_KEY = `${COMBINED_PREFIX}:paddocks`;
export const WORK_NOTES_KEY = `${COMBINED_PREFIX}:work-notes`;
export const PROFILE_KEY = `${COMBINED_PREFIX}:profile`;
export const WEATHER_SETTINGS_KEY = `${COMBINED_PREFIX}:weather-settings`;
export const WEATHER_CACHE_KEY = `${COMBINED_PREFIX}:weather-cache`;
export const MIGRATION_KEY = `${COMBINED_PREFIX}:migration`;
export const LEGACY_PADDOCKS_BACKUP_KEY = `${COMBINED_PREFIX}:legacy-backup:paddocks`;
export const LEGACY_WORK_NOTES_BACKUP_KEY = `${COMBINED_PREFIX}:legacy-backup:work-notes`;
export const PRE_RESTORE_RECOVERY_PREFIX = `${COMBINED_PREFIX}:recovery:pre-restore:`;

export const PADDOCK_STORE_VERSION = 2;
export const WORK_NOTES_VERSION = 1;
export const PROFILE_VERSION = 1;
export const WEATHER_SETTINGS_VERSION = 1;
export const COMBINED_BACKUP_VERSION = 2;

export const MACHINES = Object.freeze(["412R", "Hayes boom", "4830", "4023"]);

const text = (value) => (typeof value === "string" ? value : "");
const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const nullableText = (value) => {
  const cleaned = text(value).trim().replace(/\s+/g, " ");
  return cleaned || null;
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreezeJson(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreezeJson(nested);
  return Object.freeze(value);
}

export class UnsupportedDataVersionError extends RangeError {
  constructor(dataset, version, supportedVersion) {
    super(`${dataset} version ${version} is newer than supported version ${supportedVersion}.`);
    this.name = "UnsupportedDataVersionError";
    this.code = "UNSUPPORTED_FUTURE_VERSION";
    this.dataset = dataset;
    this.version = version;
    this.supportedVersion = supportedVersion;
  }
}

function assertSupportedVersion(input, supportedVersion, dataset) {
  const version = input.version === undefined ? 1 : input.version;
  if (!Number.isInteger(version) || version < 1) {
    throw new TypeError(`${dataset} has an invalid version.`);
  }
  if (version > supportedVersion) {
    throw new UnsupportedDataVersionError(dataset, version, supportedVersion);
  }
  return version;
}

export function normalizePaddockStore(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("Paddock records must contain a JSON object.");
  }
  assertSupportedVersion(input, PADDOCK_STORE_VERSION, "Paddock records");
  if (!Array.isArray(input.paddocks)) {
    throw new TypeError("Paddock records must contain a paddocks array.");
  }
  const paddocks = input.paddocks.map((paddock, paddockIndex) => {
    if (!paddock || typeof paddock !== "object" || !Array.isArray(paddock.tanks)) {
      throw new TypeError(`Paddock ${paddockIndex + 1} is not valid.`);
    }
    const name = nullableText(paddock.name);
    if (!name) throw new TypeError(`Paddock ${paddockIndex + 1} has no name.`);
    const tanks = paddock.tanks.map((tank, tankIndex) => {
      if (!tank || typeof tank !== "object" || !Array.isArray(tank.products)) {
        throw new TypeError(`Tank ${tankIndex + 1} in ${name} is not valid.`);
      }
      const products = tank.products.map((product, productIndex) => {
        if (!product || typeof product !== "object" || Array.isArray(product)) {
          throw new TypeError(`Product ${productIndex + 1} in ${name} is not valid.`);
        }
        const productName = nullableText(product.name) || "";
        const baseUnit = product.baseUnit === "g" ? "g" : "ml";
        return {
          ...cloneJson(product),
          slot: Math.max(0, Math.trunc(finite(product.slot))),
          name: productName,
          normalizedName: productName
            ? text(product.normalizedName) || productName.toLocaleLowerCase("en-AU")
            : "",
          rate: finite(product.rate),
          unit: text(product.unit),
          amountBase: finite(product.amountBase),
          baseUnit,
        };
      });
      return {
        ...cloneJson(tank),
        id: text(tank.id) || `migrated-tank-${paddockIndex + 1}-${tankIndex + 1}`,
        tankNumber: Math.max(1, Math.trunc(finite(tank.tankNumber, tankIndex + 1))),
        date: text(tank.date),
        savedAt: text(tank.savedAt),
        updatedAt: text(tank.updatedAt) || text(tank.savedAt),
        tankTotal: finite(tank.tankTotal),
        sprayRate: finite(tank.sprayRate),
        hectares: finite(tank.hectares),
        operator: nullableText(tank.operator),
        machine: MACHINES.includes(tank.machine) ? tank.machine : null,
        products,
      };
    });
    return {
      ...cloneJson(paddock),
      id: text(paddock.id) || `migrated-paddock-${paddockIndex + 1}`,
      name,
      normalizedName: text(paddock.normalizedName) || name.toLocaleLowerCase("en-AU"),
      note: text(paddock.note),
      createdAt: text(paddock.createdAt),
      updatedAt: text(paddock.updatedAt),
      contentRevision: Math.max(1, Math.trunc(finite(paddock.contentRevision, 1))),
      lastGeneratedRevision: Number.isInteger(paddock.lastGeneratedRevision)
        ? paddock.lastGeneratedRevision
        : null,
      lastGeneratedAt: text(paddock.lastGeneratedAt) || null,
      lastGeneratedLabel: ["Original", "Amended"].includes(paddock.lastGeneratedLabel)
        ? paddock.lastGeneratedLabel
        : null,
      tanks,
    };
  });
  return {
    version: PADDOCK_STORE_VERSION,
    paddocks,
    lastPaddockId: text(input.lastPaddockId) || null,
  };
}

function assertPresentFieldsUnchanged(source, normalized, fields, context) {
  for (const field of fields) {
    if (!Object.hasOwn(source, field)) continue;
    if (JSON.stringify(source[field]) !== JSON.stringify(normalized[field])) {
      throw new TypeError(`${context} has an invalid ${field} value that cannot be safely normalized.`);
    }
  }
}

function assertRequiredStoredFields(source, fields, context) {
  const missing = fields.filter((field) => !Object.hasOwn(source, field));
  if (missing.length) {
    throw new TypeError(`${context} is missing required stored fields: ${missing.join(", ")}.`);
  }
}

function normalizeStoredPaddockStore(input) {
  const normalized = normalizePaddockStore(input);
  assertPresentFieldsUnchanged(input, normalized, ["lastPaddockId"], "Paddock records");
  input.paddocks.forEach((paddock, paddockIndex) => {
    const normalizedPaddock = normalized.paddocks[paddockIndex];
    const paddockName = normalizedPaddock.name || `Paddock ${paddockIndex + 1}`;
    assertPresentFieldsUnchanged(
      paddock,
      normalizedPaddock,
      [
        "id", "name", "normalizedName", "note", "createdAt", "updatedAt",
        "contentRevision", "lastGeneratedRevision", "lastGeneratedAt", "lastGeneratedLabel",
      ],
      paddockName,
    );
    paddock.tanks.forEach((tank, tankIndex) => {
      const normalizedTank = normalizedPaddock.tanks[tankIndex];
      assertRequiredStoredFields(
        tank,
        ["id", "tankNumber", "date", "tankTotal", "sprayRate", "hectares", "products"],
        `Tank ${tankIndex + 1} in ${paddockName}`,
      );
      assertPresentFieldsUnchanged(
        tank,
        normalizedTank,
        [
          "id", "tankNumber", "date", "savedAt", "updatedAt", "tankTotal",
          "sprayRate", "hectares", "operator", "machine",
        ],
        `Tank ${tankIndex + 1} in ${paddockName}`,
      );
      tank.products.forEach((product, productIndex) => {
        if (!product || typeof product !== "object" || Array.isArray(product)) {
          throw new TypeError(`Product ${productIndex + 1} in ${paddockName} is not a stored record object.`);
        }
        assertRequiredStoredFields(
          product,
          ["slot", "rate", "unit", "amountBase", "baseUnit"],
          `Product ${productIndex + 1} in ${paddockName}`,
        );
        assertPresentFieldsUnchanged(
          product,
          normalizedTank.products[productIndex],
          ["slot", "name", "normalizedName", "rate", "unit", "amountBase", "baseUnit"],
          `Product ${productIndex + 1} in ${paddockName}`,
        );
      });
    });
  });
  return normalized;
}

export function normalizeWorkNotesData(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Work Notes backup must contain a JSON object.");
  }
  assertSupportedVersion(input, WORK_NOTES_VERSION, "Work Notes");
  if (!input.notes || typeof input.notes !== "object" || Array.isArray(input.notes)) {
    throw new TypeError("Work Notes backup is missing notes.");
  }
  if (!input.copied || typeof input.copied !== "object" || Array.isArray(input.copied)) {
    throw new TypeError("Work Notes backup is missing copied state.");
  }
  if (!Array.isArray(input.followUps)) {
    throw new TypeError("Work Notes backup is missing follow-ups.");
  }
  return { ...cloneJson(input), version: WORK_NOTES_VERSION };
}

function readJson(storage, key) {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  return JSON.parse(raw);
}

function writeVerified(storage, key, value) {
  const raw = JSON.stringify(value);
  storage.setItem(key, raw);
  const verified = storage.getItem(key);
  if (verified !== raw) throw new Error(`Could not verify ${key}.`);
}

function safeRawBackup(storage, key, sourceKey, raw, now) {
  if (raw === null || storage.getItem(key) !== null) return false;
  try {
    writeVerified(storage, key, { sourceKey, capturedAt: now, raw });
    return true;
  } catch {
    return false;
  }
}

function writeMigrationMarker(storage, markerName, details) {
  let marker = {};
  try {
    marker = readJson(storage, MIGRATION_KEY) || {};
  } catch {
    marker = {};
  }
  writeVerified(storage, MIGRATION_KEY, {
    ...marker,
    version: 1,
    [markerName]: details,
  });
}

export function migrateDataset({
  storage,
  targetKey,
  sourceKey,
  backupKey,
  normalize,
  normalizeExisting = normalize,
  markerName,
  now = new Date().toISOString(),
}) {
  const existingRaw = storage.getItem(targetKey);
  if (existingRaw !== null) {
    const existing = normalizeExisting(JSON.parse(existingRaw));
    const sourceRaw = storage.getItem(sourceKey);
    if (sourceRaw) safeRawBackup(storage, backupKey, sourceKey, sourceRaw, now);
    let marker;
    try {
      marker = readJson(storage, MIGRATION_KEY);
    } catch {
      marker = null;
    }
    if (!marker?.[markerName]) {
      writeMigrationMarker(storage, markerName, {
        status: "existing",
        sourceKey: sourceRaw ? sourceKey : null,
        confirmedAt: now,
      });
    }
    return { status: "existing", value: existing, sourceUntouched: sourceRaw };
  }

  const sourceRaw = storage.getItem(sourceKey);
  if (sourceRaw === null) {
    let marker;
    try {
      marker = readJson(storage, MIGRATION_KEY);
    } catch {
      marker = null;
    }
    if (!marker?.[markerName]) {
      writeMigrationMarker(storage, markerName, { status: "absent", sourceKey, checkedAt: now });
    }
    return { status: "absent", value: null, sourceUntouched: null };
  }
  safeRawBackup(storage, backupKey, sourceKey, sourceRaw, now);

  let normalized;
  try {
    normalized = normalize(JSON.parse(sourceRaw));
  } catch (error) {
    return { status: "invalid", value: null, error, sourceUntouched: storage.getItem(sourceKey) };
  }

  writeVerified(storage, targetKey, normalized);
  if (storage.getItem(sourceKey) !== sourceRaw) {
    throw new Error(`${sourceKey} changed during migration.`);
  }

  writeMigrationMarker(storage, markerName, {
    status: "imported",
    sourceKey,
    importedAt: now,
  });
  return { status: "imported", value: normalized, sourceUntouched: storage.getItem(sourceKey) };
}

export function migrateLegacyData(storage = globalThis.localStorage, now) {
  const independently = (options) => {
    try {
      return migrateDataset(options);
    } catch (error) {
      let sourceUntouched = null;
      try {
        sourceUntouched = storage.getItem(options.sourceKey);
      } catch {
        // Storage itself is unavailable; report the dataset error without masking it.
      }
      return {
        status: "error",
        value: null,
        error,
        sourceUntouched,
      };
    }
  };
  const paddocks = independently({
    storage,
    targetKey: PADDOCKS_KEY,
    sourceKey: LEGACY_PADDOCKS_KEY,
    backupKey: LEGACY_PADDOCKS_BACKUP_KEY,
    normalize: normalizePaddockStore,
    normalizeExisting: normalizeStoredPaddockStore,
    markerName: "paddocks",
    now,
  });
  const workNotes = independently({
    storage,
    targetKey: WORK_NOTES_KEY,
    sourceKey: LEGACY_WORK_NOTES_KEY,
    backupKey: LEGACY_WORK_NOTES_BACKUP_KEY,
    normalize: normalizeWorkNotesData,
    markerName: "workNotes",
    now,
  });
  return { paddocks, workNotes };
}

export function inspectPaddockStore(storage = globalThis.localStorage) {
  let raw;
  try {
    raw = storage.getItem(PADDOCKS_KEY);
  } catch (error) {
    return { status: "corrupt", raw: null, value: null, error };
  }
  if (raw === null) return { status: "absent", raw: null, value: null };

  try {
    return { status: "ready", raw, value: normalizeStoredPaddockStore(JSON.parse(raw)) };
  } catch (error) {
    if (error?.code === "UNSUPPORTED_FUTURE_VERSION") {
      return {
        status: "future",
        raw,
        value: null,
        version: error.version,
        supportedVersion: error.supportedVersion,
        error,
      };
    }
    return { status: "corrupt", raw, value: null, error };
  }
}

export function loadPaddockStore(storage = globalThis.localStorage) {
  try {
    const parsed = readJson(storage, PADDOCKS_KEY);
    return parsed ? normalizePaddockStore(parsed) : { version: 2, paddocks: [], lastPaddockId: null };
  } catch {
    return { version: 2, paddocks: [], lastPaddockId: null };
  }
}

export function persistPaddockStore(store, storage = globalThis.localStorage) {
  writeVerified(storage, PADDOCKS_KEY, normalizePaddockStore(store));
}

export function normalizeProfileData(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Operator profile must contain a JSON object.");
  }
  assertSupportedVersion(input, PROFILE_VERSION, "Operator profile");
  if (input.operator !== undefined && input.operator !== null && typeof input.operator !== "string") {
    throw new TypeError("Operator profile has an invalid operator name.");
  }
  if (input.operatorPrompted !== undefined && typeof input.operatorPrompted !== "boolean") {
    throw new TypeError("Operator profile has an invalid prompt state.");
  }
  if (
    input.lastMachine !== undefined
    && input.lastMachine !== null
    && !MACHINES.includes(input.lastMachine)
  ) {
    throw new TypeError("Operator profile has an unknown machine.");
  }
  return {
    version: PROFILE_VERSION,
    operator: nullableText(input.operator),
    operatorPrompted: input.operatorPrompted === true,
    lastMachine: MACHINES.includes(input.lastMachine) ? input.lastMachine : MACHINES[0],
  };
}

function validateWeatherLink(link, index) {
  if (!link || typeof link !== "object" || Array.isArray(link)) {
    throw new TypeError(`Weather shortcut ${index + 1} is not valid.`);
  }
  if (typeof link.label !== "string" || !nullableText(link.label)) {
    throw new TypeError(`Weather shortcut ${index + 1} has no label.`);
  }
  if (typeof link.url !== "string") {
    throw new TypeError(`Weather shortcut ${index + 1} has no address.`);
  }
  let parsed;
  try {
    parsed = new URL(link.url);
  } catch {
    throw new TypeError(`Weather shortcut ${index + 1} has an invalid address.`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new TypeError(`Weather shortcut ${index + 1} has an invalid address.`);
  }
  if (link.id !== undefined && (typeof link.id !== "string" || !link.id.trim())) {
    throw new TypeError(`Weather shortcut ${index + 1} has an invalid identifier.`);
  }
  if (link.builtIn !== undefined && typeof link.builtIn !== "boolean") {
    throw new TypeError(`Weather shortcut ${index + 1} has an invalid built-in state.`);
  }
}

export function normalizeWeatherSettingsData(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Weather settings must contain a JSON object.");
  }
  assertSupportedVersion(input, WEATHER_SETTINGS_VERSION, "Weather settings");
  if (input.location !== null && input.location !== undefined) {
    if (
      typeof input.location !== "object"
      || Array.isArray(input.location)
      || typeof input.location.label !== "string"
      || !nullableText(input.location.label)
      || !Number.isFinite(input.location.latitude)
      || !Number.isFinite(input.location.longitude)
      || input.location.latitude < -90
      || input.location.latitude > 90
      || input.location.longitude < -180
      || input.location.longitude > 180
    ) {
      throw new TypeError("Weather settings contain an invalid location.");
    }
  }
  if (input.links !== undefined && !Array.isArray(input.links)) {
    throw new TypeError("Weather settings must contain a shortcuts array.");
  }
  const links = input.links === undefined ? [] : input.links;
  links.forEach(validateWeatherLink);
  const ids = links
    .filter((link) => typeof link.id === "string")
    .map((link) => link.id.trim());
  if (new Set(ids).size !== ids.length) {
    throw new TypeError("Weather settings contain duplicate shortcut identifiers.");
  }
  return {
    version: WEATHER_SETTINGS_VERSION,
    location: input.location ? cloneJson(input.location) : null,
    links: cloneJson(links),
  };
}

function inspectVersionedStore(storage, key, normalize) {
  let raw;
  try {
    raw = storage.getItem(key);
  } catch (error) {
    return { status: "corrupt", raw: null, value: null, error };
  }
  if (raw === null) return { status: "absent", raw: null, value: null };
  try {
    const value = normalize(JSON.parse(raw));
    return { status: "ready", raw, value, version: value.version };
  } catch (error) {
    if (error?.code === "UNSUPPORTED_FUTURE_VERSION") {
      return {
        status: "future",
        raw,
        value: null,
        version: error.version,
        supportedVersion: error.supportedVersion,
        error,
      };
    }
    return { status: "corrupt", raw, value: null, error };
  }
}

export function inspectProfileStore(storage = globalThis.localStorage) {
  return inspectVersionedStore(storage, PROFILE_KEY, normalizeProfileData);
}

export function loadProfile(storage = globalThis.localStorage) {
  const inspection = inspectProfileStore(storage);
  if (inspection.status === "absent") return normalizeProfileData({});
  if (inspection.status === "ready") return inspection.value;
  throw inspection.error;
}

export function persistProfile(profile, storage = globalThis.localStorage) {
  const existing = inspectProfileStore(storage);
  if (existing.status === "corrupt" || existing.status === "future") {
    const error = new Error("Existing operator profile is protected and cannot be overwritten.");
    error.code = "PROTECTED_EXISTING_DATA";
    error.inspection = existing;
    throw error;
  }
  writeVerified(storage, PROFILE_KEY, normalizeProfileData(profile));
}

export function inspectWeatherSettingsStore(storage = globalThis.localStorage) {
  return inspectVersionedStore(storage, WEATHER_SETTINGS_KEY, normalizeWeatherSettingsData);
}

export function loadWeatherSettings(storage = globalThis.localStorage) {
  const inspection = inspectWeatherSettingsStore(storage);
  if (inspection.status === "absent") return normalizeWeatherSettingsData({});
  if (inspection.status === "ready") return inspection.value;
  throw inspection.error;
}

export function persistWeatherSettings(settings, storage = globalThis.localStorage) {
  const existing = inspectWeatherSettingsStore(storage);
  if (existing.status === "corrupt" || existing.status === "future") {
    const error = new Error("Existing weather settings are protected and cannot be overwritten.");
    error.code = "PROTECTED_EXISTING_DATA";
    error.inspection = existing;
    throw error;
  }
  writeVerified(storage, WEATHER_SETTINGS_KEY, normalizeWeatherSettingsData(settings));
}

function datasetVersion(value, fallback) {
  return Number.isInteger(value?.version) && value.version > 0 ? value.version : fallback;
}

function normalizedBackupMetadata(options, datasets) {
  const configuredOrigin = nullableText(options?.origin);
  const browserOrigin = nullableText(globalThis.location?.origin);
  const selectedOrigin = configuredOrigin || browserOrigin;
  return {
    channel: nullableText(options?.channel) || "combined-app",
    origin: selectedOrigin === "null" ? null : selectedOrigin,
    datasetVersions: {
      paddocks: datasetVersion(datasets.paddocks, PADDOCK_STORE_VERSION),
      workNotes: datasetVersion(datasets.workNotes, WORK_NOTES_VERSION),
      profile: PROFILE_VERSION,
      weatherSettings: WEATHER_SETTINGS_VERSION,
    },
  };
}

export function combinedBackupExport(storage = globalThis.localStorage, now = new Date(), options = {}) {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const normalizeWorkNotes = options.normalizeWorkNotes ?? normalizeWorkNotesData;
  if (typeof normalizeWorkNotes !== "function") {
    throw new TypeError("A Work Notes normalizer must be a function.");
  }
  const parseOrNull = (key, normalize) => {
    try {
      const raw = storage.getItem(key);
      if (raw === null) return null;
      return normalize(JSON.parse(raw));
    } catch (cause) {
      const error = new TypeError(`Cannot create a backup because ${key} contains unreadable data or an invalid schema.`);
      error.cause = cause;
      error.key = key;
      throw error;
    }
  };
  const datasets = {
    paddocks: parseOrNull(PADDOCKS_KEY, normalizeStoredPaddockStore),
    workNotes: parseOrNull(WORK_NOTES_KEY, (value) => {
      assertSupportedVersion(value, WORK_NOTES_VERSION, "Work Notes");
      return normalizeWorkNotesData(normalizeWorkNotes(cloneJson(value)));
    }),
    profile: parseOrNull(PROFILE_KEY, normalizeProfileData),
    weatherSettings: parseOrNull(WEATHER_SETTINGS_KEY, normalizeWeatherSettingsData),
  };
  const payload = {
    format: "pallathorpe-combined-backup",
    version: COMBINED_BACKUP_VERSION,
    generatedAt: now.toISOString(),
    metadata: normalizedBackupMetadata(options, datasets),
    ...datasets,
  };
  return {
    filename: `pallathorpe-combined-backup_${date}.json`,
    text: `${JSON.stringify(payload, null, 2)}\n`,
    payload,
  };
}

const PREPARED_RESTORE = Symbol("prepared-combined-backup-restore");
const RESTORE_DATASETS = Object.freeze([
  { name: "paddocks", key: PADDOCKS_KEY, version: PADDOCK_STORE_VERSION },
  { name: "workNotes", key: WORK_NOTES_KEY, version: WORK_NOTES_VERSION },
  { name: "profile", key: PROFILE_KEY, version: PROFILE_VERSION },
  { name: "weatherSettings", key: WEATHER_SETTINGS_KEY, version: WEATHER_SETTINGS_VERSION },
]);

function parseCombinedBackupInput(input) {
  if (typeof input === "string") return JSON.parse(input);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Combined backup must contain a JSON object.");
  }
  return cloneJson(input);
}

function validateV2BackupMetadata(metadata, payload) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError("Combined backup v2 is missing metadata.");
  }
  if (!nullableText(metadata.channel)) {
    throw new TypeError("Combined backup v2 is missing its channel.");
  }
  if (metadata.origin !== null && metadata.origin !== undefined && !nullableText(metadata.origin)) {
    throw new TypeError("Combined backup v2 has an invalid origin.");
  }
  if (!metadata.datasetVersions || typeof metadata.datasetVersions !== "object" || Array.isArray(metadata.datasetVersions)) {
    throw new TypeError("Combined backup v2 is missing dataset versions.");
  }
  for (const dataset of RESTORE_DATASETS) {
    if (!Object.hasOwn(payload, dataset.name)) continue;
    const version = metadata.datasetVersions[dataset.name];
    if (!Number.isInteger(version) || version < 1) {
      throw new TypeError(`Combined backup has an invalid ${dataset.name} dataset version.`);
    }
    if (version > dataset.version) {
      throw new UnsupportedDataVersionError(
        `Combined backup ${dataset.name} dataset`,
        version,
        dataset.version,
      );
    }
  }
}

/**
 * Fully validates and normalizes a combined backup without changing storage.
 * Pass Work Notes' authoritative normalizeBackup function as normalizeWorkNotes
 * when this API is called from the integrated application.
 */
export function prepareCombinedBackupRestore(input, options = {}) {
  const payload = parseCombinedBackupInput(input);
  if (payload.format !== "pallathorpe-combined-backup") {
    throw new TypeError("That file is not a Pallathorpe combined backup.");
  }
  const backupVersion = assertSupportedVersion(payload, COMBINED_BACKUP_VERSION, "Combined backup");
  if (backupVersion === COMBINED_BACKUP_VERSION) {
    validateV2BackupMetadata(payload.metadata, payload);
  }
  if (!Object.hasOwn(payload, "paddocks") || !Object.hasOwn(payload, "workNotes")) {
    throw new TypeError("Combined backup is missing paddocks or Work Notes.");
  }

  const normalizeWorkNotes = options.normalizeWorkNotes ?? normalizeWorkNotesData;
  if (typeof normalizeWorkNotes !== "function") {
    throw new TypeError("A Work Notes normalizer must be a function.");
  }

  const datasets = {};
  const skippedLegacyNullDatasets = [];
  for (const dataset of RESTORE_DATASETS) {
    if (!Object.hasOwn(payload, dataset.name)) continue;
    const value = payload[dataset.name];
    if (value === null) {
      if (backupVersion === 1) {
        skippedLegacyNullDatasets.push(dataset.name);
        continue;
      }
      if (dataset.name === "paddocks") {
        datasets.paddocks = normalizePaddockStore({
          version: PADDOCK_STORE_VERSION,
          paddocks: [],
          lastPaddockId: null,
        });
        continue;
      }
      if (dataset.name === "workNotes") {
        datasets.workNotes = normalizeWorkNotesData(normalizeWorkNotes({
          version: WORK_NOTES_VERSION,
          notes: {},
          copied: {},
          followUps: [],
        }));
        continue;
      }
      datasets[dataset.name] = null;
      continue;
    }
    if (dataset.name === "paddocks") {
      datasets.paddocks = normalizePaddockStore(value);
    } else if (dataset.name === "workNotes") {
      assertSupportedVersion(value, WORK_NOTES_VERSION, "Work Notes");
      datasets.workNotes = normalizeWorkNotesData(normalizeWorkNotes(cloneJson(value)));
    } else if (dataset.name === "profile") {
      datasets.profile = normalizeProfileData(value);
    } else {
      datasets.weatherSettings = normalizeWeatherSettingsData(value);
    }
  }
  if (Object.keys(datasets).length === 0) {
    throw new TypeError("This legacy combined backup contains no dataset that can be restored safely.");
  }

  const prepared = {
    format: payload.format,
    backupVersion,
    generatedAt: text(payload.generatedAt) || null,
    metadata: backupVersion === COMBINED_BACKUP_VERSION ? cloneJson(payload.metadata) : null,
    datasets,
    skippedLegacyNullDatasets,
  };
  Object.defineProperty(prepared, PREPARED_RESTORE, { value: true });
  return deepFreezeJson(prepared);
}

function restoreTimestamp(now) {
  const parsed = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(parsed.getTime())) throw new TypeError("A valid restore time is required.");
  return parsed.toISOString();
}

function writeRawVerified(storage, key, raw) {
  if (raw === null) {
    storage.removeItem(key);
    if (storage.getItem(key) !== null) throw new Error(`Could not verify removal of ${key}.`);
    return;
  }
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error(`Could not verify ${key}.`);
}

function availableRecoveryKey(storage, restoredAt) {
  const timestamp = restoredAt.replace(/[^0-9TZ]/g, "-");
  const base = `${PRE_RESTORE_RECOVERY_PREFIX}${timestamp}`;
  let key = base;
  let suffix = 2;
  while (storage.getItem(key) !== null) {
    key = `${base}-${suffix}`;
    suffix += 1;
  }
  return key;
}

/**
 * Applies a prepared backup as one local transaction. A verified raw recovery
 * snapshot is written before the first target change; any later failure rolls
 * every included target back to its exact prior raw value.
 */
export function restoreCombinedBackup(
  prepared,
  storage = globalThis.localStorage,
  now = new Date(),
) {
  if (!prepared || prepared[PREPARED_RESTORE] !== true) {
    throw new TypeError("Prepare and validate the combined backup before restoring it.");
  }
  const restoredAt = restoreTimestamp(now);
  const targets = RESTORE_DATASETS.filter((dataset) => Object.hasOwn(prepared.datasets, dataset.name));
  const previousRaw = Object.fromEntries(targets.map(({ key }) => [key, storage.getItem(key)]));
  const nextRaw = Object.fromEntries(targets.map(({ name, key }) => [
    key,
    prepared.datasets[name] === null ? null : JSON.stringify(prepared.datasets[name]),
  ]));

  const recoveryKey = availableRecoveryKey(storage, restoredAt);
  writeVerified(storage, recoveryKey, {
    format: "pallathorpe-combined-pre-restore-recovery",
    version: 1,
    capturedAt: restoredAt,
    sourceBackup: {
      version: prepared.backupVersion,
      generatedAt: prepared.generatedAt,
      metadata: prepared.metadata,
    },
    rawByKey: previousRaw,
  });

  try {
    for (const { key } of targets) writeRawVerified(storage, key, nextRaw[key]);
  } catch (cause) {
    const rollbackErrors = [];
    for (const { key } of [...targets].reverse()) {
      try {
        writeRawVerified(storage, key, previousRaw[key]);
      } catch (error) {
        rollbackErrors.push({ key, error });
      }
    }
    const error = new Error(
      rollbackErrors.length
        ? "Combined backup restore failed and one or more records could not be rolled back."
        : "Combined backup restore failed; all records were rolled back.",
    );
    error.cause = cause;
    error.recoveryKey = recoveryKey;
    error.rollbackErrors = rollbackErrors;
    throw error;
  }

  return {
    status: "restored",
    restoredAt,
    recoveryKey,
    backupVersion: prepared.backupVersion,
    restoredKeys: targets.map(({ key }) => key),
  };
}

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

export function normalizePaddockStore(input) {
  if (!input || typeof input !== "object" || !Array.isArray(input.paddocks)) {
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
        if (!product || typeof product !== "object") {
          throw new TypeError(`Product ${productIndex + 1} in ${name} is not valid.`);
        }
        const productName = nullableText(product.name);
        if (!productName) throw new TypeError(`A product in ${name} has no name.`);
        const baseUnit = product.baseUnit === "g" ? "g" : "ml";
        return {
          ...cloneJson(product),
          slot: Math.max(0, Math.trunc(finite(product.slot))),
          name: productName,
          normalizedName: text(product.normalizedName) || productName.toLocaleLowerCase("en-AU"),
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
    version: 2,
    paddocks,
    lastPaddockId: text(input.lastPaddockId) || null,
  };
}

export function normalizeWorkNotesData(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Work Notes backup must contain a JSON object.");
  }
  if (!input.notes || typeof input.notes !== "object" || Array.isArray(input.notes)) {
    throw new TypeError("Work Notes backup is missing notes.");
  }
  if (!input.copied || typeof input.copied !== "object" || Array.isArray(input.copied)) {
    throw new TypeError("Work Notes backup is missing copied state.");
  }
  if (!Array.isArray(input.followUps)) {
    throw new TypeError("Work Notes backup is missing follow-ups.");
  }
  return cloneJson(input);
}

function readJson(storage, key) {
  const raw = storage.getItem(key);
  if (!raw) return null;
  return JSON.parse(raw);
}

function writeVerified(storage, key, value) {
  const raw = JSON.stringify(value);
  storage.setItem(key, raw);
  const verified = storage.getItem(key);
  if (verified !== raw) throw new Error(`Could not verify ${key}.`);
}

function safeRawBackup(storage, key, sourceKey, raw, now) {
  if (!raw || storage.getItem(key)) return false;
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
  markerName,
  now = new Date().toISOString(),
}) {
  const existingRaw = storage.getItem(targetKey);
  if (existingRaw) {
    const existing = normalize(JSON.parse(existingRaw));
    if (JSON.stringify(existing) !== existingRaw) writeVerified(storage, targetKey, existing);
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
  if (!sourceRaw) {
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

export function loadProfile(storage = globalThis.localStorage) {
  try {
    const value = readJson(storage, PROFILE_KEY) || {};
    return {
      operator: nullableText(value.operator),
      operatorPrompted: value.operatorPrompted === true,
      lastMachine: MACHINES.includes(value.lastMachine) ? value.lastMachine : MACHINES[0],
    };
  } catch {
    return { operator: null, operatorPrompted: false, lastMachine: MACHINES[0] };
  }
}

export function persistProfile(profile, storage = globalThis.localStorage) {
  writeVerified(storage, PROFILE_KEY, {
    operator: nullableText(profile.operator),
    operatorPrompted: profile.operatorPrompted === true,
    lastMachine: MACHINES.includes(profile.lastMachine) ? profile.lastMachine : MACHINES[0],
  });
}

export function loadWeatherSettings(storage = globalThis.localStorage) {
  try {
    const value = readJson(storage, WEATHER_SETTINGS_KEY) || {};
    return {
      location: value.location && Number.isFinite(value.location.latitude) && Number.isFinite(value.location.longitude)
        ? cloneJson(value.location)
        : null,
      links: Array.isArray(value.links) ? cloneJson(value.links) : [],
    };
  } catch {
    return { location: null, links: [] };
  }
}

export function persistWeatherSettings(settings, storage = globalThis.localStorage) {
  writeVerified(storage, WEATHER_SETTINGS_KEY, settings);
}

export function combinedBackupExport(storage = globalThis.localStorage, now = new Date()) {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const parseOrNull = (key) => {
    try {
      return readJson(storage, key);
    } catch {
      return null;
    }
  };
  const payload = {
    format: "pallathorpe-combined-backup",
    version: 1,
    generatedAt: now.toISOString(),
    paddocks: parseOrNull(PADDOCKS_KEY),
    workNotes: parseOrNull(WORK_NOTES_KEY),
    profile: parseOrNull(PROFILE_KEY),
    weatherSettings: parseOrNull(WEATHER_SETTINGS_KEY),
    migration: parseOrNull(MIGRATION_KEY),
  };
  return {
    filename: `pallathorpe-combined-backup_${date}.json`,
    text: `${JSON.stringify(payload, null, 2)}\n`,
    payload,
  };
}

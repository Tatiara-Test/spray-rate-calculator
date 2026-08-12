import { normalizeServicingRecord } from "./servicing-records.mjs";

export const SERVICING_STORE_VERSION = 1;
export const SERVICING_MINIMUM_COMPLETE_BACKUP_VERSION = 4;
export const SERVICING_COMPATIBILITY_RELEASE_ID = "pallathorpe-servicing-backup-v4-compatibility-2026-08-12";
export const SERVICING_COMPATIBILITY_CAPABILITY = "combined-backup-v4-aware";

const clone = (value) => JSON.parse(JSON.stringify(value));

export function servicingStorageKeys(prefix) {
  if (typeof prefix !== "string" || !prefix.trim() || prefix !== prefix.trim()) {
    throw new TypeError("A channel-specific combined storage prefix is required for 4830 servicing.");
  }
  return Object.freeze({
    records: `${prefix}:servicing-4830`,
    compatibility: `${prefix}:servicing-compatibility`,
  });
}

function assertStorageKeys(keys) {
  if (!keys || typeof keys !== "object" || Array.isArray(keys)
    || typeof keys.records !== "string" || !keys.records
    || typeof keys.compatibility !== "string" || !keys.compatibility
    || keys.records === keys.compatibility) {
    throw new TypeError("Channel-specific 4830 servicing storage keys are required.");
  }
  return keys;
}

function assertExactKeys(value, keys, context) {
  if (Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) {
    throw new TypeError(`${context} has an unexpected schema.`);
  }
}

export function emptyServicingStore() {
  return { version: SERVICING_STORE_VERSION, generation: 0, drafts: [], recordSeries: [] };
}

function unsupportedVersion(dataset, version, supportedVersion) {
  const error = new RangeError(`${dataset} version ${version} is newer than supported version ${supportedVersion}.`);
  error.name = "UnsupportedDataVersionError";
  error.code = "UNSUPPORTED_FUTURE_VERSION";
  error.dataset = dataset;
  error.version = version;
  error.supportedVersion = supportedVersion;
  return error;
}

export function normalizeServicingStore(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("4830 servicing data must contain an object.");
  assertExactKeys(input, ["version", "generation", "drafts", "recordSeries"], "4830 servicing data");
  if (!Number.isInteger(input.version) || input.version < 1) throw new TypeError("4830 servicing data has an invalid version.");
  if (input.version > SERVICING_STORE_VERSION) throw unsupportedVersion("4830 servicing data", input.version, SERVICING_STORE_VERSION);
  if (!Number.isInteger(input.generation) || input.generation < 0) throw new TypeError("4830 servicing generation is invalid.");
  if (!Array.isArray(input.drafts) || !Array.isArray(input.recordSeries)) throw new TypeError("4830 servicing drafts and record series are required.");

  const ids = new Set();
  const series = new Map();
  const recordSeries = input.recordSeries.map((entry, seriesIndex) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.seriesId !== "string" || !entry.seriesId.trim() || entry.seriesId !== entry.seriesId.trim()) {
      throw new TypeError(`4830 servicing series ${seriesIndex + 1} has an invalid identity.`);
    }
    assertExactKeys(entry, ["seriesId", "revisions"], `4830 servicing series ${seriesIndex + 1}`);
    if (series.has(entry.seriesId) || !Array.isArray(entry.revisions) || !entry.revisions.length) {
      throw new TypeError(`4830 servicing series ${entry.seriesId} is duplicated or empty.`);
    }
    const revisions = entry.revisions.map(normalizeServicingRecord);
    revisions.forEach((revision, index) => {
      if (revision.seriesId !== entry.seriesId || revision.revision !== index + 1 || revision.lifecycle === "draft") {
        throw new TypeError(`4830 servicing series ${entry.seriesId} has an invalid revision sequence.`);
      }
      if (ids.has(revision.recordId)) throw new TypeError(`4830 servicing record ${revision.recordId} is duplicated.`);
      if (index > 0 && revision.supersedesRecordId !== revisions[index - 1].recordId) {
        throw new TypeError(`4830 servicing series ${entry.seriesId} has a broken amendment chain.`);
      }
      ids.add(revision.recordId);
    });
    const normalized = { seriesId: entry.seriesId, revisions };
    series.set(entry.seriesId, normalized);
    return normalized;
  });

  const draftSeries = new Set();
  const drafts = input.drafts.map((entry, index) => {
    const draft = normalizeServicingRecord(entry);
    if (draft.lifecycle !== "draft") throw new TypeError(`4830 servicing draft ${index + 1} is not a draft.`);
    if (ids.has(draft.recordId) || draftSeries.has(draft.seriesId)) throw new TypeError(`4830 servicing draft ${draft.recordId} is duplicated.`);
    const prior = series.get(draft.seriesId)?.revisions || [];
    if (prior.length === 0) {
      if (draft.revision !== 1 || draft.seriesId !== draft.recordId) throw new TypeError("New servicing draft identity is inconsistent.");
    } else {
      const latest = prior.at(-1);
      if (draft.revision !== latest.revision + 1 || draft.supersedesRecordId !== latest.recordId) {
        throw new TypeError(`4830 servicing amendment draft ${draft.recordId} does not follow its latest revision.`);
      }
    }
    ids.add(draft.recordId);
    draftSeries.add(draft.seriesId);
    return draft;
  });
  return { version: SERVICING_STORE_VERSION, generation: input.generation, drafts, recordSeries };
}

export function inspectServicingStore(storage = globalThis.localStorage, keys) {
  const { records: recordsKey } = assertStorageKeys(keys);
  let raw;
  try {
    raw = storage.getItem(recordsKey);
  } catch (error) {
    return { status: "corrupt", raw: null, value: null, error };
  }
  if (raw === null) return { status: "absent", raw: null, value: null };
  try {
    return { status: "ready", raw, value: normalizeServicingStore(JSON.parse(raw)) };
  } catch (error) {
    return error?.code === "UNSUPPORTED_FUTURE_VERSION"
      ? { status: "future", raw, value: null, version: error.version, supportedVersion: error.supportedVersion, error }
      : { status: "corrupt", raw, value: null, error };
  }
}

export function loadServicingStore(storage = globalThis.localStorage, keys) {
  const inspected = inspectServicingStore(storage, keys);
  if (inspected.status === "absent") return emptyServicingStore();
  if (inspected.status === "ready") return inspected.value;
  throw inspected.error;
}

function rollbackVerified(storage, key, previousRaw) {
  if (previousRaw === null) {
    storage.removeItem(key);
    if (storage.getItem(key) !== null) throw new Error(`Could not verify rollback removal of ${key}.`);
  } else {
    storage.setItem(key, previousRaw);
    if (storage.getItem(key) !== previousRaw) throw new Error(`Could not verify rollback of ${key}.`);
  }
}

function writeRawWithRollback(storage, key, raw, previousRaw) {
  try {
    storage.setItem(key, raw);
    if (storage.getItem(key) !== raw) throw new Error(`Could not verify ${key}.`);
  } catch (cause) {
    try {
      rollbackVerified(storage, key, previousRaw);
    } catch (rollbackCause) {
      const error = new Error(`${key} write failed and its exact previous bytes could not be restored.`);
      error.code = "WRITE_ROLLBACK_FAILED";
      error.cause = cause;
      error.rollbackCause = rollbackCause;
      throw error;
    }
    const error = new Error(`${key} write failed; its exact previous bytes were restored.`);
    error.code = "WRITE_NOT_VERIFIED";
    error.cause = cause;
    throw error;
  }
}

function normalizeCompatibility(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Servicing compatibility state is invalid.");
  if (!Number.isInteger(value.markerVersion) || value.markerVersion < 1) throw new TypeError("Servicing compatibility marker version is invalid.");
  if (value.markerVersion > 1) throw unsupportedVersion("Servicing compatibility marker", value.markerVersion, 1);
  if (Object.keys(value).sort().join("|") !== "capability|completeBackupVersion|markerVersion|preparedAt|releaseId") {
    throw new TypeError("Servicing compatibility marker has an unexpected schema.");
  }
  if (value.releaseId !== SERVICING_COMPATIBILITY_RELEASE_ID
    || value.capability !== SERVICING_COMPATIBILITY_CAPABILITY
    || value.completeBackupVersion !== SERVICING_MINIMUM_COMPLETE_BACKUP_VERSION) {
    throw new TypeError("Servicing compatibility marker does not identify the required prior release capability.");
  }
  if (typeof value.preparedAt !== "string" || Number.isNaN(new Date(value.preparedAt).getTime())
    || new Date(value.preparedAt).toISOString() !== value.preparedAt) {
    throw new TypeError("Servicing compatibility marker time is invalid.");
  }
  return clone(value);
}

export function inspectServicingCompatibility(storage = globalThis.localStorage, keys) {
  const { compatibility: compatibilityKey } = assertStorageKeys(keys);
  let raw;
  try {
    raw = storage.getItem(compatibilityKey);
  } catch (error) {
    return { status: "corrupt", raw: null, value: null, error };
  }
  if (raw === null) return { status: "absent", raw: null, value: null };
  try {
    return { status: "ready", raw, value: normalizeCompatibility(JSON.parse(raw)) };
  } catch (error) {
    return error?.code === "UNSUPPORTED_FUTURE_VERSION"
      ? { status: "future", raw, value: null, version: error.version, supportedVersion: 1, error }
      : { status: "corrupt", raw, value: null, error };
  }
}

export function assertCompleteCombinedBackupAllowed(storage, clientBackupVersion, keys) {
  const { records: recordsKey } = assertStorageKeys(keys);
  if (!Number.isInteger(clientBackupVersion) || clientBackupVersion < 1) throw new TypeError("Combined backup client version is invalid.");
  let servicingRaw;
  try {
    servicingRaw = storage.getItem(recordsKey);
  } catch (cause) {
    const error = new Error("Cannot determine whether this client can create a complete servicing backup.");
    error.code = "BACKUP_COMPATIBILITY_UNKNOWN";
    error.cause = cause;
    throw error;
  }
  if (servicingRaw !== null && clientBackupVersion < SERVICING_MINIMUM_COMPLETE_BACKUP_VERSION) {
    const error = new Error("This app version cannot create a complete backup after Servicing has been enabled. Update or reload the app first.");
    error.code = "INCOMPLETE_BACKUP_CLIENT";
    throw error;
  }
  return true;
}

export function assertServicingWritesEnabled(storage, keys) {
  const inspected = inspectServicingCompatibility(storage, keys);
  if (inspected.status !== "ready") {
    const error = new Error("4830 servicing writes remain disabled until the exact prior compatibility release is present.");
    error.code = "SERVICING_WRITES_DISABLED";
    error.inspection = inspected;
    throw error;
  }
  return inspected.value;
}

export function persistServicingStore(store, storage = globalThis.localStorage, { keys, expectedGeneration, expectedRaw } = {}) {
  const { records: recordsKey } = assertStorageKeys(keys);
  assertServicingWritesEnabled(storage, keys);
  const inspected = inspectServicingStore(storage, keys);
  if (inspected.status === "corrupt" || inspected.status === "future") {
    const error = new Error("Existing 4830 servicing data is protected and cannot be overwritten.");
    error.code = "PROTECTED_EXISTING_DATA";
    error.inspection = inspected;
    throw error;
  }
  const currentGeneration = inspected.status === "ready" ? inspected.value.generation : 0;
  if (!Number.isInteger(expectedGeneration) || expectedGeneration !== currentGeneration
    || expectedRaw !== inspected.raw) {
    const error = new Error("4830 servicing data changed in another app context.");
    error.code = "SERVICING_GENERATION_CONFLICT";
    error.inspection = inspected;
    throw error;
  }
  const candidate = normalizeServicingStore(store);
  if (candidate.generation !== expectedGeneration) throw new TypeError("Save the servicing store from its observed generation.");
  const next = { ...candidate, generation: expectedGeneration + 1 };
  const raw = JSON.stringify(next);
  writeRawWithRollback(storage, recordsKey, raw, inspected.raw);
  return { value: next, raw };
}

export function upsertServicingDraft(store, draft) {
  const value = normalizeServicingStore(store);
  const normalizedDraft = normalizeServicingRecord(draft);
  if (normalizedDraft.lifecycle !== "draft") throw new TypeError("Only a draft can be stored in the draft collection.");
  const next = clone(value);
  const index = next.drafts.findIndex(({ seriesId }) => seriesId === normalizedDraft.seriesId);
  if (index < 0) next.drafts.push(normalizedDraft);
  else next.drafts[index] = normalizedDraft;
  return normalizeServicingStore(next);
}

export function appendFinalisedServicingRecord(store, record) {
  const value = normalizeServicingStore(store);
  const normalizedRecord = normalizeServicingRecord(record);
  if (normalizedRecord.lifecycle === "draft") throw new TypeError("Finalise a servicing record before adding it to history.");
  const next = clone(value);
  const draftIndex = next.drafts.findIndex(({ recordId }) => recordId === normalizedRecord.recordId);
  if (draftIndex < 0) throw new Error("The finalised servicing record has no matching draft.");
  next.drafts.splice(draftIndex, 1);
  let entry = next.recordSeries.find(({ seriesId }) => seriesId === normalizedRecord.seriesId);
  if (!entry) {
    entry = { seriesId: normalizedRecord.seriesId, revisions: [] };
    next.recordSeries.push(entry);
  }
  entry.revisions.push(normalizedRecord);
  return normalizeServicingStore(next);
}

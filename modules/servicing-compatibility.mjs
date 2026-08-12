export const SERVICING_COMPATIBILITY_MARKER_VERSION = 1;
export const SERVICING_COMPATIBILITY_RELEASE_ID = "pallathorpe-servicing-backup-v4-compatibility-2026-08-12";
export const SERVICING_COMPATIBILITY_CAPABILITY = "combined-backup-v4-aware";
export const SERVICING_MINIMUM_COMPLETE_BACKUP_VERSION = 4;

function assertPrefix(prefix) {
  if (typeof prefix !== "string" || !prefix.trim() || prefix !== prefix.trim()) {
    throw new TypeError("A channel-specific combined storage prefix is required.");
  }
  return prefix;
}

export function servicingCompatibilityKeys(prefix) {
  const safePrefix = assertPrefix(prefix);
  return Object.freeze({
    records: `${safePrefix}:servicing-4830`,
    compatibility: `${safePrefix}:servicing-compatibility`,
  });
}

function normalizeMarker(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Servicing compatibility marker is invalid.");
  }
  if (Object.keys(value).sort().join("|") !== "capability|completeBackupVersion|markerVersion|preparedAt|releaseId") {
    throw new TypeError("Servicing compatibility marker has an unexpected schema.");
  }
  if (value.markerVersion !== SERVICING_COMPATIBILITY_MARKER_VERSION
    || value.releaseId !== SERVICING_COMPATIBILITY_RELEASE_ID
    || value.capability !== SERVICING_COMPATIBILITY_CAPABILITY
    || value.completeBackupVersion !== SERVICING_MINIMUM_COMPLETE_BACKUP_VERSION) {
    throw new TypeError("Servicing compatibility marker does not identify this release capability.");
  }
  if (typeof value.preparedAt !== "string"
    || Number.isNaN(new Date(value.preparedAt).getTime())
    || new Date(value.preparedAt).toISOString() !== value.preparedAt) {
    throw new TypeError("Servicing compatibility marker time is invalid.");
  }
  return JSON.parse(JSON.stringify(value));
}

export function inspectServicingCompatibility(storage = globalThis.localStorage, prefix) {
  const { compatibility } = servicingCompatibilityKeys(prefix);
  let raw;
  try {
    raw = storage.getItem(compatibility);
  } catch (error) {
    return { status: "corrupt", raw: null, value: null, error };
  }
  if (raw === null) return { status: "absent", raw: null, value: null };
  try {
    return { status: "ready", raw, value: normalizeMarker(JSON.parse(raw)) };
  } catch (error) {
    return { status: "corrupt", raw, value: null, error };
  }
}

function restoreAbsentMarker(storage, key) {
  storage.removeItem(key);
  if (storage.getItem(key) !== null) {
    const error = new Error("Compatibility marker write failed and the empty prior state could not be restored.");
    error.code = "COMPATIBILITY_ROLLBACK_FAILED";
    throw error;
  }
}

export function installServicingCompatibility(
  storage = globalThis.localStorage,
  prefix,
  now = new Date(),
) {
  const keys = servicingCompatibilityKeys(prefix);
  const inspected = inspectServicingCompatibility(storage, prefix);
  if (inspected.status === "ready") return { created: false, value: inspected.value };
  if (inspected.status !== "absent") {
    const error = new Error("An existing servicing compatibility marker is unreadable and was left unchanged.");
    error.code = "PROTECTED_COMPATIBILITY_MARKER";
    error.inspection = inspected;
    throw error;
  }

  const preparedAt = now.toISOString();
  if (Number.isNaN(new Date(preparedAt).getTime())) throw new TypeError("Compatibility preparation time is invalid.");
  const value = Object.freeze({
    markerVersion: SERVICING_COMPATIBILITY_MARKER_VERSION,
    releaseId: SERVICING_COMPATIBILITY_RELEASE_ID,
    capability: SERVICING_COMPATIBILITY_CAPABILITY,
    completeBackupVersion: SERVICING_MINIMUM_COMPLETE_BACKUP_VERSION,
    preparedAt,
  });
  const raw = JSON.stringify(value);

  try {
    storage.setItem(keys.compatibility, raw);
    if (storage.getItem(keys.compatibility) !== raw) {
      const error = new Error("Compatibility marker write could not be verified.");
      error.code = "COMPATIBILITY_WRITE_NOT_VERIFIED";
      throw error;
    }
  } catch (cause) {
    try {
      restoreAbsentMarker(storage, keys.compatibility);
    } catch (rollbackCause) {
      if (rollbackCause?.code === "COMPATIBILITY_ROLLBACK_FAILED") {
        rollbackCause.cause = cause;
        throw rollbackCause;
      }
      const error = new Error("Compatibility marker write failed and rollback could not be verified.");
      error.code = "COMPATIBILITY_ROLLBACK_FAILED";
      error.cause = cause;
      error.rollbackCause = rollbackCause;
      throw error;
    }
    const error = new Error("Compatibility marker write failed; the empty prior state was restored.");
    error.code = "COMPATIBILITY_WRITE_NOT_VERIFIED";
    error.cause = cause;
    throw error;
  }
  return { created: true, value: normalizeMarker(value) };
}

export function assertLegacyCombinedDataOperationAllowed(
  storage = globalThis.localStorage,
  prefix,
  operation = "backup or restore",
) {
  const { records } = servicingCompatibilityKeys(prefix);
  let raw;
  try {
    raw = storage.getItem(records);
  } catch (cause) {
    const error = new Error(`Cannot confirm that this app can safely ${operation} all device records.`);
    error.code = "BACKUP_COMPATIBILITY_UNKNOWN";
    error.cause = cause;
    throw error;
  }
  if (raw !== null) {
    const error = new Error(`This app version cannot safely ${operation} after 4830 Servicing has been used. Update or reload the app first.`);
    error.code = "INCOMPLETE_BACKUP_CLIENT";
    throw error;
  }
  return true;
}

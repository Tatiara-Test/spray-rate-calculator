// Browser state is published only after a verified durable commit.
export const DURABLE_PREFIX = "tatiara-test:spray-rate-calculator:v1";
const fixed = new Set([
  "paddocks", "work-notes", "profile", "property-settings", "weather-settings",
  "paddock-library", "servicing-4830", "servicing-compatibility", "migration",
  "legacy-backup:paddocks", "legacy-backup:work-notes", "pre-v3-backup:paddocks",
  "calculator-draft:v1", "tank-delete-recovery:v1", "restore-epoch", "appearance", "backup-receipt", "notebook:v1", "servicing-log:v1", "servicing-workflows:v1",
].map(key => `${DURABLE_PREFIX}:${key}`));
fixed.add("tatiara-test:spray-preferences:v1");

export function isOwnedKey(key) {
  if (typeof key !== "string") return false;
  if (fixed.has(key)) return true;
  if (!key.startsWith(`${DURABLE_PREFIX}:`)) return false;
  const suffix = key.slice(DURABLE_PREFIX.length + 1);
  return /^pre-v3-backup:paddocks:v[1-9][0-9]*-[a-f0-9]{8}$/.test(suffix)
    || /^recovery:pre-restore:[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}Z(?:-[2-9]|-[1-9][0-9]+)?$/.test(suffix);
}

export function validateOwnedEntries(entries) {
  if (!entries || typeof entries !== "object" || Array.isArray(entries)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(entries))) {
    throw new TypeError("Durable entries must be a string map.");
  }
  for (const [key, value] of Object.entries(entries)) {
    if (!isOwnedKey(key) || typeof value !== "string") throw new TypeError(`Unsupported durable entry: ${key}`);
  }
  return entries;
}

let nativePlugin;
let schemaValidator;
let committed;
let revision;
let initialized = false;
let initializing;
let writeLock;
let queued = 0;
let queue = Promise.resolve();
const clone = entries => Object.assign(Object.create(null), entries);
const equal = (a, b) => Object.keys(a).length === Object.keys(b).length
  && Object.keys(a).every(key => Object.hasOwn(b, key) && a[key] === b[key]);
const operationId = () => globalThis.crypto.randomUUID();
function ready() { if (!initialized) throw new Error("Browser storage is not ready."); }
function writable() { ready(); if (writeLock) throw new Error("Browser storage is locked. Restart to reconcile the saved state.", { cause: writeLock }); }
function adapter(entries, mutable = false) {
  let active = true;
  const check = () => { if (!active) throw new Error("Storage operation has ended."); };
  const write = key => { check(); if (!mutable) throw new Error("Committed storage is read-only; use transactStorage."); if (!isOwnedKey(key)) throw new Error(`Unsupported durable key: ${key}`); };
  return {
    storage: Object.freeze({
      get length() { check(); return Object.keys(entries()).length; },
      key(index) { check(); return Object.keys(entries())[index] ?? null; },
      getItem(key) { check(); return entries()[String(key)] ?? null; },
      setItem(key, value) { key = String(key); write(key); entries()[key] = String(value); },
      removeItem(key) { key = String(key); write(key); delete entries()[key]; },
      clear() { throw new Error("Bulk clearing browser storage is not supported."); },
    }),
    close() { active = false; },
  };
}
const readOnly = adapter(() => { ready(); return committed; }).storage;
export function getStorage() { ready(); return readOnly; }
export function getRevision() { ready(); return revision; }
export function getNativePlugin() { if (!nativePlugin) throw new Error("Browser storage adapter is unavailable."); return nativePlugin; }
export function snapshotEntries() { ready(); return clone(committed); }
export function isStorageBusy() { return Boolean(initializing) || queued > 0; }

function validate(entries) {
  validateOwnedEntries(entries);
  const result = schemaValidator(clone(entries));
  if (result?.then) throw new TypeError("Entry validation must be synchronous.");
  if (result === false) throw new Error("Durable entry schema validation failed.");
}
function inspectState(state) {
  if (!state || state.initialized !== true || !Number.isSafeInteger(state.revision) || state.revision < 0
      || (state.lastOperationId !== null && typeof state.lastOperationId !== "string")) throw new Error("Invalid browser storage state.");
  validate(state.entries);
  return state;
}
function publish(state) { committed = clone(state.entries); revision = state.revision; initialized = true; }
function captureLegacy(storage) {
  const entries = Object.create(null);
  if (!storage) return entries;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (isOwnedKey(key)) {
      const value = storage.getItem(key);
      if (typeof value !== "string") throw new Error("Legacy storage changed during capture.");
      entries[key] = value;
    } else if (key?.startsWith("tatiara-test:")
        && key !== `${DURABLE_PREFIX}:weather-cache`
        && !key.startsWith(`${DURABLE_PREFIX}:navigation:`)
        && !key.startsWith("tatiara-test:ai-consent:")) {
      throw new Error(`Unrecognised browser storage key: ${key}`);
    }
  }
  return entries;
}

async function commitAndVerify(method, entries, expectedRevision, retainRecovery = false) {
  const id = operationId();
  let originalError;
  try {
    await nativePlugin[method]({ entries, operationId: id, ...(method === "commit" ? { expectedRevision, retainRecovery } : {}) });
  } catch (error) { originalError = error; }
  try {
    const state = inspectState(await nativePlugin.load());
    if (state.lastOperationId !== id || !equal(state.entries, entries)
        || (method === "commit" && state.revision !== expectedRevision + 1)
        || (method === "initialize" && state.revision !== 1)) {
      throw new Error("Browser commit could not be reconciled.", { cause: originalError });
    }
    return state;
  } catch (error) {
    writeLock = error;
    throw new Error("Save outcome could not be verified. Restart before making further changes.", { cause: error });
  }
}

export function initializeDurableStorage({ plugin, legacyStorage, validateEntries } = {}) {
  if (initializing) return initializing;
  if (initialized) return Promise.resolve(getStorage());
  if (writeLock) return Promise.reject(new Error("Browser initialization is locked. Restart to reconcile the saved state.", { cause: writeLock }));
  if (typeof validateEntries !== "function") return Promise.reject(new Error("A strict entry validator is required."));
  try {
    nativePlugin = plugin ?? globalThis.Capacitor?.Plugins?.PilotStorage;
    if (!nativePlugin || !["load", "initialize", "commit"].every(name => typeof nativePlugin[name] === "function")) throw new Error("Browser storage adapter is unavailable.");
    schemaValidator = validateEntries;
    initializing = (async () => {
      const state = await nativePlugin.load();
      if (state?.initialized === true) publish(inspectState(state));
      else if (state?.initialized === false) {
        // Bootstrap has not mounted model/UI code. Consult WebView storage only
        // for first initialization; native state is authoritative thereafter.
        const legacyEntries = captureLegacy(typeof legacyStorage === "function" ? legacyStorage() : legacyStorage);
        validate(legacyEntries);
        publish(await commitAndVerify("initialize", legacyEntries));
      } else throw new Error("Invalid browser initialization response.");
      return getStorage();
    })().catch(error => { writeLock = error; throw error; }).finally(() => { initializing = undefined; });
    return initializing;
  } catch (error) { writeLock = error; return Promise.reject(error); }
}

export function transactStorage(callback, { retainRecovery = false, expectedRevision } = {}) {
  try { writable(); } catch (error) { return Promise.reject(error); }
  queued++;
  const operation = queue.then(async () => {
    writable();
    if (expectedRevision !== undefined && expectedRevision !== revision) throw new Error("Saved records changed. Review the current state before retrying.");
    const next = clone(committed);
    const staged = adapter(() => next, true);
    let result;
    try {
      result = callback(staged.storage);
      if (result?.then) {
        Promise.resolve(result).catch(() => {});
        throw new TypeError("Storage transaction callbacks must be synchronous.");
      }
    } finally { staged.close(); }
    validate(next);
    if (!equal(next, committed) || retainRecovery) publish(await commitAndVerify("commit", next, revision, retainRecovery));
    return result;
  });
  queue = operation.catch(() => {});
  return operation.finally(() => { queued--; });
}

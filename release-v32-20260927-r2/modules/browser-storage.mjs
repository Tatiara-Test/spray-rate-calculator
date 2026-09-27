import { DURABLE_PREFIX, isOwnedKey, validateOwnedEntries } from './durable-storage.mjs';
import { saveFileCopy, nativeShareFiles } from './native-files.mjs';

export const BROWSER_DATABASE = 'tatiara-test:spray-rate-calculator:durable:v1';
const STORE = 'records';
const copy = entries => Object.fromEntries(Object.entries(entries));
const equal = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && a[key] === b[key]);
const conflict = () => new Error('An older web tab changed local records after migration. Close other tabs and retain browser data. The original records are preserved; review the conflict before continuing.');

export function captureBrowserLegacy(storage, { includeUnknown = false } = {}) {
  const entries = {};
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (isOwnedKey(key)) {
      const value = storage.getItem(key);
      if (typeof value !== 'string') throw conflict();
      entries[key] = value;
    } else if (key?.startsWith('tatiara-test:')
        && key !== `${DURABLE_PREFIX}:weather-cache`
        && !key.startsWith(`${DURABLE_PREFIX}:navigation:`)
        && !key.startsWith('tatiara-test:ai-consent:')) {
      if (!includeUnknown) throw new Error(`Unrecognised local record needs review: ${key}. Original bytes were retained.`);
      const value = storage.getItem(key);
      if (typeof value !== 'string') throw conflict();
      entries[key] = value;
    }
  }
  return entries;
}

// A single readwrite transaction owns the revision comparison, recovery snapshot,
// and replacement. IndexedDB serializes these transactions across browser tabs.
export function createBrowserStorage({ indexedDB = globalThis.indexedDB, legacyStorage = () => globalThis.localStorage, databaseName = BROWSER_DATABASE, validateEntries = validateOwnedEntries } = {}) {
  if (typeof validateEntries !== 'function') throw new TypeError('A synchronous record validator is required.');
  let opening;
  function validateAggregate(entries) {
    const result=validateEntries(copy(entries));
    if (result?.then) { Promise.resolve(result).catch(()=>{}); throw new Error('Record validation must be synchronous.'); }
    if (result===false) throw new Error('Migrated records need review before conflict resolution.');
  }
  const legacy = (includeUnknown = false) => captureBrowserLegacy(typeof legacyStorage === 'function' ? legacyStorage() : legacyStorage, {includeUnknown});
  function checkBaseline(record) {
    if (!record || !record.baseline || !equal(record.baseline, legacy())) throw conflict();
  }
  function open() {
    if (!indexedDB) return Promise.reject(new Error('IndexedDB is unavailable. Browser records could not be opened safely.'));
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      let failed = false;
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onerror = () => { failed = true; reject(request.error); };
      request.onblocked = () => { failed = true; reject(new Error('Another tab is blocking the records database. Close other tabs and reopen this page.')); };
      request.onsuccess = () => {
        const database = request.result;
        if (failed) { database.close(); return; }
        database.onversionchange = () => { database.close(); opening = undefined; };
        resolve(database);
      };
    });
    return opening;
  }
  async function transaction(mode, action) {
    const database = await open();
    return new Promise((resolve, reject) => {
      let output, failure;
      const tx = database.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      tx.oncomplete = () => resolve(output);
      tx.onabort = () => reject(failure || tx.error || new Error('The records transaction was aborted.'));
      tx.onerror = () => { failure ||= tx.error; };
      const request = store.get('current');
      request.onsuccess = () => {
        try { output = action(request.result, store); }
        catch (error) { failure = error; tx.abort(); }
      };
    });
  }
  function publicState(record) {
    const state = record?.state;
    if (!state || state.initialized !== true || !Number.isSafeInteger(state.revision) || state.revision < 1 || typeof state.lastOperationId !== 'string') throw new Error('The browser records database needs review.');
    validateOwnedEntries(state.entries);
    return { ...state, entries: copy(state.entries) };
  }
  function input(entries, operationId) {
    validateOwnedEntries(entries);
    if (typeof operationId !== 'string' || !operationId.trim()) throw new Error('A storage operation ID is required.');
  }
  return Object.freeze({
    async saveBackup({ text, filename }) {
      const result = await saveFileCopy(new Blob([text], { type: 'application/json' }), filename);
      return { ...result, cancelled: result.mode === 'cancelled' };
    },
    async shareBackup({ text, filename }) {
      const file = new File([text], filename, { type: 'application/json' });
      const result = await nativeShareFiles({ files: [file], title: 'Records backup', text: 'Records backup' });
      if (result.mode === 'unsupported') {
        const saved = await saveFileCopy(file, filename);
        return { ...saved, cancelled: saved.mode === 'cancelled' };
      }
      return { ...result, cancelled: result.mode === 'cancelled' };
    },
    openBackup() {
      return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.json,application/json'; input.hidden = true;
        const finish = (result, error) => { input.remove(); error ? reject(error) : resolve(result); };
        input.addEventListener('cancel', () => finish({ cancelled: true }), { once: true });
        input.addEventListener('change', async () => {
          try {
            const file = input.files?.[0];
            if (!file) return finish({ cancelled: true });
            if (file.size > 16 * 1024 * 1024) throw new Error('Backup must be smaller than 16 MiB.');
            finish({ text: await file.text() });
          } catch (error) { finish(null, error); }
        }, { once: true });
        document.body.append(input);
        try { input.click(); } catch (error) { finish(null, error); }
      });
    },
    async inspectLegacyConflict() {
      return transaction('readonly', record => {
        // Diagnostics deliberately retain raw payloads even when ordinary reads
        // cannot validate the envelope or a first migration never committed.
        const legacyEntries = legacy(true);
        const unknownKeys = Object.keys(legacyEntries).filter(key => !isOwnedKey(key));
        let state=record?.state ?? null, reason='', baselineValid=false, stateValid=false;
        try {validateOwnedEntries(record?.baseline);baselineValid=true;} catch {reason='No valid migration baseline is available; retain the raw recovery export.';}
        try {state=publicState(record);stateValid=true;} catch(error) {reason=error.message || 'The browser records envelope needs review.';}
        if (!record) reason='No migrated browser records are available. Original local records are included for recovery.';
        if (unknownKeys.length) reason='Unrecognised original record keys need review before choosing.';
        if (stateValid) {try {validateAggregate(state.entries);} catch(error) {reason=error.message || 'Migrated records need review.';}}
        const baseline=record?.baseline ?? null;
        const changedKeys=baselineValid ? [...new Set([...Object.keys(baseline),...Object.keys(legacyEntries)])]
          .filter(key=>baseline[key]!==legacyEntries[key]).sort() : Object.keys(legacyEntries).sort();
        return structuredClone({format:'spray-web-storage-conflict',version:1,databaseName,
          inspectedAt:new Date().toISOString(),conflict:changedKeys.length > 0,
          canKeepDurable:baselineValid && stateValid && changedKeys.length > 0 && !reason,reason,
          changedKeys,unknownKeys,baseline,legacyEntries,state,rawRecord:record ?? null,
          recovery:record?.recovery ?? null,archiveIds:Array.isArray(record?.conflictArchiveIds)?record.conflictArchiveIds:[]});
      });
    },
    async keepDurableAfterLegacyConflict({expectedRevision,expectedLegacyEntries,expectedBaseline,confirmation,operationId} = {}) {
      if (confirmation !== 'keep-durable-records') throw new Error('Explicit confirmation to keep the migrated records is required.');
      input(expectedLegacyEntries, operationId);
      validateOwnedEntries(expectedBaseline);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || expectedRevision === Number.MAX_SAFE_INTEGER) throw new Error('A current revision is required for conflict recovery.');
      const expectedLegacy = copy(expectedLegacyEntries), observedBaseline = copy(expectedBaseline);
      return transaction('readwrite', (record, store) => {
        const previous = publicState(record);
        validateOwnedEntries(record.baseline);
        if (previous.revision !== expectedRevision) throw new Error('Migrated records changed. Inspect the conflict again before choosing.');
        if (!equal(record.baseline, observedBaseline)) throw new Error('The migration baseline changed. Inspect the conflict again before choosing.');
        validateAggregate(previous.entries);
        const currentLegacy = legacy();
        if (!equal(currentLegacy, expectedLegacy)) throw new Error('Original local records changed. Inspect the conflict again before choosing.');
        if (equal(record.baseline, currentLegacy)) throw new Error('There is no remaining legacy conflict to resolve.');
        const archiveId = 'conflict:' + crypto.randomUUID();
        const archive = {format:'spray-web-storage-conflict-archive',version:1,archiveId,databaseName,
          resolvedAt:new Date().toISOString(),resolution:'keep-durable-records',operationId,
          originalRecord:structuredClone(record),legacyEntries:copy(currentLegacy)};
        // Archive and baseline acceptance commit together. No localStorage bytes
        // or migrated record entries are merged, overwritten, or deleted.
        store.add(archive, archiveId);
        const next = {...record,baseline:copy(currentLegacy),
          conflictArchiveIds:[...(record.conflictArchiveIds ?? []),archiveId],
          state:{...previous,revision:expectedRevision + 1,lastOperationId:operationId}};
        store.put(next, 'current');
        return {state:publicState(next),archiveId};
      });
    },
    async readConflictArchive(archiveId) {
      if (typeof archiveId !== 'string' || !/^conflict:[0-9a-f-]{36}$/.test(archiveId)) throw new Error('A valid conflict archive identity is required.');
      const database = await open();
      return new Promise((resolve,reject) => {
        let archive;
        const tx=database.transaction(STORE,'readonly'), request=tx.objectStore(STORE).get(archiveId);
        request.onsuccess=()=>{archive=request.result;};
        tx.oncomplete=()=>archive ? resolve(structuredClone(archive)) : reject(new Error('The conflict archive was not found.'));
        tx.onabort=()=>reject(tx.error || new Error('The conflict archive could not be read.'));
        tx.onerror=()=>reject(tx.error || new Error('The conflict archive could not be read.'));
      });
    },
    async load() {
      return transaction('readonly', record => {
        if (!record) return { initialized: false };
        checkBaseline(record);
        return publicState(record);
      });
    },
    async initialize({ entries, operationId }) {
      input(entries, operationId);
      const captured = copy(entries);
      return transaction('readwrite', (record, store) => {
        if (record) throw new Error('Browser storage was initialized by another tab. Reopen this page.');
        const baseline = legacy();
        if (!equal(baseline, captured)) throw conflict();
        const next = { baseline, state: { initialized: true, revision: 1, lastOperationId: operationId, entries: captured }, recovery: null };
        store.put(next, 'current');
        return publicState(next);
      });
    },
    async commit({ entries, operationId, expectedRevision, retainRecovery = false }) {
      input(entries, operationId);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || expectedRevision === Number.MAX_SAFE_INTEGER || typeof retainRecovery !== 'boolean') throw new Error('Invalid browser commit parameters.');
      const captured = copy(entries);
      return transaction('readwrite', (record, store) => {
        checkBaseline(record);
        const previous = publicState(record);
        if (previous.revision !== expectedRevision) throw new Error('Another tab saved records. Reopen this page before making further changes.');
        const next = { ...record, baseline: record.baseline, recovery: retainRecovery ? previous : record.recovery, state: { initialized: true, revision: expectedRevision + 1, lastOperationId: operationId, entries: captured } };
        store.put(next, 'current');
        return publicState(next);
      });
    },
    async loadRecovery() {
      return transaction('readonly', record => {
        checkBaseline(record);
        publicState(record);
        return { snapshot: record.recovery ? publicState({ state: record.recovery }) : null };
      });
    },
  });
}

import { getNativePlugin, getRevision, snapshotEntries, transactStorage, validateOwnedEntries } from './durable-storage.mjs';
import { COMBINED_PREFIX, PADDOCKS_KEY, PADDOCK_LIBRARY_KEY, PROFILE_KEY, WEATHER_SETTINGS_KEY, PROPERTY_SETTINGS_KEY, WORK_NOTES_KEY, inspectPaddockStore, inspectPaddockLibraryStore, inspectProfileStore, inspectWeatherSettingsStore, normalizeWorkNotesData } from './storage.mjs';
import { inspectPropertySettings } from './property-settings.mjs';
import { inspectStoredData } from './work-notes-logic.mjs';
import { SPRAY_PREFERENCES_KEY, normalizeSprayPreferences } from './spray-preferences.mjs';
import { CALCULATOR_DRAFT_KEY, TANK_DELETE_RECOVERY_KEY, inspectCalculatorDraft, inspectTankRecovery } from './spray-recovery.mjs';
import { APPEARANCE_KEY, normalizeAppearance } from './appearance.mjs';
import { NOTEBOOK_KEY } from './notebook-storage.mjs';
import { validateNotebook } from './notebook-model.mjs';
import { SERVICING_LOG_KEY } from './servicing-log-storage.mjs';
import { validateServicingLog } from './servicing-log-model.mjs';
import {SERVICING_WORKFLOWS_KEY} from './service-workflow-storage.mjs';
import {validateWorkflows} from './service-workflow-model.mjs';
import {SERVICING_KEY, SERVICING_COMPATIBILITY_KEY, inspectServicingStore} from './storage.mjs';

export const BACKUP_FORMAT = 'spray-web-backup';
export const BACKUP_VERSION = 1;
const LEGACY_EXCLUSIONS = Object.freeze(['navigation', 'weather-cache', 'AI credentials and consent', 'native migration and previous-restore snapshots']);
export const EXCLUSIONS = Object.freeze([...LEGACY_EXCLUSIONS, 'device backup receipt']);
export const BACKUP_RECEIPT_KEY = `${COMBINED_PREFIX}:backup-receipt`;
export const RESTORE_EPOCH_KEY = `${COMBINED_PREFIX}:restore-epoch`;
const legacyFixedKeys = [PADDOCKS_KEY, PADDOCK_LIBRARY_KEY, WORK_NOTES_KEY, PROFILE_KEY, PROPERTY_SETTINGS_KEY, WEATHER_SETTINGS_KEY, SPRAY_PREFERENCES_KEY, CALCULATOR_DRAFT_KEY, TANK_DELETE_RECOVERY_KEY];
const appearanceFixedKeys = [...legacyFixedKeys, APPEARANCE_KEY];
const notebookFixedKeys = [...appearanceFixedKeys, NOTEBOOK_KEY];
const servicingFixedKeys = [...notebookFixedKeys, SERVICING_LOG_KEY];
const fixedKeys = [...servicingFixedKeys, SERVICING_WORKFLOWS_KEY];
function storageFor(entries) {
  const keys = Object.keys(entries);
  return { get length() { return keys.length; }, key: i => keys[i] ?? null, getItem: key => Object.hasOwn(entries, key) ? entries[key] : null };
}
export function validateNativeData(entries) {
  validateOwnedEntries(entries);
  const store = storageFor(entries);
  if (Object.hasOwn(entries, NOTEBOOK_KEY)) validateNotebook(JSON.parse(entries[NOTEBOOK_KEY]));
  if (Object.hasOwn(entries, SERVICING_LOG_KEY)) validateServicingLog(JSON.parse(entries[SERVICING_LOG_KEY]));
  if (Object.hasOwn(entries, SERVICING_WORKFLOWS_KEY)) validateWorkflows(JSON.parse(entries[SERVICING_WORKFLOWS_KEY]), Object.hasOwn(entries,SERVICING_LOG_KEY) ? validateServicingLog(JSON.parse(entries[SERVICING_LOG_KEY])).equipment : []);
  if (Object.hasOwn(entries, BACKUP_RECEIPT_KEY)) validateBackupReceipt(JSON.parse(entries[BACKUP_RECEIPT_KEY]));
  if (Object.hasOwn(entries, APPEARANCE_KEY)) normalizeAppearance(JSON.parse(entries[APPEARANCE_KEY]));
  for (const [key, inspect] of [[PADDOCKS_KEY,inspectPaddockStore],[PADDOCK_LIBRARY_KEY,inspectPaddockLibraryStore],[PROFILE_KEY,inspectProfileStore],[WEATHER_SETTINGS_KEY,inspectWeatherSettingsStore],[CALCULATOR_DRAFT_KEY,inspectCalculatorDraft],[TANK_DELETE_RECOVERY_KEY,inspectTankRecovery]]) {
    if (!Object.hasOwn(entries,key)) continue;
    if (inspect(store).status !== 'ready') throw new Error(`Stored data needs review: ${key}. Original bytes were retained.`);
  }
  if (Object.hasOwn(entries,PROPERTY_SETTINGS_KEY) && inspectPropertySettings(entries[PROPERTY_SETTINGS_KEY]).state !== 'ready') throw new Error('Property settings are invalid.');
  if (Object.hasOwn(entries,SPRAY_PREFERENCES_KEY)) normalizeSprayPreferences(JSON.parse(entries[SPRAY_PREFERENCES_KEY]));
  if (Object.hasOwn(entries,WORK_NOTES_KEY)) {
    const value = JSON.parse(entries[WORK_NOTES_KEY]);
    // Existing web records may omit version: the baseline treats that as v1.
    // Validate using the same strict readers without replacing the original raw.
    normalizeWorkNotesData(value);
    if (inspectStoredData(entries[WORK_NOTES_KEY]).state !== 'ready') throw new Error('Work Notes data is invalid.');
  }
  // Disabled servicing and historical recovery records are retained as exact raw
  // strings; they are never interpreted as permission to enable those workflows.
  return entries;
}
export function createNativeBackup(entries = snapshotEntries(), revision = getRevision(), now = new Date()) {
  validateNativeData(entries);
  const frozen = portableEntries(entries);
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, application: 'tatiara-test.spray-rate-calculator.web', createdAt: now.toISOString(), revision,
    datasets: Object.fromEntries(fixedKeys.map(key => [key, Object.hasOwn(frozen,key) ? 'present' : 'absent'])),
    exclusions: [...EXCLUSIONS], entries: frozen };
}
export function prepareNativeRestore(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 16 * 1024 * 1024) throw new Error('Backup must be a JSON file smaller than 16 MiB.');
  const value = JSON.parse(text);
  if (value?.format !== BACKUP_FORMAT || value.version !== BACKUP_VERSION || value.application !== 'tatiara-test.spray-rate-calculator.web') throw new Error('Choose a complete web backup version 1. Older partial exports must use their original import option.');
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !Number.isFinite(Date.parse(value.createdAt))) throw new Error('Invalid backup metadata.');
  if (![EXCLUSIONS, LEGACY_EXCLUSIONS].some(exclusions => JSON.stringify(value.exclusions) === JSON.stringify(exclusions))) throw new Error('Backup coverage is not recognised.');
  if (value.entries && Object.hasOwn(value.entries, BACKUP_RECEIPT_KEY)) throw new Error('Device backup receipts cannot be imported.');
  validateNativeData(value.entries);
  const manifestKeys = [legacyFixedKeys, appearanceFixedKeys, notebookFixedKeys, servicingFixedKeys, fixedKeys].find(keys => value.datasets && Object.keys(value.datasets).length === keys.length && fixedKeys.filter(key => !keys.includes(key)).every(key => !Object.hasOwn(value.entries,key))) ?? fixedKeys;
  if (!value.datasets || Object.keys(value.datasets).length !== manifestKeys.length || manifestKeys.some(key => value.datasets[key] !== (Object.hasOwn(value.entries,key) ? 'present' : 'absent'))) throw new Error('Backup dataset manifest does not match its contents.');
  return Object.freeze({ entries: Object.freeze({...value.entries}), createdAt:value.createdAt, count:Object.keys(value.entries).length });
}
export async function applyNativeRestore(prepared, expectedRevision) {
  validateNativeData(prepared.entries);
  return transactStorage(storage => {
    const receipt = storage.getItem(BACKUP_RECEIPT_KEY);
    for (let i = storage.length - 1; i >= 0; i--) storage.removeItem(storage.key(i));
    for (const [key,value] of Object.entries(prepared.entries)) if (key !== BACKUP_RECEIPT_KEY) storage.setItem(key,value);
    if (receipt !== null) storage.setItem(BACKUP_RECEIPT_KEY, receipt);
    storage.setItem(RESTORE_EPOCH_KEY, `${new Date().toISOString()}:${crypto.randomUUID()}`);
  }, {retainRecovery:true,expectedRevision});
}
export async function preparePreviousRecovery() {
  const {snapshot} = await getNativePlugin().loadRecovery();
  if (!snapshot) throw new Error('No previous restore recovery exists on this device.');
  validateNativeData(snapshot.entries);
  return Object.freeze({entries:Object.freeze({...snapshot.entries}),createdAt:'previous on-device restore',count:Object.keys(snapshot.entries).length});
}

function portableEntries(entries) {
  return Object.fromEntries(Object.keys(entries).filter(key => key !== BACKUP_RECEIPT_KEY).sort().map(key => [key, entries[key]]));
}
export function validateBackupReceipt(receipt) {
  if (!receipt || receipt.version !== 1 || typeof receipt.savedAt !== 'string' || !Number.isFinite(Date.parse(receipt.savedAt))
      || !Number.isSafeInteger(receipt.snapshotRevision) || receipt.snapshotRevision < 0
      || typeof receipt.contentFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.contentFingerprint)) throw new Error('The device backup receipt is invalid.');
  return receipt;
}
export async function fingerprintBackupEntries(entries) {
  const bytes = new TextEncoder().encode(JSON.stringify(portableEntries(entries)));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function recordVerifiedBackup(payload, result, now = new Date()) {
  if (result?.cancelled || result?.verified !== true) throw new Error('Only a saved file verified by readback can update backup status.');
  const receipt = validateBackupReceipt({version:1, savedAt:now.toISOString(), snapshotRevision:payload.revision, contentFingerprint:await fingerprintBackupEntries(payload.entries)});
  await transactStorage(storage => storage.setItem(BACKUP_RECEIPT_KEY, JSON.stringify(receipt)));
  globalThis.dispatchEvent?.(new Event('native-backup-status-changed'));
  return receipt;
}
export async function getBackupStatus(entries = snapshotEntries()) {
  if (!Object.hasOwn(entries, BACKUP_RECEIPT_KEY)) return {state:'never', message:'No verified backup saved on this device yet.'};
  let receipt;
  try { receipt = validateBackupReceipt(JSON.parse(entries[BACKUP_RECEIPT_KEY])); }
  catch { return {state:'invalid', message:'Backup status could not be read. Save a new verified backup.'}; }
  const changed = await fingerprintBackupEntries(entries) !== receipt.contentFingerprint;
  const when = new Date(receipt.savedAt).toLocaleString();
  return {...receipt, state:changed ? 'changed' : 'current', message:`Last verified backup: ${when}. ${changed ? 'Records or settings have changed since that backup.' : 'Current saved records and settings match that backup.'}`};
}
export function describeRestoreContents(entries) {
  const paddocks = entries[PADDOCKS_KEY] ? JSON.parse(entries[PADDOCKS_KEY]).paddocks : [];
  const tanks = paddocks.reduce((total, paddock) => total + paddock.tanks.length, 0);
  const notes = entries[WORK_NOTES_KEY] ? Object.keys(JSON.parse(entries[WORK_NOTES_KEY]).notes).length : 0;
  const notebook = Object.hasOwn(entries,NOTEBOOK_KEY) ? validateNotebook(JSON.parse(entries[NOTEBOOK_KEY])).notes : null;
  const notebookSummary = notebook ? `${notebook.length} Notebook notes/checklists (including ${notebook.filter(note=>note.status==='archived').length} archived and ${notebook.filter(note=>note.status==='bin').length} in Bin).` : 'No Notebook dataset: restoring this backup removes current Notebook notes; the previous on-device restore recovery retains them.';
  const servicing = Object.hasOwn(entries,SERVICING_LOG_KEY) ? validateServicingLog(JSON.parse(entries[SERVICING_LOG_KEY])) : null;
  const servicingSummary = servicing ? `${servicing.equipment.length} equipment items (including ${servicing.equipment.filter(item=>item.status==='archived').length} archived) and ${servicing.records.length} service records.` : 'No Servicing dataset: restoring this backup removes current Servicing equipment and records; the previous on-device restore recovery retains them.';
  const workflows = Object.hasOwn(entries,SERVICING_WORKFLOWS_KEY) ? validateWorkflows(JSON.parse(entries[SERVICING_WORKFLOWS_KEY]),servicing?.equipment??[]) : null;
  const workflowSummary = workflows ? `${workflows.templates.length} service templates and ${workflows.services.length} service workflows (including ${workflows.services.filter(s=>s.status==='finalised').length} finalised).` : 'No service workflows dataset: restoring this backup removes current service templates and draft/finalised services; the previous on-device restore recovery retains them.';
  let legacySummary = 'No legacy 4830 dataset: restoring this backup removes current legacy 4830 drafts and service history; the previous on-device restore recovery retains them.';
  if (Object.hasOwn(entries,SERVICING_KEY)) {
    const inspected = inspectServicingStore(storageFor(entries));
    legacySummary = inspected.status === 'ready'
      ? `Legacy 4830 dataset included: ${inspected.value.drafts.length} drafts and ${inspected.value.recordSeries.length} service histories (${inspected.value.recordSeries.reduce((count,series)=>count+series.revisions.length,0)} saved revisions).`
      : 'Legacy 4830 dataset included as preserved raw data. Its contents cannot be interpreted safely; draft and history counts are unknown. Restoring replaces current legacy 4830 data with those exact raw bytes.';
  }
  const legacySetup = Object.hasOwn(entries,SERVICING_COMPATIBILITY_KEY)
    ? 'The legacy 4830 setup marker is included as preserved raw data; its presence does not confirm readiness.'
    : 'No legacy 4830 setup marker: restoring removes the current setup marker.';
  return `${paddocks.length} paddocks, ${tanks} saved tanks and ${notes} Work Diary days. ${notebookSummary} ${servicingSummary} ${workflowSummary} ${legacySummary} ${legacySetup} ${Object.hasOwn(entries,APPEARANCE_KEY) ? 'Display preferences are included' : 'No display preferences: appearance will use system colours and standard text'}`;
}

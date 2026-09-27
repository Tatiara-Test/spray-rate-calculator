import { SETTINGS_TEMPLATE } from "./settings-template.mjs";
import { getStorage, transactStorage } from "./durable-storage.mjs";
import {
  inspectPropertySettings,
  loadPropertySettings,
  normalizePropertySettings,
  persistPropertySettings,
  PROPERTY_SETTINGS_DEFAULTS,
} from "./property-settings.mjs";
import { loadAppearance, saveAppearance } from "./appearance.mjs";
import { getBackupStatus } from "./native-backup.mjs";
import { saveFileCopy } from "./native-files.mjs";
import {
  PADDOCK_LIBRARY_VERSION,
  PADDOCK_STORE_VERSION,
  ensurePaddockLibrarySeeded,
  inspectPaddockStore,
  inspectPaddockLibraryStore,
  persistPaddockLibrary,
  PROPERTY_SETTINGS_KEY,
} from "./storage.mjs";
import {
  activeLibraryEntries,
  archiveLibraryEntry,
  archivedLibraryEntries,
  createLibraryEntry,
  findLibraryEntryById,
  findLibraryEntryByName,
  restoreLibraryEntry,
  updateLibraryEntry,
} from "./paddock-library.mjs";


const emptyLibrary = () => ({ version: PADDOCK_LIBRARY_VERSION, entries: [] });
const emptyPaddockStore = () => ({
  version: PADDOCK_STORE_VERSION,
  paddocks: [],
  lastPaddockId: null,
  runs: [],
  activeRunId: null,
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function dateStamp(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function mountSettingsSections(root, onSelect = () => {}) {
  const buttons = [...root.querySelectorAll('[data-settings-section]')];
  const panels = [...root.querySelectorAll('[data-settings-panel]')];
  function select(section) {
    if (!buttons.some(button => button.dataset.settingsSection === section)) return;
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.settingsSection === section)));
    panels.forEach(panel => { panel.hidden = panel.dataset.settingsPanel !== section; });
    onSelect(section);
  }
  buttons.forEach(button => button.addEventListener('click', () => select(button.dataset.settingsSection)));
  select('help');
  return { select };
}

export async function saveSettingsFileCopy(blob, filename, { nativeSave = saveFileCopy, browserDownload } = {}) {
  const result = await nativeSave(blob, filename);
  if (result.mode === 'unsupported') {
    await browserDownload(blob, filename);
    return { mode: 'download-requested' };
  }
  if (!['saved', 'cancelled', 'downloaded'].includes(result.mode)) throw new Error('The file save outcome is unknown.');
  return result;
}

export function mountAppearanceControls(root, { load = loadAppearance, save = saveAppearance } = {}) {
  const mode = root.querySelector('#appearance-mode');
  const size = root.querySelector('#appearance-text-size');
  const form = root.querySelector('#appearance-form');
  const button = root.querySelector('#save-appearance');
  const status = root.querySelector('#appearance-status');
  let dirty = false, busy = false;
  const current = load();
  mode.value = current.mode;
  size.value = current.textSize;
  form.addEventListener('change', () => { dirty = true; status.textContent = 'Appearance changes are not saved yet.'; });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    busy = true; dirty = true;
    const candidate = { version: 1, mode: mode.value, textSize: size.value };
    [mode, size, button].forEach(control => { control.disabled = true; });
    status.textContent = 'Saving appearance…';
    try {
      await save(candidate);
      dirty = false;
      status.textContent = 'Appearance saved on this browser.';
    } catch (error) {
      status.textContent = `Appearance is not saved. ${error.message || 'Please try again.'}`;
    } finally {
      busy = false;
      [mode, size, button].forEach(control => { control.disabled = false; });
    }
  });
  return { hasUnsavedChanges: () => dirty || busy };
}

export function mountSettingsApp(host, options = {}) {
  const root = host.shadowRoot || host.attachShadow({ mode: "open" });
  root.innerHTML = SETTINGS_TEMPLATE;
  const browserDocument = globalThis.document;
  const $ = (selector) => root.querySelector(selector);
  async function refreshBackupStatus() {
    try { $('#settings-backup-status').textContent = (await getBackupStatus()).message; }
    catch { $('#settings-backup-status').textContent = 'Backup status could not be checked.'; }
  }
  const sections = mountSettingsSections(root, section => { if (section === 'backup') refreshBackupStatus(); });
  globalThis.addEventListener?.('native-backup-status-changed', refreshBackupStatus);
  const appearance = mountAppearanceControls(root);

  const libraryForm = $("#library-form");
  const libraryFormTitle = $("#library-form-title");
  const libraryName = $("#library-name");
  const libraryTotalHectares = $("#library-total-hectares");
  const libraryFormError = $("#library-form-error");
  const saveLibraryEntry = $("#save-library-entry");
  const cancelLibraryEdit = $("#cancel-library-edit");
  const libraryList = $("#library-list");
  const libraryEmpty = $("#library-empty");
  const libraryCount = $("#library-count");
  const archivedLibrary = $("#archived-library");
  const archivedLibrarySummary = $("#archived-library-summary");
  const archivedLibraryList = $("#archived-library-list");
  const libraryStorageStatus = $("#library-storage-status");
  const lockWarning = $("#library-lock-warning");
  const lockTitle = $("#library-lock-title");
  const lockMessage = $("#library-lock-message");
  const downloadOriginalLibrary = $("#download-original-library");
  const writeWarning = $("#library-write-warning");
  const retryLibrarySave = $("#retry-library-save");
  const downloadLibraryRecovery = $("#download-library-recovery");
  const viewAppGuide = $("#view-app-guide");
  const appGuideDialog = $("#app-guide-dialog");
  const appGuideDialogTitle = $("#app-guide-dialog-title");
  const closeAppGuide = $("#close-app-guide");
  const backupAllRecords = $("#settings-backup-all-records");
  const restoreAllRecords = $("#settings-restore-all-records");
  const toast = $("#settings-toast");
  const propertyForm = $("#property-settings-form");
  const propertyBusinessName = $("#property-business-name");
  const propertyShortName = $("#property-short-name");
  const propertyDefaultPeriod = $("#property-default-period");
  const propertyTheme = $("#property-theme");
  const propertyError = $("#property-settings-error");
  const propertyWarning = $("#property-settings-warning");
  const propertyStatus = $("#property-storage-status");
  const previewShort = $("#branding-preview-short");
  const previewBusiness = $("#branding-preview-business");

  let library = emptyLibrary();
  let inspection = { status: "absent", raw: null, value: null };
  let initializationError = null;
  let pendingSave = false;
  let libraryBusy = false;
  let seedRetry = false;
  let propertyBusy = false;
  let propertyDirty = false;
  let pendingSuccessMessage = "Paddock Library saved.";
  let editingEntryId = null;
  let toastTimer = null;
  let guideReturnFocus = null;
  let guideFallbackOpen = false;
  let property = { ...PROPERTY_SETTINGS_DEFAULTS, emblem: { ...PROPERTY_SETTINGS_DEFAULTS.emblem } };
  let propertyInspection = { state: "absent", raw: null };
  let propertyInitializationError = null;

  function hasExternalUnsavedLibraryChanges() {
    try {
      return options.hasExternalUnsavedLibraryChanges?.() === true;
    } catch {
      return true;
    }
  }

  function isLocked() {
    return Boolean(
      hasExternalUnsavedLibraryChanges()
      || initializationError
      || ["corrupt", "future"].includes(inspection.status),
    );
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 3200);
  }

  async function downloadText(filename, text, type = "application/json") {
    const blob = new Blob([text], { type: `${type};charset=utf-8` });
    return downloadBlob(filename, blob);
  }

  let recoveryFileBusy = false;
  async function downloadBlob(filename, blob) {
    if (recoveryFileBusy) return;
    recoveryFileBusy = true;
    [downloadLibraryRecovery, downloadOriginalLibrary].forEach(button => { button.disabled = true; });
    try {
      const result = await saveSettingsFileCopy(blob, filename, {
        browserDownload(blob, filename) {
          const url = URL.createObjectURL(blob);
          const link = browserDocument.createElement("a");
          link.href = url;
          link.download = filename;
          browserDocument.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 0);
        },
      });
      if (result.mode === 'saved') showToast('Recovery copy saved and verified. App records were not changed.');
      else if (result.mode === 'cancelled') showToast('Save cancelled. App records were not changed.');
      else showToast('Download requested. Check your downloads; the saved file has not been verified.');
      return result;
    } catch (error) {
      showToast(`The recovery copy was not confirmed saved. ${error.message || 'Please try again.'}`);
      return { mode: 'failed' };
    } finally {
      recoveryFileBusy = false;
      [downloadLibraryRecovery, downloadOriginalLibrary].forEach(button => { button.disabled = false; });
    }
  }

  function openAppGuide() {
    guideReturnFocus = root.activeElement || browserDocument.activeElement;
    if (typeof appGuideDialog.showModal === "function") appGuideDialog.showModal();
    else {
      guideFallbackOpen = true;
      appGuideDialog.hidden = false;
      appGuideDialog.setAttribute("aria-modal", "true");
    }
    appGuideDialogTitle.focus();
  }

  function dismissAppGuide() {
    if (appGuideDialog.open && typeof appGuideDialog.close === "function") appGuideDialog.close();
    if (guideFallbackOpen) {
      guideFallbackOpen = false;
      appGuideDialog.hidden = true;
      appGuideDialog.removeAttribute("aria-modal");
    }
    if (guideReturnFocus && typeof guideReturnFocus.focus === "function") guideReturnFocus.focus();
    guideReturnFocus = null;
  }

  function formatHectares(value) {
    if (!(Number(value) > 0)) return "Total hectares not entered";
    return `${new Intl.NumberFormat("en-AU", { maximumFractionDigits: 2 }).format(Number(value))} ha total`;
  }

  function sorted(entries) {
    return [...entries].sort((left, right) => left.name.localeCompare(right.name, "en-AU"));
  }

  function renderLockWarning() {
    const locked = isLocked();
    lockWarning.hidden = !locked;
    if (!locked) return;
    if (hasExternalUnsavedLibraryChanges()) {
      lockTitle.textContent = "Unsaved Paddock Library change";
      lockMessage.textContent = "Return to Spray Operations and use Retry saving or download its recovery copy before managing the Paddock Library here.";
    } else if (initializationError) {
      lockTitle.textContent = "Paddock Library unavailable";
      lockMessage.textContent = "The browser could not open the Paddock Library. Existing records were not changed.";
    } else if (inspection.status === "future") {
      lockTitle.textContent = "Newer Paddock Library protected";
      lockMessage.textContent = `This phone contains Paddock Library version ${inspection.version}. This app supports version ${inspection.supportedVersion} and will not overwrite it.`;
    } else {
      lockTitle.textContent = "Unreadable Paddock Library protected";
      lockMessage.textContent = "The saved Paddock Library could not be validated and will not be overwritten.";
    }
    downloadOriginalLibrary.hidden = hasExternalUnsavedLibraryChanges() || typeof inspection.raw !== "string";
  }

  function renderWarnings() {
    renderLockWarning();
    writeWarning.hidden = !pendingSave;
    libraryStorageStatus.textContent = pendingSave
      ? "Not saved on this device"
      : isLocked()
        ? "Protected device data — editing locked"
        : "Saved in this browser only";
  }

  function rowHtml(entry, archived = false) {
    const name = escapeHtml(entry.name);
    const id = escapeHtml(entry.id);
    const action = archived ? "restore" : "archive";
    const actionLabel = archived ? "Restore" : "Archive";
    return `
      <div class="library-row">
        <span><strong>${name}</strong><small>${escapeHtml(formatHectares(entry.totalHectares))}</small></span>
        <div class="library-row-actions">
          ${archived ? "" : `<button type="button" data-library-action="edit" data-library-id="${id}" aria-label="Edit ${name}">Edit</button>`}
          <button type="button" data-library-action="${action}" data-library-id="${id}" aria-label="${actionLabel} ${name}">${actionLabel}</button>
        </div>
      </div>
    `;
  }

  function renderLibrary() {
    const active = sorted(activeLibraryEntries(library));
    const archived = sorted(archivedLibraryEntries(library));
    libraryCount.textContent = `${active.length} active ${active.length === 1 ? "paddock" : "paddocks"}`;
    libraryList.innerHTML = active.map((entry) => rowHtml(entry)).join("");
    libraryList.hidden = active.length === 0;
    libraryEmpty.hidden = active.length > 0;
    archivedLibrary.hidden = archived.length === 0;
    archivedLibrarySummary.textContent = `Archived paddocks · ${archived.length}`;
    archivedLibraryList.innerHTML = archived.map((entry) => rowHtml(entry, true)).join("");

    const disabled = isLocked() || pendingSave;
    for (const control of libraryForm.querySelectorAll("input, button")) control.disabled = disabled;
    for (const button of root.querySelectorAll("[data-library-action]")) button.disabled = disabled;
  }

  function renderAll() {
    renderProperty();
    renderWarnings();
    renderLibrary();
  }

  function renderProperty() {
    if (propertyDirty || propertyBusy) {
      propertyStatus.textContent = propertyBusy ? "Saving…" : "Changes not saved";
      return;
    }
    const locked = propertyInitializationError || ["corrupt", "future"].includes(propertyInspection.state);
    propertyWarning.hidden = !locked;
    propertyWarning.textContent = propertyInitializationError
      ? "Property settings could not be read. Existing settings were not changed."
      : propertyInspection.state === "future"
        ? `This phone contains property settings version ${propertyInspection.version}; they are protected from overwrite.`
        : propertyInspection.state === "corrupt"
          ? "Property settings are unreadable and protected from overwrite."
          : "";
    for (const control of propertyForm.querySelectorAll("input, select, button")) control.disabled = Boolean(locked);
    propertyBusinessName.value = property.businessName || "";
    propertyShortName.value = property.shortName || "";
    propertyDefaultPeriod.value = property.defaultPeriod || "fortnight";
    propertyTheme.value = property.theme || "pallathorpe";
    previewShort.textContent = property.shortName || property.businessName || "Pallathorpe";
    previewBusiness.textContent = property.businessName || "Pallathorpe Enterprises";
    propertyStatus.textContent = locked ? "Protected device data — editing locked" : "Saved in this browser only";
  }

  function renderLivePropertyPreview() {
    previewShort.textContent = propertyShortName.value.trim() || propertyBusinessName.value.trim() || "Pallathorpe";
    previewBusiness.textContent = propertyBusinessName.value.trim() || "Pallathorpe Enterprises";
  }

  function refreshProperty() {
    propertyInitializationError = null;
    try {
      propertyInspection = inspectPropertySettings(getStorage()?.getItem?.(PROPERTY_SETTINGS_KEY));
      if (propertyInspection.state === "ready" || propertyInspection.state === "absent") property = propertyInspection.data;
    } catch (error) {
      propertyInitializationError = error;
      propertyInspection = { state: "corrupt", raw: null };
    }
  }

  async function submitPropertyForm(event) {
    event.preventDefault();
    if (propertyBusy) return;
    propertyError.hidden = true;
    if (propertyInitializationError || ["corrupt", "future"].includes(propertyInspection.state)) return;
    try {
      const candidate = normalizePropertySettings({
        businessName: propertyBusinessName.value,
        shortName: propertyShortName.value,
        defaultPeriod: propertyDefaultPeriod.value,
        theme: propertyTheme.value,
      });
      propertyBusy = true;
      propertyDirty = true;
      for (const control of propertyForm.elements) control.disabled = true;
      await transactStorage(storage => persistPropertySettings(storage, candidate, PROPERTY_SETTINGS_KEY));
      property = candidate;
      propertyDirty = false;
      propertyInspection = inspectPropertySettings(JSON.stringify(property));
      renderProperty();
      options.onPropertyChange?.(property);
      showToast("Property settings saved.");
    } catch (error) {
      propertyError.textContent = error?.message || "Property settings could not be saved.";
      propertyError.hidden = false;
    } finally {
      propertyBusy = false;
      for (const control of propertyForm.elements) control.disabled = false;
      renderProperty();
    }
  }

  function resetForm({ focus = false } = {}) {
    editingEntryId = null;
    libraryForm.reset();
    libraryFormTitle.textContent = "Add paddock";
    saveLibraryEntry.textContent = "Add paddock";
    cancelLibraryEdit.hidden = true;
    libraryFormError.hidden = true;
    if (focus) libraryName.focus();
  }

  function beginEdit(entry) {
    editingEntryId = entry.id;
    libraryFormTitle.textContent = `Edit ${entry.name}`;
    saveLibraryEntry.textContent = "Save changes";
    cancelLibraryEdit.hidden = false;
    libraryFormError.hidden = true;
    libraryName.value = entry.name;
    libraryTotalHectares.value = entry.totalHectares ?? "";
    libraryName.focus();
    libraryForm.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function notifyLibraryChange() {
    if (typeof options.onLibraryChange === "function") options.onLibraryChange();
  }

  async function persistCurrentLibrary(successMessage) {
    if (libraryBusy) return false;
    pendingSuccessMessage = successMessage;
    if (hasExternalUnsavedLibraryChanges()) {
      pendingSave = true;
      renderAll();
      showToast("Resolve the unsaved Spray Operations library change before retrying here.");
      return false;
    }
    const candidate = structuredClone(library);
    libraryBusy = true;
    pendingSave = true;
    renderAll();
    try {
      await transactStorage(storage => persistPaddockLibrary(candidate, storage));
      inspection = inspectPaddockLibraryStore(getStorage());
      if (inspection.status !== "ready") throw new Error("The saved Paddock Library could not be verified.");
      library = inspection.value;
      pendingSave = false;
      renderAll();
      notifyLibraryChange();
      showToast(successMessage);
      return true;
    } catch {
      pendingSave = true;
      renderAll();
      showToast("The Paddock Library is not saved yet.");
      return false;
    } finally {
      libraryBusy = false;
      renderAll();
    }
  }

  function enteredTotalHectares() {
    if (libraryTotalHectares.value === "") return null;
    const value = Number(libraryTotalHectares.value);
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError("Total hectares must be left blank or entered as a number greater than zero.");
    }
    return value;
  }

  async function submitLibraryForm(event) {
    event.preventDefault();
    if (isLocked() || pendingSave) return;
    libraryFormError.hidden = true;
    try {
      const name = libraryName.value;
      const totalHectares = enteredTotalHectares();
      const editingEntry = editingEntryId ? findLibraryEntryById(library, editingEntryId) : null;
      const duplicate = findLibraryEntryByName(library, name, { includeArchived: true });
      if (duplicate && duplicate.id !== editingEntry?.id) {
        throw new Error(
          duplicate.archivedAt
            ? `${duplicate.name} is archived. Restore it instead of adding a duplicate.`
            : `${duplicate.name} is already in the Paddock Library.`,
        );
      }
      const changedAt = new Date().toISOString();
      if (editingEntry) {
        const updated = updateLibraryEntry(editingEntry, { name, totalHectares }, changedAt);
        library = {
          version: PADDOCK_LIBRARY_VERSION,
          entries: library.entries.map((entry) => entry.id === updated.id ? updated : entry),
        };
        if (await persistCurrentLibrary(`${updated.name} updated.`)) resetForm();
      } else {
        const created = createLibraryEntry({ name, totalHectares }, changedAt);
        library = { version: PADDOCK_LIBRARY_VERSION, entries: [...library.entries, created] };
        if (await persistCurrentLibrary(`${created.name} added.`)) resetForm();
      }
    } catch (error) {
      libraryFormError.textContent = error?.message || "The paddock could not be saved.";
      libraryFormError.hidden = false;
    }
  }

  async function archiveEntry(entry) {
    if (!globalThis.confirm(
      `Archive ${entry.name} from the Paddock Library? Existing spray records and active Buffer selections will stay unchanged.`,
    )) return;
    const updated = archiveLibraryEntry(entry, new Date().toISOString());
    library = {
      version: PADDOCK_LIBRARY_VERSION,
      entries: library.entries.map((candidate) => candidate.id === updated.id ? updated : candidate),
    };
    if (editingEntryId === entry.id) resetForm();
    await persistCurrentLibrary(`${updated.name} archived.`);
  }

  async function restoreEntry(entry) {
    const updated = restoreLibraryEntry(entry, new Date().toISOString());
    library = {
      version: PADDOCK_LIBRARY_VERSION,
      entries: library.entries.map((candidate) => candidate.id === updated.id ? updated : candidate),
    };
    await persistCurrentLibrary(`${updated.name} restored.`);
  }

  async function handleLibraryAction(event) {
    const button = event.target.closest("[data-library-action]");
    if (!button || isLocked() || pendingSave) return;
    const entry = findLibraryEntryById(library, button.dataset.libraryId);
    if (!entry) return;
    if (button.dataset.libraryAction === "edit") beginEdit(entry);
    if (button.dataset.libraryAction === "archive") await archiveEntry(entry);
    if (button.dataset.libraryAction === "restore") await restoreEntry(entry);
  }

  async function refresh() {
    refreshBackupStatus();
    if (libraryBusy) return;
    if (hasExternalUnsavedLibraryChanges()) {
      renderAll();
      return;
    }
    if (pendingSave) {
      renderAll();
      return;
    }
    try {
      inspection = inspectPaddockLibraryStore(getStorage());
      if (inspection.status === "absent") {
        const paddockInspection = inspectPaddockStore(getStorage());
        if (["corrupt", "future"].includes(paddockInspection.status)) {
          throw new Error("Existing paddock records must be resolved before the Paddock Library can be created safely.");
        }
        libraryBusy = true;
        seedRetry = true;
        pendingSave = true;
        renderAll();
        await transactStorage(storage => ensurePaddockLibrarySeeded(
          paddockInspection.status === "ready" ? paddockInspection.value : emptyPaddockStore(),
          storage,
        ));
        pendingSave = false;
        seedRetry = false;
        inspection = inspectPaddockLibraryStore(getStorage());
      }
      initializationError = null;
      if (inspection.status === "ready") library = inspection.value;
      else if (inspection.status === "absent") library = emptyLibrary();
    } catch (error) {
      initializationError = error;
      try {
        inspection = inspectPaddockLibraryStore(getStorage());
      } catch {
        inspection = { status: "absent", raw: null, value: null };
      }
    }
    libraryBusy = false;
    if (editingEntryId && !findLibraryEntryById(library, editingEntryId)) resetForm();
    renderAll();
  }

  libraryForm.addEventListener("submit", submitLibraryForm);
  cancelLibraryEdit.addEventListener("click", () => resetForm({ focus: true }));
  libraryList.addEventListener("click", handleLibraryAction);
  archivedLibraryList.addEventListener("click", handleLibraryAction);
  retryLibrarySave.addEventListener("click", async () => {
    if (libraryBusy) return;
    if (seedRetry) {
      pendingSave = false;
      await refresh();
      return;
    }
    if (hasExternalUnsavedLibraryChanges()) {
      renderAll();
      return;
    }
    await persistCurrentLibrary(pendingSuccessMessage);
  });
  downloadLibraryRecovery.addEventListener("click", async () => {
    await downloadText(
      `pallathorpe-paddock-library-recovery_${dateStamp()}.json`,
      `${JSON.stringify(library, null, 2)}\n`,
    );
  });
  downloadOriginalLibrary.addEventListener("click", async () => {
    if (typeof inspection.raw !== "string") return;
    const extension = inspection.status === "future" ? "json" : "txt";
    await downloadText(
      `pallathorpe-paddock-library-original-${inspection.status}_${dateStamp()}.${extension}`,
      inspection.raw,
      extension === "json" ? "application/json" : "text/plain",
    );
  });
  viewAppGuide.addEventListener("click", openAppGuide);
  closeAppGuide.addEventListener("click", dismissAppGuide);
  appGuideDialog.addEventListener("click", (event) => {
    if (event.target === appGuideDialog) dismissAppGuide();
  });
  appGuideDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dismissAppGuide();
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && guideFallbackOpen) {
      event.preventDefault();
      dismissAppGuide();
    }
  });
  backupAllRecords.addEventListener("click", () => options.onBackupRequest?.("backup"));
  restoreAllRecords.addEventListener("click", () => options.onBackupRequest?.("restore"));
  propertyForm.addEventListener("submit", submitPropertyForm);
  propertyForm.addEventListener("input", () => { propertyDirty = true; });
  propertyForm.addEventListener("change", () => { propertyDirty = true; });
  propertyBusinessName.addEventListener("input", renderLivePropertyPreview);
  propertyShortName.addEventListener("input", renderLivePropertyPreview);

  refreshProperty();
  refresh();

  return {
    refresh,
    openSection: sections.select,
    getUnsavedBlocker: () => propertyDirty || propertyBusy || appearance.hasUnsavedChanges()
      ? { section: 'property', message: 'Save the pending property or appearance changes in Settings.' }
      : pendingSave || libraryBusy
        ? { section: 'library', message: 'Finish saving the Paddock Library changes in Settings.' } : null,
    hasUnsavedChanges: () => pendingSave || libraryBusy || propertyBusy || propertyDirty || appearance.hasUnsavedChanges(),
    closeGuide: dismissAppGuide,
  };
}


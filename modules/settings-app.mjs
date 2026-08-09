import { SETTINGS_TEMPLATE } from "./settings-template.mjs";
import {
  PADDOCK_LIBRARY_VERSION,
  PADDOCK_STORE_VERSION,
  ensurePaddockLibrarySeeded,
  inspectPaddockStore,
  inspectPaddockLibraryStore,
  persistPaddockLibrary,
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

export function mountSettingsApp(host, options = {}) {
  const root = host.shadowRoot || host.attachShadow({ mode: "open" });
  root.innerHTML = SETTINGS_TEMPLATE;
  const browserDocument = globalThis.document;
  const $ = (selector) => root.querySelector(selector);

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
  const toast = $("#settings-toast");

  let library = emptyLibrary();
  let inspection = { status: "absent", raw: null, value: null };
  let initializationError = null;
  let pendingSave = false;
  let pendingSuccessMessage = "Paddock Library saved.";
  let editingEntryId = null;
  let toastTimer = null;

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

  function downloadText(filename, text, type = "application/json") {
    const blob = new Blob([text], { type: `${type};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = browserDocument.createElement("a");
    link.href = url;
    link.download = filename;
    browserDocument.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
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
        : "Saved on this phone only";
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
    renderWarnings();
    renderLibrary();
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

  function persistCurrentLibrary(successMessage) {
    pendingSuccessMessage = successMessage;
    if (hasExternalUnsavedLibraryChanges()) {
      pendingSave = true;
      renderAll();
      showToast("Resolve the unsaved Spray Operations library change before retrying here.");
      return false;
    }
    try {
      persistPaddockLibrary(library, globalThis.localStorage);
      inspection = inspectPaddockLibraryStore(globalThis.localStorage);
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

  function submitLibraryForm(event) {
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
        resetForm();
        persistCurrentLibrary(`${updated.name} updated.`);
      } else {
        const created = createLibraryEntry({ name, totalHectares }, changedAt);
        library = { version: PADDOCK_LIBRARY_VERSION, entries: [...library.entries, created] };
        resetForm();
        persistCurrentLibrary(`${created.name} added.`);
      }
    } catch (error) {
      libraryFormError.textContent = error?.message || "The paddock could not be saved.";
      libraryFormError.hidden = false;
    }
  }

  function archiveEntry(entry) {
    if (!globalThis.confirm(
      `Archive ${entry.name} from the Paddock Library? Existing spray records and active Buffer selections will stay unchanged.`,
    )) return;
    const updated = archiveLibraryEntry(entry, new Date().toISOString());
    library = {
      version: PADDOCK_LIBRARY_VERSION,
      entries: library.entries.map((candidate) => candidate.id === updated.id ? updated : candidate),
    };
    if (editingEntryId === entry.id) resetForm();
    persistCurrentLibrary(`${updated.name} archived.`);
  }

  function restoreEntry(entry) {
    const updated = restoreLibraryEntry(entry, new Date().toISOString());
    library = {
      version: PADDOCK_LIBRARY_VERSION,
      entries: library.entries.map((candidate) => candidate.id === updated.id ? updated : candidate),
    };
    persistCurrentLibrary(`${updated.name} restored.`);
  }

  function handleLibraryAction(event) {
    const button = event.target.closest("[data-library-action]");
    if (!button || isLocked() || pendingSave) return;
    const entry = findLibraryEntryById(library, button.dataset.libraryId);
    if (!entry) return;
    if (button.dataset.libraryAction === "edit") beginEdit(entry);
    if (button.dataset.libraryAction === "archive") archiveEntry(entry);
    if (button.dataset.libraryAction === "restore") restoreEntry(entry);
  }

  function refresh() {
    if (hasExternalUnsavedLibraryChanges()) {
      renderAll();
      return;
    }
    if (pendingSave) {
      renderAll();
      return;
    }
    try {
      inspection = inspectPaddockLibraryStore(globalThis.localStorage);
      if (inspection.status === "absent") {
        const paddockInspection = inspectPaddockStore(globalThis.localStorage);
        if (["corrupt", "future"].includes(paddockInspection.status)) {
          throw new Error("Existing paddock records must be resolved before the Paddock Library can be created safely.");
        }
        ensurePaddockLibrarySeeded(
          paddockInspection.status === "ready" ? paddockInspection.value : emptyPaddockStore(),
          globalThis.localStorage,
        );
        inspection = inspectPaddockLibraryStore(globalThis.localStorage);
      }
      initializationError = null;
      if (inspection.status === "ready") library = inspection.value;
      else if (inspection.status === "absent") library = emptyLibrary();
    } catch (error) {
      initializationError = error;
      try {
        inspection = inspectPaddockLibraryStore(globalThis.localStorage);
      } catch {
        inspection = { status: "absent", raw: null, value: null };
      }
    }
    if (editingEntryId && !findLibraryEntryById(library, editingEntryId)) resetForm();
    renderAll();
  }

  libraryForm.addEventListener("submit", submitLibraryForm);
  cancelLibraryEdit.addEventListener("click", () => resetForm({ focus: true }));
  libraryList.addEventListener("click", handleLibraryAction);
  archivedLibraryList.addEventListener("click", handleLibraryAction);
  retryLibrarySave.addEventListener("click", () => {
    if (hasExternalUnsavedLibraryChanges()) {
      renderAll();
      return;
    }
    persistCurrentLibrary(pendingSuccessMessage);
  });
  downloadLibraryRecovery.addEventListener("click", () => {
    downloadText(
      `pallathorpe-paddock-library-recovery_${dateStamp()}.json`,
      `${JSON.stringify(library, null, 2)}\n`,
    );
  });
  downloadOriginalLibrary.addEventListener("click", () => {
    if (typeof inspection.raw !== "string") return;
    const extension = inspection.status === "future" ? "json" : "txt";
    downloadText(
      `pallathorpe-paddock-library-original-${inspection.status}_${dateStamp()}.${extension}`,
      inspection.raw,
      extension === "json" ? "application/json" : "text/plain",
    );
  });

  refresh();

  return {
    refresh,
    hasUnsavedChanges: () => pendingSave,
  };
}

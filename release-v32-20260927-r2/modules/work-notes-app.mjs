import { getStorage, transactStorage, isStorageBusy, getRevision, DURABLE_PREFIX } from "./durable-storage.mjs";
import {
  STORAGE_KEY,
  addDays,
  applyNoteChange,
  backupExport,
  classifyFollowUp,
  createEmptyData,
  fortnightStartFor,
  fortnightTextExport,
  getPeriodDates,
  periodEndFor,
  periodStartFor,
  periodTextExport,
  normalizePeriod,
  formatLongDate,
  formatShortDate,
  getFortnightDates,
  inspectStoredData,
  isIsoDate,
  normalizeBackup,
  persistStoredData,
  restorePreviousNote,
  sortOpenFollowUps,
  todayIso,
} from "./work-notes-logic.mjs";
import { loadPropertySettings } from "./property-settings.mjs";
import { APP_CHANNEL } from "../config.mjs";
import {
  combinedBackupExport,
  findLatestPreRestoreRecovery,
  prepareCombinedBackupRestore,
  restoreCombinedBackup,
  PROPERTY_SETTINGS_KEY,
} from "./storage.mjs";
import { mountWorkNotesAi, normalizeAiConfig } from "./work-notes-ai.mjs";
import {
  buildWorkNotesPdf,
  workNotesExportDescriptor,
} from "./work-notes-export.mjs";
import { handFilesToShareSheet } from "./share-files.mjs";
import { saveFileCopy } from "./native-files.mjs";
import { WORK_NOTES_TEMPLATE } from "./work-notes-template.mjs";
import { moveTaskToNotebook, undoTaskMove } from "./notebook-storage.mjs";

export function originalTaskForNotebookMove(raw, taskId) {
  if (inspectStoredData(raw).state !== 'ready') throw new Error('Work Diary records need review before moving a to-do.');
  const task = JSON.parse(raw).followUps.find(item => item.id === taskId && item.status === 'open');
  if (!task) throw new Error('This to-do changed. Reopen the list and review it.');
  return structuredClone(task);
}

export function buildAiFortnightContext(startDate, notes = {}) {
  const dates = getFortnightDates(startDate);
  return {
    startDate,
    endDate: dates[dates.length - 1],
    notes: dates.map((date) => ({ date, text: notes[date]?.text ?? "" })),
  };
}

export function dailyNotePresentation(date, todayDate, textValue, hasUnsavedDraft = false) {
  const hasNote = Boolean(String(textValue ?? "").trim());
  const isToday = date === todayDate;
  const isFuture = date > todayDate;
  const noteStatus = hasUnsavedDraft ? "Not confirmed saved on this device" : "Note saved";
  return {
    hasNote,
    isToday,
    stateText: isToday
      ? hasNote ? `Today · ${noteStatus}` : "Today · Missing"
      : hasNote ? noteStatus : isFuture ? "Upcoming" : "Missing note",
    preview: hasNote
      ? String(textValue).trim().replace(/\s+/g, " ")
      : isToday ? "Tap to record today’s work" : isFuture ? "Tap to plan ahead" : "Tap to add work details",
  };
}

export function mountWorkNotesApp(host, options = {}) {
const root = host.shadowRoot || host.attachShadow({ mode: "open" });
root.innerHTML = WORK_NOTES_TEMPLATE;
const browserDocument = globalThis.document;
const document = {
  querySelectorAll: (selector) => root.querySelectorAll(selector),
  addEventListener: (...args) => root.addEventListener(...args),
  createElement: (...args) => browserDocument.createElement(...args),
  body: root,
  execCommand: (...args) => browserDocument.execCommand(...args),
};
const $ = (selector) => root.querySelector(selector);
const aiAvailable = normalizeAiConfig(options.aiConfig).configured;
root.querySelectorAll('[data-ai-availability]').forEach(panel => {
  panel.querySelector('summary').hidden = aiAvailable;
  panel.open = aiAvailable;
  panel.classList.toggle('ai-unavailable', !aiAvailable);
});
if (!aiAvailable) $(".ai-note-sample-actions").hidden = true;
const noteDialog = $("#note-dialog");
const followupDialog = $("#followup-dialog");
const workNotesDownloadDialog = $("#work-notes-download-dialog");
const workNotesDownloadDialogMessage = $("#work-notes-download-dialog-message");
const noteTextarea = $("#note-text");
const restorePreviousButton = $("#restore-previous");
const saveIndicator = $("#save-indicator");
const today = todayIso();
let propertySettings;
try { propertySettings = loadPropertySettings(getStorage(), PROPERTY_SETTINGS_KEY); } catch { propertySettings = { businessName: "Pallathorpe Enterprises", shortName: "Pallathorpe", defaultPeriod: "fortnight", theme: "pallathorpe" }; }
let displayedPeriod = normalizePeriod(propertySettings.defaultPeriod);
let displayedStart = periodStartFor(today, displayedPeriod);
let activeSection = "notes";
let editingDate = null;
let noteReturnFocus = null;
let editSessionCaptured = false;
let savePulseTimer = null;
let toastTimer = null;
let deferredInstallPrompt = null;
let hasUnsavedDraft = false;
let persistFailureMessage = "";
let pendingLockedRestore = false;
let pendingFollowUpId = null;
let pendingWorkNotesDownloads = null;
let workNotesShareInProgress = false;
let fileActionInProgress = false;
let notebookMoveBusy = false;
let notebookMoveTask = null;
let lastNotebookMove = null;
let latestPreRestoreRecovery = null;
const recoveryTimeFormatter = new Intl.DateTimeFormat("en-AU", {
  dateStyle: "medium",
  timeStyle: "short",
});

function hasExternalUnsavedChanges() {
  try {
    return options.hasExternalUnsavedChanges?.() === true;
  } catch {
    return true;
  }
}

function combinedDataHasUnsavedChanges() {
  return hasUnsavedDraft || notesSavesInFlight > 0 || notebookMoveBusy || Boolean(notebookMoveTask) || followupDialog.open || isStorageBusy() || hasExternalUnsavedChanges();
}

function refreshPreviousStateRecovery() {
  latestPreRestoreRecovery = findLatestPreRestoreRecovery(getStorage());
  const button = $("#download-previous-state-recovery");
  const status = $("#previous-state-recovery-status");
  button.hidden = !latestPreRestoreRecovery;
  status.textContent = latestPreRestoreRecovery
    ? `Captured ${recoveryTimeFormatter.format(new Date(latestPreRestoreRecovery.capturedAt))}. This support/recovery wrapper preserves the exact prior raw values for the records changed by that combined restore. It is not a standard combined backup and cannot be restored directly in this app.`
    : "No verified previous-state recovery could be found. Browser storage may be empty or unavailable.";
  return latestPreRestoreRecovery;
}

function readLocalData() {
  try {
    return inspectStoredData(getStorage().getItem(STORAGE_KEY));
  } catch (error) {
    return {
      state: "unavailable",
      raw: null,
      data: null,
      error: error instanceof Error ? error.message : "Browser storage is unavailable.",
    };
  }
}

const initialStorage = readLocalData();
let storageLock = ["corrupt", "future", "unavailable"].includes(initialStorage.state)
  ? initialStorage
  : null;
let data = initialStorage.data ?? createEmptyData();

const htmlEscapes = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => htmlEscapes[character]);
}

let saveSequence = 0;
let notesSavesInFlight = 0;
async function persistData({ replaceLocked = false } = {}) {
  if (storageLock && !replaceLocked) {
    updateStorageUi();
    return false;
  }
  const sequence = ++saveSequence;
  const candidate = structuredClone(data);
  notesSavesInFlight += 1;
  hasUnsavedDraft = true;
  updateStorageUi();
  try {
    await transactStorage(storage => persistStoredData(storage, candidate));
    if (sequence !== saveSequence) return false;
    storageLock = null;
    hasUnsavedDraft = false;
    persistFailureMessage = "";
    pendingLockedRestore = false;
    updateStorageUi();
    return true;
  } catch (error) {
    if (sequence !== saveSequence) return false;
    hasUnsavedDraft = true;
    persistFailureMessage =
      error instanceof Error ? error.message : "This browser could not save the change.";
    updateStorageUi();
    return false;
  } finally {
    notesSavesInFlight -= 1;
    updateStorageUi();
  }
}

function showToast(message, isError = false) {
  const toast = $("#toast");
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.style.background = isError ? "var(--danger)" : "var(--green-dark)";
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, isError ? 5000 : 2600);
}

function pulseSaved(message = "Saved on this device") {
  clearTimeout(savePulseTimer);
  saveIndicator.textContent = message;
  saveIndicator.classList.add("fresh");
  savePulseTimer = setTimeout(() => {
    saveIndicator.classList.remove("fresh");
  }, 1200);
}

function dateObject(dateIso) {
  return new Date(`${dateIso}T00:00:00Z`);
}

function rangeLabel(startIso, endIso) {
  const start = dateObject(startIso);
  const end = dateObject(endIso);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const startText = new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC",
  }).format(start);
  const endText = new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(end);
  return `${startText} – ${endText}`;
}

function shortWeekRange(startIso, endIso) {
  const start = new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(dateObject(startIso));
  const end = new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(dateObject(endIso));
  return `${start} – ${end}`;
}

function dayName(dateIso) {
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "long",
    timeZone: "UTC",
  }).format(dateObject(dateIso));
}

function dayAndMonth(dateIso) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(dateObject(dateIso));
}

function renderPeriod() {
  const end = periodEndFor(displayedStart, displayedPeriod);
  $("#period-label").textContent = rangeLabel(displayedStart, end);
  const currentStart = periodStartFor(today, displayedPeriod);
  const isCurrent = displayedStart === currentStart;
  const periodName = displayedPeriod === "week" ? "week" : displayedPeriod === "month" ? "month" : "fortnight";
  const direction = displayedStart < currentStart ? `Earlier ${periodName}` : `Future ${periodName}`;
  $("#period-kicker").textContent = isCurrent ? `Current ${periodName}` : direction;
  $("#previous-period").setAttribute("aria-label", `Previous ${periodName}`);
  $("#next-period").setAttribute("aria-label", `Next ${periodName}`);
  const selector = $("#period-kind");
  if (selector) selector.value = displayedPeriod;
  root.querySelectorAll("[data-period-kind]").forEach((button) => {
    const selected = button.dataset.periodKind === displayedPeriod;
    button.setAttribute("aria-pressed", String(selected));
    button.classList.toggle("selected", selected);
  });
  const aiSummaryAction = $("#ai-summary-action");
  const aiSummaryCopy = $("#ai-summary-copy");
  if (aiSummaryAction) {
    const fortnightOnly = displayedPeriod === "fortnight";
    aiSummaryAction.disabled = !aiAvailable || !fortnightOnly;
    aiSummaryAction.setAttribute("aria-disabled", String(!aiAvailable || !fortnightOnly));
    aiSummaryAction.title = !aiAvailable ? "AI is unavailable in this browser" : fortnightOnly ? "Draft a summary for this fortnight" : "AI summary is available for Fortnight view only";
    if (aiSummaryCopy) aiSummaryCopy.textContent = !aiAvailable
      ? "AI is unavailable in this browser. You can still add, edit, copy and share your notes manually."
      : fortnightOnly
      ? "AI can draft a summary from only the displayed Fortnight for you to review and copy."
      : "AI summary generation is available only for the displayed Fortnight. Daily dictation remains available in every view.";
  }
  $("#return-current").hidden = isCurrent;
}

function renderNotes() {
  const dates = getPeriodDates(displayedStart, displayedPeriod);
  const weeks = [];
  for (let index = 0; index < dates.length; index += 7) weeks.push(dates.slice(index, index + 7));
  $("#notes-weeks").innerHTML = weeks
    .map((week, weekIndex) => {
      const cards = week
        .map((date) => {
          const text = data.notes[date]?.text.trim() ?? "";
          const { hasNote, isToday, stateText, preview } = dailyNotePresentation(date, today, text, hasUnsavedDraft);
          return `
            <button
              class="day-note${hasNote ? " has-note" : ""}${isToday ? " is-today" : ""}"
              type="button"
              data-open-note="${date}"
              aria-label="Open ${escapeHtml(formatLongDate(date))} note. ${escapeHtml(stateText)}."
            >
              <span class="day-line">
                <span class="day-name">${escapeHtml(dayName(date))}</span>
                <span class="day-date">${escapeHtml(dayAndMonth(date))}</span>
              </span>
              <span class="note-state">${escapeHtml(stateText)}</span>
              <span class="note-preview">${escapeHtml(preview)}</span>
            </button>
          `;
        })
        .join("");
      return `
        <section class="week-block" aria-labelledby="week-${weekIndex + 1}-heading">
          <div class="week-heading">
            <h3 id="week-${weekIndex + 1}-heading">Week ${weekIndex + 1}</h3>
            <span>${escapeHtml(shortWeekRange(week[0], week.at(-1)))}</span>
          </div>
          <div class="note-grid">${cards}</div>
        </section>
      `;
    })
    .join("");
}

function renderSummary() {
  $("#summary-list").innerHTML = getPeriodDates(displayedStart, displayedPeriod)
    .map((date) => {
      const text = data.notes[date]?.text.trim() ?? "";
      const copied = data.copied[date] === true && Boolean(text);
      const buttonLabel = copied ? "✓ Copied" : text ? "Copy" : "No note";
      return `
        <article class="summary-day${date === today ? " is-today" : ""}">
          <div>
            <p class="summary-date">${escapeHtml(formatShortDate(date))}${date === today ? " · Today" : ""}</p>
            <p class="summary-text">${escapeHtml(text || "No note recorded")}</p>
          </div>
          <div class="summary-day-actions"><button class="secondary-button compact-button" type="button" data-open-note="${date}" aria-label="${text ? 'Edit' : 'Add'} note for ${escapeHtml(formatLongDate(date))}">${text ? 'Edit note' : 'Add note'}</button>
          ${text ? `<button
            class="copy-button${copied ? " copied" : ""}${text ? "" : " no-note"}"
            type="button"
            data-copy-note="${date}"
            ${text ? "" : "disabled"}
          >${buttonLabel}</button>` : ''}</div>
        </article>
      `;
    })
    .join("");
}

function followUpStatusLabel(item) {
  const state = classifyFollowUp(item, today);
  if (state === "overdue") return "Overdue";
  if (state === "today") return "Due today";
  if (state === "future") return `Due ${dayAndMonth(item.dueDate)}`;
  if (state === "done") return "Done";
  return "No due date";
}

function followUpCard(item, completed = false) {
  const state = classifyFollowUp(item, today);
  const dueText = item.dueDate ? `Due ${formatLongDate(item.dueDate)}` : "No due date";
  const sourceText = item.sourceDate
    ? `From note: ${formatLongDate(item.sourceDate)}`
    : "No source note";
  const completedText =
    completed && item.completedAt
      ? `Completed ${new Intl.DateTimeFormat("en-AU", {
          day: "numeric",
          month: "short",
          year: "numeric",
        }).format(new Date(item.completedAt))}`
      : "";
  return `
    <article class="followup-card ${escapeHtml(state)}">
      <div class="followup-top">
        <p class="followup-description">${escapeHtml(item.description)}</p>
        <span class="status-pill ${escapeHtml(state)}">${escapeHtml(followUpStatusLabel(item))}</span>
      </div>
      <p class="followup-meta">
        <span>${escapeHtml(dueText)}</span>
        <span>${escapeHtml(sourceText)}</span>
        ${completedText ? `<span>${escapeHtml(completedText)}</span>` : ""}
      </p>
      <div class="followup-actions">
        ${completed ? "" : `<button class="quiet-button" type="button" data-move-notebook="${escapeHtml(item.id)}">Move to Notebook</button>`}
        ${
          completed
            ? `<button class="secondary-button" type="button" data-followup-status="${escapeHtml(item.id)}" data-next-status="open">Reopen</button>`
            : `<button class="primary-button" type="button" data-followup-status="${escapeHtml(item.id)}" data-next-status="done">Mark done</button>`
        }
        ${
          item.sourceDate
            ? `<button class="quiet-button" type="button" data-open-source="${escapeHtml(item.sourceDate)}">Open source note</button>`
            : ""
        }
      </div>
    </article>
  `;
}

function renderFollowUps() {
  const openItems = sortOpenFollowUps(data.followUps, today);
  options.onTaskCountChange?.(openItems.length);
  const completedItems = data.followUps
    .filter((item) => item.status === "done")
    .slice()
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));

  $("#open-followups").innerHTML = openItems.length
    ? `<div class="followup-list">${openItems.map((item) => followUpCard(item)).join("")}</div>`
    : `
      <div class="empty-state">
        <strong>No open to-do items</strong>
        <p>Add something that needs another look, with or without a due date.</p>
      </div>
    `;

  $("#completed-count").textContent = String(completedItems.length);
  $("#completed-followups").innerHTML = completedItems.length
    ? `<div class="followup-list">${completedItems
        .map((item) => followUpCard(item, true))
        .join("")}</div>`
    : `<p class="section-help">Completed items will stay here as history.</p>`;

  const count = $("#followup-count");
  count.textContent = String(openItems.length);
  count.hidden = openItems.length === 0;
}

function renderAttention() {
  const urgentItems = sortOpenFollowUps(data.followUps, today).filter((item) => {
    const state = classifyFollowUp(item, today);
    return state === "overdue" || state === "today";
  });
  const panel = $("#due-attention");
  panel.hidden = urgentItems.length === 0;
  if (!urgentItems.length) {
    $("#attention-items").replaceChildren();
    return;
  }

  const shown = urgentItems.slice(0, 5);
  const extra = urgentItems.length - shown.length;
  $("#attention-title").textContent =
    urgentItems.length === 1 ? "1 to-do needs attention" : `${urgentItems.length} to-do items need attention`;
  $("#attention-items").innerHTML =
    shown
      .map((item) => {
        const state = classifyFollowUp(item, today);
        return `
          <div class="attention-row">
            <span class="attention-badge ${state === "today" ? "today" : ""}">
              ${state === "today" ? "Today" : "Overdue"}
            </span>
            <span>${escapeHtml(item.description)}</span>
          </div>
        `;
      })
      .join("") +
    (extra > 0 ? `<p class="section-help">And ${extra} more.</p>` : "");
}

function renderAll() {
  renderPeriod();
  renderNotes();
  renderSummary();
  renderFollowUps();
  renderAttention();
  updateStorageUi();
  refreshPreviousStateRecovery();
}

function refreshPropertySettings(next) {
  if (!next || typeof next !== "object") return;
  propertySettings = next;
  $("#work-notes-farm-name").textContent = next.shortName || next.businessName || "Pallathorpe";
}

function activateSection(section) {
  if (!["notes", "summary", "followups"].includes(section)) return;
  activeSection = section;
  document.querySelectorAll("[data-section]").forEach((panel) => {
    panel.hidden = panel.dataset.section !== section;
  });
  document.querySelectorAll(".section-tab").forEach((tab) => {
    const selected = tab.dataset.sectionTarget === section;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
}

function requestSection(section) {
  if (typeof host.requestTopLevelSection === "function") {
    host.requestTopLevelSection(section);
    return;
  }
  activateSection(section);
}

function openNote(date) {
  if (notesSavesInFlight) { showToast("Saving your note. Please wait."); return; }
  noteReturnFocus = { element: root.activeElement, section: activeSection, date };
  editingDate = date;
  editSessionCaptured = false;
  const note = data.notes[date] ?? { text: "", history: [] };
  $("#note-dialog-kicker").textContent = date === today ? "Today’s note" : "Daily note";
  $("#note-dialog-title").textContent = formatLongDate(date);
  noteTextarea.value = note.text;
  restorePreviousButton.disabled = !note.history?.length;
  saveIndicator.textContent = hasUnsavedDraft
    ? "Not saved — recovery available"
    : note.updatedAt
      ? "Saved on this device"
      : "Not written yet";
  saveIndicator.classList.remove("fresh");
  saveIndicator.classList.toggle("unsaved", hasUnsavedDraft);
  updateWriteLockControls();
  noteDialog.showModal();
  requestAnimationFrame(() => {
    noteTextarea.focus();
    const end = noteTextarea.value.length;
    noteTextarea.setSelectionRange(end, end);
  });
}

function closeNote() {
  if (notesSavesInFlight) { showToast("Saving your note. Please wait."); return; }
  if (noteDialog.open) noteDialog.close();
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Continue to the selection-based fallback.
    }
  }
  const helper = document.createElement("textarea");
  helper.value = text;
  helper.setAttribute("readonly", "");
  helper.style.position = "fixed";
  helper.style.opacity = "0";
  document.body.append(helper);
  helper.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    helper.remove();
  }
  return copied;
}

function setFileActionBusy(busy) {
  fileActionInProgress = busy;
  workNotesDownloadDialog.querySelectorAll('button').forEach(button => button.disabled = busy);
}
async function downloadBlob(blob, filename) {
  if (fileActionInProgress) return;
  setFileActionBusy(true);
  try {
    const result = await saveFileCopy(blob, filename);
    if (result.mode === 'cancelled') { showToast('Save cancelled. Your records are unchanged.'); return; }
    if (result.mode === 'downloaded') { showToast('Download started. Check your browser downloads; the saved copy has not been verified.'); return; }
    if (result.mode === 'saved') {
      const message = result.verified === true ? 'File saved and verified.' : 'The saved file could not be verified.';
      workNotesDownloadDialogMessage.textContent = message;
      showToast(message, result.verified !== true);
      return;
    }
    if (result.mode !== 'unsupported') throw new Error('The file could not be saved.');
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Browser download started. Check your downloads for the file.');
  } catch (error) {
    const message = error?.message || 'The file could not be saved. Please try again.';
    workNotesDownloadDialogMessage.textContent = message;
    showToast(message, true);
  } finally { setFileActionBusy(false); }
}

function downloadText(filename, text, type) {
  return downloadBlob(new Blob([text], { type }), filename);
}

function closeWorkNotesDownloadOptions() {
  if (fileActionInProgress) return;
  if (workNotesDownloadDialog.open) workNotesDownloadDialog.close();
  pendingWorkNotesDownloads = null;
}

async function prepareWorkNotesCopies() {
  if (workNotesShareInProgress) return;
  workNotesShareInProgress = true;
  updateWriteLockControls();
  const textExport = periodTextExport(data, displayedStart, displayedPeriod, propertySettings);
  const descriptor = workNotesExportDescriptor(displayedStart, new Date().toISOString(), displayedPeriod, propertySettings);
  try {
    const pdfBytes = await buildWorkNotesPdf(data, descriptor);
    const pdfBlob = new Blob([pdfBytes], { type: "application/pdf" });
    const textBlob = new Blob([textExport.text], { type: "text/plain;charset=utf-8" });
    const files = typeof File === "function"
      ? {
          pdf: new File([pdfBlob], descriptor.filenames.pdf, { type: pdfBlob.type }),
          text: new File([textBlob], descriptor.filenames.text, { type: textBlob.type }),
        }
      : { pdf: null, text: null };
    pendingWorkNotesDownloads = {
      pdfBlob,
      textBlob,
      files,
      descriptor,
      filenames: descriptor.filenames,
    };
    workNotesDownloadDialogMessage.textContent = "Your PDF and text copies are ready. Choose Share or Save.";
    workNotesDownloadDialog.showModal();
    showToast("PDF and text copies are ready. Choose Share or Save.");
  } catch (error) {
    if (error?.name !== "AbortError") {
      showToast(error?.message || "Work Diary copies could not be generated.", true);
    }
  } finally {
    workNotesShareInProgress = false;
    updateWriteLockControls();
  }
}

async function sharePendingWorkNotes(kind) {
  if (fileActionInProgress) return;
  const pending = pendingWorkNotesDownloads;
  if (!pending) return;
  const file = pending.files?.[kind];
  const label = kind === "pdf" ? "PDF" : "text";
  if (!file) {
    const message = "Sharing is unavailable here. Choose Save PDF or Save text instead.";
    workNotesDownloadDialogMessage.textContent = message;
    showToast(message, true);
    return;
  }
  setFileActionBusy(true);
  try {
  const shareResult = await handFilesToShareSheet({
    navigatorLike: navigator,
    files: [file],
    title: `${propertySettings.shortName || propertySettings.businessName || 'Farm'} Work Diary`,
    text: `Work Diary for ${pending.descriptor.startIso} to ${pending.descriptor.endIso}.`,
  });
  if (shareResult.mode === "shared") {
    pendingWorkNotesDownloads = null;
    if (workNotesDownloadDialog.open) workNotesDownloadDialog.close();
    showToast(`${label} sharing options opened. Check that the receiving app kept the file.`);
    return;
  }
  if (shareResult.mode === "cancelled") return;
  const message = shareResult.message || (shareResult.reason === "share-failed"
    ? "Sharing could not open. Try again or choose Save PDF or Save text."
    : "Sharing is unavailable here. Choose Save PDF or Save text instead.");
  workNotesDownloadDialogMessage.textContent = message;
  showToast(message, true);
  } catch (error) {
    const message = error?.message || 'Sharing could not open. Please try again.';
    workNotesDownloadDialogMessage.textContent = message;
    showToast(message, true);
  } finally { setFileActionBusy(false); }
}

function updateWriteLockControls() {
  const locked = Boolean(storageLock);
  const appRoot = $(".work-notes-root");
  appRoot.dataset.storageLocked = String(locked);
  noteTextarea.disabled = locked;
  $("#followup-from-note").disabled = locked;
  $("#ai-dictate-note").disabled = !aiAvailable || locked;
  $("#ai-organise-note").disabled = !aiAvailable || locked || !noteTextarea.value.trim();
  $("#ai-create-followup-note").disabled = !aiAvailable || locked || !noteTextarea.value.trim();
  $("#add-followup").disabled = locked;
  $("#share-work-notes").disabled = locked || workNotesShareInProgress;
  $("#export-text").disabled = locked;
  $("#export-backup").disabled = locked;
  $("#export-combined-backup").disabled = locked || combinedDataHasUnsavedChanges();
  $("#restore-combined-backup").disabled = combinedDataHasUnsavedChanges();
  $("#followup-form button[type='submit']").disabled = locked || notesSavesInFlight > 0;
  for (const control of $("#followup-form").querySelectorAll("input, textarea")) control.disabled = locked || notesSavesInFlight > 0;
  restorePreviousButton.disabled =
    locked || !editingDate || !data.notes[editingDate]?.history?.length;
  document.querySelectorAll("[data-copy-note]").forEach((button) => {
    const noteText = data.notes[button.dataset.copyNote]?.text.trim() ?? "";
    button.disabled = locked || !noteText;
  });
  document.querySelectorAll("[data-followup-status]").forEach((button) => {
    button.disabled = locked;
  });
}

function updateStorageUi() {
  const warning = $("#storage-warning");
  const title = $("#storage-warning-title");
  const message = $("#storage-warning-message");
  const retry = $("#storage-retry");
  const downloadDraft = $("#storage-download-draft");
  const downloadOriginal = $("#storage-download-original");
  const restore = $("#storage-restore");

  retry.hidden = true;
  downloadDraft.hidden = true;
  downloadOriginal.hidden = true;
  restore.hidden = true;

  if (storageLock) {
    warning.hidden = false;
    if (storageLock.state === "future") {
      title.textContent = "Work Diary were created by a newer app";
      message.textContent =
        "This version cannot safely open or change them. Download the original data, or restore a confirmed compatible Work Diary JSON file.";
    } else if (storageLock.state === "corrupt") {
      title.textContent = "Stored Work Diary could not be read safely";
      message.textContent =
        "The original data has not been replaced. Download it for recovery, or restore a confirmed valid Work Diary JSON file.";
    } else {
      title.textContent = "Work Diary storage is unavailable";
      message.textContent =
        "Editing is locked to avoid replacing records that this browser cannot currently read. You can try restoring a valid Work Diary JSON file.";
    }
    downloadOriginal.hidden = typeof storageLock.raw !== "string";
    restore.hidden = false;
    retry.hidden = !hasUnsavedDraft;
    downloadDraft.hidden = !hasUnsavedDraft;
  } else if (hasUnsavedDraft) {
    warning.hidden = false;
    title.textContent = notesSavesInFlight ? "Saving changes…" : "Changes are not saved on this device";
    message.textContent = notesSavesInFlight ? "Waiting for the database to confirm the save." : `${persistFailureMessage || "The save could not be verified."} Keep this page open, retry, or download a recovery copy before closing.`;
    retry.hidden = false;
    downloadDraft.hidden = false;
  } else {
    warning.hidden = true;
  }

  if (hasUnsavedDraft) {
    saveIndicator.textContent = notesSavesInFlight ? "Saving…" : "Not saved — recovery available";
    saveIndicator.classList.remove("fresh");
    saveIndicator.classList.add("unsaved");
  } else {
    saveIndicator.classList.remove("unsaved");
  }
  updateWriteLockControls();
}

function notebookMoveBlocker() {
  if (storageLock || hasUnsavedDraft || notesSavesInFlight || isStorageBusy()) return "Finish or retry the current save before moving a to-do.";
  if (noteDialog.open || followupDialog.open) return "Finish or cancel the current diary or to-do editor first.";
  if (options.hasUnsavedNotebookChanges?.()) return "Notebook has unsaved changes. Open Notebook and finish or retry saving first.";
  return "";
}

function openNotebookMove(taskId) {
  if (notebookMoveBusy) return;
  const blocker = notebookMoveBlocker();
  if (blocker) { showToast(blocker, true); return; }
  let task;
  try { task = originalTaskForNotebookMove(getStorage().getItem(STORAGE_KEY), taskId); }
  catch (error) { showToast(error.message, true); return; }
  notebookMoveTask = structuredClone(task);
  $('#notebook-move-text').textContent = task.description;
  $('#notebook-move-note-title').value = task.description.split(/\r?\n/)[0].slice(0, 200);
  $('#notebook-move-error').hidden = true;
  $('#confirm-notebook-move').textContent = 'Move to Notebook';
  $('#notebook-move-dialog').showModal();
}

function refreshAfterNotebookMove() {
  const fresh = readLocalData();
  if (fresh.state !== 'ready') throw new Error('The saved diary could not be reloaded. Reload the app before making further changes.');
  data = fresh.data;
  renderFollowUps(); renderAttention(); updateStorageUi();
  options.onNotebookChanged?.();
}

async function confirmNotebookMove(event) {
  event.preventDefault();
  if (notebookMoveBusy || !notebookMoveTask) return;
  const errorElement = $('#notebook-move-error');
  const blocker = notebookMoveBlocker();
  if (blocker) { errorElement.textContent = blocker; errorElement.hidden = false; return; }
  const title = $('#notebook-move-note-title').value;
  if (!title.trim()) { errorElement.textContent = 'Give this note a title.'; errorElement.hidden = false; return; }
  notebookMoveBusy = true;
  $('#confirm-notebook-move').disabled = true;
  $('#cancel-notebook-move').disabled = true;
  $('#confirm-notebook-move').textContent = 'Saving…';
  errorElement.hidden = true;
  try {
    lastNotebookMove = await moveTaskToNotebook(notebookMoveTask.id, {expectedTask:notebookMoveTask,title});
    refreshAfterNotebookMove();
    $('#notebook-move-dialog').close();
    notebookMoveTask = null;
    $('#notebook-move-result').hidden = false;
    $('#notebook-move-message').textContent = 'Moved to Notebook and saved on this device. It no longer counts as an unfinished job.';
    $('#undo-notebook-move').hidden = !lastNotebookMove.receipt;
  } catch (error) {
    errorElement.textContent = `${error.message || 'The move was not confirmed.'} The task remains available unless the move was already committed; Retry checks before creating anything.`;
    errorElement.hidden = false;
    $('#confirm-notebook-move').textContent = 'Retry move';
  } finally {
    notebookMoveBusy = false;
    $('#confirm-notebook-move').disabled = false;
    $('#cancel-notebook-move').disabled = false;
  }
}

async function undoNotebookMove() {
  if (notebookMoveBusy || !lastNotebookMove?.receipt) return;
  const blocker = notebookMoveBlocker();
  if (blocker) { showToast(blocker, true); return; }
  notebookMoveBusy = true;
  $('#undo-notebook-move').disabled = true;
  try {
    await undoTaskMove(lastNotebookMove.receipt);
    refreshAfterNotebookMove();
    lastNotebookMove = null;
    $('#notebook-move-result').hidden = true;
    showToast('Move undone. The original to-do is back on the list.');
  } catch (error) { showToast(error.message || 'Undo could not be confirmed. Neither record was discarded.', true); }
  finally { notebookMoveBusy = false; $('#undo-notebook-move').disabled = false; }
}

$('#notebook-move-form').addEventListener('submit', confirmNotebookMove);
$('#cancel-notebook-move').addEventListener('click', () => { if (!notebookMoveBusy) { notebookMoveTask = null; $('#notebook-move-dialog').close(); } });
$('#notebook-move-dialog').addEventListener('cancel', event => { if (notebookMoveBusy) event.preventDefault(); else notebookMoveTask = null; });
$('#open-moved-notebook').addEventListener('click', () => { if (!notebookMoveBusy && lastNotebookMove) options.onOpenNotebook?.(lastNotebookMove.noteId); });
$('#undo-notebook-move').addEventListener('click', undoNotebookMove);
for (const type of ['click','submit','input','cancel']) root.addEventListener(type, event => {
  if (notebookMoveBusy) { event.preventDefault(); event.stopImmediatePropagation(); }
}, true);

function canMutateData({ allowPending = false } = {}) {
  if (notebookMoveBusy) { showToast("Wait for the Notebook move to finish."); return false; }
  if (!allowPending && notesSavesInFlight) { showToast("Please wait for the current save."); return false; }
  if (!storageLock) return true;
  updateStorageUi();
  showToast("Work Diary editing is locked until the storage warning is resolved.", true);
  return false;
}

function openFollowUpForm(sourceDate = "") {
  if (hasUnsavedDraft) { showToast("Retry saving the pending Work Diary changes first.", true); return; }
  pendingFollowUpId = null;
  $("#followup-form").reset();
  $("#followup-source").value = sourceDate;
  followupDialog.showModal();
  requestAnimationFrame(() => $("#followup-description").focus());
}

function makeFollowUpId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `followup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function applyAiNoteText({ date, text }) {
  if (!canMutateData()) return false;
  const result = applyNoteChange(data, date, text, { capturePrevious: true });
  if (!result.changed) return true;
  data = result.data;
  const saved = await persistData();
  renderNotes();
  renderSummary();
  updateStorageUi();
  if (saved) showToast("AI result saved");
  return true;
}

function reopenAiTargetNote(date) {
  displayedStart = periodStartFor(date, displayedPeriod);
  requestSection("notes");
  renderAll();
  openNote(date);
}

function openAiFollowUpDraft({ description, dueDate, sourceDate }) {
  if (!canMutateData()) return;
  openFollowUpForm(sourceDate);
  $("#followup-description").value = description;
  $("#followup-due").value = dueDate || "";
  $("#followup-source").value = sourceDate || "";
}

const aiAssistant = mountWorkNotesAi(root, {
  config: options.aiConfig,
  applyNoteText: applyAiNoteText,
  reopenNote: reopenAiTargetNote,
  openFollowUpDraft: openAiFollowUpDraft,
  copyText,
  showToast,
});
if (!aiAvailable) {
  $("#ai-dictate-note").disabled = true;
  $("#ai-note-launcher-copy").textContent = "AI dictation is unavailable in this browser. Type your note below; manual notes work offline.";
}

function openAiFromNote(mode, button) {
  if (!editingDate || !canMutateData()) return;
  if (mode !== "dictation" && !noteTextarea.value.trim()) {
    showToast("Add some note text first.", true);
    noteTextarea.focus();
    return;
  }
  const nextContext = {
    date: editingDate,
    noteText: noteTextarea.value,
    selectionStart: noteTextarea.selectionStart,
    selectionEnd: noteTextarea.selectionEnd,
    returnToNote: true,
  };
  closeNote();
  requestAnimationFrame(() => aiAssistant.open(mode, nextContext, button));
}

document.addEventListener("click", async (event) => {
  const sectionButton = event.target.closest("[data-section-target]");
  if (sectionButton) {
    requestSection(sectionButton.dataset.sectionTarget);
    $(".section-tabs").scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }

  const noteButton = event.target.closest("[data-open-note]");
  if (noteButton) {
    openNote(noteButton.dataset.openNote);
    return;
  }

  const copyButton = event.target.closest("[data-copy-note]");
  if (copyButton) {
    if (!canMutateData()) return;
    const date = copyButton.dataset.copyNote;
    const text = data.notes[date]?.text.trim() ?? "";
    if (!text) return;
    const copied = await copyText(text);
    if (!copied) {
      showToast("Copy was blocked. Press and hold the note text to copy it.", true);
      return;
    }
    data = { ...data, copied: { ...data.copied, [date]: true } };
    const saved = await persistData();
    renderSummary();
    updateStorageUi();
    if (saved) showToast(`${formatShortDate(date)} copied`);
    return;
  }

  const moveButton = event.target.closest("[data-move-notebook]");
  if (moveButton) {
    openNotebookMove(moveButton.dataset.moveNotebook);
    return;
  }
  const statusButton = event.target.closest("[data-followup-status]");
  if (statusButton) {
    if (!canMutateData()) return;
    const now = new Date().toISOString();
    const nextStatus = statusButton.dataset.nextStatus;
    data = {
      ...data,
      followUps: data.followUps.map((item) =>
        item.id === statusButton.dataset.followupStatus
          ? {
              ...item,
              status: nextStatus,
              updatedAt: now,
              completedAt: nextStatus === "done" ? now : null,
            }
          : item,
      ),
    };
    const saved = await persistData();
    renderFollowUps();
    renderAttention();
    updateStorageUi();
    if (saved) {
      showToast(nextStatus === "done" ? "Moved to completed history" : "To-do reopened");
    }
    return;
  }

  const sourceButton = event.target.closest("[data-open-source]");
  if (sourceButton) {
    const sourceDate = sourceButton.dataset.openSource;
    displayedStart = periodStartFor(sourceDate, displayedPeriod);
    requestSection("notes");
    renderAll();
    openNote(sourceDate);
  }
});

$("#previous-period").addEventListener("click", () => {
  displayedStart = periodStartFor(addDays(displayedStart, -1), displayedPeriod);
  renderAll();
});

$("#next-period").addEventListener("click", () => {
  displayedStart = periodStartFor(addDays(periodEndFor(displayedStart, displayedPeriod), 1), displayedPeriod);
  renderAll();
});

$("#period-kind")?.addEventListener("change", (event) => {
  displayedPeriod = normalizePeriod(event.target.value);
  displayedStart = periodStartFor(today, displayedPeriod);
  renderAll();
});
root.querySelectorAll("[data-period-kind]").forEach((button) => button.addEventListener("click", () => {
  displayedPeriod = button.dataset.periodKind;
  displayedStart = periodStartFor(today, displayedPeriod);
  renderAll();
}));

$("#return-current").addEventListener("click", () => {
  displayedStart = periodStartFor(today, displayedPeriod);
  renderAll();
});

$("#open-today").addEventListener("click", () => {
  displayedStart = periodStartFor(today, displayedPeriod);
  requestSection("notes");
  renderAll();
  openNote(today);
});

$("#close-note").addEventListener("click", closeNote);
$("#jump-date-form").addEventListener("submit", event => {
  event.preventDefault();
  const input = $("#jump-note-date");
  const date = input.value;
  if (!isIsoDate(date) || !input.checkValidity()) { input.reportValidity(); return; }
  if (notesSavesInFlight || hasUnsavedDraft) {
    showToast("Save or recover your unfinished note before opening another date.", true);
    return;
  }
  displayedStart = periodStartFor(date, displayedPeriod);
  renderAll();
  openNote(date);
});
$("#done-note").addEventListener("click", closeNote);
$("#ai-dictate-note").addEventListener("click", (event) => {
  openAiFromNote("dictation", event.currentTarget);
});
$("#ai-organise-note").addEventListener("click", (event) => {
  openAiFromNote("organise", event.currentTarget);
});
$("#ai-create-followup-note").addEventListener("click", (event) => {
  openAiFromNote("followup", event.currentTarget);
});
$("#ai-summary-action").addEventListener("click", (event) => {
  if (displayedPeriod !== "fortnight") {
    showToast("AI summary is available for Fortnight view only.", true);
    return;
  }
  aiAssistant.open("summary", {
    returnToNote: false,
    ...buildAiFortnightContext(displayedStart, data.notes),
  }, event.currentTarget);
});

noteDialog.addEventListener("close", () => {
  editingDate = null;
  editSessionCaptured = false;
  renderNotes();
  renderSummary();
  updateStorageUi();
  const previous = noteReturnFocus;
  noteReturnFocus = null;
  if (previous) {
    const original = previous.element;
    const replacement = root.querySelector(`[data-section="${previous.section}"] [data-open-note="${previous.date}"]`);
    const target = original?.isConnected ? original : replacement;
    target?.focus({ preventScroll: true });
  }
});
noteDialog.addEventListener("cancel", event => { if (notesSavesInFlight) event.preventDefault(); });
followupDialog.addEventListener("cancel", event => { if (notesSavesInFlight) event.preventDefault(); });

noteTextarea.addEventListener("input", async () => {
  if (!editingDate) return;
  if (!canMutateData({ allowPending: true })) return;
  const result = applyNoteChange(data, editingDate, noteTextarea.value, {
    capturePrevious: !editSessionCaptured,
  });
  if (!result.changed) return;
  data = result.data;
  editSessionCaptured = true;
  const saved = await persistData();
  restorePreviousButton.disabled = !data.notes[editingDate]?.history?.length;
  if (saved) {
    pulseSaved(result.copiedCleared ? "Saved · Copy tick cleared" : "Saved on this device");
  }
  renderNotes();
  renderSummary();
  updateStorageUi();
});

restorePreviousButton.addEventListener("click", async () => {
  if (!editingDate) return;
  if (!canMutateData()) return;
  const previous = data.notes[editingDate]?.history?.at(-1);
  if (!previous) return;
  const confirmed = window.confirm(
    "Restore the previous saved version of this note? The current text will remain recoverable.",
  );
  if (!confirmed) return;
  const result = restorePreviousNote(data, editingDate);
  if (!result.restored) return;
  data = result.data;
  noteTextarea.value = result.text;
  editSessionCaptured = true;
  const saved = await persistData();
  restorePreviousButton.disabled = !data.notes[editingDate]?.history?.length;
  if (saved) pulseSaved("Previous version restored");
  renderNotes();
  renderSummary();
  updateStorageUi();
});

$("#followup-from-note").addEventListener("click", () => {
  if (!canMutateData()) return;
  const sourceDate = editingDate ?? "";
  closeNote();
  openFollowUpForm(sourceDate);
});

$("#add-followup").addEventListener("click", () => {
  if (canMutateData()) openFollowUpForm();
});

function closeFollowUp() {
  if (notesSavesInFlight) return;
  if (followupDialog.open) followupDialog.close();
}

$("#cancel-followup").addEventListener("click", closeFollowUp);
$("#cancel-followup-x").addEventListener("click", closeFollowUp);

$("#followup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!canMutateData()) return;
  const description = $("#followup-description").value.trim();
  if (!description) {
    $("#followup-description").focus();
    return;
  }
  const now = new Date().toISOString();
  pendingFollowUpId ||= makeFollowUpId();
  data = {
    ...data,
    followUps: [
      ...data.followUps.filter(item => item.id !== pendingFollowUpId),
      {
        id: pendingFollowUpId,
        description,
        dueDate: $("#followup-due").value || null,
        sourceDate: $("#followup-source").value || null,
        status: "open",
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      },
    ],
  };
  const saved = await persistData();
  if (saved) closeFollowUp();
  renderFollowUps();
  renderAttention();
  updateStorageUi();
  if (saved) showToast("To-do saved");
});

$("#export-text").addEventListener("click", () => {
  const exported = periodTextExport(data, displayedStart, displayedPeriod, propertySettings);
  downloadText(exported.filename, exported.text, "text/plain;charset=utf-8");
});

$("#share-work-notes").addEventListener("click", prepareWorkNotesCopies);
$("#share-work-notes-pdf").addEventListener("click", () => sharePendingWorkNotes("pdf"));
$("#share-work-notes-text").addEventListener("click", () => sharePendingWorkNotes("text"));
$("#download-work-notes-pdf").addEventListener("click", () => {
  if (!pendingWorkNotesDownloads) return;
  downloadBlob(pendingWorkNotesDownloads.pdfBlob, pendingWorkNotesDownloads.filenames.pdf);
});
$("#download-work-notes-text").addEventListener("click", () => {
  if (!pendingWorkNotesDownloads) return;
  downloadBlob(pendingWorkNotesDownloads.textBlob, pendingWorkNotesDownloads.filenames.text);
});
$("#close-work-notes-download-dialog").addEventListener("click", closeWorkNotesDownloadOptions);
$("#close-work-notes-download-dialog-x").addEventListener("click", closeWorkNotesDownloadOptions);
workNotesDownloadDialog.addEventListener("cancel", event => { if (fileActionInProgress) event.preventDefault(); });
workNotesDownloadDialog.addEventListener("close", () => {
  pendingWorkNotesDownloads = null;
});

$("#export-backup").addEventListener("click", () => {
  const exported = backupExport(data);
  downloadText(exported.filename, exported.text, "application/json;charset=utf-8");
});

$("#export-combined-backup").addEventListener("click", () => {
  if(options.onBackupRequest){options.onBackupRequest('backup');return;}
  if (storageLock || combinedDataHasUnsavedChanges()) {
    showToast(
      "Combined backup is unavailable while Spray, Weather, Settings, Servicing or Work Diary has unsaved changes. Use that section’s recovery controls first.",
      true,
    );
    return;
  }
  try {
    const exported = combinedBackupExport(getStorage(), new Date(), {
      channel: APP_CHANNEL,
      origin: globalThis.location?.origin,
      normalizeWorkNotes: normalizeBackup,
    });
    downloadText(exported.filename, exported.text, "application/json;charset=utf-8");
  } catch (error) {
    showToast(
      `Combined backup could not be created: ${error?.message || "stored data could not be read."}`,
      true,
    );
  }
});

$("#download-previous-state-recovery").addEventListener("click", () => {
  const recovery = refreshPreviousStateRecovery();
  if (!recovery) {
    showToast("No verified previous-state recovery is available to download.", true);
    return;
  }
  try {
    downloadText(recovery.filename, recovery.text, "application/json;charset=utf-8");
  } catch (error) {
    showToast(`Previous-state recovery could not be prepared: ${error?.message || "browser download support is unavailable."}`, true);
  }
});

$("#restore-combined-backup").addEventListener("click", () => {
  if (combinedDataHasUnsavedChanges()) {
    showToast("Resolve or download the unsaved recovery copy before restoring combined data.", true);
    return;
  }
  $("#combined-restore-file").click();
});

$("#combined-restore-file").addEventListener("change", async (event) => {
  const expectedRevision = getRevision();
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (combinedDataHasUnsavedChanges()) {
    showToast("Combined restore stopped because the app has unsaved changes.", true);
    return;
  }

  try {
    const prepared = prepareCombinedBackupRestore(await file.text(), {
      normalizeWorkNotes: normalizeBackup,
    });
    const hasPaddocks = Object.hasOwn(prepared.datasets, "paddocks");
    const hasPaddockLibrary = Object.hasOwn(prepared.datasets, "paddockLibrary");
    const hasWorkNotes = Object.hasOwn(prepared.datasets, "workNotes");
    const hasServicing = Object.hasOwn(prepared.datasets, "servicing4830");
    const paddockCount = prepared.datasets.paddocks?.paddocks?.length ?? 0;
    const libraryCount = prepared.datasets.paddockLibrary?.entries?.length ?? 0;
    const noteCount = Object.keys(prepared.datasets.workNotes?.notes ?? {}).length;
    const followUpCount = prepared.datasets.workNotes?.followUps?.length ?? 0;
    const servicingDraftCount = prepared.datasets.servicing4830?.drafts?.length ?? 0;
    const servicingRecordCount = (prepared.datasets.servicing4830?.recordSeries ?? [])
      .reduce((count, series) => count + (series.revisions?.length ?? 0), 0);
    const paddockSummary = hasPaddocks ? `${paddockCount} paddocks` : "current paddocks unchanged";
    const librarySummary = hasPaddockLibrary
      ? `${libraryCount} Paddock Library entries`
      : "current Paddock Library unchanged";
    const workNotesSummary = hasWorkNotes
      ? `${noteCount} Work Diary and ${followUpCount} to-do items`
      : "current Work Diary unchanged";
    const servicingSummary = hasServicing
      ? `${servicingDraftCount} servicing drafts and ${servicingRecordCount} finalised servicing revisions`
      : "current 4830 servicing records unchanged";
    const hasPropertySettings = Object.hasOwn(prepared.datasets, "propertySettings");
    const propertySettingsSummary = !hasPropertySettings
      ? "current farm identity, default Work Diary period and colour theme unchanged"
      : prepared.datasets.propertySettings === null
        ? "farm identity, default Work Diary period and colour theme reset to built-in defaults"
        : `farm identity “${prepared.datasets.propertySettings.businessName}”, default Work Diary period ${prepared.datasets.propertySettings.defaultPeriod}, and colour theme ${prepared.datasets.propertySettings.theme}`;
    const sourceWarnings = [];
    if (prepared.metadata?.channel && prepared.metadata.channel !== APP_CHANNEL) {
      sourceWarnings.push(
        `It was created in the “${prepared.metadata.channel}” app channel; this app is “${APP_CHANNEL}”.`,
      );
    }
    const currentOrigin = globalThis.location?.origin;
    if (
      prepared.metadata?.origin
      && currentOrigin
      && currentOrigin !== "null"
      && prepared.metadata.origin !== currentOrigin
    ) {
      sourceWarnings.push(`It was created at ${prepared.metadata.origin}, not ${currentOrigin}.`);
    }
    const sourceWarning = sourceWarnings.length
      ? `\n\nCheck the source before continuing: ${sourceWarnings.join(" ")}`
      : "";
    const skippedLegacyLabels = (prepared.skippedLegacyNullDatasets ?? []).map((name) => ({
      paddocks: "paddocks",
      workNotes: "Work Diary",
      profile: "operator profile",
      weatherSettings: "Weather settings",
      paddockLibrary: "Paddock Library",
      servicing4830: "4830 servicing records",
    })[name] || name);
    const skippedLegacyWarning = skippedLegacyLabels.length
      ? `\n\nThis older backup contains ambiguous empty data for ${skippedLegacyLabels.join(", ")}. Those datasets will be skipped and their current device records left unchanged.`
      : "";
    const confirmed = window.confirm(
      `Apply this older partial backup: ${paddockSummary}; ${librarySummary}; ${workNotesSummary}; ${servicingSummary}; ${propertySettingsSummary}? Operator profile and Weather settings are also replaced when included. A zero count clears that included section. Notebook, new equipment/service logs/checklists, spray preferences and appearance stay unchanged. A recovery copy of the complete current state will be retained. Original legacy keys are never changed.${skippedLegacyWarning}${sourceWarning}`,
    );
    if (!confirmed) return;

    if(combinedDataHasUnsavedChanges())throw new Error('Save unfinished edits before restoring.');
    const restoreResult = await transactStorage(storage => restoreCombinedBackup(prepared, storage, new Date()), {retainRecovery:true,expectedRevision});
    const recovery = refreshPreviousStateRecovery();
    showToast(
      recovery?.key === restoreResult.recoveryKey
        ? "Combined backup restored. Previous-state recovery saved. Reloading the app…"
        : "Combined backup restored. Reloading the app…",
    );
    window.setTimeout(() => window.location.reload(), 650);
  } catch (error) {
    if (error?.recoveryKey) refreshPreviousStateRecovery();
    showToast(`Combined backup was not restored: ${error?.message || "the file is not valid."}`, true);
  }
});

$("#choose-restore").addEventListener("click", () => $("#restore-file").click());
$("#storage-restore").addEventListener("click", () => $("#restore-file").click());

$("#storage-download-original").addEventListener("click", () => {
  if (typeof storageLock?.raw !== "string") return;
  const isJson = storageLock.state === "future";
  const extension = isJson ? "json" : "txt";
  downloadText(
    `pallathorpe-work-notes-original-${storageLock.state}_${today}.${extension}`,
    storageLock.raw,
    isJson ? "application/json;charset=utf-8" : "text/plain;charset=utf-8",
  );
});

$("#storage-download-draft").addEventListener("click", () => {
  const exported = backupExport(data);
  downloadText(exported.filename, exported.text, "application/json;charset=utf-8");
});

$("#storage-retry").addEventListener("click", async () => {
  const saved = await persistData({ replaceLocked: pendingLockedRestore });
  if (!saved) return;
  renderAll();
  if (noteDialog.open) pulseSaved("Saved on this device");
  showToast("Draft saved on this device");
});

$("#restore-file").addEventListener("change", async (event) => {
  const expectedRevision = getRevision();
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    if(combinedDataHasUnsavedChanges())throw new Error('Save unfinished edits before restoring.');
    const parsed = JSON.parse(await file.text());
    const restored = normalizeBackup(parsed);
    const confirmed = window.confirm(
      `Restore ${Object.keys(restored.notes).length} notes, ${Object.keys(restored.copied).length} copied ticks, and ${restored.followUps.length} to-do items? This replaces Work Diary and To-do only. Other sections stay unchanged. A recovery copy of the complete current state will be retained.`,
    );
    if (!confirmed) return;
    if(combinedDataHasUnsavedChanges())throw new Error('Save unfinished edits before restoring.');
    await transactStorage(storage=>{persistStoredData(storage,restored);storage.setItem(`${DURABLE_PREFIX}:restore-epoch`,`${new Date().toISOString()}:${crypto.randomUUID()}`);},{retainRecovery:true,expectedRevision});
    showToast('Work Diary restored. Reopening saved records…');
    window.location.reload();
  } catch (error) {
    showToast(`That backup is not valid: ${error.message}`, true);
  }
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  $("#install-button").hidden = false;
});

$("#install-button").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $("#install-button").hidden = true;
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  $("#install-button").hidden = true;
  showToast("Work Diary installed");
});

renderAll();
activateSection(activeSection);
host.activate = () => renderAll();
function openCombinedBackup(action = "backup") {
  activateSection("followups");
  const panel = $("#combined-backup-panel");
  const target = action === "restore" ? $("#restore-combined-backup") : $("#export-combined-backup");
  panel?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  if (target && !target.disabled) target.click();
  else panel?.focus?.();
}

return { renderAll, activateSection, refreshPropertySettings, openCombinedBackup,
  hasUnsavedChanges: () => hasUnsavedDraft || notesSavesInFlight > 0 || notebookMoveBusy || Boolean(notebookMoveTask) || followupDialog.open };
}



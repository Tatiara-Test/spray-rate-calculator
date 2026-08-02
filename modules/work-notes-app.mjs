import {
  STORAGE_KEY,
  addDays,
  applyNoteChange,
  backupExport,
  classifyFollowUp,
  fortnightStartFor,
  fortnightTextExport,
  formatLongDate,
  formatShortDate,
  getFortnightDates,
  loadStoredData,
  normalizeBackup,
  restorePreviousNote,
  sortOpenFollowUps,
  todayIso,
} from "./work-notes-logic.mjs";
import { combinedBackupExport } from "./storage.mjs";
import { WORK_NOTES_TEMPLATE } from "./work-notes-template.mjs";

export function mountWorkNotesApp(host) {
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
const noteDialog = $("#note-dialog");
const followupDialog = $("#followup-dialog");
const noteTextarea = $("#note-text");
const restorePreviousButton = $("#restore-previous");
const saveIndicator = $("#save-indicator");
const today = todayIso();
const currentFortnightStart = fortnightStartFor(today);

let displayedStart = currentFortnightStart;
let activeSection = "notes";
let editingDate = null;
let editSessionCaptured = false;
let savePulseTimer = null;
let toastTimer = null;
let deferredInstallPrompt = null;

function readLocalData() {
  try {
    return loadStoredData(localStorage.getItem(STORAGE_KEY));
  } catch {
    return loadStoredData(null);
  }
}

let data = readLocalData();

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

function persistData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    showToast("This browser could not save the change. Export a backup before closing.", true);
    return false;
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
  const end = addDays(displayedStart, 13);
  $("#period-label").textContent = rangeLabel(displayedStart, end);
  const isCurrent = displayedStart === currentFortnightStart;
  const direction = displayedStart < currentFortnightStart ? "Earlier fortnight" : "Future fortnight";
  $("#period-kicker").textContent = isCurrent ? "Current fortnight" : direction;
  $("#return-current").hidden = isCurrent;
}

function renderNotes() {
  const dates = getFortnightDates(displayedStart);
  const weeks = [dates.slice(0, 7), dates.slice(7, 14)];
  $("#notes-weeks").innerHTML = weeks
    .map((week, weekIndex) => {
      const cards = week
        .map((date) => {
          const text = data.notes[date]?.text.trim() ?? "";
          const hasNote = Boolean(text);
          const isToday = date === today;
          const stateText = isToday
            ? hasNote
              ? "Today · Note saved"
              : "Today · Missing"
            : hasNote
              ? "Note saved"
              : "Missing note";
          const preview = hasNote
            ? text.replace(/\s+/g, " ")
            : isToday
              ? "Tap to record today’s work"
              : "Tap to add work details";
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
  $("#summary-list").innerHTML = getFortnightDates(displayedStart)
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
          <button
            class="copy-button${copied ? " copied" : ""}${text ? "" : " no-note"}"
            type="button"
            data-copy-note="${date}"
            ${text ? "" : "disabled"}
          >${buttonLabel}</button>
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
  const completedItems = data.followUps
    .filter((item) => item.status === "done")
    .slice()
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));

  $("#open-followups").innerHTML = openItems.length
    ? `<div class="followup-list">${openItems.map((item) => followUpCard(item)).join("")}</div>`
    : `
      <div class="empty-state">
        <strong>No open follow-ups</strong>
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
    urgentItems.length === 1 ? "1 follow-up needs attention" : `${urgentItems.length} follow-ups need attention`;
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
  editingDate = date;
  editSessionCaptured = false;
  const note = data.notes[date] ?? { text: "", history: [] };
  $("#note-dialog-kicker").textContent = date === today ? "Today’s note" : "Daily note";
  $("#note-dialog-title").textContent = formatLongDate(date);
  noteTextarea.value = note.text;
  restorePreviousButton.disabled = !note.history?.length;
  saveIndicator.textContent = note.updatedAt ? "Saved on this device" : "Not written yet";
  saveIndicator.classList.remove("fresh");
  noteDialog.showModal();
  requestAnimationFrame(() => {
    noteTextarea.focus();
    const end = noteTextarea.value.length;
    noteTextarea.setSelectionRange(end, end);
  });
}

function closeNote() {
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

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function openFollowUpForm(sourceDate = "") {
  $("#followup-form").reset();
  $("#followup-source").value = sourceDate;
  followupDialog.showModal();
  requestAnimationFrame(() => $("#followup-description").focus());
}

function makeFollowUpId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `followup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
    const date = copyButton.dataset.copyNote;
    const text = data.notes[date]?.text.trim() ?? "";
    if (!text) return;
    const copied = await copyText(text);
    if (!copied) {
      showToast("Copy was blocked. Press and hold the note text to copy it.", true);
      return;
    }
    data = { ...data, copied: { ...data.copied, [date]: true } };
    persistData();
    renderSummary();
    showToast(`${formatShortDate(date)} copied`);
    return;
  }

  const statusButton = event.target.closest("[data-followup-status]");
  if (statusButton) {
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
    persistData();
    renderFollowUps();
    renderAttention();
    showToast(nextStatus === "done" ? "Moved to completed history" : "Follow-up reopened");
    return;
  }

  const sourceButton = event.target.closest("[data-open-source]");
  if (sourceButton) {
    const sourceDate = sourceButton.dataset.openSource;
    displayedStart = fortnightStartFor(sourceDate);
    requestSection("notes");
    renderAll();
    openNote(sourceDate);
  }
});

$("#previous-period").addEventListener("click", () => {
  displayedStart = addDays(displayedStart, -14);
  renderAll();
});

$("#next-period").addEventListener("click", () => {
  displayedStart = addDays(displayedStart, 14);
  renderAll();
});

$("#return-current").addEventListener("click", () => {
  displayedStart = currentFortnightStart;
  renderAll();
});

$("#open-today").addEventListener("click", () => {
  displayedStart = currentFortnightStart;
  requestSection("notes");
  renderAll();
  openNote(today);
});

$("#close-note").addEventListener("click", closeNote);
$("#done-note").addEventListener("click", closeNote);

noteDialog.addEventListener("close", () => {
  editingDate = null;
  editSessionCaptured = false;
  renderNotes();
  renderSummary();
});

noteTextarea.addEventListener("input", () => {
  if (!editingDate) return;
  const result = applyNoteChange(data, editingDate, noteTextarea.value, {
    capturePrevious: !editSessionCaptured,
  });
  if (!result.changed) return;
  data = result.data;
  editSessionCaptured = true;
  persistData();
  restorePreviousButton.disabled = !data.notes[editingDate]?.history?.length;
  pulseSaved(result.copiedCleared ? "Saved · Copy tick cleared" : "Saved on this device");
  renderNotes();
  renderSummary();
});

restorePreviousButton.addEventListener("click", () => {
  if (!editingDate) return;
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
  persistData();
  restorePreviousButton.disabled = !data.notes[editingDate]?.history?.length;
  pulseSaved("Previous version restored");
  renderNotes();
  renderSummary();
});

$("#followup-from-note").addEventListener("click", () => {
  const sourceDate = editingDate ?? "";
  closeNote();
  openFollowUpForm(sourceDate);
});

$("#add-followup").addEventListener("click", () => openFollowUpForm());

function closeFollowUp() {
  if (followupDialog.open) followupDialog.close();
}

$("#cancel-followup").addEventListener("click", closeFollowUp);
$("#cancel-followup-x").addEventListener("click", closeFollowUp);

$("#followup-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const description = $("#followup-description").value.trim();
  if (!description) {
    $("#followup-description").focus();
    return;
  }
  const now = new Date().toISOString();
  data = {
    ...data,
    followUps: [
      ...data.followUps,
      {
        id: makeFollowUpId(),
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
  persistData();
  closeFollowUp();
  renderFollowUps();
  renderAttention();
  showToast("Follow-up saved");
});

$("#export-text").addEventListener("click", () => {
  const exported = fortnightTextExport(data, displayedStart);
  downloadText(exported.filename, exported.text, "text/plain;charset=utf-8");
  showToast("Fortnight text exported");
});

$("#export-backup").addEventListener("click", () => {
  const exported = backupExport(data);
  downloadText(exported.filename, exported.text, "application/json;charset=utf-8");
  showToast("Complete backup downloaded");
});

$("#export-combined-backup").addEventListener("click", () => {
  const exported = combinedBackupExport();
  downloadText(exported.filename, exported.text, "application/json;charset=utf-8");
  showToast("Combined backup downloaded");
});

$("#choose-restore").addEventListener("click", () => $("#restore-file").click());

$("#restore-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const restored = normalizeBackup(parsed);
    const confirmed = window.confirm(
      `Restore ${Object.keys(restored.notes).length} notes, ${Object.keys(restored.copied).length} copied ticks, and ${restored.followUps.length} follow-ups? This replaces the records currently on this device.`,
    );
    if (!confirmed) return;
    data = restored;
    persistData();
    displayedStart = currentFortnightStart;
    renderAll();
    showToast("Backup restored");
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
  showToast("Work Notes installed");
});

renderAll();
activateSection(activeSection);
host.activate = () => renderAll();
return { renderAll, activateSection };
}

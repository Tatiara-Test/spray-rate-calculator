import { handFilesToShareSheet } from "../share-files.mjs";
import {
  buildServicingPdf,
  servicingExportDescriptor,
} from "./servicing-export.mjs";
import {
  servicingIntervalLabel,
  servicingOutcomeLabel,
  servicingTaskStateLabel,
} from "./servicing-layout-4830.mjs";
import {
  SERVICING_READY_TEMPLATE,
  SERVICING_TEMPLATE,
} from "./servicing-template.mjs";

export const SERVICING_WRITES_CAPABILITY = "servicingWritesEnabled";

export const SERVICING_COMMANDS = Object.freeze({
  createDraft: "create-draft",
  updateDraftDetails: "update-draft-details",
  setSelectedIntervals: "set-selected-intervals",
  updateTaskResult: "update-task-result",
  finaliseDraft: "finalise-draft",
  beginAmendment: "begin-amendment",
});

export function servicingAdapterReadiness(adapter) {
  if (adapter?.capabilities?.[SERVICING_WRITES_CAPABILITY] !== true) {
    return { ready: false, reason: "writes-disabled" };
  }
  if (typeof adapter.getState !== "function" || typeof adapter.dispatch !== "function") {
    return { ready: false, reason: "interface-incomplete" };
  }
  return { ready: true, reason: "ready" };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function text(value) {
  return String(value ?? "").trim();
}

function displayDate(value) {
  const source = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source)) return "Not entered";
  const date = new Date(`${source}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? source
    : new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function taskResult(draft, task) {
  return draft?.taskResults?.[task.id] ?? task.result ?? { state: "not_started" };
}

function selectedIntervalLabels(draft) {
  const ids = Array.isArray(draft?.selectedIntervalIds) ? draft.selectedIntervalIds : [];
  return ids.map((id) => servicingIntervalLabel(id));
}

function makePdfFile(pdfBlob, filename, FileCtor) {
  if (typeof FileCtor !== "function") return [];
  return [new FileCtor([pdfBlob], filename, { type: "application/pdf" })];
}

export async function shareServicingRecord({
  record,
  navigatorLike = globalThis.navigator,
  FileCtor = globalThis.File,
  generatedAt = new Date().toISOString(),
  buildPdf = buildServicingPdf,
} = {}) {
  const descriptor = servicingExportDescriptor(record, generatedAt);
  const bytes = await buildPdf(record, descriptor);
  const pdfBlob = new Blob([bytes], { type: "application/pdf" });
  const files = makePdfFile(pdfBlob, descriptor.filename, FileCtor);
  const shareResult = await handFilesToShareSheet({
    navigatorLike,
    files,
    title: descriptor.title,
    text: `4830 service record for ${descriptor.serviceDate}, revision ${descriptor.revision}.`,
  });
  if (shareResult.mode === "shared") return { mode: "shared", descriptor };
  if (shareResult.mode === "cancelled") return { mode: "cancelled", descriptor };
  return {
    mode: "download",
    reason: shareResult.reason,
    descriptor,
    pdfBlob,
  };
}

export function mountServicingApp(host, options = {}) {
  const root = host.shadowRoot || host.attachShadow({ mode: "open" });
  root.innerHTML = SERVICING_TEMPLATE;
  const preparation = root.querySelector("#servicing-preparation");
  const preparationTitle = root.querySelector("#servicing-preparation-title");
  const preparationCopy = root.querySelector("#servicing-preparation-copy");
  const content = root.querySelector("#servicing-content");
  let adapter = options.adapter ?? null;
  let state = null;
  let currentView = "overview";
  let readyUiBound = false;
  let unsubscribe = null;
  let pendingDownload = null;
  let amendmentRecordId = null;
  let toastTimer = null;

  const $ = (selector) => root.querySelector(selector);
  const $$ = (selector) => [...root.querySelectorAll(selector)];

  function showPreparation(reason = "writes-disabled") {
    state = null;
    content.replaceChildren();
    readyUiBound = false;
    preparation.hidden = false;
    if (reason === "interface-incomplete") {
      preparationTitle.textContent = "Servicing core is not compatible";
      preparationCopy.textContent = "The app reported servicing writes enabled, but the required read and command interface is incomplete. No service draft has been created or changed.";
    } else if (reason === "state-unavailable") {
      preparationTitle.textContent = "Servicing records could not be opened safely";
      preparationCopy.textContent = "The compatible servicing core did not return a readable state. Record controls remain off and no service draft has been created or changed.";
    } else {
      preparationTitle.textContent = "Servicing records are not enabled yet";
      preparationCopy.textContent = "The mobile interface is prepared, but record writing remains off until the compatible servicing core reports that writes are enabled. No service draft has been created or changed.";
    }
  }

  function showToast(message, isError = false) {
    const toast = $("#servicing-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle("error", isError);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3600);
  }

  function setView(view) {
    const allowed = new Set(["overview", "editor", "review", "history"]);
    currentView = allowed.has(view) ? view : "overview";
    $$("[data-servicing-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.servicingPanel !== currentView;
    });
    $$(".servicing-view-nav [data-servicing-view]").forEach((button) => {
      if (button.dataset.servicingView === currentView) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    root.querySelector(`[data-servicing-panel="${currentView}"] h2`)?.focus?.({ preventScroll: true });
  }

  function intervalOptionMarkup(option, selectedIds) {
    const id = text(option?.id);
    if (!id) return "";
    const label = text(option.label) || servicingIntervalLabel(id, { initialBreakIn: option.initialBreakIn === true });
    return `<label class="interval-option"><input type="checkbox" value="${escapeHtml(id)}" ${selectedIds.has(id) ? "checked" : ""} /><span><strong>${escapeHtml(label)}</strong>${text(option.description) ? `<small>${escapeHtml(option.description)}</small>` : ""}</span></label>`;
  }

  function taskMarkup(draft, task, index) {
    const id = text(task?.id);
    if (!id || !text(task?.label)) return "";
    const result = taskResult(draft, task);
    const stateValue = text(result.state) || "not_started";
    const needsReason = ["not_applicable", "deferred"].includes(stateValue);
    const followUp = result.followUpRequired === true;
    const intervals = Array.isArray(task.intervals)
      ? task.intervals.map((interval) => servicingIntervalLabel(interval, { initialBreakIn: task.initialBreakIn === true })).join(" / ")
      : "Interval supplied by servicing core";
    const section = task.section === "boom" ? "Boom" : "Machine";
    const sourceNotes = Array.isArray(task.sourceNotes)
      ? task.sourceNotes.map(({ text: note }) => text(note)).filter(Boolean)
      : [];
    return `
      <article class="task-card" data-task-id="${escapeHtml(id)}">
        <header><span class="task-number">${index + 1}</span><div><div class="task-kickers"><b>${escapeHtml(section)}</b><small>${escapeHtml(intervals)}</small></div><h4>${escapeHtml(task.label)}</h4>${sourceNotes.map((note) => `<p class="task-source-note"><strong>Source note:</strong> ${escapeHtml(note)}</p>`).join("")}</div></header>
        <div class="task-fields">
          <label><span>Task state</span><select data-task-field="state" aria-label="State for ${escapeHtml(task.label)}">
            ${["not_started", "done", "not_applicable", "deferred"].map((value) => `<option value="${value}" ${stateValue === value ? "selected" : ""}>${servicingTaskStateLabel(value)}</option>`).join("")}
          </select></label>
          <label class="task-reason" ${needsReason ? "" : "hidden"}><span>${stateValue === "deferred" ? "Deferral reason" : "Not applicable reason"}</span><textarea data-task-field="reason" rows="2" maxlength="1000" ${needsReason ? "required" : ""}>${escapeHtml(result.reason)}</textarea></label>
          <label><span>Task note <small>optional</small></span><textarea data-task-field="note" rows="2" maxlength="2000">${escapeHtml(result.note)}</textarea></label>
          <label class="follow-up-toggle"><input data-task-field="followUpRequired" type="checkbox" ${followUp ? "checked" : ""} /><span>To-do required</span></label>
          <label class="follow-up-note" ${followUp ? "" : "hidden"}><span>To-do note</span><textarea data-task-field="followUpNote" rows="2" maxlength="1000" ${followUp ? "required" : ""}>${escapeHtml(result.followUpNote)}</textarea></label>
        </div>
      </article>`;
  }

  function historyMarkup(record) {
    const recordId = text(record?.recordId);
    if (!recordId) return "";
    const revision = Number(record.revision) || 1;
    const hours = Number.isFinite(Number(record.engineHours)) ? `${record.engineHours} h` : "Hours not recorded";
    const outcome = servicingOutcomeLabel(record);
    return `
      <article class="history-card">
        <div class="history-card-heading"><div><p class="eyebrow">${escapeHtml(displayDate(record.serviceDate))}</p><h3>${escapeHtml(hours)} · Revision ${revision}</h3></div><span class="locked-chip">Locked</span></div>
        <p class="history-outcome">${escapeHtml(outcome)}</p>
        <dl class="record-facts"><div><dt>Operator</dt><dd>${escapeHtml(record.operator || "Not recorded")}</dd></div><div><dt>Finalised</dt><dd>${escapeHtml(text(record.finalisedAt) || "Not recorded")}</dd></div></dl>
        <div class="history-actions"><button class="secondary-button" type="button" data-share-record="${escapeHtml(recordId)}">Share / Save PDF</button><button class="quiet-button" type="button" data-amend-record="${escapeHtml(recordId)}">Create amendment</button></div>
      </article>`;
  }

  function renderReview(draft) {
    const finalisation = draft?.finalisation && typeof draft.finalisation === "object"
      ? draft.finalisation
      : { canFinalise: false, issues: ["The servicing core has not approved finalisation."] };
    const canFinalise = finalisation.canFinalise === true;
    const issues = Array.isArray(finalisation.issues) ? finalisation.issues : [];
    const prospectiveOutcome = finalisation.outcome;
    $("#review-outcome").textContent = canFinalise
      ? (prospectiveOutcome === "outstanding_items"
        ? "Draft - ready to finalise with outstanding items"
        : "Draft - ready to finalise")
      : "Draft - not finalised";
    $("#review-outcome-chip").textContent = canFinalise ? "Ready to finalise" : "Needs attention";
    $("#review-outcome-copy").textContent = prospectiveOutcome === "outstanding_items"
      ? "Resolved exceptions will be retained as outstanding items; this record will not be labelled complete."
      : "Only the exact tasks supplied for the manually selected intervals are included.";
    $("#review-blockers").innerHTML = issues.map((issue) => `<li>${escapeHtml(typeof issue === "string" ? issue : issue?.message)}</li>`).join("");
    $("#review-blockers").hidden = issues.length === 0;
    $("#review-no-blockers").hidden = issues.length !== 0;
    $("#finalise-servicing-draft").disabled = !canFinalise;
  }

  function renderState() {
    const draft = state?.draft ?? null;
    const history = Array.isArray(state?.history) ? state.history : [];
    const intervalOptions = Array.isArray(state?.intervalOptions) ? state.intervalOptions : [];
    $("#history-count").textContent = String(history.length);
    $("#servicing-draft-card").hidden = !draft;
    $("#servicing-empty-card").hidden = Boolean(draft);
    $("#no-servicing-draft").hidden = Boolean(draft);
    $("#servicing-draft-form").hidden = !draft;

    if (draft) {
      const saveState = text(draft.saveState) || "Saved on this device";
      $("#servicing-draft-save-state").textContent = saveState;
      $("#servicing-save-state").textContent = saveState;
      $("#draft-card-date").textContent = displayDate(draft.serviceDate);
      $("#draft-card-hours").textContent = Number.isFinite(Number(draft.engineHours)) ? `${draft.engineHours} h` : "Not entered";
      const intervalLabels = selectedIntervalLabels(draft);
      $("#draft-card-intervals").textContent = intervalLabels.join(", ") || "None selected";
      $("#service-date").value = text(draft.serviceDate);
      $("#engine-hours").value = Number.isFinite(Number(draft.engineHours)) ? String(draft.engineHours) : "";
      $("#service-operator").value = text(draft.operator);
      $("#overall-notes").value = text(draft.overallNotes);
      const selectedIds = new Set(Array.isArray(draft.selectedIntervalIds) ? draft.selectedIntervalIds : []);
      $("#servicing-intervals").innerHTML = intervalOptions.map((option) => intervalOptionMarkup(option, selectedIds)).join("");
      const tasks = Array.isArray(draft.taskSnapshots) ? draft.taskSnapshots : [];
      $("#servicing-task-list").innerHTML = tasks.map((task, index) => taskMarkup(draft, task, index)).join("");
      $("#servicing-task-empty").hidden = tasks.length !== 0;
      $("#servicing-task-count").textContent = tasks.length
        ? `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} for the selected intervals.`
        : "Select one or more intervals to show their tasks.";
      renderReview(draft);
    }

    $("#servicing-history-list").innerHTML = history.map(historyMarkup).join("");
    $("#servicing-history-empty").hidden = history.length !== 0;
    if (currentView === "review" && !draft) currentView = "overview";
    setView(currentView);
  }

  async function refresh() {
    const readiness = servicingAdapterReadiness(adapter);
    if (!readiness.ready) {
      showPreparation(readiness.reason);
      return false;
    }
    try {
      const nextState = await Promise.resolve(adapter.getState());
      if (!nextState || typeof nextState !== "object" || Array.isArray(nextState)) {
        throw new TypeError("Servicing state is unavailable.");
      }
      if (!servicingAdapterReadiness(adapter).ready) {
        showPreparation("writes-disabled");
        return false;
      }
      state = nextState;
      if (!readyUiBound) initialiseReadyUi();
      preparation.hidden = true;
      renderState();
      return true;
    } catch {
      showPreparation("state-unavailable");
      return false;
    }
  }

  async function dispatchCommand(command, errorTarget = "#servicing-form-error") {
    const readiness = servicingAdapterReadiness(adapter);
    if (!readiness.ready) {
      showPreparation(readiness.reason);
      return false;
    }
    const errorElement = $(errorTarget);
    if (errorElement) errorElement.hidden = true;
    try {
      await Promise.resolve(adapter.dispatch(Object.freeze(command)));
      return await refresh();
    } catch (error) {
      if (error?.code === "LOWER_ENGINE_HOURS_CONFIRMATION_REQUIRED"
        && typeof globalThis.confirm === "function"
        && globalThis.confirm(`${error.message}\n\nSave the entered reading anyway?`)) {
        try {
          await Promise.resolve(adapter.dispatch(Object.freeze({ ...command, confirmLowerEngineHours: true })));
          return await refresh();
        } catch (confirmedError) {
          error = confirmedError;
        }
      }
      if (errorElement) {
        errorElement.textContent = error?.message || "The servicing change could not be saved.";
        errorElement.hidden = false;
      } else showToast(error?.message || "The servicing change could not be saved.", true);
      return false;
    }
  }

  function draftDetailsFromForm() {
    const hoursSource = $("#engine-hours").value;
    return {
      serviceDate: $("#service-date").value,
      engineHours: hoursSource === "" ? null : Number(hoursSource),
      operator: $("#service-operator").value,
      overallNotes: $("#overall-notes").value,
    };
  }

  function taskPatchFromCard(card) {
    return {
      state: card.querySelector('[data-task-field="state"]').value,
      reason: card.querySelector('[data-task-field="reason"]').value,
      note: card.querySelector('[data-task-field="note"]').value,
      followUpRequired: card.querySelector('[data-task-field="followUpRequired"]').checked,
      followUpNote: card.querySelector('[data-task-field="followUpNote"]').value,
    };
  }

  async function saveTaskCard(card) {
    syncTaskCardControls(card);
    const patch = taskPatchFromCard(card);
    if (["not_applicable", "deferred"].includes(patch.state) && !patch.reason.trim()) {
      showToast("Enter the task reason to save this exception.", true);
      card.querySelector('[data-task-field="reason"]').focus();
      return false;
    }
    if (patch.followUpRequired && !patch.followUpNote.trim()) {
      showToast("Enter the to-do note to save this task.", true);
      card.querySelector('[data-task-field="followUpNote"]').focus();
      return false;
    }
    return dispatchCommand({
      type: SERVICING_COMMANDS.updateTaskResult,
      taskId: card.dataset.taskId,
      patch,
    });
  }

  function syncTaskCardControls(card) {
    const stateInput = card.querySelector('[data-task-field="state"]');
    const reasonLabel = card.querySelector(".task-reason");
    const reasonInput = card.querySelector('[data-task-field="reason"]');
    const followUpInput = card.querySelector('[data-task-field="followUpRequired"]');
    const followUpLabel = card.querySelector(".follow-up-note");
    const followUpNote = card.querySelector('[data-task-field="followUpNote"]');
    const needsReason = ["not_applicable", "deferred"].includes(stateInput.value);
    reasonLabel.hidden = !needsReason;
    reasonInput.required = needsReason;
    reasonLabel.querySelector("span").textContent = stateInput.value === "deferred" ? "Deferral reason" : "Not applicable reason";
    if (!needsReason) reasonInput.value = "";
    followUpLabel.hidden = !followUpInput.checked;
    followUpNote.required = followUpInput.checked;
    if (!followUpInput.checked) followUpNote.value = "";
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = globalThis.document.createElement("a");
    link.href = url;
    link.download = filename;
    globalThis.document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function closeAmendDialog() {
    const dialog = $("#servicing-amend-dialog");
    if (dialog?.open) dialog.close();
    amendmentRecordId = null;
    $("#servicing-amend-form")?.reset();
  }

  function closeDownloadDialog() {
    const dialog = $("#servicing-download-dialog");
    if (dialog?.open) dialog.close();
    pendingDownload = null;
  }

  async function shareHistoryRecord(recordId) {
    const record = (Array.isArray(state?.history) ? state.history : []).find((candidate) => candidate.recordId === recordId);
    if (!record) {
      showToast("That service record is no longer available.", true);
      return;
    }
    try {
      const result = await shareServicingRecord({
        record,
        navigatorLike: options.navigatorLike ?? globalThis.navigator,
        FileCtor: options.FileCtor ?? globalThis.File,
        generatedAt: options.now?.().toISOString?.() ?? new Date().toISOString(),
      });
      if (result.mode === "shared") {
        showToast("PDF handed to your phone for sharing.");
        return;
      }
      if (result.mode === "cancelled") return;
      pendingDownload = result;
      $("#servicing-download-message").textContent = result.reason === "share-failed"
        ? "Native sharing did not finish. The offline PDF is ready to download instead."
        : "Native file sharing is unavailable on this device. The offline PDF is ready to download.";
      $("#servicing-download-dialog").showModal();
    } catch (error) {
      showToast(error?.message || "The service-record PDF could not be prepared.", true);
    }
  }

  function initialiseReadyUi() {
    content.innerHTML = SERVICING_READY_TEMPLATE;
    readyUiBound = true;
    $$("[data-servicing-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.servicingView)));
    $("#new-servicing-draft").addEventListener("click", async () => {
      if (await dispatchCommand({ type: SERVICING_COMMANDS.createDraft, machine: "4830" })) setView("editor");
    });
    $("#resume-servicing-draft").addEventListener("click", () => setView("editor"));
    $("#pause-servicing-draft").addEventListener("click", () => setView("overview"));
    $("#back-to-servicing-draft").addEventListener("click", () => setView("editor"));

    $("#servicing-draft-form").addEventListener("change", async (event) => {
      if (event.target.name === "serviceDate") {
        await dispatchCommand({ type: SERVICING_COMMANDS.updateDraftDetails, patch: draftDetailsFromForm() });
      }
    });
    $("#servicing-draft-form").addEventListener("focusout", async (event) => {
      if (!["engineHours", "operator", "overallNotes"].includes(event.target.name)) return;
      await dispatchCommand({ type: SERVICING_COMMANDS.updateDraftDetails, patch: draftDetailsFromForm() });
    });
    $("#servicing-intervals").addEventListener("change", async () => {
      const intervalIds = $$("#servicing-intervals input:checked").map((input) => input.value);
      const saved = await dispatchCommand({ type: SERVICING_COMMANDS.setSelectedIntervals, intervalIds });
      if (!saved) await refresh();
    });
    $("#servicing-task-list").addEventListener("change", async (event) => {
      const card = event.target.closest("[data-task-id]");
      if (!card) return;
      if (event.target.matches("textarea[data-task-field]")) return;
      await saveTaskCard(card);
    });
    $("#servicing-task-list").addEventListener("focusout", async (event) => {
      if (!event.target.matches("textarea[data-task-field]")) return;
      const card = event.target.closest("[data-task-id]");
      if (!card) return;
      await saveTaskCard(card);
    });
    $("#servicing-draft-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const saved = await dispatchCommand({ type: SERVICING_COMMANDS.updateDraftDetails, patch: draftDetailsFromForm() });
      if (saved) setView("review");
    });
    $("#finalise-servicing-draft").addEventListener("click", async () => {
      if (await dispatchCommand({ type: SERVICING_COMMANDS.finaliseDraft }, "#servicing-review-error")) {
        setView("overview");
        showToast("Service record finalised and locked in this app.");
      }
    });

    $("#servicing-history-list").addEventListener("click", (event) => {
      const shareButton = event.target.closest("[data-share-record]");
      if (shareButton) {
        void shareHistoryRecord(shareButton.dataset.shareRecord);
        return;
      }
      const amendButton = event.target.closest("[data-amend-record]");
      if (!amendButton) return;
      amendmentRecordId = amendButton.dataset.amendRecord;
      $("#servicing-amend-error").hidden = true;
      $("#servicing-amend-dialog").showModal();
      $("#servicing-amend-reason").focus();
    });
    $("#servicing-amend-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const reason = $("#servicing-amend-reason").value.trim();
      if (!reason) {
        $("#servicing-amend-error").textContent = "Enter an amendment reason.";
        $("#servicing-amend-error").hidden = false;
        return;
      }
      const recordId = amendmentRecordId;
      if (await dispatchCommand({ type: SERVICING_COMMANDS.beginAmendment, recordId, reason }, "#servicing-amend-error")) {
        closeAmendDialog();
        setView("editor");
      }
    });
    $("#close-servicing-amend").addEventListener("click", closeAmendDialog);
    $("#cancel-servicing-amend").addEventListener("click", closeAmendDialog);
    $("#close-servicing-download-x").addEventListener("click", closeDownloadDialog);
    $("#close-servicing-download").addEventListener("click", closeDownloadDialog);
    $("#download-servicing-pdf").addEventListener("click", () => {
      if (!pendingDownload) return;
      downloadBlob(pendingDownload.pdfBlob, pendingDownload.descriptor.filename);
    });
  }

  function subscribeToAdapter() {
    unsubscribe?.();
    unsubscribe = null;
    if (typeof adapter?.subscribe !== "function") return;
    try {
      const stop = adapter.subscribe(() => { void refresh(); });
      if (typeof stop === "function") unsubscribe = stop;
    } catch {
      // Refresh remains available even if optional change notifications fail.
    }
  }

  function setAdapter(nextAdapter) {
    adapter = nextAdapter ?? null;
    subscribeToAdapter();
    return refresh();
  }

  subscribeToAdapter();
  void refresh();
  return {
    refresh,
    setAdapter,
    hasUnsavedChanges: () => servicingAdapterReadiness(adapter).ready && adapter.hasUnsavedChanges?.() === true,
    destroy: () => unsubscribe?.(),
  };
}

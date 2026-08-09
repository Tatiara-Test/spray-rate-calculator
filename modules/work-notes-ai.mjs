import {
  MAX_DICTATION_MS,
  createAiAccessStore,
  createAiBackendClient,
  createWebRtcTranscriber,
  insertAiText,
} from "./work-notes-ai-client.mjs";

export const AI_CONSENT_VERSION = "2026-08-06-v1";

export function aiConsentStorageKey(channel = "base") {
  const safeChannel = String(channel || "base").replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
  return `pallathorpe-ai-consent:${safeChannel}:v1`;
}

export function normalizeAiConfig(config = {}) {
  const mode = config.mode === "live" ? "live" : "unconfigured";
  const requestedUrl = String(config.backendUrl || "").trim();
  let backendUrl = "";
  try {
    const parsed = new URL(requestedUrl);
    if (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      (parsed.pathname === "/" || parsed.pathname === "")
    ) {
      backendUrl = parsed.origin;
    }
  } catch {
    // Invalid release configuration stays fail-closed so manual Work Notes still mount.
  }
  const channel = String(config.channel || "base");
  const configured = mode === "live" && Boolean(backendUrl);
  return Object.freeze({ mode, backendUrl, channel, configured });
}

export function createAiOperationGate() {
  let invocation = 0;
  let assist = 0;
  return Object.freeze({
    invalidate() {
      invocation += 1;
      assist += 1;
      return invocation;
    },
    captureInvocation() {
      return invocation;
    },
    isInvocationCurrent(token) {
      return token === invocation;
    },
    beginAssist() {
      assist += 1;
      return Object.freeze({ invocation, assist });
    },
    isAssistCurrent(token) {
      return Boolean(token) && token.invocation === invocation && token.assist === assist;
    },
  });
}

export function normalizeTranscriberUiState(state) {
  return state === "completed" ? "finished" : state;
}

export function shouldConfirmAiDiscard({ preview = "", provisional = "", state = "idle", applying = false } = {}) {
  if (applying) return false;
  return Boolean(
    String(preview).trim() ||
    String(provisional).trim() ||
    ["connecting", "recording", "pausing", "paused", "finishing"].includes(state),
  );
}

function joinTranscript(base, next) {
  const parts = [String(base || "").trim(), String(next || "").trim()].filter(Boolean);
  return parts.join(parts.length > 1 ? " " : "");
}

function elapsedLabel(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function safeMessage(error, fallback = "The AI service could not complete that request.") {
  const value = String(error?.userMessage || error?.message || "").trim();
  return value || fallback;
}

export function mountWorkNotesAi(root, options = {}) {
  const $ = (selector) => root.querySelector(selector);
  const config = normalizeAiConfig(options.config);
  const storage = options.storage ?? globalThis.localStorage;
  const windowTarget = options.windowTarget ?? globalThis;
  const navigatorTarget = options.navigatorTarget ?? globalThis.navigator;
  const requestFrame = options.requestAnimationFrame ?? globalThis.requestAnimationFrame ?? ((callback) => callback());
  const accessStore = options.accessStore ?? createAiAccessStore({ storage, channel: config.channel });
  const backendClient = config.configured
    ? (options.backendClient ?? createAiBackendClient({
        backendUrl: config.backendUrl,
        accessStore,
        fetchFn: options.fetchFn ?? globalThis.fetch?.bind(globalThis),
      }))
    : null;
  const transcriberFactory = options.transcriberFactory ?? ((callbacks) => createWebRtcTranscriber({
    backendClient,
    mediaDevices: options.mediaDevices ?? navigatorTarget?.mediaDevices,
    RTCPeerConnectionCtor: options.RTCPeerConnectionCtor ?? globalThis.RTCPeerConnection,
    windowTarget,
    ...callbacks,
  }));

  const dialog = $("#ai-demo-dialog");
  if (!dialog) throw new Error("The Work Notes AI dialog is missing.");

  const badge = $("#ai-dialog-badge");
  const noteBadge = $("#ai-note-badge");
  const summaryBadge = $("#ai-summary-badge");
  const noteLauncherCopy = $("#ai-note-launcher-copy");
  const summaryCopy = $("#ai-summary-copy");
  const title = $("#ai-demo-title");
  const connectionBanner = $(".ai-disconnected-banner");
  const connectionTitle = $("#ai-connection-title");
  const modeCopy = $("#ai-demo-mode-copy");
  const networkStatus = $("#ai-network-status");
  const changeAccessButton = $("#ai-change-access");
  const accessPanel = $("#ai-access-panel");
  const accessCode = $("#ai-access-code");
  const consentCheckbox = $("#ai-data-consent");
  const saveAccessButton = $("#ai-save-access");
  const forgetAccessButton = $("#ai-forget-access");
  const recordingPanel = $("#ai-recording-panel");
  const recordingStatus = $("#ai-recording-status");
  const recordingTimer = $("#ai-recording-timer");
  const startButton = $("#ai-start-recording");
  const finishButton = $("#ai-stop-recording");
  const provisionalRow = $("#ai-provisional-text");
  const provisionalText = provisionalRow.querySelector("span");
  const confirmedStatus = $("#ai-confirmed-status");
  const generationPanel = $("#ai-generation-panel");
  const generateButton = $("#ai-generate-result");
  const errorBox = $("#ai-recording-error");
  const previewLabel = $("#ai-preview-label");
  const preview = $("#ai-preview-text");
  const followUpFields = $("#ai-followup-fields");
  const dueDate = $("#ai-preview-due");
  const sourceDate = $("#ai-preview-source");
  const resultNote = $("#ai-result-note");
  const applyButton = $("#ai-apply-result");
  const cancelButton = $("#ai-cancel");
  const closeButton = $("#ai-close");

  let activeMode = null;
  let context = null;
  let invoker = null;
  let afterClose = null;
  let transcriber = null;
  let transcriberState = "idle";
  let dictationBase = "";
  let generationAbort = null;
  const operationGate = createAiOperationGate();
  let timerId = null;
  let activeStartedAt = 0;
  let elapsedActiveMs = 0;

  function accessValue() {
    try {
      return String(accessStore.get?.() || "");
    } catch {
      return "";
    }
  }

  function hasConsent() {
    try {
      return storage?.getItem?.(aiConsentStorageKey(config.channel)) === AI_CONSENT_VERSION;
    } catch {
      return false;
    }
  }

  function saveConsent() {
    storage?.setItem?.(aiConsentStorageKey(config.channel), AI_CONSENT_VERSION);
  }

  function clearConsent() {
    try {
      storage?.removeItem?.(aiConsentStorageKey(config.channel));
    } catch {
      // Access remains revocable in memory even when browser storage is unavailable.
    }
  }

  function isOnline() {
    return navigatorTarget?.onLine !== false;
  }

  function setError(message = "") {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  function setProvisional(text = "") {
    const value = String(text || "").trim();
    provisionalText.textContent = value;
    provisionalRow.hidden = !value;
  }

  function showAccessPanel({ focus = false } = {}) {
    if (!config.configured) {
      accessPanel.hidden = true;
      changeAccessButton.hidden = true;
      return;
    }
    accessPanel.hidden = false;
    changeAccessButton.hidden = true;
    consentCheckbox.checked = hasConsent();
    if (focus) requestFrame(() => (accessValue() ? consentCheckbox : accessCode).focus());
  }

  function hideAccessPanel() {
    accessPanel.hidden = true;
    accessCode.value = "";
    changeAccessButton.hidden = !config.configured;
  }

  function updateConnectionCopy() {
    const live = config.configured;
    for (const target of [badge, noteBadge, summaryBadge]) {
      target.classList.toggle("live", live);
      target.textContent = live ? "AI · TEST CONFIGURED" : "AI · SETUP NEEDED";
    }
    noteLauncherCopy.textContent = live
      ? "Audio is sent live only after Start. Review the transcript before adding it to your note."
      : "Manual notes remain available. Live AI stays off until the private test connection is configured.";
    summaryCopy.textContent = live
      ? "AI can draft a summary from only the displayed fortnight. You review and copy it; nothing is saved automatically."
      : "When securely connected, AI can draft a summary from only the displayed fortnight for you to review and copy.";
    connectionBanner.classList.toggle("live", live && isOnline());
    if (!live) {
      connectionTitle.textContent = "Live AI is not enabled";
      networkStatus.textContent = "Manual Work Notes continue to work normally.";
    } else if (!isOnline()) {
      connectionTitle.textContent = "Offline";
      networkStatus.textContent = "Reconnect to use AI. Manual notes remain available.";
    } else if (!accessValue() || !hasConsent()) {
      connectionTitle.textContent = "Private access needed";
      networkStatus.textContent = "Save the private test code and acknowledge the data notice before using AI.";
    } else {
      connectionTitle.textContent = "Private test configured";
      networkStatus.textContent = "Availability is checked when you start an action. Nothing is saved automatically.";
    }
  }

  function clearClock() {
    if (timerId !== null) windowTarget.clearTimeout?.(timerId);
    timerId = null;
    activeStartedAt = 0;
  }

  function renderedElapsed() {
    return elapsedActiveMs + (activeStartedAt ? Date.now() - activeStartedAt : 0);
  }

  function startClock() {
    if (activeStartedAt) return;
    activeStartedAt = Date.now();
    const tick = () => {
      const elapsed = renderedElapsed();
      recordingTimer.textContent = elapsedLabel(elapsed);
      if (elapsed >= MAX_DICTATION_MS) {
        finishDictation(true);
        return;
      }
      timerId = windowTarget.setTimeout?.(tick, 1000) ?? null;
    };
    tick();
  }

  function pauseClock() {
    if (activeStartedAt) elapsedActiveMs += Date.now() - activeStartedAt;
    clearClock();
    recordingTimer.textContent = elapsedLabel(elapsedActiveMs);
  }

  function resetClock() {
    clearClock();
    elapsedActiveMs = 0;
    recordingTimer.textContent = "00:00";
  }

  function cleanupActiveWork() {
    operationGate.invalidate();
    const previousAbort = generationAbort;
    generationAbort = null;
    previousAbort?.abort?.();
    try {
      transcriber?.cancel?.();
    } catch {
      // Cleanup remains best-effort if the browser has already closed the peer connection.
    }
    transcriber = null;
    transcriberState = "idle";
    dictationBase = "";
    resetClock();
    setProvisional();
  }

  function resetDialog() {
    cleanupActiveWork();
    setError();
    preview.value = "";
    preview.readOnly = false;
    dueDate.value = "";
    sourceDate.value = "";
    recordingStatus.textContent = "Dictation has not started.";
    startButton.textContent = "Start dictation";
    startButton.disabled = false;
    finishButton.textContent = "Finish";
    finishButton.disabled = true;
    generateButton.disabled = false;
    applyButton.disabled = true;
    accessCode.value = "";
    resultNote.textContent = "No AI result has been generated.";
  }

  function requireLiveAccess() {
    updateConnectionCopy();
    if (!config.configured) {
      setError("Live AI is built but remains disabled until the private test connection is approved and configured.");
      return false;
    }
    if (!isOnline()) {
      setError("You are offline. Reconnect to use AI; your manual notes are unaffected.");
      return false;
    }
    if (!accessValue() || !hasConsent()) {
      setError("Save the private test access code and acknowledge the data notice first.");
      showAccessPanel({ focus: true });
      return false;
    }
    hideAccessPanel();
    return true;
  }

  function updateTranscript({ confirmed = "", partial = "" } = {}) {
    preview.value = joinTranscript(dictationBase, confirmed);
    setProvisional(partial);
    if (confirmed) confirmedStatus.textContent = "Confirmed text added.";
  }

  function handleTranscriberState(nextState) {
    const state = normalizeTranscriberUiState(
      typeof nextState === "string" ? nextState : nextState?.state,
    );
    if (!state) return;
    transcriberState = state;
    if (["recording", "dictating", "active"].includes(state)) {
      recordingStatus.textContent = "Listening and writing live…";
      startButton.textContent = "Pause";
      startButton.disabled = false;
      finishButton.textContent = "Finish";
      finishButton.disabled = false;
      startClock();
    } else if (["connecting", "requesting"].includes(state)) {
      recordingStatus.textContent = "Connecting securely…";
      startButton.textContent = "Connecting…";
      startButton.disabled = true;
      finishButton.disabled = true;
    } else if (state === "pausing") {
      recordingStatus.textContent = "Finishing the current words…";
      startButton.textContent = "Finishing…";
      startButton.disabled = true;
      finishButton.disabled = true;
      pauseClock();
    } else if (state === "paused") {
      recordingStatus.textContent = "Paused. Confirmed text is kept.";
      startButton.textContent = "Resume";
      startButton.disabled = false;
      finishButton.disabled = false;
      pauseClock();
    } else if (state === "finishing") {
      recordingStatus.textContent = "Finishing the last words…";
      startButton.disabled = true;
      finishButton.disabled = true;
      pauseClock();
    } else if (state === "finished") {
      recordingStatus.textContent = "Dictation finished. Review the text before inserting it.";
      startButton.disabled = true;
      finishButton.disabled = true;
      preview.readOnly = false;
      applyButton.disabled = !preview.value.trim();
      pauseClock();
      requestFrame(() => preview.focus());
    }
  }

  function handleTranscriberError(error) {
    pauseClock();
    setProvisional();
    setError(safeMessage(error, "The live connection stopped. Confirmed text is still available."));
    transcriberState = "disconnected";
    recordingStatus.textContent = "Connection stopped. Confirmed text is kept.";
    startButton.textContent = preview.value.trim() ? "Reconnect and continue" : "Try again";
    startButton.disabled = false;
    finishButton.textContent = "Finish with confirmed text";
    finishButton.disabled = !preview.value.trim();
  }

  function makeTranscriber() {
    const invocation = operationGate.captureInvocation();
    let candidate = null;
    const isCurrent = () =>
      operationGate.isInvocationCurrent(invocation) && transcriber === candidate && dialog.open;
    candidate = transcriberFactory({
      onState: (state) => {
        if (isCurrent()) handleTranscriberState(state);
      },
      onTranscript: (value) => {
        if (isCurrent()) updateTranscript(value);
      },
      onError: (error) => {
        if (isCurrent()) handleTranscriberError(error);
      },
    });
    return candidate;
  }

  async function beginDictation() {
    if (!requireLiveAccess()) return;
    setError();
    if (transcriberState === "disconnected") {
      try {
        transcriber?.cancel?.();
      } catch {
        // A failed connection may already be closed.
      }
      dictationBase = preview.value.trim();
      transcriber = null;
    }
    if (!transcriber) transcriber = makeTranscriber();
    const candidate = transcriber;
    const invocation = operationGate.captureInvocation();
    preview.readOnly = true;
    applyButton.disabled = true;
    try {
      await candidate.start();
    } catch (error) {
      if (operationGate.isInvocationCurrent(invocation) && transcriber === candidate && dialog.open) {
        handleTranscriberError(error);
      }
    }
  }

  async function toggleDictation() {
    if (["recording", "dictating", "active"].includes(transcriberState)) {
      const candidate = transcriber;
      const invocation = operationGate.captureInvocation();
      try {
        await candidate.pause();
      } catch (error) {
        if (operationGate.isInvocationCurrent(invocation) && transcriber === candidate && dialog.open) {
          handleTranscriberError(error);
        }
      }
      return;
    }
    if (transcriberState === "paused") {
      const candidate = transcriber;
      const invocation = operationGate.captureInvocation();
      setError();
      preview.readOnly = true;
      try {
        await candidate.resume();
      } catch (error) {
        if (operationGate.isInvocationCurrent(invocation) && transcriber === candidate && dialog.open) {
          handleTranscriberError(error);
        }
      }
      return;
    }
    await beginDictation();
  }

  async function finishDictation(automatic = false) {
    if (transcriberState === "disconnected") {
      try {
        transcriber?.cancel?.();
      } catch {
        // Confirmed text can still be reviewed after cleanup.
      }
      transcriber = null;
      transcriberState = "finished";
      handleTranscriberState("finished");
      return;
    }
    if (!transcriber || ["idle", "finished"].includes(transcriberState)) return;
    const candidate = transcriber;
    const invocation = operationGate.captureInvocation();
    if (automatic) resultNote.textContent = "Two-minute live-audio limit reached. Confirmed text remains available for review.";
    try {
      const result = await candidate.finish();
      if (!operationGate.isInvocationCurrent(invocation) || transcriber !== candidate || !dialog.open) return;
      const text = typeof result === "string" ? result : result?.text ?? candidate.text;
      if (text) preview.value = joinTranscript(dictationBase, text);
      setProvisional();
      transcriberState = "finished";
      handleTranscriberState("finished");
    } catch (error) {
      if (operationGate.isInvocationCurrent(invocation) && transcriber === candidate && dialog.open) {
        handleTranscriberError(error);
      }
    }
  }

  async function generatePreview() {
    if (!requireLiveAccess()) return;
    setError();
    const requestMode = activeMode;
    const requestContext = context;
    const operation = operationGate.beginAssist();
    generateButton.disabled = true;
    generateButton.textContent = "Generating…";
    applyButton.disabled = true;
    const previousAbort = generationAbort;
    previousAbort?.abort?.();
    const requestController = new AbortController();
    generationAbort = requestController;
    const isCurrent = () =>
      operationGate.isAssistCurrent(operation) &&
      generationAbort === requestController &&
      dialog.open;
    try {
      let action;
      let payload;
      if (requestMode === "organise") {
        action = "organise_note";
        payload = { note: requestContext.noteText, sourceDate: requestContext.date };
      } else if (requestMode === "followup") {
        action = "extract_follow_up";
        payload = { note: requestContext.noteText, sourceDate: requestContext.date };
      } else if (requestMode === "summary") {
        action = "summarise_fortnight";
        payload = {
          startDate: requestContext.startDate,
          endDate: requestContext.endDate,
          notes: (requestContext.notes || []).map((item) => ({ date: item.date, text: item.text })),
        };
      } else {
        throw new TypeError(`Unknown AI generation mode: ${requestMode}`);
      }
      const result = await backendClient.assist(action, payload, { signal: requestController.signal });
      if (!isCurrent()) return;
      if (requestMode === "organise") {
        preview.value = result.text;
        resultNote.textContent = "Review carefully. Apply replaces the note once, with Restore previous available.";
      } else if (requestMode === "followup" && result.kind === "no-followup") {
        preview.value = "";
        dueDate.value = "";
        sourceDate.value = result.sourceDate || requestContext.date || "";
        resultNote.textContent = "No clear follow-up was found in this note. Nothing has been added or changed.";
      } else if (requestMode === "followup") {
        preview.value = result.description;
        dueDate.value = result.dueDate || "";
        sourceDate.value = result.sourceDate || requestContext.date || "";
        resultNote.textContent = "Review this proposal in the normal Follow-up form before saving it.";
      } else {
        preview.value = result.text;
        resultNote.textContent = "This draft is not saved. Copy it only after review.";
      }
      applyButton.disabled = !preview.value.trim();
      requestFrame(() => preview.focus());
    } catch (error) {
      if (isCurrent() && error?.name !== "AbortError" && error?.code !== "cancelled") {
        setError(safeMessage(error));
      }
    } finally {
      if (isCurrent()) {
        generationAbort = null;
        generateButton.disabled = false;
        generateButton.textContent = requestMode === "summary" ? "Generate summary" : "Generate preview";
      }
    }
  }

  function open(nextMode, nextContext = {}, sourceButton = null) {
    if (!["dictation", "organise", "followup", "summary"].includes(nextMode)) {
      throw new TypeError(`Unknown AI mode: ${nextMode}`);
    }
    resetDialog();
    activeMode = nextMode;
    context = {
      ...nextContext,
      notes: Array.isArray(nextContext.notes)
        ? nextContext.notes.map((item) => ({ date: item.date, text: item.text }))
        : undefined,
    };
    invoker = sourceButton;
    updateConnectionCopy();
    recordingPanel.hidden = nextMode !== "dictation";
    generationPanel.hidden = nextMode === "dictation";
    followUpFields.hidden = nextMode !== "followup";
    changeAccessButton.hidden = !config.configured || !accessValue() || !hasConsent();
    if (config.configured && (!accessValue() || !hasConsent())) showAccessPanel();
    else hideAccessPanel();

    if (nextMode === "dictation") {
      title.textContent = "Live AI dictation";
      modeCopy.textContent = "After Start, microphone audio is sent live for transcription. This app does not save an audio recording.";
      previewLabel.textContent = "Confirmed transcript";
      preview.readOnly = true;
      resultNote.textContent = "Nothing is added to your note until you finish, review and insert the transcript.";
      applyButton.textContent = "Insert transcript into note";
    } else if (nextMode === "organise") {
      title.textContent = "Organise note";
      modeCopy.textContent = "Only this note is sent. AI drafts a clearer version; your original remains unchanged until Apply.";
      previewLabel.textContent = "Organised-note preview";
      resultNote.textContent = "Generate a proposal, review it, then choose whether to replace the note.";
      generateButton.textContent = "Generate preview";
      applyButton.textContent = "Replace note with reviewed text";
    } else if (nextMode === "followup") {
      title.textContent = "Create follow-up";
      modeCopy.textContent = "Only this note is sent. AI proposes a follow-up; the normal form remains the final save step.";
      previewLabel.textContent = "Follow-up description";
      resultNote.textContent = "Generate and review a proposal before opening the normal Follow-up form.";
      generateButton.textContent = "Generate preview";
      applyButton.textContent = "Review in Follow-up form";
    } else {
      title.textContent = "Fortnight summary";
      modeCopy.textContent = "Only the 14 displayed dates and their note text are sent. The result is a copyable draft.";
      previewLabel.textContent = "Fortnight-summary preview";
      resultNote.textContent = "Generate a draft from the displayed fortnight. It will not be saved automatically.";
      generateButton.textContent = "Generate summary";
      applyButton.textContent = "Copy reviewed summary";
    }

    if (!config.configured) {
      startButton.disabled = true;
      finishButton.disabled = true;
      generateButton.disabled = true;
      setError("Live AI is built but not enabled. No note or audio can leave this app while this safety gate is closed.");
    }
    dialog.showModal();
    requestFrame(() => {
      if (config.configured && (!accessValue() || !hasConsent())) {
        (accessValue() ? consentCheckbox : accessCode).focus();
      } else if (nextMode === "dictation") {
        startButton.focus();
      } else {
        generateButton.focus();
      }
    });
  }

  function closeWith(action = null) {
    afterClose = action;
    if (dialog.open) dialog.close();
  }

  function requestClose() {
    const hasUnapplied = shouldConfirmAiDiscard({
      preview: preview.value,
      provisional: provisionalText.textContent,
      state: transcriberState,
      applying: Boolean(afterClose),
    });
    if (hasUnapplied && typeof windowTarget.confirm === "function") {
      const label = activeMode === "dictation" ? "transcript" : "AI result";
      if (!windowTarget.confirm(`Discard this ${label}? It has not been added to Work Notes.`)) return;
    }
    closeWith();
  }

  async function applyResult() {
    if (applyButton.disabled) return;
    setError();
    if (activeMode === "dictation") {
      const inserted = insertAiText(
        context.noteText,
        preview.value,
        context.selectionStart,
        context.selectionEnd,
      );
      if (options.applyNoteText?.({ date: context.date, text: inserted.text }) === false) {
        setError("The transcript could not be inserted. Your existing note was not changed.");
        return;
      }
      closeWith({ type: "note-applied" });
      return;
    }
    if (activeMode === "organise") {
      if (options.applyNoteText?.({ date: context.date, text: preview.value.trim() }) === false) {
        setError("The organised text could not replace the note. Your original was not changed.");
        return;
      }
      closeWith({ type: "note-applied" });
      return;
    }
    if (activeMode === "followup") {
      closeWith({
        type: "followup",
        payload: {
          description: preview.value.trim(),
          dueDate: dueDate.value,
          sourceDate: sourceDate.value || context.date,
        },
      });
      return;
    }
    if (activeMode === "summary") {
      const copied = await options.copyText?.(preview.value.trim());
      if (!copied) {
        setError("Copy was blocked. Press and hold the summary text to copy it.");
        return;
      }
      options.showToast?.("AI summary copied");
      closeWith({ type: "summary-copied" });
    }
  }

  function savePrivateAccess() {
    const code = accessCode.value.trim();
    if (code.length < 16) {
      setError("Use the private access code from the Worker setup (at least 16 characters).");
      accessCode.focus();
      return;
    }
    if (!consentCheckbox.checked) {
      setError("Please read and acknowledge the data notice before enabling AI on this phone.");
      consentCheckbox.focus();
      return;
    }
    try {
      accessStore.set(code);
      saveConsent();
      hideAccessPanel();
      setError();
      updateConnectionCopy();
      options.showToast?.("Private AI access saved on this phone");
      requestFrame(() => (activeMode === "dictation" ? startButton : generateButton).focus());
    } catch {
      setError("This browser could not save the private access code. Manual notes are unaffected.");
    }
  }

  function forgetPrivateAccess() {
    try {
      accessStore.clear();
    } catch {
      // Continue clearing the separate consent marker.
    }
    clearConsent();
    accessCode.value = "";
    consentCheckbox.checked = false;
    showAccessPanel({ focus: true });
    updateConnectionCopy();
    setError("Private AI access was removed from this phone.");
  }

  startButton.addEventListener("click", toggleDictation);
  finishButton.addEventListener("click", () => finishDictation(false));
  generateButton.addEventListener("click", generatePreview);
  saveAccessButton.addEventListener("click", savePrivateAccess);
  forgetAccessButton.addEventListener("click", forgetPrivateAccess);
  changeAccessButton.addEventListener("click", () => showAccessPanel({ focus: true }));
  applyButton.addEventListener("click", applyResult);
  cancelButton.addEventListener("click", requestClose);
  closeButton.addEventListener("click", requestClose);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    requestClose();
  });
  dialog.addEventListener("close", () => {
    const action = afterClose;
    const closedContext = context;
    const closedInvoker = invoker;
    afterClose = null;
    cleanupActiveWork();
    activeMode = null;
    context = null;
    invoker = null;
    if (action?.type === "followup") {
      options.openFollowUpDraft?.(action.payload);
    } else if (closedContext?.returnToNote) {
      options.reopenNote?.(closedContext.date);
    } else {
      closedInvoker?.focus?.();
    }
  });
  windowTarget.addEventListener?.("online", updateConnectionCopy);
  windowTarget.addEventListener?.("offline", updateConnectionCopy);
  windowTarget.addEventListener?.("pagehide", cleanupActiveWork);

  updateConnectionCopy();
  return Object.freeze({ open, cleanup: cleanupActiveWork, config });
}

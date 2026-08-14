const DEMO_TRANSCRIPT_PREFIX = "[AI demo sample — not transcribed]";
const DEMO_ORGANISED_PREFIX = "[AI demo sample — not generated from this note]";
const DEMO_SUMMARY_PREFIX = "[AI demo sample — not generated from your notes]";
const DEMO_FOLLOWUP_PREFIX = "[AI demo sample]";

export const AI_DEMO_RESULTS = Object.freeze({
  dictation: `${DEMO_TRANSCRIPT_PREFIX}\nServiced the 412R at 2,840 hours. Changed the engine oil and filters. Need to order a spare fuel filter on Friday.`,
  organise: `${DEMO_ORGANISED_PREFIX}\nServiced the 412R at 2,840 hours.\n\nCompleted:\n• Changed the engine oil and filters.\n\nTo-do:\n• Order a spare fuel filter on Friday.`,
  summary: `${DEMO_SUMMARY_PREFIX}\n\nFortnight overview\n• Completed scheduled spraying and equipment checks.\n• Serviced the 412R and changed the engine oil and filters.\n• Recorded a to-do to order a spare fuel filter.`,
  followUpDescription: `${DEMO_FOLLOWUP_PREFIX} Order a spare fuel filter`,
});

export const MAX_DEMO_RECORDING_MS = 120_000;

export function insertDemoText(source, inserted, selectionStart, selectionEnd) {
  const current = String(source ?? "");
  const addition = String(inserted ?? "").trim();
  const start = Number.isInteger(selectionStart)
    ? Math.max(0, Math.min(selectionStart, current.length))
    : current.length;
  const end = Number.isInteger(selectionEnd)
    ? Math.max(start, Math.min(selectionEnd, current.length))
    : start;
  const before = current.slice(0, start);
  const after = current.slice(end);
  const leadingBreak = before && !before.endsWith("\n") ? "\n\n" : "";
  const trailingBreak = after && !after.startsWith("\n") ? "\n\n" : "";
  const text = `${before}${leadingBreak}${addition}${trailingBreak}${after}`;
  return {
    text,
    cursor: before.length + leadingBreak.length + addition.length,
  };
}

export function nextFridayAfter(dateIso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateIso))) return "";
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  let days = (5 - date.getUTCDay() + 7) % 7;
  if (days === 0) days = 7;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function createWorkNotesAiDemoProvider() {
  return Object.freeze({
    mode: "demo",
    connected: false,
    transcriptSample() {
      return Object.freeze({
        kind: "fixed-sample",
        text: AI_DEMO_RESULTS.dictation,
        basedOnRecording: false,
      });
    },
    organisedNoteSample() {
      return Object.freeze({
        kind: "fixed-sample",
        text: AI_DEMO_RESULTS.organise,
        basedOnNote: false,
      });
    },
    followUpSample(sourceDate = "") {
      return Object.freeze({
        kind: "fixed-sample",
        description: AI_DEMO_RESULTS.followUpDescription,
        dueDate: nextFridayAfter(sourceDate),
        sourceDate,
        basedOnNote: false,
      });
    },
    summarySample() {
      return Object.freeze({
        kind: "fixed-sample",
        text: AI_DEMO_RESULTS.summary,
        basedOnNotes: false,
      });
    },
  });
}

export class MicrophoneDemoError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "MicrophoneDemoError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export function microphoneSupportState({ mediaDevices, MediaRecorderCtor, secureContext } = {}) {
  if (secureContext === false) return "insecure";
  if (typeof mediaDevices?.getUserMedia !== "function" || typeof MediaRecorderCtor !== "function") {
    return "unsupported";
  }
  return "ready";
}

export function microphoneError(error, secureContext = true) {
  if (secureContext === false) {
    return new MicrophoneDemoError(
      "insecure",
      "Microphone testing needs the HTTPS Tatiara Test address.",
      error,
    );
  }
  if (error instanceof MicrophoneDemoError) return error;
  const name = error?.name || "";
  if (["NotAllowedError", "SecurityError", "PermissionDeniedError"].includes(name)) {
    return new MicrophoneDemoError(
      "blocked",
      "Microphone access is blocked. Allow microphone access for the Tatiara Test site in browser settings, then try again. Fixed samples still work.",
      error,
    );
  }
  if (["NotFoundError", "DevicesNotFoundError"].includes(name)) {
    return new MicrophoneDemoError(
      "missing",
      "No microphone was found. Check that a microphone is available, or use the fixed sample.",
      error,
    );
  }
  if (["NotReadableError", "TrackStartError", "AbortError"].includes(name)) {
    return new MicrophoneDemoError(
      "busy",
      "The microphone could not start. Close any app using it, then try again.",
      error,
    );
  }
  return new MicrophoneDemoError(
    "unexpected",
    "The microphone test stopped unexpectedly. Nothing was uploaded.",
    error,
  );
}

export function createLocalDemoRecorder(options = {}) {
  const mediaDevices = options.mediaDevices ?? globalThis.navigator?.mediaDevices;
  const MediaRecorderCtor = options.MediaRecorderCtor ?? globalThis.MediaRecorder;
  const BlobCtor = options.BlobCtor ?? globalThis.Blob;
  const secureContext = options.secureContext ?? globalThis.isSecureContext;
  let recorder = null;
  let stream = null;
  let chunks = [];
  let requestGeneration = 0;
  let state = "idle";

  function stopTracks(target = stream) {
    for (const track of target?.getTracks?.() ?? []) {
      try {
        track.stop();
      } catch {
        // A track that has already ended needs no further cleanup.
      }
    }
    if (target === stream) stream = null;
  }

  function reset() {
    recorder = null;
    chunks = [];
    state = "idle";
  }

  return {
    get state() {
      return state;
    },
    get support() {
      return microphoneSupportState({ mediaDevices, MediaRecorderCtor, secureContext });
    },
    async start() {
      const support = microphoneSupportState({ mediaDevices, MediaRecorderCtor, secureContext });
      if (support === "insecure") throw microphoneError(null, false);
      if (support !== "ready") {
        throw new MicrophoneDemoError(
          "unsupported",
          "This browser cannot record a microphone test. You can still review the fixed sample.",
        );
      }
      if (state !== "idle") throw new MicrophoneDemoError("busy", "A microphone test is already active.");

      const generation = ++requestGeneration;
      state = "requesting";
      let openedStream;
      try {
        openedStream = await mediaDevices.getUserMedia({ audio: true });
      } catch (error) {
        if (generation === requestGeneration) reset();
        throw microphoneError(error, secureContext !== false);
      }
      if (generation !== requestGeneration || state !== "requesting") {
        stopTracks(openedStream);
        throw new MicrophoneDemoError("cancelled", "The microphone test was cancelled.");
      }

      stream = openedStream;
      chunks = [];
      try {
        recorder = new MediaRecorderCtor(stream);
        recorder.addEventListener("dataavailable", (event) => {
          if (state !== "idle" && event.data?.size) chunks.push(event.data);
        });
        recorder.start();
        state = "recording";
        return { mimeType: recorder.mimeType || "audio/webm" };
      } catch (error) {
        stopTracks();
        reset();
        throw microphoneError(error, secureContext !== false);
      }
    },
    stop() {
      if (state !== "recording" || !recorder) {
        return Promise.reject(new MicrophoneDemoError("inactive", "No microphone test is recording."));
      }
      state = "stopping";
      const activeRecorder = recorder;
      return new Promise((resolve, reject) => {
        const finish = () => {
          const type = activeRecorder.mimeType || chunks[0]?.type || "audio/webm";
          const audio = new BlobCtor(chunks, { type });
          stopTracks();
          reset();
          resolve(audio);
        };
        const fail = (event) => {
          stopTracks();
          reset();
          reject(microphoneError(event?.error || event, secureContext !== false));
        };
        activeRecorder.addEventListener("stop", finish, { once: true });
        activeRecorder.addEventListener("error", fail, { once: true });
        try {
          activeRecorder.stop();
        } catch (error) {
          fail(error);
        }
      });
    },
    cancel() {
      requestGeneration += 1;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Cleanup below is sufficient if the recorder cannot be stopped again.
        }
      }
      stopTracks();
      reset();
    },
  };
}

function ensurePrefix(text, prefix) {
  const value = String(text ?? "").trim();
  return value.startsWith("[AI demo sample") ? value : `${prefix}\n${value}`.trim();
}

function elapsedTime(startedAt, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function mountWorkNotesAiDemo(root, options = {}) {
  const $ = (selector) => root.querySelector(selector);
  const provider = options.provider ?? createWorkNotesAiDemoProvider();
  const recorderFactory = options.recorderFactory ?? (() => createLocalDemoRecorder());
  const urlApi = options.urlApi ?? globalThis.URL;
  const windowTarget = options.windowTarget ?? globalThis;
  const dialog = $("#ai-demo-dialog");
  if (!dialog) throw new Error("The Work Notes AI demonstration dialog is missing.");

  const title = $("#ai-demo-title");
  const modeCopy = $("#ai-demo-mode-copy");
  const networkStatus = $("#ai-network-status");
  const recordingPanel = $("#ai-recording-panel");
  const recordingStatus = $("#ai-recording-status");
  const recordingTimer = $("#ai-recording-timer");
  const startButton = $("#ai-start-recording");
  const stopButton = $("#ai-stop-recording");
  const sampleButton = $("#ai-load-sample");
  const playback = $("#ai-recording-playback");
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

  let mode = null;
  let context = null;
  let invoker = null;
  let recorder = null;
  let playbackUrl = "";
  let timerId = null;
  let autoStopId = null;
  let recordingStartedAt = 0;
  let afterClose = null;

  function updateNetworkStatus() {
    const offline = globalThis.navigator?.onLine === false;
    networkStatus.textContent = offline
      ? "Offline · microphone testing and fixed samples still work. Real AI will require internet."
      : "Online · this demonstration still makes no AI or transcription request.";
  }

  function clearTimers() {
    if (timerId !== null) windowTarget.clearTimeout(timerId);
    if (autoStopId !== null) windowTarget.clearTimeout(autoStopId);
    timerId = null;
    autoStopId = null;
  }

  function clearPlayback() {
    if (playbackUrl) urlApi?.revokeObjectURL?.(playbackUrl);
    playbackUrl = "";
    playback.removeAttribute("src");
    playback.hidden = true;
  }

  function cleanupRecording() {
    clearTimers();
    recorder?.cancel();
    recorder = null;
    clearPlayback();
    recordingTimer.textContent = "00:00";
  }

  function setError(message = "") {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  function resetDialogState() {
    cleanupRecording();
    setError();
    preview.value = "";
    dueDate.value = "";
    sourceDate.value = "";
    recordingStatus.textContent = "Microphone test has not started.";
    startButton.disabled = false;
    stopButton.disabled = true;
    sampleButton.disabled = false;
    applyButton.disabled = true;
    playback.hidden = true;
  }

  function startTimer() {
    clearTimers();
    recordingStartedAt = Date.now();
    const tick = () => {
      recordingTimer.textContent = elapsedTime(recordingStartedAt);
      timerId = windowTarget.setTimeout(tick, 1000);
    };
    tick();
    autoStopId = windowTarget.setTimeout(() => stopRecording(true), MAX_DEMO_RECORDING_MS);
  }

  async function startRecording() {
    cleanupRecording();
    setError();
    recorder = recorderFactory();
    if (recorder.support === "insecure") {
      setError("Microphone testing needs the HTTPS Tatiara Test address.");
      recordingStatus.textContent = "Microphone test unavailable.";
      return;
    }
    if (recorder.support !== "ready") {
      setError("This browser cannot record a microphone test. You can still review the fixed sample.");
      recordingStatus.textContent = "Microphone recording is unsupported.";
      return;
    }
    recordingStatus.textContent = "Waiting for your browser’s microphone permission…";
    startButton.disabled = true;
    stopButton.disabled = true;
    try {
      const activeRecorder = recorder;
      await activeRecorder.start();
      if (recorder !== activeRecorder) {
        activeRecorder.cancel();
        return;
      }
      recordingStatus.textContent = "Recording locally. No AI is listening and no transcription is running.";
      stopButton.disabled = false;
      startTimer();
    } catch (error) {
      if (error?.code === "cancelled") return;
      const safe = microphoneError(error);
      recorder = null;
      startButton.disabled = false;
      stopButton.disabled = true;
      recordingStatus.textContent = "Microphone test did not start.";
      setError(safe.message);
    }
  }

  async function stopRecording(automatic = false) {
    if (!recorder || recorder.state !== "recording") return;
    clearTimers();
    stopButton.disabled = true;
    recordingStatus.textContent = automatic
      ? "Two-minute microphone test limit reached. Finishing the local recording…"
      : "Finishing the local recording…";
    try {
      const audio = await recorder.stop();
      recorder = null;
      startButton.disabled = false;
      if (audio.size && typeof urlApi?.createObjectURL === "function") {
        playbackUrl = urlApi.createObjectURL(audio);
        playback.src = playbackUrl;
        playback.hidden = false;
      }
      recordingStatus.textContent =
        "Recording captured on this phone. AI transcription is not connected. Listen back or load the fixed sample transcript.";
    } catch (error) {
      recorder = null;
      startButton.disabled = false;
      recordingStatus.textContent = "The microphone test stopped without a usable recording.";
      setError(microphoneError(error).message);
    }
  }

  function loadFixedTranscript() {
    const result = provider.transcriptSample();
    preview.value = result.text;
    applyButton.disabled = false;
    resultNote.textContent = "Fixed sample · not your recording. Edit it before inserting.";
    preview.focus();
  }

  function open(nextMode, nextContext = {}, sourceButton = null) {
    resetDialogState();
    mode = nextMode;
    context = { ...nextContext };
    invoker = sourceButton;
    updateNetworkStatus();
    recordingPanel.hidden = nextMode !== "dictation";
    followUpFields.hidden = nextMode !== "followup";

    if (nextMode === "dictation") {
      title.textContent = "Test the microphone";
      modeCopy.textContent =
        "This checks your phone’s microphone only. The recording stays in memory and is never uploaded or transcribed.";
      previewLabel.textContent = "Fixed sample transcript";
      resultNote.textContent = "No transcript has been loaded.";
      applyButton.textContent = "Insert sample into note";
    } else if (nextMode === "organise") {
      const result = provider.organisedNoteSample();
      title.textContent = "Organise note — sample";
      modeCopy.textContent =
        "The connected version will organise your note. This fixed demonstration is not based on your note.";
      previewLabel.textContent = "Fixed organised-note sample";
      preview.value = result.text;
      resultNote.textContent = "Fixed sample · the original note remains recoverable through Restore previous.";
      applyButton.textContent = "Replace note with sample";
      applyButton.disabled = false;
    } else if (nextMode === "followup") {
      const result = provider.followUpSample(context.date);
      title.textContent = "Create to-do — sample";
      modeCopy.textContent =
        "The connected version will infer a to-do. This fixed demonstration is not based on your note.";
      previewLabel.textContent = "Fixed to-do description";
      preview.value = result.description;
      dueDate.value = result.dueDate;
      sourceDate.value = result.sourceDate;
      resultNote.textContent = "Nothing is saved until you review the normal To-do form.";
      applyButton.textContent = "Review in To-do form";
      applyButton.disabled = false;
    } else if (nextMode === "summary") {
      const result = provider.summarySample();
      title.textContent = "Fortnight summary — sample";
      modeCopy.textContent =
        "The connected version will summarise the displayed fortnight. This fixed demonstration is not based on your notes.";
      previewLabel.textContent = "Fixed fortnight-summary sample";
      preview.value = result.text;
      resultNote.textContent = "The sample warning remains in copied text.";
      applyButton.textContent = "Copy sample";
      applyButton.disabled = false;
    } else {
      throw new TypeError(`Unknown AI demonstration mode: ${nextMode}`);
    }

    dialog.showModal();
    (globalThis.requestAnimationFrame ?? ((callback) => callback()))(() => {
      (nextMode === "dictation" ? startButton : preview).focus();
    });
  }

  function closeWith(action = null) {
    afterClose = action;
    if (dialog.open) dialog.close();
  }

  async function applyResult() {
    if (applyButton.disabled) return;
    setError();
    if (mode === "dictation") {
      const sample = ensurePrefix(preview.value, DEMO_TRANSCRIPT_PREFIX);
      const inserted = insertDemoText(
        context.noteText,
        sample,
        context.selectionStart,
        context.selectionEnd,
      );
      if (options.applyNoteText?.({ date: context.date, text: inserted.text }) === false) {
        setError("The sample could not be inserted. Your existing note was not changed.");
        return;
      }
      closeWith({ type: "note-applied" });
      return;
    }
    if (mode === "organise") {
      const sample = ensurePrefix(preview.value, DEMO_ORGANISED_PREFIX);
      if (options.applyNoteText?.({ date: context.date, text: sample }) === false) {
        setError("The sample could not replace the note. Your existing note was not changed.");
        return;
      }
      closeWith({ type: "note-applied" });
      return;
    }
    if (mode === "followup") {
      const description = ensurePrefix(preview.value, DEMO_FOLLOWUP_PREFIX);
      closeWith({
        type: "followup",
        payload: {
          description,
          dueDate: dueDate.value,
          sourceDate: sourceDate.value || context.date,
        },
      });
      return;
    }
    if (mode === "summary") {
      const sample = ensurePrefix(preview.value, DEMO_SUMMARY_PREFIX);
      const copied = await options.copyText?.(sample);
      if (!copied) {
        setError("Copy was blocked. Press and hold the sample text to copy it.");
        return;
      }
      options.showToast?.("AI demonstration sample copied");
      closeWith({ type: "summary-copied" });
    }
  }

  startButton.addEventListener("click", startRecording);
  stopButton.addEventListener("click", () => stopRecording(false));
  sampleButton.addEventListener("click", loadFixedTranscript);
  applyButton.addEventListener("click", applyResult);
  cancelButton.addEventListener("click", () => closeWith());
  closeButton.addEventListener("click", () => closeWith());
  dialog.addEventListener("close", () => {
    const action = afterClose;
    const closedContext = context;
    const closedInvoker = invoker;
    afterClose = null;
    cleanupRecording();
    mode = null;
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
  windowTarget.addEventListener?.("online", updateNetworkStatus);
  windowTarget.addEventListener?.("offline", updateNetworkStatus);
  windowTarget.addEventListener?.("pagehide", cleanupRecording);

  return Object.freeze({ open, cleanup: cleanupRecording });
}

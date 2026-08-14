export const AI_ACCESS_KEY_PREFIX = "pallathorpe-private:work-notes-ai-access:v1";
export const MAX_DICTATION_MS = 120_000;
export const REALTIME_REQUEST_TIMEOUT_MS = 20_000;
export const ASSIST_REQUEST_TIMEOUT_MS = 32_000;

const DATA_CHANNEL_TIMEOUT_MS = 15_000;
const FINAL_TRANSCRIPT_TIMEOUT_MS = 20_000;
const MAX_BACKEND_ERROR_LENGTH = 4_096;
const MAX_ACCESS_CODE_LENGTH = 256;
const MAX_SDP_LENGTH = 1_000_000;
const MAX_ASSIST_PAYLOAD_LENGTH = 24 * 1024;
const MAX_ASSIST_TEXT_LENGTH = 12_000;
const MAX_RESULT_TEXT_LENGTH = 100_000;
const ASSIST_ACTIONS = new Set([
  "organise_note",
  "extract_follow_up",
  "summarise_fortnight",
]);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class AiServiceError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "AiServiceError";
    this.code = code;
    this.status = Number.isInteger(options.status) ? options.status : null;
    this.retryable = options.retryable === true;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

function asAiError(error, fallbackCode = "unexpected") {
  if (error instanceof AiServiceError) return error;
  if (error?.name === "AbortError") {
    return new AiServiceError("cancelled", "The AI request was cancelled.", { cause: error });
  }
  return new AiServiceError(
    fallbackCode,
    "The AI service could not complete the request.",
    { cause: error, retryable: true },
  );
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, allowed, label, code = "invalid-response") {
  if (!isPlainObject(value)) {
    throw new AiServiceError(code, `${label} must be a JSON object.`);
  }
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new AiServiceError(code, `${label} contains an unexpected field.`);
    }
  }
}

function requireText(value, label, {
  allowEmpty = false,
  maxLength = MAX_RESULT_TEXT_LENGTH,
  code = "invalid-response",
} = {}) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.length > maxLength) {
    throw new AiServiceError(code, `${label} is not valid text.`);
  }
  return value;
}

function isIsoDate(value) {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeChannel(channel) {
  const value = String(channel ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(value)) {
    throw new AiServiceError("invalid-channel", "The AI access-code channel is invalid.");
  }
  return value;
}

function normalizeAccessCode(code) {
  const value = String(code ?? "").trim();
  if (!value || value.length > MAX_ACCESS_CODE_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new AiServiceError("invalid-access-code", "Enter a valid AI access code.");
  }
  return value;
}

export function createAiAccessStore({ storage, channel }) {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function" || typeof storage.removeItem !== "function") {
    throw new AiServiceError("access-storage-unavailable", "Browser storage is unavailable.");
  }
  const key = `${AI_ACCESS_KEY_PREFIX}:${normalizeChannel(channel)}`;

  return Object.freeze({
    key,
    get() {
      try {
        const value = storage.getItem(key);
        return value === null ? "" : normalizeAccessCode(value);
      } catch (error) {
        if (error instanceof AiServiceError) throw error;
        throw new AiServiceError(
          "access-storage-unavailable",
          "The saved AI access code could not be read on this device.",
          { cause: error },
        );
      }
    },
    set(code) {
      const value = normalizeAccessCode(code);
      try {
        storage.setItem(key, value);
        if (storage.getItem(key) !== value) {
          throw new Error("Access-code readback did not match.");
        }
      } catch (error) {
        throw new AiServiceError(
          "access-storage-unavailable",
          "The AI access code could not be saved on this device.",
          { cause: error },
        );
      }
      return value;
    },
    clear() {
      try {
        storage.removeItem(key);
      } catch (error) {
        throw new AiServiceError(
          "access-storage-unavailable",
          "The AI access code could not be removed from this device.",
          { cause: error },
        );
      }
    },
  });
}

function normalizeBackendUrl(backendUrl) {
  let url;
  try {
    url = new URL(String(backendUrl ?? ""));
  } catch (error) {
    throw new AiServiceError("backend-not-configured", "The AI service address is not configured.", { cause: error });
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new AiServiceError("backend-not-configured", "The AI service needs a valid HTTPS address.");
  }
  return url.href.replace(/\/+$/, "");
}

const BACKEND_ERROR_COPY = Object.freeze({
  ai_disabled: Object.freeze(["ai-disabled", "AI is currently switched off for this test.", false]),
  service_not_configured: Object.freeze(["service-not-configured", "The AI service setup is incomplete.", false]),
  openai_key_invalid: Object.freeze(["service-not-configured", "The AI service credential needs attention.", false]),
  upstream_invalid_request: Object.freeze(["provider-request-invalid", "The AI provider rejected the request configuration.", false]),
  upstream_auth_failed: Object.freeze(["provider-auth-failed", "The AI service credential needs attention.", false]),
  upstream_model_unavailable: Object.freeze(["provider-model-unavailable", "The configured AI model is unavailable.", false]),
  upstream_timeout: Object.freeze(["timeout", "The AI service took too long to respond.", true]),
  upstream_quota_or_rate_limit: Object.freeze(["rate-limited", "The AI provider quota or rate limit was reached. Try again later.", true]),
  upstream_rate_limited: Object.freeze(["rate-limited", "The AI provider limit was reached. Try again later.", true]),
  upstream_unavailable: Object.freeze(["backend-unavailable", "The AI service is temporarily unavailable.", true]),
  upstream_rejected_request: Object.freeze(["provider-rejected", "The AI provider rejected the request.", false]),
  upstream_invalid_response: Object.freeze(["invalid-response", "The AI service returned an invalid response.", true]),
  assist_incomplete: Object.freeze(["assist-incomplete", "The AI response was incomplete. Try again.", true]),
  assist_refused: Object.freeze(["assist-refused", "The AI service could not complete that assist action.", false]),
});

function safeBackendErrorCode(value) {
  if (!isPlainObject(value) || Object.keys(value).length !== 1 || !isPlainObject(value.error)) return "";
  const keys = Object.keys(value.error).sort();
  if (keys.length !== 2 || keys[0] !== "code" || keys[1] !== "message") return "";
  const code = value.error.code;
  return typeof code === "string" && /^[a-z0-9_]{1,64}$/.test(code) ? code : "";
}

async function backendErrorCode(response) {
  try {
    const type = response.headers?.get?.("content-type")?.toLowerCase() ?? "";
    if (!type.includes("application/json")) return "";
    const declaredLength = response.headers?.get?.("content-length") ?? "";
    if (/^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_BACKEND_ERROR_LENGTH) {
      await response.body?.cancel?.();
      return "";
    }
    const reader = response.body?.getReader?.();
    if (!reader) return "";
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BACKEND_ERROR_LENGTH) {
          await reader.cancel();
          return "";
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock?.();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = decoder.decode(bytes);
    if (!text) return "";
    return safeBackendErrorCode(JSON.parse(text));
  } catch {
    return "";
  }
}

function statusError(status, backendCode = "") {
  const mapped = Object.hasOwn(BACKEND_ERROR_COPY, backendCode)
    ? BACKEND_ERROR_COPY[backendCode]
    : null;
  if (mapped) {
    return new AiServiceError(mapped[0], mapped[1], {
      status,
      retryable: mapped[2],
    });
  }
  if (status === 401 || status === 403) {
    return new AiServiceError("access-denied", "The AI access code was not accepted.", { status });
  }
  if (status === 404) {
    return new AiServiceError("backend-not-configured", "The AI service endpoint is unavailable.", { status });
  }
  if (status === 408 || status === 504) {
    return new AiServiceError("timeout", "The AI service took too long to respond.", { status, retryable: true });
  }
  if (status === 413) {
    return new AiServiceError("request-too-large", "That note is too large for the AI service.", { status });
  }
  if (status === 429) {
    return new AiServiceError("rate-limited", "The AI service limit has been reached. Try again later.", { status, retryable: true });
  }
  if (status >= 500) {
    return new AiServiceError("backend-unavailable", "The AI service is temporarily unavailable.", { status, retryable: true });
  }
  return new AiServiceError("request-rejected", "The AI service rejected the request.", { status });
}

function requireExactKeys(value, keys, label, code = "invalid-response") {
  assertExactKeys(value, keys, label, code);
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new AiServiceError(code, `${label} is missing a required field.`);
  }
}

function summaryText(result) {
  const sections = [requireText(result.summary, "The fortnight summary", { maxLength: 6_000 }).trim()];
  if (result.highlights.length) {
    sections.push(`Highlights:\n${result.highlights.map((item) => `- ${item.trim()}`).join("\n")}`);
  }
  if (result.follow_ups.length) {
    sections.push(`To-do list:\n${result.follow_ups.map((item) => `- ${item.trim()}`).join("\n")}`);
  }
  return sections.join("\n\n");
}

function validateAssistResult(action, envelope, requestMeta) {
  requireExactKeys(envelope, ["action", "result"], "The AI service response");
  if (envelope.action !== action) {
    throw new AiServiceError("invalid-response", "The AI service returned the wrong action.");
  }
  const value = envelope.result;
  if (action === "organise_note") {
    requireExactKeys(value, ["organised_text"], "The organised-note result");
    return Object.freeze({
      kind: "organise",
      text: requireText(value.organised_text, "The organised note", { maxLength: 8_000 }),
    });
  }
  if (action === "extract_follow_up") {
    requireExactKeys(value, ["has_follow_up", "follow_up_text", "assignee", "due_date"], "The to-do result");
    if (typeof value.has_follow_up !== "boolean") {
      throw new AiServiceError("invalid-response", "The to-do result has an invalid status.");
    }
    if (value.due_date !== null && !isIsoDate(value.due_date)) {
      throw new AiServiceError("invalid-response", "The to-do due date is invalid.");
    }
    if (value.assignee !== null && (typeof value.assignee !== "string" || value.assignee.length > 200)) {
      throw new AiServiceError("invalid-response", "The to-do assignee is invalid.");
    }
    if (!value.has_follow_up) {
      if (String(value.follow_up_text || "").trim() || value.assignee !== null || value.due_date !== null) {
        throw new AiServiceError("invalid-response", "The no-to-do result contains contradictory details.");
      }
      return Object.freeze({ kind: "no-followup", sourceDate: requestMeta.sourceDate });
    }
    const description = requireText(value.follow_up_text, "The to-do description", { maxLength: 3_000 }).trim();
    const assignee = String(value.assignee || "").trim();
    return Object.freeze({
      kind: "followup",
      description: assignee ? `${description}\n\nAssignee: ${assignee}` : description,
      dueDate: value.due_date,
      sourceDate: requestMeta.sourceDate,
    });
  }
  requireExactKeys(value, ["summary", "highlights", "follow_ups"], "The fortnight-summary result");
  for (const [field, maximum] of [["highlights", 12], ["follow_ups", 20]]) {
    if (!Array.isArray(value[field]) || value[field].length > maximum || value[field].some((item) => typeof item !== "string" || !item.trim() || item.length > 1_000)) {
      throw new AiServiceError("invalid-response", `The ${field.replace("_", "-")} list is invalid.`);
    }
  }
  return Object.freeze({ kind: "summary", text: summaryText(value) });
}

function addUtcDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function serializeAssistPayload(action, payload) {
  if (!ASSIST_ACTIONS.has(action)) {
    throw new AiServiceError("invalid-action", "That AI work-note action is not supported.");
  }
  if (!isPlainObject(payload)) {
    throw new AiServiceError("invalid-request", "The AI request payload must be an object.");
  }
  let text;
  let requestMeta = Object.freeze({});
  if (action === "organise_note" || action === "extract_follow_up") {
    requireExactKeys(payload, ["note", "sourceDate"], "The note request", "invalid-request");
    const note = requireText(payload.note, "The Work Note", {
      maxLength: MAX_ASSIST_TEXT_LENGTH,
      code: "invalid-request",
    }).trim();
    if (!isIsoDate(payload.sourceDate)) {
      throw new AiServiceError("invalid-request", "The source note date is invalid.");
    }
    text = action === "extract_follow_up"
      ? `Source note date: ${payload.sourceDate}\n\nWork note:\n${note}`
      : note;
    requestMeta = Object.freeze({ sourceDate: payload.sourceDate });
  } else {
    requireExactKeys(payload, ["startDate", "endDate", "notes"], "The fortnight request", "invalid-request");
    if (!isIsoDate(payload.startDate) || !isIsoDate(payload.endDate) || payload.endDate !== addUtcDays(payload.startDate, 13)) {
      throw new AiServiceError("invalid-request", "The fortnight dates are invalid.");
    }
    if (!Array.isArray(payload.notes) || payload.notes.length !== 14) {
      throw new AiServiceError("invalid-request", "The fortnight request must contain exactly 14 displayed dates.");
    }
    const lines = payload.notes.map((item, index) => {
      requireExactKeys(item, ["date", "text"], "A fortnight note", "invalid-request");
      const expectedDate = addUtcDays(payload.startDate, index);
      if (item.date !== expectedDate || typeof item.text !== "string") {
        throw new AiServiceError("invalid-request", "The fortnight notes are not the displayed consecutive dates.");
      }
      return `[${item.date}]\n${item.text.trim() || "(No note recorded.)"}`;
    });
    text = `Displayed fortnight: ${payload.startDate} to ${payload.endDate}\n\n${lines.join("\n\n")}`;
  }
  if (text.length > MAX_ASSIST_TEXT_LENGTH) {
    throw new AiServiceError("request-too-large", "That note is too large for the AI service.");
  }
  let body;
  try {
    body = JSON.stringify({ action, text });
  } catch (error) {
    throw new AiServiceError("invalid-request", "The AI request payload is not valid JSON.", { cause: error });
  }
  if (!body || body.length > MAX_ASSIST_PAYLOAD_LENGTH) {
    throw new AiServiceError("request-too-large", "That note is too large for the AI service.");
  }
  return Object.freeze({ body, requestMeta });
}

export function createAiBackendClient({ backendUrl, accessStore, fetchFn }) {
  const baseUrl = normalizeBackendUrl(backendUrl);
  if (!accessStore || typeof accessStore.get !== "function") {
    throw new AiServiceError("access-storage-unavailable", "An AI access-code store is required.");
  }
  if (typeof fetchFn !== "function") {
    throw new AiServiceError("backend-unavailable", "Network requests are unavailable in this browser.");
  }

  async function request(path, init, { signal, timeoutMs = REALTIME_REQUEST_TIMEOUT_MS } = {}) {
    if (signal?.aborted) throw new AiServiceError("cancelled", "The AI request was cancelled.");
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort(signal?.reason);
    signal?.addEventListener?.("abort", abortFromCaller, { once: true });
    const timeoutId = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetchFn(`${baseUrl}${path}`, { ...init, signal: controller.signal });
      if (!response || typeof response.ok !== "boolean" || typeof response.status !== "number") {
        throw new AiServiceError("invalid-response", "The AI service returned an invalid response.");
      }
      if (!response.ok) throw statusError(response.status, await backendErrorCode(response));
      return response;
    } catch (error) {
      if (error instanceof AiServiceError) throw error;
      if (timedOut) {
        throw new AiServiceError("timeout", "The AI service took too long to respond.", { cause: error, retryable: true });
      }
      if (signal?.aborted || error?.name === "AbortError") {
        throw new AiServiceError("cancelled", "The AI request was cancelled.", { cause: error });
      }
      throw new AiServiceError("network", "The AI service could not be reached.", { cause: error, retryable: true });
    } finally {
      globalThis.clearTimeout(timeoutId);
      signal?.removeEventListener?.("abort", abortFromCaller);
    }
  }

  function accessCode() {
    const code = accessStore.get();
    if (!code) throw new AiServiceError("access-code-required", "Enter the AI access code for this device.");
    return normalizeAccessCode(code);
  }

  return Object.freeze({
    backendUrl: baseUrl,
    async createRealtimeSession(sdp, { signal } = {}) {
      const offer = requireText(sdp, "The realtime connection offer", {
        maxLength: MAX_SDP_LENGTH,
        code: "invalid-request",
      });
      if (!offer.startsWith("v=0")) {
        throw new AiServiceError("invalid-request", "The realtime connection offer is invalid.");
      }
      const response = await request("/v1/work-notes/realtime", {
        method: "POST",
        headers: {
          Accept: "application/sdp",
          "Content-Type": "application/sdp",
          "X-Tatiara-Access": accessCode(),
        },
        body: offer,
      }, { signal, timeoutMs: REALTIME_REQUEST_TIMEOUT_MS });
      const type = response.headers?.get?.("content-type")?.toLowerCase() ?? "";
      if (!type.includes("application/sdp")) {
        throw new AiServiceError("invalid-response", "The AI service did not return a realtime connection.");
      }
      const answer = await response.text();
      if (!answer || answer.length > MAX_SDP_LENGTH || !answer.startsWith("v=0")) {
        throw new AiServiceError("invalid-response", "The AI service returned an invalid realtime connection.");
      }
      return answer;
    },
    async assist(action, payload, { signal } = {}) {
      const { body, requestMeta } = serializeAssistPayload(action, payload);
      const response = await request("/v1/work-notes/assist", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Tatiara-Access": accessCode(),
        },
        body,
      }, { signal, timeoutMs: ASSIST_REQUEST_TIMEOUT_MS });
      const type = response.headers?.get?.("content-type")?.toLowerCase() ?? "";
      if (!type.includes("application/json")) {
        throw new AiServiceError("invalid-response", "The AI service did not return JSON.");
      }
      let value;
      try {
        value = await response.json();
      } catch (error) {
        throw new AiServiceError("invalid-response", "The AI service returned invalid JSON.", { cause: error });
      }
      return validateAssistResult(action, value, requestMeta);
    },
  });
}

export function insertAiText(source, inserted, selectionStart, selectionEnd) {
  const current = String(source ?? "");
  const addition = String(inserted ?? "").trim();
  const start = Number.isInteger(selectionStart)
    ? Math.max(0, Math.min(selectionStart, current.length))
    : current.length;
  const end = Number.isInteger(selectionEnd)
    ? Math.max(start, Math.min(selectionEnd, current.length))
    : start;
  if (!addition) return { text: current, cursor: start };
  const before = current.slice(0, start);
  const after = current.slice(end);
  const leadingBreak = before && !before.endsWith("\n") ? "\n\n" : "";
  const trailingBreak = after && !after.startsWith("\n") ? "\n\n" : "";
  return {
    text: `${before}${leadingBreak}${addition}${trailingBreak}${after}`,
    cursor: before.length + leadingBreak.length + addition.length,
  };
}

export function createTranscriptAccumulator() {
  const items = new Map();
  const order = [];

  function entryFor(itemId) {
    let entry = items.get(itemId);
    if (!entry) {
      entry = { partial: "", confirmed: "", completed: false };
      items.set(itemId, entry);
      order.push(itemId);
    }
    return entry;
  }

  function joined(field, completed) {
    return order
      .map((itemId) => items.get(itemId))
      .filter((entry) => entry.completed === completed)
      .map((entry) => entry[field].trim())
      .filter(Boolean)
      .join("\n\n");
  }

  return Object.freeze({
    ingest(event) {
      const type = event?.type;
      if (!["conversation.item.input_audio_transcription.delta", "conversation.item.input_audio_transcription.completed"].includes(type)) {
        return { handled: false, completed: false, itemId: null };
      }
      const itemId = typeof event.item_id === "string" ? event.item_id.trim() : "";
      if (!itemId) throw new AiServiceError("invalid-realtime-event", "A transcription event has no item ID.");
      const entry = entryFor(itemId);
      if (type.endsWith(".delta")) {
        if (typeof event.delta !== "string") {
          throw new AiServiceError("invalid-realtime-event", "A transcription delta is invalid.");
        }
        if (!entry.completed) entry.partial += event.delta;
        return { handled: true, completed: false, itemId };
      }
      if (typeof event.transcript !== "string") {
        throw new AiServiceError("invalid-realtime-event", "A completed transcript is invalid.");
      }
      entry.confirmed = event.transcript;
      entry.partial = "";
      entry.completed = true;
      return { handled: true, completed: true, itemId };
    },
    get confirmed() {
      return joined("confirmed", true);
    },
    get partial() {
      return joined("partial", false);
    },
    snapshot() {
      return Object.freeze({ confirmed: joined("confirmed", true), partial: joined("partial", false) });
    },
    reset() {
      items.clear();
      order.length = 0;
    },
  });
}

function safeCallback(callback, value) {
  try {
    callback?.(value);
  } catch {
    // UI callbacks cannot be allowed to leak microphone or connection resources.
  }
}

function stopStream(stream) {
  for (const track of stream?.getTracks?.() ?? []) {
    try {
      track.stop();
    } catch {
      // A track that already ended needs no further cleanup.
    }
  }
}

export function createWebRtcTranscriber({
  backendClient,
  mediaDevices,
  RTCPeerConnectionCtor,
  windowTarget,
  onState,
  onTranscript,
  onError,
}) {
  if (!backendClient || typeof backendClient.createRealtimeSession !== "function") {
    throw new AiServiceError("backend-not-configured", "A realtime AI backend client is required.");
  }
  if (typeof mediaDevices?.getUserMedia !== "function" || typeof RTCPeerConnectionCtor !== "function") {
    throw new AiServiceError("microphone-unsupported", "This browser cannot run live AI dictation.");
  }
  const timers = windowTarget ?? globalThis;
  const accumulator = createTranscriptAccumulator();
  let currentState = "idle";
  let confirmedText = "";
  let generation = 0;
  let stream = null;
  let peer = null;
  let channel = null;
  let requestController = null;
  let maximumTimer = null;
  let maximumRemainingMs = MAX_DICTATION_MS;
  let recordingStartedAt = null;
  let finalTimer = null;
  let pausePromise = null;
  let pauseResolve = null;
  let pauseReject = null;
  let finishPromise = null;
  let finishResolve = null;
  let finishReject = null;
  let closingResources = false;
  let pagehideAttached = false;

  function handlePagehide() {
    cancel();
  }

  function attachPagehide() {
    if (pagehideAttached || typeof windowTarget?.addEventListener !== "function") return;
    try {
      windowTarget.addEventListener("pagehide", handlePagehide);
      pagehideAttached = true;
    } catch {
      // Dictation can still clean up explicitly if page lifecycle events are unavailable.
    }
  }

  function detachPagehide() {
    if (!pagehideAttached) return;
    pagehideAttached = false;
    try {
      windowTarget?.removeEventListener?.("pagehide", handlePagehide);
    } catch {
      // Some embedded browsers expose incomplete event-target implementations.
    }
  }

  function setState(next) {
    if (currentState === next) return;
    currentState = next;
    safeCallback(onState, next);
  }

  function emitTranscript() {
    const snapshot = accumulator.snapshot();
    confirmedText = snapshot.confirmed;
    safeCallback(onTranscript, snapshot);
  }

  function clearTimers() {
    if (maximumTimer !== null) timers.clearTimeout(maximumTimer);
    if (finalTimer !== null) timers.clearTimeout(finalTimer);
    maximumTimer = null;
    finalTimer = null;
    recordingStartedAt = null;
  }

  function timerNow() {
    return typeof timers.now === "function" ? Number(timers.now()) : Date.now();
  }

  function pauseMaximumTimer() {
    if (maximumTimer !== null) timers.clearTimeout(maximumTimer);
    maximumTimer = null;
    if (recordingStartedAt !== null) {
      maximumRemainingMs = Math.max(0, maximumRemainingMs - Math.max(0, timerNow() - recordingStartedAt));
    }
    recordingStartedAt = null;
  }

  function scheduleMaximumTimer() {
    pauseMaximumTimer();
    if (maximumRemainingMs <= 0) {
      void finish().catch(() => {});
      return;
    }
    recordingStartedAt = timerNow();
    maximumTimer = timers.setTimeout(() => {
      maximumTimer = null;
      maximumRemainingMs = 0;
      recordingStartedAt = null;
      void finish().catch(() => {});
    }, maximumRemainingMs);
  }

  function closeResources() {
    if (closingResources) return;
    closingResources = true;
    detachPagehide();
    clearTimers();
    requestController?.abort();
    requestController = null;
    stopStream(stream);
    stream = null;
    if (channel) {
      try {
        channel.close();
      } catch {
        // Closing an already closed data channel is harmless.
      }
    }
    channel = null;
    if (peer) {
      try {
        peer.close();
      } catch {
        // Closing an already closed peer is harmless.
      }
    }
    peer = null;
    closingResources = false;
  }

  function settleFinish(error = null) {
    const resolve = finishResolve;
    const reject = finishReject;
    finishResolve = null;
    finishReject = null;
    finishPromise = null;
    if (error) reject?.(error);
    else resolve?.(confirmedText);
  }

  function settlePause(error = null) {
    const resolve = pauseResolve;
    const reject = pauseReject;
    pauseResolve = null;
    pauseReject = null;
    pausePromise = null;
    if (error) reject?.(error);
    else resolve?.(confirmedText);
  }

  function fail(error) {
    const safe = asAiError(error, "realtime-failed");
    setState("error");
    closeResources();
    settlePause(safe);
    settleFinish(safe);
    safeCallback(onError, safe);
    return safe;
  }

  function handleServerEvent(messageEvent) {
    let event;
    try {
      event = JSON.parse(messageEvent?.data);
    } catch (error) {
      fail(new AiServiceError("invalid-realtime-event", "The realtime service sent an invalid event.", { cause: error }));
      return;
    }
    if (event?.type === "error" || event?.type === "conversation.item.input_audio_transcription.failed") {
      fail(new AiServiceError("transcription-failed", "Live transcription failed. Your Work Note was not changed.", { retryable: true }));
      return;
    }
    try {
      const result = accumulator.ingest(event);
      if (!result.handled) return;
      emitTranscript();
      if (result.completed && currentState === "pausing") {
        if (finalTimer !== null) timers.clearTimeout(finalTimer);
        finalTimer = null;
        setState("paused");
        settlePause();
      } else if (result.completed && currentState === "finishing") {
        if (!confirmedText.trim()) {
          fail(new AiServiceError("empty-transcript", "No speech could be transcribed."));
          return;
        }
        setState("completed");
        closeResources();
        settleFinish();
      }
    } catch (error) {
      fail(error);
    }
  }

  function waitForChannelOpen(target, activeGeneration) {
    if (target.readyState === "open") return Promise.resolve();
    return new Promise((resolve, reject) => {
      let timeoutId = null;
      const cleanup = () => {
        if (timeoutId !== null) timers.clearTimeout(timeoutId);
        target.removeEventListener?.("open", opened);
        target.removeEventListener?.("close", closed);
        target.removeEventListener?.("error", errored);
      };
      const opened = () => {
        cleanup();
        if (activeGeneration !== generation) reject(new AiServiceError("cancelled", "Live dictation was cancelled."));
        else resolve();
      };
      const closed = () => {
        cleanup();
        reject(new AiServiceError("realtime-closed", "The realtime connection closed before dictation started.", { retryable: true }));
      };
      const errored = () => {
        cleanup();
        reject(new AiServiceError("realtime-failed", "The realtime connection could not start.", { retryable: true }));
      };
      target.addEventListener?.("open", opened, { once: true });
      target.addEventListener?.("close", closed, { once: true });
      target.addEventListener?.("error", errored, { once: true });
      timeoutId = timers.setTimeout(() => {
        cleanup();
        reject(new AiServiceError("realtime-timeout", "The realtime connection took too long to start.", { retryable: true }));
      }, DATA_CHANNEL_TIMEOUT_MS);
    });
  }

  function ensureActiveState(expected, message) {
    if (!expected.includes(currentState)) throw new AiServiceError("invalid-state", message);
  }

  async function start() {
    ensureActiveState(["idle", "completed", "cancelled", "error"], "Live dictation is already active.");
    generation += 1;
    const activeGeneration = generation;
    closeResources();
    accumulator.reset();
    confirmedText = "";
    maximumRemainingMs = MAX_DICTATION_MS;
    recordingStartedAt = null;
    emitTranscript();
    setState("connecting");
    let openedStream = null;
    try {
      attachPagehide();
      openedStream = await mediaDevices.getUserMedia({ audio: true });
      if (activeGeneration !== generation || currentState !== "connecting") {
        throw new AiServiceError("cancelled", "Live dictation was cancelled.");
      }
      const audioTracks = openedStream.getAudioTracks?.() ?? openedStream.getTracks?.() ?? [];
      if (!audioTracks.length) {
        throw new AiServiceError("microphone-missing", "No microphone audio track was available.");
      }
      stream = openedStream;
      for (const track of audioTracks) track.enabled = false;
      peer = new RTCPeerConnectionCtor();
      for (const track of audioTracks) peer.addTrack(track, stream);
      channel = peer.createDataChannel("oai-events");
      channel.addEventListener?.("message", handleServerEvent);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      requestController = new AbortController();
      const answerSdp = await backendClient.createRealtimeSession(offer.sdp, { signal: requestController.signal });
      requestController = null;
      if (activeGeneration !== generation || currentState !== "connecting") {
        throw new AiServiceError("cancelled", "Live dictation was cancelled.");
      }
      await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
      await waitForChannelOpen(channel, activeGeneration);
      if (activeGeneration !== generation || currentState !== "connecting") {
        throw new AiServiceError("cancelled", "Live dictation was cancelled.");
      }
      channel.addEventListener?.("error", () => fail(new AiServiceError("realtime-failed", "The live dictation connection failed.", { retryable: true })));
      channel.addEventListener?.("close", () => {
        if (!closingResources && ["recording", "pausing", "paused", "finishing"].includes(currentState)) {
          fail(new AiServiceError("realtime-closed", "The live dictation connection closed unexpectedly.", { retryable: true }));
        }
      });
      for (const track of audioTracks) track.enabled = true;
      setState("recording");
      scheduleMaximumTimer();
      return currentState;
    } catch (error) {
      if (openedStream && openedStream !== stream) stopStream(openedStream);
      if (activeGeneration !== generation || currentState === "cancelled") throw asAiError(error, "cancelled");
      throw fail(error);
    }
  }

  function pause() {
    ensureActiveState(["recording"], "Live dictation is not recording.");
    pauseMaximumTimer();
    for (const track of stream?.getAudioTracks?.() ?? stream?.getTracks?.() ?? []) track.enabled = false;
    setState("pausing");
    pausePromise = new Promise((resolve, reject) => {
      pauseResolve = resolve;
      pauseReject = reject;
    });
    const pendingPause = pausePromise;
    try {
      if (!channel || channel.readyState !== "open") {
        throw new AiServiceError("realtime-closed", "The live dictation connection is no longer open.", { retryable: true });
      }
      channel.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      finalTimer = timers.setTimeout(() => {
        fail(new AiServiceError("transcription-timeout", "The paused words took too long to finish.", { retryable: true }));
      }, FINAL_TRANSCRIPT_TIMEOUT_MS);
    } catch (error) {
      fail(error);
    }
    return pendingPause;
  }

  function resume() {
    ensureActiveState(["paused"], "Live dictation is not paused.");
    for (const track of stream?.getAudioTracks?.() ?? stream?.getTracks?.() ?? []) track.enabled = true;
    setState("recording");
    scheduleMaximumTimer();
  }

  function finish() {
    if (currentState === "completed") return Promise.resolve(confirmedText);
    if (currentState === "finishing" && finishPromise) return finishPromise;
    ensureActiveState(["recording", "paused"], "Live dictation is not active.");
    pauseMaximumTimer();
    if (currentState === "paused") {
      if (!confirmedText.trim()) {
        return Promise.reject(fail(new AiServiceError("empty-transcript", "No speech could be transcribed.")));
      }
      setState("completed");
      closeResources();
      return Promise.resolve(confirmedText);
    }
    setState("finishing");
    for (const track of stream?.getAudioTracks?.() ?? stream?.getTracks?.() ?? []) {
      track.enabled = false;
    }
    stopStream(stream);
    stream = null;
    finishPromise = new Promise((resolve, reject) => {
      finishResolve = resolve;
      finishReject = reject;
    });
    const pendingFinish = finishPromise;
    try {
      if (!channel || channel.readyState !== "open") {
        throw new AiServiceError("realtime-closed", "The live dictation connection is no longer open.", { retryable: true });
      }
      channel.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      finalTimer = timers.setTimeout(() => {
        fail(new AiServiceError("transcription-timeout", "The final transcript took too long to arrive.", { retryable: true }));
      }, FINAL_TRANSCRIPT_TIMEOUT_MS);
    } catch (error) {
      fail(error);
    }
    return pendingFinish;
  }

  function cancel() {
    generation += 1;
    const cancellation = new AiServiceError("cancelled", "Live dictation was cancelled.");
    setState("cancelled");
    closeResources();
    accumulator.reset();
    confirmedText = "";
    settlePause(cancellation);
    emitTranscript();
    settleFinish(cancellation);
  }

  return Object.freeze({
    get state() {
      return currentState;
    },
    get text() {
      return confirmedText;
    },
    start,
    pause,
    resume,
    finish,
    cancel,
  });
}

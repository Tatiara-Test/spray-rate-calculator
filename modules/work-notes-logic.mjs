import { WORK_NOTES_KEY } from "./storage.mjs";

export const APP_VERSION = 1;
export const STORAGE_KEY = WORK_NOTES_KEY;
export const ANCHOR_DATE = "2026-07-27";
export const DAY_MS = 86_400_000;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FOLLOW_UP_STATES = new Set(["open", "done"]);

export function isIsoDate(value) {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function todayIso(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(dateIso, amount) {
  if (!isIsoDate(dateIso) || !Number.isInteger(amount)) {
    throw new TypeError("A valid ISO date and whole-day amount are required.");
  }
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(fromIso, toIso) {
  if (!isIsoDate(fromIso) || !isIsoDate(toIso)) {
    throw new TypeError("Valid ISO dates are required.");
  }
  return Math.round(
    (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS,
  );
}

export function fortnightStartFor(dateIso, anchorIso = ANCHOR_DATE) {
  const offset = daysBetween(anchorIso, dateIso);
  return addDays(anchorIso, Math.floor(offset / 14) * 14);
}

export function getFortnightDates(startIso) {
  if (!isIsoDate(startIso)) throw new TypeError("A valid fortnight start is required.");
  return Array.from({ length: 14 }, (_, index) => addDays(startIso, index));
}

export function createEmptyData() {
  return {
    version: APP_VERSION,
    notes: {},
    copied: {},
    followUps: [],
  };
}

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  const cleaned = [];
  for (const item of history) {
    if (!item || typeof item !== "object" || typeof item.text !== "string") continue;
    cleaned.push({
      text: item.text,
      savedAt: typeof item.savedAt === "string" ? item.savedAt : "",
    });
  }
  return cleaned.slice(-10);
}

function cleanNotes(notes) {
  if (!notes || typeof notes !== "object" || Array.isArray(notes)) return {};
  const result = {};
  for (const [date, note] of Object.entries(notes)) {
    if (!isIsoDate(date) || !note || typeof note !== "object" || typeof note.text !== "string") {
      continue;
    }
    result[date] = {
      text: note.text,
      updatedAt: typeof note.updatedAt === "string" ? note.updatedAt : "",
      history: cleanHistory(note.history),
    };
  }
  return result;
}

function cleanCopied(copied, notes) {
  if (!copied || typeof copied !== "object" || Array.isArray(copied)) return {};
  const result = {};
  for (const [date, value] of Object.entries(copied)) {
    if (value === true && isIsoDate(date) && notes[date]?.text.trim()) result[date] = true;
  }
  return result;
}

function cleanFollowUps(followUps) {
  if (!Array.isArray(followUps)) return [];
  const seen = new Set();
  const result = [];
  for (const item of followUps) {
    if (!item || typeof item !== "object") continue;
    const description = typeof item.description === "string" ? item.description.trim() : "";
    if (!description) continue;
    const id =
      typeof item.id === "string" && item.id.trim() && !seen.has(item.id)
        ? item.id
        : `followup-${result.length + 1}`;
    seen.add(id);
    const status = FOLLOW_UP_STATES.has(item.status) ? item.status : "open";
    const dueDate = isIsoDate(item.dueDate) ? item.dueDate : null;
    const sourceDate = isIsoDate(item.sourceDate) ? item.sourceDate : null;
    result.push({
      id,
      description,
      dueDate,
      sourceDate,
      status,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
      completedAt:
        status === "done" && typeof item.completedAt === "string" ? item.completedAt : null,
    });
  }
  return result;
}

export function normalizeBackup(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Backup must contain a JSON object.");
  }
  if ("version" in input) {
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw new TypeError("Backup has an invalid Work Notes version.");
    }
    if (input.version > APP_VERSION) {
      throw new RangeError(
        `This Work Notes backup uses version ${input.version}, but this app supports version ${APP_VERSION}.`,
      );
    }
  }
  if (!("notes" in input) || !("copied" in input) || !("followUps" in input)) {
    throw new TypeError("Backup is missing notes, copied state, or follow-ups.");
  }
  const notes = cleanNotes(input.notes);
  return {
    version: APP_VERSION,
    notes,
    copied: cleanCopied(input.copied, notes),
    followUps: cleanFollowUps(input.followUps),
  };
}

function assertStoredRecordsWereNotDiscarded(input, normalized) {
  const plainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const unsafe = () => {
    throw new TypeError(
      "Stored Work Notes contain malformed records that this app would have to discard.",
    );
  };

  if (!plainObject(input.notes) || !plainObject(input.copied) || !Array.isArray(input.followUps)) {
    unsafe();
  }
  if (Object.keys(input.notes).length !== Object.keys(normalized.notes).length) unsafe();
  if (Object.keys(input.copied).length !== Object.keys(normalized.copied).length) unsafe();
  if (input.followUps.length !== normalized.followUps.length) unsafe();

  for (const [date, note] of Object.entries(input.notes)) {
    const safeNote = normalized.notes[date];
    if (!safeNote) unsafe();
    if (typeof note.updatedAt !== "string") unsafe();
    if (note.history !== undefined) {
      if (!Array.isArray(note.history) || note.history.length !== safeNote.history.length) unsafe();
      for (let index = 0; index < note.history.length; index += 1) {
        const sourceHistory = note.history[index];
        const safeHistory = safeNote.history[index];
        if (!sourceHistory || typeof sourceHistory !== "object" || !safeHistory) unsafe();
        if (sourceHistory.text !== safeHistory.text) unsafe();
        if (typeof sourceHistory.savedAt !== "string") unsafe();
      }
    }
  }
  for (const date of Object.keys(input.copied)) {
    if (normalized.copied[date] !== true) unsafe();
  }
  for (let index = 0; index < input.followUps.length; index += 1) {
    const source = input.followUps[index];
    const safe = normalized.followUps[index];
    if (!source || typeof source !== "object" || !safe) unsafe();
    if (typeof source.id !== "string" || !source.id.trim() || source.id !== safe.id) unsafe();
    if (typeof source.status !== "string" || source.status !== safe.status) unsafe();
    if (source.dueDate != null && source.dueDate !== safe.dueDate) unsafe();
    if (source.sourceDate != null && source.sourceDate !== safe.sourceDate) unsafe();
    if (source.createdAt !== undefined && typeof source.createdAt !== "string") unsafe();
    if (source.updatedAt !== undefined && typeof source.updatedAt !== "string") unsafe();
    if (source.completedAt != null && source.completedAt !== safe.completedAt) unsafe();
  }
}

export function inspectStoredData(raw) {
  if (raw === null || raw === undefined) {
    return { state: "absent", raw: null, data: createEmptyData() };
  }
  if (typeof raw !== "string") {
    return {
      state: "corrupt",
      raw,
      data: null,
      error: "Stored Work Notes data is not text.",
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      state: "corrupt",
      raw,
      data: null,
      error: "Stored Work Notes data is not valid JSON.",
    };
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    Number.isInteger(parsed.version) &&
    parsed.version > APP_VERSION
  ) {
    return {
      state: "future",
      raw,
      data: null,
      version: parsed.version,
      error: `Stored Work Notes data uses unsupported version ${parsed.version}.`,
    };
  }

  try {
    const normalized = normalizeBackup(parsed);
    assertStoredRecordsWereNotDiscarded(parsed, normalized);
    return { state: "ready", raw, data: normalized };
  } catch (error) {
    return {
      state: "corrupt",
      raw,
      data: null,
      error: error instanceof Error ? error.message : "Stored Work Notes data is invalid.",
    };
  }
}

export function loadStoredData(raw) {
  const inspected = inspectStoredData(raw);
  if (inspected.state === "absent" || inspected.state === "ready") {
    return inspected.data;
  }
  throw new TypeError(inspected.error);
}

export function persistStoredData(storage, input) {
  if (!storage || typeof storage.setItem !== "function" || typeof storage.getItem !== "function") {
    throw new TypeError("Browser storage is unavailable.");
  }
  const data = normalizeBackup(input);
  const raw = JSON.stringify(data);
  storage.setItem(STORAGE_KEY, raw);
  const readback = storage.getItem(STORAGE_KEY);
  if (readback !== raw) {
    throw new Error("The Work Notes save could not be verified.");
  }
  const inspected = inspectStoredData(readback);
  if (inspected.state !== "ready") {
    throw new Error("The Work Notes save could not be read back safely.");
  }
  return { raw, data: inspected.data };
}

export function applyNoteChange(data, dateIso, nextText, options = {}) {
  if (!isIsoDate(dateIso) || typeof nextText !== "string") {
    throw new TypeError("A valid date and note text are required.");
  }
  const current = data.notes[dateIso] ?? { text: "", updatedAt: "", history: [] };
  if (current.text === nextText) return { data, changed: false, copiedCleared: false };

  const now = options.now ?? new Date().toISOString();
  const history = cleanHistory(current.history);
  if (options.capturePrevious && current.text) {
    const latest = history.at(-1);
    if (!latest || latest.text !== current.text) {
      history.push({ text: current.text, savedAt: current.updatedAt || now });
    }
  }

  const copiedCleared = data.copied[dateIso] === true;
  const notes = {
    ...data.notes,
    [dateIso]: {
      text: nextText,
      updatedAt: now,
      history: history.slice(-10),
    },
  };
  const copied = { ...data.copied };
  if (copiedCleared) delete copied[dateIso];

  return {
    changed: true,
    copiedCleared,
    data: { ...data, notes, copied },
  };
}

export function restorePreviousNote(data, dateIso, now = new Date().toISOString()) {
  const current = data.notes[dateIso];
  if (!current?.history?.length) return { data, restored: false };
  const history = cleanHistory(current.history);
  const previous = history.pop();
  if (!previous) return { data, restored: false };
  if (current.text !== previous.text) {
    history.push({
      text: current.text,
      savedAt: current.updatedAt || now,
    });
  }
  const copied = { ...data.copied };
  delete copied[dateIso];
  return {
    restored: true,
    text: previous.text,
    data: {
      ...data,
      copied,
      notes: {
        ...data.notes,
        [dateIso]: {
          text: previous.text,
          updatedAt: now,
          history,
        },
      },
    },
  };
}

export function classifyFollowUp(item, dateIso) {
  if (item.status === "done") return "done";
  if (!item.dueDate) return "no-date";
  if (item.dueDate === dateIso) return "today";
  return item.dueDate < dateIso ? "overdue" : "future";
}

export function sortOpenFollowUps(items, dateIso) {
  const rank = { overdue: 0, today: 1, future: 2, "no-date": 3 };
  return items
    .filter((item) => item.status === "open")
    .slice()
    .sort((a, b) => {
      const statusDifference =
        rank[classifyFollowUp(a, dateIso)] - rank[classifyFollowUp(b, dateIso)];
      if (statusDifference) return statusDifference;
      return (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31");
    });
}

export function formatLongDate(dateIso, locale = "en-AU") {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateIso}T00:00:00Z`));
}

export function formatShortDate(dateIso, locale = "en-AU") {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${dateIso}T00:00:00Z`));
}

export function fortnightTextExport(data, startIso) {
  const dates = getFortnightDates(startIso);
  const endIso = dates.at(-1);
  const lines = [
    "Pallathorpe Work Notes",
    `Fortnight: ${formatLongDate(startIso)} to ${formatLongDate(endIso)}`,
    "",
  ];
  for (const date of dates) {
    lines.push(formatLongDate(date));
    lines.push(data.notes[date]?.text.trim() || "(No note recorded)");
    lines.push("");
  }
  return {
    filename: `pallathorpe-work-notes_${startIso}_to_${endIso}.txt`,
    text: `${lines.join("\n").trimEnd()}\n`,
  };
}

export function backupExport(data, dateIso = todayIso()) {
  return {
    filename: `pallathorpe-work-notes-backup_${dateIso}.json`,
    text: `${JSON.stringify(normalizeBackup(data), null, 2)}\n`,
  };
}

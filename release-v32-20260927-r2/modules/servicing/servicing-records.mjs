import {
  SERVICE_DEFINITION_4830,
  serviceTasksForIntervalGroups,
} from "./4830-service-definition.mjs";
import { normalizePropertyIdentitySnapshot, propertyIdentitySnapshot } from "../property-settings.mjs";

export const SERVICING_RECORD_VERSION = 1;
export const TASK_STATES = Object.freeze(["not_started", "done", "not_applicable", "deferred"]);
export const FINAL_LIFECYCLES = Object.freeze(["finalised", "finalised_with_outstanding_items"]);

const text = (value) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "");
const noteText = (value) => (typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "");
const clone = (value) => JSON.parse(JSON.stringify(value));

function assertExactKeys(value, keys, context) {
  if (Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) {
    throw new TypeError(`${context} has an unexpected schema.`);
  }
}

function isoTimestamp(value, context) {
  if (typeof value !== "string") throw new TypeError(`${context} must be an ISO timestamp.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${context} must be an ISO timestamp.`);
  }
  return value;
}

function serviceDate(value, context = "Service date") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${context} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TypeError(`${context} is not a real calendar date.`);
  }
  return value;
}

function localDate(now) {
  const parsed = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(parsed.getTime())) throw new TypeError("A valid current time is required.");
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function nonNegativeHours(value, { allowNull = false } = {}) {
  if (allowNull && (value === null || value === "" || value === undefined)) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError("Engine hours must be a non-negative number.");
  }
  return value;
}

function definitionSnapshot() {
  return {
    definitionId: SERVICE_DEFINITION_4830.definitionId,
    definitionVersion: SERVICE_DEFINITION_4830.definitionVersion,
    definitionHash: SERVICE_DEFINITION_4830.definitionHash,
    acceptanceStatus: SERVICE_DEFINITION_4830.acceptance.status,
  };
}

function taskSnapshot(task) {
  const sourceNoteIds = SERVICE_DEFINITION_4830.sourceNotes
    .filter(({ appliesToTaskIds }) => appliesToTaskIds.includes(task.id))
    .map(({ id }) => id);
  return {
    taskId: task.id,
    label: task.label,
    section: task.section,
    source: { page: task.page, row: task.row, manualPage: task.manualPage },
    selectionGroups: [...task.selectionGroups],
    initialBreakIn: task.initialBreakIn,
    dealerServiceMarker: task.dealerServiceMarker,
    coolantIntervalFootnote: task.coolantIntervalFootnote,
    boomLocationLabels: [...task.boomLocationLabels],
    sourceNoteIds,
  };
}

function initialTaskResult(taskId, now) {
  return {
    taskId,
    state: "not_started",
    reason: null,
    note: "",
    followUpRequired: false,
    followUpNote: "",
    updatedAt: now,
  };
}

function assertTaskResult(result, expectedTaskId) {
  if (!result || typeof result !== "object" || Array.isArray(result) || result.taskId !== expectedTaskId) {
    throw new TypeError(`Servicing result for ${expectedTaskId} is invalid.`);
  }
  assertExactKeys(result, ["taskId", "state", "reason", "note", "followUpRequired", "followUpNote", "updatedAt"], `Servicing result ${expectedTaskId}`);
  if (!TASK_STATES.includes(result.state)) throw new TypeError(`Servicing result for ${expectedTaskId} has an invalid state.`);
  if (result.reason !== null && typeof result.reason !== "string") throw new TypeError(`Servicing result for ${expectedTaskId} has an invalid reason.`);
  if (typeof result.note !== "string" || typeof result.followUpRequired !== "boolean" || typeof result.followUpNote !== "string") {
    throw new TypeError(`Servicing result for ${expectedTaskId} has invalid notes or to-do state.`);
  }
  isoTimestamp(result.updatedAt, `Servicing result ${expectedTaskId} update time`);
  const reason = result.reason === null ? "" : text(result.reason);
  const note = noteText(result.note);
  const followUpNote = noteText(result.followUpNote);
  if ((result.state === "not_applicable" || result.state === "deferred") && !reason) {
    throw new TypeError(`${result.state === "deferred" ? "Deferred" : "Not-applicable"} task ${expectedTaskId} requires a reason.`);
  }
  if ((result.state === "not_started" || result.state === "done") && result.reason !== null) {
    throw new TypeError(`Task ${expectedTaskId} cannot carry an exception reason in state ${result.state}.`);
  }
  if (result.state === "not_started" && result.followUpRequired) {
    throw new TypeError(`Not-started task ${expectedTaskId} cannot be marked as a to-do.`);
  }
  if (result.followUpRequired && !followUpNote) throw new TypeError(`To-do task ${expectedTaskId} requires a note.`);
  if (!result.followUpRequired && followUpNote) throw new TypeError(`Task ${expectedTaskId} cannot retain a to-do note when the to-do is off.`);
  if (result.reason !== null && result.reason !== reason) throw new TypeError(`Task ${expectedTaskId} reason is not canonical.`);
  if (result.note !== note) throw new TypeError(`Task ${expectedTaskId} note is not canonical.`);
  if (result.followUpNote !== followUpNote) throw new TypeError(`Task ${expectedTaskId} to-do note is not canonical.`);
}

function expectedOutcome(results) {
  if (!results.length) return null;
  if (results.some(({ state }) => state === "not_started")) return null;
  return results.every(({ state, followUpRequired }) => state === "done" && !followUpRequired)
    ? "all_done"
    : "outstanding_items";
}

export function normalizeServicingRecord(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Servicing record must contain an object.");
  assertExactKeys(input, [
    "version", "recordId", "seriesId", "revision", "supersedesRecordId", "amendmentReason",
    "machine", "serviceDate", "engineHours", "operator", "selectedIntervalGroups", "definition",
    "taskSnapshot", "taskResults", "overallNotes", "lifecycle", "outcome", "createdAt", "updatedAt", "finalisedAt",
  ].concat(Object.hasOwn(input, "propertySnapshot") ? ["propertySnapshot"] : []), "Servicing record");
  const propertySnapshot = Object.hasOwn(input, "propertySnapshot")
    ? normalizePropertyIdentitySnapshot(input.propertySnapshot)
    : null;
  if (Object.hasOwn(input, "propertySnapshot")) {
    if (Object.keys(input.propertySnapshot).sort().join("|") !== "businessName|emblem|shortName"
      || input.propertySnapshot.businessName !== propertySnapshot.businessName
      || input.propertySnapshot.shortName !== propertySnapshot.shortName
      || Object.keys(input.propertySnapshot.emblem || {}).sort().join("|") !== "id|version") {
      throw new TypeError("Servicing property identity snapshot is not canonical.");
    }
  }
  if (input.version !== SERVICING_RECORD_VERSION) throw new TypeError("Servicing record has an unsupported version.");
  const recordId = text(input.recordId);
  const seriesId = text(input.seriesId);
  if (!recordId || recordId !== input.recordId || !seriesId || seriesId !== input.seriesId) throw new TypeError("Servicing record identity is invalid.");
  if (!Number.isInteger(input.revision) || input.revision < 1) throw new TypeError("Servicing record revision is invalid.");
  if (input.machine !== "4830") throw new TypeError("Only machine 4830 is supported.");
  serviceDate(input.serviceDate);
  nonNegativeHours(input.engineHours, { allowNull: input.lifecycle === "draft" });
  if (typeof input.operator !== "string" || input.operator !== text(input.operator)) throw new TypeError("Servicing operator is invalid.");
  if (!Array.isArray(input.selectedIntervalGroups) || new Set(input.selectedIntervalGroups).size !== input.selectedIntervalGroups.length) {
    throw new TypeError("Servicing interval selection is invalid.");
  }
  if (input.selectedIntervalGroups.some((group) => typeof group !== "string" || !group.trim() || group !== group.trim())) {
    throw new TypeError("Servicing interval selection is invalid.");
  }
  if (!input.definition || typeof input.definition !== "object" || Array.isArray(input.definition)
    || !text(input.definition.definitionId) || !Number.isInteger(input.definition.definitionVersion)
    || !/^sha256-[0-9a-f]{64}$/.test(input.definition.definitionHash)
    || !text(input.definition.acceptanceStatus)) {
    throw new TypeError("Servicing definition snapshot is invalid.");
  }
  assertExactKeys(input.definition, ["definitionId", "definitionVersion", "definitionHash", "acceptanceStatus"], "Servicing definition snapshot");
  if (!Array.isArray(input.taskSnapshot) || !Array.isArray(input.taskResults)
    || input.taskSnapshot.length !== input.taskResults.length) {
    throw new TypeError("Servicing task snapshot and results are incomplete.");
  }
  const snapshotIds = input.taskSnapshot.map(({ taskId }) => taskId);
  if (new Set(snapshotIds).size !== snapshotIds.length || new Set(input.taskResults.map(({ taskId }) => taskId)).size !== input.taskResults.length) {
    throw new TypeError("Servicing task identity is duplicated.");
  }
  input.taskSnapshot.forEach((snapshot, index) => {
    if (!snapshot || typeof snapshot !== "object" || snapshot.taskId !== snapshotIds[index]
      || !text(snapshot.label) || !["machine-excluding-boom", "boom"].includes(snapshot.section)
      || !snapshot.source || !Number.isInteger(snapshot.source.page) || !Number.isInteger(snapshot.source.row)
      || !text(snapshot.source.manualPage) || !Array.isArray(snapshot.selectionGroups)
      || typeof snapshot.initialBreakIn !== "boolean" || typeof snapshot.dealerServiceMarker !== "boolean"
      || typeof snapshot.coolantIntervalFootnote !== "boolean" || !Array.isArray(snapshot.boomLocationLabels)
      || !Array.isArray(snapshot.sourceNoteIds)) {
      throw new TypeError(`Servicing task snapshot ${index + 1} is invalid.`);
    }
    assertExactKeys(snapshot, [
      "taskId", "label", "section", "source", "selectionGroups", "initialBreakIn",
      "dealerServiceMarker", "coolantIntervalFootnote", "boomLocationLabels", "sourceNoteIds",
    ], `Servicing task snapshot ${index + 1}`);
    assertExactKeys(snapshot.source, ["page", "row", "manualPage"], `Servicing task snapshot ${index + 1} source`);
    assertTaskResult(input.taskResults[index], snapshot.taskId);
  });
  if (input.definition.definitionHash === SERVICE_DEFINITION_4830.definitionHash) {
    const currentTasks = input.selectedIntervalGroups.length
      ? serviceTasksForIntervalGroups(input.selectedIntervalGroups)
      : [];
    const expectedIds = currentTasks.map(({ id }) => id);
    if (JSON.stringify(snapshotIds) !== JSON.stringify(expectedIds)) {
      throw new TypeError("Servicing task snapshot does not match its selected intervals.");
    }
  }
  if (typeof input.overallNotes !== "string" || input.overallNotes !== noteText(input.overallNotes)) throw new TypeError("Servicing overall notes are invalid.");
  if (!input.createdAt || !input.updatedAt) throw new TypeError("Servicing timestamps are missing.");
  isoTimestamp(input.createdAt, "Servicing created time");
  isoTimestamp(input.updatedAt, "Servicing updated time");
  if (!input.lifecycle || !["draft", ...FINAL_LIFECYCLES].includes(input.lifecycle)) throw new TypeError("Servicing lifecycle is invalid.");
  const outcome = expectedOutcome(input.taskResults);
  if (input.lifecycle === "draft") {
    if (input.outcome !== null || input.finalisedAt !== null) throw new TypeError("Draft servicing record cannot have a final outcome.");
  } else {
    if (!input.selectedIntervalGroups.length || !input.taskSnapshot.length) {
      throw new TypeError("Finalised servicing records require at least one selected interval and task.");
    }
    if (outcome === null) throw new TypeError("Not-started tasks block servicing finalisation.");
    const expectedLifecycle = outcome === "all_done" ? "finalised" : "finalised_with_outstanding_items";
    if (input.lifecycle !== expectedLifecycle || input.outcome !== outcome) throw new TypeError("Servicing final outcome is inconsistent.");
    isoTimestamp(input.finalisedAt, "Servicing finalised time");
    if (input.engineHours === null || !text(input.operator)) throw new TypeError("Finalised servicing records require engine hours and operator.");
  }
  if (input.revision === 1) {
    if (input.supersedesRecordId !== null || input.amendmentReason !== null) throw new TypeError("First servicing revision cannot supersede another record.");
  } else if (!text(input.supersedesRecordId) || !text(input.amendmentReason)) {
    throw new TypeError("Servicing amendment requires its prior record and reason.");
  }
  return {
    ...clone(input),
    ...(Object.hasOwn(input, "propertySnapshot") ? { propertySnapshot } : {}),
  };
}

export function createServicingDraft({
  recordId,
  serviceDate: date,
  engineHours = null,
  operator = "",
  selectedIntervalGroups = [],
  overallNotes = "",
}, now = new Date().toISOString()) {
  isoTimestamp(now, "Servicing created time");
  const id = text(recordId);
  if (!id || id !== recordId) throw new TypeError("A stable servicing record id is required.");
  serviceDate(date);
  const tasks = selectedIntervalGroups.length ? serviceTasksForIntervalGroups(selectedIntervalGroups) : [];
  return normalizeServicingRecord({
    version: SERVICING_RECORD_VERSION,
    recordId: id,
    seriesId: id,
    revision: 1,
    supersedesRecordId: null,
    amendmentReason: null,
    machine: "4830",
    serviceDate: date,
    engineHours: nonNegativeHours(engineHours, { allowNull: true }),
    operator: text(operator),
    selectedIntervalGroups: [...selectedIntervalGroups],
    definition: definitionSnapshot(),
    taskSnapshot: tasks.map(taskSnapshot),
    taskResults: tasks.map(({ id: taskId }) => initialTaskResult(taskId, now)),
    overallNotes: noteText(overallNotes),
    lifecycle: "draft",
    outcome: null,
    createdAt: now,
    updatedAt: now,
    finalisedAt: null,
  });
}

export function updateServicingTask(record, taskId, changes, now = new Date().toISOString()) {
  const value = normalizeServicingRecord(record);
  if (value.lifecycle !== "draft") throw new Error("Finalised servicing records are locked; create an amendment instead.");
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw new TypeError("Servicing task changes must contain an object.");
  isoTimestamp(now, "Servicing task update time");
  const index = value.taskResults.findIndex((result) => result.taskId === taskId);
  if (index < 0) throw new RangeError(`Servicing task ${taskId} is not part of this record.`);
  const next = {
    ...value.taskResults[index],
    ...clone(changes),
    taskId,
    reason: changes.reason === undefined ? value.taskResults[index].reason : (changes.reason === null ? null : text(changes.reason)),
    note: changes.note === undefined ? value.taskResults[index].note : noteText(changes.note),
    followUpNote: changes.followUpNote === undefined ? value.taskResults[index].followUpNote : noteText(changes.followUpNote),
    updatedAt: now,
  };
  assertTaskResult(next, taskId);
  value.taskResults[index] = next;
  value.updatedAt = now;
  return normalizeServicingRecord(value);
}

export function updateServicingDetails(record, changes, now = new Date().toISOString()) {
  const value = normalizeServicingRecord(record);
  if (value.lifecycle !== "draft") throw new Error("Finalised servicing records are locked; create an amendment instead.");
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw new TypeError("Servicing details must contain an object.");
  const allowed = new Set(["serviceDate", "engineHours", "operator", "overallNotes"]);
  if (Object.keys(changes).some((key) => !allowed.has(key))) throw new TypeError("Servicing details contain an unsupported field.");
  isoTimestamp(now, "Servicing details update time");
  if (Object.hasOwn(changes, "serviceDate")) value.serviceDate = serviceDate(changes.serviceDate);
  if (Object.hasOwn(changes, "engineHours")) value.engineHours = nonNegativeHours(changes.engineHours, { allowNull: true });
  if (Object.hasOwn(changes, "operator")) value.operator = text(changes.operator);
  if (Object.hasOwn(changes, "overallNotes")) value.overallNotes = noteText(changes.overallNotes);
  value.updatedAt = now;
  return normalizeServicingRecord(value);
}

function taskHasEnteredData(result) {
  return result.state !== "not_started" || result.reason !== null || result.note
    || result.followUpRequired || result.followUpNote;
}

export function setServicingIntervalGroups(record, selectedIntervalGroups, now = new Date().toISOString()) {
  const value = normalizeServicingRecord(record);
  if (value.lifecycle !== "draft") throw new Error("Finalised servicing records are locked; create an amendment instead.");
  if (!Array.isArray(selectedIntervalGroups)) throw new TypeError("Servicing interval selection is invalid.");
  isoTimestamp(now, "Servicing interval update time");
  const tasks = selectedIntervalGroups.length ? serviceTasksForIntervalGroups(selectedIntervalGroups) : [];
  const retainedIds = new Set(tasks.map(({ id }) => id));
  const removedWithData = value.taskResults.filter((result) => !retainedIds.has(result.taskId) && taskHasEnteredData(result));
  if (removedWithData.length) {
    const error = new Error("Reset the entered task results before removing their servicing interval.");
    error.code = "SERVICING_INTERVAL_HAS_ENTERED_TASKS";
    error.taskIds = removedWithData.map(({ taskId }) => taskId);
    throw error;
  }
  const priorResults = new Map(value.taskResults.map((result) => [result.taskId, result]));
  value.selectedIntervalGroups = [...selectedIntervalGroups];
  value.taskSnapshot = tasks.map(taskSnapshot);
  value.taskResults = tasks.map(({ id }) => priorResults.get(id) || initialTaskResult(id, now));
  value.updatedAt = now;
  return normalizeServicingRecord(value);
}

export function assessServicingFinalisation(record, now = new Date().toISOString()) {
  const value = normalizeServicingRecord(record);
  const issues = [];
  if (!value.selectedIntervalGroups.length || !value.taskResults.length) issues.push("Select at least one servicing interval.");
  if (value.engineHours === null) issues.push("Enter the engine hours.");
  if (!text(value.operator)) issues.push("Enter the operator.");
  if (value.taskResults.some(({ state }) => state === "not_started")) issues.push("Resolve every selected servicing task.");
  if (value.definition.definitionId !== SERVICE_DEFINITION_4830.definitionId
    || value.definition.definitionVersion !== SERVICE_DEFINITION_4830.definitionVersion
    || value.definition.definitionHash !== SERVICE_DEFINITION_4830.definitionHash) {
    issues.push("Reconcile this draft with the current servicing definition.");
  }
  isoTimestamp(now, "Servicing assessment time");
  if (value.serviceDate > localDate(now)) issues.push("Service date cannot be in the future.");
  return Object.freeze({
    canFinalise: issues.length === 0,
    issues: Object.freeze(issues),
    outcome: expectedOutcome(value.taskResults),
  });
}

export function finaliseServicingRecord(record, now = new Date().toISOString(), options = {}) {
  const value = normalizeServicingRecord(record);
  if (value.lifecycle !== "draft") throw new Error("This servicing revision is already finalised.");
  isoTimestamp(now, "Servicing finalised time");
  if (value.serviceDate > localDate(now)) throw new TypeError("Service date cannot be in the future.");
  if (value.definition.definitionId !== SERVICE_DEFINITION_4830.definitionId
    || value.definition.definitionVersion !== SERVICE_DEFINITION_4830.definitionVersion
    || value.definition.definitionHash !== SERVICE_DEFINITION_4830.definitionHash) {
    const error = new Error("This draft is pinned to a superseded servicing definition and must be explicitly reconciled before finalisation.");
    error.code = "SUPERSEDED_SERVICE_DEFINITION";
    throw error;
  }
  if (value.engineHours === null || !text(value.operator)) throw new TypeError("Engine hours and operator are required to finalise.");
  const outcome = expectedOutcome(value.taskResults);
  if (outcome === null) throw new Error("Every servicing task must be consciously resolved before finalisation.");
  value.outcome = outcome;
  value.lifecycle = outcome === "all_done" ? "finalised" : "finalised_with_outstanding_items";
  value.finalisedAt = now;
  value.updatedAt = now;
  value.propertySnapshot = Object.hasOwn(options, "propertySnapshot")
    ? (options.propertySnapshot ? normalizePropertyIdentitySnapshot(options.propertySnapshot) : propertyIdentitySnapshot())
    : (value.propertySnapshot ? normalizePropertyIdentitySnapshot(value.propertySnapshot) : propertyIdentitySnapshot());
  return normalizeServicingRecord(value);
}

export function createServicingAmendment(record, { recordId, reason }, now = new Date().toISOString()) {
  const prior = normalizeServicingRecord(record);
  if (!FINAL_LIFECYCLES.includes(prior.lifecycle)) throw new Error("Only a finalised servicing record can be amended.");
  const nextId = text(recordId);
  const amendmentReason = text(reason);
  if (!nextId || nextId === prior.recordId || !amendmentReason) throw new TypeError("An amendment needs a new record id and a reason.");
  isoTimestamp(now, "Servicing amendment time");
  return normalizeServicingRecord({
    ...clone(prior),
    recordId: nextId,
    revision: prior.revision + 1,
    supersedesRecordId: prior.recordId,
    amendmentReason,
    lifecycle: "draft",
    outcome: null,
    createdAt: now,
    updatedAt: now,
    finalisedAt: null,
  });
}

import { SERVICE_DEFINITION_4830 } from "./4830-service-definition.mjs";
import {
  assessServicingFinalisation,
  createServicingAmendment,
  createServicingDraft,
  finaliseServicingRecord,
  setServicingIntervalGroups,
  updateServicingDetails,
  updateServicingTask,
} from "./servicing-records.mjs";
import {
  SERVICING_COMPATIBILITY_KEY,
  SERVICING_KEY,
  PROPERTY_SETTINGS_KEY,
  appendFinalisedServicingRecord,
  assertServicingWritesEnabled,
  emptyServicingStore,
  inspectServicingCompatibility,
  inspectServicingStore,
  persistServicingStore,
  upsertServicingDraft,
} from "../storage.mjs";
import { loadPropertySettings, propertyIdentitySnapshot } from "../property-settings.mjs";

const COMMANDS = Object.freeze({
  createDraft: "create-draft",
  updateDraftDetails: "update-draft-details",
  setSelectedIntervals: "set-selected-intervals",
  updateTaskResult: "update-task-result",
  finaliseDraft: "finalise-draft",
  beginAmendment: "begin-amendment",
});

const clone = (value) => JSON.parse(JSON.stringify(value));

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("A valid servicing time is required.");
  return date;
}

function localDate(value) {
  const date = asDate(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function intervalLabel(id) {
  const initial = id.startsWith("initial-");
  const source = initial ? id.slice("initial-".length) : id;
  const labels = {
    daily: "Daily",
    "as-required": "As required",
    "10-hours": "10 hours",
    "50-hours": "50 hours",
    "100-hours": "100 hours",
    "250-hours": "250 hours",
    "500-hours": "500 hours",
    "1-year": "1 year",
    "750-hours": "750 hours",
    "1500-hours": "1500 hours",
    "2000-hours": "2000 hours",
    "5000-hours": "5000 hours",
  };
  return `${initial ? "Initial " : ""}${labels[source] || source.replaceAll("-", " ")}`;
}

function uiTask(snapshot) {
  const sourceNotes = SERVICE_DEFINITION_4830.sourceNotes
    .filter(({ id }) => snapshot.sourceNoteIds.includes(id))
    .map(({ id, text }) => ({ id, text }));
  return {
    id: snapshot.taskId,
    label: snapshot.label,
    section: snapshot.section,
    page: snapshot.source.page,
    row: snapshot.source.row,
    manualPage: snapshot.source.manualPage,
    intervals: snapshot.selectionGroups.map((group) => snapshot.initialBreakIn && group.startsWith("initial-")
      ? group.slice("initial-".length)
      : group),
    initialBreakIn: snapshot.initialBreakIn,
    dealerServiceMarker: snapshot.dealerServiceMarker,
    coolantIntervalFootnote: snapshot.coolantIntervalFootnote,
    boomLocationLabels: [...snapshot.boomLocationLabels],
    sourceNotes,
  };
}

export function servicingRecordForUi(record, now = new Date().toISOString()) {
  const taskSnapshots = record.taskSnapshot.map(uiTask);
  const taskResults = Object.fromEntries(record.taskResults.map((result) => [result.taskId, clone(result)]));
  return {
    ...clone(record),
    selectedIntervalIds: [...record.selectedIntervalGroups],
    taskSnapshots,
    taskResults,
    definitionId: record.definition.definitionId,
    definitionVersion: record.definition.definitionVersion,
    definitionHash: record.definition.definitionHash,
    boomLocations: clone(SERVICE_DEFINITION_4830.boomLocations),
    finalisation: record.lifecycle === "draft"
      ? assessServicingFinalisation(record, now)
      : { canFinalise: false, issues: [], outcome: record.outcome },
    saveState: "Saved on this device",
  };
}

function readStore(storage) {
  const inspected = inspectServicingStore(storage);
  if (inspected.status === "absent") return { ...inspected, value: emptyServicingStore() };
  if (inspected.status === "ready") return inspected;
  throw inspected.error;
}

function latestHistory(store) {
  return store.recordSeries
    .flatMap(({ revisions }) => revisions)
    .sort((left, right) => String(right.finalisedAt).localeCompare(String(left.finalisedAt)) || right.revision - left.revision);
}

function findDraft(store) {
  if (store.drafts.length > 1) throw new Error("More than one servicing draft needs recovery review.");
  return store.drafts[0] || null;
}

function findRecord(store, recordId) {
  for (const { revisions } of store.recordSeries) {
    const record = revisions.find((candidate) => candidate.recordId === recordId);
    if (record) return record;
  }
  throw new RangeError("The selected servicing record was not found.");
}

function saveStore(storage, inspected, next) {
  return persistServicingStore(next, storage, {
    expectedGeneration: inspected.value.generation,
    expectedRaw: inspected.raw,
  }).value;
}

export function createServicingAdapter({
  storage = globalThis.localStorage,
  now = () => new Date(),
  idFactory = () => globalThis.crypto?.randomUUID?.() || `service-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  eventTarget = globalThis,
} = {}) {
  let unsaved = false;
  const listeners = new Set();
  const capabilities = {};
  Object.defineProperty(capabilities, "servicingWritesEnabled", {
    enumerable: true,
    get: () => inspectServicingCompatibility(storage).status === "ready",
  });
  Object.freeze(capabilities);

  const notify = () => listeners.forEach((listener) => listener());

  function getState() {
    assertServicingWritesEnabled(storage);
    const current = asDate(now());
    const inspected = readStore(storage);
    const draft = findDraft(inspected.value);
    return Object.freeze({
      draft: draft ? servicingRecordForUi(draft, current.toISOString()) : null,
      history: Object.freeze(latestHistory(inspected.value).map((record) => servicingRecordForUi(record, current.toISOString()))),
      intervalOptions: Object.freeze(SERVICE_DEFINITION_4830.selectableIntervalGroups.map((id) => Object.freeze({
        id,
        label: intervalLabel(id),
        initialBreakIn: id.startsWith("initial-"),
      }))),
    });
  }

  async function dispatch(command) {
    assertServicingWritesEnabled(storage);
    if (!command || typeof command !== "object" || Array.isArray(command)) throw new TypeError("A servicing command is required.");
    const current = asDate(now());
    const timestamp = current.toISOString();
    const inspected = readStore(storage);
    let store = inspected.value;
    const draft = findDraft(store);
    unsaved = true;
    try {
      if (command.type === COMMANDS.createDraft) {
        if (draft) throw new Error("Resume or finalise the current servicing draft first.");
        const recordId = String(idFactory());
        store = upsertServicingDraft(store, createServicingDraft({
          recordId,
          serviceDate: localDate(current),
          selectedIntervalGroups: [],
        }, timestamp));
      } else if (command.type === COMMANDS.updateDraftDetails) {
        if (!draft) throw new Error("There is no servicing draft to update.");
        const previous = latestHistory(store)[0] || null;
        const nextHours = command.patch?.engineHours;
        if (previous && Number.isFinite(Number(nextHours)) && Number(nextHours) < Number(previous.engineHours)
          && command.confirmLowerEngineHours !== true) {
          const error = new Error(`The entered hours (${nextHours}) are lower than the previous record (${previous.engineHours}). Confirm this reading before saving.`);
          error.code = "LOWER_ENGINE_HOURS_CONFIRMATION_REQUIRED";
          error.previousEngineHours = previous.engineHours;
          error.enteredEngineHours = Number(nextHours);
          throw error;
        }
        store = upsertServicingDraft(store, updateServicingDetails(draft, command.patch, timestamp));
      } else if (command.type === COMMANDS.setSelectedIntervals) {
        if (!draft) throw new Error("There is no servicing draft to update.");
        store = upsertServicingDraft(store, setServicingIntervalGroups(draft, command.intervalIds, timestamp));
      } else if (command.type === COMMANDS.updateTaskResult) {
        if (!draft) throw new Error("There is no servicing draft to update.");
        const patch = { ...(command.patch || {}) };
        patch.reason = ["not_applicable", "deferred"].includes(patch.state) ? patch.reason : null;
        if (patch.followUpRequired !== true) patch.followUpNote = "";
        store = upsertServicingDraft(store, updateServicingTask(draft, command.taskId, patch, timestamp));
      } else if (command.type === COMMANDS.finaliseDraft) {
        if (!draft) throw new Error("There is no servicing draft to finalise.");
        let propertySnapshot;
        try { propertySnapshot = propertyIdentitySnapshot(loadPropertySettings(storage, PROPERTY_SETTINGS_KEY)); } catch { propertySnapshot = propertyIdentitySnapshot(); }
        store = appendFinalisedServicingRecord(store, finaliseServicingRecord(draft, timestamp, { propertySnapshot }));
      } else if (command.type === COMMANDS.beginAmendment) {
        if (draft) throw new Error("Finalise the current servicing draft before starting an amendment.");
        const prior = findRecord(store, command.recordId);
        store = upsertServicingDraft(store, createServicingAmendment(prior, {
          recordId: String(idFactory()),
          reason: command.reason,
        }, timestamp));
      } else {
        throw new TypeError("The servicing command is not supported.");
      }
      saveStore(storage, inspected, store);
      unsaved = false;
      notify();
      return true;
    } catch (error) {
      unsaved = true;
      throw error;
    }
  }

  function subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("A servicing listener is required.");
    listeners.add(listener);
    const onStorage = (event) => {
      if (event?.key === SERVICING_KEY || event?.key === SERVICING_COMPATIBILITY_KEY) listener();
    };
    eventTarget?.addEventListener?.("storage", onStorage);
    return () => {
      listeners.delete(listener);
      eventTarget?.removeEventListener?.("storage", onStorage);
    };
  }

  return Object.freeze({
    capabilities,
    getState,
    dispatch,
    subscribe,
    hasUnsavedChanges: () => unsaved,
  });
}

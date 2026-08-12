export const SERVICING_RECORD_TITLE = "Pallathorpe Enterprises 4830 Service Record";

const STATE_LABELS = Object.freeze({
  not_started: "Not started",
  done: "Done",
  not_applicable: "Not applicable",
  deferred: "Deferred",
});

const INTERVAL_LABELS = Object.freeze({
  "10-hours": "10 hours",
  daily: "Daily",
  "as-required": "As required",
  "50-hours": "50 hours",
  "100-hours": "100 hours",
  "250-hours": "250 hours",
  "500-hours": "500 hours",
  "1-year": "1 year",
  "750-hours": "750 hours",
  "2-years": "2 years",
  "1500-hours": "1500 hours",
  "2000-hours": "2000 hours",
  "5000-hours": "5000 hours",
});

function text(value) {
  return String(value ?? "").trim();
}

function taskSnapshots(record) {
  return Array.isArray(record?.taskSnapshots) ? record.taskSnapshots : [];
}

function resultFor(record, task) {
  return record?.taskResults?.[task.id] ?? task.result ?? {};
}

function compareSourceOrder(left, right) {
  const leftPage = Number(left.page) || Number.MAX_SAFE_INTEGER;
  const rightPage = Number(right.page) || Number.MAX_SAFE_INTEGER;
  const leftRow = Number(left.row) || Number.MAX_SAFE_INTEGER;
  const rightRow = Number(right.row) || Number.MAX_SAFE_INTEGER;
  return leftPage - rightPage || leftRow - rightRow || text(left.id).localeCompare(text(right.id), "en-AU");
}

export function servicingIntervalLabel(intervalId, { initialBreakIn = false } = {}) {
  const label = INTERVAL_LABELS[intervalId] || text(intervalId).replaceAll("-", " ") || "Interval not recorded";
  return initialBreakIn ? `Initial ${label.toLocaleLowerCase("en-AU")}` : label;
}

export function servicingTaskStateLabel(state) {
  return STATE_LABELS[state] || "Unknown state";
}

export function servicingOutcomeLabel(record) {
  const hasFinalisedAt = typeof record?.finalisedAt === "string"
    && !Number.isNaN(new Date(record.finalisedAt).getTime())
    && new Date(record.finalisedAt).toISOString() === record.finalisedAt;
  if (!hasFinalisedAt) return "Draft - not finalised";
  const finalState = expectedFinalState(record);
  if (!finalState || record?.lifecycle !== finalState.lifecycle || record?.outcome !== finalState.outcome) {
    return "Draft - not finalised";
  }
  if (finalState.lifecycle === "finalised") return "Finalised";
  if (finalState.lifecycle === "finalised_with_outstanding_items") {
    return "Finalised with outstanding items";
  }
  return "Draft - not finalised";
}

function expectedFinalState(record) {
  const tasks = taskSnapshots(record);
  const results = tasks.map((task) => resultFor(record, task));
  if (!tasks.length || results.some((result) => result.state === "not_started" || !STATE_LABELS[result.state])) {
    return null;
  }
  if (results.some((result) =>
    result.state === "not_applicable"
    || result.state === "deferred"
    || result.followUpRequired === true,
  )) {
    return { lifecycle: "finalised_with_outstanding_items", outcome: "outstanding_items" };
  }
  return { lifecycle: "finalised", outcome: "all_done" };
}

export function assertServicingRecordExportable(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("A finalised 4830 service record is required.");
  }
  if (record.machine !== "4830") throw new TypeError("Only a 4830 service record can be exported.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(record.serviceDate))) {
    throw new TypeError("The service date is missing or invalid.");
  }
  if (!Number.isFinite(Number(record.engineHours)) || Number(record.engineHours) < 0) {
    throw new TypeError("The engine hours are missing or invalid.");
  }
  if (!text(record.operator)) throw new TypeError("The operator is missing.");
  if (!Number.isInteger(Number(record.revision)) || Number(record.revision) < 1) {
    throw new TypeError("The record revision is missing or invalid.");
  }
  if (!["finalised", "finalised_with_outstanding_items"].includes(record.lifecycle)
    || !["all_done", "outstanding_items"].includes(record.outcome)
    || typeof record.finalisedAt !== "string"
    || Number.isNaN(new Date(record.finalisedAt).getTime())
    || new Date(record.finalisedAt).toISOString() !== record.finalisedAt) {
    throw new TypeError("A genuinely finalised 4830 service record is required for export.");
  }
  const tasks = taskSnapshots(record);
  if (!tasks.length) throw new TypeError("The service record contains no task snapshots.");
  const seenIds = new Set();
  for (const task of tasks) {
    const id = text(task?.id);
    if (!id || !text(task?.label) || seenIds.has(id)) {
      throw new TypeError("The service record contains an invalid task snapshot.");
    }
    seenIds.add(id);
    const result = resultFor(record, task);
    if (!STATE_LABELS[result.state] || result.state === "not_started") {
      throw new TypeError(`${id} is not resolved and the record cannot be exported.`);
    }
    if (["not_applicable", "deferred"].includes(result.state) && !text(result.reason)) {
      throw new TypeError(`${id} requires a recorded reason.`);
    }
    if (result.followUpRequired === true && !text(result.followUpNote)) {
      throw new TypeError(`${id} requires a follow-up note.`);
    }
  }
  const finalState = expectedFinalState(record);
  if (!finalState || record.lifecycle !== finalState.lifecycle || record.outcome !== finalState.outcome) {
    throw new TypeError("The finalised servicing outcome is inconsistent with its task results.");
  }
  return record;
}

function taskLayout(record, task) {
  const result = resultFor(record, task);
  const intervals = Array.isArray(task.intervals) && task.intervals.length
    ? task.intervals.map((interval) => servicingIntervalLabel(interval, { initialBreakIn: task.initialBreakIn === true }))
    : ["Interval not recorded"];
  return {
    id: text(task.id),
    label: text(task.label),
    source: Number.isInteger(Number(task.page)) && Number.isInteger(Number(task.row))
      ? `Source ${Number(task.page)}-${Number(task.row)}`
      : "Source location not recorded",
    interval: intervals.join(" / "),
    state: result.state,
    stateLabel: servicingTaskStateLabel(result.state),
    reason: text(result.reason),
    note: text(result.note),
    followUpRequired: result.followUpRequired === true,
    followUpNote: text(result.followUpNote),
    sourceNotes: Array.isArray(task.sourceNotes)
      ? task.sourceNotes.map(({ text: note }) => text(note)).filter(Boolean)
      : [],
    boomLocationLabels: Array.isArray(task.boomLocationLabels)
      ? task.boomLocationLabels.map(text).filter(Boolean)
      : [],
  };
}

function appendixEntries(tasks) {
  const entries = [];
  for (const task of tasks) {
    if (task.reason) entries.push({ taskId: task.id, label: "Reason", text: task.reason });
    if (task.note) entries.push({ taskId: task.id, label: "Task note", text: task.note });
    if (task.followUpRequired) entries.push({ taskId: task.id, label: "Follow-up", text: task.followUpNote });
    for (const sourceNote of task.sourceNotes) entries.push({ taskId: task.id, label: "Source note", text: sourceNote });
  }
  return entries;
}

export function buildServicingLayout4830(record) {
  assertServicingRecordExportable(record);
  const tasks = [...taskSnapshots(record)].sort(compareSourceOrder).map((task) => taskLayout(record, task));
  const machineTasks = tasks.filter((task) => {
    const source = taskSnapshots(record).find((candidate) => candidate.id === task.id);
    return source?.section !== "boom";
  });
  const boomTasks = tasks.filter((task) => {
    const source = taskSnapshots(record).find((candidate) => candidate.id === task.id);
    return source?.section === "boom";
  });
  const boomReference = Array.isArray(record.boomLocations)
    ? record.boomLocations.map((location) => ({
        label: text(location.label),
        description: text(location.description),
        interval: servicingIntervalLabel(location.interval),
        fittingLocations: Number.isFinite(Number(location.fittingLocations))
          ? Number(location.fittingLocations)
          : null,
        eachSide: location.eachSide === true,
      })).filter((location) => location.label && location.description)
    : [];
  const revision = Number(record.revision);
  return {
    title: SERVICING_RECORD_TITLE,
    recordIdentity: `${text(record.seriesId || record.recordId || "Record")} | Revision ${revision}`,
    metadata: [
      ["Machine", "4830"],
      ["Service date", text(record.serviceDate)],
      ["Engine hours", String(record.engineHours)],
      ["Operator", text(record.operator)],
      ["Intervals selected", (record.selectedIntervalIds || []).map((id) => servicingIntervalLabel(id)).join(", ") || "Not recorded"],
      ["Definition", `${text(record.definitionId || "Not recorded")} v${record.definitionVersion ?? "?"}`],
      ["Record revision", String(revision)],
      ["Finalised", text(record.finalisedAt || "Not recorded")],
    ],
    outcome: servicingOutcomeLabel(record),
    sections: [
      { id: "machine", title: "Machine - excluding boom", tasks: machineTasks },
      ...(boomTasks.length ? [{ id: "boom", title: "Boom", tasks: boomTasks }] : []),
    ],
    boomReference,
    overallNotes: text(record.overallNotes),
    amendmentReason: revision > 1 ? text(record.amendmentReason) : "",
    appendix: appendixEntries(tasks),
    disclaimer: "This is an ordinary app record. It is not proof that physical work occurred, an official manufacturer form, a warranty record, trusted identity, or a tamper-proof record.",
  };
}

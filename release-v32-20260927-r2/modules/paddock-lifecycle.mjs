export const MAX_ACTIVE_PADDOCKS = 25;

const cleanTimestamp = (value) => (typeof value === "string" ? value.trim() : "");

export function isArchivedPaddock(paddock) {
  return Boolean(cleanTimestamp(paddock?.archivedAt));
}

export function isCompletedPaddock(paddock) {
  return Boolean(cleanTimestamp(paddock?.completedAt));
}

// Completion closes new work only; existing records remain editable for corrections.
export function canAddPaddockWork(paddock) {
  return Boolean(paddock) && !isArchivedPaddock(paddock) && !isCompletedPaddock(paddock);
}

export function paddockCompletionBlockReason(
  paddock,
  { runs = [], pendingEdits = false, pendingSave = false } = {},
) {
  if (!paddock) return "Choose a paddock first.";
  if (isArchivedPaddock(paddock)) return "Restore this archived paddock before changing its completion status.";
  if (pendingSave) return "Wait for the current save to finish before changing paddock completion.";
  if (pendingEdits) return "Save or cancel pending edits before changing paddock completion.";
  const normalizedName = String(paddock.normalizedName || paddock.name || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-AU");
  const libraryEntryIds = new Set((paddock.tanks || []).map((tank) => tank.paddockSelection?.libraryEntryId).filter(Boolean));
  const activeBuffer = runs.some((run) => run.status === "active" && (
    (run.allocations || []).some((allocation) => allocation.paddockId === paddock.id)
    || (run.selectedPaddocks || []).some((selection) => libraryEntryIds.has(selection.libraryEntryId))
    || (normalizedName && (run.selectedPaddocks || []).some((selection) =>
      String(selection.normalizedName || selection.name || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-AU") === normalizedName))
  ));
  return activeBuffer ? "Finish the active buffer before changing this paddock's completion status." : "";
}

export function transitionPaddockCompletion(
  paddock,
  completedAt,
  changedAt = completedAt || new Date().toISOString(),
) {
  if (!paddock || typeof paddock !== "object" || Array.isArray(paddock)) {
    throw new TypeError("A paddock record is required.");
  }
  const timestamp = completedAt === null ? null : cleanTimestamp(completedAt);
  if (completedAt !== null && !timestamp) throw new TypeError("A completion timestamp is required.");
  const updateTimestamp = cleanTimestamp(changedAt);
  if (!updateTimestamp) throw new TypeError("A change timestamp is required.");
  if (Boolean(timestamp) === isCompletedPaddock(paddock)) return paddock;
  return {
    ...paddock,
    completedAt: timestamp,
    updatedAt: updateTimestamp,
    contentRevision: Math.max(1, Math.trunc(Number(paddock.contentRevision) || 1)) + 1,
  };
}

export function activePaddocks(paddocks = []) {
  return (Array.isArray(paddocks) ? paddocks : []).filter((paddock) => !isArchivedPaddock(paddock));
}

export function archivedPaddocks(paddocks = []) {
  return (Array.isArray(paddocks) ? paddocks : []).filter(isArchivedPaddock);
}

export function findNamedPaddock(paddocks, normalizedName, { archived = false } = {}) {
  return (Array.isArray(paddocks) ? paddocks : []).find(
    (paddock) => paddock?.normalizedName === normalizedName
      && isArchivedPaddock(paddock) === archived,
  ) || null;
}

export function transitionPaddockArchive(
  paddock,
  archivedAt,
  changedAt = archivedAt || new Date().toISOString(),
) {
  if (!paddock || typeof paddock !== "object" || Array.isArray(paddock)) {
    throw new TypeError("A paddock record is required.");
  }
  const timestamp = archivedAt === null ? null : cleanTimestamp(archivedAt);
  if (archivedAt !== null && !timestamp) throw new TypeError("An archive timestamp is required.");
  const updateTimestamp = cleanTimestamp(changedAt);
  if (!updateTimestamp) throw new TypeError("A change timestamp is required.");
  return {
    ...paddock,
    archivedAt: timestamp,
    updatedAt: updateTimestamp,
    contentRevision: Math.max(1, Number(paddock.contentRevision) || 1) + 1,
  };
}

export function canRestorePaddock(paddocks, maximum = MAX_ACTIVE_PADDOCKS) {
  return activePaddocks(paddocks).length < maximum;
}

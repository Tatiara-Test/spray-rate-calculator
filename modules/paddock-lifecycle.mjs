export const MAX_ACTIVE_PADDOCKS = 25;

const cleanTimestamp = (value) => (typeof value === "string" ? value.trim() : "");

export function isArchivedPaddock(paddock) {
  return Boolean(cleanTimestamp(paddock?.archivedAt));
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

export const PADDOCK_LIBRARY_VERSION = 1;

const cleanText = (value) => (
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
);

const cleanTimestamp = (value, label) => {
  const cleaned = cleanText(value instanceof Date ? value.toISOString() : value);
  if (!cleaned) throw new TypeError(`${label} is required.`);
  return cleaned;
};

const optionalPositive = (value, label) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new RangeError(`${label} must be blank or greater than zero.`);
  }
  return number;
};

const requiredText = (value, label) => {
  const cleaned = cleanText(value);
  if (!cleaned) throw new TypeError(`${label} is required.`);
  return cleaned;
};

const entriesFrom = (source) => (
  Array.isArray(source) ? source : Array.isArray(source?.entries) ? source.entries : []
);

function defaultIdFactory() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `paddock-library-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeLibraryName(value) {
  return cleanText(value).toLocaleLowerCase("en-AU");
}

export function activeLibraryEntries(source) {
  return entriesFrom(source).filter((entry) => !cleanText(entry?.archivedAt));
}

export function archivedLibraryEntries(source) {
  return entriesFrom(source).filter((entry) => Boolean(cleanText(entry?.archivedAt)));
}

export function findLibraryEntryById(source, id) {
  const selectedId = cleanText(id);
  if (!selectedId) return null;
  return entriesFrom(source).find((entry) => entry?.id === selectedId) || null;
}

export function findLibraryEntryByName(source, name, { includeArchived = false } = {}) {
  const normalizedName = normalizeLibraryName(name);
  if (!normalizedName) return null;
  return entriesFrom(source).find((entry) => (
    entry?.normalizedName === normalizedName
    && (includeArchived || !cleanText(entry?.archivedAt))
  )) || null;
}

export function createLibraryEntry(
  input = {},
  changedAt = new Date().toISOString(),
  idFactory = defaultIdFactory,
) {
  const name = requiredText(input.name, "Paddock name");
  const timestamp = cleanTimestamp(changedAt, "Creation timestamp");
  const id = cleanText(input.id) || requiredText(idFactory(input), "Paddock library id");
  const sourcePaddockId = cleanText(input.sourcePaddockId);
  return {
    id,
    name,
    normalizedName: normalizeLibraryName(name),
    totalHectares: optionalPositive(input.totalHectares, "Total hectares"),
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(sourcePaddockId ? { sourcePaddockId } : {}),
  };
}

export function updateLibraryEntry(
  entry,
  changes = {},
  changedAt = new Date().toISOString(),
) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new TypeError("A paddock library entry is required.");
  }
  const name = Object.hasOwn(changes, "name")
    ? requiredText(changes.name, "Paddock name")
    : requiredText(entry.name, "Paddock name");
  const totalHectares = Object.hasOwn(changes, "totalHectares")
    ? optionalPositive(changes.totalHectares, "Total hectares")
    : optionalPositive(entry.totalHectares, "Total hectares");
  return {
    ...entry,
    id: requiredText(entry.id, "Paddock library id"),
    name,
    normalizedName: normalizeLibraryName(name),
    totalHectares,
    archivedAt: cleanText(entry.archivedAt) || null,
    createdAt: cleanTimestamp(entry.createdAt, "Creation timestamp"),
    updatedAt: cleanTimestamp(changedAt, "Update timestamp"),
  };
}

export function archiveLibraryEntry(entry, archivedAt = new Date().toISOString()) {
  const timestamp = cleanTimestamp(archivedAt, "Archive timestamp");
  return {
    ...updateLibraryEntry(entry, {}, timestamp),
    archivedAt: timestamp,
  };
}

export function restoreLibraryEntry(entry, changedAt = new Date().toISOString()) {
  return {
    ...updateLibraryEntry(entry, {}, changedAt),
    archivedAt: null,
  };
}

export function normalizeSelectedPaddockSnapshot(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("A selected paddock snapshot is required.");
  }
  const name = requiredText(input.name, "Selected paddock name");
  return {
    libraryEntryId: requiredText(input.libraryEntryId, "Selected paddock library id"),
    name,
    normalizedName: normalizeLibraryName(name),
    totalHectares: optionalPositive(input.totalHectares, "Selected paddock total hectares"),
    plannedHectares: optionalPositive(input.plannedHectares, "Selected paddock planned hectares"),
  };
}

export function createSelectedPaddockSnapshot(entry, plannedHectares = null) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new TypeError("A paddock library entry is required.");
  }
  return normalizeSelectedPaddockSnapshot({
    libraryEntryId: entry.id,
    name: entry.name,
    normalizedName: entry.normalizedName,
    totalHectares: entry.totalHectares,
    plannedHectares,
  });
}

export function seedLibraryEntries(
  paddockStore,
  changedAt = new Date().toISOString(),
  idFactory = defaultIdFactory,
) {
  const timestamp = cleanTimestamp(changedAt, "Seed timestamp");
  const paddocks = Array.isArray(paddockStore?.paddocks) ? paddockStore.paddocks : [];
  const grouped = new Map();

  for (const paddock of paddocks) {
    const name = cleanText(paddock?.name);
    const normalizedName = normalizeLibraryName(name);
    if (!normalizedName) continue;
    const totalHectares = optionalPositive(paddock?.sizeHectares, "Existing paddock total hectares");
    const archivedAt = cleanText(paddock?.archivedAt) || null;
    let group = grouped.get(normalizedName);
    if (!group) {
      group = {
        source: paddock,
        name,
        normalizedName,
        positiveSizes: new Set(),
        allArchived: Boolean(archivedAt),
        archivedAt,
      };
      grouped.set(normalizedName, group);
    } else {
      group.allArchived = group.allArchived && Boolean(archivedAt);
      if (!archivedAt && cleanText(group.source?.archivedAt)) {
        group.source = paddock;
        group.name = name;
        group.archivedAt = null;
      }
    }
    if (totalHectares !== null) group.positiveSizes.add(totalHectares);
  }

  return [...grouped.values()].map((group, index) => {
    const totalHectares = group.positiveSizes.size === 1
      ? [...group.positiveSizes][0]
      : null;
    const id = requiredText(
      idFactory({
        index,
        name: group.name,
        normalizedName: group.normalizedName,
        sourcePaddock: group.source,
      }),
      "Paddock library id",
    );
    return {
      id,
      name: group.name,
      normalizedName: group.normalizedName,
      totalHectares,
      archivedAt: group.allArchived ? group.archivedAt : null,
      createdAt: cleanText(group.source?.createdAt) || timestamp,
      updatedAt: cleanText(group.source?.updatedAt) || timestamp,
      sourcePaddockId: requiredText(group.source?.id, "Seed paddock id"),
    };
  });
}

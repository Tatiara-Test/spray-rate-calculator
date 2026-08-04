const SPRAY_TABS = new Set(["calculator", "run", "paddocks"]);
const WORK_NOTES_TABS = new Set(["notes", "summary", "followups"]);

export const DEFAULT_NAVIGATION = Object.freeze({
  version: 1,
  last: Object.freeze({ section: "spray", tab: "calculator" }),
  tabs: Object.freeze({ spray: "calculator", workNotes: "notes" }),
});

export function navigationStorageKey(channel = "base") {
  const safeChannel = String(channel || "base")
    .trim()
    .toLocaleLowerCase("en-AU")
    .replace(/[^a-z0-9-]+/g, "-") || "base";
  return `pallathorpe-combined:v1:navigation:${safeChannel}`;
}

export function normalizeNavigation(value) {
  const sprayTab = SPRAY_TABS.has(value?.tabs?.spray)
    ? value.tabs.spray
    : DEFAULT_NAVIGATION.tabs.spray;
  const workNotesTab = WORK_NOTES_TABS.has(value?.tabs?.workNotes)
    ? value.tabs.workNotes
    : DEFAULT_NAVIGATION.tabs.workNotes;
  const candidate = normalizeRoute(value?.last, {
    tabs: { spray: sprayTab, workNotes: workNotesTab },
  });
  const last = candidate.section === "home"
    ? { ...DEFAULT_NAVIGATION.last }
    : candidate;
  return {
    version: 1,
    last,
    tabs: { spray: sprayTab, workNotes: workNotesTab },
  };
}

export function loadNavigation(storage, key) {
  try {
    const raw = storage?.getItem?.(key);
    return normalizeNavigation(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeNavigation(null);
  }
}

export function persistNavigation(storage, key, value) {
  const normalized = normalizeNavigation(value);
  storage?.setItem?.(key, JSON.stringify(normalized));
  return normalized;
}

export function normalizeRoute(route, navigation = DEFAULT_NAVIGATION) {
  const section = route?.section;
  if (section === "spray") {
    const tab = SPRAY_TABS.has(route?.tab)
      ? route.tab
      : SPRAY_TABS.has(navigation?.tabs?.spray)
        ? navigation.tabs.spray
        : "calculator";
    return { section, tab };
  }
  if (section === "work-notes") {
    const tab = WORK_NOTES_TABS.has(route?.tab)
      ? route.tab
      : WORK_NOTES_TABS.has(navigation?.tabs?.workNotes)
        ? navigation.tabs.workNotes
        : "notes";
    return { section, tab };
  }
  if (section === "weather") return { section: "weather", tab: null };
  return { section: "home", tab: null };
}

export function rememberRoute(navigation, route) {
  const current = normalizeNavigation(navigation);
  const selected = normalizeRoute(route, current);
  if (selected.section === "home") return current;
  const tabs = { ...current.tabs };
  if (selected.section === "spray") tabs.spray = selected.tab;
  if (selected.section === "work-notes") tabs.workNotes = selected.tab;
  return { version: 1, last: selected, tabs };
}

export function routeFromHash(hash, navigation = DEFAULT_NAVIGATION) {
  const token = String(hash || "").replace(/^#\/?/, "").replace(/\/$/, "");
  if (!token || token === "home") return { section: "home", tab: null };
  if (token === "calculator" || token === "run" || token === "paddocks") {
    return { section: "spray", tab: token };
  }
  if (token === "spray") return normalizeRoute({ section: "spray" }, navigation);
  if (token.startsWith("spray/")) {
    return normalizeRoute({ section: "spray", tab: token.slice(6) }, navigation);
  }
  if (token === "weather") return { section: "weather", tab: null };
  if (token === "work-notes") return normalizeRoute({ section: "work-notes" }, navigation);
  if (token.startsWith("work-notes/")) {
    return normalizeRoute({ section: "work-notes", tab: token.slice(11) }, navigation);
  }
  return { section: "home", tab: null };
}

export function hashForRoute(route) {
  const selected = normalizeRoute(route);
  if (selected.section === "home") return "#/home";
  if (selected.section === "weather") return "#/weather";
  return `#/${selected.section}/${selected.tab}`;
}

export function continueCopy(route) {
  const selected = normalizeRoute(route);
  if (selected.section === "weather") {
    return { title: "Continue Weather", detail: "Return to your saved weather location" };
  }
  if (selected.section === "work-notes") {
    const labels = { notes: "Notes", summary: "Summary", followups: "Follow-ups" };
    return { title: "Continue Work Notes", detail: labels[selected.tab] };
  }
  const labels = { calculator: "Calculator", run: "Paddock Run", paddocks: "Paddocks" };
  return { title: "Continue Spray Operations", detail: labels[selected.tab] };
}

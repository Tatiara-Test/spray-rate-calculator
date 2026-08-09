import { mountSprayApp } from "./modules/spray-app.mjs";
import { migrateLegacyData } from "./modules/storage.mjs";
import { mountWorkNotesApp } from "./modules/work-notes-app.mjs";
import {
  APP_CHANNEL,
  ENABLE_LEGACY_MIGRATION,
  WORK_NOTES_AI_BACKEND_URL,
  WORK_NOTES_AI_MODE,
} from "./config.mjs";
import {
  continueCopy,
  hashForRoute,
  loadNavigation,
  navigationStorageKey,
  normalizeRoute,
  persistNavigation,
  rememberRoute,
  routeFromHash,
} from "./modules/navigation.mjs";

let migration = {};
if (ENABLE_LEGACY_MIGRATION) {
  try {
    migration = migrateLegacyData();
  } catch (error) {
    migration = { storage: { status: "error", error } };
  }
}
const migrationNotice = document.querySelector("#migration-notice");
const migrationProblems = Object.entries(migration).filter(([, result]) =>
  ["invalid", "error"].includes(result.status),
);
if (migrationProblems.length) {
  migrationNotice.textContent = "Some older device records could not be copied. The originals were left unchanged; use Backup / Restore to review them.";
  migrationNotice.hidden = false;
}

const sprayHost = document.querySelector("#spray-host");
let settings = { refresh: () => {}, hasUnsavedChanges: () => false };
const spray = mountSprayApp(sprayHost, {
  hasExternalUnsavedLibraryChanges: () => settings.hasUnsavedChanges?.() === true,
});
const weatherHost = document.querySelector("#weather-host");
let weather = { refresh: () => {}, hasUnsavedChanges: () => false };
const settingsHost = document.querySelector("#settings-host");
const workNotesHost = document.querySelector("#work-notes-host");
const workNotes = mountWorkNotesApp(workNotesHost, {
  hasExternalUnsavedChanges: () =>
    Boolean(
      spray.hasUnsavedChanges?.()
      || weather.hasUnsavedChanges?.()
      || settings.hasUnsavedChanges?.()
    ),
  aiConfig: {
    mode: WORK_NOTES_AI_MODE,
    backendUrl: WORK_NOTES_AI_BACKEND_URL,
    channel: APP_CHANNEL,
  },
});
const navigationKey = navigationStorageKey(APP_CHANNEL);
let navigation = loadNavigation(globalThis.localStorage, navigationKey);
let currentRoute = { section: "home", tab: null };
let weatherMountPromise = null;
let settingsMountPromise = null;

function ensureWeatherMounted() {
  if (weatherMountPromise) {
    weather.refresh();
    return weatherMountPromise;
  }
  weatherHost.innerHTML = '<p class="weather-loading">Weather Shortcuts loading…</p>';
  weatherMountPromise = import("./modules/weather/weather-app.mjs")
    .then(({ mountWeatherApp }) => {
      weather = mountWeatherApp(weatherHost);
      weather.refresh();
      return weather;
    })
    .catch(() => {
    const failure = `
      <style>:host{display:block}.weather-isolated-error{font:16px Arial,sans-serif;background:#fff;border:1px solid #d5ddd4;border-radius:14px;color:#18231b;margin:28px auto;max-width:680px;padding:18px}.weather-isolated-error p{color:#5c685f;line-height:1.45}</style>
      <section class="weather-isolated-error">
        <strong>Weather Shortcuts are unavailable</strong>
        <p>Calculator, Paddocks and Work Notes are unaffected. Saved weather shortcuts remain in the combined backup.</p>
      </section>
    `;
    if (weatherHost.shadowRoot) weatherHost.shadowRoot.innerHTML = failure;
    else weatherHost.innerHTML = failure;
    return weather;
  });
  return weatherMountPromise;
}

function ensureSettingsMounted() {
  if (settingsMountPromise) {
    settings.refresh();
    return settingsMountPromise;
  }
  settingsHost.innerHTML = '<p class="settings-loading">Settings loading…</p>';
  settingsMountPromise = import("./modules/settings-app.mjs")
    .then(({ mountSettingsApp }) => {
      settings = mountSettingsApp(settingsHost, {
        onLibraryChange: () => spray.refreshPaddockLibrary?.(),
        hasExternalUnsavedLibraryChanges: () => spray.hasUnsavedLibraryChanges?.() === true,
      });
      settings.refresh();
      return settings;
    })
    .catch(() => {
      const failure = `
        <style>:host{display:block}.settings-isolated-error{font:16px Arial,sans-serif;background:#fff;border:1px solid #d5ddd4;border-radius:14px;color:#18231b;margin:28px auto;max-width:680px;padding:18px}.settings-isolated-error p{color:#5c685f;line-height:1.45}</style>
        <section class="settings-isolated-error">
          <strong>Settings are unavailable</strong>
          <p>Calculator, Paddocks, Weather Shortcuts and Work Notes are unaffected. Existing device records have not been changed.</p>
        </section>
      `;
      if (settingsHost.shadowRoot) settingsHost.shadowRoot.innerHTML = failure;
      else settingsHost.innerHTML = failure;
      return settings;
    });
  return settingsMountPromise;
}
const panels = [...document.querySelectorAll("[data-panel]")];
const sectionNavigation = document.querySelector("#section-navigation");
const currentSectionTitle = document.querySelector("#current-section-title");
const continueButton = document.querySelector("#continue-button");
const continueTitle = document.querySelector("#continue-title");
const continueDetail = document.querySelector("#continue-detail");
const sectionTitles = {
  spray: "Spray Operations",
  weather: "Weather Shortcuts",
  "work-notes": "Work Notes",
  settings: "Settings",
};

function updateContinueCard() {
  const copy = continueCopy(navigation.last);
  continueTitle.textContent = copy.title;
  continueDetail.textContent = copy.detail;
}

function rememberSelectedRoute(route) {
  navigation = rememberRoute(navigation, route);
  try {
    navigation = persistNavigation(globalThis.localStorage, navigationKey, navigation);
  } catch {
    // Navigation remains usable when device settings cannot be written.
  }
  updateContinueCard();
}

function showRoute(route, { updateHash = false } = {}) {
  const selected = normalizeRoute(route, navigation);
  currentRoute = selected;
  panels.forEach((panel) => {
    panel.hidden = panel.dataset.panel !== selected.section;
  });
  sectionNavigation.hidden = selected.section === "home";
  currentSectionTitle.textContent = sectionTitles[selected.section] || "";

  if (selected.section !== "home") rememberSelectedRoute(selected);
  if (selected.section === "spray") spray.showView(selected.tab);
  if (selected.section === "weather") ensureWeatherMounted();
  if (selected.section === "settings") ensureSettingsMounted();
  if (selected.section === "work-notes") {
    workNotes.activateSection(selected.tab);
    workNotes.renderAll();
  }
  const nextHash = hashForRoute(selected);
  if (updateHash && location.hash !== nextHash) history.pushState(null, "", nextHash);
  window.scrollTo({ top: 0, behavior: "instant" });
}

function routeForSection(section) {
  if (section === "spray") return { section, tab: navigation.tabs.spray };
  if (section === "work-notes") return { section, tab: navigation.tabs.workNotes };
  return { section, tab: null };
}

sprayHost.requestTopLevelView = (tab) => showRoute({ section: "spray", tab }, { updateHash: true });
workNotesHost.requestTopLevelSection = (tab) => showRoute({ section: "work-notes", tab }, { updateHash: true });
document.querySelectorAll("[data-open-section]").forEach((button) => {
  button.addEventListener("click", () => showRoute(routeForSection(button.dataset.openSection), { updateHash: true }));
});
document.querySelector("#main-menu-button").addEventListener("click", () => {
  showRoute({ section: "home", tab: null }, { updateHash: true });
});
continueButton.addEventListener("click", () => showRoute(navigation.last, { updateHash: true }));
window.addEventListener("hashchange", () => showRoute(routeFromHash(location.hash, navigation)));
updateContinueCard();
showRoute(routeFromHash(location.hash, navigation));
if (!location.hash) history.replaceState(null, "", "#/home");

const updateBanner = document.querySelector("#update-banner");
const updateNow = document.querySelector("#update-now");
let waitingWorker = null;
let updateRequested = false;

function offerUpdate(worker) {
  waitingWorker = worker;
  updateBanner.hidden = false;
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      if (registration.waiting && navigator.serviceWorker.controller) offerUpdate(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            offerUpdate(installing);
          }
        });
      });
    } catch {
      // The app remains fully usable without service-worker registration.
    }
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (updateRequested) location.reload();
  });
}

updateNow.addEventListener("click", () => {
  if (!waitingWorker) return;
  updateRequested = true;
  updateNow.disabled = true;
  updateNow.textContent = "Updating…";
  waitingWorker.postMessage({ type: "SKIP_WAITING" });
});

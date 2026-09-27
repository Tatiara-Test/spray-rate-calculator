import { mountSprayApp } from "./modules/spray-app.mjs";
import { serviceNavigationBlocker } from "./modules/service-navigation.mjs";
import { mountNotebookApp } from "./modules/notebook-app.mjs";
import { getStorage, isStorageBusy } from "./modules/durable-storage.mjs";
import { mountNativeBackup } from "./modules/native-backup-ui.mjs";
import { getBackupStatus } from "./modules/native-backup.mjs";
import { applyAppearance, watchAppearance } from "./modules/appearance.mjs";
import { migrateLegacyData, PROPERTY_SETTINGS_KEY } from "./modules/storage.mjs";
import { mountWorkNotesApp } from "./modules/work-notes-app.mjs";
import { loadPropertySettings } from "./modules/property-settings.mjs";
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
function applyPropertyTheme(settings) {
  document.documentElement.dataset.theme = settings?.theme || "pallathorpe";
}
let propertySettings = { businessName: "Pallathorpe Enterprises", shortName: "Pallathorpe", defaultPeriod: "fortnight", theme: "pallathorpe" };
try { propertySettings = loadPropertySettings(getStorage(), PROPERTY_SETTINGS_KEY); } catch { /* protected settings remain at defaults */ }
applyPropertyTheme(propertySettings);
watchAppearance();
if (migrationProblems.length) {
  migrationNotice.textContent = "Some older device records could not be copied. The originals were left unchanged; use Backup / Restore to review them.";
  migrationNotice.hidden = false;
}

const sprayHost = document.querySelector("#spray-host");
let settings = { refresh: () => {}, hasUnsavedChanges: () => false };
const spray = await mountSprayApp(sprayHost, {
  hasExternalUnsavedLibraryChanges: () => settings.hasUnsavedChanges?.() === true,
});
const weatherHost = document.querySelector("#weather-host");
let weather = { refresh: () => {}, hasUnsavedChanges: () => false };
const settingsHost = document.querySelector("#settings-host");
const servicingHost = document.querySelector("#servicing-host");
let servicing = { refresh: () => {}, hasUnsavedChanges: () => false };
const serviceWorkspaceHost = document.querySelector("#service-workspace-host");
let serviceWorkspace = { refresh: () => {}, hasUnsavedChanges: () => false };
const workNotesHost = document.querySelector("#work-notes-host");
const notebookHost = document.querySelector("#notebook-host");
const notebook = mountNotebookApp(notebookHost, {onDirtyChange: dirty => {
  if (!dirty) document.querySelector('#navigation-warning').hidden = true;
}});
function applyPropertyIdentity(settings) {
  const fullName = settings?.businessName || "Pallathorpe Enterprises";
  const shortName = settings?.shortName || fullName;
  document.querySelector("#home-farm-name")?.replaceChildren(fullName);
  const setShadowText = (host, selector, value) => host?.shadowRoot?.querySelector(selector)?.replaceChildren(value);
  setShadowText(sprayHost, "#spray-farm-name", fullName);
  setShadowText(workNotesHost, "#work-notes-farm-name", shortName);
  setShadowText(weatherHost, "#weather-farm-name", shortName);
  setShadowText(settingsHost, "#settings-farm-name", fullName);
  setShadowText(servicingHost, "#servicing-farm-name", fullName);
  applyAppearance();
}
applyPropertyIdentity(propertySettings);
const workNotes = await mountWorkNotesApp(workNotesHost, {
  onBackupRequest: action => openCombinedBackup(action),
  hasExternalUnsavedChanges: () =>
    Boolean(
      spray.hasUnsavedChanges?.()
      || weather.hasUnsavedChanges?.()
      || settings.hasUnsavedChanges?.()
      || servicing.hasUnsavedChanges?.()
      || serviceWorkspace.hasUnsavedChanges?.()
      || notebook.hasUnsavedChanges?.()
    ),
  aiConfig: {
    mode: WORK_NOTES_AI_MODE,
    backendUrl: WORK_NOTES_AI_BACKEND_URL,
    channel: APP_CHANNEL,
  },
  hasUnsavedNotebookChanges: () => notebook.hasUnsavedChanges(),
  onOpenNotebook: id => { if (showRoute({section:"notebook",tab:null},{updateHash:true}) !== false) notebook.openNote(id); },
  onNotebookChanged: () => notebook.refresh(),
  onTaskCountChange: count => { document.querySelector('#home-todo-count').textContent = `· ${count} open`; },
});
applyPropertyIdentity(propertySettings);
const navigationKey = navigationStorageKey(APP_CHANNEL);
let navigationStorage;
try { navigationStorage = globalThis.localStorage; } catch { /* Optional navigation state is not record storage. */ }
let navigation = loadNavigation(navigationStorage, navigationKey);
let currentRoute = { section: "home", tab: null };
let weatherMountPromise = null;
let settingsMountPromise = null;
let servicingMountPromise = null;
let serviceWorkspaceMountPromise = null;

function ensureWeatherMounted() {
  if (weatherMountPromise) {
    weather.refresh();
    return weatherMountPromise;
  }
  weatherHost.innerHTML = '<p class="weather-loading">Weather Shortcuts loading…</p>';
  weatherMountPromise = import("./modules/weather/weather-app.mjs")
    .then(({ mountWeatherApp }) => {
      weather = mountWeatherApp(weatherHost);
      applyPropertyIdentity(propertySettings);
      weather.refresh();
      return weather;
    })
    .catch(() => {
    const failure = `
      <style>:host{display:block}.weather-isolated-error{font:16px Arial,sans-serif;background:#fff;border:1px solid #d5ddd4;border-radius:14px;color:#18231b;margin:28px auto;max-width:680px;padding:18px}.weather-isolated-error p{color:#5c685f;line-height:1.45}</style>
      <section class="weather-isolated-error">
        <strong>Weather Shortcuts are unavailable</strong>
        <p>Calculator, Paddocks and Work Diary are unaffected. Saved weather shortcuts remain in the combined backup.</p>
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
        onBackupRequest: (action) => openCombinedBackup(action),
        onLibraryChange: () => spray.refreshPaddockLibrary?.(),
        hasExternalUnsavedLibraryChanges: () => spray.hasUnsavedLibraryChanges?.() === true,
        onPropertyChange: (next) => { propertySettings = next; applyPropertyTheme(next); applyPropertyIdentity(next); workNotes.refreshPropertySettings?.(next); spray.refresh?.(); servicing.refresh?.(); serviceWorkspace.refresh?.(); },
      });
      applyPropertyIdentity(propertySettings);
      settings.refresh();
      return settings;
    })
    .catch(() => {
      const failure = `
        <style>:host{display:block}.settings-isolated-error{font:16px Arial,sans-serif;background:#fff;border:1px solid #d5ddd4;border-radius:14px;color:#18231b;margin:28px auto;max-width:680px;padding:18px}.settings-isolated-error p{color:#5c685f;line-height:1.45}</style>
        <section class="settings-isolated-error">
          <strong>Settings are unavailable</strong>
          <p>Calculator, Paddocks, Weather Shortcuts and Work Diary are unaffected. Existing device records have not been changed.</p>
        </section>
      `;
      if (settingsHost.shadowRoot) settingsHost.shadowRoot.innerHTML = failure;
      else settingsHost.innerHTML = failure;
      return settings;
    });
  return settingsMountPromise;
}

function ensureServicingMounted() {
  if (servicingMountPromise) { servicing.refresh(); return servicingMountPromise; }
  servicingHost.innerHTML = '<p>4830 Servicing loading…</p>';
  servicingMountPromise = Promise.all([
    import('./modules/servicing/servicing-app.mjs'),
    import('./modules/servicing/servicing-adapter.mjs'),
  ]).then(([{mountServicingApp},{createServicingAdapter}]) => {
    servicing = mountServicingApp(servicingHost, {
      adapter:createServicingAdapter({storage:getStorage()}),
      getPropertySettings:()=>propertySettings,
    });
    applyPropertyIdentity(propertySettings);
    servicing.refresh();
    return servicing;
  }).catch(() => {
    const failure='<section role="alert"><h2>4830 Servicing unavailable</h2><p>Existing records have not been changed. Equipment templates and other sections remain separate.</p></section>';
    if(servicingHost.shadowRoot) servicingHost.shadowRoot.innerHTML=failure;
    else servicingHost.innerHTML=failure;
    return servicing;
  });
  return servicingMountPromise;
}
function ensureServiceWorkspaceMounted() {
  if (serviceWorkspaceMountPromise) {
    serviceWorkspace.refresh();
    return serviceWorkspaceMountPromise;
  }
  serviceWorkspaceHost.innerHTML = '<p class="servicing-loading">Servicing loading…</p>';
  serviceWorkspaceMountPromise = import("./modules/servicing-workspace-app.mjs")
    .then(({ mountServicingWorkspaceApp }) => {
      serviceWorkspace = mountServicingWorkspaceApp(serviceWorkspaceHost, { onDirtyChange: dirty => {
        if (!dirty) document.querySelector('#navigation-warning').hidden = true;
      } });
      applyPropertyIdentity(propertySettings);
      serviceWorkspace.refresh();
      return serviceWorkspace;
    })
    .catch(() => {
      const failure = `
        <style>:host{display:block}.servicing-isolated-error{font:16px Arial,sans-serif;background:#fff;border:1px solid #d5ddd4;border-radius:14px;color:#18231b;margin:28px auto;max-width:680px;padding:18px}.servicing-isolated-error p{color:#5c685f;line-height:1.45}</style>
        <section class="servicing-isolated-error">
          <strong>Servicing is unavailable</strong>
          <p>No service draft was created or changed. Calculator, Paddocks, Buffers and Work Diary are unaffected.</p>
        </section>
      `;
      if (serviceWorkspaceHost.shadowRoot) serviceWorkspaceHost.shadowRoot.innerHTML = failure;
      else serviceWorkspaceHost.innerHTML = failure;
      return serviceWorkspace;
    });
  return serviceWorkspaceMountPromise;
}
const panels = [...document.querySelectorAll("[data-panel]")];
const sectionNavigation = document.querySelector("#section-navigation");
const measureNavigation = () => {
  const height = sectionNavigation.getBoundingClientRect().height;
  if (height > 0) document.documentElement.style.setProperty('--section-nav-height', `${height}px`);
};
new ResizeObserver(measureNavigation).observe(sectionNavigation);
const currentSectionTitle = document.querySelector("#current-section-title");
const continueButton = document.querySelector("#continue-button");
const continueTitle = document.querySelector("#continue-title");
const continueDetail = document.querySelector("#continue-detail");
const sectionTitles = {
  spray: "Spray Operations",
  weather: "Weather Shortcuts",
  "work-notes": "Work Diary",
  notebook: "Notebook",
  servicing: "4830 Servicing",
  "service-workspace": "Equipment & service templates",
  settings: "Settings",
};

function updateContinueCard() {
  const copy = continueCopy(navigation.last);
  continueTitle.textContent = copy.title;
  continueDetail.textContent = copy.detail;
}
function updateActiveWork() {
  const info = spray.getResumeInfo?.();
  const button = document.querySelector('#active-work-button');
  button.hidden = !info;
  if (info) {
    button.dataset.tab = info.tab;
    document.querySelector('#active-work-title').textContent = info.title;
    document.querySelector('#active-work-detail').textContent = info.detail;
  }
}
async function updateBackupStatus() {
  try { document.querySelector('.home-backup-help').textContent = (await getBackupStatus()).message; }
  catch { document.querySelector('.home-backup-help').textContent = 'Backup status could not be checked. Keep a verified backup file separately.'; }
}

function rememberSelectedRoute(route) {
  navigation = rememberRoute(navigation, route);
  try {
    navigation = persistNavigation(navigationStorage, navigationKey, navigation);
  } catch {
    // Navigation remains usable when device settings cannot be written.
  }
  updateContinueCard();
}

function showRoute(route, { updateHash = false } = {}) {
  const selected = normalizeRoute(route, navigation);
  const navigationWarning = document.querySelector('#navigation-warning');
  const serviceBlocker = serviceNavigationBlocker(currentRoute,selected,{legacy:servicing,workspace:serviceWorkspace});
  if (serviceBlocker) {
    navigationWarning.textContent = serviceBlocker;
    navigationWarning.hidden = false;
    history.replaceState(null, '', hashForRoute(currentRoute));
    return false;
  }
  if (currentRoute.section === 'notebook' && selected.section !== 'notebook' && notebook.hasUnsavedChanges()) {
    navigationWarning.textContent = notebook.getUnsavedBlocker() || 'Wait for Notebook to save, or use Retry before leaving.';
    navigationWarning.hidden = false;
    history.replaceState(null, '', hashForRoute(currentRoute));
    return false;
  }
  navigationWarning.hidden = true;
  currentRoute = selected;
  panels.forEach((panel) => {
    panel.hidden = panel.dataset.panel !== selected.section;
  });
  sectionNavigation.hidden = selected.section === "home";
  if (selected.section === 'home') { updateActiveWork(); void updateBackupStatus(); }
  currentSectionTitle.textContent = sectionTitles[selected.section] || "";

  if (selected.section !== "home") rememberSelectedRoute(selected);
  if (selected.section === "spray") spray.showView(selected.tab);
  if (selected.section === "weather") ensureWeatherMounted();
  if (selected.section === "settings") ensureSettingsMounted();
  if (selected.section === "servicing") ensureServicingMounted();
  if (selected.section === "service-workspace") ensureServiceWorkspaceMounted();
  if (selected.section === "notebook") { notebook.refresh(); notebook.show(); applyAppearance(); }
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

function backupBlocker() {
  if (isStorageBusy()) return {message:'A save is still finishing. Wait a moment and try again.'};
  if (notebook.hasUnsavedChanges()) return {message:notebook.getUnsavedBlocker() || 'Notebook has unsaved changes. Open Notebook and retry.',section:'notebook'};
  if (servicing.hasUnsavedChanges()) return {message:servicing.getUnsavedBlocker?.() || 'Resolve the unfinished 4830 service before backup or restore.',section:'servicing'};
  if (serviceWorkspace.hasUnsavedChanges()) return {message:serviceWorkspace.getUnsavedBlocker?.() || 'Save or cancel the unfinished equipment or template change.',section:'service-workspace'};
  if (spray.hasUnsavedChanges?.()) return spray.getUnsavedBlocker?.() || {message:'Resolve the unfinished Spray Operations edit.',section:'spray',tab:'calculator'};
  if (workNotes.hasUnsavedChanges?.()) return {message:'Work Diary has an unconfirmed save. Open Work Diary and retry saving.',section:'work-notes',tab:'notes'};
  if (settings.hasUnsavedChanges?.()) {
    const detail=settings.getUnsavedBlocker?.();
    return {message:detail?.message || 'Save or cancel the unfinished Settings change.',section:'settings',settingsSection:detail?.section};
  }
  if (weather.hasUnsavedChanges?.()) return {message:'Save or cancel the unfinished weather link.',section:'weather'};
  return null;
}
const nativeBackup = mountNativeBackup({hasUnsavedChanges: () => Boolean(backupBlocker()),getBlocker:backupBlocker,onResolve:async blocker=>{
  if(blocker.section)showRoute(blocker,{updateHash:true});
  if(blocker.section==='settings' && blocker.settingsSection) {await ensureSettingsMounted();settings.openSection?.(blocker.settingsSection);}
}});
function openCombinedBackup() { nativeBackup.open(); }

sprayHost.requestTopLevelView = (tab) => showRoute({ section: "spray", tab }, { updateHash: true });
workNotesHost.requestTopLevelSection = (tab) => showRoute({ section: "work-notes", tab }, { updateHash: true });
document.querySelectorAll("[data-open-section]").forEach((button) => {
  button.addEventListener("click", () => showRoute(button.dataset.openTab ? {section:button.dataset.openSection,tab:button.dataset.openTab} : routeForSection(button.dataset.openSection), { updateHash: true }));
});
document.querySelector("#main-menu-button").addEventListener("click", () => {
  showRoute({ section: "home", tab: null }, { updateHash: true });
});
continueButton.addEventListener("click", () => showRoute(navigation.last, { updateHash: true }));
document.querySelector('#active-work-button').addEventListener('click',event=>showRoute({section:'spray',tab:event.currentTarget.dataset.tab},{updateHash:true}));
window.addEventListener('native-backup-status-changed',()=>void updateBackupStatus());
window.addEventListener('pilot-work-change',updateActiveWork);
document.querySelector("#home-backup-all-records").addEventListener("click", () => openCombinedBackup("backup"));
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
  const registerWorker = async () => {
    try {
      const registration = await navigator.serviceWorker.register(new URL("../sw.js", import.meta.url), { scope: new URL("../", import.meta.url).pathname, updateViaCache: "none" });
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
  };
  if (document.readyState === "complete") void registerWorker();
  else window.addEventListener("load", registerWorker, { once: true });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (updateRequested) location.reload();
  });
}

updateNow.addEventListener("click", () => {
  if (!waitingWorker) return;
  const blocker = backupBlocker();
  if (blocker) { const notice = document.querySelector("#navigation-warning"); notice.textContent = blocker.message; notice.hidden = false; return; }
  updateRequested = true;
  updateNow.disabled = true;
  updateNow.textContent = "Updating…";
  waitingWorker.postMessage({ type: "SKIP_WAITING" });
});

import {
  WEATHER_SETTINGS_VERSION,
  inspectWeatherSettingsStore,
  persistWeatherSettings,
} from "../storage.mjs";
import {
  DEFAULT_WILLY_LINK,
  moveWeatherLink,
  normalizeWeatherLinks,
  normalizeWeatherUrl,
  removeWeatherLink,
} from "./links.mjs";

const template = `
  <link rel="stylesheet" href="./styles/weather.css" />
  <div class="weather-root">
    <main class="weather-shell">
      <header class="weather-header">
        <img src="./brand-mark.png" alt="" width="58" height="58" />
        <div><p id="weather-farm-name">Pallathorpe</p><h1>Weather Shortcuts</h1></div>
      </header>

      <section class="shortcut-intro">
        <strong>Open your trusted weather services</strong>
        <span>Saved links open separately and need an internet connection. Your phone may hand a supported website to its associated app.</span>
      </section>

      <section id="weather-settings-lock" class="settings-recovery settings-lock" role="alert" tabindex="-1" hidden>
        <div><strong id="weather-settings-lock-title">Weather settings protected</strong><span id="weather-settings-lock-message"></span></div>
        <button id="download-original-weather-settings" type="button">Download original settings</button>
      </section>
      <section id="weather-settings-unsaved" class="settings-recovery settings-unsaved" role="status" aria-live="polite" tabindex="-1" hidden>
        <div><strong>Weather changes not saved yet</strong><span>The current shortcuts are held in memory only. Retry saving or download a recovery copy before closing the app.</span></div>
        <div class="settings-recovery-actions"><button id="retry-weather-settings" type="button">Retry saving</button><button id="download-unsaved-weather-settings" type="button">Download recovery copy</button></div>
      </section>

      <section class="links-card" aria-labelledby="weather-links-title">
        <div class="links-heading"><div><p>Weather links</p><h2 id="weather-links-title">Saved shortcuts</h2></div><button id="add-weather-link" type="button">Add link</button></div>
        <div id="weather-links"></div>
      </section>
    </main>

    <dialog id="link-dialog" aria-labelledby="link-dialog-title">
      <form method="dialog" id="link-form" class="dialog-shell">
        <header><div><p>Weather shortcut</p><h2 id="link-dialog-title">Add link</h2></div><button id="close-link-dialog" type="button" value="cancel" aria-label="Close">×</button></header>
        <label>Label<input id="link-label" maxlength="80" required /></label>
        <label>Secure address<input id="link-url" type="url" inputmode="url" required placeholder="https://" /></label>
        <p class="link-help">New and edited shortcuts must use a secure https:// address.</p>
        <p id="link-error" class="form-error" role="alert" hidden></p>
        <div class="dialog-actions"><button id="cancel-link-dialog" type="button" value="cancel" class="quiet">Cancel</button><button id="save-link" value="default">Save link</button></div>
      </form>
    </dialog>
  </div>
`;

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
})[character]);

export function mountWeatherApp(host) {
  const root = host.shadowRoot || host.attachShadow({ mode: "open" });
  root.innerHTML = template;
  const $ = (selector) => root.querySelector(selector);
  let settingsInspection;
  try {
    settingsInspection = inspectWeatherSettingsStore();
  } catch (error) {
    settingsInspection = { status: "corrupt", raw: null, value: null, error };
  }
  let settingsWriteLocked = ["corrupt", "future"].includes(settingsInspection.status);
  let settings = settingsInspection.status === "ready"
    ? settingsInspection.value
    : { version: WEATHER_SETTINGS_VERSION, location: null, links: [] };
  settings.links = normalizeWeatherLinks(settings.links);
  let pendingSettingsSave = false;
  let editingLinkId = null;

  function renderSettingsRecovery() {
    const lock = $("#weather-settings-lock");
    lock.hidden = !settingsWriteLocked;
    if (settingsWriteLocked) {
      const newer = settingsInspection.status === "future";
      $("#weather-settings-lock-title").textContent = newer
        ? "Newer weather settings protected"
        : "Unreadable weather settings protected";
      $("#weather-settings-lock-message").textContent = newer
        ? "These settings were created by a newer app version. They remain untouched; restore a verified combined backup from Work Notes to replace them."
        : "These settings could not be read and remain untouched. Download the original bytes before using a verified combined backup to replace them.";
      $("#download-original-weather-settings").disabled = typeof settingsInspection.raw !== "string";
    }
    $("#weather-settings-unsaved").hidden = !pendingSettingsSave;
    $("#add-weather-link").disabled = settingsWriteLocked;
  }

  function renderLinks() {
    $("#weather-links").innerHTML = settings.links.map((link, index) => `
      <article class="weather-link-row">
        <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(link.label)}</strong><small>${escapeHtml(link.url)}</small></a>
        <div>
          <button type="button" data-link-action="up" data-link-id="${escapeHtml(link.id)}" aria-label="Move ${escapeHtml(link.label)} up" ${settingsWriteLocked || index === 0 ? "disabled" : ""}>↑</button>
          <button type="button" data-link-action="down" data-link-id="${escapeHtml(link.id)}" aria-label="Move ${escapeHtml(link.label)} down" ${settingsWriteLocked || index === settings.links.length - 1 ? "disabled" : ""}>↓</button>
          <button type="button" data-link-action="edit" data-link-id="${escapeHtml(link.id)}" ${settingsWriteLocked ? "disabled" : ""}>Edit</button>
          ${link.id === DEFAULT_WILLY_LINK.id ? "" : `<button type="button" data-link-action="remove" data-link-id="${escapeHtml(link.id)}" ${settingsWriteLocked ? "disabled" : ""}>Remove</button>`}
        </div>
      </article>
    `).join("");
  }

  function saveSettings(nextSettings = settings) {
    if (settingsWriteLocked) {
      renderSettingsRecovery();
      $("#weather-settings-lock").focus();
      return false;
    }
    settings = nextSettings;
    try {
      persistWeatherSettings(settings);
      pendingSettingsSave = false;
    } catch (error) {
      if (error?.code === "PROTECTED_EXISTING_DATA" && error.inspection) {
        settingsInspection = error.inspection;
        settingsWriteLocked = true;
      }
      pendingSettingsSave = true;
    }
    renderLinks();
    renderSettingsRecovery();
    if (pendingSettingsSave) $("#weather-settings-unsaved").focus();
    return !pendingSettingsSave;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function dateStamp() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  function downloadOriginalSettings() {
    if (typeof settingsInspection.raw !== "string") return;
    downloadBlob(
      new Blob([settingsInspection.raw], { type: "application/json;charset=utf-8" }),
      `pallathorpe-weather-settings-original_${dateStamp()}.json`,
    );
  }

  function downloadUnsavedSettings() {
    const recovery = {
      format: "pallathorpe-weather-settings-recovery",
      version: 1,
      generatedAt: new Date().toISOString(),
      weatherSettings: settings,
    };
    downloadBlob(
      new Blob([`${JSON.stringify(recovery, null, 2)}\n`], { type: "application/json;charset=utf-8" }),
      `pallathorpe-weather-settings-unsaved_${dateStamp()}.json`,
    );
  }

  function openLinkDialog(link = null) {
    editingLinkId = link?.id || null;
    $("#link-form").reset();
    $("#link-dialog-title").textContent = link ? "Edit link" : "Add link";
    $("#link-label").value = link?.label || "";
    $("#link-url").value = link?.url || "";
    $("#link-error").textContent = "";
    $("#link-error").hidden = true;
    $("#link-dialog").showModal();
  }

  function closeLinkDialog() {
    const dialog = $("#link-dialog");
    if (dialog.open) dialog.close("cancel");
  }

  root.addEventListener("click", (event) => {
    const action = event.target.closest("[data-link-action]");
    if (!action) return;
    if (settingsWriteLocked) {
      renderSettingsRecovery();
      $("#weather-settings-lock").focus();
      return;
    }
    const id = action.dataset.linkId;
    let nextLinks = settings.links;
    if (action.dataset.linkAction === "up") nextLinks = moveWeatherLink(settings.links, id, -1);
    if (action.dataset.linkAction === "down") nextLinks = moveWeatherLink(settings.links, id, 1);
    if (action.dataset.linkAction === "remove") nextLinks = removeWeatherLink(settings.links, id);
    if (action.dataset.linkAction === "edit") {
      const link = settings.links.find((item) => item.id === id);
      if (link) openLinkDialog(link);
      return;
    }
    saveSettings({ ...settings, links: nextLinks });
  });

  $("#add-weather-link").addEventListener("click", () => openLinkDialog());
  $("#close-link-dialog").addEventListener("click", closeLinkDialog);
  $("#cancel-link-dialog").addEventListener("click", closeLinkDialog);
  $("#save-link").addEventListener("click", (event) => {
    event.preventDefault();
    try {
      const label = $("#link-label").value.trim();
      if (!label) throw new TypeError("Enter a link label.");
      const url = normalizeWeatherUrl($("#link-url").value);
      const links = editingLinkId
        ? settings.links.map((link) => link.id === editingLinkId ? { ...link, label, url } : link)
        : [...settings.links, { id: crypto.randomUUID?.() || `link-${Date.now()}`, label, url, builtIn: false }];
      saveSettings({ ...settings, links });
      $("#link-dialog").close();
    } catch (error) {
      $("#link-error").textContent = error.message;
      $("#link-error").hidden = false;
    }
  });
  $("#download-original-weather-settings").addEventListener("click", downloadOriginalSettings);
  $("#retry-weather-settings").addEventListener("click", () => saveSettings());
  $("#download-unsaved-weather-settings").addEventListener("click", downloadUnsavedSettings);

  renderLinks();
  renderSettingsRecovery();
  if (!settingsWriteLocked) {
    const normalizedRaw = JSON.stringify(settings);
    if (settingsInspection.status === "absent" || settingsInspection.raw !== normalizedRaw) saveSettings();
  }

  const refresh = () => {
    renderLinks();
    renderSettingsRecovery();
  };
  host.refreshOnOpen = refresh;
  return {
    refresh,
    getSettings: () => structuredClone(settings),
    hasUnsavedChanges: () => pendingSettingsSave,
  };
}

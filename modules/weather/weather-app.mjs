import {
  ENABLE_FIXTURE_WEATHER,
  ENABLE_OPEN_METEO_DEVELOPMENT,
  WEATHER_PROVIDER_MODE,
} from "../../config.mjs";
import {
  WEATHER_SETTINGS_VERSION,
  inspectWeatherSettingsStore,
  persistWeatherSettings,
} from "../storage.mjs";
import { cacheMatchesLocation, cacheState, readWeatherCache, writeWeatherCache } from "./cache.mjs";
import { drawWindChart } from "./chart.mjs";
import { FixtureWeatherProvider } from "./fixture-provider.mjs";
import { DEFAULT_WILLY_LINK, moveWeatherLink, normalizeWeatherLinks, normalizeWeatherUrl } from "./links.mjs";
import { OpenMeteoDevelopmentProvider } from "./open-meteo-provider.mjs";
import { compassDirection, deltaT } from "./provider.mjs";

const template = `
  <link rel="stylesheet" href="./styles/weather.css" />
  <div class="weather-root">
    <main class="weather-shell">
      <header class="weather-header">
        <img src="./brand-mark.png" alt="" width="58" height="58" />
        <div><p>Pallathorpe</p><h1>Farm Weather</h1></div>
        <button id="weather-refresh" type="button">Refresh</button>
      </header>

      <section class="location-card" aria-labelledby="weather-location-name">
        <div><span aria-hidden="true">●</span><div><h2 id="weather-location-name">No location selected</h2><p id="weather-location-detail">Choose a location when a live source is approved.</p></div></div>
        <button id="change-location" type="button">Change</button>
      </section>

      <section id="weather-settings-lock" class="settings-recovery settings-lock" role="alert" tabindex="-1" hidden>
        <div><strong id="weather-settings-lock-title">Weather settings protected</strong><span id="weather-settings-lock-message"></span></div>
        <button id="download-original-weather-settings" type="button">Download original settings</button>
      </section>
      <section id="weather-settings-unsaved" class="settings-recovery settings-unsaved" role="status" aria-live="polite" tabindex="-1" hidden>
        <div><strong>Weather changes not saved yet</strong><span>The current location or shortcuts are held in memory only. Retry saving or download a recovery copy before closing the app.</span></div>
        <div class="settings-recovery-actions"><button id="retry-weather-settings" type="button">Retry saving</button><button id="download-unsaved-weather-settings" type="button">Download recovery copy</button></div>
      </section>

      <section id="weather-status" class="source-state" aria-live="polite"></section>
      <section id="forecast-view" hidden>
        <article class="current-card">
          <div class="wind-now"><p>Current model forecast</p><strong id="current-wind">—</strong><span id="current-direction">—</span></div>
          <div class="gust-now"><p>Gusts</p><strong id="current-gust">—</strong></div>
          <p class="source-line" id="forecast-source"></p>
        </article>
        <div class="range-switch" role="tablist" aria-label="Wind forecast range">
          <button type="button" data-days="1" class="selected" aria-selected="true">1 Day</button>
          <button type="button" data-days="3" aria-selected="false">3 Days</button>
          <button type="button" data-days="5" aria-selected="false">5 Days</button>
        </div>
        <article class="chart-card">
          <h2>Wind speed and direction</h2>
          <canvas id="wind-chart" role="img"></canvas>
          <div class="chart-legend"><span><i class="forecast-line"></i>Forecast wind</span><span><i class="gust-line"></i>Forecast gust</span></div>
        </article>
        <article class="metric-card">
          <div><small>Rain chance / amount</small><strong id="metric-rain">—</strong></div>
          <div><small>Temperature</small><strong id="metric-temperature">—</strong></div>
          <div><small>Humidity</small><strong id="metric-humidity">—</strong></div>
          <div><small>Dew point / Delta T</small><strong id="metric-delta">—</strong></div>
        </article>
        <article class="outlook-card"><h2>Seven-day outlook</h2><div id="daily-outlook"></div></article>
        <p class="weather-disclaimer">Glance-only forecast information. This app does not decide whether it is safe to spray.</p>
      </section>

      <section class="links-card" aria-labelledby="weather-links-title">
        <div class="links-heading"><div><p>Weather links</p><h2 id="weather-links-title">Saved shortcuts</h2></div><button id="add-weather-link" type="button">Add link</button></div>
        <div id="weather-links"></div>
      </section>
    </main>

    <dialog id="location-dialog">
      <form method="dialog" id="location-form" class="dialog-shell">
        <header><div><p>Weather settings</p><h2>Choose location</h2></div><button value="cancel" aria-label="Close">×</button></header>
        <label>Search Australian locations<input id="location-query" autocomplete="off" placeholder="Town or postcode" aria-describedby="location-search-help" /></label>
        <p id="location-search-help" class="provider-note"></p>
        <button id="search-location" type="button">Search</button>
        <div id="location-results" aria-live="polite"></div>
        <details><summary>Enter coordinates manually</summary>
          <label>Location label<input id="manual-label" maxlength="80" /></label>
          <div class="coordinate-grid"><label>Latitude<input id="manual-latitude" type="number" step="any" /></label><label>Longitude<input id="manual-longitude" type="number" step="any" /></label></div>
          <button id="save-manual-location" type="button">Save location</button>
        </details>
        <p id="location-error" class="form-error" hidden></p>
        <button value="cancel" class="quiet">Cancel</button>
      </form>
    </dialog>

    <dialog id="link-dialog">
      <form method="dialog" id="link-form" class="dialog-shell">
        <header><div><p>Weather shortcut</p><h2 id="link-dialog-title">Add link</h2></div><button value="cancel" aria-label="Close">×</button></header>
        <label>Label<input id="link-label" maxlength="80" required /></label>
        <label>Address<input id="link-url" type="url" inputmode="url" required placeholder="https://" /></label>
        <p id="link-error" class="form-error" hidden></p>
        <div class="dialog-actions"><button value="cancel" class="quiet">Cancel</button><button id="save-link" value="default">Save link</button></div>
      </form>
    </dialog>
  </div>
`;

const display = (value, suffix = "", digits = 1) => Number.isFinite(value) ? `${Number(value).toFixed(digits)}${suffix}` : "—";
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);

function selectedProvider() {
  if (WEATHER_PROVIDER_MODE === "fixture" && ENABLE_FIXTURE_WEATHER) return new FixtureWeatherProvider();
  if (WEATHER_PROVIDER_MODE === "open-meteo" && ENABLE_OPEN_METEO_DEVELOPMENT) return new OpenMeteoDevelopmentProvider();
  return null;
}

export function mountWeatherApp(host) {
  const root = host.shadowRoot || host.attachShadow({ mode: "open" });
  root.innerHTML = template;
  const $ = (selector) => root.querySelector(selector);
  const provider = selectedProvider();
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
  let forecast = null;
  let chartDays = 1;
  let editingLinkId = null;
  let fetching = null;
  let locationSearch = null;

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
    const unsaved = $("#weather-settings-unsaved");
    unsaved.hidden = !pendingSettingsSave;
    $("#change-location").disabled = settingsWriteLocked;
    $("#add-weather-link").disabled = settingsWriteLocked;
  }

  function renderLocation() {
    $("#weather-location-name").textContent = settings.location?.label || "No location selected";
    $("#weather-location-detail").textContent = settings.location
      ? `${display(settings.location.latitude, "", 4)}, ${display(settings.location.longitude, "", 4)}`
      : provider ? "Search an Australian town or postcode." : "Choose a location when a live source is approved.";
  }

  function renderLinks() {
    $("#weather-links").innerHTML = settings.links.map((link, index) => `
      <article class="weather-link-row">
        <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(link.label)}</strong><small>${escapeHtml(link.url)}</small></a>
        <div>
          <button type="button" data-link-action="up" data-link-id="${escapeHtml(link.id)}" aria-label="Move ${escapeHtml(link.label)} up" ${settingsWriteLocked || index === 0 ? "disabled" : ""}>↑</button>
          <button type="button" data-link-action="down" data-link-id="${escapeHtml(link.id)}" aria-label="Move ${escapeHtml(link.label)} down" ${settingsWriteLocked || index === settings.links.length - 1 ? "disabled" : ""}>↓</button>
          <button type="button" data-link-action="edit" data-link-id="${escapeHtml(link.id)}" ${settingsWriteLocked ? "disabled" : ""}>Edit</button>
          ${link.builtIn ? "" : `<button type="button" data-link-action="remove" data-link-id="${escapeHtml(link.id)}" ${settingsWriteLocked ? "disabled" : ""}>Remove</button>`}
        </div>
      </article>
    `).join("");
  }

  function renderStatus(message, kind = "info") {
    const status = $("#weather-status");
    status.className = `source-state ${kind}`;
    status.innerHTML = message;
  }

  function renderForecast(nextForecast, { stale = false, offline = false } = {}) {
    forecast = nextForecast;
    $("#forecast-view").hidden = false;
    const current = forecast.current;
    $("#current-wind").textContent = display(current.windSpeed, " km/h");
    $("#current-direction").textContent = compassDirection(current.windDirection);
    $("#current-gust").textContent = display(current.windGust, " km/h");
    const fetched = new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(forecast.fetchedAt));
    const providerLabel = escapeHtml(forecast.providerName);
    const providerSource = forecast.attributionUrl
      ? `<a href="${escapeHtml(forecast.attributionUrl)}" target="_blank" rel="noopener noreferrer">${providerLabel}</a>`
      : providerLabel;
    $("#forecast-source").innerHTML = `${providerSource} · model forecast · formatted for display in this app · fetched ${escapeHtml(fetched)}`;
    $("#metric-rain").textContent = `${display(current.precipitationProbability, "%", 0)} / ${display(current.precipitation, " mm")}`;
    $("#metric-temperature").textContent = display(current.temperature, "°C");
    $("#metric-humidity").textContent = display(current.humidity, "%", 0);
    const derived = deltaT(current.temperature, current.wetBulb);
    $("#metric-delta").textContent = `${display(current.dewPoint, "°C")} / ${derived === null ? "—" : `${display(derived, "°C")} derived`}`;
    $("#daily-outlook").innerHTML = forecast.daily.slice(0, 7).map((day) => `
      <div><strong>${escapeHtml(new Intl.DateTimeFormat("en-AU", { weekday: "short" }).format(new Date(`${day.date}T00:00:00`)))}</strong><span>${display(day.temperatureMin, "°", 0)}–${display(day.temperatureMax, "°", 0)}</span><small>${display(day.precipitationProbability, "%", 0)} · ${display(day.precipitation, " mm")}</small><small>${compassDirection(day.windDirection)} ${display(day.windSpeedMax, " km/h", 0)}</small></div>
    `).join("");
    drawWindChart($("#wind-chart"), forecast.hourly, chartDays);
    if (offline) renderStatus("<strong>Offline cached forecast</strong><span>The last successful model forecast is shown and may be out of date.</span>", "stale");
    else if (stale) renderStatus("<strong>Cached forecast is stale</strong><span>Refresh when connected for newer model data.</span>", "stale");
    else if (forecast.providerId === "open-meteo-development") renderStatus("<strong>TEST evaluation model forecast</strong><span>Open-Meteo values are model output, not station observations or a spray-safety verdict. Production use requires an approved licensed source.</span>", "ready");
    else renderStatus("<strong>Model forecast</strong><span>Forecast values are not station observations and are not a spray-safety verdict.</span>", "ready");
  }

  function renderUnconfigured() {
    if (provider && !settings.location) {
      $("#forecast-view").hidden = true;
      renderStatus("<strong>Choose a location</strong><span>Open Change, then search a recognised Australian town or postcode. This TEST feed uses Open-Meteo model forecasts for evaluation only.</span>", "ready");
      return;
    }
    const cached = readWeatherCache();
    const fixtureAllowed = cached?.forecast?.providerId !== "fixture" || ENABLE_FIXTURE_WEATHER;
    if (cached && fixtureAllowed && cacheMatchesLocation(cached, settings.location)) {
      renderForecast(cached.forecast, { stale: true, offline: !navigator.onLine });
      return;
    }
    $("#forecast-view").hidden = true;
    renderStatus("<strong>Live weather source not configured</strong><span>The weather view is ready, but no approved live provider is enabled. Use the saved shortcuts below for WillyWeather or OzForecast.</span>", "unconfigured");
  }

  async function refresh({ force = false } = {}) {
    if (!provider || !settings.location) {
      renderUnconfigured();
      return;
    }
    const candidate = readWeatherCache();
    const cached = cacheMatchesLocation(candidate, settings.location) ? candidate : null;
    const state = cacheState(cached);
    if (!navigator.onLine && cached) {
      renderForecast(cached.forecast, { stale: true, offline: true });
      return;
    }
    if (!force && cached && state.fresh) {
      renderForecast(cached.forecast);
      return;
    }
    fetching?.abort();
    fetching = new AbortController();
    renderStatus("<strong>Refreshing forecast…</strong><span>Other app sections remain available.</span>");
    try {
      const result = await provider.fetchForecast(settings.location, fetching.signal);
      writeWeatherCache(result);
      renderForecast(result);
    } catch (error) {
      if (error.name === "AbortError") return;
      if (cached) renderForecast(cached.forecast, { stale: true, offline: !navigator.onLine });
      else renderStatus(`<strong>Weather is unavailable</strong><span>${escapeHtml(error.message)} Calculator, Paddocks and Work Notes are unaffected.</span>`, "error");
    }
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
    renderLocation();
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

  async function searchLocations() {
    const results = $("#location-results");
    const searchButton = $("#search-location");
    const query = $("#location-query").value.trim();
    if (!provider) {
      results.innerHTML = "<p>Location search is disabled because no approved live provider is configured. Manual coordinates can still be saved for later.</p>";
      return;
    }
    if (query.length < 2) {
      results.innerHTML = "<p>Enter at least two characters from an Australian town or postcode.</p>";
      return;
    }
    locationSearch?.abort();
    const controller = new AbortController();
    locationSearch = controller;
    searchButton.disabled = true;
    searchButton.textContent = "Searching…";
    results.innerHTML = "<p class=\"search-progress\">Searching Australian locations…</p>";
    try {
      const matches = await provider.searchLocations(query, controller.signal);
      results.innerHTML = matches.map((location) => `<button type="button" data-location='${escapeHtml(JSON.stringify(location))}'>${escapeHtml(location.label)}</button>`).join("")
        || `<p>No Australian locations found for <strong>${escapeHtml(query)}</strong>. Check the spelling, try the nearest town or postcode, or enter coordinates below.</p>`;
    } catch (error) {
      if (error.name === "AbortError") return;
      results.innerHTML = `<p>${escapeHtml(error.message)} Try again, use the nearest town/postcode, or enter coordinates below.</p>`;
    } finally {
      if (locationSearch === controller) {
        locationSearch = null;
        searchButton.disabled = false;
        searchButton.textContent = "Search";
      }
    }
  }

  root.addEventListener("click", async (event) => {
    const range = event.target.closest("[data-days]");
    if (range) {
      chartDays = Number(range.dataset.days);
      root.querySelectorAll("[data-days]").forEach((button) => {
        const selected = button === range;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-selected", String(selected));
      });
      if (forecast) drawWindChart($("#wind-chart"), forecast.hourly, chartDays);
      return;
    }
    const action = event.target.closest("[data-link-action]");
    if (action) {
      if (settingsWriteLocked) {
        renderSettingsRecovery();
        $("#weather-settings-lock").focus();
        return;
      }
      const id = action.dataset.linkId;
      let nextLinks = settings.links;
      if (action.dataset.linkAction === "up") nextLinks = moveWeatherLink(settings.links, id, -1);
      if (action.dataset.linkAction === "down") nextLinks = moveWeatherLink(settings.links, id, 1);
      if (action.dataset.linkAction === "remove") nextLinks = settings.links.filter((link) => link.id !== id);
      if (action.dataset.linkAction === "edit") {
        const link = settings.links.find((item) => item.id === id);
        editingLinkId = id;
        $("#link-dialog-title").textContent = "Edit link";
        $("#link-label").value = link.label;
        $("#link-url").value = link.url;
        $("#link-dialog").showModal();
        return;
      }
      saveSettings({ ...settings, links: nextLinks });
    }
  });

  $("#weather-refresh").addEventListener("click", () => refresh({ force: true }));
  $("#change-location").addEventListener("click", () => $("#location-dialog").showModal());
  $("#add-weather-link").addEventListener("click", () => {
    editingLinkId = null;
    $("#link-form").reset();
    $("#link-dialog-title").textContent = "Add link";
    $("#link-dialog").showModal();
  });
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
  $("#search-location").addEventListener("click", searchLocations);
  $("#location-query").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    searchLocations();
  });
  $("#location-results").addEventListener("click", (event) => {
    const button = event.target.closest("[data-location]");
    if (!button) return;
    const location = JSON.parse(button.dataset.location);
    saveSettings({ ...settings, location });
    $("#location-dialog").close();
    refresh({ force: true });
  });
  $("#save-manual-location").addEventListener("click", () => {
    const label = $("#manual-label").value.trim();
    const latitude = Number($("#manual-latitude").value);
    const longitude = Number($("#manual-longitude").value);
    if (!label || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      $("#location-error").textContent = "Enter a label and valid latitude/longitude.";
      $("#location-error").hidden = false;
      return;
    }
    const location = { id: `manual-${latitude}-${longitude}`, label, latitude, longitude, timezone: "Australia/Brisbane" };
    saveSettings({ ...settings, location });
    $("#location-dialog").close();
    refresh({ force: true });
  });
  globalThis.addEventListener("resize", () => forecast && drawWindChart($("#wind-chart"), forecast.hourly, chartDays));

  $("#download-original-weather-settings").addEventListener("click", downloadOriginalSettings);
  $("#retry-weather-settings").addEventListener("click", () => saveSettings());
  $("#download-unsaved-weather-settings").addEventListener("click", downloadUnsavedSettings);

  renderLocation();
  renderLinks();
  renderSettingsRecovery();
  if (!settingsWriteLocked) {
    const normalizedRaw = JSON.stringify(settings);
    if (settingsInspection.status === "absent" || settingsInspection.raw !== normalizedRaw) saveSettings();
  }
  if (provider?.id === "open-meteo-development") {
    $("#location-search-help").textContent = "TEST evaluation only: search a recognised town or postcode. Farm names may not appear. Weather is model forecast data from Open-Meteo, not observations.";
  } else if (provider) {
    $("#location-search-help").textContent = "Search a recognised town or postcode, or enter coordinates manually.";
  } else {
    $("#location-search-help").textContent = "Search is unavailable until an approved provider is configured. You may save coordinates for later.";
    $("#location-query").disabled = true;
    $("#search-location").disabled = true;
  }
  renderUnconfigured();
  host.refreshOnOpen = () => refresh();
  return {
    refresh,
    getSettings: () => structuredClone(settings),
    hasUnsavedChanges: () => pendingSettingsSave,
  };
}

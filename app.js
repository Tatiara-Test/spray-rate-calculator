import { mountSprayApp } from "./modules/spray-app.mjs";
import { migrateLegacyData } from "./modules/storage.mjs";
import { mountWorkNotesApp } from "./modules/work-notes-app.mjs";
import { ENABLE_LEGACY_MIGRATION } from "./config.mjs";

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
const spray = mountSprayApp(sprayHost);
const workNotes = mountWorkNotesApp(document.querySelector("#work-notes-host"));
const weatherHost = document.querySelector("#weather-host");
weatherHost.innerHTML = '<p class="weather-loading">Weather view loading…</p>';
let weather = { refresh: () => {} };
import("./modules/weather/weather-app.mjs")
  .then(({ mountWeatherApp }) => {
    weather = mountWeatherApp(weatherHost);
    if (routeFromHash() === "weather") weather.refresh();
  })
  .catch(() => {
    const failure = `
      <style>:host{display:block}.weather-isolated-error{font:16px Arial,sans-serif;background:#fff;border:1px solid #d5ddd4;border-radius:14px;color:#18231b;margin:28px auto;max-width:680px;padding:18px}.weather-isolated-error p{color:#5c685f;line-height:1.45}</style>
      <section class="weather-isolated-error">
        <strong>Weather is unavailable</strong>
        <p>Calculator, Paddocks and Work Notes are unaffected. Saved weather shortcuts remain in the combined backup.</p>
      </section>
    `;
    if (weatherHost.shadowRoot) weatherHost.shadowRoot.innerHTML = failure;
    else weatherHost.innerHTML = failure;
  });
const routeButtons = [...document.querySelectorAll("[data-route]")];
const panels = [...document.querySelectorAll("[data-panel]")];
const validRoutes = new Set(["calculator", "paddocks", "weather", "work-notes"]);

function routeFromHash() {
  const route = location.hash.replace(/^#\/?/, "");
  return validRoutes.has(route) ? route : "calculator";
}

function showRoute(route, { updateHash = false } = {}) {
  const selected = validRoutes.has(route) ? route : "calculator";
  const panelName = ["calculator", "paddocks"].includes(selected) ? "spray" : selected;
  panels.forEach((panel) => {
    panel.hidden = panel.dataset.panel !== panelName;
  });
  routeButtons.forEach((button) => {
    if (button.dataset.route === selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (selected === "calculator" || selected === "paddocks") spray.showView(selected);
  if (selected === "weather") weather.refresh();
  if (selected === "work-notes") workNotes.renderAll();
  if (updateHash && location.hash !== `#/${selected}`) history.pushState(null, "", `#/${selected}`);
  window.scrollTo({ top: 0, behavior: "instant" });
}

sprayHost.requestTopLevelView = (route) => showRoute(route, { updateHash: true });

routeButtons.forEach((button) => {
  button.addEventListener("click", () => showRoute(button.dataset.route, { updateHash: true }));
});
window.addEventListener("hashchange", () => showRoute(routeFromHash()));
showRoute(routeFromHash());

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

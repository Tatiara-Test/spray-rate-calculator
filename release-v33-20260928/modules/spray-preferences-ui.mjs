import { getStorage, transactStorage } from "./durable-storage.mjs";
import { loadSprayPreferences, saveSprayPreferences } from "./spray-preferences.mjs";

export function mountSprayPreferencesUI(document, { onChange = () => {} } = {}) {
  const $ = selector => document.querySelector(selector);
  const owner = document.ownerDocument || document;
  let busy = false;
  const dirty = { rate: false, equipment: false };
  let preferences = null, loadError = "", editingRate = null, editingEquipment = null, selectedRate = null;
  try { preferences = loadSprayPreferences(getStorage()); }
  catch { loadError = "Saved spray settings could not be read. Settings changes are disabled to protect the stored data."; }
  const getPreferences = () => preferences ? structuredClone(preferences) : null;
  const feedback = (kind, message = "") => {
    const element = $(`#spray-${kind}-preference-error`);
    element.textContent = message;
    element.hidden = !message;
  };
  const button = (text, action, value) => {
    const element = owner.createElement("button");
    element.type = "button";
    element.textContent = text;
    element.dataset[action] = String(value);
    return element;
  };
  function renderRates(currentRate = selectedRate) {
    selectedRate = currentRate;
    const list = $("#saved-rate-buttons");
    list.replaceChildren();
    for (const rate of preferences?.rates || []) {
      const item = button(String(rate), "rate", rate);
      item.classList.toggle("selected", Number(currentRate) === rate);
      item.setAttribute("aria-pressed", String(Number(currentRate) === rate));
      list.append(item);
    }
  }
  function renderLists() {
    const rates = $("#spray-rates-list");
    rates.replaceChildren();
    for (const rate of preferences?.rates || []) {
      const row = owner.createElement("div");
      row.className = "preference-row";
      const label = owner.createElement("strong");
      label.textContent = `${rate} L/ha`;
      row.append(label, button("Edit", "editSavedRate", rate), button("Remove", "removeSavedRate", rate));
      rates.append(row);
    }
    const equipment = $("#spray-equipment-list");
    equipment.replaceChildren();
    for (const entry of preferences?.equipment || []) {
      const row = owner.createElement("div");
      row.className = "preference-row";
      const label = owner.createElement("span");
      const name = owner.createElement("strong");
      name.textContent = entry.name;
      const details = owner.createElement("small");
      details.textContent = `${entry.methods.map(method => method === "Camera" ? "Camera spray" : method).join(" · ")}${entry.archived ? " · Archived" : ""}`;
      label.append(name, details);
      row.append(label, button("Edit", "editEquipment", entry.id), button(entry.archived ? "Restore" : "Archive", "archiveEquipment", entry.id));
      equipment.append(row);
    }
    for (const form of document.querySelectorAll(".preference-editor")) {
      for (const control of form.querySelectorAll("input, button")) control.disabled = busy || !preferences;
    }
  }
  function resetRate() {
    dirty.rate = false;
    editingRate = null;
    $("#spray-rate-preference-value").value = "";
    $("#spray-rate-editor-label").textContent = "Add rate";
    $("#save-rate-preference").textContent = "Add rate";
    $("#cancel-rate-preference-edit").hidden = true;
    feedback("rate", loadError);
  }
  function resetEquipment() {
    dirty.equipment = false;
    editingEquipment = null;
    $("#spray-equipment-preference-name").value = "";
    $("#spray-equipment-broadacre").checked = true;
    $("#spray-equipment-camera").checked = false;
    $("#spray-equipment-editor-label").textContent = "Add sprayer";
    $("#save-equipment-preference").textContent = "Add sprayer";
    $("#cancel-equipment-preference-edit").hidden = true;
    feedback("equipment", loadError);
  }
  async function persist(next, kind) {
    dirty[kind] = true;
    if (!preferences) { feedback(kind, loadError); return false; }
    if (busy) return false;
    busy = true;
    const controls = [...document.querySelectorAll(".preference-editor input, .preference-editor button, .preference-row button")];
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    try { preferences = await transactStorage(storage => saveSprayPreferences(structuredClone(next), storage)); }
    catch (error) { feedback(kind, `Changes were not saved. ${error.message || "Try again."}`); return false; }
    finally { busy = false; controls.forEach((control, index) => { control.disabled = disabled[index]; }); }
    dirty[kind] = false;
    renderLists();
    renderRates();
    onChange(getPreferences());
    return true;
  }
  function openRates() {
    resetRate(); renderLists();
    if (!$("#spray-rates-dialog").open) $("#spray-rates-dialog").showModal();
    $("#spray-rate-preference-value").focus();
  }
  function openEquipment() {
    resetEquipment(); renderLists();
    if (!$("#spray-equipment-dialog").open) $("#spray-equipment-dialog").showModal();
  }
  for (const kind of ["rate", "equipment"]) {
    const form = $(`#spray-${kind}-preference-form`);
    for (const type of ["input", "change"]) form.addEventListener(type, () => { dirty[kind] = true; });
  }
  document.addEventListener("click", async event => {
    if (busy) return;
    const target = event.target.closest("button");
    if (!target) return;
    if (target.matches("[data-add-rate], [data-manage-rates]")) openRates();
    if (target.matches("[data-manage-sprayers]")) openEquipment();
    if (target.matches("[data-close-preferences]")) target.closest("dialog").close();
    if (target.id === "cancel-rate-preference-edit") resetRate();
    if (target.id === "cancel-equipment-preference-edit") resetEquipment();
    if (!preferences || busy) return;
    if (target.hasAttribute("data-edit-saved-rate")) {
      editingRate = Number(target.dataset.editSavedRate);
      $("#spray-rate-preference-value").value = editingRate;
      $("#spray-rate-editor-label").textContent = "Edit rate";
      $("#save-rate-preference").textContent = "Save rate";
      $("#cancel-rate-preference-edit").hidden = false;
      feedback("rate"); $("#spray-rate-preference-value").focus();
    }
    if (target.hasAttribute("data-remove-saved-rate")) {
      const rate = Number(target.dataset.removeSavedRate);
      const next = getPreferences(); next.rates = next.rates.filter(value => value !== rate);
      if (await persist(next, "rate")) { resetRate(); $("#spray-rate-preference-value").focus(); }
    }
    if (target.hasAttribute("data-edit-equipment")) {
      const entry = preferences.equipment.find(item => item.id === target.dataset.editEquipment);
      if (!entry) return;
      editingEquipment = entry.id;
      $("#spray-equipment-preference-name").value = entry.name;
      $("#spray-equipment-broadacre").checked = entry.methods.includes("Broadacre");
      $("#spray-equipment-camera").checked = entry.methods.includes("Camera");
      $("#spray-equipment-editor-label").textContent = "Edit sprayer";
      $("#save-equipment-preference").textContent = "Save sprayer";
      $("#cancel-equipment-preference-edit").hidden = false;
      feedback("equipment"); $("#spray-equipment-preference-name").focus();
    }
    if (target.hasAttribute("data-archive-equipment")) {
      const next = getPreferences();
      const entry = next.equipment.find(item => item.id === target.dataset.archiveEquipment);
      if (!entry) return;
      entry.archived = !entry.archived;
      if (await persist(next, "equipment")) { resetEquipment(); $("#spray-equipment-preference-name").focus(); }
    }
  });
  $("#spray-rate-preference-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!preferences || busy) return;
    const rate = Number($("#spray-rate-preference-value").value);
    if (!Number.isFinite(rate) || rate <= 0) { feedback("rate", "Enter a rate greater than zero."); return; }
    if (preferences.rates.some(value => value === rate && value !== editingRate)) { feedback("rate", "That rate is already saved."); return; }
    const next = getPreferences();
    next.rates = editingRate === null ? [...next.rates, rate] : next.rates.map(value => value === editingRate ? rate : value);
    if (await persist(next, "rate")) { resetRate(); $("#spray-rate-preference-value").focus(); }
  });
  $("#spray-equipment-preference-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!preferences || busy) return;
    const name = $("#spray-equipment-preference-name").value.trim().replace(/\s+/g, " ");
    const methods = [];
    if ($("#spray-equipment-broadacre").checked) methods.push("Broadacre");
    if ($("#spray-equipment-camera").checked) methods.push("Camera");
    if (!name) { feedback("equipment", "Enter a sprayer name."); return; }
    if (!methods.length) { feedback("equipment", "Choose at least one supported method."); return; }
    if (preferences.equipment.some(entry => entry.id !== editingEquipment && entry.name.toLocaleLowerCase("en-AU") === name.toLocaleLowerCase("en-AU"))) { feedback("equipment", "A sprayer with that name already exists, including archived sprayers."); return; }
    const next = getPreferences();
    if (editingEquipment) Object.assign(next.equipment.find(entry => entry.id === editingEquipment), { name, methods });
    else next.equipment.push({ id: `sprayer-${globalThis.crypto.randomUUID()}`, name, methods, archived: false });
    if (await persist(next, "equipment")) { resetEquipment(); $("#spray-equipment-preference-name").focus(); }
  });
  $("#spray-preferences-warning").textContent = loadError;
  $("#spray-preferences-warning").hidden = !loadError;
  renderRates(); renderLists();
  return { getPreferences, renderRates, openRates, openEquipment, hasUnsavedChanges: () => busy || dirty.rate || dirty.equipment };
}

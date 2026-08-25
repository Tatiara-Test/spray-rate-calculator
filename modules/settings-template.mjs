export const SETTINGS_TEMPLATE = `
  <link rel="stylesheet" href="./styles/settings.css" />
  <div class="settings-root">
    <main class="settings-shell">
      <header class="settings-header">
        <img src="./brand-mark.png" alt="" width="56" height="56" />
        <img class="farmer-assistant-emblem" src="./farmers-assistant-emblem.png" alt="Farmer’s Assistant FH emblem" width="48" height="48" />
        <div><p id="settings-farm-name">Pallathorpe Enterprises</p><h1>Settings</h1></div>
      </header>

      <section class="settings-warning settings-lock-warning" id="library-lock-warning" role="alert" tabindex="-1" hidden>
        <div><strong id="library-lock-title">Paddock Library protected</strong><p id="library-lock-message"></p></div>
        <button id="download-original-library" type="button">Download original data</button>
      </section>
      <section class="settings-warning settings-write-warning" id="library-write-warning" role="status" aria-live="polite" hidden>
        <div><strong>Library changes not saved yet</strong><p>The latest Paddock Library change is held in memory only. Retry saving or download a recovery copy before closing the app.</p></div>
        <div class="warning-actions"><button id="retry-library-save" type="button">Retry saving</button><button id="download-library-recovery" type="button">Download recovery copy</button></div>
      </section>

      <section class="settings-card app-guide-card" aria-labelledby="app-guide-heading">
        <div class="settings-card-heading">
          <div><p class="eyebrow">Help that works offline</p><h2 id="app-guide-heading">App guide</h2><p>Follow the main workflows in a simple on-screen guide, or keep a printable PDF copy.</p></div>
          <span>Offline</span>
        </div>
        <div class="app-guide-actions">
          <button class="primary-button" id="view-app-guide" type="button">View guide</button>
          <button class="quiet-button" id="share-app-guide" type="button">Download / Share PDF</button>
        </div>
        <p class="app-guide-status" id="app-guide-status" role="status" aria-live="polite" hidden></p>
      </section>

      <section class="settings-card" aria-labelledby="property-settings-heading">
        <div class="settings-card-heading">
          <div><p class="eyebrow">Saved on this phone</p><h2 id="property-settings-heading">Property &amp; appearance</h2><p>Use your farm identity in compact headers and exported document headings. The Farmer’s Assistant identity and FH emblem stay fixed.</p></div>
          <span id="property-storage-status">Saved on this phone only</span>
        </div>
        <p class="settings-warning settings-property-warning" id="property-settings-warning" role="alert" hidden></p>
        <form id="property-settings-form" class="library-form">
          <div class="library-form-grid">
            <label><span>Farm or business name</span><input id="property-business-name" maxlength="120" required /></label>
            <label><span>Short display name <small>optional</small></span><input id="property-short-name" maxlength="40" /></label>
            <label><span>Default reporting period</span><select id="property-default-period"><option value="week">Week</option><option value="fortnight">Fortnight</option><option value="month">Month</option></select></label>
            <label><span>Appearance theme</span><select id="property-theme"><option value="pallathorpe">Pallathorpe</option><option value="fieldbook">Fieldbook</option><option value="mallee">Mallee Earth</option><option value="bluegum">Blue Gum</option></select></label>
          </div>
          <p class="form-help">Themes are fixed accessible presets. No uploaded logo or custom theme is stored.</p>
          <p class="form-error" id="property-settings-error" role="alert" hidden></p>
          <div class="form-actions"><button class="primary-button" id="save-property-settings" type="submit">Save property settings</button></div>
        </form>
        <div class="branding-preview" id="branding-preview" aria-label="Document header preview"><p class="eyebrow">Live document-header preview</p><strong id="branding-preview-short">Pallathorpe</strong><span id="branding-preview-business">Pallathorpe Enterprises</span><small>Farmer’s Assistant · FH emblem fixed</small></div>
      </section>

      <section class="settings-card" aria-labelledby="downloaded-copies-heading">
        <div class="settings-card-heading">
          <div><p class="eyebrow">Phone storage</p><h2 id="downloaded-copies-heading">Downloaded copies</h2><p>Downloaded files are managed by Android outside the web app. On Samsung, open My Files, choose Downloads, select the files, then tap Delete and Move to Trash.</p></div>
          <span>Android</span>
        </div>
      </section>

      <section class="settings-card" aria-labelledby="paddock-library-heading">
        <div class="settings-card-heading">
          <div><p class="eyebrow">Saved farm details</p><h2 id="paddock-library-heading">Paddock Library</h2><p>Names and total hectares are saved on this phone and can be selected inside Spray Operations.</p></div>
          <span id="library-count" aria-live="polite">0 paddocks</span>
        </div>
        <p class="storage-status" id="library-storage-status">Saved on this phone only</p>

        <form class="library-form" id="library-form">
          <h3 id="library-form-title">Add paddock</h3>
          <div class="library-form-grid">
            <label><span>Paddock name</span><input id="library-name" maxlength="60" autocomplete="off" required /></label>
            <label><span>Total hectares <small>optional</small></span><span class="input-with-unit"><input id="library-total-hectares" type="number" inputmode="decimal" min="0" step="any" placeholder="e.g. 320" /><b>ha</b></span></label>
          </div>
          <p class="form-help">Total hectares describe the saved paddock, not the hectares planned for a particular spray job.</p>
          <p class="form-error" id="library-form-error" role="alert" hidden></p>
          <div class="form-actions"><button class="primary-button" id="save-library-entry" type="submit">Add paddock</button><button class="quiet-button" id="cancel-library-edit" type="button" hidden>Cancel edit</button></div>
        </form>

        <div class="library-list" id="library-list"></div>
        <div class="empty-library" id="library-empty"><strong>No paddocks saved yet</strong><p>Add a paddock here or from Spray Operations.</p></div>

        <details class="archived-library" id="archived-library" hidden>
          <summary id="archived-library-summary">Archived paddocks · 0</summary>
          <p>Archived paddocks stay in backups and existing spray records. Restore one to select it for a new job.</p>
          <div class="archived-library-list" id="archived-library-list"></div>
        </details>
      </section>
    </main>

    <dialog class="app-guide-dialog" id="app-guide-dialog" aria-labelledby="app-guide-dialog-title" aria-describedby="app-guide-dialog-intro">
      <div class="app-guide-dialog-panel">
        <header class="app-guide-dialog-header">
          <div><p class="eyebrow">Pallathorpe Enterprises</p><h2 id="app-guide-dialog-title" tabindex="-1">App guide</h2></div>
          <button id="close-app-guide" type="button" aria-label="Close app guide">Close</button>
        </header>
        <p class="app-guide-intro" id="app-guide-dialog-intro">Choose a section from the Main menu. Saved records stay on this device unless you deliberately export or share a copy.</p>

        <div class="app-guide-flow" aria-label="Main menu sections">
          <strong>Main menu</strong><span aria-hidden="true">&#8595;</span>
          <div><b>Spray Operations</b><small>Calculate, save and review tank or Buffer records.</small></div>
          <div><b>Work Notes</b><small>Write notes, review a Week, Fortnight or Month and manage the To-do list.</small></div>
          <div><b>Weather Shortcuts</b><small>Open saved weather websites or associated apps.</small></div>
          <div><b>4830 Servicing</b><small>Complete the checklist and prepare a service record.</small></div>
          <div><b>Settings</b><small>Manage the Paddock Library and open this guide.</small></div>
        </div>

        <article class="app-guide-section">
          <h3>Spray Operations</h3>
          <ol><li>Enter the tank mix in Calculator.</li><li>Save a tank or start and allocate a Buffer.</li><li>Open Paddocks to review the Spray Record and share PDF or CSV copies.</li></ol>
          <p>Coverage and chemical-equivalent figures are calculated from saved records. They are not GPS-measured unique ground.</p>
        </article>
        <article class="app-guide-section">
          <h3>Work Notes and To-do list</h3>
          <ol><li>Write or dictate a daily note.</li><li>Review Summary for the selected Week, Fortnight or Month.</li><li>Keep outstanding work in the To-do list, then share or download a copy when ready.</li></ol>
        </article>
        <article class="app-guide-section">
          <h3>Weather Shortcuts</h3>
          <p>Add trusted website links, arrange them, then open the one you need. This section stores shortcuts only; it does not provide a built-in forecast or spray-safety verdict.</p>
        </article>
        <article class="app-guide-section">
          <h3>4830 Servicing</h3>
          <ol><li>Create a draft for the service date and engine hours.</li><li>Work through the checklist, adding notes, exceptions or to-do items.</li><li>Finalise only when the record is ready, then prepare the PDF copy.</li></ol>
        </article>
        <article class="app-guide-section">
          <h3>Settings, Paddock Library and backup</h3>
          <p>Add, edit or archive saved paddock names and total hectares in Paddock Library. Combined backup and restore controls are in Work Notes under Data. A restore changes device records only after confirmation.</p>
        </article>
      </div>
    </dialog>
    <div class="settings-toast" id="settings-toast" role="status" aria-live="polite" hidden></div>
  </div>
`;

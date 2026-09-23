export const SETTINGS_TEMPLATE = `
  <link rel="stylesheet" href="./styles/settings.css" />
  <div class="settings-root">
    <main class="settings-shell">
      <header class="settings-header">
        <img class="farmer-assistant-emblem" src="./farmers-assistant-emblem.png" alt="Farmer’s Assistant FH emblem" width="53" height="53" />
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
          <div><p class="eyebrow">Help that works offline</p><h2 id="app-guide-heading">How to use the app</h2><p>Follow short, task-based instructions on screen, or keep a printable PDF copy.</p></div>
          <span>Offline</span>
        </div>
        <div class="app-guide-actions">
          <button class="primary-button" id="view-app-guide" type="button">View guide</button>
          <button class="quiet-button" id="share-app-guide" type="button">Download / Share PDF</button>
        </div>
        <p class="app-guide-status" id="app-guide-status" role="status" aria-live="polite" hidden></p>
      </section>

      <section class="settings-card backup-card" aria-labelledby="settings-backup-heading">
        <div class="settings-card-heading"><div><p class="eyebrow">Protect every section</p><h2 id="settings-backup-heading">Backup and restore</h2><p>Create one restorable JSON file containing records from across the app. Keep it somewhere separate from this phone. Restoring replaces matching records only after the app shows a confirmation.</p></div><span>All records</span></div>
        <div class="backup-actions"><button class="primary-button" id="settings-backup-all-records" type="button">Back up all records</button><button class="quiet-button" id="settings-restore-all-records" type="button">Restore all records</button></div>
        <p class="form-help">If backup or restore is unavailable, resolve the related section’s unsaved change or download its recovery copy first. PDF, CSV and text files are readable copies. The combined JSON backup is the file the app can restore.</p>
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

      <section class="settings-card" aria-labelledby="downloaded-files-heading">
        <div class="settings-card-heading">
          <div><p class="eyebrow">Phone storage</p><h2 id="downloaded-files-heading">Downloaded files</h2><p>Downloaded files are managed by Android outside the web app. On Samsung, open My Files, choose Downloads, select the files, then tap Delete and Move to Trash.</p></div>
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
          <div><b>Settings</b><small>Learn the app, back up records and manage farm details.</small></div>
        </div>

        <article class="app-guide-section">
          <h3>Calculate and save one tank</h3>
          <ol><li>Open <b>Calculator</b>, enter <b>Tank total, including all products</b> and the spray rate, then add each product and unit.</li><li>Review the calculated amounts and choose <b>Save tank record</b>.</li><li>Complete the paddock, date, operator, machine and application review, then choose <b>Save tank</b>.</li><li>After saving, choose <b>View saved record</b> or <b>Prepare next tank</b>.</li></ol>
          <p>If an unfinished calculation appears after reopening, choose <b>Resume calculation</b> or <b>Start fresh</b>. A resumed unfinished edit becomes a new unsaved calculation; the original tank is unchanged. If saved records or restore history changed, the old draft remains visible but cannot safely resume.</p><p>Coverage and chemical-equivalent figures are calculated from saved records. They are not GPS-measured unique ground.</p>
        </article>
        <article class="app-guide-section"><h3>Use one Buffer across paddocks</h3><ol><li>Prepare the mix, choose <b>Start buffer</b> and select the paddocks for this job.</li><li>At each paddock, enter <b>Litres sprayed in this paddock</b>. If you sprayed 500 L, enter 500. The app shows the litres remaining.</li><li>Review the allocation, then choose <b>Save allocation</b>. Use <b>Manage paddocks for this buffer</b> to add another paddock.</li><li>Choose <b>Finish buffer</b> before sharing its paddock records. Finish the current Buffer before refilling, then prepare the next mix.</li></ol></article>
        <article class="app-guide-section"><h3>Find and recover a tank record</h3><p><b>Find paddock</b> matches part of a name; <b>Clear</b> restores the recent-first list. After a confirmed deletion, <b>Undo tank deletion</b> can restore only the most recent deletion until another saved-record change or backup restore. Clearing or archiving that paddock prevents recovery, and a new deletion replaces it.</p></article>
        <article class="app-guide-section">
          <h3>Work Notes and To-do list</h3>
          <ol><li>Choose <b>Week</b>, <b>Fortnight</b> or <b>Month</b>, then tap <b>Open today’s note</b> or another date.</li><li>Type in <b>What did you do?</b>; check the saved indicator, then tap <b>Done</b>.</li><li>Open <b>Summary</b> and choose <b>Share / Save Copy</b>, or manage outstanding work in <b>To-do list</b>.</li></ol><p>Manual notes and summaries work without AI. Optional dictation and AI tools require setup and an internet connection; AI summaries currently require Fortnight view.</p>
        </article>
        <article class="app-guide-section">
          <h3>Weather Shortcuts</h3>
          <p>Add trusted website links, arrange them, then open the one you need. This section stores shortcuts only; it does not provide a built-in forecast or spray-safety verdict.</p>
        </article>
        <article class="app-guide-section">
          <h3>4830 Servicing</h3>
          <p>First check the availability message. If it says <b>Prepared, not active</b>, record writing is unavailable.</p><ol><li>When writes are enabled, create a draft for the service date and engine hours.</li><li>Work through the checklist, adding notes, reasons or to-do items.</li><li>Finalise only when ready, then prepare the PDF copy.</li></ol>
        </article>
        <article class="app-guide-section">
          <h3>Back up all records</h3><ol><li>Open <b>Settings</b>, then <b>Backup and restore</b>.</li><li>If the action is unavailable, resolve the related section’s unsaved change or download its recovery copy first.</li><li>Tap <b>Back up all records</b> and keep the combined JSON file somewhere separate from this phone.</li><li>To recover it, choose <b>Restore all records</b>, select the intended JSON file and read the confirmation before continuing.</li></ol><p>A readable PDF, CSV or text copy cannot restore the app.</p>
        </article>
        <article class="app-guide-section"><h3>Property &amp; appearance</h3><ol><li>Enter the farm or business name and optional short display name.</li><li>Choose the default reporting period and appearance theme.</li><li>Tap <b>Save property settings</b>.</li></ol><p>Use <b>Paddock Library</b> to add, edit, archive or restore names and total hectares. Use <b>Downloaded files</b> for guidance on files saved by the phone.</p></article>
      </div>
    </dialog>
    <div class="settings-toast" id="settings-toast" role="status" aria-live="polite" hidden></div>
  </div>
`;

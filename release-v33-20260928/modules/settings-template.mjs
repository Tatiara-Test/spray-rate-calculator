export const SETTINGS_TEMPLATE = `
  <link rel="stylesheet" href="./release-v33-20260928/styles/settings.css" />
  <div class="settings-root">
    <main class="settings-shell">
      <header class="settings-header">
        <img class="farmer-assistant-emblem" src="./release-v33-20260928/farmers-assistant-emblem.png" alt="Farmer’s Assistant FH emblem" width="53" height="53" />
        <div><p id="settings-farm-name">Pallathorpe Enterprises</p><h1>Settings</h1></div>
      </header>

      <nav class="settings-sections" aria-label="Settings sections">
        <button type="button" data-settings-section="help" aria-controls="settings-help-panel" aria-pressed="true">Help</button>
        <button type="button" data-settings-section="backup" aria-controls="settings-backup-panel" aria-pressed="false">Backup &amp; restore</button>
        <button type="button" data-settings-section="property" aria-controls="settings-property-panel" aria-pressed="false">Property &amp; appearance</button>
        <button type="button" data-settings-section="library" aria-controls="settings-library-panel" aria-pressed="false">Paddock library</button>
      </nav>
      <p class="settings-version">Farmhand 0.8 · Tatiara TEST · Web release v33</p>
      <section class="settings-warning settings-lock-warning" id="library-lock-warning" role="alert" tabindex="-1" hidden>
        <div><strong id="library-lock-title">Paddock Library protected</strong><p id="library-lock-message"></p></div>
        <button id="download-original-library" type="button">Download original data</button>
      </section>
      <section class="settings-warning settings-write-warning" id="library-write-warning" role="status" aria-live="polite" hidden>
        <div><strong>Library changes not saved yet</strong><p>The latest Paddock Library change is held in memory only. Retry saving or download a recovery copy before closing the app.</p></div>
        <div class="warning-actions"><button id="retry-library-save" type="button">Retry saving</button><button id="download-library-recovery" type="button">Download recovery copy</button></div>
      </section>

      <section class="settings-card app-guide-card" id="settings-help-panel" data-settings-panel="help" aria-labelledby="app-guide-heading">
        <div class="settings-card-heading">
          <div><p class="eyebrow">App help</p><h2 id="app-guide-heading">How to use the app</h2><p>Instructions for the Tatiara TEST web app. Open the app online first so its offline files can finish downloading.</p></div>
          <span>Guide</span>
        </div>
        <div class="app-guide-actions">
          <button class="primary-button" id="view-app-guide" type="button">View guide</button>

        </div>
      </section>

      <section class="settings-card backup-card" id="settings-backup-panel" data-settings-panel="backup" hidden aria-labelledby="settings-backup-heading">
        <p id="settings-backup-status" class="storage-status" role="status" aria-live="polite">Checking backup status…</p>
        <div class="settings-card-heading"><div><p class="eyebrow">Protect every section</p><h2 id="settings-backup-heading">Backup and restore</h2><p>Create one restorable JSON file containing records from across the app. Keep it somewhere separate from this browser. Restoring replaces the complete app state only after you review the backup and confirm. The previous state is retained for recovery.</p></div><span>All records</span></div>
        <div class="backup-actions"><button class="primary-button" id="settings-backup-all-records" type="button">Back up all records</button><button class="quiet-button" id="settings-restore-all-records" type="button">Restore all records</button></div>
        <p class="form-help">If backup or restore is unavailable, resolve the related section’s unsaved change or download its recovery copy first. PDF, CSV and text files are readable copies. Use a complete web backup to restore every section. Import older partial web backups from Work Diary; only their included sections are replaced.</p>
      </section>

      <section class="settings-card" id="settings-property-panel" data-settings-panel="property" hidden aria-labelledby="property-settings-heading">
        <div class="settings-card-heading">
          <div><p class="eyebrow">Saved on this browser</p><h2 id="property-settings-heading">Property &amp; appearance</h2><p>Use your farm identity in compact headers and exported document headings. The Farmer’s Assistant identity and FH emblem stay fixed.</p></div>
          <span id="property-storage-status">Saved in this browser only</span>
        </div>
        <p class="settings-warning settings-property-warning" id="property-settings-warning" role="alert" hidden></p>
        <form id="property-settings-form" class="library-form">
          <div class="library-form-grid">
            <label><span>Farm or business name</span><input id="property-business-name" maxlength="120" required /></label>
            <label><span>Short display name <small>optional</small></span><input id="property-short-name" maxlength="40" /></label>
            <label><span>Default reporting period</span><select id="property-default-period"><option value="week">Week</option><option value="fortnight">Fortnight</option><option value="month">Month</option></select></label>
            <label><span>Colour palette</span><select id="property-theme"><option value="pallathorpe">Pallathorpe</option><option value="fieldbook">Fieldbook</option><option value="mallee">Mallee Earth</option><option value="bluegum">Blue Gum</option></select></label>
          </div>
          <p class="form-help">Themes are fixed accessible presets. No uploaded logo or custom theme is stored.</p>
          <p class="form-error" id="property-settings-error" role="alert" hidden></p>
          <div class="form-actions"><button class="primary-button" id="save-property-settings" type="submit">Save property settings</button></div>
        </form>
        <form id="appearance-form" class="library-form appearance-form">
          <h3>Screen appearance</h3>
          <div class="library-form-grid">
            <label><span>Display mode</span><select id="appearance-mode"><option value="system">Follow device</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
            <label><span>Text size</span><select id="appearance-text-size"><option value="standard">Standard</option><option value="large">Large</option></select></label>
          </div>
          <p class="form-help">Follow device uses your device’s light or dark setting. These choices are saved separately from the farm name and colour palette.</p>
          <p id="appearance-status" role="status" aria-live="polite"></p>
          <div class="form-actions"><button id="save-appearance" class="primary-button" type="submit">Save appearance</button></div>
        </form>
        <div class="branding-preview" id="branding-preview" aria-label="Document header preview"><p class="eyebrow">Live document-header preview</p><strong id="branding-preview-short">Pallathorpe</strong><span id="branding-preview-business">Pallathorpe Enterprises</span><small>Farmer’s Assistant · FH emblem fixed</small></div>
      </section>

      <section class="settings-card" data-settings-panel="help" aria-labelledby="downloaded-files-heading">
        <div class="settings-card-heading">
          <div><p class="eyebrow">Browser downloads</p><h2 id="downloaded-files-heading">Downloaded files</h2><p>Your browser may offer a save location or start a download. Check its Downloads list; a download alone is not a verified saved copy. Keep a backup outside this app before removing app data or uninstalling.</p></div>
          <span>Browser</span>
        </div>
      </section>

      <section class="settings-card" id="settings-library-panel" data-settings-panel="library" hidden aria-labelledby="paddock-library-heading">
        <div class="settings-card-heading">
          <div><p class="eyebrow">Saved farm details</p><h2 id="paddock-library-heading">Paddock Library</h2><p>Names and total hectares are saved on this browser and can be selected inside Spray Operations.</p></div>
          <span id="library-count" aria-live="polite">0 paddocks</span>
        </div>
        <p class="storage-status" id="library-storage-status">Saved in this browser only</p>

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

        <article class="app-guide-section"><h3>Spray Operations</h3><p>Enter the tank total, spray rate, products and units. Review the calculation before saving a tank or starting a Buffer. For a Buffer, record litres sprayed in each paddock, then finish it before preparing the next mix. Each paddock shows running percentage, spray litres and separate product totals above its records. Coverage is calculated from records; it is not GPS-measured ground.</p><p>Mark paddock completed when you decide the work is finished; reaching 100% never completes it automatically. Finish its active Buffer and save or cancel unfinished edits first. Historical corrections remain available and can change totals without reopening. Reopen paddock before adding new tank or Buffer work. Completion retains records and is separate from archiving.</p></article>
        <article class="app-guide-section"><h3>Work Diary</h3><p>Open today’s note or choose a date. Type your note and wait for the saved indicator before closing. Review daily notes in Summary and manage outstanding work in the To-do list. Notes stay in this browser. Manual notes work offline after the app has downloaded its files. AI features require an internet connection and the configured service.</p></article>
        <article class="app-guide-section"><h3>Notebook</h3><p>Keep permanent notes and named checklists separately from daily work and To-do. Wait for Saved on this device; use Retry if saving fails. Checklist ticks never affect overdue jobs or wages. More contains pin, duplicate, archive and recoverable Bin actions. Duplicating a checklist starts its copy unchecked. Web backup includes Notebook, Archive and Bin.</p><p>Move to Notebook keeps a to-do’s full wording and reference dates, then removes it from the task count. Undo is available while the moved note is unchanged. Restoring a note from Bin does not recreate a to-do.</p></article>
        <article class="app-guide-section"><h3>Weather Shortcuts</h3><p>Save and arrange trusted weather links. Opening them needs an internet connection. The app does not provide a spray-safety verdict.</p></article>
        <article class="app-guide-section"><h3>Web backup and recovery</h3><ol><li>Open <b>Backup &amp; restore</b> in Settings.</li><li>Resolve any unsaved changes, then choose <b>Save backup file</b> and check your browser save location or Downloads list.</li><li>To restore, choose a complete web backup, review it, then confirm replacement. Cancelling leaves records unchanged.</li><li>Use <b>Recover before last restore</b> to review the retained previous state.</li></ol><p>PDF, CSV and text copies cannot restore the app. After a restore, old calculation drafts and undo records are retained but cannot be resumed. Sharing a backup does not prove the receiving app kept it.</p></article>
        <article class="app-guide-section"><h3>Property and paddocks</h3><p>Save farm identity, reporting period and colour palette under Property &amp; appearance. Save display mode and text size with Save appearance. Paddock library holds names and total hectares; job-specific planned hectares belong in the spray record.</p></article>
        <article class="app-guide-section"><h3>Equipment &amp; service templates</h3><p>Add equipment with a name, type, make/model and optional identifier. Choose hours, kilometres, both or neither. Open equipment to add a dated service record with the work done, optional meter readings, parts/fluids and notes. Use Save and wait for confirmation; Retry keeps an unsuccessful draft available. Save or cancel an unfinished edit before leaving or backing up.</p><p>Use Edit record deliberately to correct a saved entry. Each record retains the equipment details and meter basis from when it was created. Archive equipment to remove it from the active register; its history remains available and the equipment can be restored. Save or share a text copy of the history for reading. Complete Web backups include this register and its records. Open Service templates &amp; checklists for a machine to start with a blank template, copy another machine’s template, or explicitly choose the 4830 starter. Add, edit, arrange, exclude or restore sections and checks, then save a new template version. Choose intervals to start a service; save unfinished work as a draft, record results and reasons, and finalise only when every check has a result. Existing drafts and finalised reports retain their original details. Save or share a PDF of a blank sheet or service report. Automatic due reminders and attachments are not included.</p><p>Existing 4830 servicing remains under Legacy 4830 servicing. Its records are separate from equipment checklist reports.</p></article>
      </div>
    </dialog>
    <div class="settings-toast" id="settings-toast" role="status" aria-live="polite" hidden></div>
  </div>
`;

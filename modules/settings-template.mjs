export const SETTINGS_TEMPLATE = `
  <link rel="stylesheet" href="./styles/settings.css" />
  <div class="settings-root">
    <main class="settings-shell">
      <header class="settings-header">
        <img src="./brand-mark.png" alt="" width="56" height="56" />
        <div><p>Pallathorpe Enterprises</p><h1>Settings</h1></div>
      </header>

      <section class="settings-warning settings-lock-warning" id="library-lock-warning" role="alert" tabindex="-1" hidden>
        <div><strong id="library-lock-title">Paddock Library protected</strong><p id="library-lock-message"></p></div>
        <button id="download-original-library" type="button">Download original data</button>
      </section>
      <section class="settings-warning settings-write-warning" id="library-write-warning" role="status" aria-live="polite" hidden>
        <div><strong>Library changes not saved yet</strong><p>The latest Paddock Library change is held in memory only. Retry saving or download a recovery copy before closing the app.</p></div>
        <div class="warning-actions"><button id="retry-library-save" type="button">Retry saving</button><button id="download-library-recovery" type="button">Download recovery copy</button></div>
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
    <div class="settings-toast" id="settings-toast" role="status" aria-live="polite" hidden></div>
  </div>
`;

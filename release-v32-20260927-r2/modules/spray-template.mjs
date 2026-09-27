export const SPRAY_TEMPLATE = `
  <link rel="stylesheet" href="./release-v32-20260927-r2/styles/spray.css" />
  <div class="spray-root">
    <main class="app-shell">
      <header class="brand-header"><img class="farmer-assistant-emblem" src="./release-v32-20260927-r2/farmers-assistant-emblem.png" alt="Farmer’s Assistant FH emblem" width="60" height="60" /><div><p id="spray-farm-name" class="farm-name">Pallathorpe Enterprises</p><h1>Spray Rate Calculator</h1></div></header>
      <nav class="view-switch" aria-label="Spray Operations sections" role="tablist"><button id="spray-calculator-tab" class="selected" type="button" data-view-button="calculator" role="tab" aria-selected="true" aria-controls="calculator-view">Calculator</button><button id="spray-run-tab" type="button" data-view-button="run" role="tab" aria-selected="false" aria-controls="run-view">Buffers</button><button id="spray-paddocks-tab" type="button" data-view-button="paddocks" role="tab" aria-selected="false" aria-controls="paddocks-view">Paddocks</button></nav>
      <section class="storage-warning storage-lock-warning" id="storage-lock-warning" role="alert" tabindex="-1" hidden>
        <div><strong id="storage-lock-title">Paddock records protected</strong><p id="storage-lock-message"></p></div>
        <button id="download-original-records" type="button">Save original data</button>
      </section>
      <section class="storage-warning storage-lock-warning" id="profile-lock-warning" role="alert" tabindex="-1" hidden>
        <div><strong id="profile-lock-title">Operator profile protected</strong><p id="profile-lock-message"></p></div>
        <button id="download-original-profile" type="button">Save original profile</button>
      </section>
      <section class="storage-warning storage-lock-warning" id="library-lock-warning" role="alert" tabindex="-1" hidden>
        <div><strong id="library-lock-title">Paddock Library needs review</strong><p id="library-lock-message"></p></div>
      </section>
      <section class="storage-warning write-recovery-warning" id="write-recovery-warning" role="status" aria-live="polite" hidden>
        <div><strong>Changes not saved yet</strong><p>Some recent Spray, Paddocks, Paddock Library or operator-profile changes are held in memory only. Retry saving or download a recovery copy before closing the app.</p></div>
        <div class="storage-warning-actions"><button id="retry-record-save" type="button">Retry saving</button><button id="download-unsaved-records" type="button">Save recovery copy</button></div>
      </section>
      <div id="calculator-view" data-view-panel="calculator" role="tabpanel" aria-labelledby="spray-calculator-tab">
        <section id="draft-recovery" class="calculation-recovery" hidden aria-labelledby="draft-recovery-title">
          <strong id="draft-recovery-title">Unfinished calculation</strong><p id="draft-recovery-description"></p>
          <p>This is a draft, not a saved tank. Check every value and unit before saving. Buffer allocations are separate.</p>
          <div class="recovery-actions"><button id="resume-calculation" type="button">Resume calculation</button><button id="start-fresh-calculation" type="button">Start fresh</button></div>
        </section>
        <p id="draft-warning" class="recovery-error" role="alert" hidden></p>
        <p id="draft-status" class="draft-status" role="status" aria-live="polite"></p>
        <div id="calculation-workspace">
        <div class="edit-banner" id="edit-banner" hidden><div><strong id="edit-title">Editing tank record</strong><span>Update the calculation, then save the record.</span></div><button id="cancel-edit" type="button">Cancel edit</button></div>
        <section class="calculator-card" aria-labelledby="mix-heading">
          <div class="section-heading"><span class="step-number">1</span><div><h2 id="mix-heading">Tank mixture</h2><p>Enter the tank total, including all products.</p></div></div>
          <div class="tank-grid">
            <label class="field"><span>Tank total</span><span class="input-with-unit"><input id="mix-volume" type="number" inputmode="decimal" min="0" max="5000" step="any" placeholder="e.g. 2000" /><b>litres</b></span><small class="error" id="volume-error" hidden>Maximum tank total is 5,000 litres.</small></label>
            <fieldset class="field rate-field"><legend>Spray rate</legend><div id="saved-rate-buttons" class="quick-rates" aria-label="Saved spray rates"></div><div class="preference-actions"><button type="button" data-add-rate>+ Add rate</button><button type="button" data-manage-rates>Manage rates</button></div><span class="input-with-unit custom-rate"><input id="spray-rate" type="number" inputmode="decimal" min="0" step="any" placeholder="Other" aria-label="Spray rate in litres per hectare" /><b>L/ha</b></span><p id="spray-preferences-warning" class="recovery-error" role="alert" hidden></p></fieldset>
          </div>
          <div class="coverage" id="coverage" aria-live="polite"><span>Area covered</span><strong id="coverage-result">—</strong></div>
        </section>
        <section class="calculator-card products-card" aria-labelledby="products-heading">
          <div class="section-heading"><span class="step-number">2</span><div><h2 id="products-heading">Product rates</h2><p>Copy each rate and unit exactly from the spray sheet.</p></div></div>
          <div class="basis-key" aria-label="Rate type reminder"><span><i class="dot hectare-dot"></i> Per hectare</span><span><i class="dot water-dot"></i> Per 100 L water</span></div>
          <div class="product-list" id="product-list"></div><datalist id="chemical-suggestions"></datalist><p class="error product-name-error" id="product-name-error" role="alert" hidden></p><button class="add-product" id="add-product" type="button">+ Add product 2</button>
        </section>
        <section id="saved-tank-actions" class="calculation-recovery saved-tank-actions" role="status" hidden>
          <strong id="saved-tank-message"></strong><p>The mix stays here for your next tank. Review the tank total, products and units before saving again.</p>
          <div class="recovery-actions"><button id="view-saved-record" type="button">View saved record</button><button id="edit-saved-tank" type="button">Edit saved tank</button><button id="prepare-next-tank" type="button">Prepare next tank</button></div>
        </section>
        <button class="save-record-button" id="save-record-button" type="button">Save tank record</button><button class="secondary-record-button" id="start-run-from-calculator" type="button">Start buffer</button><button class="clear-button" id="clear-button" type="button">Clear calculation</button>
        </div>
      </div>
      <section id="run-view" data-view-panel="run" role="tabpanel" hidden aria-labelledby="spray-run-tab">
        <div class="run-intro"><div><p class="eyebrow">Allocate litres sprayed</p><h2>Multi-paddock buffer</h2><p>Enter the litres sprayed in each paddock. The app keeps track of the liquid left and allocates products to each paddock.</p></div></div>
        <section class="run-empty-card" id="run-empty-card">
          <strong>No buffer in progress</strong>
          <p id="run-calculation-status">Set up a tank mix in Calculator, then start a buffer.</p>
          <div class="run-empty-actions"><button id="open-run-dialog" type="button">Start from current mix</button><button type="button" data-switch-to-calculator>Open calculator</button></div>
        </section>
        <section class="active-run-card" id="active-run-card" hidden>
          <div class="active-run-heading"><div><p class="eyebrow">Active tank</p><h2 id="active-run-title">Buffer</h2></div><span id="active-run-method"></span></div>
          <div class="run-meta" id="active-run-meta"></div>
          <form id="run-allocation-form" class="run-allocation-form">
            <div class="save-grid run-paddock-grid">
              <label class="dialog-field"><span>Selected paddock</span><select id="run-paddock-name" required></select></label>
              <label class="dialog-field"><span>Saved total hectares</span><span class="input-with-unit compact-unit-input"><input id="run-paddock-size" type="number" inputmode="decimal" readonly aria-readonly="true" /><b>ha</b></span></label>
            </div>
            <p class="run-helper" id="run-selected-plan">Choose a paddock selected for this buffer.</p>
            <div class="controller-grid">
              <div><span>Litres remaining</span><strong id="run-controller-before">&mdash;</strong></div>
              <label class="dialog-field"><span>Litres sprayed in this paddock</span><span class="input-with-unit compact-unit-input"><input id="run-controller-after" type="number" inputmode="decimal" min="0.001" step="any" required aria-describedby="controller-remaining-help" /><b>L</b></span></label>
            </div>
            <p class="run-helper" id="controller-remaining-help">Enter only the litres sprayed in the selected paddock. If you sprayed 500 L, enter 500.</p>
            <p class="run-helper" id="run-allocation-preview">Enter litres sprayed to preview the allocation.</p>
            <p class="dialog-error" id="run-allocation-error" hidden></p>
            <button class="confirm-save-button" id="record-run-allocation" type="submit">Save allocation</button>
          </form>
          <details class="buffer-paddock-management"><summary>Manage paddocks for this buffer</summary>
          <fieldset class="job-paddock-picker active-run-paddocks">
            <legend>Paddocks selected for this buffer</legend>
            <div class="job-paddock-list" id="active-run-selected-paddocks" aria-live="polite"></div>
            <div class="job-paddock-controls">
              <label class="dialog-field"><span>Select or add a paddock</span><select id="active-run-library-paddock"></select></label>
              <input id="active-run-planned-hectares" type="hidden" disabled />
              <div class="new-library-paddock-fields" id="active-run-new-paddock-fields" hidden>
                <label class="dialog-field"><span>New paddock name</span><input id="active-run-new-paddock-name" maxlength="60" autocomplete="off" /></label>
                <label class="dialog-field"><span>Saved total hectares <small>optional</small></span><span class="input-with-unit compact-unit-input"><input id="active-run-new-paddock-total" type="number" inputmode="decimal" min="0" step="any" /><b>ha</b></span></label>
              </div>
              <button class="job-paddock-add" id="active-run-add-paddock" type="button">Add to this buffer</button>
            </div>
            <p class="dialog-error" id="active-run-paddock-error" hidden></p>
          </fieldset>
          </details>
          <div class="run-allocation-list" id="run-allocation-list"></div>
          <div class="run-finish-actions"><button id="finish-run" type="button">Finish buffer</button><button id="cancel-empty-run" class="danger-button" type="button">Cancel empty buffer</button></div>
          <p class="run-helper">Finish this buffer before refilling, then start a new buffer for the next mix.</p>
        </section>
        <section id="buffer-completion" class="calculation-recovery buffer-completion" role="status" hidden>
          <strong>Buffer finished</strong><p id="buffer-completion-summary"></p>
          <div class="recovery-actions"><button id="buffer-completion-view" type="button">View paddock records</button><button id="buffer-completion-next" type="button">Prepare next mix</button></div>
        </section>
      </section>
      <section id="paddocks-view" data-view-panel="paddocks" role="tabpanel" hidden aria-labelledby="spray-paddocks-tab">
        <div class="paddocks-intro"><div><h2 id="paddocks-heading">Paddock records</h2><p id="paddock-storage-status">Saved in this browser only</p><p class="operator-profile">Operator: <strong id="operator-profile-name">Not set</strong> <button id="change-operator" type="button">Change</button></p></div><span id="paddock-count">0 of 25 paddocks</span></div>
        <section id="tank-undo" class="calculation-recovery" hidden><strong>Deleted tank recovery</strong><p id="tank-undo-description"></p><p>Only the most recent deletion on this browser is kept, including after reopening. Undo is available until another saved-record change or backup restore. Clearing or archiving a paddock also prevents recovery. A new deletion replaces this recovery.</p><button id="undo-tank-delete" type="button">Undo tank deletion</button><p id="tank-undo-error" class="recovery-error" role="alert" hidden></p></section>
        <div class="paddock-search"><label class="field"><span>Find paddock</span><input id="find-paddock" type="search" placeholder="Part of a paddock name" autocomplete="off" /></label><button id="clear-paddock-search" type="button" hidden>Clear</button></div>
        <p id="paddock-no-matches" role="status" hidden>No paddocks match this name. Clear the search to see all paddocks.</p>
        <div class="paddock-list" id="paddock-list"></div>
        <div class="empty-state" id="paddock-empty"><strong>No paddocks saved yet</strong><p>Use Save tank record after completing a calculation.</p><button type="button" data-switch-to-calculator>Return to calculator</button></div>
        <details class="archived-paddocks" id="archived-paddocks" hidden>
          <summary id="archived-paddocks-summary">Archived paddocks · 0</summary>
          <p>Archived buffer-allocation records remain in this device's backups and can be restored.</p>
          <div class="archived-paddock-list" id="archived-paddock-list"></div>
        </details>
      </section>
    </main>
    <dialog class="save-dialog" id="save-dialog" aria-labelledby="save-dialog-title"><form method="dialog" class="save-panel" id="save-form">
      <div class="dialog-heading"><div><p class="eyebrow">Paddock record</p><h2 id="save-dialog-title">Save tank record</h2></div><button class="close-dialog" type="button" id="close-save-dialog" aria-label="Close">×</button></div>
      <fieldset class="job-paddock-picker">
        <legend>Paddock for this tank</legend>
        <div class="save-grid save-paddock-grid">
          <label class="dialog-field"><span>Select or add a paddock</span><select id="save-library-paddock" required></select></label>
          <label class="dialog-field"><span>Spray date</span><input id="save-spray-date" type="date" required /></label>
        </div>
        <div class="new-library-paddock-fields" id="save-new-paddock-fields" hidden>
          <label class="dialog-field"><span>New paddock name</span><input id="save-paddock-name" maxlength="60" autocomplete="off" /></label>
          <label class="dialog-field"><span>Saved total hectares <small>optional</small></span><span class="input-with-unit compact-unit-input"><input id="save-paddock-size" type="number" inputmode="decimal" min="0" step="any" placeholder="e.g. 320" /><b>ha</b></span></label>
        </div>
        <div class="job-paddock-snapshot" id="save-paddock-snapshot">
          <span><small>Saved total hectares</small><strong id="save-paddock-total">Not set</strong></span>
          <label class="dialog-field"><span>Planned hectares <small>for this tank only</small></span><span class="input-with-unit compact-unit-input"><input id="save-planned-hectares" type="number" inputmode="decimal" min="0" step="any" placeholder="Optional" /><b>ha</b></span></label>
        </div>
        <button class="paddock-details-button" id="edit-selected-paddock" type="button">Edit paddock details</button>
        <p class="planned-area-notice" id="planned-area-notice" hidden><span id="planned-area-notice-text"></span><button id="use-calculated-area" type="button">Use calculated area</button></p>
        <p class="job-paddock-help">Changing the planned hectares here never changes the saved paddock total.</p>
      </fieldset>
      <div class="save-summary"><span><small>Tank total</small><strong id="save-tank-total">—</strong></span><span><small>Spray rate</small><strong id="save-spray-rate">—</strong></span><span><small>Calculated area</small><strong id="save-area">—</strong></span></div>
      <div class="record-meta-grid">
        <label class="dialog-field"><span>Operator <small id="operator-first-hint" hidden>Enter a name or leave blank to skip</small></span><input id="save-operator" maxlength="80" autocomplete="name" /></label>
        <div class="dialog-field"><label for="save-machine">Machine</label><select id="save-machine"></select><button class="manage-sprayers-button" type="button" data-manage-sprayers>Manage sprayers</button></div>
        <label class="dialog-field"><span>Application</span><select id="save-spray-method"><option value="Broadacre">Broadacre</option><option value="Camera">Camera spray</option></select><small id="spray-method-note">Broadacre records treated hectares.</small></label>
      </div>
      <div class="save-products"><h3>Products in this tank</h3><p>Chemical names come from the calculator.</p><div id="save-product-list"></div></div>
      <p class="dialog-error" id="save-error" hidden></p><button class="confirm-save-button" id="confirm-save" type="submit">Save tank</button><button class="dialog-cancel-button" id="cancel-save" type="button">Cancel</button>
    </form></dialog>
    <dialog class="save-dialog" id="run-start-dialog" aria-labelledby="run-start-dialog-title"><form method="dialog" class="save-panel" id="run-start-form">
      <div class="dialog-heading"><div><p class="eyebrow">New multi-paddock tank</p><h2 id="run-start-dialog-title">Start buffer</h2></div><button class="close-dialog" type="button" id="close-run-start-dialog" aria-label="Close">&times;</button></div>
      <p class="review-help">The current calculator mix is used for this buffer. Enter the litres sprayed each time you leave a paddock.</p>
      <div class="save-grid">
        <label class="dialog-field"><span>Spray date</span><input id="run-date" type="date" required /></label>
        <label class="dialog-field"><span>Starting litres</span><span class="input-with-unit compact-unit-input"><input id="run-controller-start" type="number" inputmode="decimal" min="0" step="any" required /><b>L</b></span></label>
      </div>
      <div class="record-meta-grid">
        <label class="dialog-field"><span>Operator <small>optional until sharing</small></span><input id="run-operator" maxlength="80" autocomplete="name" /></label>
        <div class="dialog-field"><label for="run-machine">Machine</label><select id="run-machine"></select><button class="manage-sprayers-button" type="button" data-manage-sprayers>Manage sprayers</button></div>
        <label class="dialog-field"><span>Application</span><select id="run-spray-method"><option value="Broadacre">Broadacre</option><option value="Camera">Camera spray</option></select><small id="run-method-note">Broadacre allocations calculate treated hectares.</small></label>
      </div>
      <fieldset class="job-paddock-picker run-start-paddocks">
        <legend>Paddocks for this buffer</legend>
        <p class="job-paddock-help">Select the paddocks you will spray. You can add more while the buffer is active.</p>
        <div class="job-paddock-controls">
          <label class="dialog-field"><span>Select or add a paddock</span><select id="run-start-library-paddock"></select></label>
          <input id="run-start-planned-hectares" type="hidden" disabled />
          <div class="new-library-paddock-fields" id="run-start-new-paddock-fields" hidden>
            <label class="dialog-field"><span>New paddock name</span><input id="run-start-new-paddock-name" maxlength="60" autocomplete="off" /></label>
            <label class="dialog-field"><span>Saved total hectares <small>optional</small></span><span class="input-with-unit compact-unit-input"><input id="run-start-new-paddock-total" type="number" inputmode="decimal" min="0" step="any" /><b>ha</b></span></label>
          </div>
          <button class="job-paddock-add" id="run-start-add-paddock" type="button">Add to this buffer</button>
        </div>
        <div class="job-paddock-list" id="run-start-selected-paddocks" aria-live="polite"></div>
        <p class="dialog-error" id="run-start-paddock-error" hidden></p>
      </fieldset>
      <div class="save-summary"><span><small>Mix total</small><strong id="run-mix-total">&mdash;</strong></span><span><small>Spray rate</small><strong id="run-spray-rate">&mdash;</strong></span><span><small>Products</small><strong id="run-product-count">0</strong></span></div>
      <p class="dialog-error" id="run-start-error" hidden></p><button class="confirm-save-button" id="confirm-start-run" type="submit">Start buffer</button><button class="dialog-cancel-button" id="cancel-run-start" type="button">Cancel</button>
    </form></dialog>
    <dialog class="save-dialog" id="paddock-details-dialog" aria-labelledby="paddock-details-title"><form method="dialog" class="save-panel" id="paddock-details-form">
      <div class="dialog-heading"><div><p class="eyebrow">Paddock Library</p><h2 id="paddock-details-title">Edit paddock details</h2></div></div>
      <p class="review-help">Update the library name and total hectares for this selection and future jobs. Previously saved tank details stay as recorded.</p>
      <label class="dialog-field"><span>Paddock name</span><input id="paddock-details-name" maxlength="60" autocomplete="off" required /></label>
      <label class="dialog-field"><span>Total hectares <small>optional</small></span><span class="input-with-unit compact-unit-input"><input id="paddock-details-total" type="number" inputmode="decimal" min="0" step="any" /><b>ha</b></span></label>
      <p class="dialog-error" id="paddock-details-error" hidden></p><button class="confirm-save-button" type="submit">Save paddock details</button><button class="dialog-cancel-button" id="cancel-paddock-details" type="button">Cancel</button>
    </form></dialog>
    <dialog class="save-dialog" id="finish-buffer-dialog" aria-labelledby="finish-buffer-title"><form method="dialog" class="save-panel" id="finish-buffer-form">
      <h2 id="finish-buffer-title">Finish Buffer</h2><p id="finish-buffer-summary"></p><p class="dialog-error" id="finish-buffer-error" hidden></p>
      <button class="confirm-save-button" type="submit">Finish Buffer</button><button class="dialog-cancel-button" id="cancel-finish-buffer" type="button">Back</button>
    </form></dialog>
    <dialog class="save-dialog" id="buffer-correction-dialog" aria-labelledby="buffer-correction-title"><form method="dialog" class="save-panel" id="buffer-correction-form">
      <div class="dialog-heading"><div><p class="eyebrow">Buffer allocation</p><h2 id="buffer-correction-title">Correct litres sprayed</h2></div></div>
      <p class="review-help" id="buffer-correction-description"></p>
      <label class="dialog-field"><span>Litres sprayed in this paddock</span><span class="input-with-unit compact-unit-input"><input id="buffer-correction-litres" type="number" inputmode="decimal" min="0.001" step="any" required /><b>L</b></span></label>
      <p class="run-helper" id="buffer-correction-preview" aria-live="polite"></p><p class="dialog-error" id="buffer-correction-error" hidden></p>
      <button class="confirm-save-button" type="submit">Save correction</button><button class="dialog-cancel-button" id="cancel-buffer-correction" type="button">Cancel</button>
    </form></dialog>
    <dialog class="save-dialog" id="share-review-dialog" aria-labelledby="share-review-dialog-title"><form method="dialog" class="save-panel" id="share-review-form">
      <div class="dialog-heading"><div><p class="eyebrow">Review before sharing</p><h2 id="share-review-dialog-title">Complete tank details</h2></div><button class="close-dialog" type="button" id="close-share-review" aria-label="Close">×</button></div>
      <p class="review-help">Complete any missing operator, machine, application method or chemical names before a copy can be exported or shared.</p><div id="share-review-list"></div><p class="dialog-error" id="share-review-error" hidden></p>
      <button class="confirm-save-button" type="submit">Save details and continue</button><button class="dialog-cancel-button" id="cancel-share-review" type="button">Cancel</button>
    </form></dialog>
    <dialog class="save-dialog" id="download-dialog" aria-labelledby="download-dialog-title"><div class="save-panel"><div class="dialog-heading"><div><p class="eyebrow">Copies ready</p><h2 id="download-dialog-title">Save files</h2></div><button class="close-dialog" type="button" id="close-download-dialog" aria-label="Close">×</button></div><p class="review-help" id="download-dialog-message">Your PDF and CSV copies are prepared. Choose Share or Save.</p><div class="download-actions"><button id="share-paddock-pdf" type="button">Share PDF</button><button id="share-paddock-csv" type="button">Share CSV</button><button id="download-pdf" type="button">Save PDF</button><button id="download-csv" type="button">Save CSV</button></div></div></dialog>
    <dialog class="save-dialog preferences-dialog" id="spray-rates-dialog" aria-labelledby="spray-rates-title"><div class="save-panel">
      <div class="dialog-heading"><h2 id="spray-rates-title">Saved spray rates</h2><button class="close-dialog" type="button" data-close-preferences aria-label="Close saved rates">×</button></div>
      <p class="review-help">Save your usual rates in L/ha. You can still enter a different rate in the calculator.</p><div id="spray-rates-list" class="preferences-list"></div>
      <form id="spray-rate-preference-form" class="preference-editor" novalidate><label class="dialog-field"><span id="spray-rate-editor-label">Add rate</span><span class="input-with-unit"><input id="spray-rate-preference-value" type="number" inputmode="decimal" min="0" step="any" required /><b>L/ha</b></span></label><p id="spray-rate-preference-error" class="dialog-error" role="alert" hidden></p><button class="confirm-save-button" id="save-rate-preference" type="submit">Add rate</button><button class="dialog-cancel-button" id="cancel-rate-preference-edit" type="button" hidden>Cancel edit</button></form>
      <button class="dialog-cancel-button" type="button" data-close-preferences>Done</button>
    </div></dialog>
    <dialog class="save-dialog preferences-dialog" id="spray-equipment-dialog" aria-labelledby="spray-equipment-title"><div class="save-panel">
      <div class="dialog-heading"><h2 id="spray-equipment-title">Manage sprayers</h2><button class="close-dialog" type="button" data-close-preferences aria-label="Close sprayers">×</button></div>
      <p class="review-help">Set the methods each sprayer supports. Archived sprayers stay in saved records and are unavailable for new jobs.</p><div id="spray-equipment-list" class="preferences-list"></div>
      <form id="spray-equipment-preference-form" class="preference-editor" novalidate><label class="dialog-field"><span id="spray-equipment-editor-label">Add sprayer</span><input id="spray-equipment-preference-name" maxlength="80" autocomplete="off" required /></label><fieldset class="equipment-methods"><legend>Supported methods</legend><label><input type="checkbox" id="spray-equipment-broadacre" value="Broadacre" checked /> Broadacre</label><label><input type="checkbox" id="spray-equipment-camera" value="Camera" /> Camera spray</label></fieldset><p id="spray-equipment-preference-error" class="dialog-error" role="alert" hidden></p><button class="confirm-save-button" id="save-equipment-preference" type="submit">Add sprayer</button><button class="dialog-cancel-button" id="cancel-equipment-preference-edit" type="button" hidden>Cancel edit</button></form>
      <button class="dialog-cancel-button" type="button" data-close-preferences>Done</button>
    </div></dialog>
    <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
    <template id="product-template"><div class="product-row" data-basis="unset"><div class="product-label"></div><label class="product-name-field"><span>Chemical name</span><input class="product-name" type="text" list="chemical-suggestions" maxlength="80" autocomplete="off" placeholder="Type chemical name" /></label><label class="compact-field"><span class="sr-only product-rate-label"></span><input class="product-rate" type="number" inputmode="decimal" min="0" step="any" placeholder="Rate" /></label><label class="compact-field"><span class="sr-only product-unit-label"></span><select class="product-unit"><option value="">Choose unit</option><optgroup label="Per hectare"><option value="l_ha">L/ha</option><option value="ml_ha">mL/ha</option><option value="g_ha">g/ha</option><option value="kg_ha">kg/ha</option></optgroup><optgroup label="Per 100 L water"><option value="ml_100">mL/100 L</option><option value="kg_100">kg/100 L</option></optgroup></select></label><output class="product-result" aria-live="polite">—</output></div></template>
  </div>
`;

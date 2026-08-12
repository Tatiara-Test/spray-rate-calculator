export const SERVICING_TEMPLATE = `
  <link rel="stylesheet" href="./styles/servicing.css" />
  <div class="servicing-root">
    <main class="servicing-shell">
      <header class="servicing-header">
        <img src="./brand-mark.png" alt="" width="58" height="58" />
        <div>
          <p>Pallathorpe Enterprises</p>
          <h1>4830 Service Record</h1>
          <span>Offline service records on this device</span>
        </div>
      </header>

      <section id="servicing-preparation" class="preparation-card" aria-labelledby="servicing-preparation-title" aria-live="polite">
        <span class="status-chip">Prepared, not active</span>
        <h2 id="servicing-preparation-title">Servicing records are not enabled yet</h2>
        <p id="servicing-preparation-copy">The mobile interface is prepared, but record writing remains off until the compatible servicing core reports that writes are enabled. No service draft has been created or changed.</p>
        <p class="preparation-safety"><strong>Calculator, Paddocks, Buffers and Work Notes are unaffected.</strong> Reopen this section after a compatible app update is installed.</p>
      </section>

      <div id="servicing-content"></div>
    </main>
  </div>
`;

export const SERVICING_READY_TEMPLATE = `
  <nav class="servicing-view-nav" aria-label="4830 servicing views">
    <button type="button" data-servicing-view="overview" aria-current="page">Overview</button>
    <button type="button" data-servicing-view="editor">Current service</button>
    <button type="button" data-servicing-view="history">History</button>
  </nav>

  <section class="servicing-panel" data-servicing-panel="overview" aria-labelledby="servicing-overview-title">
    <div class="servicing-intro">
      <div><p class="eyebrow">Machine 4830</p><h2 id="servicing-overview-title">Service records</h2></div>
      <span id="servicing-ready-badge" class="status-chip ready-chip">Writes enabled</span>
    </div>
    <p class="ordinary-record-note">These are ordinary app records stored on this device. They are not proof that work occurred, an official manufacturer form, a warranty record, trusted identity, or a tamper-proof record.</p>

    <section id="servicing-draft-card" class="service-card" aria-labelledby="servicing-draft-title" hidden>
      <div class="card-heading"><div><p class="eyebrow">Draft in progress</p><h3 id="servicing-draft-title">Current 4830 service</h3></div><span id="servicing-draft-save-state" class="save-state">Saved on this device</span></div>
      <dl class="record-facts"><div><dt>Service date</dt><dd id="draft-card-date">Not entered</dd></div><div><dt>Engine hours</dt><dd id="draft-card-hours">Not entered</dd></div><div><dt>Intervals</dt><dd id="draft-card-intervals">None selected</dd></div></dl>
      <button id="resume-servicing-draft" class="primary-button" type="button">Resume draft</button>
    </section>

    <section id="servicing-empty-card" class="service-card empty-card" aria-labelledby="servicing-empty-title">
      <div><p class="eyebrow">No draft open</p><h3 id="servicing-empty-title">Start the next 4830 service record</h3><p>Select only the intervals being serviced. The app will show every task belonging to those selected intervals; selecting a higher interval does not add lower intervals.</p></div>
      <button id="new-servicing-draft" class="primary-button" type="button">New service record</button>
    </section>

    <section class="history-summary service-card" aria-labelledby="history-summary-title">
      <div><p class="eyebrow">Locked records</p><h3 id="history-summary-title">Service history</h3><p>Finalised revisions are locked in the ordinary app. An amendment creates a later revision and preserves the earlier one.</p></div>
      <div class="history-summary-action"><strong id="history-count">0</strong><span>records</span><button type="button" data-servicing-view="history">Open history</button></div>
    </section>
  </section>

  <section class="servicing-panel" data-servicing-panel="editor" aria-labelledby="servicing-editor-title" hidden>
    <div class="panel-heading"><div><p class="eyebrow">Draft autosave</p><h2 id="servicing-editor-title">Current 4830 service</h2></div><span id="servicing-save-state" class="save-state" role="status" aria-live="polite">Saved on this device</span></div>
    <section id="no-servicing-draft" class="service-card empty-card">
      <h3>No draft is open</h3><p>Start a service record from Overview. No record will be created until you choose that action.</p><button type="button" data-servicing-view="overview">Back to overview</button>
    </section>
    <form id="servicing-draft-form" novalidate hidden>
      <section class="form-card" aria-labelledby="service-details-heading">
        <div class="section-heading"><span>1</span><div><h3 id="service-details-heading">Service details</h3><p>Changes are handed to the servicing core for device-only autosave.</p></div></div>
        <div class="details-grid">
          <label><span>Service date</span><input id="service-date" name="serviceDate" type="date" required /></label>
          <label><span>Engine hours</span><span class="input-with-unit"><input id="engine-hours" name="engineHours" type="number" inputmode="decimal" min="0" step="0.1" required /><b>h</b></span></label>
          <label class="wide-field"><span>Operator</span><input id="service-operator" name="operator" maxlength="100" autocomplete="name" required /></label>
        </div>
      </section>

      <fieldset class="form-card interval-card">
        <legend><span class="step-number">2</span><span><strong>Select service intervals</strong><small>Only checked intervals are used. Higher intervals do not infer lower ones.</small></span></legend>
        <div id="servicing-intervals" class="interval-grid"></div>
      </fieldset>

      <section class="form-card" aria-labelledby="service-tasks-heading">
        <div class="section-heading"><span>3</span><div><h3 id="service-tasks-heading">Service tasks</h3><p id="servicing-task-count">Select one or more intervals to show their tasks.</p></div></div>
        <div id="servicing-task-list" class="task-list"></div>
        <div id="servicing-task-empty" class="task-empty"><strong>No tasks shown</strong><p>Choose an interval above. All tasks returned by the approved servicing definition for those exact intervals will appear here.</p></div>
      </section>

      <section class="form-card" aria-labelledby="overall-notes-heading">
        <div class="section-heading"><span>4</span><div><h3 id="overall-notes-heading">Overall notes</h3><p>Optional notes about this service visit.</p></div></div>
        <label class="wide-field"><span class="sr-only">Overall service notes</span><textarea id="overall-notes" name="overallNotes" rows="4" maxlength="4000" placeholder="Add overall service notes if needed"></textarea></label>
      </section>

      <p id="servicing-form-error" class="form-error" role="alert" hidden></p>
      <div class="sticky-actions"><button id="pause-servicing-draft" class="quiet-button" type="button">Pause and return</button><button class="primary-button" type="submit">Review finalisation</button></div>
    </form>
  </section>

  <section class="servicing-panel" data-servicing-panel="review" aria-labelledby="servicing-review-title" hidden>
    <div class="panel-heading"><div><p class="eyebrow">Final check</p><h2 id="servicing-review-title">Review service record</h2></div></div>
    <section class="review-outcome service-card" aria-live="polite"><span class="status-chip" id="review-outcome-chip">Draft</span><h3 id="review-outcome">Draft - not finalised</h3><p id="review-outcome-copy">Resolve every Not started task before finalising.</p></section>
    <section class="service-card" aria-labelledby="review-blockers-heading"><h3 id="review-blockers-heading">Items needing attention</h3><ul id="review-blockers"></ul><p id="review-no-blockers" hidden>All required service details and task results are resolved.</p></section>
    <section class="ordinary-record-note" aria-label="Record limitation"><strong>Finalising locks this revision in the ordinary app.</strong> It records what was entered; it does not prove that physical work occurred.</section>
    <p id="servicing-review-error" class="form-error" role="alert" hidden></p>
    <div class="sticky-actions"><button id="back-to-servicing-draft" class="quiet-button" type="button">Back to draft</button><button id="finalise-servicing-draft" class="primary-button" type="button" disabled>Finalise record</button></div>
  </section>

  <section class="servicing-panel" data-servicing-panel="history" aria-labelledby="servicing-history-title" hidden>
    <div class="panel-heading"><div><p class="eyebrow">Device-only history</p><h2 id="servicing-history-title">4830 service history</h2><p>Finalised revisions remain locked in this ordinary app.</p></div></div>
    <div id="servicing-history-list" class="history-list"></div>
    <section id="servicing-history-empty" class="service-card empty-card"><h3>No finalised records yet</h3><p>Finalised 4830 service revisions will be listed here.</p></section>
  </section>

  <dialog id="servicing-amend-dialog" aria-labelledby="servicing-amend-title">
    <form id="servicing-amend-form" class="dialog-shell">
      <header class="dialog-header"><div><p class="eyebrow">Create later revision</p><h2 id="servicing-amend-title">Amend service record</h2></div><button id="close-servicing-amend" class="icon-button" type="button" aria-label="Close amendment form">×</button></header>
      <p>The selected finalised revision remains preserved. State why a later revision is needed.</p>
      <label><span>Amendment reason</span><textarea id="servicing-amend-reason" rows="4" maxlength="500" required></textarea></label>
      <p id="servicing-amend-error" class="form-error" role="alert" hidden></p>
      <div class="dialog-actions"><button id="cancel-servicing-amend" class="quiet-button" type="button">Cancel</button><button class="primary-button" type="submit">Create amendment draft</button></div>
    </form>
  </dialog>

  <dialog id="servicing-download-dialog" aria-labelledby="servicing-download-title" aria-describedby="servicing-download-message">
    <div class="dialog-shell">
      <header class="dialog-header"><div><p class="eyebrow">PDF ready</p><h2 id="servicing-download-title">Download service record</h2></div><button id="close-servicing-download-x" class="icon-button" type="button" aria-label="Close download options">×</button></header>
      <p id="servicing-download-message">Native sharing is unavailable. The offline PDF is ready to download.</p>
      <div class="dialog-actions"><button id="download-servicing-pdf" class="primary-button" type="button">Download PDF</button><button id="close-servicing-download" class="quiet-button" type="button">Close</button></div>
    </div>
  </dialog>

  <div id="servicing-toast" class="servicing-toast" role="status" aria-live="polite" hidden></div>
`;

export const WORK_NOTES_TEMPLATE = `
  <link rel="stylesheet" href="./styles/work-notes.css" />
  <div class="work-notes-root">
    <div class="app-shell">
      <header class="brand-header">
        <img class="brand-mark" src="./brand-mark.png" alt="" width="56" height="56" />
        <div class="brand-copy"><p class="farm-name">Pallathorpe</p><h1>Work Notes</h1></div>
        <button id="install-button" class="quiet-button install-button" type="button" hidden>Install</button>
      </header>
      <main>
        <section class="period-card" aria-labelledby="period-label">
          <div class="period-nav">
            <button id="previous-period" class="square-button" type="button" aria-label="Previous fortnight"><span aria-hidden="true">‹</span></button>
            <div class="period-title"><p id="period-kicker">Current fortnight</p><h2 id="period-label">Loading dates…</h2></div>
            <button id="next-period" class="square-button" type="button" aria-label="Next fortnight"><span aria-hidden="true">›</span></button>
          </div>
          <div class="period-actions"><button id="return-current" class="secondary-button" type="button" hidden>Current fortnight</button><button id="open-today" class="primary-button" type="button">Open today’s note</button></div>
        </section>
        <aside id="due-attention" class="attention-card" aria-labelledby="attention-title" hidden>
          <div><p class="eyebrow">Needs attention</p><h2 id="attention-title">Due follow-ups</h2></div><div id="attention-items"></div>
          <button class="attention-action" type="button" data-section-target="followups">View follow-ups</button>
        </aside>
        <nav class="section-tabs" aria-label="Work Notes sections" role="tablist">
          <button id="notes-tab" class="section-tab active" type="button" role="tab" aria-selected="true" aria-controls="notes-section" data-section-target="notes">Notes</button>
          <button id="summary-tab" class="section-tab" type="button" role="tab" aria-selected="false" aria-controls="summary-section" data-section-target="summary">Summary</button>
          <button id="followups-tab" class="section-tab" type="button" role="tab" aria-selected="false" aria-controls="followups-section" data-section-target="followups">Follow-ups <span id="followup-count" class="tab-count" hidden>0</span></button>
        </nav>
        <section id="notes-section" class="app-section" role="tabpanel" aria-labelledby="notes-tab" data-section="notes">
          <div class="section-intro"><div><p class="eyebrow">14-day wages period</p><h2>Daily notes</h2></div><div class="note-legend" aria-label="Note status legend"><span><i class="legend-dot today-dot"></i> Today</span><span><i class="legend-dot saved-dot"></i> Note</span><span><i class="legend-dot missing-dot"></i> Missing</span></div></div>
          <div id="notes-weeks"></div>
        </section>
        <section id="summary-section" class="app-section" role="tabpanel" aria-labelledby="summary-tab" data-section="summary" hidden>
          <div class="section-intro"><div><p class="eyebrow">Ready for wages</p><h2>Fortnight summary</h2></div><button id="export-text" class="secondary-button compact-button" type="button">Export text</button></div>
          <p class="section-help">Copy one day at a time. A green tick stays until that note is edited.</p><div id="summary-list" class="summary-list"></div>
        </section>
        <section id="followups-section" class="app-section" role="tabpanel" aria-labelledby="followups-tab" data-section="followups" hidden>
          <div class="section-intro"><div><p class="eyebrow">Across all fortnights</p><h2>Follow-ups</h2></div><button id="add-followup" class="primary-button compact-button" type="button">Add follow-up</button></div>
          <div id="open-followups"></div>
          <details id="completed-details" class="completed-panel"><summary>Completed history <span id="completed-count" class="summary-count">0</span></summary><div id="completed-followups"></div></details>
          <section class="data-card" aria-labelledby="data-title">
            <div><p class="eyebrow">Device-only records</p><h3 id="data-title">Backup and restore</h3><p>Notes stay in this browser unless you export them. A restore replaces the Work Notes records on this device after confirmation.</p></div>
            <div class="data-actions"><button id="export-backup" class="secondary-button" type="button">Download Work Notes JSON</button><button id="choose-restore" class="quiet-button" type="button">Restore Work Notes JSON</button><input id="restore-file" type="file" accept="application/json,.json" hidden /></div>
          </section>
          <section class="data-card combined-data-card" aria-labelledby="combined-data-title">
            <div><p class="eyebrow">Whole combined app</p><h3 id="combined-data-title">Combined backup</h3><p>Includes paddocks, Work Notes, operator settings, location and saved weather links. It never alters the original legacy storage keys.</p></div>
            <div class="data-actions"><button id="export-combined-backup" class="secondary-button" type="button">Download combined JSON</button></div>
          </section>
        </section>
      </main>
      <footer><p>Private on this device · No tracking, cloud sync, or notifications</p></footer>
    </div>
    <dialog id="note-dialog" class="note-dialog"><div class="dialog-shell">
      <header class="dialog-header"><div><p id="note-dialog-kicker" class="eyebrow">Daily note</p><h2 id="note-dialog-title">Date</h2></div><button id="close-note" class="square-button close-button" type="button" aria-label="Close note">×</button></header>
      <div class="save-line" aria-live="polite"><span id="save-indicator" class="save-indicator">Saved on this device</span></div>
      <label class="note-field" for="note-text"><span>What did you do?</span><textarea id="note-text" rows="12" spellcheck="true" autocomplete="off" placeholder="Tap here, type, or use your phone keyboard’s microphone…"></textarea></label>
      <p class="dictation-hint">Text only. Your phone’s keyboard can turn speech into text.</p>
      <div class="dialog-actions"><button id="restore-previous" class="quiet-button" type="button" disabled>Restore previous</button><button id="followup-from-note" class="secondary-button" type="button">Add follow-up</button><button id="done-note" class="primary-button" type="button">Done</button></div>
    </div></dialog>
    <dialog id="followup-dialog" class="followup-dialog"><form id="followup-form" class="dialog-shell">
      <header class="dialog-header"><div><p class="eyebrow">Keep it on the list</p><h2>Add follow-up</h2></div><button id="cancel-followup-x" class="square-button close-button" type="button" aria-label="Close follow-up form">×</button></header>
      <label class="form-field"><span>Description</span><textarea id="followup-description" rows="4" required spellcheck="true" placeholder="What needs doing?"></textarea></label>
      <div class="form-grid"><label class="form-field"><span>Due date <small>optional</small></span><input id="followup-due" type="date" /></label><label class="form-field"><span>Original note date <small>optional</small></span><input id="followup-source" type="date" /></label></div>
      <div class="dialog-actions"><button id="cancel-followup" class="quiet-button" type="button">Cancel</button><button class="primary-button" type="submit">Save follow-up</button></div>
    </form></dialog>
    <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
  </div>
`;


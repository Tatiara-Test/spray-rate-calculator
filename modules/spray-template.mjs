export const SPRAY_TEMPLATE = `
  <link rel="stylesheet" href="./styles/spray.css" />
  <div class="spray-root">
    <main class="app-shell">
      <header class="brand-header"><img class="brand-mark" src="./brand-mark.png" alt="" width="64" height="64" /><div><p class="farm-name">Pallathorpe Enterprises</p><h1>Spray Rate Calculator</h1></div></header>
      <nav class="view-switch" aria-label="Spray Operations sections" role="tablist"><button id="spray-calculator-tab" class="selected" type="button" data-view-button="calculator" role="tab" aria-selected="true" aria-controls="calculator-view">Calculator</button><button id="spray-paddocks-tab" type="button" data-view-button="paddocks" role="tab" aria-selected="false" aria-controls="paddocks-view">Paddocks</button></nav>
      <div id="calculator-view" data-view-panel="calculator" role="tabpanel" aria-labelledby="spray-calculator-tab">
        <section class="calculator-card" aria-labelledby="mix-heading">
          <div class="section-heading"><span class="step-number">1</span><div><h2 id="mix-heading">Tank mixture</h2><p>Enter the tank total, including all products.</p></div></div>
          <div class="tank-grid">
            <label class="field"><span>Tank total</span><span class="input-with-unit"><input id="mix-volume" type="number" inputmode="decimal" min="0" max="5000" step="any" placeholder="e.g. 2000" /><b>litres</b></span><small class="error" id="volume-error" hidden>Maximum tank total is 5,000 litres.</small></label>
            <fieldset class="field rate-field"><legend>Spray rate</legend><div class="quick-rates" aria-label="Common spray rates"><button type="button" data-rate="60">60</button><button type="button" data-rate="80">80</button><button type="button" data-rate="90">90</button><button type="button" data-rate="100">100</button></div><span class="input-with-unit custom-rate"><input id="spray-rate" type="number" inputmode="decimal" min="0" step="any" placeholder="Other" aria-label="Spray rate in litres per hectare" /><b>L/ha</b></span></fieldset>
          </div>
          <div class="coverage" id="coverage" aria-live="polite"><span>Area covered</span><strong id="coverage-result">—</strong></div>
        </section>
        <section class="calculator-card products-card" aria-labelledby="products-heading">
          <div class="section-heading"><span class="step-number">2</span><div><h2 id="products-heading">Product rates</h2><p>Copy each rate and unit exactly from the spray sheet.</p></div></div>
          <div class="basis-key" aria-label="Rate type reminder"><span><i class="dot hectare-dot"></i> Per hectare</span><span><i class="dot water-dot"></i> Per 100 L water</span></div>
          <div class="product-list" id="product-list"></div><datalist id="chemical-suggestions"></datalist><p class="error product-name-error" id="product-name-error" role="alert" hidden></p><button class="add-product" id="add-product" type="button">+ Add product 5</button>
        </section>
        <div class="edit-banner" id="edit-banner" hidden><div><strong id="edit-title">Editing tank record</strong><span>Update the calculation, then save the record.</span></div><button id="cancel-edit" type="button">Cancel edit</button></div>
        <button class="save-record-button" id="save-record-button" type="button">Save tank record</button><button class="clear-button" id="clear-button" type="button">Clear calculation</button>
      </div>
      <section id="paddocks-view" data-view-panel="paddocks" role="tabpanel" hidden aria-labelledby="spray-paddocks-tab">
        <div class="paddocks-intro"><div><h2 id="paddocks-heading">Paddock records</h2><p>Saved on this phone only</p><p class="operator-profile">Operator: <strong id="operator-profile-name">Not set</strong> <button id="change-operator" type="button">Change</button></p></div><span id="paddock-count">0 of 10 paddocks</span></div>
        <div class="paddock-list" id="paddock-list"></div>
        <div class="empty-state" id="paddock-empty"><strong>No paddocks saved yet</strong><p>Use Save tank record after completing a calculation.</p><button type="button" data-switch-to-calculator>Return to calculator</button></div>
      </section>
    </main>
    <dialog class="save-dialog" id="save-dialog"><form method="dialog" class="save-panel" id="save-form">
      <div class="dialog-heading"><div><p class="eyebrow">Paddock record</p><h2 id="save-dialog-title">Save tank record</h2></div><button class="close-dialog" type="button" id="close-save-dialog" aria-label="Close">×</button></div>
      <div class="save-grid"><label class="dialog-field"><span>Paddock name</span><input id="save-paddock-name" list="paddock-suggestions" maxlength="60" autocomplete="off" required /></label><label class="dialog-field"><span>Spray date</span><input id="save-spray-date" type="date" required /></label></div>
      <datalist id="paddock-suggestions"></datalist>
      <div class="save-summary"><span><small>Tank total</small><strong id="save-tank-total">—</strong></span><span><small>Spray rate</small><strong id="save-spray-rate">—</strong></span><span><small>Area</small><strong id="save-area">—</strong></span></div>
      <div class="record-meta-grid">
        <label class="dialog-field"><span>Operator <small id="operator-first-hint" hidden>Enter a name or leave blank to skip</small></span><input id="save-operator" maxlength="80" autocomplete="name" /></label>
        <label class="dialog-field"><span>Machine</span><select id="save-machine"><option value="412R">412R</option><option value="Hayes boom">Hayes boom</option><option value="4830">4830</option><option value="4023">4023</option></select></label>
      </div>
      <div class="save-products"><h3>Products in this tank</h3><p>Chemical names come from the calculator.</p><div id="save-product-list"></div></div>
      <p class="dialog-error" id="save-error" hidden></p><button class="confirm-save-button" id="confirm-save" type="submit">Save tank</button><button class="dialog-cancel-button" id="cancel-save" type="button">Cancel</button>
    </form></dialog>
    <dialog class="save-dialog" id="share-review-dialog"><form method="dialog" class="save-panel" id="share-review-form">
      <div class="dialog-heading"><div><p class="eyebrow">Review before sharing</p><h2>Complete tank details</h2></div><button class="close-dialog" type="button" id="close-share-review" aria-label="Close">×</button></div>
      <p class="review-help">Complete any missing operator, machine or chemical names before a copy can be exported or shared.</p><div id="share-review-list"></div><p class="dialog-error" id="share-review-error" hidden></p>
      <button class="confirm-save-button" type="submit">Save details and continue</button><button class="dialog-cancel-button" id="cancel-share-review" type="button">Cancel</button>
    </form></dialog>
    <dialog class="save-dialog" id="download-dialog"><div class="save-panel"><div class="dialog-heading"><div><p class="eyebrow">Copies ready</p><h2>Save files</h2></div><button class="close-dialog" type="button" id="close-download-dialog" aria-label="Close">×</button></div><p class="review-help" id="download-dialog-message">Your phone cannot share both files together. Download each copy, then choose where to save or send it.</p><div class="download-actions"><button id="download-pdf" type="button">Download PDF</button><button id="download-csv" type="button">Download CSV</button></div></div></dialog>
    <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
    <template id="product-template"><div class="product-row" data-basis="unset"><div class="product-label"></div><label class="product-name-field"><span>Chemical name</span><input class="product-name" type="text" list="chemical-suggestions" maxlength="80" autocomplete="off" placeholder="Type chemical name" /></label><label class="compact-field"><span class="sr-only product-rate-label"></span><input class="product-rate" type="number" inputmode="decimal" min="0" step="any" placeholder="Rate" /></label><label class="compact-field"><span class="sr-only product-unit-label"></span><select class="product-unit"><option value="">Choose unit</option><optgroup label="Per hectare"><option value="l_ha">L/ha</option><option value="ml_ha">mL/ha</option><option value="g_ha">g/ha</option><option value="kg_ha">kg/ha</option></optgroup><optgroup label="Per 100 L water"><option value="ml_100">mL/100 L</option><option value="kg_100">kg/100 L</option></optgroup></select></label><output class="product-result" aria-live="polite">—</output></div></template>
  </div>
`;

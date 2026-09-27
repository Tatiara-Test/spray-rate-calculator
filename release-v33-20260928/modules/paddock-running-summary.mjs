import { calculatePaddockBalance } from "./paddock-balance.mjs";

const number = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 2 });
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

function amountText(product) {
  const amount = product.recordedAmountBase;
  if (amount === null || !Number.isFinite(amount) || !["ml", "g"].includes(product.baseUnit)) return "Unavailable";
  const large = amount >= 1000;
  const unit = product.baseUnit === "ml" ? (large ? "L" : "mL") : (large ? "kg" : "g");
  return `${number.format(large ? amount / 1000 : amount)} ${unit}`;
}

/** Records must already contain this paddock's tanks and materialized Buffer allocations. */
export function renderPaddockRunningSummary(paddock, records) {
  const balance = calculatePaddockBalance({ sizeHectares: paddock?.sizeHectares, records });
  const partial = balance.includedRecordCount < balance.relevantRecordCount;
  const unavailable = partial && balance.includedRecordCount === 0;
  const suffix = partial && !unavailable ? " (partial)" : "";
  const coverage = balance.activeSprayCoveragePercent === null
    ? "Unavailable"
    : `${number.format(balance.activeSprayCoveragePercent)}%${suffix}`;
  const litres = unavailable ? "Unavailable" : `${number.format(balance.broadacreLitres + balance.cameraLitres)} L${suffix}`;
  const warnings = [
    balance.sizeHectares === null ? "Save a paddock size to calculate its percentage." : "",
    partial ? (unavailable ? "Totals unavailable: saved records need review." : "Partial totals: some saved records could not be included.") : "",
    balance.recordIssues.some((issue) => issue.severity === "disagreement") ? "Saved record details disagree; review the detailed summary." : "",
  ].filter(Boolean);
  const products = balance.productSummaries.map((product) => {
    const form = product.incompatibleForm ? (product.baseUnit === "g" ? " · mass" : " · liquid") : "";
    const status = product.status === "partial" ? " (partial)" : "";
    return `<li><span>${escapeHtml(product.name + form)}</span><strong>${escapeHtml(amountText(product) + status)}</strong></li>`;
  }).join("");
  return `<section class="paddock-running-summary" aria-label="Paddock running totals">
    <div class="running-summary-metrics">
      <span><small>Calculated paddock %</small><strong>${escapeHtml(coverage)}</strong></span>
      <span><small>Spray litres total</small><strong>${escapeHtml(litres)}</strong></span>
    </div>
    <p class="running-summary-label">Calculated product totals</p>
    ${products ? `<ul class="running-summary-products">${products}</ul>` : "<p>No chemical products recorded.</p>"}
    ${warnings.map((warning) => `<p class="running-summary-warning">${escapeHtml(warning)}</p>`).join("")}
    <p class="coverage-caveat">Calculated from recorded litres and L/ha, not GPS-measured ground. Overlaps may exceed 100%. Product amounts are calculated mix equivalents.</p>
  </section>`;
}

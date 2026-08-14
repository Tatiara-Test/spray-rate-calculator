import { calculatePaddockBalance } from "./paddock-balance.mjs";
import { MACHINES, SPRAY_METHODS } from "./storage.mjs";
import { missingProductSlots, productDisplayName } from "./product-records.mjs";
import { loadPdfLib } from "./pdf-lib-loader.mjs";

export const UNIT_LABELS = Object.freeze({
  l_ha: "L/ha",
  ml_ha: "mL/ha",
  g_ha: "g/ha",
  kg_ha: "kg/ha",
  ml_100: "mL/100 L",
  kg_100: "kg/100 L",
});

export const ACTIVE_SPRAY_CAVEAT = "Calculated active-spray equivalent uses valid saved litres divided by the saved calibrated spray rate. It is not GPS-measured unique ground; camera passes and overlaps may affect actual coverage.";
export const PRODUCT_CALCULATION_CAVEAT = "Product chemical-equivalent hectares and signed variances are calculated from saved product amounts and rates, not measured chemical discharge.";

const PAGE_SIZE = Object.freeze([595.28, 841.89]);
const PAGE_MARGIN = 34;
const PAGE_BOTTOM = 52;
const CONTENT_WIDTH = PAGE_SIZE[0] - PAGE_MARGIN * 2;
const PRODUCT_SUMMARY_CSV_HEADERS = Object.freeze([
  "Chemical",
  "Material form",
  "Calculated recorded amount",
  "Amount unit",
  "Calculated chemical-equivalent (ha)",
  "Calculated chemical-equivalent coverage of saved paddock (%)",
  "Signed difference vs calculated active-spray equivalent (ha equivalent)",
  "Signed amount difference vs calculated active-spray equivalent",
  "Difference amount unit",
  "Signed difference vs one saved paddock (ha equivalent)",
  "Signed amount difference vs one saved paddock",
  "Full-paddock difference amount unit",
  "Availability / disagreement",
]);

const exportNumber = new Intl.NumberFormat("en-AU", {
  maximumFractionDigits: 6,
  useGrouping: false,
});

const displayNumber = new Intl.NumberFormat("en-AU", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

const finiteNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function practicalAmount(amountBase, baseUnit) {
  const amount = finiteNumber(amountBase);
  if (amount === null || !["ml", "g"].includes(baseUnit)) return null;
  if (baseUnit === "ml") {
    return Math.abs(amount) >= 1000
      ? { value: amount / 1000, unit: "L", longUnit: "litres" }
      : { value: amount, unit: "mL", longUnit: "millilitres" };
  }
  return Math.abs(amount) >= 1000
    ? { value: amount / 1000, unit: "kg", longUnit: "kilograms" }
    : { value: amount, unit: "g", longUnit: "grams" };
}

function practicalText(amountBase, baseUnit, { signed = false } = {}) {
  const amount = practicalAmount(amountBase, baseUnit);
  if (!amount) return "Unavailable";
  const prefix = signed && amount.value > 0 ? "+" : "";
  return `${prefix}${displayNumber.format(amount.value)} ${amount.unit}`;
}

function exportPractical(amountBase, baseUnit, { signed = false } = {}) {
  const amount = practicalAmount(amountBase, baseUnit);
  if (!amount) return { value: "", unit: "" };
  const prefix = signed && amount.value > 0 ? "+" : "";
  return { value: `${prefix}${exportNumber.format(amount.value)}`, unit: amount.unit };
}

function exportNumberOrBlank(value) {
  const number = finiteNumber(value);
  return number === null ? "" : exportNumber.format(number);
}

function numberText(value, unit = "") {
  const number = finiteNumber(value);
  const suffix = unit === "%" ? "%" : unit ? ` ${unit}` : "";
  return number === null ? "Unavailable" : `${displayNumber.format(number)}${suffix}`;
}

function signedNumberText(value, unit = "") {
  const number = finiteNumber(value);
  if (number === null) return "Unavailable";
  const prefix = number > 0 ? "+" : "";
  const suffix = unit === "%" ? "%" : unit ? ` ${unit}` : "";
  return `${prefix}${displayNumber.format(number)}${suffix}`;
}

function uniqueMessages(entries) {
  return [...new Set((entries || []).map((entry) => String(entry?.message || "").trim()).filter(Boolean))];
}

function stateLabel(state) {
  return ({
    matched: "Matched",
    over: "Above one saved paddock",
    remaining: "Below one saved paddock",
    partial: "Partial - some records were unavailable",
    disagreement: "Available with saved-record disagreement",
    unavailable: "Unavailable",
    "missing-size": "Saved paddock hectares unavailable",
    "unknown-method": "Application method needs review",
    complete: "Complete",
  })[state] || String(state || "Unavailable");
}

export function missingShareMetadata(paddock) {
  const issues = [];
  const seenRunIds = new Set();
  for (const tank of paddock?.tanks || []) {
    if (tank.recordType === "run-allocation" && seenRunIds.has(tank.runId)) continue;
    if (tank.recordType === "run-allocation") seenRunIds.add(tank.runId);
    const productNamesMissing = missingProductSlots(tank);
    const sprayMethodMissing = !SPRAY_METHODS.includes(tank.sprayMethod)
      || (tank.sprayMethod === "Camera" && !["412R", "Hayes boom"].includes(tank.machine));
    if (!String(tank.operator || "").trim() || !MACHINES.includes(tank.machine) || sprayMethodMissing || productNamesMissing.length) {
      issues.push({
        tankId: tank.id,
        recordType: tank.recordType || "tank",
        runId: tank.runId || null,
        tankNumber: tank.tankNumber,
        runNumber: tank.runNumber,
        allocationNumber: tank.allocationNumber,
        date: tank.date,
        operatorMissing: !String(tank.operator || "").trim(),
        machineMissing: !MACHINES.includes(tank.machine),
        sprayMethodMissing,
        productNamesMissing,
      });
    }
  }
  return issues;
}

export function exportDescriptor(paddock, generatedAt = new Date().toISOString()) {
  const revision = Math.max(1, Number(paddock.contentRevision) || 1);
  const previous = Number.isInteger(paddock.lastGeneratedRevision)
    ? paddock.lastGeneratedRevision
    : null;
  const label = previous === null
    ? "Original"
    : revision > previous
      ? "Amended"
      : paddock.lastGeneratedLabel || "Original";
  return { label, revision, generatedAt };
}

function sortedTanks(paddock) {
  return [...(paddock.tanks || [])].sort((left, right) => {
    const dateOrder = String(left.date).localeCompare(String(right.date));
    return dateOrder || String(left.savedAt).localeCompare(String(right.savedAt));
  });
}

function recordTotals(paddock, balance) {
  return {
    litres: balance.includedRecordCount
      ? balance.broadacreLitres + balance.cameraLitres
      : balance.relevantRecordCount
        ? null
        : 0,
    records: (paddock.tanks || []).length,
    includedRecords: balance.includedRecordCount,
  };
}

function balanceFor(paddock) {
  return calculatePaddockBalance({
    sizeHectares: paddock?.sizeHectares,
    records: paddock?.tanks,
  });
}

function productAvailability(summary) {
  const messages = uniqueMessages(summary.issues);
  if (summary.rateStatus === "varied") messages.unshift("Saved rates differ, so the one-paddock amount comparison is unavailable.");
  if (summary.incompatibleForm) messages.unshift("The same chemical name has incompatible liquid and mass forms; those forms remain separate.");
  return messages.length ? messages.join(" ") : stateLabel(summary.status);
}

function activeSummaryText(balance) {
  const equivalent = numberText(balance.activeSprayEquivalentHectares, "ha");
  const coverage = numberText(balance.activeSprayCoveragePercent, "%");
  const variance = signedNumberText(balance.activeSprayVarianceHectares, "ha");
  return `${equivalent} | ${coverage} of saved paddock | ${variance} against one saved paddock | ${stateLabel(balance.activeSprayState)}`;
}

function broadacreSummaryText(balance) {
  const hectares = numberText(balance.reportedBroadacreHectares, "ha");
  const coverage = numberText(balance.reportedBroadacreCoveragePercent, "%");
  const variance = signedNumberText(balance.broadacreVarianceHectares, "ha");
  return `${hectares} reported | ${coverage} of saved paddock | ${variance} against one saved paddock | ${stateLabel(balance.state)}`;
}

function productSummaryText(summary) {
  const chemicalEquivalent = numberText(summary.chemicalEquivalentHectares, "ha");
  const coverage = numberText(summary.chemicalEquivalentCoveragePercent, "%");
  const activeAmount = practicalText(summary.varianceAmountBase, summary.baseUnit, { signed: true });
  const activeEquivalent = signedNumberText(summary.varianceEquivalentHectares, "ha equivalent");
  const fullAmount = practicalText(summary.fullPaddockVarianceAmountBase, summary.baseUnit, { signed: true });
  const fullEquivalent = signedNumberText(summary.fullPaddockVarianceEquivalentHectares, "ha equivalent");
  return `${summary.name} | recorded ${practicalText(summary.recordedAmountBase, summary.baseUnit)} | calculated chemical-equivalent ${chemicalEquivalent} (${coverage}) | ${activeAmount} (${activeEquivalent}) against calculated active-spray equivalent | ${fullAmount} (${fullEquivalent}) against one saved paddock | ${productAvailability(summary)}`;
}

export function buildPaddockCsv(paddock, descriptor) {
  const balance = balanceFor(paddock);
  const totals = recordTotals(paddock, balance);
  const activeIssues = uniqueMessages(balance.recordIssues);
  const rows = [
    ["Pallathorpe Enterprises spray record"],
    ["Paddock", paddock.name],
    ["Saved paddock total (ha)", balance.sizeHectares === null ? "" : exportNumber.format(balance.sizeHectares)],
    ["Record status", descriptor.label],
    ["Content revision", descriptor.revision],
    ["Generated", descriptor.generatedAt],
    ["Calculated valid active-spray liquid (L)", exportNumberOrBlank(totals.litres)],
    ["Saved records", totals.records],
    ["Records included in active-spray calculation", totals.includedRecords],
    ["Paddock note", paddock.note || ""],
    [],
    ["Coverage and calculation summary"],
    ["Reported Broadacre treated area (ha)", exportNumberOrBlank(balance.reportedBroadacreHectares)],
    ["Reported Broadacre coverage of saved paddock (%)", exportNumberOrBlank(balance.reportedBroadacreCoveragePercent)],
    ["Reported Broadacre difference against one saved paddock (ha)", exportNumberOrBlank(balance.broadacreVarianceHectares)],
    ["Reported Broadacre status", stateLabel(balance.state)],
    ["Calculated Broadacre active-spray equivalent (ha)", exportNumberOrBlank(balance.broadacreActiveSprayEquivalentHectares)],
    ["Calculated Camera active-spray equivalent (ha)", exportNumberOrBlank(balance.cameraActiveSprayEquivalentHectares)],
    ["Calculated total active-spray equivalent (ha)", exportNumberOrBlank(balance.activeSprayEquivalentHectares)],
    ["Calculated active-spray coverage of saved paddock (%)", exportNumberOrBlank(balance.activeSprayCoveragePercent)],
    ["Calculated active-spray difference against one saved paddock (ha)", exportNumberOrBlank(balance.activeSprayVarianceHectares)],
    ["Calculated active-spray status", stateLabel(balance.activeSprayState)],
    ["Calculation issues", activeIssues.join(" ")],
    ["Calculation basis", ACTIVE_SPRAY_CAVEAT],
    ["Product calculation basis", PRODUCT_CALCULATION_CAVEAT],
    [],
    ["Product calculation summary"],
    [...PRODUCT_SUMMARY_CSV_HEADERS],
  ];

  if (!balance.productSummaries.length) rows.push(["No products recorded"]);
  for (const product of balance.productSummaries) {
    const recorded = exportPractical(product.recordedAmountBase, product.baseUnit);
    const activeVariance = exportPractical(product.varianceAmountBase, product.baseUnit, { signed: true });
    const fullVariance = exportPractical(product.fullPaddockVarianceAmountBase, product.baseUnit, { signed: true });
    rows.push([
      product.name,
      product.baseUnit === "ml" ? "Liquid" : product.baseUnit === "g" ? "Mass" : "Unavailable",
      recorded.value,
      recorded.unit,
      product.chemicalEquivalentHectares === null ? "" : exportNumber.format(product.chemicalEquivalentHectares),
      product.chemicalEquivalentCoveragePercent === null ? "" : exportNumber.format(product.chemicalEquivalentCoveragePercent),
      product.varianceEquivalentHectares === null ? "" : exportNumber.format(product.varianceEquivalentHectares),
      activeVariance.value,
      activeVariance.unit,
      product.fullPaddockVarianceEquivalentHectares === null ? "" : exportNumber.format(product.fullPaddockVarianceEquivalentHectares),
      fullVariance.value,
      fullVariance.unit,
      productAvailability(product),
    ]);
  }

  rows.push(
    [],
    ["Saved tank and Buffer records"],
    [
      "Spray date",
      "Saved time",
      "Tank",
      "Record type",
      "Buffer",
      "Allocation",
      "Buffer status",
      "Operator",
      "Machine",
      "Application",
      "Controller before (L)",
      "Controller after (L)",
      "Tank total (L)",
      "Spray rate (L/ha)",
      "Reported area (ha)",
      "Chemical",
      "Rate",
      "Rate unit",
      "Calculated amount",
      "Amount unit",
    ],
  );

  for (const tank of sortedTanks(paddock)) {
    const products = tank.products?.length ? tank.products : [null];
    for (const product of products) {
      const practical = product ? practicalAmount(product.amountBase, product.baseUnit) : null;
      rows.push([
        tank.date,
        tank.savedAt,
        tank.recordType === "run-allocation" ? "" : `Tank ${tank.tankNumber}`,
        tank.recordType === "run-allocation" ? "Buffer allocation" : "Tank record",
        tank.runNumber || "",
        tank.allocationNumber || "",
        tank.runStatus || "",
        tank.operator || "",
        tank.machine || "",
        tank.sprayMethod || "",
        tank.controllerBeforeLitres ?? "",
        tank.controllerAfterLitres ?? "",
        exportNumber.format(tank.tankTotal),
        exportNumber.format(tank.sprayRate),
        exportNumber.format(tank.hectares),
        product ? productDisplayName(product) : "",
        product ? exportNumber.format(product.rate) : "",
        product ? UNIT_LABELS[product.unit] || product.unit : "",
        practical ? exportNumber.format(practical.value) : "",
        practical?.unit || "",
      ]);
    }
  }

  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

function slug(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLocaleLowerCase("en-AU")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "record";
}

export function buildExportFilenames(paddock, descriptor) {
  const tanks = sortedTanks(paddock);
  const dates = tanks.map((tank) => tank.date).filter(Boolean);
  const datePart = dates.length
    ? dates[0] === dates.at(-1)
      ? dates[0]
      : `${dates[0]}-to-${dates.at(-1)}`
    : descriptor.generatedAt.slice(0, 10);
  const operators = [...new Set(tanks.map((tank) => tank.operator).filter(Boolean))];
  const operatorPart = operators.length === 1 ? slug(operators[0]) : "multiple-operators";
  const base = `${slug(paddock.name)}_${datePart}_${operatorPart}_rev-${descriptor.revision}`;
  return { csv: `${base}.csv`, pdf: `${base}.pdf` };
}

function safePdfText(value) {
  return String(value ?? "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u2022/g, "-")
    .replace(/[^\x20-\x7E\n]/g, "?");
}

function recordLabel(tank) {
  return tank.recordType === "run-allocation"
    ? `Buffer ${tank.runNumber || "?"}, allocation ${tank.allocationNumber || "?"} (${tank.runStatus || "status not recorded"})`
    : `Tank ${tank.tankNumber || "?"}`;
}

function recordDetailLines(tank) {
  const details = [
    `${tank.date || "Date not recorded"} | Saved ${tank.savedAt || "time not recorded"} | ${tank.operator || "Operator not set"} | ${tank.machine || "Machine not set"} | ${tank.sprayMethod || "Application needs review"}`,
    `Liquid ${numberText(tank.tankTotal, "L")} | Spray rate ${numberText(tank.sprayRate, "L/ha")} | Reported area ${tank.sprayMethod === "Camera" ? "not used for unique-ground coverage" : numberText(tank.hectares, "ha")}`,
  ];
  if (tank.recordType === "run-allocation") {
    details.push(`Controller ${numberText(tank.controllerBeforeLitres, "L")} to ${numberText(tank.controllerAfterLitres, "L")}`);
  }
  return details;
}

export function buildPdfContentLines(paddock, descriptor) {
  const balance = balanceFor(paddock);
  const totals = recordTotals(paddock, balance);
  const lines = [
    { kind: "brand", text: "Pallathorpe Enterprises" },
    { kind: "title", text: "Spray Record" },
    { kind: "meta", text: `Paddock: ${paddock.name}` },
    { kind: "meta", text: `Saved paddock total: ${balance.sizeHectares === null ? "Not recorded" : `${displayNumber.format(balance.sizeHectares)} ha`}` },
    { kind: "meta", text: `${descriptor.label} | Revision ${descriptor.revision}` },
    { kind: "meta", text: `Generated: ${descriptor.generatedAt}` },
    { kind: "meta", text: `Saved records: ${totals.records} | Included in active-spray calculation: ${totals.includedRecords} | Calculated valid active-spray liquid: ${numberText(totals.litres, "L")}` },
    { kind: "note", text: `Paddock note: ${paddock.note || "None"}` },
    { kind: "section", text: "Coverage and calculation summary" },
    { kind: "coverage", text: `Reported Broadacre area: ${broadacreSummaryText(balance)}` },
    { kind: "coverage", text: `Calculated active-spray equivalent: ${activeSummaryText(balance)}` },
    { kind: "caveat", text: ACTIVE_SPRAY_CAVEAT },
    { kind: "caveat", text: PRODUCT_CALCULATION_CAVEAT },
  ];
  for (const message of uniqueMessages(balance.recordIssues)) lines.push({ kind: "issue", text: `Saved-record check: ${message}` });
  lines.push({ kind: "section", text: "Product chemical-equivalent summary" });
  if (!balance.productSummaries.length) lines.push({ kind: "product-summary", text: "No products recorded" });
  for (const product of balance.productSummaries) lines.push({ kind: "product-summary", text: productSummaryText(product) });
  lines.push({ kind: "section", text: "Tank and Buffer records" });
  for (const tank of sortedTanks(paddock)) {
    lines.push({ kind: "record", text: recordLabel(tank) });
    for (const detail of recordDetailLines(tank)) lines.push({ kind: "detail", text: detail });
    if (!tank.products?.length) lines.push({ kind: "product", text: "No products recorded" });
    else for (const product of tank.products) {
      lines.push({
        kind: "product",
        text: `${productDisplayName(product)} | ${numberText(product.rate, UNIT_LABELS[product.unit] || product.unit)} | calculated amount ${practicalText(product.amountBase, product.baseUnit)}`,
      });
    }
  }
  return lines.map((line) => ({ ...line, text: safePdfText(line.text) }));
}

function splitWord(word, font, size, maxWidth) {
  const chunks = [];
  let current = "";
  for (const character of word) {
    const candidate = `${current}${character}`;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      chunks.push(current);
      current = character;
    } else current = candidate;
  }
  if (current) chunks.push(current);
  return chunks;
}

function wrapText(content, font, size, maxWidth) {
  const wrapped = [];
  for (const paragraph of safePdfText(content).split("\n")) {
    if (!paragraph) {
      wrapped.push("");
      continue;
    }
    let current = "";
    for (const sourceWord of paragraph.split(/\s+/)) {
      const words = font.widthOfTextAtSize(sourceWord, size) > maxWidth
        ? splitWord(sourceWord, font, size, maxWidth)
        : [sourceWord];
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (!current || font.widthOfTextAtSize(candidate, size) <= maxWidth) current = candidate;
        else {
          wrapped.push(current);
          current = word;
        }
      }
    }
    if (current) wrapped.push(current);
  }
  return wrapped;
}

async function brandMarkBytes(injectedBytes) {
  if (injectedBytes) return injectedBytes;
  if (typeof fetch !== "function") return null;
  try {
    const response = await fetch(new URL("../brand-mark.png", import.meta.url));
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

export async function buildPaddockPdf(paddock, descriptor, pdfLib = null, options = {}) {
  const resolvedPdfLib = pdfLib || await loadPdfLib();
  if (!resolvedPdfLib?.PDFDocument || !resolvedPdfLib?.StandardFonts || !resolvedPdfLib?.rgb) {
    throw new Error("The offline PDF generator is unavailable.");
  }
  const { PDFDocument, StandardFonts, rgb } = resolvedPdfLib;
  const document = await PDFDocument.create();
  document.setTitle(`${paddock.name} spray record`);
  document.setAuthor("Pallathorpe Enterprises");
  document.setSubject(`${descriptor.label} revision ${descriptor.revision} | calculated spray coverage and chemical-equivalent summary`);
  document.setKeywords(["Pallathorpe Enterprises", "spray record", "calculated active-spray equivalent"]);
  const generatedDate = new Date(descriptor.generatedAt);
  if (!Number.isNaN(generatedDate.getTime())) {
    document.setCreationDate(generatedDate);
    document.setModificationDate(generatedDate);
  }

  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let brandImage = null;
  const resolvedBrandBytes = await brandMarkBytes(options.brandMarkBytes);
  if (resolvedBrandBytes) {
    try {
      brandImage = await document.embedPng(resolvedBrandBytes);
    } catch {
      brandImage = null;
    }
  }

  const green = rgb(0.08, 0.31, 0.17);
  const greenMid = rgb(0.14, 0.42, 0.22);
  const greenLight = rgb(0.91, 0.95, 0.90);
  const greenPale = rgb(0.965, 0.98, 0.96);
  const yellowPale = rgb(1, 0.976, 0.86);
  const ink = rgb(0.08, 0.11, 0.09);
  const muted = rgb(0.34, 0.38, 0.35);
  const rule = rgb(0.73, 0.77, 0.73);
  const white = rgb(1, 1, 1);
  const balance = balanceFor(paddock);
  const totals = recordTotals(paddock, balance);
  let page;
  let y;

  const drawRight = (text, x, baseline, size, font = regular, color = ink) => {
    const content = safePdfText(text);
    page.drawText(content, { x: x - font.widthOfTextAtSize(content, size), y: baseline, size, font, color });
  };

  const drawHeader = (first) => {
    if (first) {
      page.drawRectangle({ x: PAGE_MARGIN, y: 754, width: CONTENT_WIDTH, height: 60, color: greenPale, borderColor: greenMid, borderWidth: 0.9 });
      if (brandImage) {
        const scale = brandImage.scaleToFit(46, 46);
        page.drawImage(brandImage, { x: PAGE_MARGIN + 9, y: 761, width: scale.width, height: scale.height });
      }
      page.drawText("Pallathorpe Enterprises", { x: PAGE_MARGIN + 66, y: 796, size: 10, font: bold, color: greenMid });
      page.drawText("Spray Record", { x: PAGE_MARGIN + 66, y: 772, size: 20, font: bold, color: ink });
      drawRight(`${descriptor.label} | Revision ${descriptor.revision}`, PAGE_SIZE[0] - PAGE_MARGIN - 10, 793, 8.5, bold, green);
      drawRight(paddock.name, PAGE_SIZE[0] - PAGE_MARGIN - 10, 773, 10, bold, ink);
      y = 741;
    } else {
      page.drawText("Pallathorpe Enterprises", { x: PAGE_MARGIN, y: 814, size: 8.5, font: bold, color: greenMid });
      page.drawText("Spray Record", { x: PAGE_MARGIN, y: 795, size: 14, font: bold, color: ink });
      drawRight(`${paddock.name} | Revision ${descriptor.revision}`, PAGE_SIZE[0] - PAGE_MARGIN, 797, 8, regular, muted);
      page.drawLine({ start: { x: PAGE_MARGIN, y: 784 }, end: { x: PAGE_SIZE[0] - PAGE_MARGIN, y: 784 }, thickness: 1.1, color: green });
      y = 770;
    }
  };

  const addPage = (first = false) => {
    page = document.addPage(PAGE_SIZE);
    drawHeader(first);
  };

  const ensureSpace = (height) => {
    if (y - height >= PAGE_BOTTOM) return false;
    addPage(false);
    return true;
  };

  const drawWrapped = (content, { x = PAGE_MARGIN, width = CONTENT_WIDTH, size = 9, font = regular, color = ink, lineHeight = size + 2 } = {}) => {
    const lines = wrapText(content, font, size, width);
    lines.forEach((line, index) => {
      if (line) page.drawText(line, { x, y: y - index * lineHeight, size, font, color });
    });
    y -= Math.max(1, lines.length) * lineHeight;
    return lines.length;
  };

  const drawSection = (title, { continued = false } = {}) => {
    ensureSpace(31);
    page.drawRectangle({ x: PAGE_MARGIN, y: y - 22, width: CONTENT_WIDTH, height: 22, color: green });
    page.drawText(`${title}${continued ? " - continued" : ""}`, { x: PAGE_MARGIN + 7, y: y - 15, size: continued ? 9.2 : 10.2, font: bold, color: white });
    y -= 29;
  };

  const drawOverview = () => {
    const height = 93;
    ensureSpace(height);
    page.drawRectangle({ x: PAGE_MARGIN, y: y - height, width: CONTENT_WIDTH, height, color: white, borderColor: rule, borderWidth: 0.7 });
    const fields = [
      ["PADDOCK", paddock.name],
      ["SAVED PADDOCK TOTAL", balance.sizeHectares === null ? "Not recorded" : `${displayNumber.format(balance.sizeHectares)} ha`],
      ["COPY", `${descriptor.label} - Revision ${descriptor.revision}`],
      ["GENERATED", descriptor.generatedAt],
      ["SAVED / INCLUDED RECORDS", `${totals.records} saved / ${totals.includedRecords} included`],
      ["CALCULATED VALID ACTIVE-SPRAY LIQUID", numberText(totals.litres, "L")],
    ];
    const columnWidth = CONTENT_WIDTH / 3;
    fields.forEach(([label, value], index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const x = PAGE_MARGIN + 10 + column * columnWidth;
      const top = y - 13 - row * 42;
      page.drawText(label, { x, y: top, size: 6.4, font: bold, color: greenMid });
      const lines = wrapText(value, index === 0 ? bold : regular, 9, columnWidth - 20).slice(0, 2);
      lines.forEach((line, lineIndex) => page.drawText(line, { x, y: top - 14 - lineIndex * 10, size: 9, font: lineIndex || index !== 0 ? regular : bold, color: ink }));
    });
    y -= height + 8;
    const noteLines = wrapText(`Paddock note: ${paddock.note || "None"}`, regular, 8.8, CONTENT_WIDTH - 18);
    const noteHeight = noteLines.length * 10.5 + 14;
    page.drawRectangle({ x: PAGE_MARGIN, y: y - noteHeight, width: CONTENT_WIDTH, height: noteHeight, color: greenPale, borderColor: rule, borderWidth: 0.5 });
    noteLines.forEach((line, index) => page.drawText(line, { x: PAGE_MARGIN + 9, y: y - 11 - index * 10.5, size: 8.8, font: index ? regular : bold, color: ink }));
    y -= noteHeight + 9;
  };

  const drawCoverage = () => {
    drawSection("Coverage and calculation summary");
    const gap = 8;
    const cardWidth = (CONTENT_WIDTH - gap) / 2;
    const cardHeight = 96;
    ensureSpace(cardHeight + 62);
    const cards = [
      {
        title: "REPORTED BROADACRE AREA",
        primary: numberText(balance.reportedBroadacreHectares, "ha"),
        secondary: `${numberText(balance.reportedBroadacreCoveragePercent, "%")} of saved paddock`,
        detail: `${signedNumberText(balance.broadacreVarianceHectares, "ha")} against one saved paddock`,
        status: stateLabel(balance.state),
      },
      {
        title: "CALCULATED ACTIVE-SPRAY EQUIVALENT",
        primary: numberText(balance.activeSprayEquivalentHectares, "ha"),
        secondary: `${numberText(balance.activeSprayCoveragePercent, "%")} of saved paddock`,
        detail: `${signedNumberText(balance.activeSprayVarianceHectares, "ha")} against one saved paddock`,
        status: stateLabel(balance.activeSprayState),
      },
    ];
    cards.forEach((card, index) => {
      const x = PAGE_MARGIN + index * (cardWidth + gap);
      page.drawRectangle({ x, y: y - cardHeight, width: cardWidth, height: cardHeight, color: index ? greenPale : white, borderColor: index ? greenMid : rule, borderWidth: 0.75 });
      page.drawText(card.title, { x: x + 9, y: y - 15, size: 6.7, font: bold, color: greenMid });
      page.drawText(card.primary, { x: x + 9, y: y - 39, size: 17, font: bold, color: ink });
      page.drawText(card.secondary, { x: x + 9, y: y - 56, size: 8.5, font: regular, color: ink });
      page.drawText(card.detail, { x: x + 9, y: y - 70, size: 8, font: regular, color: muted });
      wrapText(card.status, bold, 7.4, cardWidth - 18).slice(0, 2).forEach((line, lineIndex) => page.drawText(line, { x: x + 9, y: y - 84 - lineIndex * 8, size: 7.4, font: bold, color: green }));
    });
    y -= cardHeight + 8;
    const caveats = `${ACTIVE_SPRAY_CAVEAT}\n${PRODUCT_CALCULATION_CAVEAT}`;
    const caveatLines = wrapText(caveats, regular, 7.5, CONTENT_WIDTH - 18);
    const caveatHeight = caveatLines.length * 9 + 14;
    page.drawRectangle({ x: PAGE_MARGIN, y: y - caveatHeight, width: CONTENT_WIDTH, height: caveatHeight, color: yellowPale, borderColor: rule, borderWidth: 0.5 });
    caveatLines.forEach((line, index) => page.drawText(line, { x: PAGE_MARGIN + 9, y: y - 11 - index * 9, size: 7.5, font: regular, color: ink }));
    y -= caveatHeight + 7;
    const issueMessages = uniqueMessages(balance.recordIssues);
    if (issueMessages.length) {
      const issueLines = wrapText(`Saved-record check: ${issueMessages.join(" ")}`, regular, 7.6, CONTENT_WIDTH - 18);
      const issueHeight = issueLines.length * 9 + 12;
      page.drawRectangle({ x: PAGE_MARGIN, y: y - issueHeight, width: CONTENT_WIDTH, height: issueHeight, color: greenPale, borderColor: rule, borderWidth: 0.5 });
      issueLines.forEach((line, index) => page.drawText(line, { x: PAGE_MARGIN + 9, y: y - 10 - index * 9, size: 7.6, font: regular, color: ink }));
      y -= issueHeight + 8;
    }
  };

  const productColumns = [
    { title: "Chemical", width: 112 },
    { title: "Recorded", width: 71 },
    { title: "Chemical-eq", width: 80 },
    { title: "Vs active-spray eq", width: 126 },
    { title: "Vs one paddock", width: CONTENT_WIDTH - 389 },
  ];

  const drawProductHeader = () => {
    const height = 19;
    page.drawRectangle({ x: PAGE_MARGIN, y: y - height, width: CONTENT_WIDTH, height, color: greenLight, borderColor: rule, borderWidth: 0.5 });
    let x = PAGE_MARGIN;
    productColumns.forEach((column, index) => {
      page.drawText(column.title, { x: x + 4, y: y - 13, size: 6.8, font: bold, color: green });
      x += column.width;
      if (index < productColumns.length - 1) page.drawLine({ start: { x, y }, end: { x, y: y - height }, thickness: 0.4, color: rule });
    });
    y -= height;
  };

  const drawProductSummary = () => {
    drawSection("Product chemical-equivalent summary");
    drawProductHeader();
    if (!balance.productSummaries.length) {
      page.drawText("No products recorded", { x: PAGE_MARGIN + 6, y: y - 15, size: 8.5, font: regular, color: muted });
      y -= 24;
      return;
    }
    balance.productSummaries.forEach((product, index) => {
      const cells = [
        `${product.name}\n${stateLabel(product.status)}`,
        practicalText(product.recordedAmountBase, product.baseUnit),
        `${numberText(product.chemicalEquivalentHectares, "ha")}\n${numberText(product.chemicalEquivalentCoveragePercent, "%")}`,
        `${practicalText(product.varianceAmountBase, product.baseUnit, { signed: true })}\n${signedNumberText(product.varianceEquivalentHectares, "ha eq")}`,
        `${practicalText(product.fullPaddockVarianceAmountBase, product.baseUnit, { signed: true })}\n${signedNumberText(product.fullPaddockVarianceEquivalentHectares, "ha eq")}`,
      ];
      const cellLines = cells.map((value, cellIndex) => wrapText(value, cellIndex === 0 ? bold : regular, 7.5, productColumns[cellIndex].width - 8));
      const detail = productAvailability(product);
      const detailLines = detail === stateLabel(product.status) ? [] : wrapText(`Availability: ${detail}`, regular, 7.2, CONTENT_WIDTH - 14);
      const rowHeight = Math.max(27, Math.max(...cellLines.map((lines) => lines.length)) * 9 + 8) + (detailLines.length ? detailLines.length * 8.5 + 7 : 0);
      if (ensureSpace(rowHeight + 48)) {
        drawSection("Product chemical-equivalent summary", { continued: true });
        drawProductHeader();
      }
      const top = y;
      page.drawRectangle({ x: PAGE_MARGIN, y: y - rowHeight, width: CONTENT_WIDTH, height: rowHeight, color: index % 2 ? white : greenPale, borderColor: rule, borderWidth: 0.45 });
      let x = PAGE_MARGIN;
      productColumns.forEach((column, cellIndex) => {
        cellLines[cellIndex].forEach((line, lineIndex) => page.drawText(line, { x: x + 4, y: top - 12 - lineIndex * 9, size: 7.5, font: cellIndex === 0 && lineIndex === 0 ? bold : regular, color: cellIndex === 0 ? green : ink }));
        x += column.width;
        if (cellIndex < productColumns.length - 1) page.drawLine({ start: { x, y: top }, end: { x, y: top - rowHeight }, thickness: 0.4, color: rule });
      });
      if (detailLines.length) {
        const baseline = top - rowHeight + detailLines.length * 8.5;
        detailLines.forEach((line, lineIndex) => page.drawText(line, { x: PAGE_MARGIN + 7, y: baseline - lineIndex * 8.5, size: 7.2, font: regular, color: muted }));
      }
      y -= rowHeight;
    });
    y -= 9;
  };

  const recordProductColumns = [
    { title: "Chemical", offset: 8, width: 257 },
    { title: "Rate", offset: 265, width: 137 },
    { title: "Calculated amount", offset: 402, width: CONTENT_WIDTH - 410 },
  ];

  const drawRecordProductHeader = () => {
    page.drawRectangle({ x: PAGE_MARGIN + 8, y: y - 16, width: CONTENT_WIDTH - 16, height: 16, color: greenLight });
    recordProductColumns.forEach((column, index) => {
      page.drawText(column.title, { x: PAGE_MARGIN + column.offset + 5, y: y - 11, size: 6.6, font: bold, color: green });
      if (index) page.drawLine({ start: { x: PAGE_MARGIN + column.offset, y }, end: { x: PAGE_MARGIN + column.offset, y: y - 16 }, thickness: 0.35, color: rule });
    });
    y -= 16;
  };

  const drawRecordHeading = (tank, { continued = false } = {}) => {
    page.drawRectangle({ x: PAGE_MARGIN, y: y - 22, width: CONTENT_WIDTH, height: 22, color: greenPale, borderColor: greenMid, borderWidth: 0.65 });
    page.drawText(`${recordLabel(tank)}${continued ? " - continued" : ""}`, { x: PAGE_MARGIN + 7, y: y - 15, size: 9.2, font: bold, color: green });
    y -= 28;
    if (!continued) {
      for (const detail of recordDetailLines(tank)) {
        const detailLines = wrapText(detail, regular, 7.8, CONTENT_WIDTH - 16);
        detailLines.forEach((line, index) => page.drawText(line, { x: PAGE_MARGIN + 8, y: y - 8 - index * 9, size: 7.8, font: regular, color: ink }));
        y -= Math.max(1, detailLines.length) * 9 + 5;
      }
    }
    drawRecordProductHeader();
  };

  const drawRecords = () => {
    drawSection("Tank and Buffer records");
    const records = sortedTanks(paddock);
    if (!records.length) {
      page.drawText("No saved records", { x: PAGE_MARGIN, y: y - 13, size: 8.5, font: regular, color: muted });
      y -= 24;
      return;
    }
    records.forEach((tank) => {
      if (ensureSpace(82)) drawSection("Tank and Buffer records", { continued: true });
      drawRecordHeading(tank);
      const products = tank.products?.length ? tank.products : [null];
      products.forEach((product, productIndex) => {
        const values = product
          ? [
              productDisplayName(product),
              numberText(product.rate, UNIT_LABELS[product.unit] || product.unit),
              practicalText(product.amountBase, product.baseUnit),
            ]
          : ["No products recorded", "", ""];
        const cellLines = values.map((value, index) => wrapText(value, index === 0 && product ? bold : regular, 7.6, recordProductColumns[index].width - 10));
        const rowHeight = Math.max(19, Math.max(...cellLines.map((lines) => lines.length)) * 9 + 7);
        if (y - rowHeight < PAGE_BOTTOM) {
          addPage(false);
          drawSection("Tank and Buffer records", { continued: true });
          drawRecordHeading(tank, { continued: true });
        }
        page.drawRectangle({ x: PAGE_MARGIN + 8, y: y - rowHeight, width: CONTENT_WIDTH - 16, height: rowHeight, color: productIndex % 2 ? white : greenPale, borderColor: rule, borderWidth: 0.35 });
        recordProductColumns.forEach((column, index) => {
          cellLines[index].forEach((line, lineIndex) => page.drawText(line, {
            x: PAGE_MARGIN + column.offset + 5,
            y: y - 13 - lineIndex * 9,
            size: 7.6,
            font: index === 0 && product ? bold : regular,
            color: product ? ink : muted,
          }));
          if (index) page.drawLine({ start: { x: PAGE_MARGIN + column.offset, y }, end: { x: PAGE_MARGIN + column.offset, y: y - rowHeight }, thickness: 0.35, color: rule });
        });
        y -= rowHeight;
      });
      y -= 9;
    });
  };

  addPage(true);
  drawOverview();
  drawCoverage();
  drawProductSummary();
  drawRecords();

  const pages = document.getPages();
  pages.forEach((pdfPage, index) => {
    pdfPage.drawLine({ start: { x: PAGE_MARGIN, y: 40 }, end: { x: PAGE_SIZE[0] - PAGE_MARGIN, y: 40 }, thickness: 0.45, color: rule });
    pdfPage.drawText("Pallathorpe Enterprises calculated spray record", { x: PAGE_MARGIN, y: 25, size: 7.1, font: regular, color: muted });
    const revisionText = `Revision ${descriptor.revision}`;
    const pageText = `Page ${index + 1} of ${pages.length}`;
    pdfPage.drawText(revisionText, { x: PAGE_SIZE[0] - PAGE_MARGIN - 72 - regular.widthOfTextAtSize(revisionText, 7.1), y: 25, size: 7.1, font: regular, color: muted });
    pdfPage.drawText(pageText, { x: PAGE_SIZE[0] - PAGE_MARGIN - regular.widthOfTextAtSize(pageText, 7.1), y: 25, size: 7.1, font: regular, color: muted });
  });
  return document.save({ useObjectStreams: false });
}

import { MACHINES } from "./storage.mjs";

export const UNIT_LABELS = Object.freeze({
  l_ha: "L/ha",
  ml_ha: "mL/ha",
  g_ha: "g/ha",
  kg_ha: "kg/ha",
  ml_100: "mL/100 L",
  kg_100: "kg/100 L",
});

const exportNumber = new Intl.NumberFormat("en-AU", {
  maximumFractionDigits: 6,
  useGrouping: false,
});

const displayNumber = new Intl.NumberFormat("en-AU", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

export function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function practicalAmount(amountBase, baseUnit) {
  if (baseUnit === "ml") {
    return amountBase >= 1000
      ? { value: amountBase / 1000, unit: "L", longUnit: "litres" }
      : { value: amountBase, unit: "mL", longUnit: "millilitres" };
  }
  return amountBase >= 1000
    ? { value: amountBase / 1000, unit: "kg", longUnit: "kilograms" }
    : { value: amountBase, unit: "g", longUnit: "grams" };
}

export function missingShareMetadata(paddock) {
  const issues = [];
  for (const tank of paddock?.tanks || []) {
    if (!String(tank.operator || "").trim() || !MACHINES.includes(tank.machine)) {
      issues.push({
        tankId: tank.id,
        tankNumber: tank.tankNumber,
        date: tank.date,
        operatorMissing: !String(tank.operator || "").trim(),
        machineMissing: !MACHINES.includes(tank.machine),
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

function paddockTotals(paddock) {
  return (paddock.tanks || []).reduce(
    (totals, tank) => ({
      litres: totals.litres + Number(tank.tankTotal || 0),
      hectares: totals.hectares + Number(tank.hectares || 0),
    }),
    { litres: 0, hectares: 0 },
  );
}

export function buildPaddockCsv(paddock, descriptor) {
  const totals = paddockTotals(paddock);
  const rows = [
    ["Pallathorpe spray record"],
    ["Paddock", paddock.name],
    ["Record status", descriptor.label],
    ["Content revision", descriptor.revision],
    ["Generated", descriptor.generatedAt],
    ["Paddock total (L)", exportNumber.format(totals.litres)],
    ["Area (ha)", exportNumber.format(totals.hectares)],
    ["Paddock note", paddock.note || ""],
    [],
    [
      "Spray date",
      "Saved time",
      "Tank",
      "Operator",
      "Machine",
      "Tank total (L)",
      "Spray rate (L/ha)",
      "Area (ha)",
      "Chemical",
      "Rate",
      "Rate unit",
      "Calculated amount",
      "Amount unit",
    ],
  ];

  for (const tank of sortedTanks(paddock)) {
    const products = tank.products?.length ? tank.products : [null];
    for (const product of products) {
      const practical = product ? practicalAmount(product.amountBase, product.baseUnit) : null;
      rows.push([
        tank.date,
        tank.savedAt,
        `Tank ${tank.tankNumber}`,
        tank.operator || "",
        tank.machine || "",
        exportNumber.format(tank.tankTotal),
        exportNumber.format(tank.sprayRate),
        exportNumber.format(tank.hectares),
        product?.name || "",
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
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E\n]/g, "?");
}

export function buildPdfContentLines(paddock, descriptor) {
  const totals = paddockTotals(paddock);
  const lines = [
    { kind: "title", text: "Pallathorpe Enterprises" },
    { kind: "heading", text: "Spray Record" },
    { kind: "meta", text: `Paddock: ${paddock.name}` },
    { kind: "meta", text: `${descriptor.label} | Revision ${descriptor.revision}` },
    { kind: "meta", text: `Generated: ${descriptor.generatedAt}` },
    { kind: "meta", text: `Total: ${displayNumber.format(totals.litres)} L | ${displayNumber.format(totals.hectares)} ha` },
    { kind: "meta", text: `Paddock note: ${paddock.note || "None"}` },
  ];
  for (const tank of sortedTanks(paddock)) {
    lines.push({ kind: "tank", text: `Tank ${tank.tankNumber} | ${tank.date} | ${tank.operator} | ${tank.machine}` });
    lines.push({
      kind: "detail",
      text: `${displayNumber.format(tank.tankTotal)} L | ${displayNumber.format(tank.sprayRate)} L/ha | ${displayNumber.format(tank.hectares)} ha`,
    });
    if (!tank.products?.length) {
      lines.push({ kind: "product", text: "No products recorded" });
    } else {
      for (const product of tank.products) {
        const amount = practicalAmount(product.amountBase, product.baseUnit);
        lines.push({
          kind: "product",
          text: `${product.name} | ${displayNumber.format(product.rate)} ${UNIT_LABELS[product.unit] || product.unit} | ${displayNumber.format(amount.value)} ${amount.unit}`,
        });
      }
    }
  }
  return lines.map((line) => ({ ...line, text: safePdfText(line.text) }));
}

export async function buildPaddockPdf(paddock, descriptor, pdfLib = globalThis.PDFLib) {
  if (!pdfLib?.PDFDocument || !pdfLib?.StandardFonts || !pdfLib?.rgb) {
    throw new Error("The offline PDF generator is unavailable.");
  }
  const { PDFDocument, StandardFonts, rgb } = pdfLib;
  const document = await PDFDocument.create();
  document.setTitle(`${paddock.name} spray record`);
  document.setAuthor("Pallathorpe Enterprises");
  document.setSubject(`${descriptor.label} revision ${descriptor.revision}`);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const pageSize = [595.28, 841.89];
  const margin = 42;
  let page = document.addPage(pageSize);
  let y = page.getHeight() - margin;

  const addPage = () => {
    page = document.addPage(pageSize);
    y = page.getHeight() - margin;
  };
  const writeWrapped = (content, options = {}) => {
    const size = options.size || 10;
    const font = options.bold ? bold : regular;
    const colour = options.colour || rgb(0.09, 0.14, 0.11);
    const maxWidth = page.getWidth() - margin * 2 - (options.indent || 0);
    const words = content.split(/\s+/);
    const wrapped = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) current = candidate;
      else {
        wrapped.push(current);
        current = word;
      }
    }
    if (current) wrapped.push(current);
    for (const line of wrapped) {
      if (y < margin + 24) addPage();
      page.drawText(line, { x: margin + (options.indent || 0), y, size, font, color: colour });
      y -= size + (options.leading || 5);
    }
    y -= options.after || 0;
  };

  for (const line of buildPdfContentLines(paddock, descriptor)) {
    if (line.kind === "title") writeWrapped(line.text, { size: 12, bold: true, colour: rgb(0.14, 0.42, 0.22), after: 2 });
    else if (line.kind === "heading") writeWrapped(line.text, { size: 22, bold: true, after: 8 });
    else if (line.kind === "tank") writeWrapped(line.text, { size: 12, bold: true, colour: rgb(0.14, 0.42, 0.22), after: 1 });
    else if (line.kind === "product") writeWrapped(line.text, { size: 9, indent: 12, after: 1 });
    else writeWrapped(line.text, { size: 10, after: line.kind === "detail" ? 2 : 1 });
  }

  const pages = document.getPages();
  pages.forEach((pdfPage, index) => {
    pdfPage.drawText(`Page ${index + 1} of ${pages.length}`, {
      x: pdfPage.getWidth() - margin - 58,
      y: 22,
      size: 8,
      font: regular,
      color: rgb(0.36, 0.41, 0.37),
    });
  });
  return document.save({ useObjectStreams: false });
}


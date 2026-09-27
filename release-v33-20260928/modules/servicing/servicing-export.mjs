import { loadPdfLib } from "../pdf-lib-loader.mjs";
import { loadPropertySettings, propertyIdentitySnapshot } from "../property-settings.mjs";
import {
  SERVICING_RECORD_TITLE,
  buildServicingLayout4830,
} from "./servicing-layout-4830.mjs";

const PAGE_SIZE = Object.freeze([595.28, 841.89]);
const PAGE_MARGIN = 34;
const PAGE_BOTTOM = 48;
const CONTENT_WIDTH = PAGE_SIZE[0] - PAGE_MARGIN * 2;
const TABLE_COLUMNS = Object.freeze([
  { key: "label", title: "Service task", width: 235 },
  { key: "interval", title: "Interval / status", width: 97 },
  { key: "note", title: "Notes / exception", width: CONTENT_WIDTH - 332 },
]);

function safePdfText(value) {
  return String(value ?? "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u2022/g, "-")
    .replace(/[^\x20-\x7E\n]/g, "?");
}

export function servicingStatusMarker(state) {
  if (state === "done") return "tick";
  if (state === "deferred") return "warning";
  if (state === "not_applicable") return "not-applicable";
  return null;
}

function filenameHours(value) {
  return String(value)
    .replace(/[^0-9.]+/g, "")
    .replaceAll(".", "-") || "hours-not-recorded";
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Brisbane",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(date);
}

export function servicingExportDescriptor(record, generatedAt = new Date().toISOString(), currentPropertySettings = null) {
  const revision = Number(record?.revision);
  const serviceDate = String(record?.serviceDate || "");
  if (!Number.isInteger(revision) || revision < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
    throw new TypeError("A service date and record revision are required for export.");
  }
  let identity = record.propertySnapshot;
  if (!identity) {
    try {
      identity = propertyIdentitySnapshot(currentPropertySettings ?? loadPropertySettings(globalThis.localStorage));
    } catch {
      identity = propertyIdentitySnapshot();
    }
  }
  const legacyDescriptor = {
    title: SERVICING_RECORD_TITLE,
    generatedAt,
    serviceDate,
    revision,
    businessName: identity.businessName,
    shortName: identity.shortName,
    identityStatus: record.propertySnapshot ? "snapshot" : "legacy/current-profile fallback",
    filename: `pallathorpe_4830_service_${serviceDate}_${filenameHours(record.engineHours)}h_rev-${revision}.pdf`,
  };
  if (!record.propertySnapshot) return Object.freeze(legacyDescriptor);
  return Object.freeze({ ...legacyDescriptor,
    businessName: identity.businessName,
    shortName: identity.shortName,
    identityStatus: "snapshot",
    filename: `${identity.shortName.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "pallathorpe"}_4830_service_${serviceDate}_${filenameHours(record.engineHours)}h_rev-${revision}.pdf`,
  });
}

function compactText(value, fallback, maximum = 72) {
  const content = String(value || "").trim();
  if (!content) return "";
  return content.length <= maximum ? content : fallback;
}

function taskPresentationNote(task) {
  const details = [];
  if (task.boomLocationLabels.length) details.push(`Locations ${task.boomLocationLabels.join(", ")}`);
  if (task.reason) details.push(compactText(task.reason, "See notes and to-do list"));
  if (task.note) details.push(compactText(task.note, "See notes and to-do list"));
  if (task.followUpRequired) details.push("To-do required");
  return [...new Set(details)].join("\n");
}

function presentationAppendix(entries) {
  const presented = [];
  const groupedSourceNotes = new Map();
  for (const entry of entries) {
    if (entry.label === "Source note") {
      const key = entry.text;
      const current = groupedSourceNotes.get(key) || { ...entry, taskLabels: [], intervals: [] };
      if (!current.taskLabels.includes(entry.taskLabel)) current.taskLabels.push(entry.taskLabel);
      if (!current.intervals.includes(entry.interval)) current.intervals.push(entry.interval);
      groupedSourceNotes.set(key, current);
    } else {
      presented.push({ ...entry, taskLabels: [entry.taskLabel], intervals: [entry.interval] });
    }
  }
  return [...presented, ...groupedSourceNotes.values()];
}

export function buildServicingPdfContentLines(record, descriptor) {
  const layout = buildServicingLayout4830(record);
  const lines = [
    { kind: "brand", text: descriptor.businessName || "Pallathorpe Enterprises" },
    { kind: "title", text: "4830 Service Record" },
    { kind: "meta", text: `Identity: ${descriptor.identityStatus === "mixed" ? "Mixed property identities disclosed in saved records" : descriptor.identityStatus || "Current profile"}` },
    { kind: "subtitle", text: layout.subtitle },
    { kind: "identity", text: layout.recordIdentity },
    { kind: "outcome", text: layout.outcome },
    ...layout.metadata.map(([label, value]) => ({ kind: "meta", text: `${label}: ${value}` })),
    { kind: "summary", text: `Done: ${layout.summary.done}` },
    { kind: "summary", text: `Deferred: ${layout.summary.deferred}` },
    { kind: "summary", text: `Not applicable: ${layout.summary.not_applicable}` },
    { kind: "summary", text: `To-do list: ${layout.summary.followUp}` },
  ];
  for (const section of layout.sections) {
    if (section.id === "boom" && layout.boomReference.length) {
      lines.push({ kind: "section", text: "Boom reference" });
      lines.push({ kind: "boom-diagram", text: `${descriptor.businessName || "Pallathorpe Enterprises"} boom reference - not to scale`, locations: layout.boomReference });
      for (const location of layout.boomReference) {
        const fittingText = location.fittingLocations === null
          ? "fitting count not recorded"
          : `${location.fittingLocations} fitting locations${location.eachSide ? " each side" : ""}`;
        lines.push({ kind: "detail", text: `${location.label}: ${location.description} | ${location.interval} | ${fittingText}` });
      }
    }
    lines.push({ kind: "section", text: section.id === "boom" ? "Boom lubrication" : section.title });
    lines.push({ kind: "table-header", text: "Service task | Interval / status | Notes / exception" });
    for (const task of section.tasks) {
      lines.push({
        kind: "task",
        text: `${task.label} | ${task.interval} | ${task.stateLabel}${taskPresentationNote(task) ? ` | ${taskPresentationNote(task)}` : ""}`,
      });
    }
  }
  if (layout.overallNotes) lines.push({ kind: "overall-note", text: `Overall notes: ${layout.overallNotes}` });
  if (layout.amendmentReason) lines.push({ kind: "amendment", text: `Amendment reason: ${layout.amendmentReason}` });
  const appendix = presentationAppendix(layout.appendix);
  if (appendix.length) {
    lines.push({ kind: "appendix", text: "Notes and to-do list" });
    for (const entry of appendix) {
      const taskNames = entry.taskLabels.join(" / ");
      lines.push({ kind: "appendix-entry", text: `${taskNames} - ${entry.label}: ${entry.text}` });
    }
  }
  lines.push({ kind: "finalised", text: `Finalised: ${layout.finalisedDisplay}` });
  lines.push({ kind: "generated", text: `Copy generated: ${formatTimestamp(descriptor.generatedAt)}` });
  lines.push({ kind: "disclaimer", text: layout.disclaimer });
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
  for (const paragraph of String(content).split("\n")) {
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

function metadataValue(layout, label) {
  return layout.metadata.find(([candidate]) => candidate === label)?.[1] || "Not recorded";
}

export async function buildServicingPdf(record, descriptor, pdfLib = null) {
  const layout = buildServicingLayout4830(record);
  const resolvedPdfLib = pdfLib || await loadPdfLib();
  if (!resolvedPdfLib?.PDFDocument || !resolvedPdfLib?.StandardFonts || !resolvedPdfLib?.rgb) {
    throw new Error("The offline PDF generator is unavailable.");
  }
  const { PDFDocument, StandardFonts, rgb } = resolvedPdfLib;
  const document = await PDFDocument.create();
  document.setTitle(SERVICING_RECORD_TITLE);
  document.setAuthor(descriptor.businessName || "Pallathorpe Enterprises");
  document.setSubject(`${layout.outcome} | ${layout.recordIdentity}`);
  const generatedDate = new Date(descriptor.generatedAt);
  if (!Number.isNaN(generatedDate.getTime())) {
    document.setCreationDate(generatedDate);
    document.setModificationDate(generatedDate);
  }

  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const green = rgb(0.08, 0.31, 0.17);
  const greenMid = rgb(0.14, 0.42, 0.22);
  const ink = rgb(0.08, 0.11, 0.09);
  const muted = rgb(0.34, 0.38, 0.35);
  const rule = rgb(0.72, 0.75, 0.72);
  const pale = rgb(0.94, 0.96, 0.93);
  const stripe = rgb(0.98, 0.985, 0.98);
  const amber = rgb(0.96, 0.78, 0.25);
  const amberPale = rgb(1, 0.97, 0.84);
  const greyPale = rgb(0.94, 0.94, 0.93);
  const white = rgb(1, 1, 1);
  let page;
  let y;
  let currentSection = "";
  let rowIndex = 0;

  const drawRight = (value, x, baseline, size, font, color) => {
    const content = safePdfText(value);
    page.drawText(content, { x: x - font.widthOfTextAtSize(content, size), y: baseline, size, font, color });
  };

  const drawCompactHeader = () => {
    page.drawText(safePdfText(descriptor.businessName || "Pallathorpe Enterprises"), { x: PAGE_MARGIN, y: 814, size: 8.5, font: bold, color: greenMid });
    page.drawText("4830 Service Record", { x: PAGE_MARGIN, y: 797, size: 14, font: bold, color: ink });
    drawRight(layout.recordIdentity, PAGE_SIZE[0] - PAGE_MARGIN, 798, 7.5, regular, muted);
    page.drawLine({ start: { x: PAGE_MARGIN, y: 786 }, end: { x: PAGE_SIZE[0] - PAGE_MARGIN, y: 786 }, thickness: 1.2, color: green });
    y = 772;
  };

  const addPage = ({ first = false } = {}) => {
    page = document.addPage(PAGE_SIZE);
    if (first) {
      page.drawText(safePdfText(descriptor.businessName || "Pallathorpe Enterprises"), { x: PAGE_MARGIN, y: 814, size: 10, font: bold, color: greenMid });
      page.drawText("4830 Service Record", { x: PAGE_MARGIN, y: 788, size: 20, font: bold, color: ink });
      page.drawText(layout.subtitle, { x: PAGE_MARGIN, y: 773, size: 8.5, font: regular, color: muted });
      drawRight(`Revision ${descriptor.revision}`, PAGE_SIZE[0] - PAGE_MARGIN, 793, 9, bold, green);
      page.drawLine({ start: { x: PAGE_MARGIN, y: 762 }, end: { x: PAGE_SIZE[0] - PAGE_MARGIN, y: 762 }, thickness: 1.4, color: green });
      y = 748;
    } else drawCompactHeader();
  };

  const ensureSpace = (height, { repeatTable = false } = {}) => {
    if (y - height >= PAGE_BOTTOM) return false;
    addPage();
    if (repeatTable && currentSection) {
      drawSectionHeader(`${currentSection} - continued`, { continuation: true });
    }
    return true;
  };

  const drawCellLines = (lines, x, top, width, { size = 8.8, font = regular, color = ink, lineHeight = 10.4 } = {}) => {
    lines.forEach((line, index) => {
      if (line) page.drawText(safePdfText(line), { x: x + 4, y: top - 4 - size - index * lineHeight, size, font, color, maxWidth: width - 8 });
    });
  };

  const drawTableHeader = () => {
    const height = 19;
    page.drawRectangle({ x: PAGE_MARGIN, y: y - height, width: CONTENT_WIDTH, height, color: pale, borderColor: rule, borderWidth: 0.6 });
    let x = PAGE_MARGIN;
    for (const column of TABLE_COLUMNS) {
      page.drawText(column.title, { x: x + 4, y: y - 13, size: 7.6, font: bold, color: green });
      x += column.width;
      if (x < PAGE_MARGIN + CONTENT_WIDTH) page.drawLine({ start: { x, y }, end: { x, y: y - height }, thickness: 0.45, color: rule });
    }
    y -= height;
  };

  function drawSectionHeader(title, { continuation = false } = {}) {
    ensureSpace(52);
    currentSection = title.replace(/ - continued$/, "");
    rowIndex = 0;
    page.drawRectangle({ x: PAGE_MARGIN, y: y - 23, width: CONTENT_WIDTH, height: 23, color: green });
    page.drawText(title, { x: PAGE_MARGIN + 7, y: y - 16, size: continuation ? 9.5 : 10.5, font: bold, color: white });
    y -= 23;
    drawTableHeader();
  }

  const drawTaskRow = (task) => {
    const note = taskPresentationNote(task);
    const values = { label: task.label, interval: task.interval, note };
    const cellLines = TABLE_COLUMNS.map((column) => {
      const font = column.key === "label" ? bold : regular;
      const size = column.key === "label" ? 9.2 : 8.5;
      const markerAllowance = column.key === "interval" ? 24 : 0;
      return wrapText(values[column.key], font, size, column.width - 8 - markerAllowance);
    });
    const lineHeight = 10.5;
    const height = Math.max(22, Math.max(...cellLines.map((lines) => Math.max(lines.length, 1))) * lineHeight + 8);
    ensureSpace(height, { repeatTable: true });
    const rowTop = y;
    const fill = rowIndex % 2 ? white : stripe;
    page.drawRectangle({ x: PAGE_MARGIN, y: y - height, width: CONTENT_WIDTH, height, color: fill, borderColor: rule, borderWidth: 0.5 });
    let x = PAGE_MARGIN;
    TABLE_COLUMNS.forEach((column, index) => {
      if (column.key === "note" && ["deferred", "not_applicable"].includes(task.state)) {
        const stateFill = task.state === "deferred" ? amberPale : task.state === "not_applicable" ? greyPale : pale;
        page.drawRectangle({ x, y: y - height, width: column.width, height, color: stateFill });
      }
      const font = column.key === "label" ? bold : regular;
      const color = ink;
      drawCellLines(cellLines[index], x, rowTop, column.width, { size: column.key === "label" ? 9.2 : 8.5, font, color, lineHeight });
      if (column.key === "interval") {
        const markerX = x + column.width - 15;
        const markerY = rowTop - height / 2;
        const statusMarker = servicingStatusMarker(task.state);
        if (statusMarker === "tick") {
          page.drawLine({ start: { x: markerX - 6, y: markerY }, end: { x: markerX - 2, y: markerY - 4 }, thickness: 1.7, color: greenMid });
          page.drawLine({ start: { x: markerX - 2, y: markerY - 4 }, end: { x: markerX + 6, y: markerY + 5 }, thickness: 1.7, color: greenMid });
        } else if (statusMarker === "warning") {
          page.drawLine({ start: { x: markerX, y: markerY + 7 }, end: { x: markerX - 7, y: markerY - 6 }, thickness: 1.1, color: greenMid });
          page.drawLine({ start: { x: markerX - 7, y: markerY - 6 }, end: { x: markerX + 7, y: markerY - 6 }, thickness: 1.1, color: greenMid });
          page.drawLine({ start: { x: markerX + 7, y: markerY - 6 }, end: { x: markerX, y: markerY + 7 }, thickness: 1.1, color: greenMid });
          page.drawText("!", { x: markerX - 1.2, y: markerY - 4, size: 7.5, font: bold, color: green });
        } else if (statusMarker === "not-applicable") {
          page.drawText("N/A", { x: markerX - 8, y: markerY - 3, size: 6.4, font: bold, color: muted });
        }
      }
      x += column.width;
      if (x < PAGE_MARGIN + CONTENT_WIDTH) page.drawLine({ start: { x, y: rowTop }, end: { x, y: rowTop - height }, thickness: 0.45, color: rule });
    });
    y -= height;
    rowIndex += 1;
  };

  const drawLabelValue = (label, value, x, top, width, { maxLines = 2, valueSize = 9.1 } = {}) => {
    page.drawText(label.toUpperCase(), { x, y: top, size: 6.5, font: bold, color: greenMid });
    const wrapped = wrapText(value, regular, valueSize, width);
    wrapped.slice(0, maxLines).forEach((line, index) => page.drawText(safePdfText(line), { x, y: top - 13 - index * 10.5, size: valueSize, font: index ? regular : bold, color: ink }));
  };

  const drawOverview = () => {
    const height = 124;
    const detailsWidth = 365;
    const summaryWidth = CONTENT_WIDTH - detailsWidth;
    page.drawRectangle({ x: PAGE_MARGIN, y: y - height, width: CONTENT_WIDTH, height, borderColor: rule, borderWidth: 0.7, color: white });
    page.drawLine({ start: { x: PAGE_MARGIN + detailsWidth, y }, end: { x: PAGE_MARGIN + detailsWidth, y: y - height }, thickness: 0.6, color: rule });
    drawLabelValue("Machine", metadataValue(layout, "Machine"), PAGE_MARGIN + 10, y - 13, 92);
    drawLabelValue("Service date", metadataValue(layout, "Service date"), PAGE_MARGIN + 120, y - 13, 225);
    drawLabelValue("Engine hours", metadataValue(layout, "Engine hours"), PAGE_MARGIN + 10, y - 48, 92);
    drawLabelValue("Operator", metadataValue(layout, "Operator"), PAGE_MARGIN + 120, y - 48, 225);
    drawLabelValue("Service intervals", metadataValue(layout, "Intervals selected"), PAGE_MARGIN + 10, y - 81, detailsWidth - 20, { maxLines: 3, valueSize: 8.5 });

    const summaryX = PAGE_MARGIN + detailsWidth;
    page.drawRectangle({ x: summaryX, y: y - 22, width: summaryWidth, height: 22, color: pale });
    page.drawText("SERVICE SUMMARY", { x: summaryX + 9, y: y - 15, size: 7.3, font: bold, color: green });
    const stats = [
      ["Done", layout.summary.done],
      ["Deferred", layout.summary.deferred],
      ["Not applicable", layout.summary.not_applicable],
      ["To-do list", layout.summary.followUp],
    ];
    stats.forEach(([label, value], index) => {
      const baseline = y - 38 - index * 15;
      page.drawText(label, { x: summaryX + 9, y: baseline, size: 8, font: regular, color: muted });
      drawRight(String(value), PAGE_MARGIN + CONTENT_WIDTH - 9, baseline, 9, bold, ink);
    });
    y -= height + 9;

    const outstanding = layout.outcome !== "Finalised";
    page.drawRectangle({ x: PAGE_MARGIN, y: y - 29, width: CONTENT_WIDTH, height: 29, color: outstanding ? amberPale : pale, borderColor: outstanding ? amber : greenMid, borderWidth: 0.8 });
    page.drawText(layout.outcome, { x: PAGE_MARGIN + 9, y: y - 19, size: 11, font: bold, color: green });
    drawRight(`Finalised ${layout.finalisedDisplay}`, PAGE_SIZE[0] - PAGE_MARGIN - 9, y - 18, 7.5, regular, muted);
    y -= 39;
  };

  const drawBoomReference = () => {
    const keyLineHeights = layout.boomReference.map((location) => {
      const fittingText = location.fittingLocations === null
        ? "fitting count not recorded"
        : `${location.fittingLocations} fitting locations${location.eachSide ? " each side" : ""}`;
      return wrapText(`${location.label}: ${location.description} | ${location.interval} | ${fittingText}`, regular, 8.3, CONTENT_WIDTH - 16).length * 10;
    });
    const height = 132 + keyLineHeights.reduce((sum, value) => sum + value, 0);
    ensureSpace(height + 30);
    page.drawRectangle({ x: PAGE_MARGIN, y: y - 23, width: CONTENT_WIDTH, height: 23, color: green });
    page.drawText("Boom reference", { x: PAGE_MARGIN + 7, y: y - 16, size: 10.5, font: bold, color: white });
    y -= 23;
    page.drawText(`${safePdfText(descriptor.businessName || "Pallathorpe Enterprises")} boom reference - not to scale`, { x: PAGE_MARGIN + 7, y: y - 15, size: 7.8, font: regular, color: muted });
    const centerX = PAGE_SIZE[0] / 2;
    const boomY = y - 68;
    const label = (value, x, labelY) => {
      page.drawRectangle({ x: x - 9, y: labelY - 5, width: 18, height: 18, color: pale, borderColor: greenMid, borderWidth: 0.8 });
      page.drawText(value, { x: x - 3.2, y: labelY, size: 8.5, font: bold, color: green });
    };
    page.drawLine({ start: { x: 71, y: boomY }, end: { x: centerX - 30, y: boomY }, thickness: 2, color: greenMid });
    page.drawLine({ start: { x: centerX + 30, y: boomY }, end: { x: 524, y: boomY }, thickness: 2, color: greenMid });
    page.drawLine({ start: { x: 71, y: boomY }, end: { x: 48, y: boomY - 10 }, thickness: 1.5, color: greenMid });
    page.drawLine({ start: { x: 524, y: boomY }, end: { x: 547, y: boomY - 10 }, thickness: 1.5, color: greenMid });
    page.drawRectangle({ x: centerX - 30, y: boomY - 12, width: 60, height: 24, color: pale, borderColor: greenMid, borderWidth: 1 });
    page.drawLine({ start: { x: centerX - 15, y: boomY + 12 }, end: { x: centerX - 24, y: boomY + 31 }, thickness: 1.5, color: greenMid });
    page.drawLine({ start: { x: centerX + 15, y: boomY + 12 }, end: { x: centerX + 24, y: boomY + 31 }, thickness: 1.5, color: greenMid });
    label("A", centerX, boomY - 34);
    label("B", centerX - 128, boomY + 14);
    label("B", centerX + 128, boomY + 14);
    label("C", 71, boomY + 14);
    label("C", 524, boomY + 14);
    label("D", centerX, boomY + 39);
    y -= 119;
    layout.boomReference.forEach((location) => {
      const fittingText = location.fittingLocations === null
        ? "fitting count not recorded"
        : `${location.fittingLocations} fitting locations${location.eachSide ? " each side" : ""}`;
      const lines = wrapText(`${location.label}: ${location.description} | ${location.interval} | ${fittingText}`, regular, 8.3, CONTENT_WIDTH - 16);
      lines.forEach((line, index) => page.drawText(safePdfText(line), { x: PAGE_MARGIN + 8, y: y - index * 10, size: 8.3, font: index ? regular : bold, color: ink }));
      y -= lines.length * 10 + 2;
    });
    y -= 8;
  };

  const drawNarrativeBox = (title, content, { warning = false } = {}) => {
    const textLines = wrapText(content, regular, 9, CONTENT_WIDTH - 20);
    const remaining = textLines.length ? [...textLines] : [""];
    let continued = false;
    while (remaining.length) {
      const headerHeight = 29;
      const bottomPadding = 10;
      const availableHeight = y - PAGE_BOTTOM;
      const maximumLines = Math.floor((availableHeight - headerHeight - bottomPadding) / 11);
      if (maximumLines < 1) {
        addPage();
        continued = true;
        continue;
      }
      const pageLines = remaining.splice(0, maximumLines);
      const height = headerHeight + pageLines.length * 11 + bottomPadding;
      page.drawRectangle({ x: PAGE_MARGIN, y: y - height, width: CONTENT_WIDTH, height, color: warning ? amberPale : stripe, borderColor: warning ? amber : rule, borderWidth: 0.7 });
      page.drawText(`${title}${continued ? " - continued" : ""}`, { x: PAGE_MARGIN + 9, y: y - 17, size: 9.5, font: bold, color: green });
      pageLines.forEach((line, index) => page.drawText(safePdfText(line), { x: PAGE_MARGIN + 9, y: y - 34 - index * 11, size: 9, font: regular, color: ink }));
      y -= height + 8;
      if (remaining.length) {
        addPage();
        continued = true;
      }
    }
  };

  const drawNotes = () => {
    if (layout.overallNotes) drawNarrativeBox("Overall notes", layout.overallNotes);
    if (layout.amendmentReason) drawNarrativeBox(`Amended - Revision ${descriptor.revision}`, layout.amendmentReason, { warning: true });
    const entries = presentationAppendix(layout.appendix);
    if (entries.length) {
      const preparedEntries = entries.map((entry) => {
        const taskNames = entry.taskLabels.join(" / ");
        const heading = `${taskNames} - ${entry.label}`;
        const headingLines = wrapText(heading, bold, 8.8, CONTENT_WIDTH - 16);
        const bodyLines = wrapText(entry.text, regular, 8.8, CONTENT_WIDTH - 24);
        const height = headingLines.length * 10.5 + bodyLines.length * 10.5 + 13;
        return { entry, headingLines, bodyLines, height };
      });
      const groups = [];
      for (const prepared of preparedEntries) {
        const key = prepared.entry.taskLabels.join("\u0000");
        const prior = groups.at(-1);
        if (prior?.key === key) prior.entries.push(prepared);
        else groups.push({ key, entries: [prepared] });
      }
      const groupHeight = (group) => group.entries.reduce((total, entry) => total + entry.height + 4, 0);
      const drawAppendixHeader = (continued = false) => {
        page.drawRectangle({ x: PAGE_MARGIN, y: y - 23, width: CONTENT_WIDTH, height: 23, color: green });
        page.drawText(`Notes and to-do list${continued ? " - continued" : ""}`, {
          x: PAGE_MARGIN + 7,
          y: y - 16,
          size: continued ? 9.5 : 10.5,
          font: bold,
          color: white,
        });
        y -= 31;
      };
      const drawAppendixEntry = ({ headingLines, bodyLines, height }) => {
        page.drawRectangle({ x: PAGE_MARGIN, y: y - height, width: CONTENT_WIDTH, height, color: stripe, borderColor: rule, borderWidth: 0.5 });
        headingLines.forEach((line, index) => page.drawText(safePdfText(line), { x: PAGE_MARGIN + 8, y: y - 13 - index * 10.5, size: 8.8, font: bold, color: green }));
        const bodyTop = y - 13 - headingLines.length * 10.5;
        bodyLines.forEach((line, index) => page.drawText(safePdfText(line), { x: PAGE_MARGIN + 12, y: bodyTop - index * 10.5, size: 8.8, font: regular, color: ink }));
        y -= height + 4;
      };

      if (y - 31 - groupHeight(groups[0]) < PAGE_BOTTOM) addPage();
      drawAppendixHeader();
      for (const group of groups) {
        if (y - groupHeight(group) < PAGE_BOTTOM) {
          addPage();
          drawAppendixHeader(true);
        }
        for (const entry of group.entries) drawAppendixEntry(entry);
      }
    }
  };

  addPage({ first: true });
  drawOverview();
  for (const section of layout.sections) {
    if (section.id === "boom" && layout.boomReference.length) drawBoomReference();
    drawSectionHeader(section.id === "boom" ? "Boom lubrication" : section.title);
    section.tasks.forEach(drawTaskRow);
    y -= 9;
  }
  drawNotes();

  const closingLines = [
    `Finalised: ${layout.finalisedDisplay}`,
    `Copy generated: ${formatTimestamp(descriptor.generatedAt)}`,
  ];
  ensureSpace(88);
  y -= 10;
  closingLines.forEach((line, index) => page.drawText(safePdfText(line), { x: PAGE_MARGIN, y: y - index * 12, size: 8, font: regular, color: muted }));
  y -= 31;
  const disclaimerLines = wrapText(layout.disclaimer, regular, 7.8, CONTENT_WIDTH - 18);
  const disclaimerHeight = disclaimerLines.length * 9.5 + 14;
  page.drawRectangle({ x: PAGE_MARGIN, y: y - disclaimerHeight, width: CONTENT_WIDTH, height: disclaimerHeight, color: pale });
  disclaimerLines.forEach((line, index) => page.drawText(safePdfText(line), { x: PAGE_MARGIN + 8, y: y - 11 - index * 9.5, size: 7.8, font: regular, color: muted }));

  const pages = document.getPages();
  pages.forEach((pdfPage, index) => {
    pdfPage.drawLine({ start: { x: PAGE_MARGIN, y: 39 }, end: { x: PAGE_SIZE[0] - PAGE_MARGIN, y: 39 }, thickness: 0.45, color: rule });
    pdfPage.drawText(`${safePdfText(descriptor.businessName || "Pallathorpe Enterprises")} personal workshop record`, { x: PAGE_MARGIN, y: 25, size: 7.2, font: regular, color: muted });
    const revisionText = `Revision ${descriptor.revision}`;
    const pageText = `Page ${index + 1} of ${pages.length}`;
    pdfPage.drawText(revisionText, {
      x: PAGE_SIZE[0] - PAGE_MARGIN - 68 - regular.widthOfTextAtSize(revisionText, 7.2),
      y: 25,
      size: 7.2,
      font: regular,
      color: muted,
    });
    pdfPage.drawText(pageText, {
      x: PAGE_SIZE[0] - PAGE_MARGIN - regular.widthOfTextAtSize(pageText, 7.2),
      y: 25,
      size: 7.2,
      font: regular,
      color: muted,
    });
  });
  return document.save({ useObjectStreams: false });
}

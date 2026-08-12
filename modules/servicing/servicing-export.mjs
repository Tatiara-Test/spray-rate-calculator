import { loadPdfLib } from "../pdf-lib-loader.mjs";
import {
  SERVICING_RECORD_TITLE,
  buildServicingLayout4830,
} from "./servicing-layout-4830.mjs";

const PAGE_SIZE = Object.freeze([595.28, 841.89]);
const PAGE_MARGIN = 36;

function safePdfText(value) {
  return String(value ?? "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u2022/g, "-")
    .replace(/[^\x20-\x7E\n]/g, "?");
}

function filenameHours(value) {
  return String(value)
    .replace(/[^0-9.]+/g, "")
    .replaceAll(".", "-") || "hours-not-recorded";
}

export function servicingExportDescriptor(record, generatedAt = new Date().toISOString()) {
  const revision = Number(record?.revision);
  const serviceDate = String(record?.serviceDate || "");
  if (!Number.isInteger(revision) || revision < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
    throw new TypeError("A service date and record revision are required for export.");
  }
  return Object.freeze({
    title: SERVICING_RECORD_TITLE,
    generatedAt,
    serviceDate,
    revision,
    filename: `pallathorpe_4830_service_${serviceDate}_${filenameHours(record.engineHours)}h_rev-${revision}.pdf`,
  });
}

export function buildServicingPdfContentLines(record, descriptor) {
  const layout = buildServicingLayout4830(record);
  const lines = [
    { kind: "brand", text: layout.title },
    { kind: "identity", text: layout.recordIdentity },
    { kind: "outcome", text: layout.outcome },
    ...layout.metadata.map(([label, value]) => ({ kind: "meta", text: `${label}: ${value}` })),
  ];
  for (const section of layout.sections) {
    lines.push({ kind: "section", text: section.title });
    for (const task of section.tasks) {
      lines.push({ kind: "task", text: `${task.id} | ${task.interval} | ${task.stateLabel}` });
      lines.push({ kind: "task-label", text: task.label });
      if (task.boomLocationLabels.length) {
        lines.push({ kind: "detail", text: `Boom locations: ${task.boomLocationLabels.join(", ")}` });
      }
    }
  }
  if (layout.boomReference.length) {
    lines.push({ kind: "section", text: "Boom reference - record snapshot" });
    lines.push({ kind: "boom-diagram", text: "Pallathorpe Enterprises boom reference - not to scale", locations: layout.boomReference });
    for (const location of layout.boomReference) {
      const fittingText = location.fittingLocations === null
        ? "fitting count not recorded"
        : `${location.fittingLocations} fitting locations${location.eachSide ? " each side" : ""}`;
      lines.push({ kind: "detail", text: `${location.label}: ${location.description} | ${location.interval} | ${fittingText}` });
    }
  }
  if (layout.overallNotes) lines.push({ kind: "overall-note", text: `Overall notes: ${layout.overallNotes}` });
  if (layout.amendmentReason) lines.push({ kind: "amendment", text: `Amendment reason: ${layout.amendmentReason}` });
  if (layout.appendix.length) {
    lines.push({ kind: "appendix", text: "Notes, reasons and follow-ups" });
    for (const entry of layout.appendix) {
      lines.push({ kind: "appendix-entry", text: `${entry.taskId} | ${entry.label}: ${entry.text}` });
    }
  }
  lines.push({ kind: "generated", text: `Copy generated: ${descriptor.generatedAt}` });
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

export async function buildServicingPdf(record, descriptor, pdfLib = null) {
  const layout = buildServicingLayout4830(record);
  const lines = buildServicingPdfContentLines(record, descriptor);
  const resolvedPdfLib = pdfLib || await loadPdfLib();
  if (!resolvedPdfLib?.PDFDocument || !resolvedPdfLib?.StandardFonts || !resolvedPdfLib?.rgb) {
    throw new Error("The offline PDF generator is unavailable.");
  }
  const { PDFDocument, StandardFonts, rgb } = resolvedPdfLib;
  const document = await PDFDocument.create();
  document.setTitle(SERVICING_RECORD_TITLE);
  document.setAuthor("Pallathorpe Enterprises");
  document.setSubject(`${layout.outcome} | ${layout.recordIdentity}`);
  const generatedDate = new Date(descriptor.generatedAt);
  if (!Number.isNaN(generatedDate.getTime())) {
    document.setCreationDate(generatedDate);
    document.setModificationDate(generatedDate);
  }
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const green = rgb(0.14, 0.42, 0.22);
  const ink = rgb(0.09, 0.14, 0.11);
  const muted = rgb(0.36, 0.41, 0.37);
  const pale = rgb(0.93, 0.96, 0.92);
  let page;
  let y;

  const addPage = () => {
    page = document.addPage(PAGE_SIZE);
    page.drawText("Pallathorpe Enterprises", { x: PAGE_MARGIN, y: 812, size: 10, font: bold, color: green });
    page.drawText("4830 Service Record", { x: PAGE_MARGIN, y: 796, size: 16, font: bold, color: ink });
    page.drawText(safePdfText(layout.recordIdentity), { x: PAGE_MARGIN, y: 780, size: 8, font: regular, color: muted });
    page.drawLine({ start: { x: PAGE_MARGIN, y: 772 }, end: { x: 559, y: 772 }, thickness: 1, color: green });
    y = 754;
  };

  const ensureSpace = (height) => {
    if (y - height < 44) addPage();
  };

  const writeWrapped = (content, {
    size = 9,
    font = regular,
    color = ink,
    indent = 0,
    leading = 4,
    after = 0,
  } = {}) => {
    const width = PAGE_SIZE[0] - PAGE_MARGIN * 2 - indent;
    const wrapped = wrapText(content, font, size, width);
    for (const line of wrapped) {
      ensureSpace(size + leading);
      if (line) page.drawText(line, { x: PAGE_MARGIN + indent, y, size, font, color });
      y -= size + leading;
    }
    y -= after;
  };

  const drawBoomDiagram = (line) => {
    ensureSpace(112);
    const centerX = PAGE_SIZE[0] / 2;
    const boomY = y - 48;
    const label = (value, x, labelY) => {
      page.drawRectangle({ x: x - 8, y: labelY - 5, width: 16, height: 16, color: pale, borderColor: green, borderWidth: 0.8 });
      page.drawText(value, { x: x - 3.2, y: labelY, size: 8, font: bold, color: green });
    };
    page.drawText(line.text, { x: PAGE_MARGIN + 8, y: y - 5, size: 8, font: regular, color: muted });
    page.drawLine({ start: { x: 70, y: boomY }, end: { x: centerX - 28, y: boomY }, thickness: 2.1, color: green });
    page.drawLine({ start: { x: centerX + 28, y: boomY }, end: { x: 525, y: boomY }, thickness: 2.1, color: green });
    page.drawLine({ start: { x: 70, y: boomY }, end: { x: 46, y: boomY - 10 }, thickness: 1.6, color: green });
    page.drawLine({ start: { x: 525, y: boomY }, end: { x: 549, y: boomY - 10 }, thickness: 1.6, color: green });
    page.drawRectangle({ x: centerX - 28, y: boomY - 11, width: 56, height: 22, color: pale, borderColor: green, borderWidth: 1 });
    page.drawLine({ start: { x: centerX - 14, y: boomY + 10 }, end: { x: centerX - 23, y: boomY + 29 }, thickness: 1.5, color: green });
    page.drawLine({ start: { x: centerX + 14, y: boomY + 10 }, end: { x: centerX + 23, y: boomY + 29 }, thickness: 1.5, color: green });
    label("A", centerX, boomY - 31);
    label("B", centerX - 125, boomY + 12);
    label("B", centerX + 125, boomY + 12);
    label("C", 70, boomY + 12);
    label("C", 525, boomY + 12);
    label("D", centerX, boomY + 35);
    y -= 104;
  };

  addPage();
  for (const line of lines) {
    if (line.kind === "brand") continue;
    if (line.kind === "identity") continue;
    if (line.kind === "outcome") {
      ensureSpace(40);
      page.drawRectangle({
        x: PAGE_MARGIN,
        y: y - 24,
        width: PAGE_SIZE[0] - PAGE_MARGIN * 2,
        height: 32,
        color: pale,
        borderColor: green,
        borderWidth: 0.7,
      });
      page.drawText(line.text, { x: PAGE_MARGIN + 8, y: y - 11, size: 12, font: bold, color: green });
      y -= 40;
    } else if (line.kind === "section") {
      ensureSpace(34);
      y -= 4;
      page.drawRectangle({ x: PAGE_MARGIN, y: y - 15, width: PAGE_SIZE[0] - PAGE_MARGIN * 2, height: 23, color: pale });
      writeWrapped(line.text, { size: 11, font: bold, color: green, indent: 7, after: 5 });
    } else if (line.kind === "boom-diagram") {
      drawBoomDiagram(line);
    } else if (line.kind === "task") {
      ensureSpace(34);
      writeWrapped(line.text, { size: 8.5, font: bold, after: 1 });
    } else if (line.kind === "task-label") {
      writeWrapped(line.text, { size: 9.5, indent: 10, after: 5 });
    } else if (line.kind === "appendix") {
      ensureSpace(34);
      writeWrapped(line.text, { size: 13, font: bold, color: green, after: 7 });
    } else if (line.kind === "appendix-entry") {
      writeWrapped(line.text, { size: 9, indent: 8, after: 7 });
    } else if (line.kind === "disclaimer") {
      ensureSpace(52);
      page.drawRectangle({ x: PAGE_MARGIN, y: y - 34, width: PAGE_SIZE[0] - PAGE_MARGIN * 2, height: 42, color: pale });
      writeWrapped(line.text, { size: 8, color: muted, indent: 7, after: 3 });
    } else if (["overall-note", "amendment"].includes(line.kind)) {
      writeWrapped(line.text, { size: 9, font: bold, after: 7 });
    } else {
      writeWrapped(line.text, { size: line.kind === "meta" ? 9 : 8.5, color: line.kind === "generated" ? muted : ink, after: 2 });
    }
  }

  const pages = document.getPages();
  pages.forEach((pdfPage, index) => {
    pdfPage.drawText(`Page ${index + 1} of ${pages.length}`, {
      x: pdfPage.getWidth() - PAGE_MARGIN - 58,
      y: 22,
      size: 8,
      font: regular,
      color: muted,
    });
  });
  return document.save({ useObjectStreams: false });
}

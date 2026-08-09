import { formatLongDate, getFortnightDates } from "./work-notes-logic.mjs";
import { loadPdfLib } from "./pdf-lib-loader.mjs";

const PAGE_SIZE = Object.freeze([595.28, 841.89]);
const PAGE_MARGIN = 42;

function safePdfText(value) {
  return String(value ?? "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u2022/g, "-")
    .replace(/[^\x20-\x7E\n]/g, "?");
}

export function workNotesExportDescriptor(
  startIso,
  generatedAt = new Date().toISOString(),
) {
  const dates = getFortnightDates(startIso);
  const endIso = dates.at(-1);
  const base = `pallathorpe-work-notes_${startIso}_to_${endIso}`;
  return {
    startIso,
    endIso,
    generatedAt,
    filenames: {
      pdf: `${base}.pdf`,
      text: `${base}.txt`,
    },
  };
}

export function buildWorkNotesPdfContentLines(data, descriptor) {
  const dates = getFortnightDates(descriptor.startIso);
  const lines = [
    { kind: "brand", text: "Pallathorpe Enterprises" },
    { kind: "heading", text: "Work Notes" },
    {
      kind: "meta",
      text: `Fortnight: ${formatLongDate(descriptor.startIso)} to ${formatLongDate(descriptor.endIso)}`,
    },
    { kind: "meta", text: `Generated: ${descriptor.generatedAt}` },
  ];

  for (const date of dates) {
    const note = data?.notes?.[date]?.text?.trim() || "(No note recorded)";
    lines.push({ kind: "day", text: formatLongDate(date) });
    lines.push({ kind: "note", text: note });
  }

  return lines.map((line) => ({ ...line, text: safePdfText(line.text) }));
}

function splitWord(word, font, size, maxWidth) {
  const chunks = [];
  let chunk = "";
  for (const character of word) {
    const candidate = `${chunk}${character}`;
    if (chunk && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      chunks.push(chunk);
      chunk = character;
    } else {
      chunk = candidate;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function wrapParagraph(paragraph, font, size, maxWidth) {
  if (!paragraph) return [""];
  const wrapped = [];
  let current = "";
  for (const sourceWord of paragraph.split(/\s+/)) {
    const words = font.widthOfTextAtSize(sourceWord, size) > maxWidth
      ? splitWord(sourceWord, font, size, maxWidth)
      : [sourceWord];
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (!current || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        wrapped.push(current);
        current = word;
      }
    }
  }
  if (current) wrapped.push(current);
  return wrapped;
}

export async function buildWorkNotesPdf(
  data,
  descriptor,
  pdfLib = null,
) {
  const resolvedPdfLib = pdfLib || await loadPdfLib();
  if (!resolvedPdfLib?.PDFDocument || !resolvedPdfLib?.StandardFonts || !resolvedPdfLib?.rgb) {
    throw new Error("The offline PDF generator is unavailable.");
  }

  const { PDFDocument, StandardFonts, rgb } = resolvedPdfLib;
  const document = await PDFDocument.create();
  document.setTitle(`Pallathorpe Work Notes ${descriptor.startIso} to ${descriptor.endIso}`);
  document.setAuthor("Pallathorpe Enterprises");
  document.setSubject("Fortnightly work notes");
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let page = document.addPage(PAGE_SIZE);
  let y = page.getHeight() - PAGE_MARGIN;

  const addPage = () => {
    page = document.addPage(PAGE_SIZE);
    y = page.getHeight() - PAGE_MARGIN;
  };

  const writeWrapped = (content, options = {}) => {
    const size = options.size || 10;
    const font = options.bold ? bold : regular;
    const colour = options.colour || rgb(0.09, 0.14, 0.11);
    const indent = options.indent || 0;
    const maxWidth = page.getWidth() - PAGE_MARGIN * 2 - indent;
    const paragraphs = content.split("\n");
    for (const paragraph of paragraphs) {
      for (const line of wrapParagraph(paragraph, font, size, maxWidth)) {
        if (y < PAGE_MARGIN + 28) addPage();
        if (line) {
          page.drawText(line, {
            x: PAGE_MARGIN + indent,
            y,
            size,
            font,
            color: colour,
          });
        }
        y -= size + (options.leading || 5);
      }
    }
    y -= options.after || 0;
  };

  for (const line of buildWorkNotesPdfContentLines(data, descriptor)) {
    if (line.kind === "brand") {
      writeWrapped(line.text, {
        size: 12,
        bold: true,
        colour: rgb(0.14, 0.42, 0.22),
        after: 2,
      });
    } else if (line.kind === "heading") {
      writeWrapped(line.text, { size: 22, bold: true, after: 7 });
    } else if (line.kind === "day") {
      if (y < PAGE_MARGIN + 64) addPage();
      writeWrapped(line.text, {
        size: 11,
        bold: true,
        colour: rgb(0.14, 0.42, 0.22),
        after: 1,
      });
    } else if (line.kind === "note") {
      writeWrapped(line.text, { size: 10, indent: 10, after: 8 });
    } else {
      writeWrapped(line.text, { size: 10, after: 2 });
    }
  }

  const pages = document.getPages();
  pages.forEach((pdfPage, index) => {
    pdfPage.drawText(`Page ${index + 1} of ${pages.length}`, {
      x: pdfPage.getWidth() - PAGE_MARGIN - 58,
      y: 22,
      size: 8,
      font: regular,
      color: rgb(0.36, 0.41, 0.37),
    });
  });

  return document.save({ useObjectStreams: false });
}

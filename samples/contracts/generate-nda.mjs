// Renders the Common Paper Mutual NDA (CC BY 4.0) with a fictional cover page into a PDF
// with a real text layer. Run with: node samples/contracts/generate-nda.mjs
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { nda, standardTermsClauses } from "./nda-model.mjs";

const outDir = path.dirname(fileURLToPath(import.meta.url));

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 56;
const INK = rgb(0.1, 0.1, 0.1);
const GREY = rgb(0.4, 0.4, 0.4);

function displayDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]} ${y}`;
}

function addYears(iso, years) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y + years}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function wrap(text, font, size, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function main() {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;
  const contentWidth = PAGE_WIDTH - MARGIN * 2;

  function newPage() {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  }

  function ensureSpace(needed) {
    if (y - needed < MARGIN) newPage();
  }

  function text(str, x, size, font, color = INK) {
    page.drawText(str, { x, y, size, font, color });
  }

  function heading(str, size = 12) {
    ensureSpace(size + 10);
    text(str, MARGIN, size, bold);
    y -= size + 8;
  }

  function label(str) {
    ensureSpace(11);
    text(str, MARGIN, 8, italic, GREY);
    y -= 11;
  }

  function value(str, size = 11) {
    for (const line of wrap(str, regular, size, contentWidth)) {
      ensureSpace(size + 6);
      text(line, MARGIN, size, regular);
      y -= size + 6;
    }
  }

  // Cover page
  heading(nda.title, 18);
  y -= 4;

  label("Purpose — how Confidential Information may be used");
  value(nda.purpose);

  label("Effective Date");
  value(displayDate(nda.effectiveDate));

  label("MNDA Term");
  value(`Expires ${nda.mndaTermYears} year(s) from Effective Date, i.e. ${displayDate(addYears(nda.effectiveDate, nda.mndaTermYears))}.`);

  label("Term of Confidentiality");
  value(
    `${nda.confidentialityTermYears} year(s) from Effective Date, i.e. ${displayDate(addYears(nda.effectiveDate, nda.confidentialityTermYears))}, but in the case of trade secrets until Confidential Information is no longer a trade secret under applicable law.`,
  );

  label("Governing Law");
  value(nda.governingLaw);

  label("Jurisdiction");
  value(nda.jurisdiction);

  y -= 10;
  ensureSpace(14);
  text("By signing this Cover Page, each party agrees to enter into this MNDA as of the Effective Date.", MARGIN, 9, italic, GREY);
  y -= 26;

  // Signature block, two columns
  const colWidth = contentWidth / 2 - 10;
  const col2X = MARGIN + colWidth + 20;
  const rows = [
    ["Print Name", (p) => p.signerName],
    ["Title", (p) => p.title],
    ["Company", (p) => p.name],
    ["Notice Address", (p) => p.noticeAddress],
    ["Date", (p) => displayDate(p.signedDate)],
  ];
  ensureSpace(20 * rows.length + 20);
  text("PARTY 1", MARGIN, 9, bold);
  text("PARTY 2", col2X, 9, bold);
  y -= 18;
  for (const [rowLabel, get] of rows) {
    text(rowLabel, MARGIN, 8, italic, GREY);
    text(rowLabel, col2X, 8, italic, GREY);
    y -= 11;
    text(get(nda.parties[0]), MARGIN, 10, regular);
    text(get(nda.parties[1]), col2X, 10, regular);
    y -= 18;
  }

  y -= 10;
  ensureSpace(10);
  text(
    "Common Paper Mutual Non-Disclosure Agreement (Version 1.0), commonpaper.com/standards/mutual-nda/1.0, free to use under CC BY 4.0.",
    MARGIN,
    7,
    italic,
    GREY,
  );

  // Standard Terms
  newPage();
  heading("Standard Terms", 14);
  for (const clause of standardTermsClauses) {
    ensureSpace(24);
    text(clause.heading, MARGIN, 10, bold);
    y -= 14;
    const lines = wrap(clause.body, regular, 9.5, contentWidth);
    for (const line of lines) {
      ensureSpace(13);
      text(line, MARGIN, 9.5, regular);
      y -= 13;
    }
    y -= 8;
  }

  const bytes = await pdf.save();
  const outPath = path.join(outDir, "common-paper-mutual-nda.pdf");
  await writeFile(outPath, bytes);
  console.log("wrote", outPath);
}

main();

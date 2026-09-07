// Renders each invoice in models.mjs to a PDF with a real text layer (no screenshot, no
// scan). Run with: node samples/invoices/generate.mjs
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { invoices } from "./models.mjs";

const outDir = path.dirname(fileURLToPath(import.meta.url));

const PAGE_WIDTH = 612; // US Letter
const PAGE_HEIGHT = 792;
const MARGIN = 50;
const INK = rgb(0.1, 0.1, 0.1);
const GREY = rgb(0.4, 0.4, 0.4);

function money(n) {
  return n.toFixed(2);
}

function displayDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]} ${y}`;
}

async function renderInvoice(model) {
  const pdf = await PDFDocument.create();
  const regularFont = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  function text(str, x, y, { font = regularFont, size = 10, color = INK, align = "left" } = {}) {
    const width = font.widthOfTextAtSize(str, size);
    const drawX = align === "right" ? x - width : align === "center" ? x - width / 2 : x;
    page.drawText(str, { x: drawX, y, font, size, color });
    return width;
  }

  let y = PAGE_HEIGHT - MARGIN;

  // Seller header
  text(model.seller.name, MARGIN, y, { font: boldFont, size: 16 });
  y -= 18;
  for (const line of model.seller.address) {
    text(line, MARGIN, y, { size: 9, color: GREY });
    y -= 12;
  }

  // Invoice meta, right aligned
  const rightX = PAGE_WIDTH - MARGIN;
  let metaY = PAGE_HEIGHT - MARGIN;
  text("INVOICE", rightX, metaY, { font: boldFont, size: 11, align: "right" });
  metaY -= 14;
  text(`No. ${model.invoiceNumber}`, rightX, metaY, { size: 9, align: "right" });
  metaY -= 12;
  text(`Issued ${displayDate(model.issueDate)}`, rightX, metaY, { size: 9, align: "right" });
  metaY -= 12;
  text(`Due ${displayDate(model.dueDate)}`, rightX, metaY, { size: 9, align: "right" });

  y -= 22;

  // Bill to
  text("Bill to", MARGIN, y, { size: 9, color: GREY });
  y -= 12;
  text(model.buyer.name, MARGIN, y, { size: 10 });
  y -= 12;
  for (const line of model.buyer.address) {
    text(line, MARGIN, y, { size: 9, color: GREY });
    y -= 12;
  }

  y -= 14;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: rightX, y }, thickness: 1, color: INK });
  y -= 14;

  // Line item table header
  const colDesc = MARGIN;
  const colQty = rightX - 220;
  const colUnit = rightX - 140;
  const colTotal = rightX;
  text("Description", colDesc, y, { size: 8, color: GREY });
  text("Qty", colQty, y, { size: 8, color: GREY, align: "right" });
  text("Unit", colUnit, y, { size: 8, color: GREY, align: "right" });
  text("Total", colTotal, y, { size: 8, color: GREY, align: "right" });
  y -= 10;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: rightX, y }, thickness: 0.5, color: GREY });
  y -= 16;

  for (const item of model.lineItems) {
    text(item.description, colDesc, y, { size: 10 });
    text(String(item.quantity), colQty, y, { size: 10, align: "right" });
    text(money(item.unitPrice), colUnit, y, { size: 10, align: "right" });
    text(money(item.lineTotal), colTotal, y, { size: 10, align: "right" });
    y -= 20;
  }

  y -= 6;
  page.drawLine({ start: { x: colUnit - 90, y }, end: { x: rightX, y }, thickness: 0.5, color: GREY });
  y -= 16;

  text("Subtotal", colUnit - 90, y, { size: 10, color: GREY });
  text(money(model.subtotal), colTotal, y, { size: 10, align: "right" });
  y -= 16;

  if (model.discount) {
    text("Discount", colUnit - 90, y, { size: 10, color: GREY });
    text(`-${money(model.discount)}`, colTotal, y, { size: 10, align: "right" });
    y -= 16;
  }

  text(`Tax ${(model.taxRate * 100).toFixed(2).replace(/\.00$/, "")}%`, colUnit - 90, y, { size: 10, color: GREY });
  text(money(model.taxAmount), colTotal, y, { size: 10, align: "right" });
  y -= 18;

  text(`Total ${model.currency}`, colUnit - 90, y, { font: boldFont, size: 11 });
  text(money(model.total), colTotal, y, { font: boldFont, size: 11, align: "right" });
  y -= 30;

  text(model.paymentTerms, MARGIN, y, { size: 8, color: GREY });

  return pdf.save();
}

async function main() {
  for (const model of invoices) {
    const bytes = await renderInvoice(model);
    const outPath = path.join(outDir, `${model.id}.pdf`);
    await writeFile(outPath, bytes);
    console.log("wrote", outPath);
  }
}

main();

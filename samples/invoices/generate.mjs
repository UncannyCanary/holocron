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

// The marketplace layout: a Tax Invoice heading, seller with GSTIN, order and
// invoice numbers, Bill To beside Ship To, and a wide line table with gross,
// discount, taxable value, SGST, CGST, and total columns.
async function renderGstInvoice(model) {
  const pdf = await PDFDocument.create();
  const regularFont = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const rightX = PAGE_WIDTH - MARGIN;

  function text(str, x, y, { font = regularFont, size = 9, color = INK, align = "left" } = {}) {
    const width = font.widthOfTextAtSize(str, size);
    const drawX = align === "right" ? x - width : align === "center" ? x - width / 2 : x;
    page.drawText(str, { x: drawX, y, font, size, color });
  }

  let y = PAGE_HEIGHT - MARGIN;
  text("Tax Invoice", PAGE_WIDTH / 2, y, { font: boldFont, size: 13, align: "center" });
  y -= 22;
  text("Sold By:", MARGIN, y, { font: boldFont });
  text(model.seller.name, MARGIN + 46, y, { font: boldFont });
  y -= 13;
  for (const line of model.seller.address) {
    text(line, MARGIN, y, { size: 7.5, color: GREY });
    y -= 11;
  }
  text("GSTIN", MARGIN, y, { font: boldFont });
  text(`- ${model.seller.gstin}`, MARGIN + 34, y);
  y -= 24;

  text("Invoice Number #", rightX - 160, y, { font: boldFont });
  text(model.invoiceNumber, rightX, y, { align: "right" });
  y -= 16;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: rightX, y }, thickness: 1, color: INK });
  y -= 16;

  // Three columns: order details, bill to, ship to.
  const col2 = MARGIN + 165;
  const col3 = MARGIN + 340;
  const top = y;
  text("Order ID:", MARGIN, y, { font: boldFont });
  y -= 12;
  text(model.orderId, MARGIN, y, { font: boldFont });
  y -= 16;
  text("Order Date:", MARGIN, y, { font: boldFont });
  text(model.orderDate, MARGIN + 58, y);
  y -= 16;
  text("Invoice Date:", MARGIN, y, { font: boldFont });
  text(model.invoiceDate, MARGIN + 62, y);
  y -= 16;
  text("PAN:", MARGIN, y, { font: boldFont });
  text(model.seller.pan, MARGIN + 26, y);

  for (const [x, heading] of [
    [col2, "Bill To"],
    [col3, "Ship To"],
  ]) {
    let yy = top;
    text(heading, x, yy, { font: boldFont });
    yy -= 12;
    text(model.buyer.name, x, yy, { font: boldFont });
    yy -= 12;
    for (const line of model.buyer.address) {
      text(line, x, yy, { size: 8 });
      yy -= 11;
    }
  }
  y -= 44;

  text(`Total items: ${model.totals.quantity}`, MARGIN, y);
  y -= 14;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: rightX, y }, thickness: 1, color: INK });
  y -= 14;

  // Column right edges, from the right.
  const cTotal = rightX;
  const cCgst = rightX - 48;
  const cSgst = rightX - 96;
  const cTaxable = rightX - 150;
  const cDiscount = rightX - 206;
  const cGross = rightX - 258;
  const cQty = rightX - 302;
  const cTitle = MARGIN + 82;
  const head = (str, x, align = "right") => text(str, x, y, { font: boldFont, size: 7.5, align });
  head("Product", MARGIN, "left");
  head("Title", cTitle, "left");
  head("Qty", cQty);
  head("Gross", cGross);
  head("Discount", cDiscount);
  head("Taxable Value", cTaxable);
  head("SGST/UTGST", cSgst);
  head("CGST", cCgst);
  head("Total INR", cTotal);
  y -= 8;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: rightX, y }, thickness: 0.5, color: GREY });
  y -= 16;

  for (const item of model.lineItems) {
    if (item.product) {
      text(item.product, MARGIN, y, { size: 8 });
      text(`FSN: ${item.fsn}`, MARGIN, y - 11, { size: 6.5, color: GREY });
      text(`HSN/SAC: ${item.hsn}`, MARGIN, y - 22, { size: 6.5, color: GREY });
    }
    text(item.description, cTitle, y, { font: boldFont, size: 8.5 });
    text(String(item.quantity), cQty, y, { align: "right" });
    text(money(item.gross), cGross, y, { align: "right" });
    text(`-${money(item.discount)}`, cDiscount, y, { align: "right" });
    text(money(item.taxable), cTaxable, y, { align: "right" });
    text(money(item.sgst), cSgst, y, { align: "right" });
    text(money(item.cgst), cCgst, y, { align: "right" });
    text(money(item.lineTotal), cTotal, y, { align: "right" });
    if (item.taxRate) {
      text(`SGST/UTGST: ${item.taxRate}`, cTitle, y - 12, { size: 7.5, color: GREY });
      text(`CGST: ${item.taxRate}`, cTitle, y - 23, { size: 7.5, color: GREY });
      y -= 40;
    } else {
      y -= 18;
    }
  }

  page.drawLine({ start: { x: cTitle, y }, end: { x: rightX, y }, thickness: 0.5, color: GREY });
  y -= 14;
  const t = model.totals;
  text("Total", cTitle + 60, y, { font: boldFont });
  text(String(t.quantity), cQty, y, { font: boldFont, align: "right" });
  text(money(t.gross), cGross, y, { font: boldFont, align: "right" });
  text(`-${money(t.discount)}`, cDiscount, y, { font: boldFont, align: "right" });
  text(money(t.taxable), cTaxable, y, { font: boldFont, align: "right" });
  text(money(t.sgst), cSgst, y, { font: boldFont, align: "right" });
  text(money(t.cgst), cCgst, y, { font: boldFont, align: "right" });
  text(money(t.lineTotal), cTotal, y, { font: boldFont, align: "right" });
  y -= 10;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: rightX, y }, thickness: 1, color: INK });
  y -= 22;

  text("Grand Total", cTaxable - 20, y, { size: 12 });
  text(`INR ${money(model.grandTotal)}`, cTotal, y, { font: boldFont, size: 12, align: "right" });
  y -= 24;
  text(model.seller.name, cTotal, y, { align: "right" });
  y -= 40;
  text("Authorized Signatory", cTotal, y, { align: "right" });

  return pdf.save();
}

async function main() {
  for (const model of invoices) {
    const bytes = model.layout === "gst" ? await renderGstInvoice(model) : await renderInvoice(model);
    const outPath = path.join(outDir, `${model.id}.pdf`);
    await writeFile(outPath, bytes);
    console.log("wrote", outPath);
  }
}

main();

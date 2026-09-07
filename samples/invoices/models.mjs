// The JSON model behind each generated invoice. generate.mjs turns these into PDFs.
// Line item and total figures are typed by hand so expected.json can quote them exactly.

export const invoices = [
  {
    id: "invoice-1-clean",
    seller: { name: "Cedar & Finch Design Studio", address: ["88 Birch Court", "Austin, TX 78701"] },
    buyer: { name: "Marrow Coffee Roasters", address: ["19 Elm Street, Austin"] },
    invoiceNumber: "CF-2031",
    issueDate: "2026-01-12",
    dueDate: "2026-02-11",
    currency: "USD",
    lineItems: [
      { description: "Brand identity package", quantity: 1, unitPrice: 2400.0, lineTotal: 2400.0 },
      { description: "Packaging design, 3 SKUs", quantity: 3, unitPrice: 350.0, lineTotal: 1050.0 },
    ],
    subtotal: 3450.0,
    discount: 150.0,
    taxRate: 0.0825,
    taxAmount: 272.25,
    total: 3572.25,
    paymentTerms: "Net 30. Wire transfer details on file.",
  },
  {
    id: "invoice-2-clean",
    seller: { name: "Northlake Hardware Co.", address: ["4 Dockside Row", "Bristol, UK BS1 4ST"] },
    buyer: { name: "Ferro & Sons Builders", address: ["27 Quay Lane, Bristol"] },
    invoiceNumber: "NH-5588",
    issueDate: "2026-05-06",
    dueDate: "2026-05-20",
    currency: "GBP",
    lineItems: [
      { description: "Galvanised screws, 4mm, box of 200", quantity: 6, unitPrice: 3.2, lineTotal: 19.2 },
      { description: "Timber batten, 2.4m", quantity: 15, unitPrice: 4.75, lineTotal: 71.25 },
      { description: "Exterior wood glue, 500ml", quantity: 4, unitPrice: 6.1, lineTotal: 24.4 },
    ],
    subtotal: 114.85,
    discount: 0,
    taxRate: 0.2,
    taxAmount: 22.97,
    total: 137.82,
    paymentTerms: "Payment due within 14 days of invoice date.",
  },
  {
    id: "invoice-3-planted-error",
    seller: { name: "Acme Supplies", address: ["14 Hollow Way, Suite 2", "Portland, OR 97204"] },
    buyer: { name: "Luna Bakery LLC", address: ["202 Ninth Ave, Portland"] },
    invoiceNumber: "1042",
    issueDate: "2026-03-03",
    dueDate: "2026-04-02",
    currency: "USD",
    lineItems: [
      { description: "Copy paper, A4, box", quantity: 10, unitPrice: 4.5, lineTotal: 45.0 },
      // Planted error: 2 x 60.00 should print as 120.00. The line prints 12.00 instead.
      { description: "Toner cartridge, black", quantity: 2, unitPrice: 60.0, lineTotal: 12.0 },
    ],
    subtotal: 165.0,
    discount: 0,
    taxRate: 0.1,
    taxAmount: 16.5,
    total: 181.5,
    paymentTerms: "Payment within 30 days. Thank you.",
  },
];

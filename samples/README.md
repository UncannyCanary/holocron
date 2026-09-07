Sample documents for local development, tests, and demos.

Every sample has an `expected.json` next to it. The expected file lists the right value for
each field, the page it is on, and the exact quote a grounder should find on the page. Some
also list which checks should pass or fail.

## Invoices (`invoices/`)

Three invoices, written by us. The JSON model for each one is in `models.mjs`. Run
`node samples/invoices/generate.mjs` to render them again.

- `invoice-1-clean.pdf`: everything adds up. Has a discount line.
- `invoice-2-clean.pdf`: everything adds up. Uses pounds instead of dollars, three line
  items, no discount.
- `invoice-3-planted-error.pdf`: the toner line prints 12.00 where 2 times 60.00 should
  print 120.00. The subtotal on the page (165.00) matches the correct line total, not the
  printed one, so the line math check and the subtotal check both fail. This is the same
  scenario as the review screen mockup at
  `.scratch/holocron/design/review-screen/Main.dc.html`.

We own this content. No licence needed.

## Receipts (`receipts/`)

Two photos from CORD v2 (test split, rows 1 and 2), by Park et al., "CORD: A Consolidated
Receipt Dataset for Post-OCR Parsing", Document Intelligence Workshop at NeurIPS 2019.
Licence: CC BY 4.0. Source: `huggingface.co/datasets/naver-clova-ix/cord-v2`.

The dataset authors blur the store name, address, phone number, and timestamp on every
receipt. We picked these two photos by eye from the test split for having nothing else
identifying in frame. Amounts are Indonesian rupiah, which has no decimal places.

## Contracts (`contracts/`)

`cuad-maintenance-agreement.pdf`: one contract from CUAD v1, by Hendrycks et al., "CUAD: An
Expert-Annotated NLP Dataset for Legal Contract Review", 2021. Licence: CC BY 4.0. File:
`CUAD_v1/full_contract_pdf/Part_II/Maintenance/NETZEEINC_11_14_2002-EX-10.3-MAINTENANCE
AGREEMENT.PDF` from the CUAD v1 archive on Zenodo (record 4595826). This is a public SEC
filing, so it may be redistributed. The signature block names two real corporate officers
from that filing; this is public record, but if we ever want the sample set free of every
real name, that block is the one to redact.

This contract has no stated effective date and no stated governing law, on purpose: they
are good test cases for a field the checks need but the document does not have.

`common-paper-mutual-nda.pdf`: the Common Paper Mutual NDA, Version 1.0
(`github.com/CommonPaper/Mutual-NDA`). Licence: CC BY 4.0. We filled in the cover page with
two fictional companies and two fictional people. No real person or company appears
anywhere in this file. The Standard Terms on pages 2 and 3 are the template's wording,
unchanged. The model behind the fill-in values is in `nda-model.mjs`; run
`node samples/contracts/generate-nda.mjs` to render it again.

## Where the receipts and the CUAD contract came from

Both are fetched from public URLs, not committed as generator scripts, since they are
someone else's files:

- Receipts: `datasets-server.huggingface.co/rows?dataset=naver-clova-ix/cord-v2&config=default&split=test&offset=<row>&length=1`
  gives a JSON row with an image URL and a `ground_truth` field. We downloaded the image at
  that URL for rows 1 and 2.
- CUAD contract: the full archive is a 105 MB zip on Zenodo. We only needed one file out of
  510, so we read the zip's central directory over HTTP range requests and pulled out just
  `NETZEEINC_11_14_2002-EX-10.3-MAINTENANCE AGREEMENT.PDF`, about 250 KB of requests in
  total instead of 105 MB.

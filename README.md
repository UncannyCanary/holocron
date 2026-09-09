# Holocron

Holocron reads bookkeeping documents and tells you how far to trust what it read.

You upload invoices, receipts, and contracts. It pulls out the values a bookkeeper needs, such as the vendor, the dates, the line items, and the totals, and puts them in a table you can filter, sort, search, and export. Plenty of tools do that. What Holocron adds is proof: every value shows where on the page it came from, and whether the document's own arithmetic agrees with it.

## The idea

An LLM, a large language model of the kind behind today's chat assistants, can put a number in every box. The hard question is which numbers are right. Holocron answers it three ways, and none of them is "the LLM felt confident".

- **Every value points at the page.** The LLM has to quote the exact words it read. Holocron then looks for those words in its own map of the page, built from the PDF's text or by OCR for a photo, and draws a box around them. If the words are not there, there is no box, and the value is marked unverifiable.
- **Every document checks itself.** Lines have to multiply. Lines have to add up to the subtotal. The subtotal, tax, and discount have to make the total. Dates have to be in order. A contract's parties have to sign it. A failed check marks the value it works out as contradicted and names the values that fed it.
- **A person has the last word.** You can fix any value in place. The fix is saved with the old value, every check runs again, and the badges update. Nothing you type is ever sent back to the LLM.

Each field ends up in one of four states: verified, unverifiable, contradicted, or corrected. Each document rolls those up into one badge, so the queue can put the worst first.

## Running it locally

You need Node 22, pnpm, and Docker.

```
cp .env.example .env
docker compose up -d postgres
pnpm install
pnpm dev
```

The web app is at `http://localhost:5173` and the API at `http://localhost:3000/api`. Add your Anthropic API key to `.env` as `ANTHROPIC_API_KEY` before uploading anything, or the worker cannot read documents. Eight sample documents are read on first start, which takes about a minute and costs about fifty cents.

`docker compose up --build` runs the whole thing the way the server does, with Caddy in front at `http://localhost:8080`.

`pnpm test` runs the tests against their own database, `holocron_test`. A fresh `docker compose up` creates it. On an existing database, run `docker compose exec postgres createdb -U holocron holocron_test` once.

## The limits

Holocron is a small app on one small server, and it spends real money on every document. These limits keep it honest. Each one shows up on screen in plain words when you hit it.

| Limit | Value |
|---|---|
| File size | 10 MB |
| Pages per document | 20 |
| Uploads per workspace | 10 a day |
| New workspaces per address | 3 an hour |
| Requests per address | 240 a minute |
| LLM spend | $15 a month, then documents wait |
| Untouched workspaces | Deleted after 14 days, files included |

There is no sign in and no account creation. One shared access code opens the door, and each browser then gets its own workspace tied to a cookie. The settings page has a link that reopens your workspace on another browser.

## Where things are

- `apps/web` is the React app: Vite, TanStack Router, Query, and Table, Tailwind.
- `apps/api` is the NestJS app. `main.ts` serves the API and `worker.ts` runs the jobs. They share one codebase and one Docker image.
- `packages/shared` holds the Zod schemas, the limits, and the money formatting both sides use.
- `samples/` holds the eight sample documents and their licences.
- `decisions.md` explains why it is built this way. `docs/design.md` explains how: the parts, the tables, and the life of a document.

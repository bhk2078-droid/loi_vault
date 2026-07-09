# LOI Vault

A shared workspace for commercial real estate leasing teams. Buildings hold transactions; transactions hold rounds. Drop a Letter of Intent into a transaction and it becomes the first column of a side-by-side transaction trail. Drop in the next redline and it becomes the next column. Draft a suggested counter by hand and it becomes the last one, shaded where it accepts the other side's position.

## Stack

- Next.js 14 (App Router, TypeScript) on Netlify (`@netlify/plugin-nextjs`)
- Supabase — Postgres, magic-link auth, private file storage, domain-scoped RLS
- Netlify Functions — server-side Claude calls (`extract-loi`, `summarize-round`); the API key never reaches the browser
- Claude for extraction + narrative (model set via `CLAUDE_MODEL`, defaults to `claude-sonnet-4-5`)
- Parsers: `pdf-parse` (.pdf), `mammoth` (.docx), `word-extractor` (legacy .doc)
- Exports built client-side: `@react-pdf/renderer`, `docx`, `exceljs`

## Local development

```bash
npm install
cp .env.example .env.local   # fill in the five values (see DEPLOY.md)
npx netlify dev              # runs Next.js + functions together on :8888
```

`npm run dev` alone runs the UI but not the functions — use `netlify dev` when testing upload/extraction.

## Architecture notes

- **Upload path**: browser → Supabase Storage directly, then the function downloads by path with the service role. This keeps files off Netlify's ~6 MB function payload limit and lets uploads go to 10 MB.
- **Graceful degradation**: extraction never crashes a deal. Whatever fields Claude returns validly are kept (`lib/extraction-schema.ts` → `parseExtraction`); the rest render as empty editable fields with a zero-confidence dot.
- **The trail** (`lib/trail.ts`): versions sort by `version_number` and become columns; `TRAIL_ROWS` fixes the row order — Premises, Term, LCD, RCD, Base Rent, escalations, electricity, landlord's work, furniture, renewal — so the grid, the Excel, the Word doc and the PDF never disagree. Empty rows hide themselves. `DETAIL_ROWS` is the same data grouped by section, for the "All terms" view.
- **Two highlight conventions, and they mean opposite things.** `agreed` shades cells in the final column that match the column before it — that's a suggested counter saying "we'll take this as-is." `moved` shades cells that differ from the column to their left — a plain diff, useful mid-negotiation. The default picks `agreed` when the last column is a hand-drafted counter and `moved` otherwise.
- **Composed rows and overrides.** "Premises" reads `floor` + `rsf` into `Entire 5th Floor: 10,538 RSF`. Cells are edited as free text, since that's how brokers read this grid; where the text maps back onto a structured field it writes the field, and where it can't (a conditional commencement date, a composed row, "market rate" in a number cell) it lands in `cell_overrides` and wins over extraction. Nothing gets silently mangled.
- **Suggested-counter columns** have `source = 'manual'`, no file, no date, and seed from the last proposal so you edit only what you're moving.
- **Editing any column**, not just the newest: extraction errors happen in old rounds too, and a wrong v1 makes every downstream comparison wrong.
- **No browser storage**: all state lives in React state + Supabase, per constraint.
- **UI kit**: `components/ui` are small hand-rolled components following shadcn conventions (no generator dependency); swap in generated shadcn components any time without touching the feature components.

## File map

```
app/                  landing (magic link), dashboard (buildings),
                      building/[id] (transactions), deal/[id] (tracker)
netlify/functions/    extract-loi.ts, summarize-round.ts
components/           transaction-trail, trail-cell, negotiation-log,
                      upload-dropzone, ui/*
lib/                  extraction-schema (Zod), trail (rows, matrix, cell editing),
                      prompts, exports, supabase, utils
supabase/migration.sql
DEPLOY.md             non-technical deployment walkthrough
```

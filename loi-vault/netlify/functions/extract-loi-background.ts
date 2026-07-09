import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { extractionPrompt, EXTRACTION_SYSTEM, CLAUDE_MODEL } from "../../lib/prompts";
import { parseExtraction } from "../../lib/extraction-schema";

// A *background* function. The `-background` suffix is what tells Netlify to
// return 202 immediately and let this run for up to 15 minutes. Synchronous
// functions are capped at 10-30 seconds depending on plan, and a forty-field
// extraction with source quotes routinely runs longer than that.
//
// Flow: the browser uploads the file to Supabase Storage, inserts a
// loi_versions row with status='processing', then invokes this. We fill that
// row in and flip it to 'ready'. The browser polls the row. Nothing depends on
// this function's HTTP response, so the tab can be closed mid-extraction.

async function extractText(buf: Buffer, fileName: string): Promise<string> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) {
    // Import the inner module directly — pdf-parse's index.js runs a
    // debug harness when it can't find a parent module in bundlers.
    const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default as (b: Buffer) => Promise<{ text: string }>;
    const out = await pdfParse(buf);
    return out.text || "";
  }
  if (lower.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const out = await mammoth.extractRawText({ buffer: buf });
    return out.value || "";
  }
  if (lower.endsWith(".doc")) {
    // Legacy Word format — mammoth can't read it.
    const WordExtractor = (await import("word-extractor")).default;
    const extractor = new WordExtractor();
    const doc = await extractor.extract(buf);
    return doc.getBody() || "";
  }
  return buf.toString("utf-8");
}

async function callClaude(loiText: string, roundNumber: number): Promise<unknown> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY || "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 8000,
      system: EXTRACTION_SYSTEM,
      messages: [{ role: "user", content: extractionPrompt(loiText, roundNumber) }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err.slice(0, 400)}`);
  }
  const data = await res.json();
  const text: string = (data.content || [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("\n");
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

export const handler: Handler = async (event) => {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  let versionId = "";
  const fail = async (message: string) => {
    if (versionId) await admin.from("loi_versions").update({ status: "failed", error: message.slice(0, 500) }).eq("id", versionId);
    console.error("extract-loi-background:", message);
    return { statusCode: 202, body: "" };
  };

  let payload: { versionId?: string; storagePath?: string; fileName?: string; versionNumber?: number };
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return fail("Invalid JSON body");
  }

  const { storagePath, fileName, versionNumber } = payload;
  versionId = payload.versionId || "";
  if (!versionId || !storagePath || !fileName || !versionNumber) {
    return fail("versionId, storagePath, fileName and versionNumber are required");
  }

  // 1. Download the file the browser already put in Storage
  const dl = await admin.storage.from("loi-files").download(storagePath);
  if (dl.error || !dl.data) return fail(`Could not read the uploaded file: ${dl.error?.message || "unknown"}`);
  const buf = Buffer.from(await dl.data.arrayBuffer());

  // 2. Extract text. A scanned PDF has none — that's not a failure, it just
  //    means the column arrives empty and gets typed in by hand.
  let loiText = "";
  try {
    loiText = await extractText(buf, fileName);
  } catch (e) {
    loiText = "";
    console.error("text extraction:", e);
  }
  if (loiText.trim().length < 50) {
    await admin
      .from("loi_versions")
      .update({
        status: "ready",
        error: `No readable text in ${fileName} — likely a scanned image. Enter the terms by hand; every cell is editable.`,
        round_label: versionNumber === 1 ? "Initial LOI" : `Counter ${versionNumber - 1}`,
      })
      .eq("id", versionId);
    return { statusCode: 202, body: "" };
  }

  // 3. Call Claude — degrade gracefully rather than losing the column
  let update: Record<string, unknown> = { status: "ready" };
  try {
    const raw = await callClaude(loiText.slice(0, 150_000), versionNumber);

    // document_meta sits outside the term schema (zod strips it), so read it first.
    const meta = (raw as { document_meta?: { round_label?: unknown; party?: unknown; document_date?: unknown } })?.document_meta;
    let roundLabel: string | null = null;
    let party: string | null = null;
    let documentDate: string | null = null;
    if (meta) {
      if (typeof meta.round_label === "string") roundLabel = meta.round_label.slice(0, 60);
      if (meta.party === "Landlord" || meta.party === "Tenant") party = meta.party;
      if (typeof meta.document_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(meta.document_date)) documentDate = meta.document_date;
    }

    const parsed = parseExtraction(raw);
    update = {
      status: "ready",
      extracted_json: parsed.loi,
      round_label: roundLabel || (versionNumber === 1 ? "Initial LOI" : `Counter ${versionNumber - 1}`),
      party,
      document_date: documentDate,
      error: parsed.degraded ? "Some fields could not be extracted — review the column and fill the gaps." : null,
    };
  } catch (e) {
    update = {
      status: "ready",
      round_label: versionNumber === 1 ? "Initial LOI" : `Counter ${versionNumber - 1}`,
      error: `Extraction failed: ${e instanceof Error ? e.message : String(e)}. The column is empty — enter terms by hand.`,
    };
  }

  const { error: updErr } = await admin.from("loi_versions").update(update).eq("id", versionId);
  if (updErr) return fail(`Could not save the extraction: ${updErr.message}`);

  return { statusCode: 202, body: "" };
};

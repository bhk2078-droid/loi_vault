import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { extractionPrompt, EXTRACTION_SYSTEM, CLAUDE_MODEL } from "../../lib/prompts";
import { parseExtraction, emptyLOI } from "../../lib/extraction-schema";

// Flow: the browser uploads the raw file straight to Supabase Storage
// (keeps us under Netlify's ~6MB function payload limit), then calls
// this function with { storagePath, dealId, versionNumber }. We download
// with the service role, extract text, call Claude, and insert the
// loi_versions row. If anything downstream of text extraction fails,
// we still return a usable (empty/partial) extraction — never crash
// the deal.

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

async function extractText(buf: Buffer, fileName: string): Promise<string> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) {
    // Import the inner module directly — pdf-parse's index.js runs a
    // debug harness when it can't find a parent module in bundlers.
    const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default as (
      b: Buffer
    ) => Promise<{ text: string }>;
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
  // Fallback: treat as UTF-8 text
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
    throw new Error(`Claude API ${res.status}: ${err.slice(0, 500)}`);
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
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  let payload: { storagePath?: string; fileName?: string; dealId?: string; versionNumber?: number; uploaderEmail?: string; uploaderId?: string };
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const { storagePath, fileName, dealId, versionNumber, uploaderEmail, uploaderId } = payload;
  if (!storagePath || !dealId || !versionNumber || !fileName) {
    return json(400, { error: "storagePath, fileName, dealId and versionNumber are required" });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1. Download the file the browser already put in Storage
  const dl = await admin.storage.from("loi-files").download(storagePath);
  if (dl.error || !dl.data) {
    return json(500, { error: `Could not read uploaded file: ${dl.error?.message || "unknown"}` });
  }
  const buf = Buffer.from(await dl.data.arrayBuffer());

  // 2. Extract text
  let loiText = "";
  try {
    loiText = await extractText(buf, fileName);
  } catch (e) {
    return json(422, {
      error: `Could not read text from ${fileName}. If this is a scanned/image PDF, extraction is not supported — enter terms manually.`,
      detail: e instanceof Error ? e.message : String(e),
    });
  }
  if (loiText.trim().length < 50) {
    return json(422, {
      error: "The document contains almost no extractable text (likely a scanned image). Create the version and enter terms manually.",
    });
  }

  // 3. Call Claude — degrade gracefully on partial/invalid JSON
  let extracted = emptyLOI();
  let degraded = false;
  let claudeError: string | null = null;
  let roundLabel: string | null = null;
  let party: string | null = null;
  let documentDate: string | null = null;
  try {
    const raw = await callClaude(loiText.slice(0, 150_000), versionNumber);
    // document_meta sits outside the term schema (zod strips it), so read it first.
    const meta = (raw as { document_meta?: { round_label?: unknown; party?: unknown; document_date?: unknown } })?.document_meta;
    if (meta) {
      if (typeof meta.round_label === "string") roundLabel = meta.round_label.slice(0, 60);
      if (meta.party === "Landlord" || meta.party === "Tenant") party = meta.party;
      if (typeof meta.document_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(meta.document_date)) {
        documentDate = meta.document_date;
      }
    }
    const parsed = parseExtraction(raw);
    extracted = parsed.loi;
    degraded = parsed.degraded;
  } catch (e) {
    degraded = true;
    claudeError = e instanceof Error ? e.message : String(e);
  }
  if (!roundLabel) roundLabel = versionNumber === 1 ? "Initial LOI" : `Counter ${versionNumber - 1}`;

  // 4. Store the version row
  const { data: row, error: insertErr } = await admin
    .from("loi_versions")
    .insert({
      deal_id: dealId,
      version_number: versionNumber,
      round_label: roundLabel,
      party,
      source: "upload",
      document_date: documentDate,
      cell_overrides: {},
      uploaded_by: uploaderId || null,
      uploaded_by_email: uploaderEmail || null,
      file_url: storagePath,
      file_name: fileName,
      extracted_json: extracted,
    })
    .select()
    .single();

  if (insertErr) return json(500, { error: `Saved extraction failed to write: ${insertErr.message}` });

  return json(200, {
    version: row,
    degraded,
    claudeError,
    message: degraded
      ? "Some fields could not be extracted — review the tracker column and fill gaps manually."
      : "Extraction complete.",
  });
};

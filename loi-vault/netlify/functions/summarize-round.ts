import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { summaryPrompt, SUMMARY_SYSTEM, CLAUDE_MODEL } from "../../lib/prompts";

// Writes the "what moved this round" entry for one LOI version.
// Compares against the immediately prior version and stores the result
// on loi_versions.change_summary.

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

interface VersionRow {
  id: string;
  deal_id: string;
  version_number: number;
  round_label: string | null;
  extracted_json: unknown;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  let versionId: string | undefined;
  try {
    versionId = JSON.parse(event.body || "{}").versionId;
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  if (!versionId) return json(400, { error: "versionId is required" });

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: current, error: curErr } = await admin
    .from("loi_versions")
    .select("id, deal_id, version_number, round_label, extracted_json")
    .eq("id", versionId)
    .single<VersionRow>();

  if (curErr || !current) return json(404, { error: "That version no longer exists." });

  const { data: priors } = await admin
    .from("loi_versions")
    .select("id, deal_id, version_number, round_label, extracted_json")
    .eq("deal_id", current.deal_id)
    .lt("version_number", current.version_number)
    .order("version_number", { ascending: true });

  const priorList = (priors || []) as VersionRow[];
  const immediatePrior = priorList.length ? priorList[priorList.length - 1] : null;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY || "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system: SUMMARY_SYSTEM,
      messages: [
        {
          role: "user",
          content: summaryPrompt(
            current,
            immediatePrior,
            priorList.map((v) => ({ version_number: v.version_number, round_label: v.round_label }))
          ),
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return json(502, { error: `Claude API ${res.status}: ${err.slice(0, 300)}` });
  }

  const data = await res.json();
  const summary: string = (data.content || [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("\n")
    .trim();

  if (!summary) return json(502, { error: "Claude returned an empty summary. Try again." });

  const { error: updErr } = await admin.from("loi_versions").update({ change_summary: summary }).eq("id", versionId);
  if (updErr) return json(500, { error: `Could not save the summary: ${updErr.message}` });

  return json(200, { summary });
};

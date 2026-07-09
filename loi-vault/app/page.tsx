"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { parseExtraction } from "@/lib/extraction-schema";
import {
  applyCellEdit,
  buildTrail,
  seedSuggestedCounter,
  TRAIL_ROWS,
  DETAIL_ROWS,
  type TrailVersion,
} from "@/lib/trail";
import { TransactionTrail } from "@/components/transaction-trail";
import { NegotiationLog } from "@/components/negotiation-log";
import { UploadDropzone } from "@/components/upload-dropzone";
import { Button } from "@/components/ui/button";
import { exportPDF, exportWord, exportExcel } from "@/lib/exports";

interface Deal {
  id: string;
  building_id: string;
  name: string;
  tenant: string | null;
  suite: string | null;
  status: string;
  buildings: { id: string; name: string } | null;
}

const STATUSES = ["Negotiating", "Out for signature", "Executed", "Dead"];
const ALL_ROWS = [...TRAIL_ROWS, ...DETAIL_ROWS];

export default function DealPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const dealId = params.id;

  const [deal, setDeal] = useState<Deal | null>(null);
  const [versions, setVersions] = useState<TrailVersion[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);
  const [addingSuggested, setAddingSuggested] = useState(false);

  const load = useCallback(async () => {
    const sb = supabase();
    const { data: sess } = await sb.auth.getSession();
    if (!sess.session) {
      router.replace("/");
      return;
    }
    const { data: d } = await sb
      .from("deals")
      .select("id, building_id, name, tenant, suite, status, buildings(id, name)")
      .eq("id", dealId)
      .single();

    const { data: vs } = await sb
      .from("loi_versions")
      .select(
        "id, version_number, round_label, party, source, document_date, uploaded_at, uploaded_by_email, file_name, extracted_json, cell_overrides, change_summary, status"
      )
      .eq("deal_id", dealId)
      // Rows mid-extraction (or failed) have no terms yet — they'd render as a
      // ghost column and poison every diff against the column before them.
      .eq("status", "ready")
      .order("version_number", { ascending: true });

    setDeal(d as unknown as Deal | null);
    setVersions(
      (vs || []).map((v) => ({
        ...v,
        extracted_json: parseExtraction(v.extracted_json).loi,
        cell_overrides: (v.cell_overrides as Record<string, string>) || {},
      })) as TrailVersion[]
    );
    setLoading(false);
  }, [dealId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const trail = useMemo(() => buildTrail(versions, TRAIL_ROWS), [versions]);
  const nextVersion = (versions[versions.length - 1]?.version_number || 0) + 1;
  const tenantName = deal?.tenant || deal?.name || "";

  async function saveCell(versionId: string, rowId: string, text: string) {
    const target = versions.find((v) => v.id === versionId);
    const def = ALL_ROWS.find((r) => r.id === rowId);
    if (!target || !def) return;

    const next = applyCellEdit(target, def, text);
    setVersions((vs) => vs.map((v) => (v.id === versionId ? { ...v, ...next } : v)));
    await supabase()
      .from("loi_versions")
      .update({ extracted_json: next.extracted_json, cell_overrides: next.cell_overrides })
      .eq("id", versionId);

    if (versionId === versions[versions.length - 1]?.id && def.field?.[0] === "parties") {
      await supabase()
        .from("deals")
        .update({
          tenant: (next.extracted_json.parties.tenant.value as string) || null,
          landlord: (next.extracted_json.parties.landlord.value as string) || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", dealId);
    }
  }

  async function relabel(versionId: string, label: string) {
    setVersions((vs) => vs.map((v) => (v.id === versionId ? { ...v, round_label: label } : v)));
    await supabase().from("loi_versions").update({ round_label: label }).eq("id", versionId);
  }

  async function redate(versionId: string, isoDate: string) {
    const value = isoDate || null;
    setVersions((vs) => vs.map((v) => (v.id === versionId ? { ...v, document_date: value } : v)));
    await supabase().from("loi_versions").update({ document_date: value }).eq("id", versionId);
  }

  async function deleteColumn(versionId: string) {
    setVersions((vs) => vs.filter((v) => v.id !== versionId));
    await supabase().from("loi_versions").delete().eq("id", versionId);
  }

  /** A landlord's suggested counter: no document, seeded from the last proposal. */
  async function addSuggestedCounter() {
    const sb = supabase();
    const { data: sess } = await sb.auth.getSession();
    const latest = versions[versions.length - 1];
    const seed = seedSuggestedCounter(latest);
    if (!seed.extracted_json) return;

    setAddingSuggested(true);
    const { error } = await sb.from("loi_versions").insert({
      deal_id: dealId,
      version_number: nextVersion,
      round_label: "LL Suggested Counter",
      party: "Landlord",
      source: "manual",
      uploaded_by: sess.session?.user.id,
      uploaded_by_email: sess.session?.user.email,
      extracted_json: seed.extracted_json,
      cell_overrides: seed.cell_overrides,
    });
    setAddingSuggested(false);
    if (error) {
      alert(`Could not add the column: ${error.message}`);
      return;
    }
    await load();
  }

  function saveSummary(versionId: string, text: string) {
    setVersions((vs) => vs.map((v) => (v.id === versionId ? { ...v, change_summary: text } : v)));
    void supabase().from("loi_versions").update({ change_summary: text }).eq("id", versionId);
  }

  async function setStatus(status: string) {
    await supabase().from("deals").update({ status, updated_at: new Date().toISOString() }).eq("id", dealId);
    setDeal((d) => (d ? { ...d, status } : d));
  }

  async function doExport(kind: "pdf" | "word" | "excel") {
    if (!deal) return;
    setExporting(kind);
    const bundle = { buildingName: deal.buildings?.name || "", tenantName, versions };
    try {
      if (kind === "pdf") await exportPDF(bundle);
      if (kind === "word") await exportWord(bundle);
      if (kind === "excel") await exportExcel(bundle);
    } catch (e) {
      alert(`Export failed: ${e instanceof Error ? e.message : "unknown error"}. See DEPLOY.md troubleshooting.`);
    } finally {
      setExporting(null);
    }
  }

  if (loading) {
    return <main className="min-h-screen flex items-center justify-center text-zinc-400 text-sm">Loading transaction…</main>;
  }
  if (!deal) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-3">
        <p className="text-zinc-500">This transaction isn&apos;t in your workspace.</p>
        <Link href="/dashboard" className="text-accent text-sm hover:underline">Back to buildings</Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-zinc-200 dark:border-zinc-800 bg-[var(--bg)]/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1500px] items-center justify-between gap-4 px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <Link href="/dashboard" className="shrink-0 text-sm text-zinc-400 hover:text-zinc-600">Buildings</Link>
            <span className="text-zinc-300 dark:text-zinc-700">/</span>
            <Link href={`/building/${deal.building_id}`} className="truncate text-sm text-zinc-400 hover:text-zinc-600">
              {deal.buildings?.name}
            </Link>
            <span className="text-zinc-300 dark:text-zinc-700">/</span>
            <h1 className="truncate font-serif text-lg font-medium">
              {tenantName}
              {deal.suite && <span className="font-normal text-zinc-400"> · {deal.suite}</span>}
            </h1>
            <select
              value={deal.status}
              onChange={(e) => setStatus(e.target.value)}
              className="ml-1 rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-1.5 py-0.5 text-xs text-zinc-500"
              aria-label="Transaction status"
            >
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => doExport("excel")} disabled={!!exporting || !versions.length}>
              {exporting === "excel" ? "…" : "Excel"}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => doExport("word")} disabled={!!exporting || !versions.length}>
              {exporting === "word" ? "…" : "Word"}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => doExport("pdf")} disabled={!!exporting || !versions.length}>
              {exporting === "pdf" ? "…" : "PDF"}
            </Button>
            <Button size="sm" onClick={() => setUploadOpen(true)}>+ Add proposal</Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] space-y-6 px-6 py-6">
        <TransactionTrail
          tenantName={tenantName}
          buildingName={deal.buildings?.name || ""}
          versions={versions}
          onCellSave={saveCell}
          onRelabel={relabel}
          onRedate={redate}
          onDeleteColumn={deleteColumn}
          onAddSuggested={addSuggestedCounter}
          addingSuggested={addingSuggested}
        />
        <NegotiationLog versions={trail.versions} changeCounts={trail.movedCounts} onSave={saveSummary} />
      </div>

      <UploadDropzone
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        buildingId={deal.building_id}
        dealId={dealId}
        nextVersion={nextVersion}
        onComplete={() => {
          setUploadOpen(false);
          void load();
        }}
      />
    </main>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { UploadDropzone } from "@/components/upload-dropzone";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fmtDate } from "@/lib/utils";

interface Building {
  id: string;
  name: string;
  address: string | null;
}

interface DealRow {
  id: string;
  name: string;
  tenant: string | null;
  suite: string | null;
  status: string;
  updated_at: string;
  rounds: number;
  lastRound: string | null;
}

export default function BuildingPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const buildingId = params.id;

  const [building, setBuilding] = useState<Building | null>(null);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = supabase();
    const { data: sess } = await sb.auth.getSession();
    if (!sess.session) {
      router.replace("/");
      return;
    }

    const { data: b } = await sb.from("buildings").select("id, name, address").eq("id", buildingId).single();
    const { data: ds } = await sb
      .from("deals")
      .select("id, name, tenant, suite, status, updated_at")
      .eq("building_id", buildingId)
      .order("updated_at", { ascending: false });

    const ids = (ds || []).map((d) => d.id);
    const { data: vs } = ids.length
      ? await sb.from("loi_versions").select("deal_id, version_number, uploaded_at").in("deal_id", ids)
      : { data: [] as Array<{ deal_id: string; version_number: number; uploaded_at: string }> };

    setBuilding(b as Building | null);
    setDeals(
      (ds || []).map((d) => {
        const mine = (vs || []).filter((v) => v.deal_id === d.id);
        return {
          ...d,
          rounds: mine.length,
          lastRound: mine.map((v) => v.uploaded_at).sort().pop() || null,
        } as DealRow;
      })
    );
    setLoading(false);
  }, [buildingId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Deleting the deal cascades to its proposals; files are cleaned up best-effort. */
  async function deleteDeal(d: DealRow) {
    if (!confirm(`Delete "${d.tenant || d.name}" and all ${d.rounds} proposal(s)? This can't be undone.`)) return;
    setDeleting(d.id);
    const sb = supabase();
    try {
      const { data: sess } = await sb.auth.getSession();
      const domain = (sess.session?.user.email || "").split("@")[1];
      const prefix = `${domain}/${buildingId}/${d.id}`;
      const { data: files } = await sb.storage.from("loi-files").list(prefix);
      if (files?.length) await sb.storage.from("loi-files").remove(files.map((f) => `${prefix}/${f.name}`));
    } catch {
      // Orphaned files are untidy, not dangerous.
    }
    const { error } = await sb.from("deals").delete().eq("id", d.id);
    setDeleting(null);
    if (error) {
      alert(`Could not delete: ${error.message}`);
      return;
    }
    setDeals((ds) => ds.filter((x) => x.id !== d.id));
  }

  if (loading) {
    return <main className="min-h-screen flex items-center justify-center text-zinc-400 text-sm">Loading…</main>;
  }
  if (!building) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-3">
        <p className="text-zinc-500">This building isn&apos;t in your workspace.</p>
        <Link href="/dashboard" className="text-accent text-sm hover:underline">Back to buildings</Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center gap-3">
          <Link href="/dashboard" className="text-zinc-400 hover:text-zinc-600 text-sm">← Buildings</Link>
          <span className="text-zinc-300 dark:text-zinc-700">/</span>
          <span className="font-serif text-lg font-medium truncate">{building.name}</span>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <h1 className="font-serif text-3xl font-medium">{building.name}</h1>
            {building.address && <p className="text-[14px] text-zinc-500 mt-1">{building.address}</p>}
          </div>
          <Button onClick={() => setUploadOpen(true)}>+ New transaction</Button>
        </div>

        {deals.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-16 text-center">
            <p className="text-zinc-500">No transactions in this building yet.</p>
            <p className="text-[13px] text-zinc-400 mt-1">Drop in the first LOI and the tracker builds itself.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <table className="w-full text-left text-[14px]">
              <thead className="bg-zinc-50 dark:bg-zinc-800/40 text-[11px] uppercase tracking-wider text-zinc-400">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Transaction</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Suite</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Rounds</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Last activity</th>
                  <th scope="col" className="px-4 py-2.5 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {deals.map((d) => (
                  <tr
                    key={d.id}
                    onClick={() => router.push(`/deal/${d.id}`)}
                    className="group cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium">{d.tenant || d.name}</td>
                    <td className="px-4 py-3 text-zinc-500">{d.suite || "—"}</td>
                    <td className="px-4 py-3 text-zinc-500 tabular-nums">{d.rounds}</td>
                    <td className="px-4 py-3"><Badge tone={d.status}>{d.status}</Badge></td>
                    <td className="px-4 py-3 text-zinc-400">{d.lastRound ? fmtDate(d.lastRound) : "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteDeal(d);
                        }}
                        disabled={deleting === d.id}
                        className="rounded px-1.5 text-zinc-300 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
                        aria-label={`Delete ${d.tenant || d.name}`}
                        title="Delete this transaction"
                      >
                        {deleting === d.id ? "…" : "✕"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <UploadDropzone
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        buildingId={buildingId}
        onComplete={(dealId) => router.push(`/deal/${dealId}`)}
      />
    </main>
  );
}
